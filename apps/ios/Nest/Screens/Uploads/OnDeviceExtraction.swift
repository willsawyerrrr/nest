import Foundation
import FoundationModels

/// A stored document handed to an on-device extractor.
struct OnDeviceRequest: Sendable {
    var name: String
    var data: Data
    var financialYear: Int
    /// The expected kind of receipt; set for deductions only.
    var category: DeductionCategory?
}

/// Why an on-device extractor gave no reading, in the terms the server path reports
/// them. Any other thrown error leaves the document to the server.
enum OnDeviceExtractionError: Error, Equatable, Sendable {
    /// The document is not the kind being read; `reason` is shown after the standard copy.
    case notADocument(reason: String?)
    /// The document's type cannot be read.
    case unsupported
}

/// Reads a stored document with the on-device model. Only payslips and receipts have
/// extractors; trade documents are always read on the server.
protocol OnDeviceExtractor<Extraction>: Sendable {
    associatedtype Extraction: Sendable

    /// The values read off the document, or a thrown error: `OnDeviceExtractionError`
    /// for a verdict the server would also give, anything else to fall back to the server.
    func extract(_ request: OnDeviceRequest) async throws -> Extraction
}

/// How an on-device attempt ended when it settled the document.
enum OnDeviceResult<Extraction: Sendable>: Sendable {
    case read(Extraction)
    case notADocument(reason: String?)
    case unsupported
}

/// Why the system on-device model cannot run, as shown beside the setting.
enum OnDeviceUnavailability: Equatable, Sendable {
    case deviceNotEligible
    case appleIntelligenceOff
    case modelNotReady

    var reason: String {
        switch self {
        case .deviceNotEligible: "This device doesn't support Apple Intelligence."
        case .appleIntelligenceOff: "Turn on Apple Intelligence in Settings."
        case .modelNotReady: "The Apple Intelligence model is still downloading."
        }
    }
}

/// Whether the system on-device model can run: an eligible device, Apple Intelligence
/// on, and the model downloaded.
enum OnDeviceModel {
    /// Why the model cannot run, or nil when it is ready.
    static var unavailability: OnDeviceUnavailability? {
        switch SystemLanguageModel.default.availability {
        case .available: nil
        case .unavailable(.deviceNotEligible): .deviceNotEligible
        case .unavailable(.appleIntelligenceNotEnabled): .appleIntelligenceOff
        case .unavailable: .modelNotReady
        }
    }

    static var isReady: Bool { unavailability == nil }
}

/// The per-device choice to read documents on this device, kept in `UserDefaults`.
/// On unless turned off.
enum OnDevicePreference {
    static let key = "read-documents-on-device"

    /// Whether documents may be read on this device; the model still has to be ready.
    static func isEnabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: key) as? Bool ?? true
    }

    static func setEnabled(_ enabled: Bool, _ defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: key)
    }
}

/// Routes a document through the first registered on-device extractor when the device
/// preference is on and the model is ready, leaving everything else to the server.
struct OnDeviceExtraction<Extraction: Sendable>: Sendable {
    var extractors: [any OnDeviceExtractor<Extraction>] = []
    var isModelReady: @Sendable () -> Bool = { OnDeviceModel.isReady }
    var isEnabled: @Sendable () -> Bool = { OnDevicePreference.isEnabled() }

    /// The on-device result, or nil when the server should read the document: no extractor
    /// is registered, the preference is off, the model is not ready, the file is not a readable type, the file
    /// could not be fetched, or the extractor failed.
    func read(
        path: String, financialYear: Int, category: DeductionCategory? = nil,
        download: @Sendable () async throws -> Data
    ) async -> OnDeviceResult<Extraction>? {
        guard let extractor = extractors.first, isEnabled(), isModelReady(), UploadRules.canExtract(path),
            let data = try? await download()
        else { return nil }
        let request = OnDeviceRequest(
            name: path, data: data, financialYear: financialYear, category: category)
        do {
            return .read(try await extractor.extract(request))
        } catch OnDeviceExtractionError.notADocument(let reason) {
            return .notADocument(reason: reason)
        } catch OnDeviceExtractionError.unsupported {
            return .unsupported
        } catch {
            return nil
        }
    }
}
