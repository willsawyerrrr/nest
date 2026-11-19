import Foundation

/// The super profile form's fields as typed, and the rules turning them into
/// `SuperProfileValues` as the PWA's `SuperProfileForm` does.
struct SuperProfileDraft: Equatable, Sendable {
    var fundName: String
    var balance: String
    /// Whether the stored balance is a dated baseline, so a save is a true-up.
    let isTrueUp: Bool

    /// Prefills the fund name and, when the member has a linked account, the
    /// effective balance today.
    init(fundName: String?, hasAccount: Bool, effectiveCents: Int, isTrueUp: Bool) {
        self.fundName = fundName ?? ""
        balance = hasAccount ? PayslipDraft.dollars(effectiveCents) : ""
        self.isTrueUp = isTrueUp
    }

    var submitLabel: String { isTrueUp ? "Update actual balance" : "Save" }
    var balanceLabel: String { isTrueUp ? "Actual balance today" : "Current balance" }

    /// The trimmed fund name and the typed balance (a blank balance saves as 0).
    var values: SuperProfileValues {
        SuperProfileValues(
            fundName: fundName.trimmingCharacters(in: .whitespacesAndNewlines),
            balanceCents: PayslipDraft.cents(balance) ?? 0)
    }

    static let trueUpNote =
        "Between true-ups the balance is estimated from your modelled contributions. Enter your fund’s actual balance to true it up."
    static let saveError = "Could not save this super profile. Please try again."
}

/// The contribution form's fields as typed, and the rules turning them into a
/// `SuperContributionInput` as the PWA's `SuperContributionForm` does.
struct SuperContributionDraft: Equatable, Sendable {
    var kind = SuperContributionKind.salarySacrifice
    var mode = SuperContributionMode.amount
    var amount = ""
    var percent = ""
    var frequency = Frequency.fortnightly
    var interval = ""
    var fhssEligible = false
    var contributorID = ""

    init() {}

    init(contribution: SuperContribution) {
        kind = contribution.kind
        mode = contribution.mode
        amount = PayslipDraft.dollars(contribution.amountCents)
        percent = contribution.percentBp.map(Self.percentText) ?? ""
        frequency = contribution.frequency
        interval = contribution.intervalCount.map(String.init) ?? ""
        fhssEligible = contribution.fhssEligible
        contributorID = contribution.contributorMemberId ?? ""
    }

    var isPercent: Bool { mode == .percent }
    var isEveryN: Bool { FrequencyInput.takesInterval(frequency) }
    var isSpouse: Bool { kind == .spouse }
    static func intervalLabel(_ frequency: Frequency) -> String {
        "\(frequency == .everyNMonths ? "Months" : "Weeks") between contributions"
    }

    private var percentValue: Double? {
        Double(percent.trimmingCharacters(in: .whitespaces)).flatMap { (0...100).contains($0) ? $0 : nil }
    }

    /// The typed amount; the field's minimum is 0, as the PWA's.
    private var amountCents: Int? { PayslipDraft.cents(amount).flatMap { $0 >= 0 ? $0 : nil } }

    private var intervalValue: Int? {
        Int(interval.trimmingCharacters(in: .whitespaces)).flatMap { $0 >= 1 ? $0 : nil }
    }

    /// The value for the mode is entered (a percent within 0–100, a non-negative
    /// amount), an every-N cadence has a whole interval of at least 1, and a spouse
    /// contribution names its contributor.
    var canSubmit: Bool {
        (isPercent ? percentValue != nil : amountCents != nil)
            && (!isEveryN || intervalValue != nil)
            && (!isSpouse || !contributorID.isEmpty)
    }

    /// The input to save for `memberID`, or `nil` while the draft cannot be submitted.
    func input(memberID: String) -> SuperContributionInput? {
        guard canSubmit else { return nil }
        return SuperContributionInput(
            memberID: memberID, kind: kind, mode: mode,
            amountCents: isPercent ? nil : amountCents,
            percentBp: isPercent ? percentValue.map { Int(($0 * 100).rounded()) } : nil,
            frequency: frequency, intervalCount: isEveryN ? intervalValue : nil,
            fhssEligible: fhssEligible, contributorMemberID: isSpouse ? contributorID : nil)
    }

    /// Basis points as the percent a field holds, without trailing zeros.
    static func percentText(_ bp: Int) -> String {
        let percent = Double(bp) / 100
        return percent == percent.rounded() ? String(Int(percent)) : String(percent)
    }

    static let kinds: [SuperContributionKind] = [
        .salarySacrifice, .personalDeductible, .personalNonConcessional, .spouse,
    ]
    static let saveError = "Could not save this contribution. Please try again."
}
