import AppKit

extension AuthModel {
    /// The key window, for Google Sign-In to present from.
    static func presenter() -> NSWindow? {
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first
    }
}
