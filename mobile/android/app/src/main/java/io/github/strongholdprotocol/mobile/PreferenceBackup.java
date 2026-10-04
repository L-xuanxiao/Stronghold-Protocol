package io.github.strongholdprotocol.mobile;

import org.json.JSONObject;
import org.json.JSONTokener;
import org.json.JSONArray;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/** 备份只包含昵称、设置、调配；不读取联机身份或重连令牌。 */
final class PreferenceBackup {
    static final int MAX_BYTES = 2 * 1024 * 1024;
    static final String[] KEYS = {"sp.name", "sp.pref.settings", "sp.pref.loadout"};
    private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(KEYS));

    static String export(JSONObject webStorage, String gameVersion) throws Exception {
        validatePreferences(webStorage);
        return new JSONObject().put("schema", 1).put("gameVersion", gameVersion).put("preferences", webStorage).toString(2);
    }
    static JSONObject parse(byte[] bytes) throws Exception {
        if (bytes.length > MAX_BYTES) throw new IOException("备份文件超过 2 MB");
        JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        Iterator<String> keys = root.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.equals("schema") && !key.equals("gameVersion") && !key.equals("preferences")) throw new IOException("备份包含不支持的字段");
        }
        Object schema = root.get("schema");
        if (!(schema instanceof Number) || ((Number) schema).doubleValue() != 1) throw new IOException("不支持的备份版本");
        if (!root.getString("gameVersion").matches("[A-Za-z0-9._+-]{1,64}")) throw new IOException("备份的游戏版本无效");
        JSONObject preferences = root.getJSONObject("preferences");
        validatePreferences(preferences);
        return preferences;
    }
    private static void validatePreferences(JSONObject preferences) throws Exception {
        if (preferences.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("备份内容过大");
        Iterator<String> keys = preferences.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!ALLOWED.contains(key) || !(preferences.get(key) instanceof String)) throw new IOException("备份包含非设置数据");
            String value = preferences.getString(key);
            int size = value.getBytes(StandardCharsets.UTF_8).length;
            if (value.indexOf('\0') >= 0) throw new IOException("备份内容无效");
            if (key.equals("sp.name")) {
                if (size > 256) throw new IOException("昵称过长");
            } else {
                if (size > (key.equals("sp.pref.settings") ? 65536 : 1024 * 1024)) throw new IOException("设置或调配数据过大");
                JSONTokener parser = new JSONTokener(value);
                Object parsed = parser.nextValue();
                if (!(parsed instanceof JSONObject) && !(parsed instanceof JSONArray)) throw new IOException("设置或调配格式无效");
                if (parser.nextClean() != 0) throw new IOException("设置或调配包含多余内容");
            }
        }
    }
}
