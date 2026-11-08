import SwiftUI

extension Color {
    /// An opaque colour from a `0xRRGGBB` literal.
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Brand and semantic colours from the PWA's `theme.ts` / `tokens.ts`, ported by
/// hand since the two apps share no token source. Each resolves per colour
/// scheme the way Mantine's `light-dark(...)` does on the web; dark is primary.
enum NestColor {
    /// Page canvas (`dark-7` / white).
    static let background = Color(light: .white, dark: Color(hex: 0x0B0F14))
    /// Elevated default surface — cards, inputs (`dark-6`).
    static let surface = Color(light: Color(hex: 0xF8F9FA), dark: Color(hex: 0x141A21))
    /// One step above `surface` (`dark-5`).
    static let surfaceRaised = Color(light: Color(hex: 0xF1F3F5), dark: Color(hex: 0x1B232C))
    /// Subtle borders and dividers (`dark-4`).
    static let border = Color(light: Color(hex: 0xDEE2E6), dark: Color(hex: 0x26303A))
    static let text = Color(light: Color(hex: 0x1A1B1E), dark: Color(hex: 0xE6EDF3))
    static let dimmedText = Color(light: Color(hex: 0x6B7280), dark: Color(hex: 0x8B99A6))
    /// Brand accent (electric lime, shade 5) — `autoContrast` pairs it with
    /// black text on both schemes.
    static let brand = Color(hex: 0xB6F400)
    static let onBrand = Color.black
    /// Restores the mark's near-black canvas behind it in light mode only.
    static let markTile = Color(light: Color(hex: 0x141A21), dark: .clear)

    /// Money-up green (shade 7 on light, 4 on dark, clearing WCAG AA).
    static let positive = Color(light: Color(hex: 0x0D8748), dark: Color(hex: 0x4BE195))
    /// Money-down magenta-red.
    static let negative = Color(light: Color(hex: 0xD01840), dark: Color(hex: 0xFF5C7B))
    static let warning = Color(light: Color(hex: 0xB57109), dark: Color(hex: 0xF5A524))
    static let info = Color(light: Color(hex: 0x0894AB), dark: Color(hex: 0x22D3EE))
}

/// The PWA's categorical chart hues (`chartColors` in `tokens.ts`): a deeper
/// shade on light, a vivid one on dark.
enum ChartColorKey: String, CaseIterable, Sendable {
    case needs, wants, discretionary, temporary, savings, investments, buffer, tax, sacrifice

    var color: Color {
        switch self {
        case .needs: Color(light: Color(hex: 0x4C6EF5), dark: Color(hex: 0x5C7CFA))
        case .wants: Color(light: Color(hex: 0x7950F2), dark: Color(hex: 0x845EF7))
        case .discretionary: Color(light: Color(hex: 0xE64980), dark: Color(hex: 0xF06595))
        case .temporary: Color(light: Color(hex: 0xF76707), dark: Color(hex: 0xFF922B))
        case .savings: Color(light: Color(hex: 0x0CA678), dark: Color(hex: 0x20C997))
        case .investments: Color(light: Color(hex: 0x1098AD), dark: Color(hex: 0x22B8CF))
        case .buffer: Color(light: Color(hex: 0x868E96), dark: Color(hex: 0xADB5BD))
        case .tax: Color(hex: 0xED2F52)
        case .sacrifice: Color(light: Color(hex: 0x89B800), dark: NestColor.brand)
        }
    }

    /// The six budget groups in plot order, for a multi-series chart.
    static let budgetGroups: [ChartColorKey] = [
        .needs, .wants, .discretionary, .temporary, .savings, .investments,
    ]
}

/// Spacing scale in points (`xxs` mirrors the theme's sub-`xs` step).
enum NestSpacing {
    static let xxs: CGFloat = 4
    static let xs: CGFloat = 8
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    static let lg: CGFloat = 20
    static let xl: CGFloat = 32
}

/// Corner radii in points, matching the theme's `radius` scale.
enum NestRadius {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 10
    static let lg: CGFloat = 14
    static let xl: CGFloat = 20
}

/// Type scale. Headings use the rounded system design (Space Grotesk is not
/// bundled); money figures take tabular digits via `monospacedDigit()`.
enum NestFont {
    static let display = Font.system(size: 34, weight: .bold, design: .rounded)
    static let title = Font.system(size: 22, weight: .bold, design: .rounded)
    static let heading = Font.system(size: 17, weight: .semibold, design: .rounded)
    static let body = Font.system(size: 15)
    static let caption = Font.system(size: 12)
}
