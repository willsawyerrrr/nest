import SwiftUI

/// The native Gifts route: the card-spending inbox, totals, unassigned and ad
/// hoc purchases, and budgets grouped by occasion or person.
struct GiftsScreen: View {
    @State private var model: GiftsViewModel

    init(model: GiftsViewModel = GiftsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            GiftsContentView(model: model, presentation: content.presentation)
        }
        .task { await model.load() }
    }
}

struct GiftsContentView: View {
    let model: GiftsViewModel
    let presentation: GiftsPresentation

    @AppStorage("gift-group-by") private var groupByRaw = GiftGroupBy.occasion.rawValue
    @State private var managing = false
    @State private var pendingDelete: GiftPurchase?

    private var groupBy: GiftGroupBy { GiftGroupBy(rawValue: groupByRaw) ?? .occasion }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                header
                if let error = model.actionError {
                    Text(error).font(.system(size: 14)).foregroundStyle(NestColor.negative)
                        .padding(NestSpacing.sm).frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            NestColor.negative.opacity(0.12),
                            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
                }
                GiftInboxCard(model: model, presentation: presentation)
                if presentation.hasTotal {
                    NestCard(padding: NestSpacing.sm) {
                        VStack(alignment: .leading, spacing: 4) {
                            GiftTitle(text: "Total")
                            GiftMoneyBar(
                                totals: presentation.overall, label: "Total gift",
                                budgetOnly: presentation.overallIsHidden)
                        }
                    }
                }
                GiftUnassignedCard(
                    model: model, presentation: presentation, delete: { pendingDelete = $0 })
                GiftAdHocCard(
                    model: model, presentation: presentation, delete: { pendingDelete = $0 })
                if managing {
                    WebHandoffCard(
                        title: "Manage gifts",
                        message:
                            "Adding and changing recipients, occasions and gift budgets happens in the web app.",
                        action: "Open Gifts on the web", path: Route.gifts.path)
                }
                GiftSegmented(
                    options: GiftGroupBy.allCases.map { ($0, $0.label) },
                    selection: Binding(get: { groupBy }, set: { groupByRaw = $0.rawValue }),
                    label: "Group gifts by")
                groups
            }
            .padding(NestSpacing.md)
        }
        .confirmationDialog(
            "Delete purchase?", isPresented: Binding(
                get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible, presenting: pendingDelete
        ) { purchase in
            Button("Delete", role: .destructive) {
                Task { _ = await model.deletePurchase(id: purchase.id) }
            }
        } message: { purchase in
            Text(purchase.description.isEmpty ? "Purchase" : purchase.description)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: NestSpacing.xs) {
            Text("Gifts")
                .font(.system(size: 34, weight: .bold, design: .rounded)).tracking(-0.7)
                .foregroundStyle(NestColor.text)
            Spacer(minLength: NestSpacing.xs)
            Button {
                Task { await model.refreshFromUp() }
            } label: {
                HStack(spacing: 6) {
                    if model.isSyncing {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                    Text("Refresh")
                }
            }
            .buttonStyle(GiftButtonStyle(variant: .light))
            .disabled(model.isSyncing)
            Button(managing ? "Done" : "Manage") { managing.toggle() }
                .buttonStyle(GiftButtonStyle(variant: managing ? .filled : .outline))
                .fixedSize()
        }
        .padding(.top, NestSpacing.xs)
    }

    @ViewBuilder private var groups: some View {
        if presentation.noEntities {
            Text("Add a recipient and an occasion to start tracking gifts. Tap **Manage** above.")
                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
        } else {
            let groups = presentation.groups(by: groupBy)
            if groups.isEmpty {
                GiftEmptyState(
                    text:
                        "No \(groupBy == .occasion ? "occasions" : "recipients") yet. Tap Manage to add one."
                )
            }
            ForEach(groups) { group in
                GiftGroupCard(
                    model: model, presentation: presentation, group: group,
                    delete: { pendingDelete = $0 })
            }
        }
    }
}

/// One purchase as a dense row, with its source badges and actions.
struct GiftPurchaseRowView: View {
    let purchase: GiftPurchase
    var recipientLabel: String?
    var onAssign: (() -> Void)?
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        GiftListRow {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: NestSpacing.xs) {
                    Text(purchase.description.isEmpty ? "Purchase" : purchase.description)
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
                        .lineLimit(1)
                    if purchase.transactionId != nil { NestPill(text: "From Up") }
                    if let recipientLabel { NestPill(text: "For \(recipientLabel)") }
                }
                GiftCaption(text: GiftsPresentation.date(purchase.purchasedOn))
            }
            Spacer(minLength: 0)
            Text(MoneyFormat.cents(purchase.amountCents))
                .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                .foregroundStyle(NestColor.text)
            HStack(spacing: 0) {
                if let onAssign {
                    GiftIconButton(
                        systemImage: "gift",
                        label: "Assign \(purchase.description.isEmpty ? "purchase" : purchase.description)",
                        action: onAssign)
                }
                GiftIconButton(systemImage: "pencil", label: "Edit", action: onEdit)
                GiftIconButton(
                    systemImage: "trash", label: "Delete", tone: NestColor.negative, action: onDelete)
            }
        }
    }
}

/// A collapsible group: its title and money, then its pairing rows.
struct GiftGroupCard: View {
    let model: GiftsViewModel
    let presentation: GiftsPresentation
    let group: GiftGroup
    let delete: (GiftPurchase) -> Void
    @State private var isOpen = false

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            GiftDisclosure(isOpen: $isOpen) {
                VStack(alignment: .leading, spacing: 4) {
                    GiftHeaderTitle(title: group.label, date: group.date, isOpen: isOpen)
                    GiftMoneyBar(totals: group.totals, label: group.label, budgetOnly: group.isHidden)
                }
            } content: {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    if group.rows.isEmpty { GiftEmptyState(text: "No gift budgets yet.") }
                    ForEach(group.rows) { row in
                        GiftRowCard(model: model, presentation: presentation, row: row, delete: delete)
                    }
                }
            }
        }
    }
}

/// One pairing: its money, expandable to its purchases. A gift for the
/// signed-in member shows only its budget.
struct GiftRowCard: View {
    let model: GiftsViewModel
    let presentation: GiftsPresentation
    let row: GiftRow
    let delete: (GiftPurchase) -> Void
    @State private var isOpen = false
    @State private var adding = false
    @State private var editingID: String?

    var body: some View {
        if row.isHidden {
            hiddenRow
        } else {
            visibleRow
        }
    }

    private var hiddenRow: some View {
        GiftListRow {
            HStack(spacing: 6) {
                Text(row.label).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text).lineLimit(1)
                if let date = row.date { GiftCaption(text: GiftsPresentation.date(date)) }
            }
            Spacer(minLength: 0)
            Text(MoneyFormat.cents(row.totals.budgetedCents))
                .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                .foregroundStyle(NestColor.text)
        } caption: {
            GiftCaption(text: "Spending on this gift is hidden from you — this is a gift for you.")
        }
    }

    private var visibleRow: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Button {
                isOpen.toggle()
            } label: {
                GiftListRow {
                    HStack(spacing: 6) {
                        Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                            .font(.system(size: 12, weight: .semibold)).frame(width: 16)
                        Text(row.label).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        if let date = row.date {
                            GiftCaption(text: GiftsPresentation.date(date))
                        }
                    }
                    .foregroundStyle(NestColor.text)
                    Spacer(minLength: 0)
                    Text("Left \(MoneyFormat.cents(row.totals.remainingCents))")
                        .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(MoneySign(cents: row.totals.remainingCents).color ?? NestColor.text)
                } caption: {
                    GiftProgressBar(totals: row.totals)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")

            if isOpen {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    GiftCaption(
                        text:
                            "Budget \(MoneyFormat.cents(row.totals.budgetedCents)) · Spent \(MoneyFormat.cents(row.totals.spentCents))"
                    )
                    let purchases = presentation.purchases(budgetID: row.budgetId)
                    if purchases.isEmpty && !adding { GiftEmptyState(text: "No purchases yet.") }
                    ForEach(purchases) { purchase in
                        if editingID == purchase.id {
                            GiftPurchaseForm(
                                initial: purchase, budgetID: row.budgetId,
                                onSubmit: { values in
                                    let saved = await model.updatePurchase(id: purchase.id, values)
                                    if saved { editingID = nil }
                                    return saved
                                }, onCancel: { editingID = nil })
                        } else {
                            GiftPurchaseRowView(
                                purchase: purchase,
                                onEdit: {
                                    adding = false
                                    editingID = purchase.id
                                }, onDelete: { delete(purchase) })
                        }
                    }
                    if adding {
                        GiftPurchaseForm(
                            budgetID: row.budgetId,
                            onSubmit: { values in
                                let saved = await model.createPurchase(values)
                                if saved { adding = false }
                                return saved
                            }, onCancel: { adding = false })
                    } else {
                        Button("Add purchase") {
                            editingID = nil
                            adding = true
                        }
                        .buttonStyle(GiftButtonStyle(variant: .light, small: true))
                    }
                }
                .padding(.leading, NestSpacing.xs)
            }
        }
    }
}

/// Gift purchases logged with no recipient or occasion yet.
struct GiftUnassignedCard: View {
    let model: GiftsViewModel
    let presentation: GiftsPresentation
    let delete: (GiftPurchase) -> Void
    @State private var isOpen = false
    @State private var adding = false
    @State private var editingID: String?
    @State private var assigningID: String?

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            GiftDisclosure(isOpen: $isOpen) {
                VStack(alignment: .leading, spacing: 4) {
                    GiftHeaderTitle(title: "Unassigned purchases", isOpen: isOpen)
                    GiftCaption(
                        text: "Logged so far \(MoneyFormat.cents(presentation.unassignedSpentCents))")
                }
            } content: {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    GiftCaption(
                        text:
                            "Gift purchases bought with no recipient or occasion in mind yet — assign each one once you know what it’s for."
                    )
                    let purchases = presentation.unassignedPurchases
                    if purchases.isEmpty && !adding {
                        GiftEmptyState(text: "No unassigned purchases.")
                    }
                    ForEach(purchases) { purchase in
                        if editingID == purchase.id {
                            GiftPurchaseForm(
                                initial: purchase,
                                onSubmit: { values in
                                    let saved = await model.updatePurchase(id: purchase.id, values)
                                    if saved { editingID = nil }
                                    return saved
                                }, onCancel: { editingID = nil })
                        } else if assigningID == purchase.id {
                            GiftPurchaseAssignForm(
                                choices: presentation.linkChoices,
                                discretionaryID: presentation.rows.discretionaryBudget?.id,
                                tagChoices: presentation.tagChoices,
                                onSubmit: { values in
                                    let saved = await model.updatePurchase(id: purchase.id, values)
                                    if saved { assigningID = nil }
                                    return saved
                                }, onCancel: { assigningID = nil })
                        } else {
                            GiftPurchaseRowView(
                                purchase: purchase,
                                onAssign: {
                                    adding = false
                                    editingID = nil
                                    assigningID = purchase.id
                                },
                                onEdit: {
                                    adding = false
                                    assigningID = nil
                                    editingID = purchase.id
                                }, onDelete: { delete(purchase) })
                        }
                    }
                    if adding {
                        GiftPurchaseForm(
                            onSubmit: { values in
                                let saved = await model.createPurchase(values)
                                if saved { adding = false }
                                return saved
                            }, onCancel: { adding = false })
                    } else {
                        GiftAddButton(label: "Add purchase") { adding = true }
                    }
                }
            }
        }
    }
}

/// The household's ad hoc gift buffer and its purchases.
struct GiftAdHocCard: View {
    let model: GiftsViewModel
    let presentation: GiftsPresentation
    let delete: (GiftPurchase) -> Void
    @State private var isOpen = false
    @State private var adding = false
    @State private var editingID: String?
    @State private var editingBudget = false
    @State private var amount = ""
    @State private var failed = false

    private var buffer: GiftDiscretionaryBudget? { presentation.rows.discretionaryBudget }

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            GiftDisclosure(isOpen: $isOpen) {
                VStack(alignment: .leading, spacing: 4) {
                    GiftHeaderTitle(title: "Ad hoc gifts", isOpen: isOpen)
                    GiftMoneyBar(totals: presentation.discretionaryTotals, label: "Ad hoc gifts")
                }
            } content: {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    budgetEditor
                    let purchases = presentation.adHocPurchases
                    if purchases.isEmpty && !adding { GiftEmptyState(text: "No ad hoc purchases yet.") }
                    ForEach(purchases) { purchase in
                        if editingID == purchase.id {
                            GiftPurchaseForm(
                                initial: purchase,
                                discretionaryID: purchase.giftDiscretionaryBudgetId,
                                tagChoices: presentation.tagChoices,
                                onSubmit: { values in
                                    let saved = await model.updatePurchase(id: purchase.id, values)
                                    if saved { editingID = nil }
                                    return saved
                                }, onCancel: { editingID = nil })
                        } else {
                            GiftPurchaseRowView(
                                purchase: purchase,
                                recipientLabel: purchase.recipientId.map {
                                    presentation.recipientNames[$0] ?? "Unknown"
                                },
                                onEdit: {
                                    adding = false
                                    editingID = purchase.id
                                }, onDelete: { delete(purchase) })
                        }
                    }
                    if adding, let buffer {
                        GiftPurchaseForm(
                            discretionaryID: buffer.id, tagChoices: presentation.tagChoices,
                            onSubmit: { values in
                                let saved = await model.createPurchase(values)
                                if saved { adding = false }
                                return saved
                            }, onCancel: { adding = false })
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            GiftAddButton(label: "Add purchase") { adding = true }
                                .disabled(buffer == nil)
                            if buffer == nil {
                                GiftCaption(text: "Set a budget above to start logging purchases.")
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var budgetEditor: some View {
        if editingBudget {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                GiftAmountField(label: "Budgeted amount", text: $amount)
                if failed {
                    Text("Could not save this budget. Please try again.")
                        .font(.system(size: 14)).foregroundStyle(NestColor.negative)
                }
                HStack(spacing: NestSpacing.xs) {
                    Button("Save") {
                        guard let cents = GiftMoneyInput.cents(amount) else { return }
                        Task {
                            failed = !(await model.setDiscretionaryBudget(cents: cents))
                            if !failed { editingBudget = false }
                        }
                    }
                    .buttonStyle(GiftButtonStyle(variant: .filled, small: true))
                    .fixedSize().disabled(GiftMoneyInput.cents(amount) == nil)
                    Button("Cancel") { editingBudget = false }
                        .buttonStyle(GiftButtonStyle(variant: .outline, small: true))
                }
            }
        } else {
            Button("Edit budget") {
                amount = GiftMoneyInput.text(cents: buffer?.budgetedAmountCents ?? 0)
                failed = false
                editingBudget = true
            }
            .buttonStyle(GiftButtonStyle(variant: .subtle, small: true))
        }
    }
}

/// The card-spending inbox: unclaimed gift transactions to link or set aside.
struct GiftInboxCard: View {
    let model: GiftsViewModel
    let presentation: GiftsPresentation
    @State private var isOpen = false
    @State private var showDismissed = false
    @State private var linkingID: String?

    var body: some View {
        let candidates = presentation.candidates
        let dismissed = presentation.dismissed
        if !(candidates.isEmpty && dismissed.isEmpty) {
            NestCard(padding: NestSpacing.sm) {
                GiftDisclosure(isOpen: $isOpen) {
                    VStack(alignment: .leading, spacing: 4) {
                        GiftHeaderTitle(
                            title: candidates.isEmpty
                                ? "From your card" : "From your card (\(candidates.count))",
                            isOpen: isOpen)
                        GiftCaption(
                            text: "Gift spending synced from Up. Link one to a gift, or set it aside."
                        )
                    }
                } content: {
                    VStack(alignment: .leading, spacing: NestSpacing.sm) {
                        if !candidates.isEmpty && presentation.linkChoices.isEmpty {
                            GiftCaption(text: "Add a gift budget to link these against.")
                        }
                        ForEach(candidates) { candidate in
                            CandidateRow(candidate: candidate) {
                                if linkingID != candidate.transactionId {
                                    GiftIconButton(systemImage: "gift", label: "Link to a gift") {
                                        linkingID = candidate.transactionId
                                    }
                                    .disabled(presentation.linkChoices.isEmpty)
                                    GiftIconButton(
                                        systemImage: "nosign", label: "Not a gift",
                                        tone: NestColor.dimmedText
                                    ) { Task { _ = await model.dismiss(transactionID: candidate.transactionId) } }
                                }
                            }
                            if linkingID == candidate.transactionId {
                                GiftCandidateLinkForm(
                                    candidate: candidate, choices: presentation.linkChoices,
                                    onSubmit: { values in
                                        let saved = await model.createPurchase(values)
                                        if saved { linkingID = nil }
                                        return saved
                                    }, onCancel: { linkingID = nil })
                            }
                        }
                        if !dismissed.isEmpty {
                            Button(showDismissed ? "Hide set aside" : "Set aside (\(dismissed.count))") {
                                showDismissed.toggle()
                            }
                            .buttonStyle(GiftButtonStyle(variant: .subtle, small: true))
                            if showDismissed {
                                ForEach(dismissed) { candidate in
                                    CandidateRow(candidate: candidate) {
                                        GiftIconButton(systemImage: "arrow.uturn.backward", label: "Undo") {
                                            if let id = candidate.dismissalId {
                                                Task { _ = await model.restore(dismissalID: id) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct CandidateRow<Actions: View>: View {
    let candidate: GiftCandidate
    @ViewBuilder var actions: Actions

    var body: some View {
        GiftListRow {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Text(candidate.title).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    if candidate.pending { NestPill(text: "Pending", tone: .warning) }
                }
                GiftCaption(text: GiftsPresentation.date(candidate.postedOn))
            }
            Spacer(minLength: 0)
            Text(MoneyFormat.cents(candidate.amountCents))
                .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                .foregroundStyle(NestColor.text)
            HStack(spacing: 0) { actions }
        } caption: {
            if candidate.pending {
                GiftCaption(text: "Still held by Up — the amount can change when it settles.")
            }
        }
    }
}
