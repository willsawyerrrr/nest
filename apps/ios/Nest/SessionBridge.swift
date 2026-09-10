import Foundation

/// Builds the JavaScript the shell injects into the web view to mirror the
/// native Supabase session. The page installs `window.__nestApplySession` /
/// `window.__nestClearSession` (see the PWA's `lib/nativeAuthBridge.ts`); this
/// side only ever calls them.
enum SessionBridge {
    /// Sets `window.__NEST_NATIVE_SHELL__` before any of the PWA's code runs, so
    /// every shell-only branch in the web app is live for this web view and no
    /// other client.
    static let shellFlagScript = "window.__NEST_NATIVE_SHELL__ = true;"

    /// Clears the page's session, run when the native session goes.
    static let clearSessionScript = "window.__nestClearSession && window.__nestClearSession();"

    /// Pushes a session's tokens into the page.
    static func applySessionScript(accessToken: String, refreshToken: String) -> String {
        "window.__nestApplySession && window.__nestApplySession("
            + "\(jsString(accessToken)), \(jsString(refreshToken)));"
    }

    /// A string as a safe JavaScript string literal (quoted, with `"`, `\`, and
    /// control characters escaped).
    static func jsString(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: value, options: [.fragmentsAllowed]
            ),
            let literal = String(data: data, encoding: .utf8)
        else {
            return "\"\""
        }
        return literal
    }
}
