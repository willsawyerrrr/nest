import SwiftUI

/// The native Wishlist route: the household's aspirational purchases, sorted by
/// title or amount, with add, edit, delete and the two promote actions.
struct WishlistScreen: View {
    @State private var model: WishlistViewModel

    init(model: WishlistViewModel = WishlistViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { rows in
            WishlistContentView(
                presentation: WishlistPresentation(rows: rows, sort: model.sort),
                sort: $model.sort,
                save: { input, id in try await model.save(input, id: id) },
                remove: { id in try await model.remove(id: id) })
        }
        .task { await model.load() }
    }
}

/// A web page shown in a sheet, identified by its path.
private struct WebPage: Identifiable {
    let path: String
    var id: String { path }
}

struct WishlistContentView: View {
    let presentation: WishlistPresentation
    @Binding var sort: WishlistSort
    let save: (WishlistItemInput, String?) async throws -> Void
    let remove: (String) async throws -> Void

    @State private var editingID: String?
    @State private var adding = false
    @State private var deleting: WishlistItemRow?
    @State private var deleteFailed = false
    @State private var page: WebPage?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                PageHeader(title: WishlistPresentation.title, intro: WishlistPresentation.intro)
                if !presentation.rows.isEmpty { SortBar(sort: $sort) }
                if presentation.rows.isEmpty && !adding {
                    Text(WishlistPresentation.emptyMessage)
                        .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                }
                ForEach(presentation.rows) { row in
                    if editingID == row.id {
                        WishlistForm(
                            draft: WishlistDraft(row: row),
                            members: presentation.members, editing: true,
                            onSubmit: { draft in
                                try await save(draft.input, row.id)
                                editingID = nil
                            },
                            onCancel: { editingID = nil })
                    } else {
                        WishlistItemView(
                            row: row,
                            onEdit: { editingID = row.id; adding = false },
                            onDelete: { deleting = row },
                            onPromote: { page = WebPage(path: WishlistPresentation.promotionPath($0, row: row)) })
                    }
                }
                if adding {
                    WishlistForm(
                        draft: WishlistDraft(), members: presentation.members, editing: false,
                        onSubmit: { draft in
                            try await save(draft.input, nil)
                            adding = false
                        },
                        onCancel: { adding = false })
                } else {
                    Button { adding = true; editingID = nil } label: {
                        Label(WishlistPresentation.addLabel, systemImage: "plus")
                    }
                    .buttonStyle(NestPrimaryButtonStyle())
                }
            }
            .padding(NestSpacing.md)
        }
        .alert(
            WishlistPresentation.deleteTitle, isPresented: Binding(
                get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { row in
            Button("Delete", role: .destructive) {
                Task {
                    do { try await remove(row.id) } catch { deleteFailed = true }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text("Delete \(row.name)? This cannot be undone.")
        }
        .alert("Couldn't delete", isPresented: $deleteFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Something went wrong. Try again.")
        }
        .sheet(item: $page) { page in
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Done") { self.page = nil }.padding(NestSpacing.md)
                }
                WebRouteView(path: page.path)
            }
        }
    }
}

/// The page title and its dimmed intro, as the PWA's `PageSection` draws them.
private struct PageHeader: View {
    let title: String
    let intro: String

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text(title)
                .font(.system(size: 38, weight: .bold, design: .rounded))
                .tracking(-0.76)
                .foregroundStyle(NestColor.text)
                .accessibilityAddTraits(.isHeader)
            Text(intro).font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
        }
    }
}

/// The sort `Select` and direction toggle, right-aligned.
private struct SortBar: View {
    @Binding var sort: WishlistSort

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            Spacer()
            Menu {
                Picker("Sort by", selection: $sort.key) {
                    ForEach(WishlistSortKey.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            } label: {
                HStack {
                    Text(sort.key.label)
                    Spacer(minLength: NestSpacing.xs)
                    Image(systemName: "chevron.down").font(.system(size: 11))
                }
                .font(.system(size: 14))
                .foregroundStyle(NestColor.text)
                .padding(.horizontal, NestSpacing.sm)
                .frame(width: 140, height: 36)
                .outlined()
            }
            .accessibilityLabel("Sort by")
            Button { sort.direction = sort.direction.toggled } label: {
                Text(sort.direction.glyph)
                    .font(.system(size: 16)).foregroundStyle(NestColor.text)
                    .frame(width: 36, height: 36).outlined()
            }
            .accessibilityLabel("Toggle sort direction")
        }
    }
}

/// One wishlist item: a dense row where there is room, a bordered card on a phone.
private struct WishlistItemView: View {
    let row: WishlistItemRow
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onPromote: (WishlistPromotion) -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    var body: some View {
        if wide { rowBody } else { cardBody }
    }

    private var title: some View {
        HStack(spacing: 6) {
            Text(row.name).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.text).lineLimit(1)
            if let owner = row.ownerName { OwnerBadge(name: owner) }
        }
    }

    private var amount: some View {
        Text(MoneyFormat.cents(row.amountCents))
            .font(.system(size: 14, weight: .semibold)).monospacedDigit()
            .foregroundStyle(NestColor.text)
    }

    private var actions: some View {
        HStack(spacing: NestSpacing.xxs) {
            PromoteMenu(onPromote: onPromote)
            IconButton(systemImage: "pencil", label: "Edit", tint: NestColor.dimmedText, action: onEdit)
            IconButton(systemImage: "trash", label: "Delete", tint: NestColor.negative, action: onDelete)
        }
    }

    private var rowBody: some View {
        VStack(alignment: .leading, spacing: row.note == nil ? 0 : 4) {
            HStack(spacing: NestSpacing.sm) {
                title.frame(maxWidth: .infinity, alignment: .leading)
                amount.frame(width: 112, alignment: .trailing)
                actions
            }
            if let note = row.note {
                Text(note).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText).lineLimit(1)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }

    private var cardBody: some View {
        HStack(alignment: .top, spacing: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                title
                if let note = row.note {
                    Text(note).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: NestSpacing.xxs) {
                amount
                actions
            }
        }
        .padding(NestSpacing.xs)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}

/// The owner pill beside an item's name (a small, neutral light badge).
private struct OwnerBadge: View {
    let name: String

    var body: some View {
        Text(name)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(NestColor.dimmedText)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(
                NestColor.dimmedText.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            .fixedSize()
    }
}

/// The overflow menu holding an item's two promote actions.
private struct PromoteMenu: View {
    let onPromote: (WishlistPromotion) -> Void

    var body: some View {
        Menu {
            Button { onPromote(.goal) } label: { Label("Make a savings goal", systemImage: "scope") }
            Button { onPromote(.budget) } label: {
                Label("Add to budget", systemImage: "building.columns")
            }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 14))
                .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
        }
        .accessibilityLabel("Promote")
    }
}

/// A subtle square icon control, as Mantine's `ActionIcon`.
private struct IconButton: View {
    let systemImage: String
    let label: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage).font(.system(size: 14))
                .foregroundStyle(tint).frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The add/edit form: a bordered card of labelled fields over a submit and cancel row.
private struct WishlistForm: View {
    @State var draft: WishlistDraft
    let members: [Member]
    let editing: Bool
    let onSubmit: (WishlistDraft) async throws -> Void
    let onCancel: () -> Void

    @State private var submitting = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            NestField(label: "Name", text: $draft.name)
            VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                Text("Rough cost").font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
                HStack(spacing: NestSpacing.xxs) {
                    Text("$").foregroundStyle(NestColor.dimmedText)
                    TextField("", text: $draft.amount)
                        #if os(iOS)
                            .keyboardType(.decimalPad)
                        #endif
                }
                .textFieldStyle(NestTextFieldStyle())
            }
            if !members.isEmpty { memberPicker }
            VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                NestField(label: "Note", text: $draft.note)
                Text("Optional.").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            if failed {
                Text(WishlistPresentation.saveError)
                    .font(.system(size: 12)).foregroundStyle(NestColor.negative)
            }
            HStack(spacing: NestSpacing.xs) {
                Button(submitLabel, action: submit)
                    .buttonStyle(NestPrimaryButtonStyle())
                    .disabled(!draft.canSubmit || submitting)
                    .opacity(draft.canSubmit && !submitting ? 1 : 0.5)
                Button("Cancel", action: onCancel)
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(NestColor.text)
                    .frame(maxWidth: .infinity).padding(.vertical, NestSpacing.sm).outlined()
                    .disabled(submitting)
            }
        }
        .padding(NestSpacing.sm)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }

    private var memberPicker: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text("Whose wish").font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            Text("Optional. A tag for reporting only — money stays pooled.")
                .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            Menu {
                Button("No one in particular") { draft.memberID = nil }
                ForEach(members) { member in
                    Button(member.name) { draft.memberID = member.id }
                }
            } label: {
                HStack {
                    Text(members.first { $0.id == draft.memberID }?.name ?? "No one in particular")
                        .foregroundStyle(draft.memberID == nil ? NestColor.dimmedText : NestColor.text)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 11))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .font(NestFont.body)
                .padding(NestSpacing.sm)
                .outlined()
            }
        }
    }

    private var submitLabel: String {
        submitting ? "Saving…" : editing ? "Save changes" : WishlistPresentation.addLabel
    }

    private func submit() {
        guard draft.canSubmit, !submitting else { return }
        submitting = true
        failed = false
        Task {
            do { try await onSubmit(draft) } catch { failed = true }
            submitting = false
        }
    }
}

private extension View {
    /// A bordered rounded outline on the elevated surface, as a default input or button.
    func outlined() -> some View {
        background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}
