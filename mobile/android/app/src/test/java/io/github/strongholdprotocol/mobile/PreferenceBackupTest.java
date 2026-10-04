package io.github.strongholdprotocol.mobile;

import org.json.*;
import org.junit.Test;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public final class PreferenceBackupTest {
    @Test public void roundTripsAllowedSettingsAsRawStorageValues() throws Exception {
        JSONObject preferences = new JSONObject().put("sp.name", "测试玩家")
                .put("sp.pref.settings", "{\"volume\":0.5}").put("sp.pref.loadout", "[\"char_123\"]");
        JSONObject restored = PreferenceBackup.parse(PreferenceBackup.export(preferences, "0.1.2").getBytes(StandardCharsets.UTF_8));
        assertEquals(preferences.toString(), restored.toString());
    }
    @Test public void refusesTokensUnsupportedSchemaAndNonJsonPreferences() throws Exception {
        JSONObject preferences = new JSONObject().put("sp.token", "sensitive");
        assertThrows(IOException.class, () -> PreferenceBackup.export(preferences, "0.1.2"));
        String unsupported = "{\"schema\":2,\"gameVersion\":\"0.1.2\",\"preferences\":{}}";
        assertThrows(IOException.class, () -> PreferenceBackup.parse(unsupported.getBytes(StandardCharsets.UTF_8)));
        assertThrows(IOException.class, () -> PreferenceBackup.export(new JSONObject().put("sp.pref.settings", "true"), "0.1.2"));
        assertThrows(IOException.class, () -> PreferenceBackup.export(new JSONObject().put("sp.pref.loadout", "{} extra"), "0.1.2"));
    }
    @Test public void refusesOversizedInput() {
        assertThrows(IOException.class, () -> PreferenceBackup.parse(new byte[PreferenceBackup.MAX_BYTES + 1]));
    }
}
