import Foundation
import Observation

/// The add/edit deduction form's fields and the rules over them, mirroring the PWA's
/// `DeductionForm` and `useDeductionFields`: what is pre-fillable (description,
/// amount, date), which fields are the member's own, how the basis, work-use share and
/// group decide the saved figures. The engine supplies the derived amounts.
@MainActor @Observable
final class DeductionFormState {
    enum Field { case description, amount, date }

    let memberID: String
    let financialYear: Int
    let initial: Deduction?
    /// The group the form was opened from, if any.
    let openedFrom: DeductionGroup?
    let groups: [DeductionGroup]

    var description: String
    /// Dollars as typed; the full cost, not the apportioned amount.
    var amount: String
    /// An ISO `yyyy-MM-dd` date.
    var date: String
    var chosenBasis: DeductionBasis = .amount
    var category: DeductionCategory
    var distance: String
    var hours: String
    var workUse: String
    var pickedGroupID: String?
    var figures: DeductionFigures = .zero

    private var claimed: Set<Field> = []

    init(
        memberID: String, financialYear: Int, initial: Deduction? = nil,
        openedFrom: DeductionGroup? = nil, groups: [DeductionGroup] = [],
        category: DeductionCategory? = nil, extraction: DeductionExtraction? = nil,
        today: String = DeductionFormState.todayISO()
    ) {
        self.memberID = memberID
        self.financialYear = financialYear
        self.initial = initial
        self.openedFrom = openedFrom
        self.groups = groups
        description = initial?.description ?? extraction?.description ?? ""
        let cents = initial?.fullAmountCents ?? initial?.amountCents ?? extraction?.amountCents
        amount = cents.map(Self.dollars) ?? ""
        date = initial?.deductionDate ?? extraction?.deductionDate ?? today
        self.category =
            initial?.category ?? category ?? (openedFrom?.kind == "donations" ? .donation : .workExpense)
        distance = initial?.distanceKm.map(DeductionsPresentation.number) ?? ""
        hours = initial?.workFromHomeHours.map(DeductionsPresentation.number) ?? ""
        workUse = DeductionsPresentation.number(initial?.workUsePercent ?? 100)
        let start = openedFrom?.id ?? initial?.groupId
        pickedGroupID = groups.contains { $0.kind == "standard" && $0.id == start } ? start : nil
    }

    static func todayISO(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// Cents as a dollars string for an input: `12.5`, `100`.
    static func dollars(_ cents: Int) -> String {
        DeductionsPresentation.number(Double(cents) / 100)
    }

    static func parse(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let value = Double(trimmed), value.isFinite else { return nil }
        return value
    }

    // MARK: Member-owned edits

    func setDescription(_ value: String) { description = value; claimed.insert(.description) }
    func setAmount(_ value: String) { amount = value; claimed.insert(.amount) }
    func setDate(_ value: String) { date = value; claimed.insert(.date) }

    /// Writes a read over the fields the member has left alone; returns whether it
    /// filled in anything. A value the member typed is never replaced.
    @discardableResult
    func prefill(_ extraction: DeductionExtraction) -> Bool {
        var filled = false
        if let value = extraction.description, !claimed.contains(.description) {
            description = value
            filled = true
        }
        if let cents = extraction.amountCents, !claimed.contains(.amount) {
            amount = Self.dollars(cents)
            filled = true
        }
        if let value = extraction.deductionDate, !claimed.contains(.date) {
            date = value
            filled = true
        }
        return filled
    }

    // MARK: Derived

    var adding: Bool { initial == nil }
    /// An existing deduction keeps the basis it was created with.
    var basis: DeductionBasis { initial?.basis ?? chosenBasis }
    /// A donation or a tax agent fee is always a dollar figure.
    var basisApplies: Bool { category == .workExpense }
    var effectiveBasis: DeductionBasis { basisApplies ? basis : .amount }
    var isDistance: Bool { effectiveBasis == .distance }
    var isHours: Bool { effectiveBasis == .hours }
    var isDerived: Bool { isDistance || isHours }
    var isDonation: Bool { category == .donation }
    var standardGroups: [DeductionGroup] { groups.filter { $0.kind == "standard" } }

    /// A form opened from a standard group offers no donation.
    var categoryOptions: [DeductionCategory] {
        openedFrom?.kind == "standard" ? [.workExpense, .taxAgentFees] : DeductionCategory.allCases
    }

    var derivedText: String { isHours ? hours : distance }
    var derivedNumber: Double? { Self.parse(derivedText).flatMap { $0 >= 0 ? $0 : nil } }
    var derivedValid: Bool { derivedNumber != nil }

    /// Work use applies to a work expense on the dollar basis alone.
    var apportionable: Bool { !isDerived && category == .workExpense }
    var enteredWorkUse: Double? { Self.parse(workUse) }
    var workUseValid: Bool {
        !apportionable || (enteredWorkUse.map { $0 > 0 && $0 <= 100 } ?? false)
    }
    var workUsePercent: Double { apportionable ? (enteredWorkUse ?? 100) : 100 }
    var fullAmountCents: Int { Self.parse(amount).map { Int(($0 * 100).rounded()) } ?? 0 }

    /// Over the ATO's cap on kilometres per car per year; advisory only.
    var overCap: Bool {
        isDistance && (derivedNumber.map { $0 > figures.maxClaimableKm } ?? false)
    }

    var computedAmountCents: Int {
        guard derivedValid else { return 0 }
        return isHours ? figures.hoursCents : figures.distanceCents
    }

    var apportionedAmountCents: Int { workUseValid ? figures.apportionedCents : 0 }

    /// What the engine is asked for.
    var figuresInput: DeductionFiguresInput {
        DeductionFiguresInput(
            financialYear: financialYear, distanceKm: isDistance ? derivedNumber : nil,
            hours: isHours ? derivedNumber : nil, fullAmountCents: fullAmountCents,
            workUsePercent: workUsePercent)
    }

    func canSubmit(receiptBusy: Bool) -> Bool {
        !description.trimmingCharacters(in: .whitespaces).isEmpty
            && (isDerived ? derivedValid : (!amount.isEmpty && workUseValid)) && !date.isEmpty
            && (!adding || !receiptBusy)
    }

    /// The write the form saves; the service adds a new deduction's id, household and year.
    func write() -> DeductionWrite {
        DeductionWrite(
            memberID: memberID,
            description: description.trimmingCharacters(in: .whitespaces),
            amountCents: isDerived ? computedAmountCents : apportionedAmountCents,
            deductionDate: date, basis: effectiveBasis,
            distanceKm: isDistance ? derivedNumber : nil,
            workFromHomeHours: isHours ? derivedNumber : nil,
            groupID: isDonation ? nil : (openedFrom?.id ?? pickedGroupID), category: category,
            fullAmountCents: isDerived ? computedAmountCents : fullAmountCents,
            workUsePercent: workUsePercent)
    }
}
