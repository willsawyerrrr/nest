import Foundation

/// One row of `budget_actual_spend`: a group's spend, or spend in no group.
struct ActualSpendRow: Codable, Equatable, Sendable {
    let lineGroup: BudgetGroup?
    let spentCents: Int64

    enum CodingKeys: String, CodingKey {
        case lineGroup = "line_group"
        case spentCents = "spent_cents"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(lineGroup, forKey: .lineGroup)
        try container.encode(spentCents, forKey: .spentCents)
    }
}

/// The arguments of `budget_actual_spend`.
struct ActualSpendParams: Encodable, Equatable, Sendable {
    /// The function's name, which also keys its cached results.
    static let function = "budget_actual_spend"

    let start: String
    let end: String
    let includePending: Bool

    init(period: SpendPeriod, includePending: Bool) {
        start = period.periodStart
        end = period.periodEnd
        self.includePending = includePending
    }

    enum CodingKeys: String, CodingKey {
        case start = "p_start"
        case end = "p_end"
        case includePending = "p_include_pending"
    }
}

/// The engine's `SpendFortnightInput`: the inflows placing the pay cycle, today
/// and how many fortnights to step from it.
struct SpendFortnightInput: Encodable, Sendable {
    struct PayCycleInflow: Encodable, Sendable {
        let type: InflowType
        let paidOn: String?
        let payAnchorDate: String?

        init(_ inflow: Inflow) {
            type = inflow.type
            paidOn = inflow.paidOn
            payAnchorDate = inflow.payAnchorDate
        }

        enum CodingKeys: String, CodingKey {
            case type
            case paidOn = "paid_on"
            case payAnchorDate = "pay_anchor_date"
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(type, forKey: .type)
            try container.encode(paidOn, forKey: .paidOn)
            try container.encode(payAnchorDate, forKey: .payAnchorDate)
        }
    }

    let inflows: [PayCycleInflow]
    let today: String
    let offset: Int
}

/// The engine's `ActualSpendInput`: the RPC's rows as returned.
struct ActualSpendInput: Encodable, Sendable {
    let rows: [ActualSpendRow]
}
