import Foundation

extension Frequency {
    /// Whether the cadence reads an interval count.
    var isEveryN: Bool { self == .everyNWeeks || self == .everyNMonths }

    /// `amountCents` annualised to whole cents, as `@nest/plan`'s `annualCents`: a
    /// fixed cadence multiplies exactly, an every-N one rounds `amount × 52 (or 12) /
    /// interval`, and an every-N one without a usable interval is zero.
    func annualCents(_ amountCents: Int, interval: Int?) -> Int {
        switch self {
        case .weekly: amountCents * 52
        case .fortnightly: amountCents * 26
        case .monthly: amountCents * 12
        case .quarterly: amountCents * 4
        case .biannual: amountCents * 2
        case .annual: amountCents
        case .everyNWeeks: Self.every(amountCents, perYear: 52, interval)
        case .everyNMonths: Self.every(amountCents, perYear: 12, interval)
        }
    }

    private static func every(_ amountCents: Int, perYear: Int, _ interval: Int?) -> Int {
        guard let interval, interval >= 1 else { return 0 }
        return Int((Double(amountCents * perYear) / Double(interval)).rounded())
    }
}

/// A budget line's subscription management link, as the PWA's `managementUrl`.
enum ManagementURL {
    /// The longest link the database accepts.
    static let maxLength = 2048

    /// The copy shown under a link that is neither blank nor normalisable.
    static let invalidMessage = "Enter a web address starting with http:// or https://"

    private static let bareDomain = try! NSRegularExpression(
        pattern: #"^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$"#, options: .caseInsensitive)

    /// A typed link as a storable http(s) URL, or `nil` when blank or not one. A
    /// bare domain gains `https://`; any other scheme or malformed address is refused.
    static func normalise(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        let bare = bareDomain.firstMatch(in: trimmed, range: range) != nil
        let candidate = bare ? "https://\(trimmed)" : trimmed
        guard candidate.count <= maxLength,
            candidate.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
            let components = URLComponents(string: candidate),
            let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
            let host = components.host, !host.isEmpty
        else { return nil }
        return candidate
    }

    /// Whether a link field is acceptable: blank (it is optional) or normalisable.
    static func isValid(_ value: String) -> Bool {
        value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || normalise(value) != nil
    }
}

/// The overdraw copy, as the PWA's `allowances` module fixes it.
enum AllowanceCopy {
    /// The `prevent_allowance_overdraw` guards' refusal token.
    static let refusal = "allowance_overdrawn"
    /// Saving an item that would overdraw its allowance.
    static let itemOverdraws =
        "That is more than is left in the allowance. Lower the amount, or draw it from elsewhere."
    /// Lowering an allowance below what is drawn from it.
    static let belowDrawn = "An allowance cannot be lowered below what is already drawn from it."
}

/// An allowance a line can be drawn from: the signed-in member's own, with the
/// annual amount still undrawn.
struct AllowanceChoice: Codable, Equatable, Sendable {
    var memberId: String
    var name: String
    var remainingAnnualCents: Int
}

/// A wishlist item promoted to a budget line: its name and amount seed a new line.
struct BudgetLineDraft: Codable, Equatable, Hashable, Sendable {
    var name: String
    var amountCents: Int
}

/// The columns a manual budget line's save writes, every one stated so an edit
/// clears what the form cleared.
struct BudgetLineInput: Codable, Equatable, Sendable {
    var lineGroup: BudgetGroup
    var name: String
    var amountCents: Int
    var frequency: Frequency
    var intervalCount: Int?
    var goalId: String?
    var breakdownId: String?
    var destinationAccountId: String?
    var allowanceMemberId: String?
    var giftRecipientMemberId: String?
    var isGiftLine: Bool
    var managementUrl: String?

    enum CodingKeys: String, CodingKey {
        case name, frequency
        case lineGroup = "line_group"
        case amountCents = "amount_cents"
        case intervalCount = "interval_count"
        case goalId = "goal_id"
        case breakdownId = "breakdown_id"
        case destinationAccountId = "destination_account_id"
        case allowanceMemberId = "allowance_member_id"
        case giftRecipientMemberId = "gift_recipient_member_id"
        case isGiftLine = "is_gift_line"
        case managementUrl = "management_url"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(lineGroup, forKey: .lineGroup)
        try c.encode(name, forKey: .name)
        try c.encode(amountCents, forKey: .amountCents)
        try c.encode(frequency, forKey: .frequency)
        try c.encode(intervalCount, forKey: .intervalCount)
        try c.encode(goalId, forKey: .goalId)
        try c.encode(breakdownId, forKey: .breakdownId)
        try c.encode(destinationAccountId, forKey: .destinationAccountId)
        try c.encode(allowanceMemberId, forKey: .allowanceMemberId)
        try c.encode(giftRecipientMemberId, forKey: .giftRecipientMemberId)
        try c.encode(isGiftLine, forKey: .isGiftLine)
        try c.encode(managementUrl, forKey: .managementUrl)
    }

    /// The input that rewrites `line` unchanged.
    init(_ line: BudgetLine) {
        lineGroup = line.lineGroup
        name = line.name
        amountCents = line.amountCents
        frequency = line.frequency
        intervalCount = line.intervalCount
        goalId = line.goalId
        breakdownId = line.breakdownId
        destinationAccountId = line.destinationAccountId
        allowanceMemberId = line.allowanceMemberId
        giftRecipientMemberId = line.giftRecipientMemberId
        isGiftLine = line.isGiftLine
        managementUrl = line.managementUrl
    }

    init(
        lineGroup: BudgetGroup, name: String, amountCents: Int, frequency: Frequency,
        intervalCount: Int?, goalId: String?, destinationAccountId: String?,
        allowanceMemberId: String?, managementUrl: String?
    ) {
        self.lineGroup = lineGroup
        self.name = name
        self.amountCents = amountCents
        self.frequency = frequency
        self.intervalCount = intervalCount
        self.goalId = goalId
        breakdownId = nil
        self.destinationAccountId = destinationAccountId
        self.allowanceMemberId = allowanceMemberId
        giftRecipientMemberId = nil
        isGiftLine = false
        self.managementUrl = managementUrl
    }

    /// The row a create writes: the columns plus the household.
    func insertValues(householdID: String) -> InsertValues {
        InsertValues(input: self, householdId: householdID)
    }

    struct InsertValues: Encodable, Sendable {
        let input: BudgetLineInput
        let householdId: String

        func encode(to encoder: Encoder) throws {
            try input.encode(to: encoder)
            var container = encoder.container(keyedBy: ExtraKey.self)
            try container.encode(householdId, forKey: .householdId)
        }

        private enum ExtraKey: String, CodingKey { case householdId = "household_id" }
    }
}

/// The manual add/edit form's fields and rules, mirroring the PWA's
/// `BudgetLineForm`: what each group offers, what a group change clears, the
/// overdraw guard, whether the draft can be saved and the columns a save writes.
/// Text fields hold what was typed, as the PWA's inputs do.
struct BudgetLineFormState: Codable, Equatable, Sendable {
    var group: BudgetGroup
    var name: String
    var frequency: Frequency
    var interval: String
    var amount: String
    var goalId: String?
    var destinationAccountId: String?
    var allowanceMemberId: String?
    var managementUrl: String
    /// The line under edit, for what it already draws from its allowance.
    var initial: BudgetLine?
    /// The allowances a Discretionary line may draw from: the member's own.
    var allowances: [AllowanceChoice]

    /// A new line (seeded from `draft`, in `defaultGroup`, drawn from
    /// `defaultAllowanceMemberId`), or the form for `initial`.
    init(
        initial: BudgetLine? = nil, draft: BudgetLineDraft? = nil,
        defaultGroup: BudgetGroup? = nil, defaultAllowanceMemberId: String? = nil,
        allowances: [AllowanceChoice] = []
    ) {
        self.initial = initial
        self.allowances = allowances
        group = initial?.lineGroup ?? defaultGroup ?? .needs
        name = initial?.name ?? draft?.name ?? ""
        frequency = initial?.frequency ?? .fortnightly
        interval = initial?.intervalCount.map(String.init) ?? ""
        amount = InflowFormState.dollars(initial?.amountCents ?? draft?.amountCents)
        goalId = initial?.goalId
        destinationAccountId = initial?.destinationAccountId
        allowanceMemberId = initial?.allowanceMemberId ?? defaultAllowanceMemberId
        managementUrl = initial?.managementUrl ?? ""
    }

    /// Whether lines in `group` may link a savings goal (the database allows only these).
    static func linksGoal(_ group: BudgetGroup) -> Bool {
        group == .savings || group == .investments
    }

    /// Switches group, clearing what the new group cannot carry: a goal outside
    /// Savings/Investments, a funding account inside them, an allowance outside
    /// Discretionary.
    mutating func setGroup(_ next: BudgetGroup) {
        group = next
        if Self.linksGoal(next) { destinationAccountId = nil } else { goalId = nil }
        if next != .discretionary { allowanceMemberId = nil }
    }

    var showsGoalPicker: Bool { Self.linksGoal(group) }
    var showsAllowancePicker: Bool { group == .discretionary && !allowances.isEmpty }

    /// The allowance the line is drawn from, when it is.
    var drawnFrom: AllowanceChoice? {
        guard showsAllowancePicker else { return nil }
        return allowances.first { $0.memberId == allowanceMemberId }
    }

    /// A drawn line takes its funding from the allowance, and a goal-linked line
    /// from its goal, so neither offers an account.
    var showsAccountPicker: Bool { !Self.linksGoal(group) && drawnFrom == nil }

    var isIntervalValid: Bool { InflowFormState.isIntervalValid(interval) }
    var isManagementUrlValid: Bool { ManagementURL.isValid(managementUrl) }
    var amountCents: Int { InflowFormState.cents(amount) ?? 0 }
    /// Whether the amount is a number of at least zero, as the PWA's `min={0}` input holds it.
    var isAmountValid: Bool { InflowFormState.cents(amount).map { $0 >= 0 } ?? false }

    private var intervalCount: Int? {
        frequency.isEveryN && isIntervalValid ? Int(Double(interval)!) : nil
    }

    /// Whether the line would draw more over a year than its allowance has left,
    /// counting back what this line already draws when editing.
    var overdraws: Bool {
        guard let drawnFrom else { return false }
        let itemAnnual = frequency.annualCents(amountCents, interval: intervalCount)
        let already: Int
        if let initial, let member = initial.allowanceMemberId, member == drawnFrom.memberId {
            already = initial.frequency.annualCents(initial.amountCents, interval: initial.intervalCount)
        } else {
            already = 0
        }
        return itemAnnual > drawnFrom.remainingAnnualCents + already
    }

    var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && isAmountValid
            && (!frequency.isEveryN || isIntervalValid)
            && isManagementUrlValid
            && !overdraws
    }

    /// The columns the save writes, or `nil` while the draft cannot be saved.
    var input: BudgetLineInput? {
        guard canSubmit else { return nil }
        return BudgetLineInput(
            lineGroup: group, name: name.trimmingCharacters(in: .whitespaces),
            amountCents: amountCents, frequency: frequency,
            intervalCount: frequency.isEveryN ? intervalCount : nil,
            goalId: showsGoalPicker ? goalId : nil,
            destinationAccountId: showsAccountPicker ? destinationAccountId : nil,
            allowanceMemberId: drawnFrom?.memberId,
            managementUrl: ManagementURL.normalise(managementUrl))
    }

    /// The copy a failed save shows: the overdraw refusal's own, else the generic.
    static func failureMessage(_ error: Error) -> String {
        (error as? NestError)?.refusal == AllowanceCopy.refusal
            ? AllowanceCopy.itemOverdraws : "Could not save this budget item. Please try again."
    }
}

/// The columns an allowance's save writes.
struct MemberAllowanceInput: Codable, Equatable, Sendable {
    var amountCents: Int
    var frequency: Frequency
    var intervalCount: Int?
    var destinationAccountId: String?

    enum CodingKeys: String, CodingKey {
        case frequency
        case amountCents = "amount_cents"
        case intervalCount = "interval_count"
        case destinationAccountId = "destination_account_id"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(amountCents, forKey: .amountCents)
        try c.encode(frequency, forKey: .frequency)
        try c.encode(intervalCount, forKey: .intervalCount)
        try c.encode(destinationAccountId, forKey: .destinationAccountId)
    }
}

/// The allowance edit form's fields and rules, mirroring the PWA's `MemberAllowanceForm`.
struct MemberAllowanceFormState: Codable, Equatable, Sendable {
    var amount: String
    var frequency: Frequency
    var interval: String
    var accountId: String?
    /// The annual cents already drawn, when readable; the allowance cannot go below it.
    var drawnAnnualCents: Int

    init(initial: MemberAllowance, drawnAnnualCents: Int = 0) {
        amount = InflowFormState.dollars(initial.amountCents)
        frequency = initial.frequency
        interval = initial.intervalCount.map(String.init) ?? ""
        accountId = initial.destinationAccountId
        self.drawnAnnualCents = drawnAnnualCents
    }

    var isIntervalValid: Bool { InflowFormState.isIntervalValid(interval) }
    var cents: Int? { InflowFormState.cents(amount).flatMap { $0 >= 0 ? $0 : nil } }

    var belowDrawn: Bool {
        guard let cents, !frequency.isEveryN || isIntervalValid else { return false }
        let interval = frequency.isEveryN ? Int(Double(self.interval)!) : nil
        return frequency.annualCents(cents, interval: interval) < drawnAnnualCents
    }

    var canSubmit: Bool { cents != nil && (!frequency.isEveryN || isIntervalValid) && !belowDrawn }

    var input: MemberAllowanceInput? {
        guard canSubmit, let cents else { return nil }
        return MemberAllowanceInput(
            amountCents: cents, frequency: frequency,
            intervalCount: frequency.isEveryN ? Int(Double(interval)!) : nil,
            destinationAccountId: accountId)
    }

    static func failureMessage(_ error: Error) -> String {
        (error as? NestError)?.refusal == AllowanceCopy.refusal
            ? AllowanceCopy.belowDrawn : "Could not save this allowance. Please try again."
    }
}

/// What a derived line's edit saves: its name and group (the breakdown's, for a
/// generic line) and its funding account.
struct DerivedLineValues: Equatable, Sendable {
    var name: String
    var group: BudgetGroup
    var destinationAccountId: String?
}

/// The derived-line editor's fields and rules, mirroring the PWA's `DerivedBudgetLineForm`.
struct DerivedLineFormState: Equatable, Sendable {
    var name: String
    var group: BudgetGroup
    var destinationAccountId: String?
    /// A gift line's name is partition-derived and shown read-only.
    let nameEditable: Bool
    /// A gift member line funds from the buyer's spending account, set by reconcile.
    let fundingLocked: Bool

    /// The goal-routed groups are not offered: a derived line funds from an account.
    static let groups: [BudgetGroup] = [.needs, .wants, .discretionary]

    /// The form for `line`, named and grouped from `breakdown` when it is generic.
    init(line: BudgetLine, breakdown: Breakdown?) {
        name = line.isGiftLine ? line.name : (breakdown?.name ?? line.name)
        group = line.isGiftLine ? line.lineGroup : (breakdown?.lineGroup ?? line.lineGroup)
        destinationAccountId = line.destinationAccountId
        nameEditable = !line.isGiftLine
        fundingLocked = line.giftRecipientMemberId != nil
    }

    var canSubmit: Bool { !nameEditable || !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var values: DerivedLineValues {
        DerivedLineValues(
            name: name.trimmingCharacters(in: .whitespaces), group: group,
            destinationAccountId: destinationAccountId)
    }
}

/// The columns a temporary item's save writes.
struct TemporaryItemInput: Codable, Equatable, Sendable {
    var name: String
    var contributionCents: Int
    var targetDate: String

    enum CodingKeys: String, CodingKey {
        case name
        case contributionCents = "contribution_cents"
        case targetDate = "target_date"
    }

    /// The row a create writes: the columns plus the household.
    func insertValues(householdID: String) -> InsertValues {
        InsertValues(input: self, householdId: householdID)
    }

    struct InsertValues: Encodable, Sendable {
        let input: TemporaryItemInput
        let householdId: String

        func encode(to encoder: Encoder) throws {
            try input.encode(to: encoder)
            var container = encoder.container(keyedBy: ExtraKey.self)
            try container.encode(householdId, forKey: .householdId)
        }

        private enum ExtraKey: String, CodingKey { case householdId = "household_id" }
    }
}

/// The temporary item add/edit form's fields and rules, mirroring the PWA's
/// `TemporaryItemForm`: a new item's target date starts on `today`.
struct TemporaryItemFormState: Equatable, Sendable {
    var name: String
    var contribution: String
    var targetDate: String?
    let isEditing: Bool

    init(initial: TemporaryItem? = nil, today: String) {
        name = initial?.name ?? ""
        contribution = InflowFormState.dollars(initial?.contributionCents)
        targetDate = initial?.targetDate ?? today
        isEditing = initial != nil
    }

    private var cents: Int? { InflowFormState.cents(contribution).flatMap { $0 >= 0 ? $0 : nil } }

    var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && cents != nil && targetDate != nil
    }

    var input: TemporaryItemInput? {
        guard canSubmit, let cents, let targetDate else { return nil }
        return TemporaryItemInput(
            name: name.trimmingCharacters(in: .whitespaces), contributionCents: cents,
            targetDate: targetDate)
    }
}
