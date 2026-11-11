import Observation
import SwiftUI

/// How one draft's save ended during a Save selected run.
enum DraftSaveOutcome: Sendable {
    case saved, needsAttention
}

/// How a draft's form reports back to the queue it was opened from.
struct DraftControls {
    /// Registers the form's own save (validating itself first), so Save selected can
    /// run it for every selected card.
    let register: @MainActor (@escaping @MainActor () async -> DraftSaveOutcome) -> Void
    /// Runs the save, and on success records that the stored file is now referenced and
    /// ends the file's review as saved.
    let save: @MainActor (_ run: @MainActor () async throws -> Void) async throws -> Void
    /// Drops the draft and deletes the stored file.
    let discard: @MainActor () -> Void
    /// Whether the last Save selected run left this file needing the member's attention.
    let attention: Bool
}

/// Holds each card's registered save for a Save selected run.
@MainActor @Observable
final class DraftSaveRegistry {
    @ObservationIgnored var savers: [String: @MainActor () async -> DraftSaveOutcome] = [:]
}

/// The review surface for a bulk upload, the native equivalent of the PWA's
/// `BulkUploadPanel`: one card per file the queue holds, with its status and, once read,
/// the surface's own form for the draft. It renders nothing until the queue has a file.
/// Each draft is confirmed, edited or discarded on its own; Save selected runs every
/// selected draft's own save in turn, so a draft that is not valid yet is reported
/// rather than saved, and one that fails does not stop the rest.
struct BulkUploadPanel<Draft: Sendable, DraftContent: View>: View {
    let queue: UploadQueue<Draft>
    @ViewBuilder let draftContent: (QueueItem<Draft>, DraftControls) -> DraftContent

    @State private var deselected: Set<String> = []
    @State private var progress: (done: Int, total: Int)?
    @State private var summary: String?
    @State private var attention: Set<String> = []
    @State private var registry = DraftSaveRegistry()

    private var selected: [QueueItem<Draft>] { queue.drafts.filter { !deselected.contains($0.id) } }

    var body: some View {
        if !queue.items.isEmpty {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                if queue.skipped > 0 {
                    UploadAlert(text: BulkUpload.limitMessage(skipped: queue.skipped))
                }
                if let halted = queue.halted {
                    UploadAlert(title: "Reading has stopped", text: halted)
                }
                ForEach(queue.items) { item in card(item) }
                if !queue.drafts.isEmpty { saveBar }
                if let summary {
                    Text(summary).font(.system(size: 14)).foregroundStyle(NestColor.text)
                }
                Button(queue.hasUnsaved ? "Discard all" : "Done") {
                    queue.clear()
                    summary = nil
                    attention = []
                    deselected = []
                }
                .buttonStyle(NestSecondaryButtonStyle())
                .disabled(progress != nil)
            }
        }
    }

    private func card(_ item: QueueItem<Draft>) -> some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                header(item)
                if attention.contains(item.id) {
                    Text("This one still needs a look.")
                        .font(NestFont.caption).foregroundStyle(NestColor.negative)
                }
                if item.status.isDraft {
                    draftContent(
                        item,
                        DraftControls(
                            register: { saver in registry.savers[item.id] = saver },
                            save: { run in
                                try await run()
                                queue.keep(item.id)
                                queue.finish(item.id, saved: true)
                            },
                            discard: { queue.finish(item.id, saved: false) },
                            attention: attention.contains(item.id)))
                }
            }
        }
        .accessibilityLabel(item.file.name)
    }

    private func header(_ item: QueueItem<Draft>) -> some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            HStack(spacing: NestSpacing.xs) {
                if item.status.isDraft {
                    Toggle(
                        "Select \(item.file.name)",
                        isOn: Binding(
                            get: { !deselected.contains(item.id) },
                            set: { on in
                                if on { deselected.remove(item.id) } else { deselected.insert(item.id) }
                            })
                    )
                    .labelsHidden()
                    .toggleStyle(.nestCheckbox)
                }
                Text(item.file.name)
                    .font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: NestSpacing.xs)
                if item.status == .reading { ProgressView().controlSize(.mini) }
                NestPill(text: item.status.label, tone: Self.tone(item.status))
                if item.status == .queued || item.status == .failed {
                    Button { queue.remove(item.id) } label: {
                        Image(systemName: "xmark").font(.system(size: 12))
                            .foregroundStyle(NestColor.dimmedText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(item.file.name)")
                }
            }
            if let message = item.message, item.status == .failed || item.status == .unsupported
                || item.status == .manual
            {
                Text(message).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
            if item.status == .failed {
                HStack(spacing: NestSpacing.xs) {
                    if item.retryable {
                        Button("Try again") { queue.retry(item.id) }
                            .buttonStyle(NestSecondaryButtonStyle(compact: true))
                            .accessibilityLabel("Try \(item.file.name) again")
                    }
                    if item.path != nil {
                        Button("Enter by hand") { queue.enterByHand(item.id) }
                            .buttonStyle(NestSecondaryButtonStyle(compact: true))
                            .accessibilityLabel("Enter \(item.file.name) by hand")
                    }
                }
            }
        }
    }

    private var saveBar: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            HStack {
                Toggle(
                    "Select all",
                    isOn: Binding(
                        get: { selected.count == queue.drafts.count },
                        set: { on in deselected = on ? [] : Set(queue.drafts.map(\.id)) })
                )
                .toggleStyle(.nestCheckbox)
                .font(NestFont.caption).foregroundStyle(NestColor.text)
                Spacer()
                Button(progress == nil ? "Save selected (\(selected.count))" : "Saving…") {
                    Task { await saveSelected() }
                }
                .buttonStyle(NestPrimaryButtonStyle(compact: true))
                .frame(maxWidth: 200)
                .disabled(selected.isEmpty || progress != nil)
            }
            if let progress {
                ProgressView(value: Double(progress.done), total: Double(progress.total))
                    .tint(NestColor.brand)
                Text("Saved \(progress.done) of \(progress.total)")
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        }
    }

    private func saveSelected() async {
        let targets = selected
        summary = nil
        attention = []
        progress = (0, targets.count)
        var needAttention: Set<String> = []
        var saved = 0
        for (index, item) in targets.enumerated() {
            let outcome = await registry.savers[item.id]?() ?? .needsAttention
            if outcome == .saved { saved += 1 } else { needAttention.insert(item.id) }
            progress = (index + 1, targets.count)
        }
        progress = nil
        attention = needAttention
        let left = needAttention.count
        summary =
            "Saved \(saved).\(left > 0 ? " \(left == 1 ? "1 file needs" : "\(left) files need") another look: check the details marked below, then save again." : "")"
    }

    private static func tone(_ status: QueueStatus) -> NestPill.Tone {
        switch status {
        case .queued: .neutral
        case .reading: .info
        case .ready, .saved: .positive
        case .unsupported, .manual: .warning
        case .failed: .negative
        }
    }
}

/// A warning note: the PWA's `Alert color="yellow" variant="light" p="xs"`.
struct UploadAlert: View {
    var title: String?
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            if let title {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.warning)
            }
            Text(text).font(NestFont.caption).foregroundStyle(NestColor.text)
        }
        .padding(NestSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            NestColor.warning.opacity(0.12),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}
