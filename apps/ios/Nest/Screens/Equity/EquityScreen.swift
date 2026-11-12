import SwiftUI

/// The native Equity route: each member's grants with vesting progress and value,
/// and the exercises and sales recorded against them.
struct EquityScreen: View {
    @State private var model: EquityViewModel

    init(model: EquityViewModel = EquityViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            EquityContentView(presentation: EquityPresentation(content: content))
        }
        .task { await model.load() }
    }
}

struct EquityContentView: View {
    let presentation: EquityPresentation

    var body: some View {
        NestPageSection(title: EquityPresentation.title, intro: EquityPresentation.intro) {
            ForEach(presentation.members) { MemberSection(member: $0) }
            WebHandoffCard(
                title: "Edit equity",
                message:
                    "Adding, changing and deleting grants, exercises and sales happens in the web app.",
                action: "Open Equity on the web", path: Route.equity.path)
        }
    }
}

private struct MemberSection: View {
    let member: MemberEquity

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(member.name).font(.system(size: 16, weight: .semibold))
                .foregroundStyle(NestColor.text)
            if member.grants.isEmpty {
                NestEmptyState(text: EquityPresentation.noGrants)
            }
            ForEach(member.grants) { GrantItem(grant: $0) }
            if let exercises = member.exercises {
                ActivitySection(
                    title: "Exercises", empty: EquityPresentation.noExercises, rows: exercises)
            }
            if let sales = member.sales {
                ActivitySection(title: "Sales", empty: EquityPresentation.noSales, rows: sales)
            }
        }
    }
}

private struct ActivitySection: View {
    let title: String
    let empty: String
    let rows: [ActivityRow]

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(title).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.dimmedText)
            if rows.isEmpty { NestEmptyState(text: empty) }
            ForEach(rows) { ActivityCard(row: $0) }
        }
    }
}

/// A small label beside a grant's name, as Mantine's `Badge`: tinted when `tint`
/// is set (`light`), else outlined (`default`).
private struct EquityBadge: View {
    let text: String
    var tint: Color?

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(tint ?? NestColor.dimmedText)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(
                tint?.opacity(0.16) ?? .clear,
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
            )
            .overlay {
                if tint == nil {
                    RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1)
                }
            }
            .fixedSize()
    }
}

private extension GrantRow {
    var instrumentTint: Color {
        isOption ? ChartColorKey.wants.color : ChartColorKey.investments.color
    }
}

/// One grant: a dense row where there is room, a bordered card on a phone.
private struct GrantItem: View {
    let grant: GrantRow

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    var body: some View {
        if wide { rowBody } else { cardBody }
    }

    private var badges: some View {
        HStack(spacing: 6) {
            EquityBadge(text: grant.instrumentLabel, tint: grant.instrumentTint)
            EquityBadge(text: grant.frequencyLabel)
        }
    }

    private var net: some View {
        Text(MoneyFormat.cents(Int(grant.netCents)))
            .font(.system(size: 14, weight: .bold)).monospacedDigit()
            .foregroundStyle(NestColor.text)
    }

    private var rowBody: some View {
        VStack(alignment: .leading, spacing: grant.caption == nil ? 0 : 4) {
            HStack(spacing: NestSpacing.sm) {
                HStack(spacing: 6) {
                    Text(grant.label).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    badges
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(grant.vestedLabel).font(.system(size: 12))
                    .foregroundStyle(NestColor.dimmedText)
                    .frame(width: 144, alignment: .trailing)
                net.frame(width: 112, alignment: .trailing)
            }
            if let caption = grant.caption {
                Text(caption).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
        .accessibilityElement(children: .combine)
    }

    private var cardBody: some View {
        HStack(alignment: .top, spacing: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(grant.label).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text).lineLimit(1)
                HStack(spacing: 6) {
                    badges
                    Text(grant.vestedLabel).font(.system(size: 12))
                        .foregroundStyle(NestColor.dimmedText)
                }
                if let line = grant.valueLine {
                    Text(line).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
                if let line = grant.activityLine {
                    Text(line).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
            Spacer(minLength: 0)
            net
        }
        .padding(NestSpacing.xs)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// One recorded exercise or sale as a compact bordered card.
private struct ActivityCard: View {
    let row: ActivityRow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(row.title).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.text).lineLimit(1)
            Text(row.detail).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(NestSpacing.xs)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
