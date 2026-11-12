import Foundation

/// Every row the Investments screen reads.
struct InvestmentsRows: Codable, Sendable, Equatable {
    var trades: [Trade] = []
    var members: [Member] = []
    var documents: [TradeDocument] = []

    /// Trades oldest first (a sale is matched against earlier purchases, so every year
    /// is read), members by name and the stored documents, as the PWA reads them.
    static var sources: [TableSource<InvestmentsRows>] {
        [
            .table(Trade.self, order: [Order(column: "traded_on"), Order(column: "created_at")]) {
                $0.trades = $1
            },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(TradeDocument.self, order: [Order(column: "created_at")]) { $0.documents = $1 },
        ]
    }

    /// The engine input: every trade and the members to report.
    var input: PortfolioInput {
        PortfolioInput(trades: trades, memberIds: members.map(\.id))
    }

    /// The household new trades belong to (every member row shares it).
    var householdID: String? { members.first?.householdId }
}

/// The fields a trade form supplies, as the PWA's `TradeInput`.
struct TradeInput: Encodable, Equatable, Sendable {
    let memberID: String
    let ticker: String
    let side: TradeSide
    let tradedOn: String
    let units: Double
    let priceMicrodollars: Int64
    let feeCents: Int64

    enum CodingKeys: String, CodingKey {
        case ticker, side, units
        case memberID = "member_id"
        case tradedOn = "traded_on"
        case priceMicrodollars = "price_per_unit_microdollars"
        case feeCents = "fee_cents"
    }
}

/// An insert body: the input plus the owning household.
struct TradeInsert: Encodable, Sendable {
    let householdID: String
    let input: TradeInput

    enum CodingKeys: String, CodingKey { case householdID = "household_id" }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(householdID, forKey: .householdID)
        try input.encode(to: encoder)
    }
}
