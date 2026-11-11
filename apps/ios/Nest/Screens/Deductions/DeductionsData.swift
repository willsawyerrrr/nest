import Foundation

/// Every row the Deductions screen reads for one financial year.
struct DeductionsRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var deductions: [Deduction] = []
    var groups: [DeductionGroup] = []
    var receipts: [DeductionReceipt] = []

    /// The four tables as the PWA hooks read them: members by name, and the
    /// year-bound deductions (by date) and groups (by name) scoped to `financialYear`.
    static func sources(financialYear: Int) -> [TableSource<DeductionsRows>] {
        let year = [Filter.eq("financial_year", String(financialYear))]
        return [
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(Deduction.self, filters: year, order: [Order(column: "deduction_date")]) {
                $0.deductions = $1
            },
            .table(DeductionGroup.self, filters: year, order: [Order(column: "name")]) {
                $0.groups = $1
            },
            .table(DeductionReceipt.self, order: [Order(column: "created_at")]) {
                $0.receipts = $1
            },
        ]
    }
}

/// The deduction columns a form writes. Nullable columns encode as an explicit
/// `null`, as the PWA's writes do; `id`, `household_id` and `financial_year` are
/// sent only when creating.
struct DeductionWrite: Encodable, Equatable, Sendable {
    var id: String?
    var householdID: String?
    var financialYear: Int?
    var memberID: String
    var description: String
    var amountCents: Int
    var deductionDate: String
    var basis: DeductionBasis
    var distanceKm: Double?
    var workFromHomeHours: Double?
    var groupID: String?
    var category: DeductionCategory
    var fullAmountCents: Int
    var workUsePercent: Double

    enum CodingKeys: String, CodingKey {
        case id
        case householdID = "household_id"
        case financialYear = "financial_year"
        case memberID = "member_id"
        case description
        case amountCents = "amount_cents"
        case deductionDate = "deduction_date"
        case basis
        case distanceKm = "distance_km"
        case workFromHomeHours = "work_from_home_hours"
        case groupID = "group_id"
        case category
        case fullAmountCents = "full_amount_cents"
        case workUsePercent = "work_use_percent"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encodeIfPresent(householdID, forKey: .householdID)
        try container.encodeIfPresent(financialYear, forKey: .financialYear)
        try container.encode(memberID, forKey: .memberID)
        try container.encode(description, forKey: .description)
        try container.encode(amountCents, forKey: .amountCents)
        try container.encode(deductionDate, forKey: .deductionDate)
        try container.encode(basis, forKey: .basis)
        try container.encode(distanceKm, forKey: .distanceKm)
        try container.encode(workFromHomeHours, forKey: .workFromHomeHours)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(category, forKey: .category)
        try container.encode(fullAmountCents, forKey: .fullAmountCents)
        try container.encode(workUsePercent, forKey: .workUsePercent)
    }

    /// The whole row written back with only its group changed, as a drag does.
    init(moving deduction: Deduction, to groupID: String?) {
        self.init(
            memberID: deduction.memberId, description: deduction.description,
            amountCents: deduction.amountCents, deductionDate: deduction.deductionDate,
            basis: deduction.basis, distanceKm: deduction.distanceKm,
            workFromHomeHours: deduction.workFromHomeHours, groupID: groupID,
            category: deduction.category, fullAmountCents: deduction.fullAmountCents,
            workUsePercent: deduction.workUsePercent)
    }

    init(
        id: String? = nil, householdID: String? = nil, financialYear: Int? = nil,
        memberID: String, description: String, amountCents: Int, deductionDate: String,
        basis: DeductionBasis, distanceKm: Double?, workFromHomeHours: Double?,
        groupID: String?, category: DeductionCategory, fullAmountCents: Int,
        workUsePercent: Double
    ) {
        self.id = id
        self.householdID = householdID
        self.financialYear = financialYear
        self.memberID = memberID
        self.description = description
        self.amountCents = amountCents
        self.deductionDate = deductionDate
        self.basis = basis
        self.distanceKm = distanceKm
        self.workFromHomeHours = workFromHomeHours
        self.groupID = groupID
        self.category = category
        self.fullAmountCents = fullAmountCents
        self.workUsePercent = workUsePercent
    }
}

/// What the add form saves: the id it minted for the deduction (and for the
/// receipt already stored under it), the deduction's fields, and the stored
/// receipt's path, if any.
struct DeductionSubmission: Equatable, Sendable {
    let id: String
    let write: DeductionWrite
    let receiptPath: String?
}

/// The columns a group form writes.
struct DeductionGroupWrite: Encodable, Equatable, Sendable {
    var householdID: String?
    var financialYear: Int?
    var memberID: String
    var name: String

    enum CodingKeys: String, CodingKey {
        case householdID = "household_id"
        case financialYear = "financial_year"
        case memberID = "member_id"
        case name
    }
}
