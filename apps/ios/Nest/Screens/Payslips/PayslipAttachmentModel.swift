import Foundation
import Observation

/// Where attaching a slip and reading it has got to.
enum ExtractionState: Equatable, Sendable {
    case idle
    case uploading
    case reading
    case read(PrefillSummary)
    case failure(ExtractionOutcome)

    var isBusy: Bool { self == .uploading || self == .reading }
}

/// Attaching a payslip document and reading the figures off it, mirroring the PWA's
/// `usePayslipAttachment`. Any type of file attaches; one the model cannot read is stored
/// and attached with a note, and the figures are typed by hand.
///
/// The document is stored before it is read, because extraction takes an object path and
/// because the file is the auditable record whether or not the read succeeds: the payslip
/// id is minted when the form opens and the object filed under it straight away. An object
/// stored for a row that is never written is deleted as soon as the member clears it,
/// replaces it or leaves the form (best effort). Nothing here can stop a save: every
/// failure resolves into a state the form shows beside the still-editable figures.
@MainActor @Observable
final class PayslipAttachmentModel {
    static let uploadFailedMessage =
        "Could not upload this document. Try again, or enter the figures by hand."

    /// The id the slip is filed under, stable for the life of the form.
    let payslipID: String
    private(set) var fileName: String?
    /// Where the chosen file landed, or nil when nothing new is attached.
    private(set) var attachment: PayslipAttachment?
    private(set) var state: ExtractionState = .idle

    private let service: any PayslipsServicing
    private let household: String
    private let financialYear: Int
    private let apply: @MainActor (PayslipExtraction) -> PrefillSummary
    private let prepare: @Sendable (UploadRules.PickedFile) async -> UploadRules.Prepared
    /// The object stored but not yet referenced by a saved row.
    private var orphan: String?
    private var isGone = false

    init(
        payslipID: String?, household: String, financialYear: Int, service: any PayslipsServicing,
        apply: @escaping @MainActor (PayslipExtraction) -> PrefillSummary,
        prepare: @escaping @Sendable (UploadRules.PickedFile) async -> UploadRules.Prepared = { file in
            await Task.detached { UploadRules.prepare(file) }.value
        }
    ) {
        self.payslipID = payslipID ?? UUID().uuidString.lowercased()
        self.household = household
        self.financialYear = financialYear
        self.service = service
        self.apply = apply
        self.prepare = prepare
    }

    var isBusy: Bool { state.isBusy }

    /// Stores a newly chosen slip and reads it, or clears the one attached.
    func choose(_ file: UploadRules.PickedFile?) async {
        fileName = file?.name
        attachment = nil
        state = file == nil ? .idle : .uploading
        await release()
        guard let file else { return }

        let prepared: UploadRules.PreparedFile
        switch await prepare(file) {
        case .tooLarge(let message):
            fileName = nil
            state = .failure(.failed(message: message))
            return
        case .unreadable:
            fileName = nil
            state = .failure(.failed(message: Self.uploadFailedMessage))
            return
        case .ready(let ready):
            prepared = ready
        }
        fileName = prepared.name

        let path: String
        do {
            path = try await service.upload(household: household, payslipId: payslipID, file: prepared)
        } catch {
            fileName = nil
            state = .failure(.failed(message: Self.uploadFailedMessage))
            return
        }
        if isGone {
            // The form left while the upload was in flight; nothing will reference it.
            await service.discard(path: path)
            return
        }
        orphan = path
        attachment = PayslipAttachment(payslipId: payslipID, path: path)
        guard prepared.readable else {
            // Attached all the same: only the reading is skipped.
            state = .failure(.unsupported(message: PayslipExtractionReader.unsupportedMessage))
            return
        }
        state = .reading

        // A read that fails leaves the document attached: it is the record, and the
        // figures are typed either way.
        let outcome = await service.read(path: path, financialYear: financialYear)
        if isGone { return }
        if case .read(let extraction) = outcome {
            state = .read(apply(extraction))
        } else {
            state = .failure(outcome)
        }
    }

    /// Marks the attachment saved, so leaving the form no longer deletes it.
    func keep() { orphan = nil }

    /// Deletes the stored object nothing references, as when the form is left.
    func leave() {
        isGone = true
        guard let abandoned = orphan else { return }
        orphan = nil
        let service = service
        Task { await service.discard(path: abandoned) }
    }

    private func release() async {
        guard let abandoned = orphan else { return }
        orphan = nil
        await service.discard(path: abandoned)
    }
}
