import SwiftUI

/// The Add trade card, mirroring the PWA's `TradeAddCard`. It opens on the
/// contract-note prompt alone; the fields appear when the member chooses to enter
/// details manually, or once a note has been read or could not be, and stay once
/// shown. A picked note is stored and read through `trade-extract`: one trade opens
/// in the form to check and save, kept attached to the saved trade, while several
/// files, or one document holding several trades, open each trade as its own draft
/// in the bulk review, and Close ends the card. Picking another file replaces the
/// first; a file removed, replaced or left behind is deleted unless a saved trade
/// references it.
struct TradeAddCard: View {
    let memberID: String
    let presentation: InvestmentsPresentation
    let model: InvestmentsViewModel
    let onClose: () -> Void

    @State private var queue: UploadQueue<[ExtractedTrade]>
    /// Minted once, so a retried save of the card's trade does not duplicate it.
    @State private var tradeID = UUID().uuidString.lowercased()
    @State private var revealed = false
    @State private var picking = false

    init(
        memberID: String, presentation: InvestmentsPresentation, model: InvestmentsViewModel,
        onClose: @escaping () -> Void
    ) {
        self.memberID = memberID
        self.presentation = presentation
        self.model = model
        self.onClose = onClose
        _queue = State(initialValue: model.makeDocumentQueue())
    }

    private var item: QueueItem<[ExtractedTrade]>? { queue.items.first }
    private var read: [ExtractedTrade] { item?.status == .ready ? item?.value ?? [] : [] }
    private var busy: Bool { item?.status == .queued || item?.status == .reading }
    private var settled: Bool { item != nil && !busy }

    var body: some View {
        Group {
            if queue.items.count > 1 || read.count > 1 {
                review
            } else {
                single
            }
        }
        .filePicker(isPresented: $picking, allowsMultiple: true, onPick: pick)
        .onChange(of: settled) { _, now in if now { revealed = true } }
        .onDisappear { queue.closeOut() }
    }

    private var review: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                BulkUploadPanel(queue: queue) { item, controls in
                    TradeDocumentDrafts(
                        item: item, controls: controls, memberID: memberID,
                        presentation: presentation, model: model)
                }
                Button("Close", action: onClose).buttonStyle(NestSecondaryButtonStyle(compact: true))
            }
        }
    }

    private var single: some View {
        let trade = read.first
        return TradeForm(
            memberID: memberID, editing: nil, initial: trade?.values, presentation: presentation,
            figures: { await model.figures(for: $0) },
            attachment: AnyView(attachment(trade)), busy: busy, showFields: revealed,
            check: trade?.check ?? [],
            onSubmit: submit, onCancel: onClose
        )
        .id(trade == nil ? "blank" : item?.id ?? "blank")
    }

    private func submit(_ input: TradeInput) async throws {
        guard let item, let path = item.path else {
            try await model.save(input)
            onClose()
            return
        }
        try await model.saveFromDocument(
            TradeFromDocument(documentID: item.id, path: path, id: tradeID, input: input))
        queue.keep(item.id)
        onClose()
    }

    private func pick(_ files: [UploadRules.PickedFile]) {
        guard !files.isEmpty else { return }
        if let item { queue.remove(item.id) }
        queue.add(files)
    }

    @ViewBuilder private func attachment(_ trade: ExtractedTrade?) -> some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            LabelledField(
                label: "Contract notes",
                description: InvestmentsPresentation.attachDescription(prompt: !revealed)
            ) {
                Button { picking = true } label: {
                    HStack {
                        Text("Attach a contract note or several")
                            .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, FormMetric.sm)
                    .frame(minHeight: 36)
                    .overlay(
                        RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                            .strokeBorder(NestColor.border, lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy)
            }
            if let item { TradeReadNote(item: item, halted: queue.halted) }
            if !revealed {
                Button("Enter details manually") { revealed = true }
                    .font(.system(size: 12)).foregroundStyle(NestColor.brand)
                    .buttonStyle(.plain).disabled(busy)
            }
            if let item, item.path != nil {
                HStack {
                    Text("Contract note attached").font(.system(size: 12)).foregroundStyle(NestColor.text)
                    Spacer(minLength: 0)
                    Button { queue.remove(item.id) } label: {
                        Image(systemName: "trash").font(.system(size: 12))
                            .foregroundStyle(NestColor.negative).frame(width: 24, height: 24)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove contract note")
                }
            }
            if item?.status == .ready {
                Callout(
                    tone: .info, title: InvestmentsPresentation.readFromNoteTitle,
                    text: trade.map { !$0.values.isEmpty } == true
                        ? InvestmentsPresentation.readSomething : InvestmentsPresentation.readNothing)
            }
        }
    }
}

/// Where reading the attached contract note has got to. Every outcome reads as what it
/// is, and none blocks the save.
private struct TradeReadNote: View {
    let item: QueueItem<[ExtractedTrade]>
    let halted: String?

    var body: some View {
        switch item.status {
        case .queued, .reading:
            HStack(spacing: NestSpacing.xs) {
                ProgressView().controlSize(.small)
                Text(item.path == nil ? "Storing the contract note…" : "Reading the contract note…")
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
            .accessibilityElement(children: .combine)
        case .unsupported:
            dimmed
        case .failed:
            if halted != nil { dimmed } else { UploadAlert(text: item.message ?? "") }
        default:
            EmptyView()
        }
    }

    private var dimmed: some View {
        Text(item.message ?? "").font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
    }
}

/// The drafts of one document in the bulk review: a form for each trade read from it,
/// or one blank form for a document nothing could be read from. The document's review
/// ends when every draft is saved or discarded — saved if any trade was, otherwise the
/// stored document is deleted again.
struct TradeDocumentDrafts: View {
    let item: QueueItem<[ExtractedTrade]>
    let controls: DraftControls
    let memberID: String
    let presentation: InvestmentsPresentation
    let model: InvestmentsViewModel

    private struct Draft: Identifiable {
        /// Minted per draft, so a retried save of it does not duplicate the trade.
        let id = UUID().uuidString.lowercased()
        let trade: ExtractedTrade
    }

    @State private var drafts: [Draft]
    @State private var savedAny = false
    @State private var registry = DraftSaveRegistry()

    init(
        item: QueueItem<[ExtractedTrade]>, controls: DraftControls, memberID: String,
        presentation: InvestmentsPresentation, model: InvestmentsViewModel
    ) {
        self.item = item
        self.controls = controls
        self.memberID = memberID
        self.presentation = presentation
        self.model = model
        _drafts = State(initialValue: (item.value ?? []).map { Draft(trade: $0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            if item.status == .ready {
                Text(InvestmentsPresentation.extractedNote(drafts.count))
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
            ForEach(drafts) { draft in
                TradeForm(
                    memberID: memberID, editing: nil, initial: draft.trade.values,
                    presentation: presentation, figures: { await model.figures(for: $0) },
                    check: draft.trade.check, submitLabel: "Save trade", cancelLabel: "Discard",
                    register: { registry.savers[draft.id] = $0 },
                    onSubmit: { input in
                        guard let path = item.path else { throw NestError(.invalidRequest) }
                        try await controls.saveOne {
                            try await model.saveFromDocument(
                                TradeFromDocument(
                                    documentID: item.id, path: path, id: draft.id, input: input))
                        }
                        resolve(draft.id, saved: true)
                    },
                    onCancel: { resolve(draft.id, saved: false) })
            }
        }
        .onAppear { controls.register { await saveAll() } }
    }

    /// Runs every open draft's own save, as the PWA submits each of the file's forms.
    private func saveAll() async -> DraftSaveOutcome {
        var outcome = DraftSaveOutcome(saved: 0, needsAttention: false)
        for id in drafts.map(\.id) {
            let result = await registry.savers[id]?() ?? .needsAttention
            outcome.saved += result.saved
            outcome.needsAttention = outcome.needsAttention || result.needsAttention
        }
        return outcome
    }

    private func resolve(_ id: String, saved: Bool) {
        registry.savers[id] = nil
        let remaining = drafts.filter { $0.id != id }
        let anySaved = savedAny || saved
        savedAny = anySaved
        drafts = remaining
        if remaining.isEmpty { controls.finish(anySaved) }
    }
}
