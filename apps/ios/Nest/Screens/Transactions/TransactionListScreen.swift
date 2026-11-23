import SwiftUI

/// The native transactions route (`/transactions`): every transaction on the
/// accounts the member can see, newest first, filtered by account, date range,
/// kind, status and Up category, with Load more for older pages. Each row names
/// whose it is and expands to the review screen's form.
struct TransactionListScreen: View {
    @State private var model: TransactionListViewModel

    init() {
        _model = State(initialValue: TransactionListViewModel())
    }

    init(model: TransactionListViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { presentation in
            TransactionListContentView(model: model, presentation: presentation)
        }
        .task(id: model.filters) { await model.load() }
    }
}

private struct TransactionListContentView: View {
    @Bindable var model: TransactionListViewModel
    let presentation: TransactionListPresentation

    @State private var giftFiled = false
    @State private var width: Double = 0

    /// The PWA's `SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}`.
    private var columns: Int { width >= 1100 ? 6 : width >= 600 ? 3 : 2 }

    var body: some View {
        NestPageSection(
            title: "Transactions",
            intro: "Every transaction on the accounts you can see. Open one to check its category or add a note."
        ) {
            filterGrid
            if model.filters.isActive {
                Button("Clear filters") { model.filters = TransactionFilters() }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(NestColor.brand)
                    .buttonStyle(.plain)
            }
            if giftFiled { GiftFiledNotice { giftFiled = false } }
            if presentation.rows.isEmpty {
                NestEmptyState(
                    text: model.filters.isActive
                        ? "No transactions match these filters." : "No transactions yet.")
            } else {
                LazyVStack(alignment: .leading, spacing: NestSpacing.sm) {
                    ForEach(presentation.rows) { row in
                        TransactionListRowView(
                            row: row, groups: presentation.groups,
                            onReview: { note, category in
                                await model.review(
                                    transactionID: row.id, note: note, category: category)
                            },
                            onGiftFiled: { giftFiled = true })
                    }
                    if let error = model.loadMoreError { FormError(message: error.userMessage) }
                    if presentation.hasMore { loadMore }
                }
            }
        }
    }

    private var filterGrid: some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: NestSpacing.xs, alignment: .top),
                count: columns),
            alignment: .leading, spacing: NestSpacing.xs
        ) {
            FilterSelect(
                label: "Account", placeholder: "All accounts",
                groups: [FilterOptionGroup(name: nil, options: presentation.accountOptions)],
                selection: $model.filters.account)
            LabelledField(label: "From") {
                InflowDateInput(iso: $model.filters.from, placeholder: "Any date")
            }
            LabelledField(label: "To") {
                InflowDateInput(iso: $model.filters.to, placeholder: "Any date")
            }
            FilterSelect(
                label: "Kind", placeholder: "All kinds",
                groups: [FilterOptionGroup(name: nil, options: TransactionListPresentation.kindOptions)],
                selection: $model.filters.kind)
            FilterSelect(
                label: "Status", placeholder: "Any status",
                groups: [
                    FilterOptionGroup(name: nil, options: TransactionListPresentation.statusOptions)
                ],
                selection: $model.filters.status)
            FilterSelect(
                label: "Category", placeholder: "All categories",
                groups: presentation.categoryOptions, selection: $model.filters.category)
        }
        .onGeometryChange(for: Double.self) { $0.size.width } action: { width = $0 }
    }

    private var loadMore: some View {
        Button {
            Task { await model.loadMore() }
        } label: {
            HStack(spacing: 6) {
                if model.isLoadingMore { ProgressView().controlSize(.small) }
                Text("Load more")
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(NestColor.text)
            .padding(.horizontal, NestSpacing.md)
            .frame(minHeight: 36)
            .outlined()
        }
        .buttonStyle(.plain)
        .disabled(model.isLoadingMore)
        .frame(maxWidth: .infinity)
    }
}

/// A clearable select (Mantine `Select` with `clearable`): the chosen label, or
/// the dimmed placeholder, in an input-styled menu of optionally sectioned choices.
private struct FilterSelect: View {
    let label: String
    let placeholder: String
    let groups: [FilterOptionGroup]
    @Binding var selection: String?

    private var selectedLabel: String? {
        groups.lazy.flatMap(\.options).first { $0.value == selection }?.label
    }

    var body: some View {
        LabelledField(label: label) {
            HStack(spacing: 4) {
                Menu {
                    ForEach(groups) { group in
                        if let name = group.name {
                            Section(name) { buttons(group.options) }
                        } else {
                            buttons(group.options)
                        }
                    }
                } label: {
                    Text(selectedLabel ?? placeholder)
                        .font(.system(size: 14)).lineLimit(1)
                        .foregroundStyle(selectedLabel == nil ? NestColor.dimmedText : NestColor.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
                .accessibilityValue(selectedLabel ?? placeholder)
                if selection != nil {
                    Button { selection = nil } label: {
                        Image(systemName: "xmark").font(.system(size: 11))
                            .foregroundStyle(NestColor.dimmedText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear \(label.lowercased())")
                } else {
                    Image(systemName: "chevron.down").font(.system(size: 11))
                        .foregroundStyle(NestColor.dimmedText)
                }
            }
            .padding(.horizontal, FormMetric.sm)
            .frame(minHeight: 36)
            .outlined()
        }
    }

    private func buttons(_ options: [FilterOption]) -> some View {
        ForEach(options, id: \.value) { option in
            Button(option.label) { selection = option.value }
        }
    }
}

/// One transaction: a header summarising it, naming whose it is, that expands to
/// the review form, beside an "Open in Up" link outside the disclosure. Compact
/// widths render a card, regular widths a dense ruled row.
private struct TransactionListRowView: View {
    let row: TransactionListRow
    let groups: [UpCategoryGroup]
    let onReview: (String, ReviewCategory) async -> ReviewOutcome
    let onGiftFiled: () -> Void

    @State private var isOpen = false

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass == .regular }
    #else
        private var wide: Bool { true }
    #endif

    private var review: ReviewRow { row.review }

    var body: some View {
        if wide {
            VStack(alignment: .leading, spacing: 0) {
                content.padding(.vertical, 6)
                Rectangle().fill(NestColor.border).frame(height: 1)
            }
        } else {
            NestCard(padding: NestSpacing.sm) { content }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: NestSpacing.sm) {
                Button { isOpen.toggle() } label: { header.contentShape(Rectangle()) }
                    .buttonStyle(.plain)
                    .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
                if let link = review.deepLink {
                    Link(destination: link) {
                        Image(systemName: "arrow.up.right.square").font(.system(size: 15))
                            .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
                    }
                    .accessibilityLabel("Open in Up")
                }
            }
            if isOpen {
                ReviewForm(
                    transaction: review.transaction, categorisable: review.categorisable,
                    isGift: review.isGift, deductionDraft: review.deductionDraft, groups: groups,
                    onReview: onReview, onGiftFiled: onGiftFiled
                )
                .padding(.top, NestSpacing.xs)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(NestColor.text)
                .frame(width: 16).padding(.top, 3)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: NestSpacing.xxs) {
                    Text(review.title).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    if review.pending { NestPill(text: "Pending", tone: .warning) }
                    if row.isTransfer { NestPill(text: "Transfer") }
                    if review.reviewed { NestPill(text: "Reviewed", tone: .positive) }
                    if review.hasDeduction { NestPill(text: "Deduction", tone: .positive) }
                }
                HStack(spacing: NestSpacing.xxs) {
                    Text(row.attribution)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(NestColor.dimmedText).lineLimit(1)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .overlay(
                            RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
                                .strokeBorder(NestColor.border, lineWidth: 1))
                    caption(review.meta, dimmed: true)
                }
                caption(review.category, dimmed: false)
                if let note = review.upNote { caption("Up note: \(note)", dimmed: true) }
                if let message = review.upMessage { caption("Up message: \(message)", dimmed: true) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            MoneyText(cents: review.transaction.amountCents)
                .font(.system(size: 14, weight: .semibold))
                .frame(minWidth: 88, alignment: .trailing)
        }
    }

    private func caption(_ text: String, dimmed: Bool) -> some View {
        Text(text).font(NestFont.caption)
            .foregroundStyle(dimmed ? NestColor.dimmedText : NestColor.text).lineLimit(1)
    }
}
