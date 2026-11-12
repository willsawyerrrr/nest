import Foundation

/// The trade form's fields as typed, and the rules turning them into a `TradeInput`
/// as the PWA's `TradeForm` does. Amounts are parsed by the engine's `tradeFigures`.
struct TradeDraft: Equatable, Sendable {
    var side = TradeSide.buy
    var ticker = ""
    /// ISO `YYYY-MM-DD`.
    var tradedOn: String
    var units = ""
    var price = ""
    var fee = ""

    init(today: String) { tradedOn = today }

    init(trade: Trade) {
        side = TradeSide(rawValue: trade.side) ?? .buy
        ticker = trade.ticker
        tradedOn = trade.tradedOn
        units = Self.decimal(trade.units)
        price = Self.microdollars(Int64(trade.pricePerUnitMicrodollars))
        fee = trade.feeCents > 0 ? Self.cents(trade.feeCents) : ""
    }

    /// The typed amounts, for the engine to parse.
    var figuresInput: TradeFiguresInput { TradeFiguresInput(units: units, price: price, fee: fee) }

    /// A trade needs a ticker, a date, positive units and a price.
    func canSubmit(_ figures: TradeFigures?) -> Bool {
        guard let figures, let units = figures.units, let _ = figures.priceMicrodollars else {
            return false
        }
        return !ticker.trimmingCharacters(in: .whitespaces).isEmpty && units > 0
    }

    /// The input to save, or `nil` while the draft cannot be submitted.
    func input(memberID: String, figures: TradeFigures?) -> TradeInput? {
        guard canSubmit(figures), let figures, let units = figures.units,
            let price = figures.priceMicrodollars
        else { return nil }
        return TradeInput(
            memberID: memberID,
            ticker: ticker.trimmingCharacters(in: .whitespaces).uppercased(), side: side,
            tradedOn: tradedOn, units: units, priceMicrodollars: price, feeCents: figures.feeCents)
    }

    /// Units as a plain decimal, without grouping or trailing zeros.
    static func decimal(_ units: Double) -> String {
        units.formatted(
            .number.grouping(.never).precision(.fractionLength(0...6))
                .locale(Locale(identifier: "en_US")))
    }

    /// Microdollars as a dollars field value, without trailing zeros.
    static func microdollars(_ value: Int64) -> String {
        var fraction = String(value % 1_000_000)
        fraction = String(repeating: "0", count: 6 - fraction.count) + fraction
        while fraction.hasSuffix("0") { fraction.removeLast() }
        return fraction.isEmpty ? "\(value / 1_000_000)" : "\(value / 1_000_000).\(fraction)"
    }

    /// Cents as a two-decimal dollars field value.
    static func cents(_ value: Int) -> String {
        "\(value / 100).\(String(format: "%02d", value % 100))"
    }
}
