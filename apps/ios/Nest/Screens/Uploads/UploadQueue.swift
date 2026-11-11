import Foundation
import Observation

/// Where one file has got to. `unsupported` and `manual` both hold a stored file
/// with a blank draft: a type that cannot be read, and a file whose reading failed
/// and the member chose to enter by hand.
enum QueueStatus: Equatable, Sendable {
    case queued, reading, ready, unsupported, manual, failed, saved

    /// The statuses that carry a draft the member can review and save.
    var isDraft: Bool { self == .ready || self == .unsupported || self == .manual }

    /// The label the status badge shows.
    var label: String {
        switch self {
        case .queued: "Queued"
        case .reading: "Reading"
        case .ready: "Ready"
        case .unsupported: "Unsupported type"
        case .manual: "Enter by hand"
        case .failed: "Couldn't be read"
        case .saved: "Saved"
        }
    }
}

/// One picked file, with the draft read from it once there is one.
struct QueueItem<Draft: Sendable>: Identifiable, Sendable {
    /// Minted when the file is added; the record it becomes is written under it, so
    /// a retried save cannot duplicate it.
    let id: String
    let file: UploadRules.PickedFile
    var status: QueueStatus = .queued
    /// Where the file is stored, or nil until it has been uploaded.
    var path: String?
    /// What was read, or the blank draft for a file entered by hand.
    var value: Draft?
    /// Why the file failed or was not read.
    var message: String?
    /// Whether trying again can help: false for a file over the size limit.
    var retryable = true
    /// Whether a saved record references the stored file, so it must not be deleted.
    var kept = false
    /// Whether the stored file is a type the model can read.
    var readable = true
}

/// What a surface supplies to the queue.
struct UploadHandlers<Draft: Sendable>: Sendable {
    /// Stores `file` under `id` and resolves to its path.
    var upload: @Sendable (_ id: String, _ file: UploadRules.PreparedFile) async throws -> String
    /// Deletes a stored file no record references. Best effort.
    var discard: @Sendable (_ path: String) async -> Void
    /// Reads a stored file.
    var read: @Sendable (_ path: String) async -> BulkUpload.ReadResult<Draft>
    /// The draft for a file entered by hand.
    var blank: @Sendable () -> Draft
    /// What a file of a type the model cannot read is told.
    var unsupportedMessage: String
}

/// The queue behind every bulk upload, the native equivalent of the PWA's
/// `useUploadQueue`: each file is stored, then read, then handed back as a draft for
/// the member to review. At most `BulkUpload.readConcurrency` files are in flight at
/// once, and each file's outcome is its own — an unreadable, oversized or
/// unsupported file never stops the others. Only a failure every file would meet
/// (`halt`) stops the queue, marking the files not yet read failed with the same
/// message so the API is not hit once per file.
///
/// The queue never writes a record. A stored file is deleted when its draft is
/// discarded, the file removed or the queue closed (unless a saved record references
/// it); a file already stored is not stored again by a retry.
@MainActor @Observable
final class UploadQueue<Draft: Sendable> {
    private(set) var items: [QueueItem<Draft>] = []
    /// The reason the queue stopped, while it is stopped.
    private(set) var halted: String?
    /// How many files the last `add` left out for being over the batch limit.
    private(set) var skipped = 0

    private let handlers: UploadHandlers<Draft>
    private let prepare: @Sendable (UploadRules.PickedFile) async -> UploadRules.Prepared
    private let mintID: @Sendable () -> String

    init(
        handlers: UploadHandlers<Draft>,
        prepare: @escaping @Sendable (UploadRules.PickedFile) async -> UploadRules.Prepared = { file in
            await Task.detached { UploadRules.prepare(file) }.value
        },
        mintID: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }
    ) {
        self.handlers = handlers
        self.prepare = prepare
        self.mintID = mintID
    }

    /// Whether any file is still waiting or being read.
    var isWorking: Bool { items.contains { $0.status == .queued || $0.status == .reading } }

    /// Whether any file is not yet saved.
    var hasUnsaved: Bool { items.contains { $0.status != .saved } }

    /// The files carrying a draft the member can review.
    var drafts: [QueueItem<Draft>] { items.filter { $0.status.isDraft } }

    /// Queues `files`, up to the batch limit; returns how many were left out.
    @discardableResult
    func add(_ files: [UploadRules.PickedFile]) -> Int {
        let open = items.filter { $0.status != .saved }.count
        let room = max(0, BulkUpload.maxBatchFiles - open)
        let accepted = files.prefix(room)
        if !accepted.isEmpty {
            halted = nil
            items += accepted.map { QueueItem(id: mintID(), file: $0) }
            pump()
        }
        skipped = files.count - accepted.count
        return skipped
    }

    /// Takes a file out and deletes its stored copy unless a record references it.
    func remove(_ id: String) {
        if let item = item(id), let path = item.path, !item.kept { discard(path) }
        items.removeAll { $0.id == id }
        pump()
    }

    /// Queues a failed file to be read again, without storing it twice.
    func retry(_ id: String) {
        halted = nil
        patch(id) { $0.status = .queued; $0.message = nil }
        pump()
    }

    /// Turns a failed, stored file into a blank draft to fill in by hand.
    func enterByHand(_ id: String) {
        patch(id) { $0.status = .manual; $0.value = handlers.blank() }
    }

    /// Records that a saved record references the stored file.
    func keep(_ id: String) { patch(id) { $0.kept = true } }

    /// Ends a file's review: `saved` leaves it as a saved row, otherwise it is removed.
    func finish(_ id: String, saved: Bool) {
        if saved { patch(id) { $0.status = .saved; $0.kept = true } } else { remove(id) }
    }

    /// Removes every file that is not saved, deleting what no record references.
    func clear() {
        closeOut()
        items = []
        halted = nil
        skipped = 0
    }

    /// Deletes every stored file no saved record references, as when the panel is left.
    func closeOut() {
        for item in items { if let path = item.path, !item.kept { discard(path) } }
    }

    // MARK: Scheduling

    private func item(_ id: String) -> QueueItem<Draft>? { items.first { $0.id == id } }

    private func patch(_ id: String, _ change: (inout QueueItem<Draft>) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }

    private func discard(_ path: String) {
        let handlers = handlers
        Task { await handlers.discard(path) }
    }

    /// Starts queued files until `readConcurrency` are in flight.
    private func pump() {
        var free = BulkUpload.readConcurrency - items.filter { $0.status == .reading }.count
        for queued in items where free > 0 && queued.status == .queued {
            free -= 1
            patch(queued.id) { $0.status = .reading }
            let id = queued.id
            Task { await process(id) }
        }
    }

    private func process(_ id: String) async {
        guard let started = item(id) else { return }
        if started.path == nil {
            let prepared = await prepare(started.file)
            guard item(id) != nil else { return }
            switch prepared {
            case .tooLarge(let message):
                patch(id) { $0.status = .failed; $0.message = message; $0.retryable = false }
                pump()
                return
            case .unreadable:
                patch(id) { $0.status = .failed; $0.message = Self.uploadFailedMessage }
                pump()
                return
            case .ready(let file):
                let path: String
                do { path = try await handlers.upload(id, file) } catch {
                    if item(id) != nil {
                        patch(id) { $0.status = .failed; $0.message = Self.uploadFailedMessage }
                        pump()
                    }
                    return
                }
                guard item(id) != nil else {
                    // Nothing holds this path: its row was removed while the upload was in flight.
                    discard(path)
                    return
                }
                patch(id) { $0.path = path; $0.readable = file.readable }
            }
        }

        guard let stored = item(id), let path = stored.path else { return }
        guard stored.readable else {
            patch(id) {
                $0.status = .unsupported
                $0.value = handlers.blank()
                $0.message = handlers.unsupportedMessage
            }
            pump()
            return
        }

        let result = await handlers.read(path)
        guard item(id) != nil else { return }
        switch result {
        case .read(let value):
            patch(id) { $0.status = .ready; $0.value = value; $0.message = nil }
        case .unsupported(let message):
            patch(id) { $0.status = .unsupported; $0.value = handlers.blank(); $0.message = message }
        case .failed(let message):
            patch(id) { $0.status = .failed; $0.message = message }
        case .halt(let message):
            halted = message
            for index in items.indices where items[index].id == id || items[index].status == .queued {
                items[index].status = .failed
                items[index].message = message
            }
        }
        pump()
    }

    /// What the queue says when a file could not be stored.
    static var uploadFailedMessage: String {
        "Could not upload this file. Try again, or remove it and enter the details by hand."
    }
}
