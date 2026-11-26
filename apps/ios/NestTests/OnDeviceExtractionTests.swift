import Foundation
import Testing

@testable import Nest

@Suite struct OnDeviceExtractionTests {
    private struct Stub<Extraction: Sendable>: OnDeviceExtractor {
        var result: Result<Extraction, any Error>
        func extract(_ request: OnDeviceRequest) async throws -> Extraction { try result.get() }
    }

    private struct Boom: Error {}

    private final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var functions: [String] = []
        private var downloads = 0
        var invoked: [String] { lock.withLock { functions } }
        var downloaded: Int { lock.withLock { downloads } }
        func record(_ request: URLRequest) {
            lock.withLock {
                let path = request.url!.path
                if path.contains("/functions/v1/") {
                    functions.append(String(path.split(separator: "/").last ?? ""))
                } else if path.contains("/object/authenticated/") {
                    downloads += 1
                }
            }
        }
    }

    private func data(_ calls: Calls, serverBody: String = #"{"model":"m","fields":{}}"#) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    calls.record(request)
                    return (
                        Data(serverBody.utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
                }),
            cache: RowCache(
                directory: FileManager.default.temporaryDirectory
                    .appendingPathComponent("OnDeviceExtractionTests-\(UUID().uuidString)")),
            userID: { "u" })
    }

    private func router(
        _ result: Result<PayslipExtraction, any Error>? = .success(PayslipExtraction(model: "on-device")),
        ready: Bool = true, enabled: Bool = true
    ) -> OnDeviceExtraction<PayslipExtraction> {
        OnDeviceExtraction(
            extractors: result.map { [Stub(result: $0)] } ?? [], isModelReady: { ready },
            isEnabled: { enabled })
    }

    private func read(_ router: OnDeviceExtraction<PayslipExtraction>, path: String = "h/p/slip.pdf")
        async -> OnDeviceResult<PayslipExtraction>?
    {
        await router.read(path: path, financialYear: 2026) { Data([1]) }
    }

    @Test func readsOnDeviceWhenAnExtractorIsRegisteredAndTheModelIsReady() async {
        guard case .read(let extraction) = await read(router()) else {
            Issue.record("not read on device")
            return
        }
        #expect(extraction.model == "on-device")
    }

    @Test func leavesTheServerTheDocumentWhenNothingIsRegistered() async {
        #expect(await read(router(nil)) == nil)
    }

    @Test func leavesTheServerTheDocumentWhenTheModelIsNotReady() async {
        #expect(await read(router(ready: false)) == nil)
    }

    @Test func leavesTheServerTheDocumentWhenThePreferenceIsOff() async {
        #expect(await read(router(enabled: false)) == nil)
    }

    @Test func thePreferenceIsOnUntilTurnedOffAndIsKeptPerDevice() {
        let defaults = UserDefaults(suiteName: "OnDevicePreferenceTests-\(UUID().uuidString)")!
        #expect(OnDevicePreference.isEnabled(defaults))
        OnDevicePreference.setEnabled(false, defaults)
        #expect(!OnDevicePreference.isEnabled(defaults))
        OnDevicePreference.setEnabled(true, defaults)
        #expect(OnDevicePreference.isEnabled(defaults))
    }

    @Test func eachUnavailabilityHasItsOwnReason() {
        let reasons = [
            OnDeviceUnavailability.deviceNotEligible, .appleIntelligenceOff, .modelNotReady,
        ].map(\.reason)
        #expect(Set(reasons).count == 3)
    }

    @Test func theModelIsReadyOnlyWithoutAnUnavailability() {
        #expect(OnDeviceModel.isReady == (OnDeviceModel.unavailability == nil))
    }

    @Test func leavesTheServerAFileTheModelCannotRead() async {
        #expect(await read(router(), path: "h/p/slip.docx") == nil)
    }

    @Test func leavesTheServerADocumentThatCouldNotBeFetched() async {
        let result = await router().read(path: "h/p/slip.pdf", financialYear: 2026) { throw Boom() }
        #expect(result == nil)
    }

    @Test func leavesTheServerADocumentTheExtractorFailedOn() async {
        #expect(await read(router(.failure(Boom()))) == nil)
    }

    @Test func passesAnExtractorsVerdictsThrough() async {
        guard case .notADocument(let reason) = await read(
            router(.failure(OnDeviceExtractionError.notADocument(reason: "A menu"))))
        else {
            Issue.record("not a verdict")
            return
        }
        #expect(reason == "A menu")
        guard case .unsupported = await read(router(.failure(OnDeviceExtractionError.unsupported)))
        else {
            Issue.record("not unsupported")
            return
        }
    }

    @Test func verdictsMatchTheServerPathsOutcomes() {
        #expect(PayslipExtractionReader.outcome(.notADocument(reason: "A menu"))
            == PayslipExtractionReader.readFailure(Data(#"{"notPayslip":true,"reason":"A menu"}"#.utf8)))
        #expect(PayslipExtractionReader.outcome(.unsupported)
            == PayslipExtractionReader.readFailure(Data(#"{"code":"unsupported_type"}"#.utf8)))
        #expect(DeductionExtractor.outcome(.notADocument(reason: nil))
            == DeductionExtractor.readFailure(Data(#"{"notReceipt":true}"#.utf8)))
        #expect(DeductionExtractor.outcome(.unsupported)
            == DeductionExtractor.readFailure(Data(#"{"code":"unsupported_type"}"#.utf8)))
    }

    @Test func aPayslipReadOnDeviceNeverCallsTheServer() async {
        let calls = Calls()
        let service = PayslipsService(data: data(calls), onDevice: router())
        let outcome = await service.read(path: "h/p/slip.pdf", financialYear: 2026)
        #expect(outcome == .read(PayslipExtraction(model: "on-device")))
        #expect(calls.downloaded == 1)
        #expect(calls.invoked.isEmpty)
    }

    @Test func aPayslipFallsBackToTheServerWhenTheModelIsNotReady() async {
        let calls = Calls()
        let service = PayslipsService(data: data(calls), onDevice: router(ready: false))
        let outcome = await service.read(path: "h/p/slip.pdf", financialYear: 2026)
        #expect(outcome == .read(PayslipExtraction(model: "m")))
        #expect(calls.downloaded == 0)
        #expect(calls.invoked == ["payslip-extract"])
    }

    @Test func aReceiptFallsBackToTheServerWhenOnDeviceFails() async {
        let calls = Calls()
        let onDevice = OnDeviceExtraction<DeductionExtraction>(
            extractors: [Stub<DeductionExtraction>(result: .failure(Boom()))], isModelReady: { true })
        let service = DeductionsService(data: data(calls), onDevice: onDevice)
        let outcome = await service.extract(path: "h/r/a.jpg", category: .workExpense, financialYear: 2026)
        #expect(outcome == .read(DeductionExtraction()))
        #expect(calls.invoked == ["deduction-extract"])
    }

    @Test func tradeDocumentsAlwaysReadOnTheServer() async {
        let calls = Calls()
        let service = TradeDocumentsService(data: data(calls, serverBody: #"{"model":"m","trades":[]}"#))
        _ = await service.extract(path: "h/t/note.pdf", financialYear: 2026)
        #expect(calls.downloaded == 0)
        #expect(calls.invoked == ["trade-extract"])
    }
}
