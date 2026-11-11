import Foundation

/// Every row the Inflows screen reads.
struct InflowsRows: Codable, Sendable, Equatable {
    var inflows: [Inflow] = []
    var members: [Member] = []

    init(inflows: [Inflow] = [], members: [Member] = []) {
        self.inflows = inflows
        self.members = members
    }

    /// A fixture or cached snapshot may carry only the inflows.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        inflows = try container.decode([Inflow].self, forKey: .inflows)
        members = try container.decodeIfPresent([Member].self, forKey: .members) ?? []
    }

    /// The two tables, the inflows ordered by name as the PWA reads them.
    static var sources: [TableSource<InflowsRows>] {
        [
            .table(Inflow.self, order: [Order(column: "name")]) { $0.inflows = $1 },
            .table(Member.self) { $0.members = $1 },
        ]
    }

    /// The engine input: the inflows, from which each fortnightly figure is drawn.
    var input: InflowsInput { InflowsInput(inflows: inflows) }

    /// The rows with the planning sandbox's inflow layer laid over them.
    func sandboxed(by state: PlanningState) -> InflowsRows {
        var rows = self
        rows.inflows = state.layer(.inflows).apply(to: inflows)
        return rows
    }
}

/// The engine's `InflowsInput`. Inflows encode with their column names.
struct InflowsInput: Codable, Sendable, Equatable {
    let inflows: [Inflow]
}

/// The engine's per-inflow fortnightly figures; `nil` for a one-off.
struct InflowFortnightlies: Codable, Sendable, Equatable {
    struct Item: Codable, Sendable, Equatable {
        var inflowId: String
        var fortnightlyCents: Int64?
    }

    var items: [Item]
}

/// What one payment on the pay cadence comes to (the engine's `PerPayment`).
struct PerPayment: Codable, Sendable, Equatable {
    var cents: Int64
    var annualCents: Int64
    var statedAnnualCents: Int64
    var noun: String
}

/// How a taxable one-off splits under its treatment (the engine's `OneOffPaymentSplit`).
struct OneOffSplit: Codable, Sendable, Equatable {
    var taxFreeCents: Int64
    var assessableCents: Int64
    var concessionalCents: Int64
    var concessionalRate: Double
}

/// The engine's `InflowDraftInput`: what the form has entered so far.
struct InflowDraftInput: Codable, Sendable, Equatable {
    struct OneOff: Codable, Sendable, Equatable {
        var treatment: String
        var amountCents: Int
        var yearsOfService: Int?
        var dateOfBirth: String?
        var paidOn: String
    }

    var now: String
    var isWage: Bool
    var schedule: String
    var interval: Int?
    var amountCents: Int?
    var hourlyRateCents: Int?
    var hoursPerPeriod: Double?
    var payCadence: String?
    var payInterval: Int?
    var oneOff: OneOff?

    /// Absent optionals stay absent, as the engine reads `undefined`; `payCadence`
    /// and a one-off's `dateOfBirth` are explicit `null`s when unset.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(now, forKey: .now)
        try container.encode(isWage, forKey: .isWage)
        try container.encode(schedule, forKey: .schedule)
        try container.encodeIfPresent(interval, forKey: .interval)
        try container.encodeIfPresent(amountCents, forKey: .amountCents)
        try container.encodeIfPresent(hourlyRateCents, forKey: .hourlyRateCents)
        try container.encodeIfPresent(hoursPerPeriod, forKey: .hoursPerPeriod)
        try container.encode(payCadence, forKey: .payCadence)
        try container.encodeIfPresent(payInterval, forKey: .payInterval)
        try container.encodeIfPresent(oneOff, forKey: .oneOff)
    }
}

extension InflowDraftInput.OneOff {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(treatment, forKey: .treatment)
        try container.encode(amountCents, forKey: .amountCents)
        try container.encodeIfPresent(yearsOfService, forKey: .yearsOfService)
        try container.encode(dateOfBirth, forKey: .dateOfBirth)
        try container.encode(paidOn, forKey: .paidOn)
    }
}

/// What the form shows back before anything is saved (the engine's `InflowDraftPreview`).
struct InflowDraftPreview: Codable, Sendable, Equatable {
    var statedAnnualCents: Int64?
    var perPayment: PerPayment?
    var split: OneOffSplit?
}

/// The columns an inflow save writes, as the PWA's `InflowInput`. Every optional
/// column encodes as an explicit `null`, so an edit clears what the form no longer
/// carries (a one-off's cadence, a recurring inflow's date).
struct InflowInput: Encodable, Equatable, Sendable {
    var name: String
    var taxable: Bool
    var memberId: String?
    var type: InflowType
    var attractsSuper: Bool
    var schedule: Frequency?
    var paidOn: String?
    var oneOffTaxTreatment: OneOffTaxTreatment?
    var yearsOfService: Int?
    var intervalCount: Int?
    var isJoint: Bool
    var memberSplitPercent: Int?
    var paySchedule: Frequency?
    var payIntervalCount: Int?
    var arrivesEveryPayPeriod: Bool
    var amountCents: Int?
    var hourlyRateCents: Int?
    var hoursPerPeriod: Double?
    var startsOn: String?
    var endsOn: String?
    var payAnchorDate: String?

    enum CodingKeys: String, CodingKey {
        case name, taxable, type, schedule
        case memberId = "member_id"
        case attractsSuper = "attracts_super"
        case paidOn = "paid_on"
        case oneOffTaxTreatment = "one_off_tax_treatment"
        case yearsOfService = "years_of_service"
        case intervalCount = "interval_count"
        case isJoint = "is_joint"
        case memberSplitPercent = "member_split_percent"
        case paySchedule = "pay_schedule"
        case payIntervalCount = "pay_interval_count"
        case arrivesEveryPayPeriod = "arrives_every_pay_period"
        case amountCents = "amount_cents"
        case hourlyRateCents = "hourly_rate_cents"
        case hoursPerPeriod = "hours_per_period"
        case startsOn = "starts_on"
        case endsOn = "ends_on"
        case payAnchorDate = "pay_anchor_date"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(taxable, forKey: .taxable)
        try c.encode(memberId, forKey: .memberId)
        try c.encode(type, forKey: .type)
        try c.encode(attractsSuper, forKey: .attractsSuper)
        try c.encode(schedule, forKey: .schedule)
        try c.encode(paidOn, forKey: .paidOn)
        try c.encode(oneOffTaxTreatment, forKey: .oneOffTaxTreatment)
        try c.encode(yearsOfService, forKey: .yearsOfService)
        try c.encode(intervalCount, forKey: .intervalCount)
        try c.encode(isJoint, forKey: .isJoint)
        try c.encode(memberSplitPercent, forKey: .memberSplitPercent)
        try c.encode(paySchedule, forKey: .paySchedule)
        try c.encode(payIntervalCount, forKey: .payIntervalCount)
        try c.encode(arrivesEveryPayPeriod, forKey: .arrivesEveryPayPeriod)
        try c.encode(amountCents, forKey: .amountCents)
        try c.encode(hourlyRateCents, forKey: .hourlyRateCents)
        try c.encode(hoursPerPeriod, forKey: .hoursPerPeriod)
        try c.encode(startsOn, forKey: .startsOn)
        try c.encode(endsOn, forKey: .endsOn)
        try c.encode(payAnchorDate, forKey: .payAnchorDate)
    }

    /// The row a create writes: the columns plus the household.
    func insertValues(householdID: String) -> InsertValues {
        InsertValues(input: self, householdId: householdID)
    }

    struct InsertValues: Encodable, Sendable {
        let input: InflowInput
        let householdId: String

        func encode(to encoder: Encoder) throws {
            try input.encode(to: encoder)
            var container = encoder.container(keyedBy: ExtraKey.self)
            try container.encode(householdId, forKey: .householdId)
        }

        private enum ExtraKey: String, CodingKey { case householdId = "household_id" }
    }
}
