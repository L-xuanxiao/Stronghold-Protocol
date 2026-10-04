package io.github.strongholdprotocol.mobile;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** CSS 内置 SVG、图片和音频也会进入资源拦截；仅允许非导航的静态内联数据。 */
final class WebResourcePolicy {
    private static final Set<String> INLINE_MIME = new HashSet<>(Arrays.asList(
            "image/svg+xml", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon",
            "audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/webm", "audio/aac", "audio/mp4",
            "font/woff", "font/woff2", "font/ttf", "font/otf", "application/font-woff", "application/x-font-ttf", "application/x-font-opentype"));
    static boolean inlineResource(String url, boolean mainFrame) {
        if (mainFrame || url == null) return false;
        if (url.startsWith("blob:http://127.0.0.1:32173/")) return true;
        if (!url.regionMatches(true, 0, "data:", 0, 5)) return false;
        int comma = url.indexOf(',', 5);
        if (comma < 0) return false;
        int semicolon = url.indexOf(';', 5);
        int end = semicolon >= 0 && semicolon < comma ? semicolon : comma;
        if (end - 5 > 80) return false;
        return INLINE_MIME.contains(url.substring(5, end).toLowerCase(Locale.ROOT));
    }
}
