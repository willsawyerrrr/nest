import SwiftUI

/// The native Accounts route: every account the member can see, grouped by type
/// with each group's total. Read-only; net-worth inclusion is set on Net worth.
struct AccountsScreen: View {
    @State private var model: AccountsViewModel

    init(model: AccountsViewModel = AccountsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { rows in
            AccountsContentView(presentation: AccountsPresentation(rows: rows))
        }
        .task { await model.load() }
    }
}

struct AccountsContentView: View {
    let presentation: AccountsPresentation

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    var body: some View {
        NestPageSection(title: AccountsPresentation.title, intro: AccountsPresentation.intro) {
            if presentation.groups.isEmpty {
                NestEmptyState(text: AccountsPresentation.emptyMessage)
            }
            ForEach(presentation.groups) { group in
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    HStack {
                        Text(group.label).font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(NestColor.text)
                            .accessibilityAddTraits(.isHeader)
                        Spacer(minLength: NestSpacing.xs)
                        Balance(cents: group.totalCents).font(.system(size: 14, weight: .bold))
                    }
                    VStack(alignment: .leading, spacing: wide ? 0 : NestSpacing.xs) {
                        ForEach(group.rows) { AccountItemView(row: $0, wide: wide) }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(group.label)
            }
        }
    }
}

/// A balance, tinted red only when negative (an amount owed), otherwise neutral.
private struct Balance: View {
    let cents: Int

    var body: some View {
        MoneyText(cents: cents, colouring: cents < 0)
    }
}

/// One account: a dense row where there is room, a bordered card on a phone.
private struct AccountItemView: View {
    let row: AccountListRow
    let wide: Bool

    var body: some View {
        if wide { rowBody } else { cardBody }
    }

    private var name: some View {
        HStack(spacing: 6) {
            if let emoji = row.emoji {
                Text(emoji).font(.system(size: 16)).accessibilityHidden(true)
            } else {
                Image(systemName: "wallet.pass").font(.system(size: 14))
                    .foregroundStyle(NestColor.dimmedText).accessibilityHidden(true)
            }
            Text(row.label).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.text).lineLimit(1)
            if row.isDeleted { NestPill(text: "Deleted at source", tone: .warning).fixedSize() }
            if row.isExcluded { NestPill(text: "Not in net worth").fixedSize() }
        }
    }

    private var rowBody: some View {
        HStack(spacing: NestSpacing.sm) {
            name.frame(maxWidth: .infinity, alignment: .leading)
            Text(row.owner).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                .lineLimit(1).frame(width: 144, alignment: .leading)
            Text(row.source).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                .frame(width: 64, alignment: .leading)
            Balance(cents: row.balanceCents).font(.system(size: 14))
                .frame(width: 128, alignment: .trailing)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
        .accessibilityElement(children: .combine)
    }

    private var cardBody: some View {
        NestCard(padding: NestSpacing.xs) {
            HStack(spacing: NestSpacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    name
                    Text("\(row.owner) · \(row.source)").font(NestFont.caption)
                        .foregroundStyle(NestColor.dimmedText).lineLimit(1)
                }
                Spacer(minLength: 0)
                Balance(cents: row.balanceCents).font(.system(size: 14))
            }
        }
        .accessibilityElement(children: .combine)
    }
}
