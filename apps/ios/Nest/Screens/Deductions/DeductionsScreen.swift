import SwiftUI

/// Bumped when something outside a Deductions screen wrote deductions (the shared-receipts
/// sheet), so a screen underneath reloads.
@MainActor @Observable
final class DeductionsRevision {
    static let shared = DeductionsRevision()
    private(set) var value = 0
    func bump() { value += 1 }
}

/// The native Deductions route: each member's deductions for a financial year with a
/// running total, groups of payments, the receipt-first add card, the bulk receipt
/// review and drag-to-group filing. Mirrors the web `DeductionsScreen`.
struct DeductionsScreen: View {
    @State private var model: DeductionsViewModel
    /// Whether this screen takes the files shared into the app from other apps.
    let consumesSharedFiles: Bool
    @Environment(\.openURL) private var openURL
    private let revision = DeductionsRevision.shared

    init(model: DeductionsViewModel = DeductionsViewModel(), consumesSharedFiles: Bool = false) {
        _model = State(initialValue: model)
        self.consumesSharedFiles = consumesSharedFiles
    }

    private struct LoadID: Hashable {
        let year: Int?
        let revision: Int
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            DeductionsPage(model: model, content: content, openURL: { openURL($0) })
        }
        .task(id: LoadID(year: model.financialYear, revision: revision.value)) {
            await model.load()
            if consumesSharedFiles { SharedReceipts.take(into: model) }
        }
        .onDisappear { model.close() }
        #if os(iOS)
            .onReceive(
                NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            ) { _ in if consumesSharedFiles { SharedReceipts.take(into: model) } }
        #else
            .onReceive(
                NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
            ) { _ in if consumesSharedFiles { SharedReceipts.take(into: model) } }
        #endif
    }
}

private struct DeductionsPage: View {
    let model: DeductionsViewModel
    let content: DeductionsContent
    let openURL: (URL) -> Void

    var body: some View {
        let presentation = DeductionsPresentation(rows: content.rows)
        NestPageSection(
            title: "Tax deductions (FY\(content.financialYear))",
            intro:
                "Each member’s deductible expenses for the financial year, with a receipt stored privately — pick the receipt before saving a new deduction and its details are read for you to check. A member’s deductions reduce their taxable income on the Tax tab, lowering their estimated tax and lifting take-home on the Summary."
        ) {
            SelectInput(
                label: "Financial year",
                options: content.availableYears.map { (value: $0, label: "FY\($0)") },
                selection: Binding(
                    get: { content.financialYear },
                    set: { model.selectFinancialYear($0) })
            )
            .frame(width: 160)
            ForEach(presentation.members) { member in
                MemberSection(
                    model: model, content: content, presentation: presentation,
                    member: member, openURL: openURL)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

/// One member's deductions: name and total, the receipt review, the groups, and the
/// ungrouped deductions, each list ending in its add control.
private struct MemberSection: View {
    let model: DeductionsViewModel
    let content: DeductionsContent
    let presentation: DeductionsPresentation
    let member: MemberDeductions
    let openURL: (URL) -> Void

    @State private var drag = DeductionDrag()
    @State private var addingGroup = false
    @State private var editingGroup: String?
    @State private var addingDeduction = false
    @State private var editingDeduction: String?
    @State private var addingPaymentIn: String?
    @State private var pendingDelete: PendingDelete?
    @State private var deleteError: String?

    private struct PendingDelete: Identifiable {
        let id = UUID()
        let title: String
        let label: String
        let confirm: () async throws -> Void
    }

    private var groups: [DeductionGroup] { content.rows.groups.filter { $0.memberId == member.member.id } }
    private var memberDeductions: [Deduction] {
        content.rows.deductions.filter { $0.memberId == member.member.id }
    }
    private var queue: UploadQueue<DeductionDraft> { model.queue(for: member.member.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: FormMetric.xs) {
            HStack {
                Text(member.member.name).font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(NestColor.text)
                Spacer()
                Text(MoneyFormat.cents(member.totalCents))
                    .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(NestColor.text)
            }
            review
            groupsList
            if let error = model.moveError { FormError(message: error) }
            ungroupedList
            if let deleteError { FormError(message: deleteError) }
        }
        .alert(
            pendingDelete?.title ?? "Delete?", isPresented: Binding(
                get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete
        ) { target in
            Button("Delete", role: .destructive) {
                Task {
                    deleteError = nil
                    do { try await target.confirm() } catch {
                        deleteError = "Could not delete this. Please try again."
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text("Delete \(target.label)? This cannot be undone.")
        }
    }

    // MARK: Review

    private var review: some View {
        BulkUploadPanel(queue: queue) { item, controls in
            let category = model.ledger.category(forID: item.id)
            DeductionFormView(
                state: DeductionFormState(
                    memberID: member.member.id, financialYear: content.financialYear,
                    groups: groups, category: category, extraction: item.value?.extraction),
                draft: DeductionFormDraft(
                    id: item.id, path: item.path ?? "", extraction: item.value?.extraction,
                    category: category),
                cancelLabel: "Discard", controls: controls, figures: ScreenEngine.figures,
                onSubmit: { try await model.create($0) }, onCancel: controls.discard)
        }
    }

    // MARK: Groups

    private var groupsList: some View {
        VStack(alignment: .leading, spacing: FormMetric.xs) {
            ForEach(member.groups) { entry in
                if editingGroup == entry.id {
                    DeductionGroupForm(
                        initial: entry.group,
                        onSubmit: { name in
                            try await model.updateGroup(
                                id: entry.id, memberID: member.member.id, name: name)
                            editingGroup = nil
                        }, onCancel: { editingGroup = nil })
                } else {
                    DeductionDropTarget(
                        dropID: DeductionDrop.dropID(group: entry.id), drag: drag,
                        deductions: memberDeductions, groups: groups,
                        onMove: { deduction, groupID in Task { await model.move(deduction, to: groupID) } }
                    ) {
                        DeductionGroupCard(
                            entry: entry, onEdit: { editingGroup = entry.id },
                            onDelete: {
                                pendingDelete = PendingDelete(
                                    title: "Delete group?", label: entry.group.name,
                                    confirm: { try await model.deleteGroup(id: entry.id) })
                            }
                        ) { payments(of: entry) }
                    }
                }
            }
            if addingGroup {
                DeductionGroupForm(
                    initial: nil,
                    onSubmit: { name in
                        try await model.createGroup(memberID: member.member.id, name: name)
                        addingGroup = false
                    }, onCancel: { addingGroup = false })
            } else {
                AddButton(label: "Add group") { addingGroup = true }
            }
        }
    }

    @ViewBuilder private func payments(of entry: GroupedPayments) -> some View {
        if entry.payments.isEmpty && addingPaymentIn != entry.id {
            NestEmptyState(text: "No payments yet.")
        }
        ForEach(entry.payments) { deduction in paymentRow(deduction) }
        if addingPaymentIn == entry.id {
            DeductionFormView(
                state: DeductionFormState(
                    memberID: member.member.id, financialYear: content.financialYear,
                    openedFrom: entry.group, groups: groups),
                attachment: ReceiptAttachment(handlers: model.attachmentHandlers),
                addLabel: "payment", figures: ScreenEngine.figures,
                onSubmit: { try await model.create($0); addingPaymentIn = nil },
                onCancel: { addingPaymentIn = nil })
        } else {
            AddButton(label: "Add payment") { addingPaymentIn = entry.id }
        }
    }

    // MARK: Ungrouped

    private var ungroupedList: some View {
        DeductionDropTarget(
            dropID: DeductionDrop.ungroupedID, drag: drag, deductions: memberDeductions,
            groups: groups,
            onMove: { deduction, groupID in Task { await model.move(deduction, to: groupID) } }
        ) {
            VStack(alignment: .leading, spacing: 6) {
                if member.ungrouped.isEmpty && !addingDeduction {
                    NestEmptyState(text: "No deductions yet.")
                }
                ForEach(member.ungrouped) { deduction in paymentRow(deduction) }
                if addingDeduction {
                    DeductionFormView(
                        state: DeductionFormState(
                            memberID: member.member.id, financialYear: content.financialYear,
                            groups: groups),
                        attachment: ReceiptAttachment(handlers: model.attachmentHandlers),
                        onAddFiles: { files, category in
                            model.addReceipts(files, memberID: member.member.id, category: category)
                        },
                        figures: ScreenEngine.figures,
                        onSubmit: { try await model.create($0); addingDeduction = false },
                        onCancel: { addingDeduction = false })
                } else {
                    AddButton(label: "Add deduction") { addingDeduction = true }
                }
            }
        }
    }

    // MARK: Rows

    @ViewBuilder private func paymentRow(_ deduction: Deduction) -> some View {
        if editingDeduction == deduction.id {
            DeductionFormView(
                state: DeductionFormState(
                    memberID: member.member.id, financialYear: content.financialYear,
                    initial: deduction, groups: groups),
                receiptControls: receiptControls(for: deduction), figures: ScreenEngine.figures,
                onSubmit: { submission in
                    try await model.update(id: deduction.id, submission.write)
                    editingDeduction = nil
                }, onCancel: { editingDeduction = nil })
        } else {
            let receipt = presentation.receipt(for: deduction)
            DeductionItemView(
                deduction: deduction, hasReceipt: receipt != nil,
                // A donation sits in its donations group and nowhere else, so it has no grip.
                drag: deduction.category == .donation ? nil : drag,
                onViewReceipt: {
                    guard let receipt else { return }
                    Task { if let url = await model.service.signedURL(path: receipt.storagePath) { openURL(url) } }
                },
                onEdit: { editingDeduction = deduction.id },
                onDelete: {
                    pendingDelete = PendingDelete(
                        title: deduction.groupId == nil ? "Delete deduction?" : "Delete payment?",
                        label: deduction.description,
                        confirm: { try await model.delete(id: deduction.id) })
                })
        }
    }

    private func receiptControls(for deduction: Deduction) -> ReceiptControls {
        let existing = presentation.receipt(for: deduction)
        return ReceiptControls(
            receipt: existing,
            upload: { file in
                try await model.attachReceipt(
                    deductionID: deduction.id, file: file, existing: existing)
            },
            remove: { receipt in
                pendingDelete = PendingDelete(
                    title: "Delete receipt?", label: "the receipt for \(deduction.description)",
                    confirm: { try await model.removeReceipt(receipt) })
            })
    }
}
