import SwiftUI

/// The Gifts screen's building blocks, drawn to match the PWA's Mantine
/// components (`GiftRowParts`, `ListRow`, `AddButton`, `SegmentedControl`).

/// A section title: the PWA's `Title order={3} size="h5"`.
struct GiftTitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .foregroundStyle(NestColor.text)
    }
}

/// A dimmed `Text size="xs"` line.
struct GiftCaption: View {
    let text: String

    var body: some View {
        Text(text).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
    }
}

/// The disclosure idiom: a chevron before a header that toggles its body.
struct GiftDisclosure<Header: View, Body: View>: View {
    @Binding var isOpen: Bool
    @ViewBuilder var header: Header
    @ViewBuilder var content: Body

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.sm) {
            Button {
                isOpen.toggle()
            } label: {
                header.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
            if isOpen { content }
        }
    }
}

/// A chevron and a title, with an optional trailing date.
struct GiftHeaderTitle: View {
    let title: String
    var date: String?
    let isOpen: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.text)
                .frame(width: 18)
            GiftTitle(text: title).lineLimit(1)
            if let date { GiftCaption(text: GiftsPresentation.date(date)).lineSpacing(0) }
        }
    }
}

/// Budget / spent / left with a spend bar. With `budgetOnly` only the budget
/// shows, so a gift for the signed-in member spoils nothing.
struct GiftMoneyBar: View {
    let totals: GiftTotals
    let label: String
    var budgetOnly = false

    var body: some View {
        if budgetOnly {
            GiftCaption(text: "Budget \(MoneyFormat.cents(totals.budgetedCents))")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: NestSpacing.md) {
                    GiftCaption(text: "Budget \(MoneyFormat.cents(totals.budgetedCents))")
                    GiftCaption(text: "Spent \(MoneyFormat.cents(totals.spentCents))")
                    Text("Left \(MoneyFormat.cents(totals.remainingCents))")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(MoneySign(cents: totals.remainingCents).color ?? NestColor.text)
                }
                .monospacedDigit()
                GiftProgressBar(totals: totals, height: 8)
                    .accessibilityLabel("\(label) spend")
                    .accessibilityValue("\(Int(totals.progress * 100)) percent")
            }
        }
    }
}

/// A spend bar: teal, red once over budget.
struct GiftProgressBar: View {
    let totals: GiftTotals
    var height: CGFloat = 4

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(NestColor.border)
                Capsule()
                    .fill(totals.isOver ? NestColor.negative : ChartColorKey.savings.color)
                    .frame(width: proxy.size.width * totals.progress)
            }
        }
        .frame(height: height)
    }
}

/// A dense list row over a bottom rule, with an optional caption line.
struct GiftListRow<Content: View, Caption: View>: View {
    @ViewBuilder var content: Content
    @ViewBuilder var caption: Caption

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: NestSpacing.sm) { content }
            caption
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { NestColor.border.frame(height: 1) }
    }
}

extension GiftListRow where Caption == EmptyView {
    init(@ViewBuilder content: () -> Content) {
        self.init(content: content, caption: { EmptyView() })
    }
}

/// The empty-list message.
struct GiftEmptyState: View {
    let text: String

    var body: some View {
        Text(text).font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            .frame(maxWidth: .infinity, alignment: .center).padding(.vertical, NestSpacing.sm)
    }
}

/// Button looks matching Mantine's variants.
struct GiftButtonStyle: ButtonStyle {
    enum Variant { case light, outline, subtle, danger, filled }
    let variant: Variant
    var small = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let size: CGFloat = small ? 12 : 14
        configuration.label
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, small ? 10 : 14)
            .padding(.vertical, small ? 6 : 8)
            .frame(maxWidth: variant == .filled ? .infinity : nil)
            .background(
                background, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    .strokeBorder(variant == .outline ? NestColor.border : .clear, lineWidth: 1)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch variant {
        case .light, .subtle: NestColor.brand
        case .outline: NestColor.text
        case .danger: NestColor.negative
        case .filled: NestColor.onBrand
        }
    }

    private var background: Color {
        switch variant {
        case .light: NestColor.brand.opacity(0.16)
        case .filled: NestColor.brand
        default: .clear
        }
    }
}

/// The one "Add …" affordance: full-width solid lime with a leading plus.
struct GiftAddButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: "plus").frame(maxWidth: .infinity)
        }
        .buttonStyle(GiftButtonStyle(variant: .filled))
    }
}

/// A subtle square icon button (`ActionIcon variant="subtle"`).
struct GiftIconButton: View {
    let systemImage: String
    let label: String
    var tone: Color = NestColor.text
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage).font(.system(size: 14))
                .foregroundStyle(tone).frame(width: 28, height: 28).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A full-width segmented control in the theme's surface and lime accent.
struct GiftSegmented<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    let label: String

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button {
                    selection = option.value
                } label: {
                    Text(option.label)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(selection == option.value ? NestColor.text : NestColor.dimmedText)
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                        .background(
                            selection == option.value ? NestColor.surfaceRaised : .clear,
                            in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == option.value ? .isSelected : [])
            }
        }
        .padding(4)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// A labelled money field taking dollars as typed; `cents` reads it back.
struct GiftAmountField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            HStack(spacing: 4) {
                Text("$").foregroundStyle(NestColor.dimmedText)
                TextField("", text: $text)
                    #if os(iOS)
                        .keyboardType(.decimalPad)
                    #endif
            }
            .textFieldStyle(.plain)
            .font(NestFont.body).foregroundStyle(NestColor.text)
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
}

/// Typed dollars to cents and back.
enum GiftMoneyInput {
    /// Integer cents for typed dollars (commas allowed), or nil when not a number.
    static func cents(_ text: String) -> Int? {
        let cleaned = text.replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty, let dollars = Double(cleaned), dollars >= 0 else { return nil }
        return Int((dollars * 100).rounded())
    }

    /// Dollars as typed back for editing: `12.50`, empty for none.
    static func text(cents: Int?) -> String {
        cents.map { String(format: "%.2f", Double($0) / 100) } ?? ""
    }
}

/// A labelled option menu in the theme's input look, with an optional blank.
struct GiftSelect: View {
    let label: String
    var description: String?
    let placeholder: String
    let options: [GiftLinkOption]
    @Binding var selection: String?
    var isDisabled = false

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            if let description { GiftCaption(text: description) }
            Menu {
                if selection != nil {
                    Button("Clear") { selection = nil }
                }
                ForEach(options) { option in
                    Button(option.label) { selection = option.value }
                }
            } label: {
                HStack {
                    Text(options.first { $0.value == selection }?.label ?? placeholder)
                        .foregroundStyle(selection == nil ? NestColor.dimmedText : NestColor.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                        .foregroundStyle(NestColor.dimmedText)
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
            .disabled(isDisabled)
            .accessibilityLabel(label)
        }
    }
}

/// An inline form surface: fields over Save / Cancel, with an error line.
struct GiftFormShell<Fields: View>: View {
    let submitLabel: String
    var error: String?
    var canSubmit = true
    var isSubmitting = false
    let onSubmit: () -> Void
    let onCancel: () -> Void
    @ViewBuilder var fields: Fields

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                fields
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(NestColor.negative)
                }
                HStack(spacing: NestSpacing.xs) {
                    Button(isSubmitting ? "Saving…" : submitLabel, action: onSubmit)
                        .buttonStyle(GiftButtonStyle(variant: .filled))
                        .disabled(!canSubmit || isSubmitting)
                    Button("Cancel", action: onCancel)
                        .buttonStyle(GiftButtonStyle(variant: .outline))
                }
            }
        }
    }
}
