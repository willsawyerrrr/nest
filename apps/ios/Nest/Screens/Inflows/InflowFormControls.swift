import SwiftUI

/// The PWA's form controls (Mantine inputs at `size="sm"`): a label over an optional
/// dimmed description over a bordered control on the elevated surface.

/// A labelled field: label, dimmed description, then its control.
struct InflowField<Content: View>: View {
    let label: String
    var description: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(NestColor.text)
            if let description {
                Text(description)
                    .font(.system(size: 12))
                    .foregroundStyle(NestColor.dimmedText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// The bordered, rounded input surface at the PWA's 36pt height.
    func inflowInputBox() -> some View {
        self
            .font(.system(size: 14))
            .foregroundStyle(NestColor.text)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
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

/// A single-line text input.
struct InflowTextInput: View {
    @Binding var text: String
    var prefix: String?
    var numeric = false
    var identifier: String?

    var body: some View {
        HStack(spacing: 4) {
            if let prefix { Text(prefix).foregroundStyle(NestColor.dimmedText) }
            field
        }
        .inflowInputBox()
    }

    @ViewBuilder private var field: some View {
        #if os(iOS)
            TextField("", text: $text)
                .keyboardType(numeric ? .decimalPad : .default)
                .textInputAutocapitalization(numeric ? .never : .sentences)
                .accessibilityIdentifier(identifier ?? "")
        #else
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .accessibilityIdentifier(identifier ?? "")
        #endif
    }
}

/// A dropdown of `options`, showing the chosen label with a chevron.
struct InflowSelect<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        Menu {
            ForEach(options.indices, id: \.self) { index in
                Button(options[index].1) { selection = options[index].0 }
            }
        } label: {
            HStack {
                Text(options.first { $0.0 == selection }?.1 ?? "")
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11)).foregroundStyle(NestColor.dimmedText)
            }
            .inflowInputBox()
        }
        .buttonStyle(.plain)
    }
}

/// A full-width segmented control: the chosen segment sits on a raised indicator.
struct InflowSegmented<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button { selection = option.0 } label: {
                    Text(option.1)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(
                            option.0 == selection ? NestColor.text : NestColor.dimmedText
                        )
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .background(
                            option.0 == selection ? NestColor.surfaceRaised : .clear,
                            in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option.0 == selection ? .isSelected : [])
            }
        }
        .padding(3)
        .background(
            NestColor.surface,
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}

/// A switch with its label and dimmed description beside it, as Mantine's `Switch`.
struct InflowSwitch: View {
    let label: String
    let description: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(NestColor.brand)
                .fixedSize()
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
                Text(description)
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A date input showing `D MMM YYYY`, clearable, picking in a sheet.
struct InflowDateInput: View {
    @Binding var iso: String?
    @State private var isPresented = false
    @State private var picked = Date()

    var body: some View {
        HStack(spacing: 4) {
            Button {
                picked = iso.flatMap(InflowsPresentation.parseIsoDate) ?? Date()
                isPresented = true
            } label: {
                Text(iso.map(InflowsPresentation.formatIsoDate) ?? "Pick date")
                    .foregroundStyle(iso == nil ? NestColor.dimmedText : NestColor.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            if iso != nil {
                Button { iso = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 11))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear date")
            }
        }
        .inflowInputBox()
        .sheet(isPresented: $isPresented) {
            VStack(spacing: NestSpacing.md) {
                DatePicker("", selection: $picked, displayedComponents: .date)
                    .labelsHidden()
                    #if os(iOS)
                        .datePickerStyle(.graphical)
                    #endif
                HStack {
                    Button("Cancel") { isPresented = false }
                    Spacer()
                    Button("Done") {
                        iso = InflowsPresentation.isoDate(picked)
                        isPresented = false
                    }
                }
            }
            .padding(NestSpacing.md)
            .presentationDetents([.medium])
        }
    }
}

/// The brand-lime full-width add affordance with a leading plus.
struct InflowAddButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: "plus").labelStyle(.titleAndIcon)
        }
        .buttonStyle(NestPrimaryButtonStyle())
    }
}

/// The neutral outlined button (Mantine's `default` variant).
struct InflowSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(NestColor.text)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(
                NestColor.surface,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    .strokeBorder(NestColor.border, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// An `xs` badge: a light tint of `tone`, or the neutral outlined default.
struct InflowBadge: View {
    enum Style { case light(Color), outlined }

    let text: String
    var style: Style = .outlined

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, 6)
            .frame(height: 18)
            .background(background, in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            .overlay {
                if case .outlined = style {
                    RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1)
                }
            }
    }

    private var foreground: Color {
        if case .light(let tone) = style { tone } else { NestColor.text }
    }

    private var background: Color {
        if case .light(let tone) = style { tone.opacity(0.16) } else { NestColor.surface }
    }
}
