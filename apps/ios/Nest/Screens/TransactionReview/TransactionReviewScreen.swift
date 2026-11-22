import SwiftUI

/// The native transaction review route (`/transactions/review`): the member's
/// unreviewed Up transactions, each confirmed, recategorised and annotated, or
/// filed as a gift. `focusID` (a notification's `?id=`) leads the list,
/// expanded and scrolled to, even once reviewed.
struct TransactionReviewScreen: View {
    @State private var model: TransactionReviewViewModel

    init(focusID: String? = nil) {
        _model = State(initialValue: TransactionReviewViewModel(focusID: focusID))
    }

    init(model: TransactionReviewViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { presentation in
            TransactionReviewContentView(model: model, presentation: presentation)
        }
        .task { await model.load() }
    }
}

struct TransactionReviewContentView: View {
    let model: TransactionReviewViewModel
    let presentation: TransactionReviewPresentation

    @State private var giftFiled = false

    var body: some View {
        NestPageSection(
            title: "Review transactions",
            intro: "Check each Up transaction's category, fix any that are wrong, and add a note."
        ) {
            if giftFiled { giftNotice }
            if presentation.rows.isEmpty {
                NestEmptyState(text: "Nothing to review.")
            } else {
                ScrollViewReader { proxy in
                    VStack(alignment: .leading, spacing: NestSpacing.sm) {
                        ForEach(presentation.rows) { row in
                            ReviewRowView(
                                row: row, groups: presentation.groups,
                                startsOpen: row.id == presentation.focusedID,
                                onReview: { note, category in
                                    await model.review(
                                        transactionID: row.id, note: note, category: category)
                                },
                                onGiftFiled: { giftFiled = true }
                            )
                            .id(row.id)
                        }
                        if presentation.isCapped {
                            Text(
                                "Showing the newest \(TransactionReviewRows.pageSize). Older ones appear as these are reviewed."
                            )
                            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                        }
                    }
                    .onAppear {
                        if let id = presentation.focusedID { proxy.scrollTo(id, anchor: .center) }
                    }
                }
            }
        }
    }

    /// Points a transaction just filed as a gift on to the Gifts inbox.
    private var giftNotice: some View {
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Filed as a gift. Link it to a recipient from the Gifts inbox.")
                    .font(.system(size: 14)).foregroundStyle(NestColor.info)
                NavigationLink(value: Route.gifts) {
                    Text("Open Gifts").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.brand)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                giftFiled = false
            } label: {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(NestColor.info).frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(FormMetric.xs)
        .background(
            NestColor.info.opacity(0.12),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// One transaction: a header summarising it that expands to the review form,
/// beside an "Open in Up" link that stays outside the disclosure. Compact widths
/// render a card, regular widths a dense ruled row.
private struct ReviewRowView: View {
    let row: ReviewRow
    let groups: [UpCategoryGroup]
    let onReview: (String, ReviewCategory) async -> ReviewOutcome
    let onGiftFiled: () -> Void

    @State private var isOpen: Bool

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass == .regular }
    #else
        private var wide: Bool { true }
    #endif

    init(
        row: ReviewRow, groups: [UpCategoryGroup], startsOpen: Bool,
        onReview: @escaping (String, ReviewCategory) async -> ReviewOutcome,
        onGiftFiled: @escaping () -> Void
    ) {
        self.row = row
        self.groups = groups
        self.onReview = onReview
        self.onGiftFiled = onGiftFiled
        _isOpen = State(initialValue: startsOpen)
    }

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
                if let link = row.deepLink {
                    Link(destination: link) {
                        Image(systemName: "arrow.up.right.square").font(.system(size: 15))
                            .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
                    }
                    .accessibilityLabel("Open in Up")
                }
            }
            if isOpen {
                ReviewForm(
                    transaction: row.transaction, categorisable: row.categorisable,
                    isGift: row.isGift, deductionDraft: row.deductionDraft, groups: groups,
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
                    Text(row.title).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    if row.pending { NestPill(text: "Pending", tone: .warning) }
                    if row.reviewed { NestPill(text: "Reviewed", tone: .positive) }
                    if row.hasDeduction { NestPill(text: "Deduction", tone: .positive) }
                }
                caption(row.meta, dimmed: true)
                caption(row.category, dimmed: false)
                if let note = row.upNote { caption("Up note: \(note)", dimmed: true) }
                if let message = row.upMessage { caption("Up message: \(message)", dimmed: true) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            MoneyText(cents: row.transaction.amountCents)
                .font(.system(size: 14, weight: .semibold))
                .frame(minWidth: 88, alignment: .trailing)
        }
    }

    private func caption(_ text: String, dimmed: Bool) -> some View {
        Text(text).font(NestFont.caption)
            .foregroundStyle(dimmed ? NestColor.dimmedText : NestColor.text).lineLimit(1)
    }
}

/// The editor under an expanded row: category, Nest note, and the review actions.
private struct ReviewForm: View {
    let transaction: LedgerTransaction
    let categorisable: Bool
    let isGift: Bool
    /// Set for an outflow with no deduction yet, offering "Create deduction".
    let deductionDraft: TransactionDeductionDraft?
    let groups: [UpCategoryGroup]
    let onReview: (String, ReviewCategory) async -> ReviewOutcome
    let onGiftFiled: () -> Void

    private enum Action { case save, confirm, gift }

    @State private var categoryID: String?
    @State private var note: String
    @State private var saving: Action?
    @State private var failure: String??

    init(
        transaction: LedgerTransaction, categorisable: Bool, isGift: Bool,
        deductionDraft: TransactionDeductionDraft?, groups: [UpCategoryGroup],
        onReview: @escaping (String, ReviewCategory) async -> ReviewOutcome,
        onGiftFiled: @escaping () -> Void
    ) {
        self.transaction = transaction
        self.categorisable = categorisable
        self.isGift = isGift
        self.deductionDraft = deductionDraft
        self.groups = groups
        self.onReview = onReview
        self.onGiftFiled = onGiftFiled
        _categoryID = State(initialValue: transaction.externalCategory)
        _note = State(initialValue: transaction.notes ?? "")
    }

    private var categoryChanged: Bool { categoryID != transaction.externalCategory }
    private var noteChanged: Bool {
        note.trimmingCharacters(in: .whitespacesAndNewlines) != (transaction.notes ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: FormMetric.sm) {
            LabelledField(
                label: "Category",
                description: categorisable ? nil : "Up does not let this transaction be categorised."
            ) {
                picker
            }
            LabelledField(label: "Nest note") {
                TextField("Only your household sees this", text: $note, axis: .vertical)
                    .lineLimit(2...6)
                    .font(.system(size: 14)).foregroundStyle(NestColor.text)
                    .padding(.horizontal, FormMetric.sm).padding(.vertical, 8)
                    .frame(minHeight: 52, alignment: .topLeading)
                    .outlined()
                    .accessibilityLabel("Nest note")
            }
            if let failure { failureView(failure) }
            HStack(spacing: FormMetric.xs) {
                actionButton("Save", action: .save, style: .primary) {
                    categoryChanged ? .set(categoryID) : .unchanged
                }
                .disabled(!categoryChanged && !noteChanged)
                actionButton("Looks right", action: .confirm, style: .light) { .unchanged }
                    .disabled(categoryChanged)
                if categorisable && !isGift {
                    actionButton("It's a gift", systemImage: "gift", action: .gift, style: .outline) {
                        .set(TransactionReviewPresentation.giftCategory)
                    }
                }
            }
            if let deductionDraft {
                HStack {
                    NavigationLink {
                        DeductionsScreen(draft: deductionDraft)
                            .navigationTitle(Route.deductions.title)
                            #if os(iOS)
                                .navigationBarTitleDisplayMode(.inline)
                            #endif
                    } label: {
                        Label("Create deduction", systemImage: "doc.text")
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(ReviewButtonStyle(kind: .outline))
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var picker: some View {
        Menu {
            Button("Uncategorised") { categoryID = nil }
            ForEach(groups) { group in
                Section(group.name) {
                    ForEach(group.items) { item in
                        Button(item.name) { categoryID = item.id }
                    }
                }
            }
        } label: {
            HStack {
                Text(
                    TransactionReviewPresentation.pickerLabel(
                        groups.flatMap(\.items), categoryID)
                )
                .font(.system(size: 14))
                .foregroundStyle(categoryID == nil ? NestColor.dimmedText : NestColor.text)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11))
                    .foregroundStyle(NestColor.dimmedText)
            }
            .padding(.horizontal, FormMetric.sm)
            .frame(minHeight: 36)
            .outlined()
        }
        .buttonStyle(.plain)
        .disabled(!categorisable)
        .opacity(categorisable ? 1 : 0.5)
        .accessibilityLabel("Category")
    }

    private func failureView(_ code: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            FormError(message: TransactionReviewPresentation.errorMessage(code))
            if TransactionReviewPresentation.needsConnections(code) {
                NavigationLink(value: Route.connections) {
                    Text("Open Connections").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.brand)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func actionButton(
        _ title: String, systemImage: String? = nil, action: Action, style: ReviewButtonStyle.Kind,
        category: @escaping () -> ReviewCategory
    ) -> some View {
        Button {
            Task { await run(action, category: category()) }
        } label: {
            HStack(spacing: 4) {
                if saving == action {
                    ProgressView().controlSize(.small)
                } else if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title)
            }
        }
        .buttonStyle(ReviewButtonStyle(kind: style))
        .disabled(saving != nil)
    }

    private func run(_ action: Action, category: ReviewCategory) async {
        saving = action
        failure = nil
        let outcome = await onReview(note, category)
        saving = nil
        switch outcome {
        case .saved:
            if action == .gift { onGiftFiled() }
        case .failed(let code):
            failure = .some(code)
        }
    }
}

/// The PWA's three `xs` button variants: filled lime, light lime, and default outline.
private struct ReviewButtonStyle: ButtonStyle {
    enum Kind { case primary, light, outline }
    let kind: Kind
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(
                kind == .primary ? NestColor.onBrand : kind == .light ? NestColor.brand : NestColor.text
            )
            .padding(.horizontal, 12)
            .frame(minHeight: 30)
            .background(
                kind == .primary
                    ? NestColor.brand : kind == .light ? NestColor.brand.opacity(0.16) : Color.clear,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay {
                if kind == .outline {
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1)
                }
            }
            .opacity(!isEnabled ? 0.4 : configuration.isPressed ? 0.8 : 1)
    }
}
