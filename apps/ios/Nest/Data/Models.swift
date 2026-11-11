import Foundation

/// A Postgres row the native app reads. `CodingKeys` raw values are the exact
/// column names, so `NestRowSchemaTests` can compare them with the generated
/// PWA types and fail when a column is added, removed or renamed.
protocol NestRow: Codable, Identifiable, Sendable, Equatable {
    associatedtype CodingKeys: CodingKey & CaseIterable & RawRepresentable<String>
    static var table: String { get }
    /// The `select` list: `*` unless the role may read only some columns.
    static var columns: String { get }
}

extension NestRow {
    static var columns: String { "*" }
}

/// Postgres enum `frequency`.
enum Frequency: String, Codable, CaseIterable, Sendable {
    case weekly
    case fortnightly
    case monthly
    case annual
    case quarterly
    case biannual
    case everyNWeeks = "every_n_weeks"
    case everyNMonths = "every_n_months"
}

/// Postgres enum `budget_group`.
enum BudgetGroup: String, Codable, CaseIterable, Sendable {
    case needs
    case wants
    case discretionary
    case savings
    case investments
}

/// Postgres enum `account_type`.
enum AccountType: String, Codable, CaseIterable, Sendable {
    case transaction
    case savings
    case credit
    case offset
    case other
    case homeLoan = "home_loan"
}

/// Postgres enum `ledger_source`.
enum LedgerSource: String, Codable, CaseIterable, Sendable {
    case up
    case manual
    case redbark
}

/// Postgres enum `inflow_type`.
enum InflowType: String, Codable, CaseIterable, Sendable {
    case salary
    case wage
    case other
    case reimbursement
    case hobby
    case gift
}

/// Postgres enum `one_off_tax_treatment`.
enum OneOffTaxTreatment: String, Codable, CaseIterable, Sendable {
    case ordinary
    case genuineRedundancy = "genuine_redundancy"
    case employmentTermination = "employment_termination"
    case unusedLeave = "unused_leave"
}

/// Postgres enum `deduction_basis`.
enum DeductionBasis: String, Codable, CaseIterable, Sendable {
    case amount
    case distance
    case hours
}

/// Postgres enum `deduction_category`.
enum DeductionCategory: String, Codable, CaseIterable, Sendable {
    case workExpense = "work_expense"
    case donation
    case taxAgentFees = "tax_agent_fees"
}

/// Postgres enum `breakdown_kind`.
enum BreakdownKind: String, Codable, CaseIterable, Sendable {
    case generic
}

/// Postgres enum `tax_residency`.
enum TaxResidency: String, Codable, CaseIterable, Sendable {
    case resident
    case foreignResident = "foreign_resident"
}

/// Postgres enum `super_contribution_kind`.
enum SuperContributionKind: String, Codable, CaseIterable, Sendable {
    case salarySacrifice = "salary_sacrifice"
    case personalDeductible = "personal_deductible"
    case personalNonConcessional = "personal_non_concessional"
    case spouse
}

/// Postgres enum `super_contribution_mode`.
enum SuperContributionMode: String, Codable, CaseIterable, Sendable {
    case amount
    case percent
}

/// Row of `households`.
struct Household: NestRow {
    static let table = "households"

    let createdAt: String
    let id: String
    let inviteCode: String?
    let inviteCodeExpiresAt: String?
    let name: String
    let payAccountId: String?
    let timezone: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case id
        case inviteCode = "invite_code"
        case inviteCodeExpiresAt = "invite_code_expires_at"
        case name
        case payAccountId = "pay_account_id"
        case timezone
        case updatedAt = "updated_at"
    }
}

/// Row of `members`.
struct Member: NestRow {
    static let table = "members"

    let createdAt: String
    let dateOfBirth: String?
    let email: String?
    let householdId: String
    let id: String
    let name: String
    let upConnectedAt: String?
    let upSyncFailedAt: String?
    let updatedAt: String
    let userId: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case dateOfBirth = "date_of_birth"
        case email
        case householdId = "household_id"
        case id
        case name
        case upConnectedAt = "up_connected_at"
        case upSyncFailedAt = "up_sync_failed_at"
        case updatedAt = "updated_at"
        case userId = "user_id"
    }
}

/// Row of `wishlist_item`.
struct WishlistItem: NestRow {
    static let table = "wishlist_item"

    let amountCents: Int
    let createdAt: String
    let householdId: String
    let id: String
    let memberId: String?
    let name: String
    let note: String?
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case name
        case note
        case updatedAt = "updated_at"
    }
}

/// Row of `accounts`.
struct Account: NestRow {
    static let table = "accounts"

    let createdAt: String
    let currency: String
    let deletedFromSourceAt: String?
    let excludeFromNetWorth: Bool
    let externalId: String?
    let householdId: String
    let id: String
    let name: String
    let ownerMemberId: String?
    let source: LedgerSource
    let type: AccountType
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case currency
        case deletedFromSourceAt = "deleted_from_source_at"
        case excludeFromNetWorth = "exclude_from_net_worth"
        case externalId = "external_id"
        case householdId = "household_id"
        case id
        case name
        case ownerMemberId = "owner_member_id"
        case source
        case type
        case updatedAt = "updated_at"
    }
}

/// Row of `budget_line`.
struct BudgetLine: NestRow {
    static let table = "budget_line"

    let allowanceMemberId: String?
    let amountCents: Int
    let breakdownId: String?
    let createdAt: String
    let destinationAccountId: String?
    let frequency: Frequency
    let giftRecipientMemberId: String?
    let goalId: String?
    let householdId: String
    let id: String
    let intervalCount: Int?
    let isGiftLine: Bool
    let lineGroup: BudgetGroup
    let managementUrl: String?
    let name: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case allowanceMemberId = "allowance_member_id"
        case amountCents = "amount_cents"
        case breakdownId = "breakdown_id"
        case createdAt = "created_at"
        case destinationAccountId = "destination_account_id"
        case frequency
        case giftRecipientMemberId = "gift_recipient_member_id"
        case goalId = "goal_id"
        case householdId = "household_id"
        case id
        case intervalCount = "interval_count"
        case isGiftLine = "is_gift_line"
        case lineGroup = "line_group"
        case managementUrl = "management_url"
        case name
        case updatedAt = "updated_at"
    }
}

/// Row of `savings_goal`.
struct SavingsGoal: NestRow {
    static let table = "savings_goal"

    let annualInterestBps: Int?
    let createdAt: String
    let currentBalanceCents: Int
    let householdId: String
    let id: String
    let linkedAccountId: String?
    let name: String
    let plannedContributionCents: Int?
    let queuePosition: Int?
    let targetAmountCents: Int
    let targetDate: String?
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case annualInterestBps = "annual_interest_bps"
        case createdAt = "created_at"
        case currentBalanceCents = "current_balance_cents"
        case householdId = "household_id"
        case id
        case linkedAccountId = "linked_account_id"
        case name
        case plannedContributionCents = "planned_contribution_cents"
        case queuePosition = "queue_position"
        case targetAmountCents = "target_amount_cents"
        case targetDate = "target_date"
        case updatedAt = "updated_at"
    }
}

/// Row of `inflows`.
struct Inflow: NestRow {
    static let table = "inflows"

    let amountCents: Int?
    let arrivesEveryPayPeriod: Bool
    let attractsSuper: Bool
    let createdAt: String
    let endsOn: String?
    let hourlyRateCents: Int?
    let hoursPerPeriod: Double?
    let householdId: String
    let id: String
    let intervalCount: Int?
    let isJoint: Bool
    let memberId: String?
    let memberSplitPercent: Double?
    let name: String
    let oneOffTaxTreatment: OneOffTaxTreatment?
    let paidOn: String?
    let payAnchorDate: String?
    let payIntervalCount: Int?
    let paySchedule: Frequency?
    let schedule: Frequency?
    let startsOn: String?
    let taxable: Bool
    let type: InflowType
    let updatedAt: String
    let yearsOfService: Double?

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case arrivesEveryPayPeriod = "arrives_every_pay_period"
        case attractsSuper = "attracts_super"
        case createdAt = "created_at"
        case endsOn = "ends_on"
        case hourlyRateCents = "hourly_rate_cents"
        case hoursPerPeriod = "hours_per_period"
        case householdId = "household_id"
        case id
        case intervalCount = "interval_count"
        case isJoint = "is_joint"
        case memberId = "member_id"
        case memberSplitPercent = "member_split_percent"
        case name
        case oneOffTaxTreatment = "one_off_tax_treatment"
        case paidOn = "paid_on"
        case payAnchorDate = "pay_anchor_date"
        case payIntervalCount = "pay_interval_count"
        case paySchedule = "pay_schedule"
        case schedule
        case startsOn = "starts_on"
        case taxable
        case type
        case updatedAt = "updated_at"
        case yearsOfService = "years_of_service"
    }
}

/// Row of `payslip`.
struct Payslip: NestRow {
    static let table = "payslip"

    let createdAt: String
    let filePath: String?
    let financialYear: Int
    let grossCents: Int
    let householdId: String
    let id: String
    let memberId: String
    let netCents: Int
    let note: String?
    let paidOn: String?
    let periodEnd: String
    let periodStart: String
    let salarySacrificeCents: Int?
    let superCents: Int
    let taxWithheldCents: Int
    let updatedAt: String
    let ytdGrossCents: Int?
    let ytdSuperCents: Int?
    let ytdTaxWithheldCents: Int?

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case filePath = "file_path"
        case financialYear = "financial_year"
        case grossCents = "gross_cents"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case netCents = "net_cents"
        case note
        case paidOn = "paid_on"
        case periodEnd = "period_end"
        case periodStart = "period_start"
        case salarySacrificeCents = "salary_sacrifice_cents"
        case superCents = "super_cents"
        case taxWithheldCents = "tax_withheld_cents"
        case updatedAt = "updated_at"
        case ytdGrossCents = "ytd_gross_cents"
        case ytdSuperCents = "ytd_super_cents"
        case ytdTaxWithheldCents = "ytd_tax_withheld_cents"
    }
}

/// Postgres enum `payslip_line_kind`.
enum PayslipLineKind: String, Codable, CaseIterable, Sendable {
    case earning
    case tax
}

/// Postgres enum `payslip_tax_component`.
enum PayslipTaxComponent: String, Codable, CaseIterable, Sendable {
    case payg
    case stsl
}

/// Row of `payslip_line`.
struct PayslipLine: NestRow {
    static let table = "payslip_line"

    let amountCents: Int
    let attractsSuper: Bool?
    let createdAt: String
    let householdId: String
    let id: String
    let kind: PayslipLineKind
    let label: String
    let payslipId: String
    let sourceInflowId: String?
    let taxComponent: PayslipTaxComponent?
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case attractsSuper = "attracts_super"
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case kind
        case label
        case payslipId = "payslip_id"
        case sourceInflowId = "source_inflow_id"
        case taxComponent = "tax_component"
        case updatedAt = "updated_at"
    }
}

/// Row of `deduction`.
struct Deduction: NestRow {
    static let table = "deduction"

    let amountCents: Int
    let basis: DeductionBasis
    let category: DeductionCategory
    let createdAt: String
    let deductionDate: String
    let description: String
    let distanceKm: Double?
    let financialYear: Int
    let fullAmountCents: Int
    let groupId: String?
    let householdId: String
    let id: String
    let memberId: String
    let updatedAt: String
    let workFromHomeHours: Double?
    let workUsePercent: Double

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case basis
        case category
        case createdAt = "created_at"
        case deductionDate = "deduction_date"
        case description
        case distanceKm = "distance_km"
        case financialYear = "financial_year"
        case fullAmountCents = "full_amount_cents"
        case groupId = "group_id"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case updatedAt = "updated_at"
        case workFromHomeHours = "work_from_home_hours"
        case workUsePercent = "work_use_percent"
    }
}

/// Row of `pay_split`.
struct PaySplit: NestRow {
    static let table = "pay_split"

    let accountId: String
    let confirmedAt: String
    let confirmedFortnightlyCents: Int
    let createdAt: String
    let householdId: String
    let id: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case accountId = "account_id"
        case confirmedAt = "confirmed_at"
        case confirmedFortnightlyCents = "confirmed_fortnightly_cents"
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case updatedAt = "updated_at"
    }
}

/// Row of `tax_profile`.
struct TaxProfile: NestRow {
    static let table = "tax_profile"

    let createdAt: String
    let financialYear: Int
    let hasPrivateHospitalCover: Bool
    let householdId: String
    let id: String
    let memberId: String
    let residency: TaxResidency
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case financialYear = "financial_year"
        case hasPrivateHospitalCover = "has_private_hospital_cover"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case residency
        case updatedAt = "updated_at"
    }
}

/// Row of `super_contribution`.
struct SuperContribution: NestRow {
    static let table = "super_contribution"

    let amountCents: Int?
    let contributorMemberId: String?
    let createdAt: String
    let fhssEligible: Bool
    let financialYear: Int
    let frequency: Frequency
    let householdId: String
    let id: String
    let intervalCount: Int?
    let kind: SuperContributionKind
    let memberId: String
    let mode: SuperContributionMode
    let percentBp: Int?
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case contributorMemberId = "contributor_member_id"
        case createdAt = "created_at"
        case fhssEligible = "fhss_eligible"
        case financialYear = "financial_year"
        case frequency
        case householdId = "household_id"
        case id
        case intervalCount = "interval_count"
        case kind
        case memberId = "member_id"
        case mode
        case percentBp = "percent_bp"
        case updatedAt = "updated_at"
    }
}

/// Row of `help_debt`.
struct HelpDebt: NestRow {
    static let table = "help_debt"

    let balanceCents: Int
    let createdAt: String
    let householdId: String
    let id: String
    let memberId: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case balanceCents = "balance_cents"
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case updatedAt = "updated_at"
    }
}

/// Row of `temporary_item`.
struct TemporaryItem: NestRow {
    static let table = "temporary_item"

    let contributionCents: Int
    let createdAt: String
    let householdId: String
    let id: String
    let name: String
    let targetDate: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case contributionCents = "contribution_cents"
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case name
        case targetDate = "target_date"
        case updatedAt = "updated_at"
    }
}

/// Row of `member_allowance`.
struct MemberAllowance: NestRow {
    static let table = "member_allowance"

    let amountCents: Int
    let createdAt: String
    let destinationAccountId: String?
    let frequency: Frequency
    let householdId: String
    let id: String
    let intervalCount: Int?
    let memberId: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case createdAt = "created_at"
        case destinationAccountId = "destination_account_id"
        case frequency
        case householdId = "household_id"
        case id
        case intervalCount = "interval_count"
        case memberId = "member_id"
        case updatedAt = "updated_at"
    }
}

/// Row of the `accounts_with_balance` view: an account and its latest balance.
/// The view's columns are all nullable.
struct AccountWithBalance: NestRow {
    static let table = "accounts_with_balance"

    let balanceCents: Int?
    let createdAt: String?
    let currency: String?
    let deletedFromSourceAt: String?
    let excludeFromNetWorth: Bool?
    let externalId: String?
    let householdId: String?
    let id: String?
    let name: String?
    let ownerMemberId: String?
    let source: LedgerSource?
    let type: AccountType?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey, CaseIterable {
        case balanceCents = "balance_cents"
        case createdAt = "created_at"
        case currency
        case deletedFromSourceAt = "deleted_from_source_at"
        case excludeFromNetWorth = "exclude_from_net_worth"
        case externalId = "external_id"
        case householdId = "household_id"
        case id
        case name
        case ownerMemberId = "owner_member_id"
        case source
        case type
        case updatedAt = "updated_at"
    }
}

/// Row of the `account_directory` view: an account's identity without its
/// balance, including every member's spending accounts. The view's columns are
/// all nullable.
struct AccountDirectoryEntry: NestRow {
    static let table = "account_directory"

    let deletedFromSourceAt: String?
    let householdId: String?
    let id: String?
    let name: String?
    let ownerMemberId: String?
    let source: LedgerSource?
    let type: AccountType?

    enum CodingKeys: String, CodingKey, CaseIterable {
        case deletedFromSourceAt = "deleted_from_source_at"
        case householdId = "household_id"
        case id
        case name
        case ownerMemberId = "owner_member_id"
        case source
        case type
    }
}

/// Row of `breakdown`.
struct Breakdown: NestRow {
    static let table = "breakdown"

    let createdAt: String
    let householdId: String
    let id: String
    let kind: BreakdownKind
    let lineGroup: BudgetGroup
    let name: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case kind
        case lineGroup = "line_group"
        case name
        case updatedAt = "updated_at"
    }
}

/// Row of `breakdown_item`.
struct BreakdownItem: NestRow {
    static let table = "breakdown_item"

    let amountCents: Int
    let breakdownId: String
    let createdAt: String
    let frequency: Frequency
    let householdId: String
    let id: String
    let intervalCount: Int?
    let name: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case breakdownId = "breakdown_id"
        case createdAt = "created_at"
        case frequency
        case householdId = "household_id"
        case id
        case intervalCount = "interval_count"
        case name
        case updatedAt = "updated_at"
    }
}

/// Row of `gift_recipient`.
struct GiftRecipient: NestRow {
    static let table = "gift_recipient"

    let createdAt: String
    let householdId: String
    let id: String
    let memberId: String?
    let name: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case name
        case updatedAt = "updated_at"
    }
}

/// Row of `gift_occasion`.
struct GiftOccasion: NestRow {
    static let table = "gift_occasion"

    let createdAt: String
    let householdId: String
    let id: String
    let name: String
    let occasionDate: String?
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case name
        case occasionDate = "occasion_date"
        case updatedAt = "updated_at"
    }
}

/// Row of `gift_budget`.
struct GiftBudget: NestRow {
    static let table = "gift_budget"

    let budgetedAmountCents: Int
    let createdAt: String
    let eventDate: String?
    let householdId: String
    let id: String
    let occasionId: String
    let recipientId: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case budgetedAmountCents = "budgeted_amount_cents"
        case createdAt = "created_at"
        case eventDate = "event_date"
        case householdId = "household_id"
        case id
        case occasionId = "occasion_id"
        case recipientId = "recipient_id"
        case updatedAt = "updated_at"
    }
}

/// Row of `gift_purchase`.
struct GiftPurchase: NestRow {
    static let table = "gift_purchase"

    let amountCents: Int
    let createdAt: String
    let description: String
    let giftBudgetId: String?
    let giftDiscretionaryBudgetId: String?
    let householdId: String
    let id: String
    let purchasedOn: String
    let recipientId: String?
    let transactionId: String?
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case amountCents = "amount_cents"
        case createdAt = "created_at"
        case description
        case giftBudgetId = "gift_budget_id"
        case giftDiscretionaryBudgetId = "gift_discretionary_budget_id"
        case householdId = "household_id"
        case id
        case purchasedOn = "purchased_on"
        case recipientId = "recipient_id"
        case transactionId = "transaction_id"
        case updatedAt = "updated_at"
    }
}

/// Row of `gift_discretionary_budget`.
struct GiftDiscretionaryBudget: NestRow {
    static let table = "gift_discretionary_budget"

    let budgetedAmountCents: Int
    let createdAt: String
    let householdId: String
    let id: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case budgetedAmountCents = "budgeted_amount_cents"
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case updatedAt = "updated_at"
    }
}

/// Row of `gift_transaction_dismissal`.
struct GiftTransactionDismissal: NestRow {
    static let table = "gift_transaction_dismissal"

    let createdAt: String
    let householdId: String
    let id: String
    let transactionId: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case transactionId = "transaction_id"
        case updatedAt = "updated_at"
    }
}

/// Row of `transactions`, as the gift inbox reads it.
struct GiftTransaction: NestRow {
    static let table = "transactions"

    let accountId: String
    let amountCents: Int
    let categoryId: String?
    let createdAt: String
    let description: String
    let externalCategory: String?
    let externalId: String?
    let householdId: String
    let id: String
    let kind: String
    let memberId: String?
    let notes: String?
    let postedAt: String
    let source: LedgerSource
    let status: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case accountId = "account_id"
        case amountCents = "amount_cents"
        case categoryId = "category_id"
        case createdAt = "created_at"
        case description
        case externalCategory = "external_category"
        case externalId = "external_id"
        case householdId = "household_id"
        case id
        case kind
        case memberId = "member_id"
        case notes
        case postedAt = "posted_at"
        case source
        case status
        case updatedAt = "updated_at"
    }
}

/// Row of `redbark_connection`.
struct RedbarkConnection: NestRow {
    static let table = "redbark_connection"

    let createdAt: String
    let householdId: String
    let id: String
    let institutionName: String?
    let memberId: String
    let status: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case householdId = "household_id"
        case id
        case institutionName = "institution_name"
        case memberId = "member_id"
        case status
        case updatedAt = "updated_at"
    }
}

/// The readable columns of `calendar_feed` (never `token_hash`, the credential:
/// a `select *` fails because the role lacks privilege on it).
struct CalendarFeed: NestRow {
    static let table = "calendar_feed"
    static let columns = "household_id,created_at"

    let createdAt: String
    let householdId: String

    var id: String { householdId }

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case householdId = "household_id"
    }
}

/// Postgres enum `notification_trigger`.
enum NotificationTrigger: String, Codable, CaseIterable, Sendable {
    case bufferNegative = "buffer_negative"
    case goalEtaSlipped = "goal_eta_slipped"
    case temporaryItemExpiring = "temporary_item_expiring"
    case fyBoundary = "fy_boundary"
    case giftPurchaseUnassigned = "gift_purchase_unassigned"
    case giftCandidateNew = "gift_candidate_new"
    case upDisconnected = "up_disconnected"
}

/// Row of `notification_preference`.
struct NotificationPreference: NestRow {
    static let table = "notification_preference"

    let createdAt: String
    let enabled: Bool
    let householdId: String
    let id: String
    let memberId: String
    let trigger: NotificationTrigger
    let updatedAt: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case createdAt = "created_at"
        case enabled
        case householdId = "household_id"
        case id
        case memberId = "member_id"
        case trigger
        case updatedAt = "updated_at"
    }
}
