import Foundation

/// Row of `trade`.
struct Trade: NestRow {
    static let table = "trade"

    let createdAt: String
    let documentId: String?
    let externalId: String?
    let feeCents: Int
    let householdId: String
    let id: String
    let memberId: String
    let pricePerUnitMicrodollars: Int
    let side: String
    let source: String
    let ticker: String
    let tradedOn: String
    let units: Double
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case documentId = "document_id"
        case externalId = "external_id"
        case feeCents = "fee_cents"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case pricePerUnitMicrodollars = "price_per_unit_microdollars"
        case side
        case source
        case ticker
        case tradedOn = "traded_on"
        case units
        case updatedAt = "updated_at"
    }
}

/// Row of `equity_grant`.
struct EquityGrant: NestRow {
    static let table = "equity_grant"

    let cliffMonths: Int
    let createdAt: String
    let grantDate: String
    let householdId: String
    let id: String
    let instrumentType: String
    let label: String
    let memberId: String
    let priceAsOf: String?
    let pricePerShareCents: Int
    let quantity: Double
    let strikePriceCents: Int?
    let updatedAt: String
    let vestingFrequency: String
    let vestingPeriodMonths: Int

    enum CodingKeys: String, CodingKey, CaseIterable {
        case cliffMonths = "cliff_months"
        case createdAt = "created_at"
        case grantDate = "grant_date"
        case householdId = "household_id"
        case id
        case instrumentType = "instrument_type"
        case label
        case memberId = "member_id"
        case priceAsOf = "price_as_of"
        case pricePerShareCents = "price_per_share_cents"
        case quantity
        case strikePriceCents = "strike_price_cents"
        case updatedAt = "updated_at"
        case vestingFrequency = "vesting_frequency"
        case vestingPeriodMonths = "vesting_period_months"
    }
}

/// Row of `equity_exercise`.
struct EquityExercise: NestRow {
    static let table = "equity_exercise"

    let createdAt: String
    let exercisedOn: String
    let grantId: String
    let householdId: String
    let id: String
    let marketPricePerShareCents: Int?
    let memberId: String
    let quantity: Double
    let strikePriceCents: Int
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case exercisedOn = "exercised_on"
        case grantId = "grant_id"
        case householdId = "household_id"
        case id
        case marketPricePerShareCents = "market_price_per_share_cents"
        case memberId = "member_id"
        case quantity
        case strikePriceCents = "strike_price_cents"
        case updatedAt = "updated_at"
    }
}

/// Row of `equity_sale`.
struct EquitySale: NestRow {
    static let table = "equity_sale"

    let createdAt: String
    let feeCents: Int
    let grantId: String
    let householdId: String
    let id: String
    let memberId: String
    let pricePerShareCents: Int
    let quantity: Double
    let soldOn: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case feeCents = "fee_cents"
        case grantId = "grant_id"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case pricePerShareCents = "price_per_share_cents"
        case quantity
        case soldOn = "sold_on"
        case updatedAt = "updated_at"
    }
}

/// Row of `super_profile`.
struct SuperProfile: NestRow {
    static let table = "super_profile"

    let balanceAsOf: String?
    let carryForwardCapCents: Int
    let createdAt: String
    let financialYear: Int
    let fundName: String?
    let householdId: String
    let id: String
    let linkedAccountId: String?
    let memberId: String
    let sgRateOverride: Double?
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case balanceAsOf = "balance_as_of"
        case carryForwardCapCents = "carry_forward_cap_cents"
        case createdAt = "created_at"
        case financialYear = "financial_year"
        case fundName = "fund_name"
        case householdId = "household_id"
        case id
        case linkedAccountId = "linked_account_id"
        case memberId = "member_id"
        case sgRateOverride = "sg_rate_override"
        case updatedAt = "updated_at"
    }
}

/// Row of `deduction_group`.
struct DeductionGroup: NestRow {
    static let table = "deduction_group"

    let createdAt: String
    let financialYear: Int
    let householdId: String
    let id: String
    let kind: String
    let memberId: String
    let name: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case financialYear = "financial_year"
        case householdId = "household_id"
        case id
        case kind
        case memberId = "member_id"
        case name
        case updatedAt = "updated_at"
    }
}

/// Row of `deduction_receipt`.
struct DeductionReceipt: NestRow {
    static let table = "deduction_receipt"

    let createdAt: String
    let deductionId: String
    let householdId: String
    let id: String
    let storagePath: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case deductionId = "deduction_id"
        case householdId = "household_id"
        case id
        case storagePath = "storage_path"
    }
}

/// The columns of `share_grant` the signed-in member may read (never `token_hash`
/// or `created_by_member_id`). A household holds at most one, so the household
/// is its identity.
struct ShareGrant: NestRow {
    static let table = "share_grant"

    let createdAt: String
    let expiresAt: String
    let financialYear: Int
    let householdId: String
    let recipientEmail: String

    var id: String { householdId }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case expiresAt = "expires_at"
        case financialYear = "financial_year"
        case householdId = "household_id"
        case recipientEmail = "recipient_email"
    }
}
