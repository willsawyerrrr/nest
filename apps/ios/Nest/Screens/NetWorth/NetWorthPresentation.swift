import SwiftUI

/// The net worth palette (`netWorthHues` in the PWA's `tokens.ts`): each key's
/// Mantine hue, a deeper shade on light and a vivid one on dark, shared by the
/// projection chart's bands and the section glyphs.
enum NetWorthColor: CaseIterable {
    case superannuation, cash, equity, liability, debtAccount, excluded, total

    var color: Color {
        switch self {
        case .superannuation: Color(light: Color(hex: 0x0CA678), dark: Color(hex: 0x20C997))
        case .cash: Color(light: Color(hex: 0x4C6EF5), dark: Color(hex: 0x5C7CFA))
        case .equity: Color(light: Color(hex: 0x7950F2), dark: Color(hex: 0x845EF7))
        case .liability: NestColor.negative
        case .debtAccount: Color(light: Color(hex: 0xF76707), dark: Color(hex: 0xFF922B))
        case .excluded: Color(light: Color(hex: 0x868E96), dark: Color(hex: 0xADB5BD))
        case .total: NestColor.navActiveText
        }
    }
}

/// One year of the chart: the bands and the net worth line, as the PWA plots them.
struct ProjectionRow: Equatable, Identifiable, Sendable {
    let year: String
    let superCents: Int
    let cashCents: Int
    let equityCents: Int
    let helpCents: Int
    let debtCents: Int
    let totalCents: Int
    var id: String { year }
}

/// A line of the chart's breakdown for one year.
struct ProjectionTooltipItem: Equatable, Identifiable, Sendable {
    let label: String
    let color: NetWorthColor
    let cents: Int
    var id: String { label }
}

/// The Net worth screen's figures labelled and grouped as the PWA's `NetWorthView`
/// shows them.
struct NetWorthPresentation: Sendable {
    static let superEmpty = "No super accounts yet. Add a balance on the Super tab."
    static let otherEmpty = "No other accounts yet."
    static let chartEmpty = "Add super, account balances, or equity to project your net worth forward."
    static let equityNote =
        "Unexercised options are valued if exercised today, net of the strike price, and exercised options and granted shares at the price per share less any sold (see the Equity tab); shares and ETFs at their last traded price (see the Investments tab)."
    static let chartNote =
        "Estimated future (nominal) dollars from your retirement assumptions. The areas are your assets and the line is net worth — assets less your liabilities (HELP debt and debt accounts), which are itemised in the tooltip. Super compounds and accrues contributions, cash grows by ongoing savings-goal contributions, equity grows as it vests at today’s price, HELP debt follows its projected paydown, and debt-account balances are held flat."

    let content: NetWorthContent

    var breakdown: NetWorthOutcome.Breakdown { content.outcome.breakdown }
    var totalCents: Int { breakdown.totalCents }
    var baselineTotalCents: Int? { content.baseline?.breakdown.totalCents }
    var projectionEndCents: Int { content.outcome.projection.last?.totalCents ?? 0 }
    var baselineProjectionEndCents: Int? {
        content.baseline.map { $0.projection.last?.totalCents ?? 0 }
    }

    /// Super always counts, so only the other and excluded groups can be edited.
    var hasTogglable: Bool {
        !breakdown.otherAccounts.isEmpty || !breakdown.excludedAccounts.isEmpty
    }

    var hasData: Bool {
        content.outcome.projection.contains {
            $0.superCents > 0 || $0.otherCents > 0 || $0.equityCents > 0 || $0.helpCents > 0
                || $0.debtCents > 0
        }
    }

    var showsEquity: Bool { content.outcome.projection.contains { $0.equityCents > 0 } }

    var rows: [ProjectionRow] {
        content.outcome.projection.map {
            ProjectionRow(
                year: String(content.outcome.projectionBaseYear + $0.year), superCents: $0.superCents,
                cashCents: $0.otherCents, equityCents: $0.equityCents, helpCents: $0.helpCents,
                debtCents: $0.debtCents, totalCents: $0.totalCents)
        }
    }

    /// Every asset as a positive item and every liability as a negative one, so
    /// the liabilities the chart does not plot are still itemised.
    static func tooltipItems(_ row: ProjectionRow) -> [ProjectionTooltipItem] {
        var items: [ProjectionTooltipItem] = []
        if row.superCents > 0 { items.append(.init(label: "Super", color: .superannuation, cents: row.superCents)) }
        if row.cashCents > 0 { items.append(.init(label: "Cash & other", color: .cash, cents: row.cashCents)) }
        if row.equityCents > 0 { items.append(.init(label: "Equity", color: .equity, cents: row.equityCents)) }
        if row.helpCents > 0 { items.append(.init(label: "HELP debt", color: .liability, cents: -row.helpCents)) }
        if row.debtCents > 0 {
            items.append(.init(label: "Debt accounts", color: .debtAccount, cents: -row.debtCents))
        }
        return items
    }
}
