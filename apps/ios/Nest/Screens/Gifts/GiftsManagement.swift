import SwiftUI

/// The cascade warning shared by a recipient's and an occasion's delete confirmation.
private let cascadeWarning =
    "This also removes its gift budgets and every purchase recorded against them. This cannot be undone."

/// Manages the household's recipients and occasions, as the PWA's
/// `GiftManagement`. Each member is a permanent recipient, shown first as a
/// fixed row with no edit or delete; external people are added, renamed and
/// removed below. A delete is confirmed first, warning of its cascade.
struct GiftManagementView: View {
    let model: GiftsViewModel
    let presentation: GiftsPresentation
    @State private var addingRecipient = false
    @State private var editingRecipientID: String?
    @State private var addingOccasion = false
    @State private var editingOccasionID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.lg) {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                GiftTitle(text: "Recipients")
                if presentation.rows.recipients.isEmpty && !addingRecipient {
                    GiftEmptyState(text: "No recipients yet.")
                }
                ForEach(presentation.memberRecipients) { recipient in
                    GiftEntityRow(
                        label: presentation.memberRecipientName(recipient), tag: "Household member",
                        meta: recipient.memberId == presentation.currentMemberID
                            ? "Purchases hidden from you" : "Purchases hidden from them")
                }
                ForEach(presentation.externalRecipients) { recipient in
                    if editingRecipientID == recipient.id {
                        GiftEntityForm(kind: .recipient, initialName: recipient.name) { name, _ in
                            let saved = await model.updateRecipient(id: recipient.id, name: name)
                            if saved { editingRecipientID = nil }
                            return saved
                        } onCancel: {
                            editingRecipientID = nil
                        }
                    } else {
                        GiftEntityRow(
                            label: recipient.name,
                            actions: .init(
                                deleteTitle: "Delete recipient?",
                                onEdit: {
                                    addingRecipient = false
                                    editingRecipientID = recipient.id
                                },
                                onDelete: { Task { _ = await model.deleteRecipient(id: recipient.id) } }))
                    }
                }
                if addingRecipient {
                    GiftEntityForm(kind: .recipient) { name, _ in
                        let saved = await model.createRecipient(name: name)
                        if saved { addingRecipient = false }
                        return saved
                    } onCancel: {
                        addingRecipient = false
                    }
                } else {
                    GiftAddButton(label: "Add recipient") {
                        editingRecipientID = nil
                        addingRecipient = true
                    }
                }
            }

            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                GiftTitle(text: "Occasions")
                if presentation.rows.occasions.isEmpty && !addingOccasion {
                    GiftEmptyState(text: "No occasions yet.")
                }
                ForEach(presentation.rows.occasions) { occasion in
                    if editingOccasionID == occasion.id {
                        GiftEntityForm(
                            kind: .occasion, initialName: occasion.name,
                            initialDate: occasion.occasionDate
                        ) { name, date in
                            let saved = await model.updateOccasion(
                                id: occasion.id, name: name, date: date)
                            if saved { editingOccasionID = nil }
                            return saved
                        } onCancel: {
                            editingOccasionID = nil
                        }
                    } else {
                        GiftEntityRow(
                            label: occasion.name,
                            meta: occasion.occasionDate.map(GiftsPresentation.date),
                            actions: .init(
                                deleteTitle: "Delete occasion?",
                                onEdit: {
                                    addingOccasion = false
                                    editingOccasionID = occasion.id
                                },
                                onDelete: { Task { _ = await model.deleteOccasion(id: occasion.id) } }))
                    }
                }
                if addingOccasion {
                    GiftEntityForm(kind: .occasion) { name, date in
                        let saved = await model.createOccasion(name: name, date: date)
                        if saved { addingOccasion = false }
                        return saved
                    } onCancel: {
                        addingOccasion = false
                    }
                } else {
                    GiftAddButton(label: "Add occasion") {
                        editingOccasionID = nil
                        addingOccasion = true
                    }
                }
            }
        }
    }
}

/// One recipient or occasion: its label with an optional tag, its meta on the
/// caption line, and edit and delete controls when it is editable.
private struct GiftEntityRow: View {
    struct Actions {
        let deleteTitle: String
        let onEdit: () -> Void
        let onDelete: () -> Void
    }

    let label: String
    var tag: String?
    var meta: String?
    var actions: Actions?
    @State private var confirmingDelete = false

    var body: some View {
        GiftListRow {
            HStack(spacing: NestSpacing.xs) {
                Text(label).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text).lineLimit(1)
                if let tag { NestPill(text: tag) }
            }
            Spacer(minLength: 0)
            if let actions {
                HStack(spacing: 0) {
                    GiftIconButton(systemImage: "pencil", label: "Edit \(label)", action: actions.onEdit)
                    GiftIconButton(
                        systemImage: "trash", label: "Delete \(label)", tone: NestColor.negative
                    ) { confirmingDelete = true }
                    .confirmationDialog(
                        actions.deleteTitle, isPresented: $confirmingDelete,
                        titleVisibility: .visible
                    ) {
                        Button("Delete", role: .destructive, action: actions.onDelete)
                    } message: {
                        Text("\(label)\n\n\(cascadeWarning)")
                    }
                }
            }
        } caption: {
            if let meta { GiftCaption(text: meta) }
        }
    }
}

/// Add or edit an external recipient (a name) or an occasion (a name and an
/// optional date). Persistence is the caller's.
struct GiftEntityForm: View {
    enum Kind { case recipient, occasion }

    let kind: Kind
    var initialName: String?
    var initialDate: String?
    let onSubmit: (_ name: String, _ date: String?) async -> Bool
    let onCancel: () -> Void

    @State private var name: String
    @State private var date: String?
    @State private var failed = false
    @State private var submitting = false

    init(
        kind: Kind, initialName: String? = nil, initialDate: String? = nil,
        onSubmit: @escaping (_ name: String, _ date: String?) async -> Bool,
        onCancel: @escaping () -> Void
    ) {
        self.kind = kind
        self.initialName = initialName
        self.initialDate = initialDate
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _name = State(initialValue: initialName ?? "")
        _date = State(initialValue: initialDate)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        GiftFormShell(
            submitLabel: initialName == nil ? "Add" : "Save changes",
            error: failed ? "Could not save. Please try again." : nil,
            canSubmit: !trimmed.isEmpty, isSubmitting: submitting,
            onSubmit: {
                guard !trimmed.isEmpty else { return }
                let iso = kind == .occasion ? date : nil
                Task {
                    submitting = true
                    failed = !(await onSubmit(trimmed, iso))
                    submitting = false
                }
            }, onCancel: onCancel
        ) {
            NestField(label: "Name", text: $name)
            if kind == .occasion {
                IsoDateField(label: "Date", description: "Optional. When the occasion falls.", iso: $date)
            }
        }
    }
}

/// Add or edit one gift budget. An edit keeps its pairing and changes only the
/// amount and date; a group fixes the recipient or occasion it was opened from.
/// Persistence is the caller's.
struct GiftBudgetForm: View {
    let presentation: GiftsPresentation
    var initial: GiftBudget?
    var lockedRecipientID: String?
    var lockedOccasionID: String?
    let onSubmit: (GiftBudgetDraftCheck) async -> Bool
    let onCancel: () -> Void

    @State private var recipientID: String?
    @State private var occasionID: String?
    @State private var amount: String
    @State private var eventDate: String?
    @State private var failed = false
    @State private var submitting = false

    init(
        presentation: GiftsPresentation, initial: GiftBudget? = nil,
        lockedRecipientID: String? = nil, lockedOccasionID: String? = nil,
        onSubmit: @escaping (GiftBudgetDraftCheck) async -> Bool, onCancel: @escaping () -> Void
    ) {
        self.presentation = presentation
        self.initial = initial
        self.lockedRecipientID = lockedRecipientID
        self.lockedOccasionID = lockedOccasionID
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _recipientID = State(
            initialValue: initial?.recipientId ?? lockedRecipientID
                ?? presentation.rows.recipients.first?.id)
        _occasionID = State(
            initialValue: initial?.occasionId ?? lockedOccasionID
                ?? presentation.rows.occasions.first?.id)
        _amount = State(initialValue: GiftMoneyInput.text(cents: initial?.budgetedAmountCents))
        _eventDate = State(initialValue: initial?.eventDate)
    }

    private var check: GiftBudgetDraftCheck {
        presentation.check(
            GiftBudgetDraft(
                recipientId: recipientID ?? "", occasionId: occasionID ?? "",
                budgetedAmountCents: GiftMoneyInput.cents(amount),
                eventDate: eventDate),
            editing: initial)
    }

    var body: some View {
        let check = check
        GiftFormShell(
            submitLabel: initial == nil ? "Add budget" : "Save changes",
            error: failed ? "Could not save this gift budget. Please try again." : nil,
            canSubmit: check.canSubmit, isSubmitting: submitting,
            onSubmit: {
                guard check.canSubmit else { return }
                Task {
                    submitting = true
                    failed = !(await onSubmit(check))
                    submitting = false
                }
            }, onCancel: onCancel
        ) {
            if lockedRecipientID == nil && initial == nil {
                GiftSelect(
                    label: "Recipient", placeholder: "Choose a recipient",
                    options: presentation.rows.recipients.map {
                        GiftLinkOption(value: $0.id, label: $0.name)
                    }, selection: $recipientID, isClearable: false)
            }
            if lockedOccasionID == nil && initial == nil {
                GiftSelect(
                    label: "Occasion", placeholder: "Choose an occasion",
                    options: presentation.rows.occasions.map {
                        GiftLinkOption(value: $0.id, label: $0.name)
                    }, selection: $occasionID, isClearable: false)
            }
            GiftAmountField(
                label: "Budget", description: "The amount planned for this gift.", text: $amount)
            if let occasionDate = check.occasionDate {
                Text("Uses the occasion’s date — \(GiftsPresentation.date(occasionDate))")
                    .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            } else {
                IsoDateField(
                    label: "Date",
                    description:
                        "Optional. When this gift is due — e.g. this person's birthday. Falls back to the occasion's date.",
                    iso: $eventDate)
            }
            if check.duplicate {
                Text("A budget already exists for this recipient and occasion.")
                    .font(.system(size: 14)).foregroundStyle(NestColor.negative)
            }
        }
    }
}
