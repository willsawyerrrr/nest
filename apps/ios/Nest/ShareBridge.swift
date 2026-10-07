import Foundation

/// Builds the JavaScript that hands a shared file to the page, and reads the
/// page's acknowledgement. The page installs `window.__nestShare` (see the PWA's
/// `lib/nativeShare.ts`); this side only ever calls it.
///
/// A file crosses as separately encoded base64 chunks, so no single script
/// holds more than `chunkBytes` of it.
enum ShareBridge {
    /// Raw bytes read per chunk.
    static let chunkBytes = 384 * 1024

    static let readyScript = "!!(window.__nestShare && window.__nestShare.begin);"

    static func beginScript(id: String, name: String, mimeType: String) -> String {
        "window.__nestShare.begin(\(SessionBridge.jsString(id)), "
            + "\(SessionBridge.jsString(name)), \(SessionBridge.jsString(mimeType))); true;"
    }

    static func chunkScript(id: String, base64: String) -> String {
        "window.__nestShare.chunk(\(SessionBridge.jsString(id)), "
            + "\(SessionBridge.jsString(base64))); true;"
    }

    static func finishScript(id: String) -> String {
        "window.__nestShare.finish(\(SessionBridge.jsString(id))); true;"
    }

    /// Ids the page reports as queued, from its `nestShare` message. Anything
    /// else in the body is ignored.
    static func queuedIDs(from body: Any) -> [String] {
        guard
            let message = body as? [String: Any],
            message["type"] as? String == "queued",
            let ids = message["ids"] as? [String]
        else {
            return []
        }
        return ids.filter(ShareInbox.isValidID)
    }
}
