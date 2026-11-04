import SwiftUI
import UIKit

extension Color {
    /// A colour that resolves to `light` or `dark` by the active colour scheme.
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }
}
