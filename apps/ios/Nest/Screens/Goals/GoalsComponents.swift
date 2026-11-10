import SwiftUI

/// The width the Goals content is laid out in, read to choose the PWA's dense
/// desktop row (`48em`, 768pt and up) over its stacked mobile card.
struct GoalsWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

extension NestPill.Tone {
    /// A Mantine status badge colour (`gray` is the neutral one).
    var badgeColor: Color { color }
}

/// A Mantine `xs` light badge: 10pt bold label on a tinted pill.
struct GoalBadge: View {
    let text: String
    var tone: NestPill.Tone = .neutral

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(tone.badgeColor)
            .padding(.horizontal, 6)
            .frame(height: 16)
            .background(
                tone.badgeColor.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
            )
            .fixedSize()
    }
}

/// A Mantine `sm` progress bar: an 8pt rounded track under a fill.
struct GoalProgressBar: View {
    let percent: Double
    let tone: NestPill.Tone
    let name: String

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(NestColor.border)
                Capsule().fill(tone.badgeColor)
                    .frame(width: proxy.size.width * max(0, min(100, percent)) / 100)
            }
        }
        .frame(height: 8)
        .accessibilityElement()
        .accessibilityLabel("\(name) progress")
        .accessibilityValue("\(Int(percent.rounded())) percent")
    }
}

/// A 28pt subtle icon button (Mantine `ActionIcon`).
struct GoalActionIcon: View {
    let systemImage: String
    let label: String
    var color: Color = NestColor.brand
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

extension Color {
    /// Mantine `red` for a destructive subtle control.
    static let nestDestructive = Color(light: Color(hex: 0xFA5252), dark: Color(hex: 0xFF8787))
}

/// The pencil beside a red trash can, shared by every goal.
struct GoalEditDeleteActions: View {
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            GoalActionIcon(systemImage: "pencil", label: "Edit", action: onEdit)
            GoalActionIcon(
                systemImage: "trash", label: "Delete", color: .nestDestructive, action: onDelete)
        }
    }
}

/// ETA or figure segments as one run of text: struck real figure, bold proposal
/// and a delta tinted by its sign.
struct GoalSegmentsText: View {
    let segments: [GoalSegment]
    var size: CGFloat = 12
    var weight: Font.Weight = .regular
    var color: Color = NestColor.text

    var body: some View {
        Text(attributed).monospacedDigit()
    }

    private var attributed: AttributedString {
        var result = AttributedString()
        for segment in segments {
            var piece: AttributedString
            switch segment {
            case .plain(let value):
                piece = AttributedString(value)
                piece.foregroundColor = color
                piece.font = .system(size: size, weight: weight)
            case .struck(let value):
                piece = AttributedString(value)
                piece.foregroundColor = NestColor.dimmedText
                piece.strikethroughStyle = .single
                piece.font = .system(size: size, weight: .regular)
            case .proposed(let value):
                piece = AttributedString(value)
                piece.foregroundColor = color
                piece.font = .system(size: size, weight: .bold)
            case .delta(let value, let sign):
                piece = AttributedString(value)
                piece.foregroundColor = sign.color ?? color
                piece.font = .system(size: size, weight: .regular)
            }
            result += piece
        }
        return result
    }
}

/// The emphasised fortnightly figure with a dimmed `/ fn` suffix.
struct GoalFortnightlyAmount: View {
    let segments: [GoalSegment]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            GoalSegmentsText(segments: segments, size: 14, weight: .bold)
            Text("/ fn").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
        }
    }
}

/// Mantine's full-width lime "Add …" button with its leading plus and glow.
struct GoalAddButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "plus").font(.system(size: 14, weight: .semibold))
                Text(label)
            }
        }
        .buttonStyle(GoalPrimaryButtonStyle())
        .shadow(color: NestColor.brand.opacity(0.19), radius: 8, y: 4)
    }
}

/// A 36pt Mantine button: lime when `primary`, else the default outlined surface.
struct GoalPrimaryButtonStyle: ButtonStyle {
    var primary = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(primary ? NestColor.onBrand : NestColor.text)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(
                primary ? NestColor.brand : NestColor.surface,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay {
                if !primary {
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1)
                }
            }
            .opacity(!isEnabled ? 0.4 : configuration.isPressed ? 0.8 : 1)
    }
}

/// The light-tinted Mantine alert used for errors and warnings.
struct GoalAlert: View {
    let text: String
    var tone: NestPill.Tone = .negative
    var compact = false

    var body: some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(tone.badgeColor)
            .padding(compact ? NestSpacing.xs : NestSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                tone.badgeColor.opacity(0.12),
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}
