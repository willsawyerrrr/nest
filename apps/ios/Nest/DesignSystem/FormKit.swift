import SwiftUI

/// Form and list primitives mirroring the PWA's shared components (`PageSection`,
/// `AddButton`, `FormShell`, `EditDeleteActions`, `EmptyState`, Mantine inputs), so a
/// native screen lays out, spaces and labels like the page it replaces.
enum FormMetric {
    /// Mantine's `xs` spacing and card padding.
    static let xs: CGFloat = 10
    /// Mantine's `sm` spacing; the form card's padding.
    static let sm: CGFloat = 12
}

/// The one "Add …" affordance: a full-width lime button with a leading plus.
struct AddButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: "plus")
                .labelStyle(.titleAndIcon)
                .font(.system(size: 14, weight: .semibold))
        }
        .buttonStyle(FormButtonStyle(kind: .primary))
    }
}

/// Mantine's `filled` and `default` button variants.
struct FormButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, compact }
    var kind: Kind
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: kind == .compact ? 12 : 14, weight: .semibold))
            .foregroundStyle(kind == .primary ? NestColor.onBrand : NestColor.text)
            .frame(maxWidth: kind == .compact ? nil : .infinity)
            .padding(.horizontal, kind == .compact ? 8 : 14)
            .frame(minHeight: kind == .compact ? 22 : 36)
            .background(
                kind == .primary ? NestColor.brand : Color.clear,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay {
                if kind != .primary {
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1)
                }
            }
            .opacity(!isEnabled ? 0.4 : configuration.isPressed ? 0.8 : 1)
    }
}

/// A bordered card at the form's padding, holding an inline editor.
struct FormCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: FormMetric.xs) { content }
            .padding(FormMetric.sm)
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

/// The form's footer: the submit button, and Cancel beside it when given.
struct FormFooter: View {
    let submitLabel: String
    var cancelLabel = "Cancel"
    let canSubmit: Bool
    let submitting: Bool
    let onSubmit: () -> Void
    var onCancel: (() -> Void)?

    var body: some View {
        HStack(spacing: FormMetric.xs) {
            Button(submitting ? "Saving…" : submitLabel, action: onSubmit)
                .buttonStyle(FormButtonStyle(kind: .primary))
                .disabled(!canSubmit || submitting)
            if let onCancel {
                Button(cancelLabel, action: onCancel).buttonStyle(FormButtonStyle(kind: .secondary))
            }
        }
    }
}

/// An input's label (14, medium) and description (12, dimmed) above its control.
struct LabelledField<Content: View>: View {
    var label: String?
    var description: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let label {
                Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            }
            if let description {
                Text(description).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A text input in `NestTextFieldStyle`, with optional prefix and suffix.
struct TextInput: View {
    var label: String?
    var description: String?
    var placeholder = ""
    var prefix: String?
    var suffix: String?
    var decimal = false
    @Binding var text: String

    var body: some View {
        LabelledField(label: label, description: description) {
            HStack(spacing: 4) {
                if let prefix { Text(prefix).foregroundStyle(NestColor.dimmedText) }
                TextField(placeholder, text: $text)
                    #if os(iOS)
                    .keyboardType(decimal ? .decimalPad : .default)
                    #endif
                if let suffix { Text(suffix).foregroundStyle(NestColor.dimmedText) }
            }
            .font(.system(size: 14))
            .foregroundStyle(NestColor.text)
            .padding(.horizontal, FormMetric.sm)
            .frame(minHeight: 36)
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

/// A segmented control (Mantine `SegmentedControl`).
struct SegmentedInput<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button { selection = option.value } label: {
                    Text(option.label)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(
                            selection == option.value ? NestColor.onBrand : NestColor.text
                        )
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .background(
                            selection == option.value ? NestColor.brand : Color.clear,
                            in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(
            NestColor.surfaceRaised,
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// A select (Mantine `Select`): the current label in an input-styled menu.
struct SelectInput<Value: Hashable>: View {
    var label: String?
    var description: String?
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        LabelledField(label: label, description: description) {
            Menu {
                ForEach(options.indices, id: \.self) { index in
                    Button(options[index].label) { selection = options[index].value }
                }
            } label: {
                HStack {
                    Text(options.first { $0.value == selection }?.label ?? "")
                        .font(.system(size: 14)).foregroundStyle(NestColor.text)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.down").font(.system(size: 11))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .padding(.horizontal, FormMetric.sm)
                .frame(minHeight: 36)
                .background(
                    NestColor.surface,
                    in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }
}

/// A light-variant alert (Mantine `Alert`, `p="xs"`): tinted fill, tinted text.
struct Callout: View {
    var tone: NestPill.Tone = .info
    var title: String?
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let title {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(tone.color)
            }
            Text(text).font(.system(size: 12)).foregroundStyle(tone.color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(FormMetric.xs)
        .background(
            tone.color.opacity(0.12),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// The inline error shown when a form action fails.
struct FormError: View {
    let message: String

    var body: some View {
        Text(message).font(.system(size: 14)).foregroundStyle(NestColor.negative)
            .accessibilityAddTraits(.isStaticText)
    }
}

/// A pencil edit control beside a red trash delete control.
struct EditDeleteActions: View {
    var onEdit: () -> Void
    var onDelete: (() -> Void)?
    var editLabel = "Edit"

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onEdit) {
                Image(systemName: "pencil").font(.system(size: 14))
                    .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
            }
            .buttonStyle(.plain).accessibilityLabel(editLabel)
            if let onDelete {
                Button(action: onDelete) {
                    Image(systemName: "trash").font(.system(size: 14))
                        .foregroundStyle(NestColor.negative).frame(width: 28, height: 28)
                }
                .buttonStyle(.plain).accessibilityLabel("Delete")
            }
        }
    }
}
