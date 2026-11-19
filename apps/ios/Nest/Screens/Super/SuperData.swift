import Foundation

/// Every row the Super screen reads.
struct SuperRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var inflows: [Inflow] = []
    var profiles: [SuperProfile] = []
    var contributions: [SuperContribution] = []
    var accounts: [AccountWithBalance] = []

    /// The tables, scoped to `financialYear` where the PWA scopes them. Members and
    /// accounts are ordered by name, as the PWA reads them.
    static func sources(financialYear: Int) -> [TableSource<SuperRows>] {
        let year = Filter.eq("financial_year", String(financialYear))
        return [
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(Inflow.self) { $0.inflows = $1 },
            .table(SuperProfile.self, filters: [year]) { $0.profiles = $1 },
            .table(SuperContribution.self, filters: [year]) { $0.contributions = $1 },
            .table(AccountWithBalance.self, order: [Order(column: "name")]) { $0.accounts = $1 },
        ]
    }

    /// A member's profile for the year.
    func profile(of member: Member) -> SuperProfile? {
        profiles.first { $0.memberId == member.id }
    }

    /// The account holding a member's super balance.
    func account(of member: Member) -> AccountWithBalance? {
        guard let id = profile(of: member)?.linkedAccountId else { return nil }
        return accounts.first { $0.id == id }
    }

    /// The household new rows belong to (every member row shares it).
    var householdID: String? { members.first?.householdId }

    /// The `summariseSuper` input at `now`: each member's confirmed balance from
    /// their linked account, with the rows the cap summary reads.
    func input(now: Date) -> SuperInput {
        SuperInput(
            inflows: inflows, profiles: profiles, contributions: contributions, members: members,
            baselines: members.map { member in
                SuperInput.Baseline(
                    memberId: member.id, baselineCents: account(of: member)?.balanceCents ?? 0,
                    balanceAsOf: profile(of: member)?.balanceAsOf)
            },
            now: SummaryRows.iso(now))
    }
}

/// The engine's `SuperInput`. Rows encode with their column names.
struct SuperInput: Encodable, Sendable {
    struct Baseline: Encodable, Sendable {
        let memberId: String
        let baselineCents: Int
        let balanceAsOf: String?
    }

    let inflows: [Inflow]
    let profiles: [SuperProfile]
    let contributions: [SuperContribution]
    let members: [Member]
    let baselines: [Baseline]
    let now: String
}

/// The retirement projection's household-wide assumptions; percentages are whole
/// numbers as shown (7 is 7%).
struct RetirementAssumptions: Codable, Equatable, Sendable {
    var retirementAge: Double
    var expectedReturnPct: Double
    var inflationPct: Double
    var contributionGrowthPct: Double
}

/// The engine's `summariseSuper` result.
struct SuperSummary: Codable, Equatable, Sendable {
    /// A member's use of the contribution caps. Figures are cents, possibly
    /// fractional for a percent-of-salary contribution.
    struct Caps: Codable, Equatable, Sendable {
        var concessionalCents: Double
        var concessionalCapCents: Double
        var concessionalOverCap: Bool
        var nonConcessionalCents: Double
        var nonConcessionalCapCents: Double
        var nonConcessionalOverCap: Bool
        var coContributionCents: Double
    }

    struct Member: Codable, Equatable, Sendable {
        var memberId: String
        /// `nil` for a member with neither a contribution nor a profile.
        var caps: Caps?
        var netAnnualContributionCents: Int64
        var effectiveBalanceCents: Int64
    }

    var preservationAge: Int
    var defaultAssumptions: RetirementAssumptions
    var members: [Member]
}

/// The engine's `projectSuper` input: each member's balance, contribution and age.
struct SuperProjectionsInput: Encodable, Sendable {
    struct Entry: Encodable, Sendable {
        let currentBalanceCents: Int64
        let netAnnualContributionCents: Int64
        let age: Double?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(currentBalanceCents, forKey: .currentBalanceCents)
            try container.encode(netAnnualContributionCents, forKey: .netAnnualContributionCents)
            try container.encode(age, forKey: .age)
        }

        enum CodingKeys: String, CodingKey {
            case currentBalanceCents, netAnnualContributionCents, age
        }
    }

    let entries: [Entry]
    let assumptions: RetirementAssumptions
}

/// A member's projected balance at retirement, in nominal and today's dollars.
struct SuperProjection: Codable, Equatable, Sendable {
    var nominalCents: Int64
    var realCents: Int64
    var yearsToRetirement: Int
}

/// The values the super profile form submits for one member, as the PWA's
/// `SuperFormValues`: the fund name (empty when none) and the confirmed balance.
struct SuperProfileValues: Equatable, Sendable {
    let fundName: String
    let balanceCents: Int
}

/// The fields a contribution form supplies, as the PWA's `SuperContributionInput`.
/// Exactly one of `amountCents` (mode `amount`) or `percentBp` (mode `percent`) is set.
struct SuperContributionInput: Encodable, Equatable, Sendable {
    let memberID: String
    let kind: SuperContributionKind
    let mode: SuperContributionMode
    let amountCents: Int?
    let percentBp: Int?
    let frequency: Frequency
    let intervalCount: Int?
    let fhssEligible: Bool
    let contributorMemberID: String?

    enum CodingKeys: String, CodingKey {
        case kind, mode, frequency
        case memberID = "member_id"
        case amountCents = "amount_cents"
        case percentBp = "percent_bp"
        case intervalCount = "interval_count"
        case fhssEligible = "fhss_eligible"
        case contributorMemberID = "contributor_member_id"
    }

    /// Encodes every column, nulls included, so an update clears what the form unset.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(memberID, forKey: .memberID)
        try container.encode(kind, forKey: .kind)
        try container.encode(mode, forKey: .mode)
        try container.encode(amountCents, forKey: .amountCents)
        try container.encode(percentBp, forKey: .percentBp)
        try container.encode(frequency, forKey: .frequency)
        try container.encode(intervalCount, forKey: .intervalCount)
        try container.encode(fhssEligible, forKey: .fhssEligible)
        try container.encode(contributorMemberID, forKey: .contributorMemberID)
    }
}

/// A contribution insert body: the input plus its household and financial year.
struct SuperContributionInsert: Encodable, Sendable {
    let householdID: String
    let financialYear: Int
    let input: SuperContributionInput

    enum CodingKeys: String, CodingKey {
        case householdID = "household_id"
        case financialYear = "financial_year"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(householdID, forKey: .householdID)
        try container.encode(financialYear, forKey: .financialYear)
        try input.encode(to: encoder)
    }
}

/// A super profile upsert body, keyed on `member_id, financial_year`.
struct SuperProfileUpsert: Encodable, Sendable {
    let householdID: String
    let financialYear: Int
    let memberID: String
    let fundName: String?
    let linkedAccountID: String
    let balanceAsOf: String

    enum CodingKeys: String, CodingKey {
        case householdID = "household_id"
        case financialYear = "financial_year"
        case memberID = "member_id"
        case fundName = "fund_name"
        case linkedAccountID = "linked_account_id"
        case balanceAsOf = "balance_as_of"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(householdID, forKey: .householdID)
        try container.encode(financialYear, forKey: .financialYear)
        try container.encode(memberID, forKey: .memberID)
        try container.encode(fundName, forKey: .fundName)
        try container.encode(linkedAccountID, forKey: .linkedAccountID)
        try container.encode(balanceAsOf, forKey: .balanceAsOf)
    }
}

/// A manual account created to hold a member's super balance.
struct SuperAccountInsert: Encodable, Sendable {
    let householdID: String
    let ownerMemberID: String
    let name: String
    let source = LedgerSource.manual
    let type = AccountType.savings

    enum CodingKeys: String, CodingKey {
        case name, source, type
        case householdID = "household_id"
        case ownerMemberID = "owner_member_id"
    }
}

/// A renamed account.
struct AccountRename: Encodable, Sendable {
    let name: String
}

/// An `account_balance` upsert body, keyed on `account_id`.
struct AccountBalanceUpsert: Encodable, Sendable {
    let accountID: String
    let householdID: String
    let balanceCents: Int

    enum CodingKeys: String, CodingKey {
        case accountID = "account_id"
        case householdID = "household_id"
        case balanceCents = "balance_cents"
    }
}
