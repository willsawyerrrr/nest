import SwiftUI

/// The native Equity route: each member's grants with vesting progress and value,
/// and the exercises and sales recorded against them, with add, edit and delete.
struct EquityScreen: View {
    @State private var model: EquityViewModel

    init(model: EquityViewModel = EquityViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            EquityContentView(model: model, presentation: EquityPresentation(content: content))
        }
        .task { await model.load() }
    }
}

/// Which list an inline form or delete prompt belongs to.
enum EquityKind: Equatable {
    case grant, exercise, sale

    /// The noun the delete prompt names.
    var noun: String {
        switch self {
        case .grant: "grant"
        case .exercise: "exercise"
        case .sale: "sale"
        }
    }
}

/// What the inline form is doing: adding to a member's list or editing a row.
enum EquityEditing: Equatable {
    case none
    case adding(EquityKind, memberID: String)
    case editing(EquityKind, id: String)
}

/// The row a delete prompt asks about.
struct EquityDeletion: Equatable {
    let kind: EquityKind
    let id: String
    /// The bold name in the prompt: the grant's label, or `<grant> exercise` / `<grant> sale`.
    let itemLabel: String
}

struct EquityContentView: View {
    let model: EquityViewModel
    let presentation: EquityPresentation

    @State private var editing = EquityEditing.none
    @State private var deleting: EquityDeletion?
    @State private var deleteFailed = false

    var body: some View {
        NestPageSection(title: EquityPresentation.title, intro: EquityPresentation.intro) {
            ForEach(presentation.members) { member in
                MemberSection(
                    member: member, rows: presentation.content.rows, model: model,
                    editing: $editing, onDelete: { deleting = $0 })
            }
        }
        .alert(
            "Delete \(deleting?.kind.noun ?? "")?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { target in
            Button("Delete", role: .destructive) {
                Task {
                    do { try await remove(target) } catch { deleteFailed = true }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text("Delete \(target.itemLabel)? This cannot be undone.")
        }
        .alert("Couldn't delete", isPresented: $deleteFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(EquityPresentation.deleteError)
        }
    }

    private func remove(_ target: EquityDeletion) async throws {
        switch target.kind {
        case .grant: try await model.removeGrant(id: target.id)
        case .exercise: try await model.removeExercise(id: target.id)
        case .sale: try await model.removeSale(id: target.id)
        }
    }
}

private struct MemberSection: View {
    let member: MemberEquity
    let rows: EquityRows
    let model: EquityViewModel
    @Binding var editing: EquityEditing
    let onDelete: (EquityDeletion) -> Void

    private var grants: [EquityGrant] { rows.grants.filter { $0.memberId == member.id } }
    private var optionGrants: [EquityGrant] {
        grants.filter { $0.instrumentType == EquityPresentation.option }
    }

    private func isAdding(_ kind: EquityKind) -> Bool {
        editing == .adding(kind, memberID: member.id)
    }

    private func done() { editing = .none }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(member.name).font(.system(size: 16, weight: .semibold))
                .foregroundStyle(NestColor.text)
            if member.grants.isEmpty && !isAdding(.grant) {
                NestEmptyState(text: EquityPresentation.noGrants)
            }
            ForEach(member.grants) { grant in
                if editing == .editing(.grant, id: grant.id),
                    let row = rows.grants.first(where: { $0.id == grant.id })
                {
                    EquityGrantFormView(
                        memberID: member.id, editing: row,
                        onSubmit: { try await model.saveGrant($0, id: grant.id); done() },
                        onCancel: done)
                } else {
                    GrantItem(
                        grant: grant, onEdit: { editing = .editing(.grant, id: grant.id) },
                        onDelete: {
                            onDelete(.init(kind: .grant, id: grant.id, itemLabel: grant.label))
                        })
                }
            }
            if isAdding(.grant) {
                EquityGrantFormView(
                    memberID: member.id, editing: nil,
                    onSubmit: { try await model.saveGrant($0); done() }, onCancel: done)
            } else {
                AddButton(label: "Add grant") { editing = .adding(.grant, memberID: member.id) }
            }
            if let exercises = member.exercises {
                ActivitySection(
                    title: "Exercises", empty: EquityPresentation.noExercises,
                    addLabel: "Record exercise", kind: .exercise, memberID: member.id,
                    rows: exercises, editing: $editing, onDelete: onDelete
                ) { id in
                    EquityExerciseFormView(
                        memberID: member.id, grants: optionGrants, rows: rows,
                        editing: id.flatMap { id in rows.exercises.first { $0.id == id } },
                        onSubmit: { try await model.saveExercise($0, id: id); done() },
                        onCancel: done)
                }
            }
            if let sales = member.sales {
                ActivitySection(
                    title: "Sales", empty: EquityPresentation.noSales, addLabel: "Record sale",
                    kind: .sale, memberID: member.id, rows: sales, editing: $editing,
                    onDelete: onDelete
                ) { id in
                    EquitySaleFormView(
                        memberID: member.id, grants: grants, rows: rows,
                        editing: id.flatMap { id in rows.sales.first { $0.id == id } },
                        onSubmit: { try await model.saveSale($0, id: id); done() },
                        onCancel: done)
                }
            }
        }
    }
}

/// A member's exercises or sales: each row (or its edit form), then the add form
/// or its button.
private struct ActivitySection<Form: View>: View {
    let title: String
    let empty: String
    let addLabel: String
    let kind: EquityKind
    let memberID: String
    let rows: [ActivityRow]
    @Binding var editing: EquityEditing
    let onDelete: (EquityDeletion) -> Void
    /// The form editing row `id`, or adding one when `nil`.
    @ViewBuilder let form: (String?) -> Form

    private var adding: Bool { editing == .adding(kind, memberID: memberID) }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(title).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.dimmedText)
            if rows.isEmpty && !adding { NestEmptyState(text: empty) }
            ForEach(rows) { row in
                if editing == .editing(kind, id: row.id) {
                    form(row.id)
                } else {
                    ActivityCard(
                        row: row, onEdit: { editing = .editing(kind, id: row.id) },
                        onDelete: {
                            onDelete(
                                .init(
                                    kind: kind, id: row.id,
                                    itemLabel: "\(row.grantLabel) \(kind.noun)"))
                        })
                }
            }
            if adding {
                form(nil)
            } else {
                AddButton(label: addLabel) { editing = .adding(kind, memberID: memberID) }
            }
        }
    }
}

/// A small label beside a grant's name, as Mantine's `Badge`: tinted when `tint`
/// is set (`light`), else outlined (`default`).
private struct EquityBadge: View {
    let text: String
    var tint: Color?

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(tint ?? NestColor.dimmedText)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(
                tint?.opacity(0.16) ?? .clear,
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
            )
            .overlay {
                if tint == nil {
                    RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1)
                }
            }
            .fixedSize()
    }
}

private extension GrantRow {
    var instrumentTint: Color {
        isOption ? ChartColorKey.wants.color : ChartColorKey.investments.color
    }
}

/// One grant: a dense row where there is room, a bordered card on a phone.
private struct GrantItem: View {
    let grant: GrantRow
    let onEdit: () -> Void
    let onDelete: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    var body: some View {
        if wide { rowBody } else { cardBody }
    }

    private var badges: some View {
        HStack(spacing: 6) {
            EquityBadge(text: grant.instrumentLabel, tint: grant.instrumentTint)
            EquityBadge(text: grant.frequencyLabel)
        }
    }

    private var net: some View {
        Text(MoneyFormat.cents(Int(grant.netCents)))
            .font(.system(size: 14, weight: .bold)).monospacedDigit()
            .foregroundStyle(NestColor.text)
    }

    private var rowBody: some View {
        VStack(alignment: .leading, spacing: grant.caption == nil ? 0 : 4) {
            HStack(spacing: NestSpacing.sm) {
                HStack(spacing: 6) {
                    Text(grant.label).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    badges
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(grant.vestedLabel).font(.system(size: 12))
                    .foregroundStyle(NestColor.dimmedText)
                    .frame(width: 144, alignment: .trailing)
                net.frame(width: 112, alignment: .trailing)
                EditDeleteActions(onEdit: onEdit, onDelete: onDelete)
            }
            if let caption = grant.caption {
                Text(caption).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
        .accessibilityElement(children: .contain)
    }

    private var cardBody: some View {
        HStack(alignment: .top, spacing: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(grant.label).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text).lineLimit(1)
                HStack(spacing: 6) {
                    badges
                    Text(grant.vestedLabel).font(.system(size: 12))
                        .foregroundStyle(NestColor.dimmedText)
                }
                if let line = grant.valueLine {
                    Text(line).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
                if let line = grant.activityLine {
                    Text(line).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: NestSpacing.xxs) {
                net
                EditDeleteActions(onEdit: onEdit, onDelete: onDelete)
            }
        }
        .padding(NestSpacing.xs)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

/// One recorded exercise or sale as a compact bordered card.
private struct ActivityCard: View {
    let row: ActivityRow
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text).lineLimit(1)
                Text(row.detail).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            EditDeleteActions(onEdit: onEdit, onDelete: onDelete)
        }
        .padding(NestSpacing.xs)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}
