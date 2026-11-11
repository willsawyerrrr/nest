import Foundation

/// The add/edit form's fields and rules, mirroring the PWA's `InflowForm`: what each
/// control offers, what a change resets, whether the draft can be saved, and the
/// columns a save writes. Text fields hold what was typed, as the PWA's inputs do.
struct InflowFormState: Equatable, Sendable {
    var name = ""
    var taxable = true
    var attractsSuper = true
    var memberID = ""
    var type: InflowType = .salary
    var schedule: Frequency = .fortnightly
    var interval = ""
    var paySchedule: Frequency?
    var payInterval = ""
    var arrivesEveryPeriod = true
    var amount = ""
    var hourlyRate = ""
    var hours = ""
    var startsOn: String?
    var endsOn: String?
    var payAnchorDate: String?
    var paidOn: String?
    var treatment: OneOffTaxTreatment = .ordinary
    var yearsOfService = ""
    var isOneOff = false
    var isJoint = false
    var splitPercent = "50"

    /// A blank form for `members`, or the form for `initial`.
    init(initial: Inflow? = nil, members: [Member]) {
        memberID = initial?.memberId ?? members.first?.id ?? ""
        guard let initial else { return }
        name = initial.name
        taxable = initial.taxable
        attractsSuper = initial.attractsSuper
        type = initial.type
        schedule = initial.schedule ?? .fortnightly
        interval = initial.intervalCount.map(String.init) ?? ""
        paySchedule = initial.paySchedule
        payInterval = initial.payIntervalCount.map(String.init) ?? ""
        arrivesEveryPeriod = initial.arrivesEveryPayPeriod
        amount = Self.dollars(initial.amountCents)
        hourlyRate = Self.dollars(initial.hourlyRateCents)
        hours = initial.hoursPerPeriod.map(InflowsPresentation.trimmed) ?? ""
        startsOn = initial.startsOn
        endsOn = initial.endsOn
        payAnchorDate = initial.payAnchorDate
        paidOn = initial.paidOn
        treatment = initial.oneOffTaxTreatment ?? .ordinary
        yearsOfService = initial.yearsOfService.map { InflowsPresentation.trimmed($0) } ?? ""
        isOneOff = initial.paidOn != nil
        isJoint = initial.isJoint
        splitPercent = initial.memberSplitPercent.map(InflowsPresentation.trimmed) ?? "50"
    }

    // MARK: Parsing

    /// Integer cents as the dollars text a money field shows (`1234.5` → `1234.50`).
    static func dollars(_ cents: Int?) -> String {
        guard let cents else { return "" }
        return String(format: "%.2f", Double(cents) / 100)
    }

    /// A money field's text as integer cents, `nil` when blank or not a number.
    static func cents(_ text: String) -> Int? {
        let cleaned = text.replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty, let dollars = Double(cleaned), dollars.isFinite else { return nil }
        return Int((dollars * 100).rounded())
    }

    /// Whether `text` is a whole number of at least 1, a usable interval count.
    static func isIntervalValid(_ text: String) -> Bool {
        guard let value = Double(text), value == value.rounded() else { return false }
        return value >= 1
    }

    // MARK: Options

    static let taxableTypes: [InflowType] = [.salary, .wage, .other]
    static let nonTaxableTypes: [InflowType] = [.reimbursement, .hobby, .gift, .other]
    static let taxableOneOffTypes: [InflowType] = [.salary, .other]
    static let treatments: [OneOffTaxTreatment] = [
        .ordinary, .genuineRedundancy, .employmentTermination, .unusedLeave,
    ]
    /// Every cadence, fixed labels first then the interval ones.
    static let frequencies: [Frequency] = [
        .weekly, .fortnightly, .monthly, .quarterly, .biannual, .annual, .everyNWeeks,
        .everyNMonths,
    ]

    /// The type options for the current taxability and recurrence.
    var typeOptions: [InflowType] {
        taxable ? (isOneOff ? Self.taxableOneOffTypes : Self.taxableTypes) : Self.nonTaxableTypes
    }

    // MARK: Changes

    /// Switches taxability, resetting the type to the new mode's default when it
    /// no longer applies, and dropping a joint choice it makes ineligible.
    mutating func setTaxable(_ next: Bool) {
        taxable = next
        let options = next ? Self.taxableTypes : Self.nonTaxableTypes
        if !options.contains(type) { type = next ? .salary : .reimbursement }
        clearJointIfIneligible()
    }

    mutating func setType(_ next: InflowType) {
        type = next
        clearJointIfIneligible()
    }

    /// Switches recurrence. A one-off is never a wage, so a wage becomes a salary.
    mutating func setOneOff(_ next: Bool) {
        isOneOff = next
        if next && type == .wage { type = .salary }
        clearJointIfIneligible()
    }

    private mutating func clearJointIfIneligible() {
        if !(taxable && type == .other && !isOneOff) { isJoint = false }
    }

    // MARK: Derived

    var isWage: Bool { !isOneOff && taxable && type == .wage }
    private static func needsInterval(_ frequency: Frequency?) -> Bool {
        frequency == .everyNWeeks || frequency == .everyNMonths
    }
    var isEveryN: Bool { !isOneOff && Self.needsInterval(schedule) }
    var intervalUnit: String { schedule == .everyNMonths ? "months" : "weeks" }
    var payCadence: Frequency? { taxable && !isOneOff ? paySchedule : nil }
    var isPayEveryN: Bool { Self.needsInterval(payCadence) }
    var payIntervalUnit: String { payCadence == .everyNMonths ? "months" : "weeks" }
    var arrivesEvery: Bool { taxable && !isOneOff ? arrivesEveryPeriod : true }
    var jointEligible: Bool { !isOneOff && taxable && type == .other }
    var joint: Bool { jointEligible && isJoint }
    var splitPercentValue: Double { Double(splitPercent) ?? .nan }
    var splitPercentValid: Bool {
        let value = splitPercentValue
        return value == value.rounded() && value >= 0 && value <= 100
    }
    var amountEntered: Bool { isWage ? !hourlyRate.isEmpty && !hours.isEmpty : !amount.isEmpty }
    var intervalCount: Int? { isEveryN && Self.isIntervalValid(interval) ? Int(interval) : nil }
    var payIntervalCount: Int? {
        isPayEveryN && Self.isIntervalValid(payInterval) ? Int(payInterval) : nil
    }

    /// A salary or wage arriving once a year, which is rarely what is meant.
    var arrivesAnnually: Bool {
        !isOneOff && taxable && (type == .salary || type == .wage)
            && (payCadence ?? schedule) == .annual
    }

    /// Whether a taxable one-off's treatment carries completed years of service.
    var needsYearsOfService: Bool { taxable && treatment == .genuineRedundancy }

    var oneOffComplete: Bool {
        paidOn != nil && (!needsYearsOfService || !yearsOfService.isEmpty)
    }

    func primaryMemberName(_ members: [Member]) -> String {
        members.first { $0.id == memberID }?.name ?? "this member"
    }

    func otherMemberName(_ members: [Member]) -> String {
        members.first { $0.id != memberID }?.name ?? "the other member"
    }

    /// Whether the draft says enough to save, by the PWA's `canSubmit`.
    var canSubmit: Bool {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty,
            !taxable || !memberID.isEmpty, amountEntered
        else { return false }
        if isOneOff { return oneOffComplete }
        return (!isEveryN || (!interval.isEmpty && Self.isIntervalValid(interval)))
            && (!isPayEveryN || (!payInterval.isEmpty && Self.isIntervalValid(payInterval)))
            && (!joint || (!splitPercent.isEmpty && splitPercentValid))
    }

    // MARK: Engine

    /// The engine input for the figures shown back under the fields.
    func draftInput(now: Date, dateOfBirth: String?) -> InflowDraftInput {
        let rate = Self.cents(hourlyRate)
        let oneOff: InflowDraftInput.OneOff? =
            if isOneOff, taxable, let cents = Self.cents(amount), let paidOn {
                InflowDraftInput.OneOff(
                    treatment: treatment.rawValue, amountCents: cents,
                    yearsOfService: yearsOfService.isEmpty ? nil : Double(yearsOfService).map { Int($0) },
                    dateOfBirth: dateOfBirth, paidOn: paidOn)
            } else {
                nil
            }
        return InflowDraftInput(
            now: Self.instant(now), isWage: isWage, schedule: schedule.rawValue,
            interval: intervalCount,
            amountCents: isWage || !amountEntered ? nil : (Self.cents(amount) ?? 0),
            hourlyRateCents: isWage && amountEntered ? (rate ?? 0) : nil,
            hoursPerPeriod: isWage && amountEntered ? Double(hours) ?? 0 : nil,
            payCadence: payCadence?.rawValue, payInterval: payIntervalCount, oneOff: oneOff)
    }

    private static func instant(_ date: Date) -> String {
        date.formatted(.iso8601)
    }

    // MARK: Save

    /// The columns a save writes, by the PWA's `buildInput`; `nil` when the draft
    /// cannot be saved.
    var input: InflowInput? {
        guard canSubmit else { return nil }
        let oneOffTreatment: OneOffTaxTreatment? = isOneOff && taxable ? treatment : nil
        return InflowInput(
            name: name.trimmingCharacters(in: .whitespaces), taxable: taxable,
            memberId: taxable ? memberID : nil, type: type,
            attractsSuper: taxable && !isOneOff ? attractsSuper : true,
            schedule: isOneOff ? nil : schedule,
            paidOn: isOneOff ? paidOn : nil,
            oneOffTaxTreatment: oneOffTreatment,
            yearsOfService: isOneOff && needsYearsOfService ? Double(yearsOfService).map { Int($0) } : nil,
            intervalCount: isEveryN ? Int(interval) : nil,
            isJoint: joint, memberSplitPercent: joint ? Int(splitPercentValue) : nil,
            paySchedule: payCadence,
            payIntervalCount: isPayEveryN ? Int(payInterval) : nil,
            arrivesEveryPayPeriod: arrivesEvery,
            amountCents: isWage ? nil : Self.cents(amount),
            hourlyRateCents: isWage ? Self.cents(hourlyRate) : nil,
            hoursPerPeriod: isWage ? (hours.isEmpty ? nil : Double(hours)) : nil,
            startsOn: isOneOff ? nil : startsOn, endsOn: isOneOff ? nil : endsOn,
            payAnchorDate: isOneOff ? nil : payAnchorDate)
    }
}
