import SwiftUI

/// The native Allowance route: the signed-in member's allowance, how much of it
/// is drawn and left, and the items drawn from it with the PWA's add, edit and
/// delete. With no allowance it says so.
struct AllowanceScreen: View {
    @State private var model: BudgetViewModel
    private let planning = PlanningStore.shared

    init(model: BudgetViewModel = BudgetViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            AllowanceContentView(model: model, presentation: BudgetPresentation(content: content))
        }
        .task(id: planning.revision) { await model.load() }
    }
}

struct AllowanceContentView: View {
    let model: BudgetViewModel
    let presentation: BudgetPresentation

    @State private var editingID: String?
    @State private var adding = false
    @State private var deleting: BudgetLineRow?

    var body: some View {
        NestPageSection(title: presentation.ownAllowance?.title ?? "Allowance") {
            if let allowance = presentation.ownAllowance {
                NestCard {
                    VStack(alignment: .leading, spacing: NestSpacing.xs) {
                        AllowanceRowView(row: allowance, showsTitle: false)
                        Text(BudgetPresentation.allowanceNote)
                            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    }
                }
                NestCard {
                    VStack(alignment: .leading, spacing: NestSpacing.xs) {
                        NestSectionHeader(title: "Items") {
                            if let drawn = allowance.drawnCents {
                                Text(MoneyFormat.perFortnight(Int(drawn)))
                                    .font(.system(size: 15, weight: .bold)).monospacedDigit()
                                    .foregroundStyle(NestColor.text)
                            }
                        }
                        if presentation.drawnLines.isEmpty && !adding {
                            NestEmptyState(text: "Nothing drawn from your allowance yet.")
                        }
                        ForEach(presentation.drawnLines) { row in
                            if editingID == row.id, let line = presentation.line(id: row.id) {
                                form(BudgetLineFormState(initial: line, allowances: choices)) {
                                    try await model.updateLine(id: row.id, $0)
                                }
                            } else {
                                BudgetLineRowView(
                                    row: row,
                                    onEdit: {
                                        adding = false
                                        editingID = row.id
                                    },
                                    onDelete: { deleting = row })
                            }
                        }
                        if adding {
                            form(
                                BudgetLineFormState(
                                    defaultGroup: .discretionary,
                                    defaultAllowanceMemberId: allowance.memberID,
                                    allowances: choices)
                            ) { try await model.createLine($0) }
                        } else {
                            InflowAddButton(label: "Add allowance item") {
                                editingID = nil
                                adding = true
                            }
                            .accessibilityIdentifier("add-allowance-item")
                        }
                        Text(BudgetPresentation.overdrawGuard)
                            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                            .accessibilityIdentifier("overdraw-guard")
                    }
                }
            } else {
                NestEmptyState(text: "You have no spending allowance yet.")
            }
        }
        .budgetLineDeleteAlert($deleting) { try await model.deleteLine(id: $0) }
    }

    /// The signed-in member's own allowance, the one their items draw from.
    private var choices: [AllowanceChoice] { presentation.allowanceChoices }

    private func form(
        _ form: BudgetLineFormState, submit: @escaping (BudgetLineInput) async throws -> Void
    ) -> some View {
        BudgetLineFormView(
            form: form, goals: presentation.goalOptions, accounts: presentation.accountOptions,
            onSubmit: { input in
                try await submit(input)
                editingID = nil
                adding = false
            },
            onCancel: {
                editingID = nil
                adding = false
            })
    }
}
