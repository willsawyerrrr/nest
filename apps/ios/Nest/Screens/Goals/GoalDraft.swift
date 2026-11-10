import Foundation

/// The goal form's fields as typed, and the rules turning them into a `GoalInput`
/// as the PWA's `GoalForm` does.
struct GoalDraft: Equatable, Sendable {
    static let saveFailure = "Could not save this goal. Please try again."

    var name = ""
    var targetAmount = ""
    /// ISO `YYYY-MM-DD`, or `nil` for no target date.
    var targetDate: String?
    var currentBalance = ""
    var linkedAccountID: String?
    var interestRate = ""
    var plannedContribution = ""

    init() {}

    init(goal: SavingsGoal) {
        name = goal.name
        targetAmount = Self.dollars(goal.targetAmountCents)
        targetDate = goal.targetDate
        currentBalance = Self.dollars(goal.currentBalanceCents)
        linkedAccountID = goal.linkedAccountId
        interestRate = goal.annualInterestBps.map(Self.percent) ?? ""
        plannedContribution = goal.plannedContributionCents.map(Self.dollars) ?? ""
    }

    /// A goal needs a name and a target amount.
    var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !targetAmount.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// The input to save; `queuePosition` is the edited goal's, kept as is.
    func input(queuePosition: Int?) -> GoalInput {
        GoalInput(
            name: name.trimmingCharacters(in: .whitespaces),
            targetAmountCents: Self.cents(targetAmount) ?? 0, targetDate: targetDate,
            currentBalanceCents: Self.cents(currentBalance) ?? 0, linkedAccountId: linkedAccountID,
            annualInterestBps: Self.basisPoints(interestRate), queuePosition: queuePosition,
            plannedContributionCents: Self.cents(plannedContribution))
    }

    /// Selecting a saver names a still-unnamed goal after it.
    mutating func link(_ saver: GoalSaver?) {
        linkedAccountID = saver?.id
        if let saver, name.trimmingCharacters(in: .whitespaces).isEmpty { name = saver.name }
    }

    /// Whether the linked saver has been deleted at its source.
    func linkedSaverDeleted(in savers: [GoalSaver]) -> Bool {
        savers.contains { $0.id == linkedAccountID && $0.isDeletedAtSource }
    }

    /// A dollars field's text as integer cents, `nil` when blank or not a number.
    static func cents(_ text: String) -> Int? {
        let cleaned = text.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value.isFinite else { return nil }
        return Int((value * 100).rounded())
    }

    /// A percent field's text as whole basis points, `nil` when blank or not a number.
    static func basisPoints(_ text: String) -> Int? {
        let cleaned = text.replacingOccurrences(of: "%", with: "").trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value.isFinite else { return nil }
        return Int((value * 100).rounded())
    }

    /// Integer cents as a two-decimal dollars field value.
    static func dollars(_ cents: Int) -> String { String(format: "%.2f", Double(cents) / 100) }

    /// Basis points as a percent field value, without trailing zeros.
    static func percent(_ bps: Int) -> String {
        let value = Double(bps) / 100
        return value == value.rounded() ? String(Int(value)) : String(value)
    }
}
