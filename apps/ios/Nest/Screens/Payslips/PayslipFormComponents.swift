import SwiftUI

/// Lays `items` out in `compact` columns on a phone and `regular` from the `xs`
/// breakpoint up, as the PWA's `SimpleGrid cols={{ base, xs }}`.
struct AdaptiveGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    let compact: Int
    let regular: Int
    var spacing: CGFloat = NestSpacing.xs
    @ViewBuilder let cell: (Item) -> Cell
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: spacing, alignment: .topLeading),
                count: sizeClass == .compact ? compact : regular),
            alignment: .leading, spacing: spacing
        ) {
            ForEach(items) { cell($0) }
        }
    }
}

/// A form field's label above its control, the PWA's Mantine input label (14, medium).
struct FieldLabel<Content: View>: View {
    let label: String
    var description: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            if let description {
                Text(description).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
            content
        }
    }
}

/// A dollars field: `$` prefix, decimal keyboard.
struct AmountField: View {
    let label: String
    var description: String?
    var placeholder = ""
    @Binding var text: String

    var body: some View {
        FieldLabel(label: label, description: description) {
            HStack(spacing: NestSpacing.xxs) {
                Text("$").foregroundStyle(NestColor.dimmedText)
                TextField(placeholder, text: $text)
                    .textFieldStyle(.plain)
                    #if os(iOS)
                        .keyboardType(.decimalPad)
                    #endif
            }
            .modifier(FieldChrome())
        }
    }
}

/// The bordered surface behind a control that is not a plain `TextField`.
struct FieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(NestFont.body).foregroundStyle(NestColor.text)
            .padding(NestSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                NestColor.surface,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    .strokeBorder(NestColor.border, lineWidth: 1)
            )
    }
}

/// An ISO date (`YYYY-MM-DD`) field: a compact date picker, clearable where optional.
struct IsoDateField: View {
    let label: String
    var placeholder = ""
    var error: String?
    var clearable = true
    @Binding var iso: String?

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    var body: some View {
        FieldLabel(label: label) {
            HStack(spacing: NestSpacing.xs) {
                if let value = iso {
                    DatePicker(
                        label,
                        selection: Binding(
                            get: { PayslipDraft.parse(value) ?? Date() },
                            set: { iso = PayslipDraft.iso($0, timeZone: TimeZone(identifier: "UTC")!) }),
                        displayedComponents: .date
                    )
                    .labelsHidden()
                    .environment(\.calendar, Self.calendar)
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    Spacer(minLength: 0)
                    if clearable {
                        Button { iso = nil } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(NestColor.dimmedText)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear \(label.lowercased())")
                    }
                } else {
                    Button {
                        iso = PayslipDraft.todayIso()
                    } label: {
                        Text(placeholder.isEmpty ? "Pick a date" : placeholder)
                            .foregroundStyle(NestColor.dimmedText)
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 0)
                }
            }
            .modifier(FieldChrome())
            if let error {
                Text(error).font(NestFont.caption).foregroundStyle(NestColor.negative)
            }
        }
    }
}

/// A pick-one menu with an empty option, styled as a field.
struct OptionPicker: View {
    let label: String
    let placeholder: String
    let options: [InflowOption]
    var error: String?
    var clearable = true
    @Binding var selection: String?

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Menu {
                if clearable {
                    Button("None") { selection = nil }
                }
                ForEach(options, id: \.value) { option in
                    Button(option.label) { selection = option.value }
                }
            } label: {
                HStack {
                    Text(options.first { $0.value == selection }?.label ?? placeholder)
                        .foregroundStyle(selection == nil ? NestColor.dimmedText : NestColor.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .modifier(FieldChrome())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            if let error {
                Text(error).font(NestFont.caption).foregroundStyle(NestColor.negative)
            }
        }
    }
}

/// A labelled money figure with an optional variance and qualifier beneath, the PWA's
/// `FigureCell`: the label a dimmed small-caps line, the amount semibold.
struct FigureCell: View {
    let model: FigureCellModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(model.label.uppercased())
                .font(NestFont.caption).tracking(0.5).foregroundStyle(NestColor.dimmedText)
            Text(MoneyFormat.cents(Int(model.cents)))
                .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                .foregroundStyle(NestColor.text)
            if let variance = model.variance { VarianceText(note: variance) }
            if let note = model.note {
                Text(note).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A variance in the app's sign colouring with the direction spelled out in words.
struct VarianceText: View {
    let note: VarianceNote

    var body: some View {
        Text(note.text).font(NestFont.caption)
            .foregroundStyle(note.sign.color ?? NestColor.dimmedText)
    }
}

/// A dimmed uppercase section label, as the PWA's `Text size="xs" c="dimmed" tt="uppercase"`.
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased()).font(NestFont.caption).tracking(0.5)
            .foregroundStyle(NestColor.dimmedText)
    }
}
