package io.github.strongholdprotocol.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int EXPORT = 101, IMPORT = 102, FILE_PICKER = 103, NOTIFICATIONS = 104;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private WebView web;
    private LinearLayout toolbar;
    private TextView status, overlayText;
    private LinearLayout overlay;
    private Button fullscreenMenu;
    private NodeService service;
    private boolean bound, pendingLan;
    private String loadedNonce = "";
    private byte[] pendingExport;
    private ValueCallback<Uri[]> filePicker;
    private final NodeService.Listener listener = this::showState;
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((NodeService.LocalBinder) binder).service();
            service.addListener(listener);
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            service = null;
            overlayText.setText("本地服务已断开，请重新启动"); overlay.setVisibility(View.VISIBLE);
        }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        FrameLayout root = new FrameLayout(this);
        LinearLayout column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL);
        root.addView(column, new FrameLayout.LayoutParams(-1, -1));
        toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setBackgroundColor(Color.rgb(28, 35, 32));
        status = new TextView(this); status.setTextColor(Color.WHITE); status.setTextSize(12); status.setPadding(dp(12), 0, dp(8), 0);
        toolbar.addView(status, new LinearLayout.LayoutParams(0, -1, 1));
        toolbar.addView(button("全屏", () -> { toolbar.setVisibility(View.GONE); fullscreenMenu.setVisibility(View.VISIBLE); }));
        toolbar.addView(button("菜单", this::menu));
        column.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(40)));
        FrameLayout game = new FrameLayout(this);
        column.addView(game, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(this); web.setBackgroundColor(Color.rgb(23, 27, 32));
        game.addView(web, new FrameLayout.LayoutParams(-1, -1));
        overlay = new LinearLayout(this); overlay.setGravity(Gravity.CENTER); overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setBackgroundColor(Color.rgb(23, 27, 32)); overlay.setPadding(dp(24), dp(12), dp(24), dp(12));
        overlayText = new TextView(this); overlayText.setTextColor(Color.WHITE); overlayText.setGravity(Gravity.CENTER); overlayText.setTextSize(15);
        overlay.addView(overlayText, new LinearLayout.LayoutParams(-1, -2));
        overlay.addView(button("重新启动", () -> {
            if (service != null && service.snapshot().state == NodeService.State.READY) { overlay.setVisibility(View.GONE); web.reload(); }
            else startMode(service != null && service.snapshot().lan);
        }), new LinearLayout.LayoutParams(-2, -2));
        game.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        fullscreenMenu = button("菜单", this::menu); fullscreenMenu.setAlpha(0.8f); fullscreenMenu.setVisibility(View.GONE);
        FrameLayout.LayoutParams floating = new FrameLayout.LayoutParams(dp(68), dp(38), Gravity.TOP | Gravity.END);
        root.addView(fullscreenMenu, floating);
        setContentView(root);
        // 全屏下仍尊重刘海与导航区域，避免菜单或游戏按钮被遮挡。
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            }
            return insets;
        });
        configureWebView();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false); settings.setBuiltInZoomControls(false); settings.setDisplayZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) return false;
                if (request.isForMainFrame()) external(request.getUrl());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl()) || WebResourcePolicy.inlineResource(request.getUrl().toString(), request.isForMainFrame())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    overlayText.setText("游戏页面暂时不可用：" + error.getDescription()); overlay.setVisibility(View.VISIBLE);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!pageReady()) { callback.onReceiveValue(null); return true; }
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = callback;
                try { startActivityForResult(params.createIntent().addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), FILE_PICKER); }
                catch (ActivityNotFoundException error) { filePicker.onReceiveValue(null); filePicker = null; toast("系统没有可用的文件选择器"); }
                return true;
            }
        });
    }

    static boolean trusted(Uri uri) {
        return uri != null && "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost())
                && uri.getPort() == 32173 && "127.0.0.1:32173".equals(uri.getEncodedAuthority());
    }
    private void external(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) { toast("不支持此链接"); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException error) { toast("系统没有可用的浏览器"); }
    }

    @Override public void onStart() {
        super.onStart();
        startService(new Intent(this, NodeService.class).setAction(NodeService.ACTION_ENSURE));
        bound = bindService(new Intent(this, NodeService.class), connection, Context.BIND_AUTO_CREATE);
    }
    @Override public void onStop() {
        if (service != null) service.removeListener(listener);
        if (bound) { unbindService(connection); bound = false; }
        service = null;
        super.onStop();
    }
    @Override public void onResume() { super.onResume(); if (web != null) web.onResume(); immersive(); }
    @Override public void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if (focus) immersive(); }

    private void showState(NodeService.Snapshot snapshot) {
        status.setText((snapshot.lan ? "局域网 · " : "单机 · ") + snapshot.message);
        if (snapshot.state == NodeService.State.READY) {
            overlay.setVisibility(View.GONE);
            if (!loadedNonce.equals(snapshot.nonce)) { loadedNonce = snapshot.nonce; web.loadUrl(NodeService.ORIGIN); }
        } else {
            overlayText.setText(snapshot.message); overlay.setVisibility(View.VISIBLE);
            if (snapshot.state == NodeService.State.STOPPED || snapshot.state == NodeService.State.ERROR) loadedNonce = "";
        }
    }

    private void menu() {
        boolean lan = service != null && service.snapshot().lan;
        String[] items = {"返回游戏", lan ? "切换到离线单机" : "开启局域网主机", "分享局域网地址", "停止服务", "导出设置与调配备份", "导入设置与调配备份", "电池设置", "显示工具栏"};
        new AlertDialog.Builder(this).setTitle("卫戍协议 · " + BuildConfig.GAME_VERSION).setItems(items, (dialog, which) -> {
            switch (which) {
                case 0: if (service == null || service.snapshot().state != NodeService.State.READY) startMode(lan); break;
                case 1: requestMode(!lan); break;
                case 2: shareLan(); break;
                case 3: startService(new Intent(this, NodeService.class).setAction(NodeService.ACTION_STOP)); break;
                case 4: exportBackup(); break;
                case 5: importBackup(); break;
                case 6: startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); break;
                case 7: toolbar.setVisibility(View.VISIBLE); fullscreenMenu.setVisibility(View.GONE); break;
                default: break;
            }
        }).show();
    }
    private void requestMode(boolean lan) {
        if (service != null && service.snapshot().matches > 0) { toast("当前有对局，结束后才能切换模式"); return; }
        if (lan) {
            new AlertDialog.Builder(this).setTitle("开启局域网主机")
                    .setMessage("同一 Wi-Fi 或热点下的设备可通过浏览器加入。后台开服会显示停止通知；手机锁屏后的连接也受系统电池设置影响。")
                    .setNegativeButton("取消", null).setPositiveButton("开启", (dialog, which) -> {
                        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            pendingLan = true; requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS);
                        } else startMode(true);
                    }).show();
        } else startMode(false);
    }
    private void startMode(boolean lan) {
        Intent intent = new Intent(this, NodeService.class).setAction(NodeService.ACTION_MODE).putExtra("lan", lan);
        try {
            if (lan && Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
        } catch (RuntimeException error) { toast("无法启动服务：" + error.getMessage()); }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NOTIFICATIONS && pendingLan) {
            pendingLan = false;
            if (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED) toast("通知未开启，仍可在应用菜单停止开服");
            startMode(true);
        }
    }
    private void shareLan() {
        if (service == null || !service.snapshot().lan || service.snapshot().state != NodeService.State.READY) { toast("请先开启局域网主机"); return; }
        List<String> urls = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                Enumeration<InetAddress> addresses = network.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) urls.add("http://" + address.getHostAddress() + ":32173/");
                }
            }
        } catch (SocketException error) { toast("无法读取局域网地址"); return; }
        if (urls.isEmpty()) { toast("未找到局域网地址，请连接 Wi-Fi 或开启热点"); return; }
        String addresses = android.text.TextUtils.join("\n", new LinkedHashSet<>(urls));
        new AlertDialog.Builder(this).setTitle("局域网加入地址").setMessage(addresses + "\n\n其他设备需连接同一 Wi-Fi 或热点。")
                .setNegativeButton("关闭", null).setPositiveButton("分享", (dialog, which) -> startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, addresses), "分享加入地址"))).show();
    }

    private boolean pageReady() { return service != null && service.snapshot().state == NodeService.State.READY && trusted(Uri.parse(web.getUrl() == null ? "" : web.getUrl())); }
    private void exportBackup() {
        if (!pageReady()) { toast("请先等待游戏启动"); return; }
        String keys = new JSONArray(Arrays.asList(PreferenceBackup.KEYS)).toString();
        web.evaluateJavascript("(()=>{const p={};for(const k of " + keys + "){const v=localStorage.getItem(k);if(v!==null)p[k]=v;}return JSON.stringify(p);})()", result -> {
            try {
                Object decoded = new JSONTokener(result).nextValue();
                if (!(decoded instanceof String)) throw new IOException("无法读取游戏设置");
                pendingExport = PreferenceBackup.export(new JSONObject((String) decoded), BuildConfig.GAME_VERSION).getBytes(StandardCharsets.UTF_8);
                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, "卫戍协议-设置备份.json"), EXPORT);
            } catch (Exception error) { toast("导出失败：" + error.getMessage()); }
        });
    }
    private void importBackup() {
        if (!pageReady()) { toast("请先等待游戏启动"); return; }
        try { startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"), IMPORT); }
        catch (ActivityNotFoundException error) { toast("系统没有可用的文件选择器"); }
    }
    @Override public void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request == FILE_PICKER) {
            if (filePicker != null) { filePicker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, intent)); filePicker = null; }
            return;
        }
        byte[] exportBytes = pendingExport;
        if (request == EXPORT) pendingExport = null;
        if (result != RESULT_OK || intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        if (request == EXPORT) {
            if (exportBytes == null) { toast("导出已中断，请重试"); return; }
            files.execute(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("无法写入选定文件");
                    output.write(exportBytes); main.post(() -> toast("备份已保存"));
                } catch (Exception error) { main.post(() -> toast("保存失败：" + error.getMessage())); }
            });
        } else if (request == IMPORT) {
            files.execute(() -> {
                try (InputStream input = getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IOException("无法读取选定文件");
                    JSONObject preferences = PreferenceBackup.parse(BundleInstaller.readBounded(input, PreferenceBackup.MAX_BYTES));
                    main.post(() -> restore(preferences));
                } catch (Exception error) { main.post(() -> toast("导入失败：" + error.getMessage())); }
            });
        }
    }
    private void restore(JSONObject preferences) {
        if (!pageReady()) { toast("本地服务尚未就绪，请重新导入"); return; }
        String script = "(()=>{const p=" + preferences + ";const old={};try{for(const k of Object.keys(p))old[k]=localStorage.getItem(k);for(const k of Object.keys(p))localStorage.setItem(k,p[k]);return true;}catch(e){for(const k of Object.keys(old)){if(old[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,old[k]);}return false;}})()";
        web.evaluateJavascript(script, result -> {
            if ("true".equals(result)) { toast("备份已导入，正在刷新游戏"); web.reload(); }
            else toast("导入失败，原有设置已保留");
        });
    }

    private Button button(String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setTextSize(12); button.setMinHeight(0); button.setMinimumHeight(0);
        button.setOnClickListener(view -> action.run()); return button;
    }
    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + 0.5f); }
    private void toast(String message) { if (!isFinishing() && !isDestroyed()) Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    @SuppressWarnings("deprecation") private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    private void back() { if (web.canGoBack()) web.goBack(); else menu(); }
    @Override public boolean onKeyUp(int code, KeyEvent event) {
        // API 33 起由 OnBackInvokedDispatcher 接收手势；旧系统才处理返回键。
        if (Build.VERSION.SDK_INT < 33 && code == KeyEvent.KEYCODE_BACK) { back(); return true; }
        return super.onKeyUp(code, event);
    }
    @Override public void onDestroy() {
        if (filePicker != null) { filePicker.onReceiveValue(null); filePicker = null; }
        files.shutdownNow(); web.stopLoading(); web.destroy(); super.onDestroy();
    }
}
