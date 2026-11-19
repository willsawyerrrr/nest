import Foundation

/// A trade's fields as read from a document, keyed as the `trade` columns are. A field
/// the document did not give, or that could not be read, is nil.
struct TradeValues: Equatable, Sendable {
    var ticker: String?
    var side: TradeSide?
    var tradedOn: String?
    var units: Double?
    /// Integer microdollars, converted from the printed text by `trade-extract`.
    var priceMicrodollars: Int64?
    var feeCents: Int?

    /// Whether nothing was read.
    var isEmpty: Bool {
        ticker == nil && side == nil && tradedOn == nil && units == nil
            && priceMicrodollars == nil && feeCents == nil
    }
}

/// One trade read from a document, as a draft's form starts from it.
struct ExtractedTrade: Equatable, Sendable {
    var values = TradeValues()
    /// Labels of the fields the member should fill in or check: not shown, or read but unusable.
    var check: [String] = []
}

/// How reading a document ended: its trades, or the reason it could not be read.
enum TradeExtractionOutcome: Equatable, Sendable {
    case read([ExtractedTrade])
    case unsupported(message: String)
    /// Reading is off for every document (not configured, out of credit, key refused).
    case off(message: String)
    case failed(message: String)
}

/// The client half of trade extraction, mirroring the PWA's `tradeExtraction.ts`: the
/// reading of the `trade-extract` reply into drafts, and of its failures into the message
/// the form shows. Nothing here writes a trade.
enum TradeExtractionReader {
    static let unsupportedMessage =
        "This document is attached, but it can't be read automatically. Enter the trade by hand."
    static let failedMessage = "Could not read this document. Enter the trades by hand."

    /// The codes `trade-extract` answers with when reading is off for every document.
    private static let offCodes: Set<String> = ["not_configured", "out_of_credit", "key_rejected"]

    /// The extraction fields' labels, keyed as the `trade` columns are, in field order.
    private static let labels: [(key: String, label: String)] = [
        ("ticker", "ticker"), ("side", "side"), ("traded_on", "date"), ("units", "units"),
        ("price_per_unit_microdollars", "price per unit"), ("fee_cents", "brokerage fee"),
    ]

    /// Reads a successful reply into its trades, or nil when the body is not one.
    static func readExtraction(_ data: Data) -> [ExtractedTrade]? {
        guard let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            body["model"] is String, let raw = body["trades"] as? [Any]
        else { return nil }
        let trades = raw.map(readTrade)
        return trades.contains { $0 == nil } ? nil : trades.compactMap { $0 }
    }

    /// Reads a non-2xx body (or none, for a transport failure) into the failure shown. The
    /// function's own message is used only when it came with a stable `code`.
    static func readFailure(_ data: Data?) -> TradeExtractionOutcome {
        let body = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
        let code = body?["code"] as? String
        if code == UploadRules.unsupportedTypeCode { return .unsupported(message: unsupportedMessage) }
        let message = code != nil ? (body?["error"] as? String) ?? failedMessage : failedMessage
        return code.map(offCodes.contains) == true ? .off(message: message) : .failed(message: message)
    }

    /// An outcome in the terms the bulk queue acts on; reading being off halts it.
    static func readResult(_ outcome: TradeExtractionOutcome) -> BulkUpload.ReadResult<[ExtractedTrade]> {
        switch outcome {
        case .read(let trades): .read(trades)
        case .unsupported(let message): .unsupported(message: message)
        case .off(let message): .halt(message: message)
        case .failed(let message): .failed(message: message)
        }
    }

    private static func readTrade(_ raw: Any) -> ExtractedTrade? {
        guard let trade = raw as? [String: Any], let fields = trade["fields"] as? [String: Any] else {
            return nil
        }
        var values = TradeValues()
        values.ticker = fields["ticker"] as? String
        values.side = (fields["side"] as? String).flatMap(TradeSide.init(rawValue:))
        values.tradedOn = fields["traded_on"] as? String
        values.units = number(fields["units"]).flatMap { $0 > 0 ? $0 : nil }
        values.priceMicrodollars = number(fields["price_per_unit_microdollars"]).flatMap {
            $0 >= 0 ? Int64($0.rounded()) : nil
        }
        values.feeCents = number(fields["fee_cents"]).flatMap { $0 >= 0 ? Int($0.rounded()) : nil }
        // A brokerage fee the document does not show is nil, not something to chase.
        let absent = labels(trade["missing"]).filter { $0 != "brokerage fee" }
        return ExtractedTrade(values: values, check: absent + labels(trade["unreadable"]))
    }

    /// The labels of `keys` that are extraction fields, in the order given.
    private static func labels(_ keys: Any?) -> [String] {
        ((keys as? [Any]) ?? []).compactMap { key in
            labels.first { $0.key == key as? String }?.label
        }
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            return nil
        }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }
}
