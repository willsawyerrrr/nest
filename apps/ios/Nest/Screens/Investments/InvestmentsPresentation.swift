import Foundation

/// Pure presentation of the Investments screen, mirroring the PWA's `TradesScreen`
/// and the label helpers in `lib/trades.ts`, so both surfaces label identically.
struct InvestmentsPresentation: Equatable, Sendable {
    static let title = "Investments"
    static let intro =
        "Each member’s share and ETF trades. Holdings, cost base, and realised gains are worked out from them — sales are matched to the oldest purchases first, and a parcel held more than 12 months earns the 50% CGT discount. Holdings count toward net worth at the last traded price, and the net capital gain joins the tax estimate."
    static let emptyMessage = "No trades yet."
    static let addLabel = "Add trade"
    static let deleteTitle = "Delete trade?"
    static let saveError = "Could not save this trade. Please try again."
    static let duplicateWarning =
        "You already have a trade with this ticker, date, units, and price. Save it only if it is a separate trade."
    static let handoffTitle = "Contract notes"
    static let handoffMessage =
        "Reading trades from a contract note, trade confirmation or statement happens in the web app. Open it to attach a document and review each trade."
    static let handoffAction = "Add from a contract note"

    /// One holdings or realised-gains line.
    struct Line: Equatable, Sendable {
        let title: String
        let cells: [String]
        let figureCents: Int
        let caption: String
    }

    /// One trade as listed.
    struct TradeItem: Equatable, Identifiable, Sendable {
        let id: String
        let side: TradeSide
        let ticker: String
        let date: String
        let units: String
        let price: String
        /// `$9.50 brokerage`, or empty when there is none.
        let brokerage: String
        /// The fee alone, or `nil` when there is none.
        let fee: String?
        let valueCents: Int
        let documentPath: String?
        let deleteLabel: String

        var sideLabel: String { side == .buy ? "Buy" : "Sell" }
    }

    /// One member's holdings, gains, oversold-unit notes and trades.
    struct Section: Equatable, Identifiable, Sendable {
        let memberID: String
        let name: String
        let holdings: [Line]
        let gains: [Line]
        let unmatched: [String]
        let trades: [TradeItem]

        var id: String { memberID }
    }

    let sections: [Section]
    let members: [Member]
    private let trades: [Trade]

    init(content: InvestmentsContent) {
        let rows = content.rows
        members = rows.members
        trades = rows.trades
        let values = Dictionary(
            content.portfolio.tradeValues.map { ($0.tradeId, Int($0.valueCents)) },
            uniquingKeysWith: { first, _ in first })
        let paths = Dictionary(
            rows.documents.map { ($0.id, $0.storagePath) }, uniquingKeysWith: { first, _ in first })
        sections = rows.members.map { member in
            let portfolio = content.portfolio.members.first { $0.memberId == member.id }
            let mine = rows.trades.enumerated().filter { $0.element.memberId == member.id }
            // Newest first; ties keep the order they were read in.
            let ordered = mine.sorted {
                $0.element.tradedOn == $1.element.tradedOn
                    ? $0.offset < $1.offset : $0.element.tradedOn > $1.element.tradedOn
            }
            return Section(
                memberID: member.id, name: member.name,
                holdings: (portfolio?.holdings ?? []).map(Self.line),
                gains: (portfolio?.gainsByYear ?? []).map(Self.line),
                unmatched: (portfolio?.unmatchedSales ?? []).map { sale in
                    "\(Self.units(sale.units)) \(sale.ticker) sold on \(Self.date(sale.soldOn)) exceed the units bought, so they are left out of the gains. Check the trades below."
                },
                trades: ordered.map { item in
                    let trade = item.element
                    return TradeItem(
                        id: trade.id, side: TradeSide(rawValue: trade.side) ?? .buy, ticker: trade.ticker,
                        date: Self.date(trade.tradedOn), units: Self.unitsText(trade.units),
                        price: "at \(Self.unitPrice(Int64(trade.pricePerUnitMicrodollars)))",
                        brokerage: trade.feeCents > 0
                            ? "\(MoneyFormat.cents(trade.feeCents)) brokerage" : "",
                        fee: trade.feeCents > 0 ? MoneyFormat.cents(trade.feeCents) : nil,
                        valueCents: values[trade.id] ?? 0,
                        documentPath: trade.documentId.flatMap { paths[$0] },
                        deleteLabel:
                            "\(trade.side == "buy" ? "Buy" : "Sell") \(trade.ticker), \(Self.date(trade.tradedOn))"
                    )
                })
        }
    }

    /// Whether `candidate` repeats an existing trade (same member, ticker, date,
    /// units and price), ignoring the trade being edited.
    func isRepeat(_ candidate: TradeInput, ignoring id: String?) -> Bool {
        trades.contains {
            $0.id != id && $0.memberId == candidate.memberID && $0.ticker == candidate.ticker
                && $0.tradedOn == candidate.tradedOn && $0.units == candidate.units
                && Int64($0.pricePerUnitMicrodollars) == candidate.priceMicrodollars
        }
    }

    private static func line(_ holding: Portfolio.Holding) -> Line {
        Line(
            title: holding.ticker,
            cells: [
                unitsText(holding.units),
                "Avg cost \(unitPrice(holding.averageCostMicrodollars))",
                "Cost base \(MoneyFormat.cents(Int(holding.costBaseCents)))",
            ],
            figureCents: Int(holding.valueCents),
            caption: "at \(unitPrice(holding.lastPriceMicrodollars))")
    }

    private static func line(_ year: Portfolio.GainsYear) -> Line {
        Line(
            title: "FY\(year.financialYear)",
            cells: [
                "Gains \(MoneyFormat.cents(Int(year.gainsCents + year.discountableGainsCents)))",
                "Losses \(MoneyFormat.cents(Int(year.lossesCents + year.carriedInLossesCents)))",
                year.discountCents > 0
                    ? "CGT discount \(MoneyFormat.cents(Int(year.discountCents)))" : "",
            ],
            figureCents: Int(year.netCapitalGainCents), caption: "net capital gain")
    }

    private static let locale = Locale(identifier: "en_AU")

    /// Units without trailing zeros, grouped by thousands.
    static func units(_ units: Double) -> String {
        units.formatted(.number.precision(.fractionLength(0...6)).locale(locale))
    }

    /// Units with their noun: `1 unit`, `1.5 units`.
    static func unitsText(_ units: Double) -> String {
        "\(Self.units(units)) \(units == 1 ? "unit" : "units")"
    }

    /// A unit price held as microdollars, with two to six decimal places.
    static func unitPrice(_ microdollars: Int64) -> String {
        (Decimal(microdollars) / 1_000_000).formatted(
            .currency(code: "AUD").precision(.fractionLength(2...6)).locale(locale))
    }

    private static let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
    ]

    /// An ISO date (`YYYY-MM-DD`) as `28 Feb 2027`, with the en-AU `Sept`.
    static func date(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { return iso }
        return "\(parts[2]) \(months[parts[1] - 1]) \(parts[0])"
    }
}
