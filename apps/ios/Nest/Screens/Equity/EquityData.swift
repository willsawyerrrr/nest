import Foundation

/// Every row the Equity screen reads.
struct EquityRows: Codable, Sendable, Equatable {
    var grants: [EquityGrant] = []
    var exercises: [EquityExercise] = []
    var sales: [EquitySale] = []
    var members: [Member] = []

    /// The grants by grant date, the exercises and sales oldest first, and the
    /// members by name, as the PWA reads them.
    static var sources: [TableSource<EquityRows>] {
        [
            .table(EquityGrant.self, order: [Order(column: "grant_date")]) { $0.grants = $1 },
            .table(
                EquityExercise.self,
                order: [Order(column: "exercised_on"), Order(column: "created_at")]
            ) { $0.exercises = $1 },
            .table(
                EquitySale.self, order: [Order(column: "sold_on"), Order(column: "created_at")]
            ) { $0.sales = $1 },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
        ]
    }

    /// The household new rows belong to (every member row shares it).
    var householdID: String? { members.first?.householdId }

    /// The engine input at `now`: every grant with its exercises and sales.
    func input(now: Date) -> EquityInput {
        EquityInput(
            grants: grants, exercises: exercises.map(EquityInput.Movement.init),
            sales: sales.map(EquityInput.Movement.init), now: SummaryRows.iso(now))
    }
}

/// The engine's `EquityInput`. Grants encode with their column names.
struct EquityInput: Encodable, Sendable {
    /// An exercise or sale, as the roll-up reads it.
    struct Movement: Encodable, Sendable {
        let grantId: String
        let quantity: Double

        enum CodingKeys: String, CodingKey {
            case grantId = "grant_id"
            case quantity
        }

        init(_ exercise: EquityExercise) {
            grantId = exercise.grantId
            quantity = exercise.quantity
        }

        init(_ sale: EquitySale) {
            grantId = sale.grantId
            quantity = sale.quantity
        }
    }

    let grants: [EquityGrant]
    let exercises: [Movement]
    let sales: [Movement]
    let now: String
}

/// The fields the grant form supplies, as the PWA's `EquityGrantInput`. Every
/// column encodes, a cleared one as `null`, so an edit can unset it.
struct EquityGrantInput: Encodable, Equatable, Sendable {
    let memberID: String
    let label: String
    let instrumentType: String
    let quantity: Int
    let grantDate: String
    let cliffMonths: Int
    let vestingPeriodMonths: Int
    let vestingFrequency: String
    let strikePriceCents: Int?
    let pricePerShareCents: Int
    let priceAsOf: String?

    enum CodingKeys: String, CodingKey {
        case label, quantity
        case memberID = "member_id"
        case instrumentType = "instrument_type"
        case grantDate = "grant_date"
        case cliffMonths = "cliff_months"
        case vestingPeriodMonths = "vesting_period_months"
        case vestingFrequency = "vesting_frequency"
        case strikePriceCents = "strike_price_cents"
        case pricePerShareCents = "price_per_share_cents"
        case priceAsOf = "price_as_of"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(memberID, forKey: .memberID)
        try container.encode(label, forKey: .label)
        try container.encode(instrumentType, forKey: .instrumentType)
        try container.encode(quantity, forKey: .quantity)
        try container.encode(grantDate, forKey: .grantDate)
        try container.encode(cliffMonths, forKey: .cliffMonths)
        try container.encode(vestingPeriodMonths, forKey: .vestingPeriodMonths)
        try container.encode(vestingFrequency, forKey: .vestingFrequency)
        try container.encode(strikePriceCents, forKey: .strikePriceCents)
        try container.encode(pricePerShareCents, forKey: .pricePerShareCents)
        try container.encode(priceAsOf, forKey: .priceAsOf)
    }
}

/// The fields the exercise form supplies, as the PWA's `EquityExerciseInput`.
struct EquityExerciseInput: Encodable, Equatable, Sendable {
    let memberID: String
    let grantID: String
    let exercisedOn: String
    let quantity: Int
    let strikePriceCents: Int
    let marketPricePerShareCents: Int?

    enum CodingKeys: String, CodingKey {
        case quantity
        case memberID = "member_id"
        case grantID = "grant_id"
        case exercisedOn = "exercised_on"
        case strikePriceCents = "strike_price_cents"
        case marketPricePerShareCents = "market_price_per_share_cents"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(memberID, forKey: .memberID)
        try container.encode(grantID, forKey: .grantID)
        try container.encode(exercisedOn, forKey: .exercisedOn)
        try container.encode(quantity, forKey: .quantity)
        try container.encode(strikePriceCents, forKey: .strikePriceCents)
        try container.encode(marketPricePerShareCents, forKey: .marketPricePerShareCents)
    }
}

/// The fields the sale form supplies, as the PWA's `EquitySaleInput`.
struct EquitySaleInput: Encodable, Equatable, Sendable {
    let memberID: String
    let grantID: String
    let soldOn: String
    let quantity: Int
    let pricePerShareCents: Int
    let feeCents: Int

    enum CodingKeys: String, CodingKey {
        case quantity
        case memberID = "member_id"
        case grantID = "grant_id"
        case soldOn = "sold_on"
        case pricePerShareCents = "price_per_share_cents"
        case feeCents = "fee_cents"
    }
}

/// An insert body: a form's input plus the owning household.
struct EquityInsert<Input: Encodable & Sendable>: Encodable, Sendable {
    let householdID: String
    let input: Input

    enum CodingKeys: String, CodingKey { case householdID = "household_id" }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(householdID, forKey: .householdID)
        try input.encode(to: encoder)
    }
}
