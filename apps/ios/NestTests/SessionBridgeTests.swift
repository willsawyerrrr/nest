import Foundation
import Testing

@testable import Nest

@Suite struct SessionBridgeTests {
    @Test func flagScriptSetsTheShellMarker() {
        #expect(SessionBridge.shellFlagScript == "window.__NEST_NATIVE_SHELL__ = true;")
    }

    @Test func applyScriptPushesBothTokens() {
        let script = SessionBridge.applySessionScript(
            accessToken: "access-123", refreshToken: "refresh-456"
        )

        #expect(
            script == #"window.__nestApplySession && window.__nestApplySession("access-123", "refresh-456");"#
        )
    }

    @Test func clearScriptClearsThePageSession() {
        #expect(
            SessionBridge.clearSessionScript
                == "window.__nestClearSession && window.__nestClearSession();"
        )
    }

    @Test func jsStringEscapesQuotesBackslashesAndControlCharacters() {
        #expect(SessionBridge.jsString(#"a"b"#) == #""a\"b""#)
        #expect(SessionBridge.jsString(#"a\b"#) == #""a\\b""#)
        #expect(SessionBridge.jsString("a\nb") == #""a\nb""#)
    }

    @Test func jsStringWrapsAPlainValueInQuotes() {
        #expect(SessionBridge.jsString("plain") == #""plain""#)
    }
}
