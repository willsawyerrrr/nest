import AppKit
import SwiftUI

extension Color {
    /// A colour that resolves to `light` or `dark` by the active colour scheme.
    init(light: Color, dark: Color) {
        self.init(
            nsColor: NSColor(name: nil) {
                $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light)
            })
    }
}
