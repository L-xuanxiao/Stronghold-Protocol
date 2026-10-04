package io.github.strongholdprotocol.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import org.json.JSONObject;

import java.io.*;
import java.lang.Process;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** 单个 Service 实例拥有进程；所有启动、健康检查、切换在同一工作线程串行执行。 */
public final class NodeService extends Service {
    static final String ORIGIN = "http://127.0.0.1:32173/";
    static final String ACTION_ENSURE = "io.github.strongholdprotocol.mobile.ENSURE";
    static final String ACTION_MODE = "io.github.strongholdprotocol.mobile.MODE";
    static final String ACTION_STOP = "io.github.strongholdprotocol.mobile.STOP";
    private static final String CHANNEL = "lan_server";
    private static final int NOTIFICATION = 32173;
    enum State { STOPPED, STARTING, READY, ERROR }
    static final class Snapshot {
        final State state;
        final boolean lan;
        final int matches;
        final String message, nonce;
        Snapshot(State state, boolean lan, int matches, String message, String nonce) {
            this.state = state; this.lan = lan; this.matches = matches; this.message = message; this.nonce = nonce;
        }
    }
    interface Listener { void changed(Snapshot snapshot); }
    public final class LocalBinder extends Binder { NodeService service() { return NodeService.this; } }

    private final LocalBinder binder = new LocalBinder();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private volatile Snapshot snapshot = new Snapshot(State.STOPPED, false, 0, "本地服务尚未启动", "");
    private volatile Process process;
    private volatile boolean destroyed;
    private volatile boolean wanted;
    private boolean lan;
    private volatile Thread startupThread;
    private final AtomicInteger cancellation = new AtomicInteger();
    private String nonce = "";
    private volatile String outputTail = "";
    private int pid, healthFailures, recoveries;
    private long readyAt;
    private PowerManager.WakeLock wakeLock;
    private boolean foreground;
    private long wakeRenewAt;

    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "局域网开服", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("手机作为局域网主机时显示，可随时停止服务");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":lan");
        wakeLock.setReferenceCounted(false);
        worker.scheduleWithFixedDelay(this::checkHealth, 3, 3, TimeUnit.SECONDS);
    }

    @Override public IBinder onBind(Intent intent) { return binder; }
    Snapshot snapshot() { return snapshot; }
    void addListener(Listener listener) { listeners.add(listener); listener.changed(snapshot); }
    void removeListener(Listener listener) { listeners.remove(listener); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            requestStop();
        } else {
            boolean switchMode = ACTION_MODE.equals(action);
            boolean requestedLan = intent.getBooleanExtra("lan", false);
            // 从可见界面显式启用 LAN，先满足 startForegroundService 的时限。
            if (requestedLan) {
                try { promoteForeground(); }
                catch (RuntimeException error) {
                    publish(new Snapshot(State.ERROR, lan, 0, "无法开启后台服务：" + error.getMessage(), nonce));
                    return START_NOT_STICKY;
                }
            }
            int epoch = cancellation.get();
            worker.execute(() -> { if (epoch == cancellation.get()) startRequested(requestedLan, switchMode); });
        }
        return START_NOT_STICKY;
    }

    private void startRequested(boolean requestedLan, boolean switchMode) {
        if (destroyed) return;
        if (!switchMode && wanted && (process != null || snapshot.state == State.STARTING)) return;
        if (process != null && alive(process)) {
            if (!switchMode || requestedLan == lan) return;
            try {
                if (health().getInt("matches") > 0) {
                    publish(new Snapshot(State.READY, lan, snapshot.matches, "当前有对局，结束后才能切换模式", nonce));
                    if (!lan) main.post(this::demoteForeground);
                    return;
                }
            } catch (Exception error) {
                publish(new Snapshot(snapshot.state, lan, snapshot.matches, "无法确认对局状态，请稍后重试切换", nonce));
                if (!lan) main.post(this::demoteForeground);
                return;
            }
        }
        wanted = true;
        stopChild();
        lan = requestedLan;
        recoveries = 0;
        startChild();
    }

    private void startChild() {
        if (destroyed || !wanted || (process != null && alive(process))) return;
        startupThread = Thread.currentThread();
        nonce = UUID.randomUUID().toString();
        publish(new Snapshot(State.STARTING, lan, 0, "正在校验和准备游戏资源…", nonce));
        try {
            File bundle = BundleInstaller.install(getFilesDir(), name -> getAssets().open(name), BuildConfig.GAME_VERSION);
            if (destroyed || !wanted) return;
            File nativeDir = new File(getApplicationInfo().nativeLibraryDir);
            File node = new File(nativeDir, "libnode.so");
            if (!node.isFile()) throw new IOException("找不到此设备所需的 Node 运行时");
            ProcessBuilder builder = new ProcessBuilder("/system/bin/linker64", node.getAbsolutePath(),
                    new File(bundle, "mobile-main.mjs").getAbsolutePath(), "--host=" + (lan ? "0.0.0.0" : "127.0.0.1"),
                    "--port=32173", "--nonce=" + nonce);
            builder.directory(bundle).redirectErrorStream(true);
            builder.environment().put("LD_LIBRARY_PATH", nativeDir.getAbsolutePath());
            Process child = builder.start();
            process = child;
            if (destroyed || !wanted) { child.destroy(); process = null; return; }
            outputTail = "";
            BlockingQueue<String> readiness = new LinkedBlockingQueue<>(4);
            Thread output = new Thread(() -> readOutput(child, readiness), "node-output");
            output.setDaemon(true); output.start();
            Thread watcher = new Thread(() -> {
                try {
                    int code = child.waitFor();
                    if (!destroyed) worker.execute(() -> processExited(child, code));
                } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                catch (RejectedExecutionException ignored) { }
            }, "node-exit");
            watcher.setDaemon(true); watcher.start();
            publish(new Snapshot(State.STARTING, lan, 0, "正在启动手机内的游戏服务…", nonce));
            long deadline = System.currentTimeMillis() + 25000;
            JSONObject ready = null;
            while (System.currentTimeMillis() < deadline && alive(child) && !destroyed) {
                String line = readiness.poll(300, TimeUnit.MILLISECONDS);
                if (line == null) continue;
                JSONObject candidate = new JSONObject(line);
                if (candidate.optInt("port") == 32173 && nonce.equals(candidate.optString("nonce"))
                        && BuildConfig.GAME_VERSION.equals(candidate.optString("app"))
                        && candidate.optLong("pid") > 0 && candidate.optLong("pid") <= Integer.MAX_VALUE) {
                    ready = candidate; break;
                }
            }
            if (ready == null) throw new IOException("本地服务未就绪" + (outputTail.isEmpty() ? "" : "：" + outputTail));
            pid = ready.getInt("pid");
            JSONObject health = health();
            if (destroyed || !wanted) { stopChild(); return; }
            readyAt = System.currentTimeMillis();
            healthFailures = 0;
            publish(new Snapshot(State.READY, lan, health.getInt("matches"), lan ? "局域网主机已启动" : "离线单机已启动", nonce));
        } catch (Exception error) {
            stopChild();
            wanted = false;
            publish(new Snapshot(State.ERROR, lan, 0, "启动失败：" + error.getMessage(), nonce));
            main.post(this::demoteForeground);
        } finally {
            startupThread = null;
        }
    }

    private void readOutput(Process child, BlockingQueue<String> readiness) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("SP_READY ")) readiness.offer(line.substring(9));
                String tail = outputTail + "\n" + line;
                outputTail = tail.substring(Math.max(0, tail.length() - 1800)).trim();
            }
        } catch (IOException ignored) { }
    }

    private JSONObject health() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + "healthz").openConnection();
        connection.setConnectTimeout(1500); connection.setReadTimeout(1500); connection.setInstanceFollowRedirects(false);
        try {
            if (connection.getResponseCode() != 200) throw new IOException("健康检查没有返回成功状态");
            byte[] body;
            try (InputStream input = connection.getInputStream()) { body = BundleInstaller.readBounded(input, 65536); }
            JSONObject result = new JSONObject(new String(body, StandardCharsets.UTF_8));
            Object matches = result.get("matches");
            if (!BuildConfig.GAME_VERSION.equals(result.getString("app")) || !(matches instanceof Number)
                    || ((Number) matches).doubleValue() != ((Number) matches).intValue() || ((Number) matches).intValue() < 0) {
                throw new IOException("本地服务版本或状态不符合预期");
            }
            return result;
        } finally { connection.disconnect(); }
    }

    private void checkHealth() {
        if (destroyed || process == null || snapshot.state != State.READY) return;
        if (!alive(process)) return; // 退出观察线程负责恢复，避免重复重启。
        try {
            JSONObject result = health();
            healthFailures = 0;
            main.post(this::holdLanWake);
            if (System.currentTimeMillis() - readyAt > 30000) recoveries = 0;
            int matches = result.getInt("matches");
            if (matches != snapshot.matches) publish(new Snapshot(State.READY, lan, matches, snapshot.message, nonce));
        } catch (Exception error) {
            if (++healthFailures >= 3) {
                stopChild();
                recover("本地服务失去响应");
            }
        }
    }

    private void processExited(Process child, int code) {
        if (child != process || destroyed) return;
        process = null; pid = 0;
        if (wanted) recover("本地服务退出（" + code + "）");
    }

    private void recover(String reason) {
        if (!wanted || destroyed) return;
        if (++recoveries > 3) {
            wanted = false;
            publish(new Snapshot(State.ERROR, lan, 0, reason + "，自动恢复未成功，请重试启动", nonce));
            main.post(this::demoteForeground);
            return;
        }
        publish(new Snapshot(State.STARTING, lan, 0, reason + "，正在恢复；原对局无法恢复", nonce));
        worker.schedule(this::startChild, 2, TimeUnit.SECONDS);
    }

    private void stopRequested() {
        wanted = false;
        stopChild();
        publish(new Snapshot(State.STOPPED, lan, 0, "本地服务已停止", nonce));
        main.post(() -> { demoteForeground(); stopSelf(); });
    }
    private void requestStop() {
        cancellation.incrementAndGet(); wanted = false;
        Thread preparing = startupThread;
        if (preparing != null) preparing.interrupt();
        Process child = process;
        if (child != null) child.destroy();
        demoteForeground();
        worker.execute(this::stopRequested);
    }

    private void stopChild() {
        Process child = process;
        process = null;
        int childPid = pid; pid = 0;
        if (child == null) return;
        child.destroy();
        long deadline = System.currentTimeMillis() + 2000;
        while (alive(child) && System.currentTimeMillis() < deadline) {
            try { Thread.sleep(30); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); break; }
        }
        if (alive(child) && childPid > 0) android.os.Process.killProcess(childPid);
        try { child.getInputStream().close(); } catch (IOException ignored) { }
    }
    private static boolean alive(Process child) { try { child.exitValue(); return false; } catch (IllegalThreadStateException running) { return true; } }

    private void publish(Snapshot next) {
        snapshot = next;
        main.post(() -> {
            if (destroyed) return;
            if (next.lan && (next.state == State.STARTING || next.state == State.READY)) {
                promoteForeground();
                holdLanWake();
            } else demoteForeground();
            for (Listener listener : listeners) listener.changed(next);
        });
    }

    private void promoteForeground() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent content = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, NodeService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification notification = builder.setSmallIcon(R.drawable.ic_notification).setContentTitle("卫戍协议 · 局域网开服")
                .setContentText("手机正在提供游戏服务；点此返回，或停止开服")
                .setContentIntent(content).setOngoing(true).addAction(new Notification.Action.Builder(null, "停止开服", stop).build()).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(NOTIFICATION, notification);
        foreground = true;
    }
    private void demoteForeground() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeRenewAt = 0;
        if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; }
    }
    private void holdLanWake() {
        Snapshot current = snapshot;
        if (!foreground || !current.lan || (current.state != State.STARTING && current.state != State.READY)) return;
        long now = SystemClock.elapsedRealtime();
        if (!wakeLock.isHeld() || now >= wakeRenewAt) {
            // 正常健康检查续租；服务线程失去响应时，系统也能自动回收唤醒锁。
            wakeLock.acquire(10 * 60 * 1000L);
            wakeRenewAt = now + 5 * 60 * 1000L;
        }
    }
    @Override public void onTaskRemoved(Intent rootIntent) {
        if (!snapshot.lan) requestStop();
        super.onTaskRemoved(rootIntent);
    }
    @Override public void onDestroy() {
        destroyed = true;
        worker.shutdownNow();
        Process child = process;
        if (child != null) {
            child.destroy();
            if (alive(child) && pid > 0) android.os.Process.killProcess(pid);
        }
        demoteForeground(); listeners.clear();
        super.onDestroy();
    }
}
