import SwiftUI

/// Add or edit one purchase, budget-linked or ad hoc. Persistence is the caller's.
struct GiftPurchaseForm: View {
    var initial: GiftPurchase?
    /// The budget the purchase counts against; nil for an unassigned or ad hoc one.
    var budgetID: String?
    /// The ad hoc buffer the purchase counts against, when it is one.
    var discretionaryID: String?
    /// Recipients offered as the optional ad hoc tag; nil hides the tag.
    var tagChoices: [GiftLinkOption]?
    let onSubmit: (GiftPurchaseValues) async -> Bool
    let onCancel: () -> Void

    @State private var description: String
    @State private var amount: String
    @State private var date: Date
    @State private var tag: String?
    @State private var failed = false
    @State private var submitting = false

    init(
        initial: GiftPurchase? = nil, budgetID: String? = nil, discretionaryID: String? = nil,
        tagChoices: [GiftLinkOption]? = nil,
        onSubmit: @escaping (GiftPurchaseValues) async -> Bool, onCancel: @escaping () -> Void
    ) {
        self.initial = initial
        self.budgetID = budgetID
        self.discretionaryID = discretionaryID
        self.tagChoices = tagChoices
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _description = State(initialValue: initial?.description ?? "")
        _amount = State(initialValue: GiftMoneyInput.text(cents: initial?.amountCents))
        _date = State(initialValue: initial.flatMap { Self.parse($0.purchasedOn) } ?? Date())
        _tag = State(initialValue: initial?.recipientId)
    }

    private var cents: Int? { GiftMoneyInput.cents(amount) }

    var body: some View {
        GiftFormShell(
            submitLabel: initial == nil ? "Add purchase" : "Save",
            error: failed ? "Could not save this purchase. Please try again." : nil,
            canSubmit: cents != nil, isSubmitting: submitting,
            onSubmit: submit, onCancel: onCancel
        ) {
            NestField(label: "Description", text: $description, prompt: "What was bought")
            GiftAmountField(label: "Amount", text: $amount)
            DatePicker("Purchased on", selection: $date, displayedComponents: .date)
                .font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
                .tint(NestColor.brand)
            if let tagChoices {
                GiftSelect(
                    label: "Recipient",
                    description: "Optional. Record-keeping only — this doesn't budget for them.",
                    placeholder: "Untagged", options: tagChoices, selection: $tag)
            }
        }
    }

    private func submit() {
        guard let cents else { return }
        var values = GiftPurchaseValues.details(
            amountCents: cents, description: description, purchasedOn: Self.format(date))
        if let budgetID { values = values.with("gift_budget_id", .text(budgetID)) }
        if let discretionaryID {
            values = values.with("gift_discretionary_budget_id", .text(discretionaryID))
        }
        if tagChoices != nil, discretionaryID != nil {
            values = values.with("recipient_id", tag.map { .text($0) } ?? .null)
        }
        Task {
            submitting = true
            failed = !(await onSubmit(values))
            submitting = false
        }
    }

    static func parse(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func format(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }
}

/// Picks a recipient and then one of their budgeted occasions, which together
/// name exactly one gift budget.
struct GiftBudgetPicker: View {
    let choices: [GiftLinkRecipient]
    @Binding var recipientID: String?
    @Binding var budgetID: String?

    private var chosen: GiftLinkRecipient? { choices.first { $0.value == recipientID } }

    var body: some View {
        GiftSelect(
            label: "Recipient", placeholder: "Choose a recipient",
            options: choices.map { GiftLinkOption(value: $0.value, label: $0.label) },
            selection: Binding(
                get: { recipientID },
                set: { value in
                    recipientID = value
                    budgetID = choices.first { $0.value == value }.flatMap {
                        $0.occasions.count == 1 ? $0.occasions[0].value : nil
                    }
                }), isDisabled: choices.isEmpty)
        GiftSelect(
            label: "Occasion",
            placeholder: chosen == nil ? "Choose a recipient first" : "Choose an occasion",
            options: chosen?.occasions ?? [], selection: $budgetID, isDisabled: chosen == nil)
    }
}

/// Links one inbox candidate to a gift budget. The amount and date follow the
/// transaction; the description starts from Up's wording.
struct GiftCandidateLinkForm: View {
    let candidate: GiftCandidate
    let choices: [GiftLinkRecipient]
    let onSubmit: (GiftPurchaseValues) async -> Bool
    let onCancel: () -> Void

    @State private var recipientID: String?
    @State private var budgetID: String?
    @State private var description: String
    @State private var failed = false
    @State private var submitting = false

    init(
        candidate: GiftCandidate, choices: [GiftLinkRecipient],
        onSubmit: @escaping (GiftPurchaseValues) async -> Bool, onCancel: @escaping () -> Void
    ) {
        self.candidate = candidate
        self.choices = choices
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        let sole = choices.count == 1 ? choices[0] : nil
        _recipientID = State(initialValue: sole?.value)
        _budgetID = State(
            initialValue: sole.flatMap { $0.occasions.count == 1 ? $0.occasions[0].value : nil })
        _description = State(initialValue: candidate.description)
    }

    var body: some View {
        GiftFormShell(
            submitLabel: "Link purchase",
            error: failed ? "Could not link this purchase. Please try again." : nil,
            canSubmit: budgetID != nil, isSubmitting: submitting,
            onSubmit: {
                guard let budgetID else { return }
                let values = GiftPurchaseValues.details(
                    amountCents: candidate.amountCents, description: description,
                    purchasedOn: candidate.postedOn
                )
                .with("gift_budget_id", .text(budgetID))
                .with("transaction_id", .text(candidate.transactionId))
                Task {
                    submitting = true
                    failed = !(await onSubmit(values))
                    submitting = false
                }
            }, onCancel: onCancel
        ) {
            GiftBudgetPicker(choices: choices, recipientID: $recipientID, budgetID: $budgetID)
            NestField(label: "Description", text: $description)
            GiftCaption(text: "The amount and date follow the transaction.")
        }
    }
}

/// Assigns an unassigned purchase to a specific gift or to the ad hoc buffer,
/// leaving its amount, date and description untouched.
struct GiftPurchaseAssignForm: View {
    let choices: [GiftLinkRecipient]
    let discretionaryID: String?
    let tagChoices: [GiftLinkOption]
    let onSubmit: (GiftPurchaseValues) async -> Bool
    let onCancel: () -> Void

    private enum Destination { case gift, adHoc }

    @State private var destination: Destination
    @State private var recipientID: String?
    @State private var budgetID: String?
    @State private var tag: String?
    @State private var failed = false
    @State private var submitting = false

    init(
        choices: [GiftLinkRecipient], discretionaryID: String?, tagChoices: [GiftLinkOption],
        onSubmit: @escaping (GiftPurchaseValues) async -> Bool, onCancel: @escaping () -> Void
    ) {
        self.choices = choices
        self.discretionaryID = discretionaryID
        self.tagChoices = tagChoices
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _destination = State(initialValue: choices.isEmpty ? .adHoc : .gift)
    }

    private var canSubmit: Bool {
        destination == .gift ? budgetID != nil : discretionaryID != nil
    }

    var body: some View {
        GiftFormShell(
            submitLabel: "Assign",
            error: failed ? "Could not assign this purchase. Please try again." : nil,
            canSubmit: canSubmit, isSubmitting: submitting,
            onSubmit: {
                let values: GiftPurchaseValues
                if destination == .gift, let budgetID {
                    values = GiftPurchaseValues(fields: ["gift_budget_id": .text(budgetID)])
                } else if let discretionaryID {
                    values = GiftPurchaseValues(fields: [
                        "gift_discretionary_budget_id": .text(discretionaryID),
                        "recipient_id": tag.map { .text($0) } ?? .null,
                    ])
                } else {
                    return
                }
                Task {
                    submitting = true
                    failed = !(await onSubmit(values))
                    submitting = false
                }
            }, onCancel: onCancel
        ) {
            GiftSegmented(
                options: [(Destination.gift, "A specific gift"), (.adHoc, "Ad hoc gifts")],
                selection: $destination, label: "Assign to")
            if destination == .gift {
                GiftBudgetPicker(choices: choices, recipientID: $recipientID, budgetID: $budgetID)
                if choices.isEmpty {
                    GiftCaption(
                        text: "No gift budgets yet — add one to assign a purchase to a specific gift."
                    )
                }
            } else if discretionaryID == nil {
                GiftCaption(text: "Set the ad hoc gifts budget below before assigning purchases to it.")
            } else {
                GiftSelect(
                    label: "Recipient",
                    description: "Optional. Record-keeping only — this doesn't budget for them.",
                    placeholder: "Untagged", options: tagChoices, selection: $tag)
            }
        }
    }
}
