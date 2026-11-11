import SwiftUI

/// The native Pay splits route: the pay account chooser, each account's
/// recommended fortnightly split with its drift flag, confirm and clear
/// controls, and the budget lines behind every total.
struct SplitsScreen: View {
    @State private var model: SplitsViewModel
    @AppStorage("splits-sort-key") private var sortKey = SplitsSortKey.title.rawValue
    @AppStorage("splits-sort-ascending") private var ascending = true

    init(model: SplitsViewModel = SplitsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            SplitsContentView(
                presentation: SplitsPresentation(
                    content: content, sortKey: SplitsSortKey(rawValue: sortKey) ?? .title,
                    ascending: ascending),
                sortKey: Binding(
                    get: { SplitsSortKey(rawValue: sortKey) ?? .title },
                    set: { sortKey = $0.rawValue }),
                ascending: $ascending,
                actionError: model.actionError,
                actions: SplitsActions(
                    setPayAccount: { id in Task { await model.setPayAccount(id) } },
                    confirm: { id, cents in
                        Task { await model.confirm(accountID: id, fortnightlyCents: cents) }
                    },
                    clear: { id in Task { await model.clear(accountID: id) } }))
        }
        .task { await model.load() }
    }
}

/// The screen's writes, as closures the views call.
struct SplitsActions {
    var setPayAccount: (String?) -> Void = { _ in }
    var confirm: (_ accountID: String, _ fortnightlyCents: Int) -> Void = { _, _ in }
    var clear: (String) -> Void = { _ in }
}

struct SplitsContentView: View {
    let presentation: SplitsPresentation
    @Binding var sortKey: SplitsSortKey
    @Binding var ascending: Bool
    var actionError: NestError?
    var actions = SplitsActions()
    @State private var expanded: Set<String> = []

    private func toggle(_ id: String) {
        withAnimation(.easeInOut(duration: 0.2)) {
            if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                header
                if let actionError {
                    SplitsAlert(title: "Couldn't save", message: actionError.userMessage, tone: .warning)
                }
                if presentation.showsPayAccountChooser { payAccountField }
                if !presentation.hasPayAccount && presentation.showsPayAccountChooser {
                    SplitsAlert(
                        title: SplitsPresentation.choosePayAccountTitle,
                        message: SplitsPresentation.choosePayAccountMessage, tone: .info)
                }
                if presentation.nothingRoutedYet {
                    Text(SplitsPresentation.nothingRouted)
                        .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                } else {
                    sortControls
                }
                if !presentation.stays.isEmpty { staysSection }
                if !presentation.recommended.isEmpty { recommendedSection }
                if presentation.unassignedCents > 0 {
                    SplitsAlert(
                        title: "Unassigned", message: presentation.unassignedMessage,
                        tone: .warning)
                }
            }
            .padding(NestSpacing.md)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text(SplitsPresentation.title)
                .font(.system(size: 38, weight: .bold, design: .rounded))
                .tracking(-0.76)
                .foregroundStyle(NestColor.text)
            Text(SplitsPresentation.intro)
                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
        }
    }

    private var payAccountField: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(SplitsPresentation.paidIntoLabel)
                .font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            Text(SplitsPresentation.paidIntoDescription)
                .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                .padding(.bottom, 2)
            let selected = presentation.spendingAccounts.first { $0.id == presentation.payAccountId }
            SplitsSelect(
                text: selected?.label ?? SplitsPresentation.paidIntoPlaceholder,
                isPlaceholder: selected == nil,
                onClear: selected == nil ? nil : { actions.setPayAccount(nil) }
            ) {
                ForEach(presentation.spendingAccounts) { account in
                    Button(account.label) { actions.setPayAccount(account.id) }
                }
            }
        }
    }

    private var sortControls: some View {
        HStack(spacing: NestSpacing.xs) {
            Spacer()
            SplitsSelect(text: sortKey.label, isPlaceholder: false, onClear: nil) {
                ForEach(SplitsSortKey.allCases, id: \.self) { key in
                    Button(key.label) { sortKey = key }
                }
            }
            .frame(width: 130)
            Button {
                ascending.toggle()
            } label: {
                Text(ascending ? "↑" : "↓")
                    .font(.system(size: 16)).foregroundStyle(NestColor.text)
                    .frame(width: 36, height: 36)
                    .background(
                        NestColor.surface,
                        in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                            .strokeBorder(NestColor.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Toggle sort direction")
        }
    }

    private var staysSection: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            SplitsHeading(text: presentation.staysTitle)
            if presentation.hasPayAccount {
                Text(SplitsPresentation.staysNote)
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            ForEach(presentation.stays) { row in
                SplitRowView(
                    row: row, isExpanded: expanded.contains(row.id),
                    toggle: { toggle(row.id) }, recommended: false, actions: actions)
            }
        }
        .padding(NestSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            NestColor.brand.opacity(0.1),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }

    private var recommendedSection: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            HStack(spacing: NestSpacing.xs) {
                SplitsHeading(text: SplitsPresentation.recommendedTitle)
                if presentation.rowsToUpdate > 0 {
                    SplitsBadge(text: "\(presentation.rowsToUpdate) to update")
                }
            }
            ForEach(presentation.recommended) { row in
                SplitRowView(
                    row: row, isExpanded: expanded.contains(row.id),
                    toggle: { toggle(row.id) }, recommended: true, actions: actions)
            }
        }
    }
}

// MARK: Rows

/// One routed account: a dense bordered row on a regular-width layout, a compact
/// bordered card otherwise, each expanding to the budget lines behind its total.
private struct SplitRowView: View {
    let row: SplitRow
    let isExpanded: Bool
    let toggle: () -> Void
    let recommended: Bool
    let actions: SplitsActions
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var flagged: Bool { recommended && row.needsUpdate }

    var body: some View {
        if sizeClass == .regular { wide } else { card }
    }

    private var identity: some View {
        Button(action: toggle) {
            HStack(spacing: 6) {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).frame(width: 14)
                    .foregroundStyle(NestColor.text)
                if let emoji = row.emoji {
                    Text(emoji).font(.system(size: 16))
                } else {
                    Image(systemName: "wallet.pass").font(.system(size: 14))
                        .foregroundStyle(NestColor.text)
                }
                Text(row.label).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text).lineLimit(1)
                if row.deletedAtSource { SplitsBadge(text: "Deleted at source") }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(isExpanded ? "Hides budget items" : "Shows budget items")
    }

    private var clearButton: some View {
        Button { actions.clear(row.id) } label: {
            Text("×").font(.system(size: 16)).foregroundStyle(NestColor.dimmedText)
                .frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear pay split")
    }

    private var driftNote: some View {
        HStack(spacing: NestSpacing.xs) {
            SplitsBadge(text: "Update")
            Text(row.driftNote).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                .lineLimit(1)
            Spacer(minLength: 0)
            Button(row.confirmLabel) { actions.confirm(row.id, row.roundedCents) }
                .buttonStyle(SplitsLightButtonStyle())
        }
    }

    private var lines: some View {
        VStack(spacing: 2) {
            ForEach(row.lines, id: \.id) { line in
                HStack(spacing: NestSpacing.sm) {
                    Text(line.name).font(.system(size: 12)).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(MoneyFormat.perFortnight(line.fortnightlyCents))
                        .font(.system(size: 12)).monospacedDigit()
                }
                .foregroundStyle(NestColor.dimmedText)
            }
        }
        .padding(.top, 6).padding(.leading, NestSpacing.lg)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: NestSpacing.sm) {
                identity
                HStack(spacing: NestSpacing.xs) {
                    if let note = row.exactNote {
                        Text(note).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    }
                    SplitsFortnightlyAmount(cents: row.roundedCents)
                    if recommended && row.configuredCents != nil { clearButton }
                }
                .fixedSize()
            }
            if flagged { driftNote.padding(.top, 6) }
            if isExpanded { lines }
        }
        .padding(NestSpacing.sm)
        .background(
            NestColor.surface,
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .overlay(alignment: .leading) {
            if flagged {
                UnevenRoundedRectangle(
                    topLeadingRadius: NestRadius.md, bottomLeadingRadius: NestRadius.md
                )
                .fill(NestColor.warning).frame(width: 3)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }

    private var wide: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: NestSpacing.sm) {
                    identity
                    if let note = row.exactNote {
                        Text(note).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    }
                    SplitsFortnightlyAmount(cents: row.roundedCents)
                        .frame(width: 112, alignment: .trailing)
                    if recommended && row.configuredCents != nil { clearButton }
                }
                if flagged { driftNote }
            }
            .padding(.vertical, 6)
            .padding(.leading, flagged ? NestSpacing.xs : 0)
            .overlay(alignment: .leading) {
                if flagged { Rectangle().fill(NestColor.warning).frame(width: 3) }
            }
            if isExpanded { lines }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(NestColor.border).frame(height: 1)
        }
    }
}

// MARK: Pieces

private struct SplitsHeading: View {
    let text: String

    var body: some View {
        Text(text).font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(NestColor.text)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The emphasised figure with a dimmed `/ fn` suffix, baseline-aligned.
private struct SplitsFortnightlyAmount: View {
    let cents: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(MoneyFormat.cents(cents)).font(.system(size: 14, weight: .bold))
                .monospacedDigit().foregroundStyle(NestColor.text)
            Text("/ fn").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(MoneyFormat.cents(cents)) per fortnight")
    }
}

/// A light, extra-small warning badge, as the PWA's `Badge size="xs" color="warning"`.
private struct SplitsBadge: View {
    let text: String

    var body: some View {
        Text(text).font(.system(size: 10, weight: .semibold)).foregroundStyle(NestColor.warning)
            .padding(.horizontal, 6).frame(height: 16)
            .background(
                NestColor.warning.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.xs, style: .continuous)
            )
            .fixedSize()
    }
}

/// The light compact-extra-small button (Confirm, Mark as set).
private struct SplitsLightButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 12, weight: .semibold))
            .foregroundStyle(NestColor.brand)
            .padding(.horizontal, 7).frame(height: 22)
            .background(
                NestColor.brand.opacity(configuration.isPressed ? 0.2 : 0.12),
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .fixedSize()
    }
}

/// A light-variant alert: a tinted panel with a bold title and the message.
private struct SplitsAlert: View {
    let title: String
    let message: String
    let tone: NestPill.Tone

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 14, weight: .bold))
            Text(message).font(.system(size: 14))
        }
        .foregroundStyle(tone.color)
        .padding(NestSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            tone.color.opacity(0.1),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// A select-style field: the chosen value over a menu of options, with an
/// optional clear control.
private struct SplitsSelect<Options: View>: View {
    let text: String
    let isPlaceholder: Bool
    let onClear: (() -> Void)?
    @ViewBuilder var options: Options

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            Menu {
                options
            } label: {
                HStack {
                    Text(text).font(.system(size: 14))
                        .foregroundStyle(isPlaceholder ? NestColor.dimmedText : NestColor.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let onClear {
                Button(action: onClear) {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
            Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NestColor.dimmedText)
        }
        .padding(.horizontal, NestSpacing.sm).frame(height: 36)
        .background(
            NestColor.surface,
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}
