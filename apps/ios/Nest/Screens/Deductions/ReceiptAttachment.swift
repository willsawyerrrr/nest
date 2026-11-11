import Foundation
import Observation

/// Attaching a receipt to a deduction being added, and reading the figures off it,
/// mirroring the PWA's `useDeductionAttachment`. Any type of file attaches; one the
/// model cannot read is stored with a note and the figures are typed by hand.
///
/// The file is stored before the deduction row exists, under the id minted when the
/// form opened, so it lands inside the prefix the row is eventually written under.
/// Picking another file replaces the first. A file the member removes or replaces, or
/// leaves behind when the form closes, is deleted again, best effort.
@MainActor @Observable
final class ReceiptAttachment {
    /// Where attaching the receipt and reading it has got to.
    enum State: Equatable {
        case idle, uploading, reading
        case read(filledNothing: Bool)
        case failure(DeductionExtractionOutcome)
    }

    /// What storing, discarding and reading a receipt call into.
    struct Handlers: Sendable {
        var upload: @Sendable (_ deductionID: String, _ file: UploadRules.PreparedFile) async throws -> String
        var discard: @Sendable (_ path: String) async -> Void
        var read: @Sendable (_ path: String, _ category: DeductionCategory) async -> DeductionExtractionOutcome
    }

    static let uploadFailedMessage =
        "Could not upload this receipt. Try again, or enter the details by hand."

    /// The id the receipt is filed under, unchanged for the life of the form.
    let deductionID: String
    private(set) var path: String?
    private(set) var state: State = .idle

    private let handlers: Handlers
    private var pending: String?
    private var gone = false

    init(handlers: Handlers, deductionID: String = UUID().uuidString.lowercased()) {
        self.handlers = handlers
        self.deductionID = deductionID
    }

    /// Whether the receipt is being stored or read, so the picker holds still.
    var busy: Bool { state == .uploading || state == .reading }

    /// Stores a newly picked file, replacing any already attached, and reads it with
    /// `category` and `onExtracted` (which applies the read to the form's fields).
    func add(
        _ file: UploadRules.PickedFile, category: @MainActor () -> DeductionCategory,
        onExtracted: @MainActor (DeductionExtraction) -> Bool
    ) async {
        state = .uploading
        let prepared = await Task.detached { UploadRules.prepare(file) }.value
        let ready: UploadRules.PreparedFile
        switch prepared {
        case .tooLarge(let message):
            state = .failure(.failed(message))
            return
        case .unreadable:
            state = .failure(.failed(Self.uploadFailedMessage))
            return
        case .ready(let file): ready = file
        }
        let stored: String
        do { stored = try await handlers.upload(deductionID, ready) } catch {
            state = .failure(.failed(Self.uploadFailedMessage))
            return
        }
        if gone {
            await handlers.discard(stored)
            return
        }
        let replaced = pending
        pending = stored
        path = stored
        if let replaced { Task { await handlers.discard(replaced) } }

        guard ready.readable else {
            state = .failure(.unsupported(DeductionExtractor.unsupportedMessage))
            return
        }
        state = .reading
        let outcome = await handlers.read(stored, category())
        guard !gone, pending == stored else { return }
        if case .read(let extraction) = outcome {
            state = .read(filledNothing: !onExtracted(extraction))
        } else {
            state = .failure(outcome)
        }
    }

    /// Removes the stored file, deleting its object.
    func remove() async {
        let removed = pending
        pending = nil
        path = nil
        state = .idle
        if let removed { await handlers.discard(removed) }
    }

    /// Marks the stored file saved, so leaving the form no longer deletes it.
    func keep() { pending = nil }

    /// Deletes the stored file nothing references; called when the form closes.
    func abandon() {
        gone = true
        guard let abandoned = pending else { return }
        pending = nil
        Task { await handlers.discard(abandoned) }
    }
}
