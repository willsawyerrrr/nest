import SwiftUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

/// The page scaffold the PWA's `PageSection` draws: a display title, dimmed intro
/// and the body, on a scrolling canvas.
struct TaxPage<Content: View>: View {
    let title: String
    var intro: String?
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                    Text(title)
                        .font(NestFont.display).tracking(-0.7)
                        .foregroundStyle(NestColor.text)
                        .accessibilityAddTraits(.isHeader)
                    if let intro {
                        Text(intro).font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                    }
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(NestSpacing.md)
        }
    }
}

/// A card at the theme's `md` padding, as the PWA's per-member cards use.
struct TaxCard<Content: View>: View {
    var padding: CGFloat = NestSpacing.md
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                NestColor.surface,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    .strokeBorder(NestColor.border, lineWidth: 1))
    }
}

/// Dimmed extra-small copy.
struct TaxCaption: View {
    let text: String
    var italic = false

    init(_ text: String, italic: Bool = false) {
        self.text = text
        self.italic = italic
    }

    var body: some View {
        Text(text)
            .font(.system(size: 12)).italic(italic)
            .foregroundStyle(NestColor.dimmedText)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A small-size section heading (`Title order={3} size="h6"`).
struct TaxSubtitle: View {
    let text: String
    var size: CGFloat = 14

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .bold, design: .rounded))
            .foregroundStyle(NestColor.text)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A dimmed label over its money figure, right-aligned, for a dense figure list.
struct FigureLine: View {
    let label: String
    let cents: Int
    var bold: Int?
    var colouring = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: NestSpacing.xs) {
            Text(label).foregroundStyle(NestColor.dimmedText)
                .fontWeight(weight)
            Spacer(minLength: NestSpacing.xs)
            MoneyText(cents: cents, colouring: colouring).fontWeight(weight)
        }
        .font(.system(size: 14))
        .accessibilityElement(children: .combine)
    }

    private var weight: Font.Weight? {
        switch bold {
        case 700: .bold
        case 600: .semibold
        default: nil
        }
    }
}

/// Opt-in content behind a borderless, collapsed-by-default toggle.
struct Disclosure<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content
    @State private var isOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { isOpen.toggle() }
            } label: {
                HStack {
                    Text(label).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text)
                    Spacer()
                    Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .padding(.vertical, NestSpacing.xs)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
            if isOpen {
                content.padding(.top, NestSpacing.xxs)
            }
        }
    }
}

/// A brand-accented panel framing an interactive what-if tool.
struct WhatIfPanel<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            HStack(spacing: NestSpacing.xs) {
                NestPill(text: "What-if", tone: .brand)
                Text(title).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text)
            }
            content
        }
        .padding(NestSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NestColor.brand.opacity(0.1))
        .overlay(alignment: .leading) { NestColor.brand.frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// A tinted alert with small copy (`Alert variant="light" p="xs"`).
struct TaxAlert: View {
    let text: String
    var tone: NestPill.Tone = .negative

    var body: some View {
        Text(text).font(.system(size: 12)).foregroundStyle(NestColor.text)
            .padding(NestSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                tone.color.opacity(0.14),
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// A labelled input on the elevated surface.
struct TaxField<Field: View>: View {
    let label: String
    @ViewBuilder var field: Field

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            field
        }
    }
}

/// A whole-number input (dependent children).
struct CountField: View {
    let label: String
    @Binding var value: Int
    @State private var text = ""

    var body: some View {
        TaxField(label: label) {
            TextField("0", text: $text)
                .textFieldStyle(NestTextFieldStyle())
                #if os(iOS)
                    .keyboardType(.numberPad)
                #endif
                .onAppear { text = String(value) }
                .onChange(of: text) { _, new in
                    let digits = new.filter(\.isNumber)
                    if digits != new { text = digits }
                    value = Int(digits) ?? 0
                }
        }
    }
}

/// A dollar input with a `$` prefix, reporting integer cents.
struct DollarField: View {
    let label: String
    @Binding var cents: Int
    @State private var text = ""

    var body: some View {
        TaxField(label: label) {
            HStack(spacing: NestSpacing.xxs) {
                Text("$").foregroundStyle(NestColor.dimmedText)
                TextField("0.00", text: $text)
                    #if os(iOS)
                        .keyboardType(.decimalPad)
                    #endif
                    .onChange(of: text) { _, new in cents = Self.cents(from: new) }
            }
            .font(NestFont.body)
            .padding(NestSpacing.sm)
            .background(
                NestColor.surface,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    .strokeBorder(NestColor.border, lineWidth: 1))
        }
    }

    /// Integer cents from typed dollars; anything unreadable or negative reads as nil.
    static func cents(from text: String) -> Int {
        let cleaned = text.filter { $0.isNumber || $0 == "." }
        guard let dollars = Double(cleaned), dollars > 0 else { return 0 }
        return Int((dollars * 100).rounded())
    }
}

/// The FY picker, offering every financial year with a published tax config.
struct FinancialYearSelect: View {
    let financialYear: Int
    let availableFinancialYears: [Int]
    let onChange: (Int) -> Void

    var body: some View {
        TaxField(label: "Financial year") {
            Menu {
                ForEach(availableFinancialYears, id: \.self) { year in
                    Button("FY\(year)") { onChange(year) }
                }
            } label: {
                HStack {
                    Text("FY\(financialYear)").foregroundStyle(NestColor.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .font(NestFont.body)
                .padding(NestSpacing.sm)
                .frame(width: 160)
                .background(
                    NestColor.surface,
                    in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Financial year")
        }
    }
}

/// A brand-tinted button (`variant="light"`).
struct NestLightButtonStyle: ButtonStyle {
    var small = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: small ? 12 : 14, weight: .semibold))
            .foregroundStyle(NestColor.brand)
            .padding(.horizontal, small ? NestSpacing.sm : NestSpacing.md)
            .padding(.vertical, small ? 6 : NestSpacing.xs)
            .frame(maxWidth: small ? nil : .infinity)
            .background(
                NestColor.brand.opacity(0.15),
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A flat destructive button (`variant="subtle" color="red"`).
struct NestSubtleDangerButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(NestColor.negative)
            .padding(.horizontal, NestSpacing.sm)
            .padding(.vertical, 6)
            .background(
                configuration.isPressed ? NestColor.negative.opacity(0.12) : .clear,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// Puts `text` on the system pasteboard.
func copyToPasteboard(_ text: String) {
    #if canImport(UIKit)
        UIPasteboard.general.string = text
    #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    #endif
}
