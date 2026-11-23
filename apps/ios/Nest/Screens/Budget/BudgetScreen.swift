import SwiftUI

/// The native Budget route: budget lines by group with the engine's fortnightly
/// subtotals and each group's actual spend this pay-cycle fortnight, each
/// member's allowance, and temporary items, with the PWA's add, edit and delete
/// for lines and the allowance edit. A `draft` (a wishlist item promoted to a
/// budget line) opens a prefilled add form above the list.
struct BudgetScreen: View {
    @State private var model: BudgetViewModel
    @State private var spend: ActualSpendViewModel
    @State private var draft: PromoteDraft?
    private let planning = PlanningStore.shared

    init(
        model: BudgetViewModel = BudgetViewModel(),
        spend: ActualSpendViewModel = ActualSpendViewModel(), draft: PromoteDraft? = nil
    ) {
        _model = State(initialValue: model)
        _spend = State(initialValue: spend)
        _draft = State(initialValue: draft)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            BudgetContentView(
                model: model, spend: spend, presentation: BudgetPresentation(content: content),
                draft: $draft)
        }
        .task(id: planning.revision) { await model.load() }
        .task(id: spend.request) { await spend.load() }
    }
}

/// Which inline form is open on the Budget screen.
enum BudgetEditing: Equatable {
    /// The top-level "Add item" form.
    case addItem
    /// A group's own add form.
    case add(BudgetGroup)
    case line(String)
    case allowance(String)
    /// The temporary item add form.
    case addTemporary
    case temporary(String)
}

struct BudgetContentView: View {
    let model: BudgetViewModel
    let spend: ActualSpendViewModel
    let presentation: BudgetPresentation
    @Binding var draft: PromoteDraft?

    @State private var editing: BudgetEditing?
    @State private var deleting: BudgetLineRow?
    @State private var deletingTemporary: TemporaryRow?
    @State private var search = ""
    @State private var editingCategoryGroups = false

    private var searching: Bool { !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NestPageSection(title: "Budget") {
            PlanningBanner()
            if let draft {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    Text(
                        "New budget item from your wishlist item “\(draft.name)”. Pick a frequency for the amount, adjust, and save it — or cancel to leave the wishlist item as it is."
                    )
                    .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                    lineForm(
                        BudgetLineFormState(
                            draft: draft, defaultGroup: .discretionary,
                            allowances: presentation.allowanceChoices),
                        onSaved: { self.draft = nil }
                    ) { try await model.createLine($0) }
                }
            }
            ActualSpendBar(model: spend) { editingCategoryGroups = true }
            InflowAddButton(label: "Add item") { editing = .addItem }
                .accessibilityIdentifier("add-budget-item")
            BudgetSearchField(text: $search)
            SortBar(sort: Bindable(model).lineSort)
            if editing == .addItem {
                lineForm(BudgetLineFormState(allowances: presentation.allowanceChoices)) {
                    try await model.createLine($0)
                }
            }
            ForEach(presentation.groups(search: search, sort: model.lineSort)) { section in
                GroupCard(
                    section: section,
                    spend: spend.spend.map {
                        ActualSpendPresentation.groupSpend(
                            plannedCents: section.subtotalCents, spentCents: $0.groups[section.group])
                    }
                ) {
                    if section.group == .discretionary && !searching {
                        AllowancesBlock(
                            rows: presentation.allowances, editing: $editing,
                            form: allowanceForm)
                    }
                } lines: {
                    if !searching && section.lines.isEmpty && editing != .add(section.group) {
                        NestEmptyState(text: "No \(section.title.lowercased()) items yet.")
                    }
                    ForEach(section.lines) { row in
                        lineRow(row)
                    }
                    if !searching {
                        if editing == .add(section.group) {
                            lineForm(
                                BudgetLineFormState(
                                    defaultGroup: section.group,
                                    allowances: presentation.allowanceChoices)
                            ) { try await model.createLine($0) }
                        } else {
                            InflowAddButton(label: "Add \(section.title) item") {
                                editing = .add(section.group)
                            }
                        }
                    }
                }
            }
            TemporaryCard(
                presentation: presentation, editing: $editing, deleting: $deletingTemporary,
                form: temporaryForm)
        }
        .budgetLineDeleteAlert($deleting) { try await model.deleteLine(id: $0) }
        .sheet(isPresented: $editingCategoryGroups, onDismiss: { spend.refresh() }) {
            CategoryGroupsSheet()
        }
        .alert(
            "Delete temporary item?",
            isPresented: Binding(
                get: { deletingTemporary != nil }, set: { if !$0 { deletingTemporary = nil } }),
            presenting: deletingTemporary
        ) { row in
            Button("Delete", role: .destructive) {
                Task { try? await model.deleteTemporaryItem(id: row.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text("Delete \(row.name)? This cannot be undone.")
        }
    }

    private func temporaryForm(_ id: String?) -> AnyView {
        AnyView(
            TemporaryItemFormView(
                form: TemporaryItemFormState(
                    initial: id.flatMap(presentation.temporaryItem(id:)), today: model.today),
                onSubmit: { input in
                    if let id {
                        try await model.updateTemporaryItem(id: id, input)
                    } else {
                        try await model.createTemporaryItem(input)
                    }
                    editing = nil
                },
                onCancel: { editing = nil }))
    }

    @ViewBuilder private func lineRow(_ row: BudgetLineRow) -> some View {
        if editing == .line(row.id), let line = presentation.line(id: row.id) {
            if row.source != nil {
                DerivedLineFormView(
                    line: row,
                    form: DerivedLineFormState(
                        line: line, breakdown: presentation.breakdown(owning: row.id)),
                    accounts: presentation.accountOptions,
                    onSubmit: { values in
                        try await model.updateDerivedLine(line, values)
                        editing = nil
                    },
                    onCancel: { editing = nil })
            } else {
                lineForm(
                    BudgetLineFormState(initial: line, allowances: presentation.allowanceChoices)
                ) { try await model.updateLine(id: row.id, $0) }
            }
        } else if row.source != nil {
            // A derived line's edit writes its breakdown, which the sandbox does
            // not cover, so it is read-only in planning mode.
            BudgetLineRowView(
                row: row, onEdit: model.isPlanning ? nil : { editing = .line(row.id) })
        } else {
            BudgetLineRowView(
                row: row, onEdit: { editing = .line(row.id) }, onDelete: { deleting = row })
        }
    }

    private func lineForm(
        _ form: BudgetLineFormState, onSaved: (() -> Void)? = nil,
        submit: @escaping (BudgetLineInput) async throws -> Void
    ) -> some View {
        BudgetLineFormView(
            form: form, goals: presentation.goalOptions, accounts: presentation.accountOptions,
            onSubmit: { input in
                try await submit(input)
                editing = nil
                onSaved?()
            },
            onCancel: {
                if let onSaved { onSaved() } else { editing = nil }
            })
    }

    private func allowanceForm(_ row: AllowanceRow) -> AnyView {
        guard let allowance = presentation.allowance(of: row.memberID),
            let member = presentation.content.rows.members.first(where: { $0.id == row.memberID })
        else { return AnyView(EmptyView()) }
        return AnyView(
            MemberAllowanceFormView(
                memberName: member.name,
                form: MemberAllowanceFormState(
                    initial: allowance,
                    drawnAnnualCents: presentation.drawnAnnualCents(of: row.memberID)),
                accounts: presentation.accountOptions,
                onSubmit: { input in
                    try await model.updateAllowance(id: allowance.id, input)
                    editing = nil
                },
                onCancel: { editing = nil }))
    }
}

extension View {
    /// The PWA's "Delete budget item?" confirmation for `target`, deleting with `delete`.
    func budgetLineDeleteAlert(
        _ target: Binding<BudgetLineRow?>, delete: @escaping (String) async throws -> Void
    ) -> some View {
        alert(
            "Delete budget item?",
            isPresented: Binding(get: { target.wrappedValue != nil }, set: { if !$0 { target.wrappedValue = nil } }),
            presenting: target.wrappedValue
        ) { row in
            Button("Delete", role: .destructive) { Task { try? await delete(row.id) } }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text("Delete \(row.name)? This cannot be undone.")
        }
    }
}

/// The PWA's "Search budget items" box, with a clear button once typed in.
private struct BudgetSearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            TextField("Search budget items", text: $text)
                .accessibilityLabel("Search budget items")
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .font(.system(size: 14))
        .foregroundStyle(NestColor.text)
        .padding(.horizontal, NestSpacing.sm)
        .frame(minHeight: 36)
        .outlined()
    }
}

private struct GroupCard<Header: View, Lines: View>: View {
    let section: BudgetGroupSection
    /// The group's spend this fortnight; nil while it loads.
    let spend: ActualSpendPresentation.GroupSpend?
    @ViewBuilder var header: Header
    @ViewBuilder var lines: Lines

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(section.title).font(NestFont.heading).foregroundStyle(NestColor.text)
                    Spacer()
                    Text(MoneyFormat.perFortnight(Int(section.subtotalCents)))
                        .font(.system(size: 15, weight: .bold)).monospacedDigit()
                        .foregroundStyle(NestColor.text)
                        .accessibilityLabel(
                            "\(section.title) fortnightly subtotal \(MoneyFormat.cents(Int(section.subtotalCents)))"
                        )
                }
                if let spend {
                    GroupSpendLine(title: section.title, spend: spend)
                }
                header
                lines
            }
        }
    }
}

/// One budget line: name (with its management link), cadence and route, the
/// amount and its fortnightly figure, then its controls — edit and delete for a
/// manual line, edit (when offered) and a chevron to its source for a derived one.
struct BudgetLineRowView: View {
    let row: BudgetLineRow
    var onEdit: (() -> Void)?
    var onDelete: (() -> Void)?

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            NestListRow(
                title: row.name,
                subtitle: [row.cadence, row.route].compactMap { $0 }.joined(separator: " · ")
            ) {
                VStack(alignment: .trailing, spacing: NestSpacing.xxs) {
                    MoneyText(cents: row.amountCents, colouring: false).font(NestFont.body)
                    Text(MoneyFormat.perFortnight(Int(row.fortnightlyCents)))
                        .font(NestFont.caption).monospacedDigit()
                        .foregroundStyle(NestColor.dimmedText)
                }
            }
            .accessibilityElement(children: .combine)
            if let url = row.managementURL {
                Link(destination: url) {
                    Image(systemName: "arrow.up.right.square").font(.system(size: 14))
                        .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
                }
                .accessibilityLabel("Manage \(row.name) subscription")
            }
            if let onEdit {
                EditDeleteActions(onEdit: onEdit, onDelete: row.source == nil ? onDelete : nil)
            }
            if let source = row.source {
                NavigationLink(value: source.route) {
                    Image(systemName: "chevron.right").font(.system(size: 14))
                        .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(source == .gifts ? "Open gifts" : "Open breakdown")
            }
        }
        .accessibilityIdentifier("budget-line-row")
    }
}

private struct AllowancesBlock: View {
    let rows: [AllowanceRow]
    @Binding var editing: BudgetEditing?
    let form: (AllowanceRow) -> AnyView

    var body: some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                Text("Spending allowances").font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text)
                Text("An amount each person can spend on themselves. \(BudgetPresentation.allowanceNote)")
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                ForEach(rows) { row in
                    if editing == .allowance(row.memberID) {
                        form(row)
                    } else {
                        HStack(alignment: .top, spacing: NestSpacing.xxs) {
                            if row.isOwn {
                                NavigationLink(value: Route.allowance) { AllowanceRowView(row: row) }
                                    .buttonStyle(.plain)
                            } else {
                                AllowanceRowView(row: row)
                            }
                            EditDeleteActions(
                                onEdit: { editing = .allowance(row.memberID) },
                                editLabel: "Edit \(row.title)")
                        }
                    }
                }
            }
        }
    }
}

struct AllowanceRowView: View {
    let row: AllowanceRow
    var showsTitle = true

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            HStack {
                if showsTitle {
                    Text(row.title).font(NestFont.body).foregroundStyle(NestColor.text)
                }
                Spacer()
                if !row.isOwn, let route = row.route {
                    Text(route).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                }
                if row.isOwn && showsTitle {
                    Image(systemName: "chevron.right").font(.caption)
                        .foregroundStyle(NestColor.dimmedText)
                }
            }
            Text(
                "\(MoneyFormat.cents(row.amountCents)) \(row.cadence.lowercased()) (\(MoneyFormat.perFortnight(Int(row.fortnightlyCents))))"
            )
            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            if let drawn = row.drawnCents, let remaining = row.remainingCents {
                ProgressView(value: row.usedFraction).tint(NestColor.positive)
                HStack {
                    Text("Drawn \(MoneyFormat.perFortnight(Int(drawn)))")
                    Spacer()
                    Text("Left \(MoneyFormat.cents(Int(max(0, remaining))))")
                }
                .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        }
        .padding(NestSpacing.xs)
        .background(
            NestColor.surfaceRaised,
            in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// The Temporary group: active items' subtotal, each item with its active or
/// expired flag, edit and delete, and the add affordance, as the PWA's `TemporaryItemList`.
private struct TemporaryCard: View {
    let presentation: BudgetPresentation
    @Binding var editing: BudgetEditing?
    @Binding var deleting: TemporaryRow?
    let form: (String?) -> AnyView

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Temporary").font(NestFont.heading).foregroundStyle(NestColor.text)
                    Spacer()
                    Text(MoneyFormat.perFortnight(presentation.temporarySubtotalCents))
                        .font(.system(size: 15, weight: .bold)).monospacedDigit()
                        .foregroundStyle(NestColor.text)
                }
                if presentation.temporaryItems.isEmpty && editing != .addTemporary {
                    NestEmptyState(text: "No temporary items yet.")
                }
                ForEach(presentation.temporaryItems) { item in
                    if editing == .temporary(item.id) {
                        form(item.id)
                    } else {
                        HStack(spacing: NestSpacing.xs) {
                            NestListRow(
                                title: item.name,
                                subtitle: "until \(BudgetPresentation.date(item.targetDate))"
                            ) {
                                HStack(spacing: NestSpacing.xs) {
                                    NestPill(
                                        text: item.isActive ? "Active" : "Expired",
                                        tone: item.isActive ? .positive : .neutral)
                                    MoneyText(cents: item.contributionCents, colouring: false)
                                        .font(NestFont.body)
                                }
                            }
                            .accessibilityElement(children: .combine)
                            EditDeleteActions(
                                onEdit: { editing = .temporary(item.id) }, onDelete: { deleting = item })
                        }
                    }
                }
                if editing == .addTemporary {
                    form(nil)
                } else {
                    InflowAddButton(label: "Add temporary item") { editing = .addTemporary }
                }
            }
        }
    }
}
