package io.github.strongholdprotocol.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public final class WebResourcePolicyTest {
    @Test public void permitsGameInlineSvgImagesAudioAndFonts() {
        assertTrue(WebResourcePolicy.inlineResource("data:image/svg+xml;utf8,<svg></svg>", false));
        assertTrue(WebResourcePolicy.inlineResource("data:image/png;base64,AA==", false));
        assertTrue(WebResourcePolicy.inlineResource("data:audio/ogg;base64,AA==", false));
        assertTrue(WebResourcePolicy.inlineResource("data:font/woff2;base64,AA==", false));
        assertTrue(WebResourcePolicy.inlineResource("blob:http://127.0.0.1:32173/example", false));
    }
    @Test public void refusesInlineDocumentScriptAndEveryMainFrame() {
        assertFalse(WebResourcePolicy.inlineResource("data:text/html,<script>bad()</script>", false));
        assertFalse(WebResourcePolicy.inlineResource("data:application/javascript,bad()", false));
        assertFalse(WebResourcePolicy.inlineResource("data:image/svg+xml,<svg></svg>", true));
        assertFalse(WebResourcePolicy.inlineResource("blob:http://127.0.0.1:32173/example", true));
    }
    @Test public void refusesExternalOrMalformedInlineSources() {
        assertFalse(WebResourcePolicy.inlineResource("https://external.test/picture.png", false));
        assertFalse(WebResourcePolicy.inlineResource("blob:https://external.test/picture", false));
        assertFalse(WebResourcePolicy.inlineResource("data:image/png;base64", false));
        assertFalse(WebResourcePolicy.inlineResource("data:image/png text/html,payload", false));
    }
}
