import SwiftUI

/// The native Payslips route: one list per household member, most recent pay period
/// first, each slip's gross / withheld / super / net measured against what the plan
/// projected, under the member's year to date measured the same way. Adding, editing
/// and deleting (with extraction pre-fill, bulk upload and the shared 25 MiB rules) all
/// happen here.
struct PayslipsScreen: View {
    @State private var model: PayslipsViewModel

    init(model: PayslipsViewModel = PayslipsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            PayslipsContentView(presentation: PayslipsPresentation(content: content), model: model)
        }
        .task { await model.load() }
    }
}

struct PayslipsContentView: View {
    let presentation: PayslipsPresentation
    let model: PayslipsViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    Text(presentation.title).font(NestFont.display).tracking(-0.7)
                        .foregroundStyle(NestColor.text)
                    Text(PayslipsPresentation.intro)
                        .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                }
                ForEach(presentation.members) { section in
                    MemberPayslipsSection(
                        section: section, content: presentation.content, model: model)
                }
            }
            .padding(NestSpacing.md)
        }
    }
}

/// What the section's list is editing: nothing, a new slip, or one existing slip.
private enum Editing: Equatable {
    case add
    case edit(String)
}

/// A member's payslips, most recent first, with their year-to-date actuals and an add form.
private struct MemberPayslipsSection: View {
    let section: MemberPayslipsModel
    let content: PayslipsContent
    let model: PayslipsViewModel

    @State private var queue: UploadQueue<PayslipRead>
    @State private var editing: Editing?
    @State private var deleting: Payslip?
    @State private var deleteFailed = false
    @Environment(\.openURL) private var openURL

    init(section: MemberPayslipsModel, content: PayslipsContent, model: PayslipsViewModel) {
        self.section = section
        self.content = content
        self.model = model
        let service = model.service
        let household = content.householdID ?? ""
        let year = content.financialYear
        _queue = State(
            initialValue: UploadQueue(
                handlers: UploadHandlers(
                    upload: { id, file in
                        try await service.upload(household: household, payslipId: id, file: file)
                    },
                    discard: { await service.discard(path: $0) },
                    read: { path in
                        PayslipExtractionReader.readResult(
                            await service.read(path: path, financialYear: year))
                    },
                    blank: { PayslipRead(extraction: nil) },
                    unsupportedMessage: PayslipExtractionReader.unsupportedMessage)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            HStack {
                Text(section.member.name).font(NestFont.body).fontWeight(.semibold)
                    .foregroundStyle(NestColor.text)
                Spacer(minLength: NestSpacing.xs)
                Text(section.countLabel).font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            }
            if let totals = section.totals {
                MemberTotalsView(
                    totals: totals, reportedNote: section.reportedNote, unmeasured: section.unmeasured)
            }
            BulkUploadPanel(queue: queue) { item, controls in
                PayslipFormView(
                    member: section.member, inflows: content.rows.inflows,
                    mode: .draft(id: item.id, path: item.path ?? "", extraction: item.value?.extraction),
                    household: content.householdID ?? "", financialYear: content.financialYear,
                    service: model.service, cancelLabel: "Discard", controls: controls,
                    onSubmit: { submission in try await controls.save { try await model.save(submission) } },
                    onCancel: controls.discard)
            }
            list
        }
        .onDisappear { queue.closeOut() }
        .alert("Delete payslip?", isPresented: deleteBinding, presenting: deleting) { payslip in
            Button("Delete", role: .destructive) {
                Task {
                    do { try await model.delete(payslip) } catch { deleteFailed = true }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { payslip in
            Text("Delete \(PayslipsPresentation.periodLabel(payslip))? This cannot be undone.")
        }
        .alert("Could not delete", isPresented: $deleteFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(NestError(.unknown).userMessage)
        }
    }

    private var deleteBinding: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
    }

    @ViewBuilder private var list: some View {
        if section.cards.isEmpty && editing != .add {
            Text("No payslips yet.").font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
        }
        ForEach(section.cards) { card in
            if editing == .edit(card.id) {
                form(.edit(card.payslip, lines: content.rows.lines.filter { $0.payslipId == card.id }))
            } else {
                PayslipCardView(
                    card: card,
                    onEdit: { editing = .edit(card.id) },
                    onDelete: { deleting = card.payslip },
                    onViewDocument: { path in
                        Task { if let url = await model.documentURL(path: path) { openURL(url) } }
                    })
            }
        }
        if editing == .add {
            form(.add)
        } else {
            Button { editing = .add } label: {
                Label("Add payslip", systemImage: "plus")
            }
            .buttonStyle(NestPrimaryButtonStyle())
        }
    }

    private func form(_ mode: PayslipFormMode) -> some View {
        PayslipFormView(
            member: section.member, inflows: content.rows.inflows, mode: mode,
            household: content.householdID ?? "", financialYear: content.financialYear,
            service: model.service,
            onAddFiles: { files in queue.add(files) },
            onSubmit: { submission in
                try await model.save(submission)
                editing = nil
            },
            onCancel: { editing = nil })
    }
}

/// A member's year-to-date actuals, each held against the plan, with the running totals
/// printed on their latest slip as a cross-check and the year's position on any pay no
/// period measures.
private struct MemberTotalsView: View {
    let totals: [FigureCellModel]
    let reportedNote: String?
    let unmeasured: [UnmeasuredRowModel]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            AdaptiveGrid(items: totals, compact: 2, regular: 3) { FigureCell(model: $0) }
            if let reportedNote {
                Text(reportedNote).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
            if !unmeasured.isEmpty {
                SectionLabel(text: "Pay measured across the year")
                ForEach(unmeasured) { position in
                    HStack(alignment: .firstTextBaseline, spacing: NestSpacing.xs) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(position.name).font(.system(size: 12, weight: .medium))
                                .foregroundStyle(NestColor.text)
                            Text(position.caption).font(NestFont.caption)
                                .foregroundStyle(NestColor.dimmedText)
                        }
                        Spacer(minLength: NestSpacing.xs)
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(MoneyFormat.cents(Int(position.actualCents)))
                                .font(.system(size: 12, weight: .semibold)).monospacedDigit()
                                .foregroundStyle(NestColor.text)
                            VarianceText(note: position.variance)
                        }
                    }
                }
            }
        }
    }
}

/// One payslip, collapsed to a single header and expandable to its full detail. The header
/// names the pay period and the date the pay landed, the gross as an aligned figure and the
/// slip's most notable variance as one pill. On a wide screen it is a dense row whose gross
/// and variance columns line up down the list; on a phone, a compact card. Editing and
/// deleting sit outside the disclosure. Expansion is per card; every card starts collapsed.
private struct PayslipCardView: View {
    let card: PayslipCardModel
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onViewDocument: (String) -> Void

    @State private var expanded = false
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if sizeClass == .compact {
            NestCard(padding: NestSpacing.sm) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: NestSpacing.xs) {
                        Button { expanded.toggle() } label: {
                            HStack(spacing: NestSpacing.xs) {
                                title(stacked: true)
                                VStack(alignment: .trailing, spacing: 2) {
                                    gross
                                    NestPill(text: card.pill.text, tone: card.pill.tone)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                        actions
                    }
                    if expanded { detail }
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: NestSpacing.sm) {
                    Button { expanded.toggle() } label: {
                        HStack(spacing: NestSpacing.sm) {
                            title(stacked: false)
                            gross.frame(width: 112, alignment: .trailing)
                            NestPill(text: card.pill.text, tone: card.pill.tone)
                                .frame(width: 208, alignment: .leading)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                    actions
                }
                if expanded { detail }
                Divider().overlay(NestColor.border)
            }
        }
    }

    private var gross: some View {
        Text(MoneyFormat.cents(card.grossCents))
            .font(.system(size: 14, weight: .bold)).monospacedDigit().foregroundStyle(NestColor.text)
    }

    private func title(stacked: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.system(size: 14))
                .foregroundStyle(NestColor.text)
            if stacked {
                VStack(alignment: .leading, spacing: 0) { period; paid }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: NestSpacing.xs) { period; paid }
            }
            Spacer(minLength: 0)
        }
    }

    private var period: some View {
        Text(card.period).font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
            .lineLimit(1)
    }

    @ViewBuilder private var paid: some View {
        if let paid = card.paid {
            Text(paid).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
        }
    }

    private var actions: some View {
        HStack(spacing: NestSpacing.xxs) {
            Button(action: onEdit) {
                Image(systemName: "pencil").font(.system(size: 16)).foregroundStyle(NestColor.dimmedText)
                    .padding(NestSpacing.xs)
            }
            .buttonStyle(.plain).accessibilityLabel("Edit")
            Button(action: onDelete) {
                Image(systemName: "trash").font(.system(size: 16)).foregroundStyle(NestColor.negative)
                    .padding(NestSpacing.xs)
            }
            .buttonStyle(.plain).accessibilityLabel("Delete")
        }
    }

    private var detail: some View {
        PayslipDetailView(detail: card.detail, onViewDocument: onViewDocument)
    }
}

/// A payslip's expanded body: the gross / withheld / super / net quartet each with its own
/// variance, the per-inflow and per-component breakdowns of its lines, and its note and
/// stored document.
private struct PayslipDetailView: View {
    let detail: PayslipDetailModel
    let onViewDocument: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AdaptiveGrid(items: detail.figures, compact: 2, regular: 4) { FigureCell(model: $0) }
            if !detail.earnings.isEmpty {
                breakdown("Earnings lines", rows: detail.earnings, note: detail.earningsNote)
            }
            if !detail.tax.isEmpty {
                breakdown("Tax lines", rows: detail.tax, note: detail.taxNote)
            }
            if let note = detail.unmeasuredGrossNote { caption(note) }
            if let note = detail.partCycleNote { caption(note) }
            if let note = detail.note { caption(note) }
            if let path = detail.documentPath {
                Button("View payslip document") { onViewDocument(path) }
                    .font(NestFont.caption).foregroundStyle(NestColor.brand)
                    .buttonStyle(.plain)
            }
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
    }

    private func breakdown(_ title: String, rows: [BreakdownRowModel], note: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            SectionLabel(text: title)
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: NestSpacing.xs) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(row.title).font(.system(size: 12, weight: .medium))
                            .foregroundStyle(NestColor.text)
                        Text(row.caption).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    }
                    Spacer(minLength: NestSpacing.xs)
                    HStack(spacing: NestSpacing.xs) {
                        Text(MoneyFormat.cents(Int(row.actualCents)))
                            .font(.system(size: 12, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(NestColor.text)
                        VarianceText(note: row.variance)
                    }
                }
            }
            if let note { caption(note) }
        }
    }
}
