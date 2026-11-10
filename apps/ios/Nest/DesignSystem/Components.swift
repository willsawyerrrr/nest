import SwiftUI

/// An elevated, bordered surface that steps off the page canvas.
struct NestCard<Content: View>: View {
    var padding: CGFloat = NestSpacing.lg
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
                    .strokeBorder(NestColor.border, lineWidth: 1)
            )
    }
}

/// A money figure in tabular digits, coloured by sign unless `colouring` is off.
struct MoneyText: View {
    let cents: Int
    var colouring = true

    var body: some View {
        Text(MoneyFormat.cents(cents))
            .monospacedDigit()
            .foregroundStyle((colouring ? MoneySign(cents: cents).color : nil) ?? NestColor.text)
    }
}

/// A row with a title, optional subtitle and leading icon, and trailing content.
struct NestListRow<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: NestSpacing.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .foregroundStyle(NestColor.dimmedText)
                    .frame(width: 24)
            }
            VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                Text(title)
                    .font(NestFont.body)
                    .foregroundStyle(NestColor.text)
                if let subtitle {
                    Text(subtitle)
                        .font(NestFont.caption)
                        .foregroundStyle(NestColor.dimmedText)
                }
            }
            Spacer(minLength: NestSpacing.sm)
            trailing
        }
        .padding(.vertical, NestSpacing.xs)
    }
}

extension NestListRow where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, systemImage: String? = nil) {
        self.init(title: title, subtitle: subtitle, systemImage: systemImage) { EmptyView() }
    }
}

/// A small status pill; its tone picks the semantic colour.
struct NestPill: View {
    enum Tone: CaseIterable {
        case neutral, brand, positive, negative, warning, info

        var color: Color {
            switch self {
            case .neutral: NestColor.dimmedText
            case .brand: NestColor.brand
            case .positive: NestColor.positive
            case .negative: NestColor.negative
            case .warning: NestColor.warning
            case .info: NestColor.info
            }
        }
    }

    let text: String
    var tone: Tone = .neutral

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tone.color)
            .padding(.horizontal, NestSpacing.xs)
            .padding(.vertical, NestSpacing.xxs)
            .background(
                tone.color.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
    }
}

/// A rounded, bordered text field on the elevated surface.
struct NestTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(NestFont.body)
            .foregroundStyle(NestColor.text)
            .padding(NestSpacing.sm)
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

/// A labelled form field wrapping a `TextField` in `NestTextFieldStyle`.
struct NestField: View {
    let label: String
    @Binding var text: String
    var prompt = ""

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(NestColor.text)
            TextField(prompt, text: $text)
                .textFieldStyle(NestTextFieldStyle())
        }
    }
}

/// The brand-lime primary action.
struct NestPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(NestColor.onBrand)
            .frame(maxWidth: .infinity)
            .padding(.vertical, NestSpacing.sm)
            .background(
                NestColor.brand,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// A full-screen error state. Callers pass fixed copy for the failure's stable
/// code; an upstream response body never reaches this view.
struct ErrorView: View {
    let title: String
    let message: String
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(spacing: NestSpacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(NestColor.dimmedText)
            Text(title)
                .font(NestFont.heading)
                .foregroundStyle(NestColor.text)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(NestColor.dimmedText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, NestSpacing.xl)
            if let onRetry {
                Button("Retry", action: onRetry)
                    .buttonStyle(NestPrimaryButtonStyle())
                    .frame(maxWidth: 200)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NestColor.background)
    }
}
