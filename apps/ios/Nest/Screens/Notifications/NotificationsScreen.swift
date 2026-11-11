import SwiftUI

/// The native Notifications route: this device's state, a test push and the
/// per-trigger switches, laid out as the PWA's `PushNotificationsCard`.
struct NotificationsScreen: View {
    @State private var model: NotificationsViewModel

    init(model: NotificationsViewModel = NotificationsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { rows in
            NotificationsContentView(
                toggles: NotificationsPresentation.toggles(
                    for: rows.preferences, overrides: model.pending),
                test: model.test,
                setEnabled: { trigger, next in try? await model.setEnabled(trigger, next) },
                sendTest: { await model.sendTest() })
        }
        .task { await model.load() }
    }
}

struct NotificationsContentView: View {
    let toggles: [NotificationToggleRow]
    let test: NotificationsViewModel.TestState
    let setEnabled: (NotificationTrigger, Bool) async -> Void
    let sendTest: () async -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text(NotificationsPresentation.title)
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-0.76)
                    .foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                NestCard {
                    VStack(alignment: .leading, spacing: NestSpacing.md) {
                        VStack(alignment: .leading, spacing: NestSpacing.xs) {
                            StatusBadge(text: NotificationsPresentation.deviceLabel)
                            Text(NotificationsPresentation.deviceDetail)
                                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                            testButton
                            SectionDivider(label: NotificationsPresentation.sectionLabel)
                                .padding(.top, NestSpacing.xs)
                            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                                ForEach(toggles) { row in
                                    ToggleRow(row: row) { next in
                                        Task { await setEnabled(row.trigger, next) }
                                    }
                                }
                            }
                            Text(NotificationsPresentation.footnote)
                                .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                        }
                        if case .sent(let text) = test { AlertBox(text: text, tone: NestColor.positive) }
                        if case .failed(let text) = test { AlertBox(text: text, tone: NestColor.negative) }
                    }
                }
            }
            .padding(NestSpacing.md)
        }
    }

    private var sending: Bool { test == .sending }

    private var testButton: some View {
        Button { Task { await sendTest() } } label: {
            ZStack {
                Text(NotificationsPresentation.sendTestLabel).opacity(sending ? 0 : 1)
                if sending { ProgressView().controlSize(.small) }
            }
            .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
            .frame(maxWidth: .infinity).frame(height: 36)
            .background(
                NestColor.surface,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    .strokeBorder(NestColor.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(sending)
    }
}

/// A small status badge in natural case, as the theme's `Badge`.
private struct StatusBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(NestColor.positive)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(
                NestColor.positive.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
    }
}

/// A hairline with its label at the leading edge, as `Divider` with a left label.
private struct SectionDivider: View {
    let label: String

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            Text(label).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            Rectangle().fill(NestColor.border).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One trigger: a small switch beside its label and description, as Mantine's `Switch`.
private struct ToggleRow: View {
    let row: NotificationToggleRow
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            Toggle(
                row.label,
                isOn: Binding(get: { row.enabled }, set: { onChange($0) })
            )
            .labelsHidden()
            .tint(NestColor.brand)
            .scaleEffect(0.75)
            .frame(width: 38, height: 22)
            VStack(alignment: .leading, spacing: 0) {
                Text(row.label).font(.system(size: 14)).foregroundStyle(NestColor.text)
                Text(row.detail).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A tinted notice, as Mantine's light `Alert`.
private struct AlertBox: View {
    let text: String
    let tone: Color

    var body: some View {
        Text(text)
            .font(.system(size: 14)).foregroundStyle(tone)
            .padding(NestSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                tone.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
    }
}
