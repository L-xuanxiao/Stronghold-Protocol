package io.github.strongholdprotocol.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** 只把通过清单校验的完整资源目录交给 Node，失败时保留上次安装。 */
final class BundleInstaller {
    interface Assets { InputStream open(String name) throws IOException; }
    static final int MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
    private static final long MAX_BUNDLE_BYTES = 4L * 1024 * 1024 * 1024;

    static final class Item {
        final String path, hash;
        final long size;
        Item(String path, long size, String hash) { this.path = path; this.size = size; this.hash = hash; }
    }

    static final class Manifest {
        final String id, version, digest;
        final Map<String, Item> files;
        final long totalBytes;
        Manifest(String id, String version, String digest, Map<String, Item> files, long totalBytes) {
            this.id = id; this.version = version; this.digest = digest; this.files = files; this.totalBytes = totalBytes;
        }
        static Manifest parse(byte[] bytes) throws Exception {
            JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            if (!(json.get("schema") instanceof Number) || ((Number) json.get("schema")).doubleValue() != 1) throw new IOException("不支持的资源清单版本");
            String id = json.getString("bundleId"), version = json.getString("gameVersion");
            if (!id.matches("[A-Za-z0-9._-]{1,128}") || id.equals(".") || id.equals("..")) throw new IOException("无效的资源版本标识");
            if (!version.matches("[A-Za-z0-9._+-]{1,64}")) throw new IOException("无效的游戏版本");
            if (!json.getString("upstreamCommit").matches("[a-fA-F0-9]{40}")) throw new IOException("无效的源码版本");
            JSONArray list = json.getJSONArray("files");
            if (list.length() == 0 || list.length() > 30000) throw new IOException("资源文件数量异常");
            Map<String, Item> files = new LinkedHashMap<>();
            long total = 0;
            for (int i = 0; i < list.length(); i++) {
                JSONObject row = list.getJSONObject(i);
                String path = row.getString("path"), hash = row.getString("sha256");
                validatePath(path);
                Object rawSize = row.get("size");
                if (!(rawSize instanceof Number)) throw new IOException("无效的资源大小");
                long size = ((Number) rawSize).longValue();
                if (((Number) rawSize).doubleValue() != size || size < 0 || size > MAX_BUNDLE_BYTES) throw new IOException("无效的资源大小");
                if (!hash.matches("[a-f0-9]{64}") || files.containsKey(path)) throw new IOException("资源清单重复或校验值错误");
                total += size;
                if (total > MAX_BUNDLE_BYTES) throw new IOException("资源包过大");
                files.put(path, new Item(path, size, hash));
            }
            return new Manifest(id, version, hex(MessageDigest.getInstance("SHA-256").digest(bytes)), files, total);
        }
    }

    static File install(File filesDir, Assets assets, String expectedVersion) throws Exception {
        byte[] bytes;
        try (InputStream input = assets.open("game-manifest.json")) { bytes = readBounded(input, MAX_MANIFEST_BYTES); }
        Manifest manifest = Manifest.parse(bytes);
        if (!manifest.version.equals(expectedVersion)) throw new IOException("APK 与游戏资源版本不一致");
        File root = new File(filesDir, "bundles");
        mkdir(root);
        cleanStaleStages(root);
        File destination = new File(root, manifest.id);
        if (isVerified(destination, manifest)) { activate(root, manifest.id); return destination; }
        if (root.getUsableSpace() < manifest.totalBytes * 2 + 16 * 1024 * 1024) throw new IOException("存储空间不足，请至少预留 " + (manifest.totalBytes * 2 / 1024 / 1024 + 16) + " MB");
        File staging = new File(root, ".stage-" + manifest.id + "-" + UUID.randomUUID());
        mkdir(staging);
        try {
            File archive = new File(staging, ".bundle.zip");
            try (InputStream input = assets.open("game.zip"); FileOutputStream output = new FileOutputStream(archive)) {
                copyBounded(input, output, MAX_BUNDLE_BYTES);
                output.getFD().sync();
            }
            validateCentralDirectory(archive);
            Set<String> seen = new HashSet<>();
            try (ZipFile zip = new ZipFile(archive)) {
                Enumeration<? extends ZipEntry> entries = zip.entries();
                while (entries.hasMoreElements()) {
                    checkInterrupted();
                    ZipEntry entry = entries.nextElement();
                    String name = entry.getName();
                    if (entry.isDirectory()) { validatePath(name.substring(0, name.length() - 1)); continue; }
                    validatePath(name);
                    Item item = manifest.files.get(name);
                    if (item == null || !seen.add(name) || entry.getSize() != item.size) throw new IOException("资源目录与清单不一致：" + name);
                    File outputFile = new File(staging, name);
                    if (!outputFile.getCanonicalPath().startsWith(staging.getCanonicalPath() + File.separator)) throw new IOException("资源路径越界");
                    mkdir(outputFile.getParentFile());
                    MessageDigest hash = MessageDigest.getInstance("SHA-256");
                    long count = 0;
                    try (InputStream input = zip.getInputStream(entry); FileOutputStream output = new FileOutputStream(outputFile)) {
                        byte[] buffer = new byte[65536];
                        int n;
                        while ((n = input.read(buffer)) != -1) {
                            checkInterrupted();
                            count += n;
                            if (count > item.size) throw new IOException("资源大小超出清单：" + name);
                            hash.update(buffer, 0, n);
                            output.write(buffer, 0, n);
                        }
                    }
                    if (count != item.size || !hex(hash.digest()).equals(item.hash)) throw new IOException("资源完整性校验失败：" + name);
                }
            }
            if (seen.size() != manifest.files.size()) throw new IOException("资源包缺少清单文件");
            if (!archive.delete()) throw new IOException("无法清理临时资源包");
            writeSynced(new File(staging, ".verified"), manifest.digest);
            // 同一标识的损坏目录也先挪到旁边，完整新目录就绪后再切换。
            File previous = new File(root, ".old-" + manifest.id + "-" + UUID.randomUUID());
            boolean movedOld = destination.exists();
            if (movedOld && !destination.renameTo(previous)) throw new IOException("无法保留旧资源目录");
            if (!staging.renameTo(destination)) {
                if (movedOld && !previous.renameTo(destination)) throw new IOException("资源切换失败，旧目录保留于 " + previous.getName());
                throw new IOException("资源切换失败");
            }
            activate(root, manifest.id);
            return destination;
        } finally {
            if (staging.exists()) deleteTree(staging, root);
        }
    }

    private static boolean isVerified(File directory, Manifest manifest) throws IOException {
        File marker = new File(directory, ".verified");
        if (!marker.isFile()) return false;
        try (InputStream input = new FileInputStream(marker)) {
            if (!new String(readBounded(input, 64), StandardCharsets.UTF_8).equals(manifest.digest)) return false;
        }
        for (Item item : manifest.files.values()) {
            File file = new File(directory, item.path);
            if (!file.isFile() || file.length() != item.size) return false;
        }
        return true;
    }

    private static void activate(File root, String id) throws IOException {
        File active = new File(root, "active"), backup = new File(root, "active.bak");
        if (active.isFile()) {
            try (InputStream input = new FileInputStream(active)) {
                if (new String(readBounded(input, 128), StandardCharsets.UTF_8).equals(id)) {
                    pruneOldBundles(root, id); return;
                }
            }
        }
        File activeTmp = new File(root, "active.tmp");
        writeSynced(activeTmp, id);
        if (active.exists()) {
            if (backup.exists() && !backup.delete()) throw new IOException("无法更新资源标记");
            if (!active.renameTo(backup)) throw new IOException("无法保留旧资源标记");
        }
        if (!activeTmp.renameTo(active)) {
            backup.renameTo(active);
            throw new IOException("无法更新资源标记");
        }
        pruneOldBundles(root, id);
    }

    private static void pruneOldBundles(File root, String current) {
        try {
            String previous = "";
            File backup = new File(root, "active.bak");
            if (backup.isFile()) {
                try (InputStream input = new FileInputStream(backup)) {
                    previous = new String(readBounded(input, 128), StandardCharsets.UTF_8);
                }
            }
            File canonicalRoot = root.getCanonicalFile();
            File[] directories = root.listFiles();
            if (directories == null) return;
            for (File directory : directories) {
                String name = directory.getName();
                if (!directory.isDirectory() || !name.matches("[A-Za-z0-9._-]{1,128}")
                        || name.equals(current) || name.equals(previous) || name.startsWith(".")) continue;
                if (!directory.getCanonicalFile().equals(new File(canonicalRoot, name))) continue;
                File marker = new File(directory, ".verified");
                if (!marker.isFile()) continue;
                try (InputStream input = new FileInputStream(marker)) {
                    if (!new String(readBounded(input, 64), StandardCharsets.UTF_8).matches("[a-f0-9]{64}")) continue;
                }
                File canonicalDirectory = directory.getCanonicalFile();
                try { validateCleanupTree(canonicalDirectory); deleteTree(canonicalDirectory, canonicalRoot); }
                catch (IOException error) { System.err.println("旧资源清理未完成：" + name + "：" + error.getMessage()); }
            }
        } catch (IOException error) {
            // 清理失败不影响已完整安装的新包；保留旧文件供后续检查。
            System.err.println("旧资源清理未完成：" + error.getMessage());
        }
    }
    private static void validateCleanupTree(File file) throws IOException {
        if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) throw new IOException("清理目录包含符号链接");
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("无法读取旧资源目录");
            for (File child : children) validateCleanupTree(child);
        }
    }
    private static void cleanStaleStages(File root) throws IOException {
        File canonicalRoot = root.getCanonicalFile();
        File[] directories = root.listFiles();
        if (directories == null) return;
        for (File directory : directories) {
            String name = directory.getName();
            if (!directory.isDirectory() || !ownStageName(name)) continue;
            File canonicalDirectory = directory.getCanonicalFile();
            if (!canonicalDirectory.equals(new File(canonicalRoot, name))) continue;
            try { validateCleanupTree(canonicalDirectory); deleteTree(canonicalDirectory, canonicalRoot); }
            catch (IOException error) { System.err.println("中断的资源准备目录保留供检查：" + name + "：" + error.getMessage()); }
        }
    }
    private static boolean ownStageName(String name) {
        if (!name.startsWith(".stage-") || name.length() < 45) return false;
        int separator = name.length() - 37;
        if (name.charAt(separator) != '-') return false;
        String id = name.substring(7, separator), uuid = name.substring(separator + 1);
        return id.matches("[A-Za-z0-9._-]{1,128}") && !id.equals(".") && !id.equals("..")
                && uuid.matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}");
    }

    static void validatePath(String path) throws IOException {
        if (path.isEmpty() || path.length() > 1024 || path.startsWith("/") || path.indexOf('\\') >= 0 || path.indexOf(':') >= 0 || path.indexOf('\0') >= 0) throw new IOException("非法资源路径");
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IOException("非法资源路径");
        }
        if (path.equals(".verified") || path.equals(".bundle.zip")) throw new IOException("资源使用了保留文件名");
    }

    /** ZipEntry 不暴露 Unix 外部属性；独立检查中央目录以拒绝符号链接。 */
    static void validateCentralDirectory(File archive) throws IOException {
        try (RandomAccessFile file = new RandomAccessFile(archive, "r")) {
            long length = file.length();
            if (length < 22) throw new IOException("无效的 ZIP 资源包");
            int tailLength = (int) Math.min(length, 65557);
            byte[] tail = new byte[tailLength];
            file.seek(length - tailLength); file.readFully(tail);
            int end = -1;
            for (int i = tail.length - 22; i >= 0; i--) {
                if (uint(tail, i) == 0x06054b50L && i + 22 + ushort(tail, i + 20) == tail.length) { end = i; break; }
            }
            if (end < 0 || ushort(tail, end + 4) != 0 || ushort(tail, end + 6) != 0) throw new IOException("不支持的 ZIP 格式");
            int count = ushort(tail, end + 10);
            long size = uint(tail, end + 12), offset = uint(tail, end + 16);
            if (count == 65535 || count > 30000 || count != ushort(tail, end + 8) || offset + size > length - tailLength + end) throw new IOException("ZIP 中央目录异常");
            file.seek(offset);
            long directoryEnd = offset + size;
            Set<String> names = new HashSet<>();
            for (int i = 0; i < count; i++) {
                byte[] header = new byte[46]; file.readFully(header);
                if (uint(header, 0) != 0x02014b50L || (ushort(header, 8) & 1) != 0) throw new IOException("不支持的 ZIP 文件条目");
                int unixType = ((int) (uint(header, 38) >>> 16)) & 0170000;
                if (unixType != 0 && unixType != 0100000 && unixType != 0040000) throw new IOException("资源包不能包含符号链接或特殊文件");
                int nameLength = ushort(header, 28), extra = ushort(header, 30), comment = ushort(header, 32);
                if (nameLength == 0 || nameLength > 4096 || file.getFilePointer() + nameLength + extra + comment > directoryEnd) throw new IOException("ZIP 条目长度异常");
                byte[] nameBytes = new byte[nameLength]; file.readFully(nameBytes);
                if ((ushort(header, 8) & 0x800) == 0) {
                    for (byte value : nameBytes) if (value < 0) throw new IOException("非 ASCII 资源名必须声明 UTF-8 编码");
                }
                String name = StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(nameBytes)).toString();
                validatePath(name.endsWith("/") ? name.substring(0, name.length() - 1) : name);
                if (!names.add(name)) throw new IOException("ZIP 存在重复资源");
                file.seek(file.getFilePointer() + extra + comment);
            }
            if (file.getFilePointer() != directoryEnd) throw new IOException("ZIP 中央目录长度不一致");
        }
    }

    static byte[] readBounded(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        copyBounded(input, output, limit);
        return output.toByteArray();
    }
    private static void copyBounded(InputStream input, OutputStream output, long limit) throws IOException {
        byte[] buffer = new byte[65536]; long count = 0; int n;
        while ((n = input.read(buffer)) != -1) {
            checkInterrupted(); count += n;
            if (count > limit) throw new IOException("文件超过允许的大小");
            output.write(buffer, 0, n);
        }
    }
    private static void checkInterrupted() throws IOException { if (Thread.currentThread().isInterrupted()) throw new IOException("资源准备已取消"); }
    private static void mkdir(File directory) throws IOException { if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建资源目录"); }
    private static void writeSynced(File file, String text) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(text.getBytes(StandardCharsets.UTF_8)); output.getFD().sync(); }
    }
    private static void deleteTree(File file, File root) throws IOException {
        if (!file.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) throw new IOException("临时资源清理路径越界");
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("无法读取临时资源目录");
            for (File child : children) deleteTree(child, root);
        }
        if (!file.delete()) throw new IOException("无法清理临时资源：" + file.getName());
    }
    private static int ushort(byte[] bytes, int offset) { return (bytes[offset] & 255) | ((bytes[offset + 1] & 255) << 8); }
    private static long uint(byte[] bytes, int offset) { return (ushort(bytes, offset) | ((long) ushort(bytes, offset + 2) << 16)) & 0xffffffffL; }
    static String hex(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) hex.append(Character.forDigit((b >>> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
        return hex.toString();
    }
}
