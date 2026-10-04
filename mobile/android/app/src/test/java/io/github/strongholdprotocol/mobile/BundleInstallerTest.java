package io.github.strongholdprotocol.mobile;

import org.json.*;
import org.junit.*;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import static org.junit.Assert.*;

public final class BundleInstallerTest {
    @Rule public final TemporaryFolder temp = new TemporaryFolder();
    private static final String COMMIT = "9d404199df76f862eff7385b82f952ab0498f4c5";

    private static byte[] zip(Map<String, String> files) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (Map.Entry<String, String> file : files.entrySet()) {
                zip.putNextEntry(new ZipEntry(file.getKey()));
                zip.write(file.getValue().getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
    private static byte[] manifest(String id, Map<String, String> files) throws Exception {
        JSONArray list = new JSONArray();
        for (Map.Entry<String, String> file : files.entrySet()) {
            byte[] bytes = file.getValue().getBytes(StandardCharsets.UTF_8);
            list.put(new JSONObject().put("path", file.getKey()).put("size", bytes.length)
                    .put("sha256", BundleInstaller.hex(MessageDigest.getInstance("SHA-256").digest(bytes))));
        }
        return new JSONObject().put("schema", 1).put("bundleId", id).put("gameVersion", "0.1.2").put("upstreamCommit", COMMIT).put("files", list).toString().getBytes(StandardCharsets.UTF_8);
    }
    private static BundleInstaller.Assets assets(byte[] manifest, byte[] zip) {
        return name -> new ByteArrayInputStream(name.equals("game-manifest.json") ? manifest : zip);
    }

    @Test public void installsVerifiedBundleAndReusesItWithoutReadingZip() throws Exception {
        Map<String, String> entries = Collections.singletonMap("public/index.html", "游戏完整页面");
        File files = temp.newFolder();
        byte[] manifest = manifest("bundle-a", entries);
        File result = BundleInstaller.install(files, assets(manifest, zip(entries)), "0.1.2");
        assertEquals("游戏完整页面", new String(Files.readAllBytes(new File(result, "public/index.html").toPath()), StandardCharsets.UTF_8));
        assertEquals("bundle-a", new String(Files.readAllBytes(new File(files, "bundles/active").toPath()), StandardCharsets.UTF_8));
        assertEquals(result, BundleInstaller.install(files, name -> {
            if (!name.equals("game-manifest.json")) throw new IOException("verified bundle should not extract again");
            return new ByteArrayInputStream(manifest);
        }, "0.1.2"));
    }
    @Test public void corruptUpdatePreservesPreviousBundleAndActiveMarker() throws Exception {
        File files = temp.newFolder();
        Map<String, String> good = Collections.singletonMap("public/index.html", "good");
        File old = BundleInstaller.install(files, assets(manifest("old", good), zip(good)), "0.1.2");
        Map<String, String> corrupt = Collections.singletonMap("public/index.html", "evil");
        assertThrows(IOException.class, () -> BundleInstaller.install(files, assets(manifest("new", good), zip(corrupt)), "0.1.2"));
        assertTrue(new File(old, "public/index.html").isFile());
        assertFalse(new File(files, "bundles/new").exists());
        assertEquals("old", new String(Files.readAllBytes(new File(files, "bundles/active").toPath()), StandardCharsets.UTF_8));
        assertFalse(Arrays.stream(new File(files, "bundles").list()).anyMatch(name -> name.startsWith(".stage-")));
    }
    @Test public void rejectsTraversalAndUnknownEntries() throws Exception {
        Map<String, String> entries = Collections.singletonMap("public/index.html", "good");
        Map<String, String> traversal = Collections.singletonMap("../escaped", "bad");
        assertThrows(IOException.class, () -> BundleInstaller.Manifest.parse(manifest("a", traversal)));
        assertThrows(IOException.class, () -> BundleInstaller.install(temp.newFolder(), assets(manifest("b", entries), zip(traversal)), "0.1.2"));
        Map<String, String> unknown = new LinkedHashMap<>(entries); unknown.put("server/unlisted.js", "bad");
        assertThrows(IOException.class, () -> BundleInstaller.install(temp.newFolder(), assets(manifest("c", entries), zip(unknown)), "0.1.2"));
    }
    @Test public void rejectsZipSymlinkMetadata() throws Exception {
        byte[] zip = zip(Collections.singletonMap("public/index.html", "good"));
        for (int i = 0; i + 46 < zip.length; i++) {
            if (zip[i] == 0x50 && zip[i + 1] == 0x4b && zip[i + 2] == 0x01 && zip[i + 3] == 0x02) {
                zip[i + 5] = 3;
                int mode = 0120777;
                zip[i + 40] = (byte) mode; zip[i + 41] = (byte) (mode >>> 8);
                break;
            }
        }
        File archive = temp.newFile(); Files.write(archive.toPath(), zip);
        assertThrows(IOException.class, () -> BundleInstaller.validateCentralDirectory(archive));
    }
    @Test public void requiresExactIntegerSchemaAndSizes() throws Exception {
        byte[] original = manifest("a", Collections.singletonMap("public/index.html", "good"));
        JSONObject object = new JSONObject(new String(original, StandardCharsets.UTF_8));
        object.put("schema", 1.5);
        assertThrows(IOException.class, () -> BundleInstaller.Manifest.parse(object.toString().getBytes(StandardCharsets.UTF_8)));
        object.put("schema", 1); object.getJSONArray("files").getJSONObject(0).put("size", 4.5);
        assertThrows(IOException.class, () -> BundleInstaller.Manifest.parse(object.toString().getBytes(StandardCharsets.UTF_8)));
    }
    @Test public void thirdUpgradeKeepsOnlyCurrentAndPreviousVerifiedBundles() throws Exception {
        File files = new File(temp.newFolder(), ".");
        Map<String, String> entries = Collections.singletonMap("public/index.html", "good");
        File first = BundleInstaller.install(files, assets(manifest("first", entries), zip(entries)), "0.1.2");
        File second = BundleInstaller.install(files, assets(manifest("second", entries), zip(entries)), "0.1.2");
        File unknown = new File(files, "bundles/unknown"); assertTrue(unknown.mkdir());
        Files.write(new File(unknown, "keep.txt").toPath(), "user data".getBytes(StandardCharsets.UTF_8));
        File third = BundleInstaller.install(files, assets(manifest("third", entries), zip(entries)), "0.1.2");
        assertFalse(first.exists()); assertTrue(second.exists()); assertTrue(third.exists());
        assertTrue(new File(unknown, "keep.txt").isFile());
        Map<String, String> corrupt = Collections.singletonMap("public/index.html", "evil");
        assertThrows(IOException.class, () -> BundleInstaller.install(files, assets(manifest("fourth", entries), zip(corrupt)), "0.1.2"));
        assertTrue(second.exists()); assertTrue(third.exists()); assertFalse(new File(files, "bundles/fourth").exists());
        assertEquals("third", new String(Files.readAllBytes(new File(files, "bundles/active").toPath()), StandardCharsets.UTF_8));
    }
    @Test public void cachedRollbackUpdatesActiveAndKeepsRealPreviousVersion() throws Exception {
        File files = temp.newFolder();
        Map<String, String> entries = Collections.singletonMap("public/index.html", "good");
        byte[] firstManifest = manifest("first", entries);
        BundleInstaller.install(files, assets(firstManifest, zip(entries)), "0.1.2");
        File second = BundleInstaller.install(files, assets(manifest("second", entries), zip(entries)), "0.1.2");
        BundleInstaller.Assets firstCached = name -> {
            if (!name.equals("game-manifest.json")) throw new IOException("cached rollback must not extract again");
            return new ByteArrayInputStream(firstManifest);
        };
        File first = BundleInstaller.install(files, firstCached, "0.1.2");
        BundleInstaller.install(files, firstCached, "0.1.2");
        assertEquals("first", new String(Files.readAllBytes(new File(files, "bundles/active").toPath()), StandardCharsets.UTF_8));
        assertEquals("second", new String(Files.readAllBytes(new File(files, "bundles/active.bak").toPath()), StandardCharsets.UTF_8));
        BundleInstaller.install(files, assets(manifest("third", entries), zip(entries)), "0.1.2");
        assertTrue(first.exists()); assertFalse(second.exists());
    }
    @Test public void interruptedActiveSwitchRetainsLastActiveBackup() throws Exception {
        File files = temp.newFolder();
        Map<String, String> entries = Collections.singletonMap("public/index.html", "good");
        File first = BundleInstaller.install(files, assets(manifest("first", entries), zip(entries)), "0.1.2");
        File root = new File(files, "bundles");
        assertTrue(new File(root, "active").renameTo(new File(root, "active.bak")));
        BundleInstaller.install(files, assets(manifest("second", entries), zip(entries)), "0.1.2");
        assertTrue(first.exists());
        assertEquals("first", new String(Files.readAllBytes(new File(root, "active.bak").toPath()), StandardCharsets.UTF_8));
    }
    @Test public void cleansOnlyOwnInterruptedStagesEvenWhenReusingInstalledBundle() throws Exception {
        File files = new File(temp.newFolder(), ".");
        File root = new File(files, "bundles"); assertTrue(root.mkdir());
        File stale = new File(root, ".stage-old-12345678-1234-4abc-8def-123456789abc"); assertTrue(stale.mkdir());
        Files.write(new File(stale, ".bundle.zip").toPath(), new byte[]{1, 2, 3});
        String[] unknownNames = {".stage-user-backup", ".stage-old-12345678-1234-1abc-8def-123456789abc", ".stage-.-12345678-1234-4abc-8def-123456789abc"};
        for (String name : unknownNames) {
            File unknown = new File(root, name); assertTrue(unknown.mkdir());
            Files.write(new File(unknown, "keep.txt").toPath(), new byte[]{4, 5, 6});
        }
        Map<String, String> entries = Collections.singletonMap("public/index.html", "good");
        byte[] manifest = manifest("current", entries);
        BundleInstaller.install(files, assets(manifest, zip(entries)), "0.1.2");
        assertFalse(stale.exists());
        for (String name : unknownNames) assertTrue(new File(root, name + "/keep.txt").isFile());
        File nextStale = new File(root, ".stage-current-22222222-2222-4222-9222-222222222222"); assertTrue(nextStale.mkdir());
        BundleInstaller.install(files, name -> {
            if (!name.equals("game-manifest.json")) throw new IOException("installed bundle must be reused");
            return new ByteArrayInputStream(manifest);
        }, "0.1.2");
        assertFalse(nextStale.exists());
        for (String name : unknownNames) assertTrue(new File(root, name + "/keep.txt").isFile());
    }
}
