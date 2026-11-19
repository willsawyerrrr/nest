import SwiftUI

/// The native HELP debt route: each member's standing HELP/HECS balance, with an inline editor.
struct HelpDebtScreen: View {
    @State private var model: HelpDebtViewModel

    init(model: HelpDebtViewModel = HelpDebtViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { rows in
            HelpDebtContentView(
                presentation: HelpDebtPresentation(rows: rows),
                save: { try await model.save(memberID: $0, balanceCents: $1) })
        }
        .task { await model.load() }
    }
}

struct HelpDebtContentView: View {
    let presentation: HelpDebtPresentation
    let save: (String, Int) async throws -> Void

    @State private var editingID: String?

    var body: some View {
        NestPageSection(title: HelpDebtPresentation.title, intro: HelpDebtPresentation.intro) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                ForEach(presentation.rows) { row in
                    if editingID == row.id {
                        HelpDebtForm(
                            row: row,
                            onSubmit: { cents in
                                try await save(row.id, cents)
                                editingID = nil
                            },
                            onCancel: { editingID = nil })
                    } else {
                        HelpDebtItem(row: row, onEdit: { editingID = row.id })
                    }
                }
            }
        }
    }
}

/// One member's balance: a dense row where there is room, a bordered card on a phone.
private struct HelpDebtItem: View {
    let row: HelpDebtRow
    let onEdit: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    var body: some View {
        if wide { rowBody } else { cardBody }
    }

    private var name: some View {
        Text(row.name).font(.system(size: 14, weight: .semibold))
            .foregroundStyle(NestColor.text).lineLimit(1)
    }

    private var balance: some View {
        MoneyText(cents: row.balanceCents, colouring: false).font(.system(size: 14, weight: .bold))
    }

    private var edit: some View {
        EditDeleteActions(onEdit: onEdit, editLabel: "Edit \(row.name)’s HELP debt")
    }

    private var rowBody: some View {
        HStack(spacing: NestSpacing.sm) {
            name.frame(maxWidth: .infinity, alignment: .leading)
            balance.frame(width: 112, alignment: .trailing)
            edit
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }

    private var cardBody: some View {
        HStack(spacing: NestSpacing.sm) {
            name
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                balance
                edit
            }
        }
        .padding(FormMetric.xs)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}

/// The inline editor: a dollar balance over Save and Cancel.
private struct HelpDebtForm: View {
    let row: HelpDebtRow
    let onSubmit: (Int) async throws -> Void
    let onCancel: () -> Void

    @State private var balance: String
    @State private var submitting = false
    @State private var failed = false

    init(
        row: HelpDebtRow, onSubmit: @escaping (Int) async throws -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.row = row
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _balance = State(initialValue: HelpDebtPresentation.input(row.storedCents))
    }

    var body: some View {
        FormCard {
            Text(row.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(NestColor.text)
            TextInput(label: "HELP debt", prefix: "$", decimal: true, text: $balance)
            if failed { FormError(message: HelpDebtPresentation.saveError) }
            FormFooter(
                submitLabel: "Save", canSubmit: true, submitting: submitting, onSubmit: submit,
                onCancel: onCancel)
        }
    }

    private func submit() {
        guard !submitting else { return }
        submitting = true
        failed = false
        Task {
            do {
                try await onSubmit(HelpDebtPresentation.cents(fromDollars: balance))
            } catch { failed = true }
            submitting = false
        }
    }
}
