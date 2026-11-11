import Foundation
import Testing

@testable import Nest

private enum Fixtures {
    static let stamp = "\"created_at\":\"2026-01-01T00:00:00Z\",\"updated_at\":\"2026-01-01T00:00:00Z\""
    static let member =
        "[{\"id\":\"m1\",\"household_id\":\"h\",\"user_id\":\"u\",\"name\":\"Will\",\"email\":null,\"date_of_birth\":null,\"up_connected_at\":null,\"up_sync_failed_at\":null,\(stamp)}]"
    static let deduction =
        "[{\"id\":\"d1\",\"household_id\":\"h\",\"member_id\":\"m1\",\"financial_year\":2027,\"description\":\"Laptop\",\"amount_cents\":60000,\"full_amount_cents\":100000,\"work_use_percent\":60,\"deduction_date\":\"2026-08-01\",\"basis\":\"amount\",\"category\":\"work_expense\",\"distance_km\":null,\"work_from_home_hours\":null,\"group_id\":null,\(stamp)}]"
    static let group =
        "[{\"id\":\"g1\",\"household_id\":\"h\",\"member_id\":\"m1\",\"financial_year\":2027,\"kind\":\"standard\",\"name\":\"Trip\",\(stamp)}]"
    static let receipt =
        "[{\"id\":\"r1\",\"household_id\":\"h\",\"deduction_id\":\"d1\",\"storage_path\":\"h/d1/x.pdf\",\"created_at\":\"2026-01-01T00:00:00Z\"}]"
}

@MainActor
@Suite struct DeductionsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "members": Fixtures.member, "deduction": Fixtures.deduction,
            "deduction_group": Fixtures.group, "deduction_receipt": Fixtures.receipt,
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [URLRequest] = []
        var requests: [URLRequest] { lock.withLock { recorded } }
        func record(_ request: URLRequest) { lock.withLock { recorded.append(request) } }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    server.record(request)
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    let failed = server.failing.contains(table)
                    return (
                        Data((failed ? "{}" : server.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("DeductionsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> DeductionsViewModel {
        DeductionsViewModel(
            data: data, now: { Date(timeIntervalSince1970: 1_800_000_000) },
            options: { _ in FinancialYearOptions(current: 2027, available: [2027, 2026]) })
    }

    @Test func loadsEveryTableForTheCurrentYear() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let content = try #require(model.state.value)
        #expect(content.financialYear == 2027)
        #expect(content.availableYears == [2027, 2026])
        #expect(content.currentMemberID == "m1")
        #expect(content.householdID == "h")
        #expect(content.rows.deductions.map(\.description) == ["Laptop"])
        let queries = server.requests.map { $0.url!.query ?? "" }
        #expect(queries.contains { $0.contains("financial_year=eq.2027") && $0.contains("order=deduction_date.asc") })
        #expect(queries.contains { $0.contains("order=name.asc") })
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["deduction_group"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedRows() async {
        let server = Server()
        let dir = directory()
        await model(makeData(server, directory: dir)).load()
        server.failing = ["deduction"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.rows.deductions.count == 1)
        #expect(error?.code == .server)
    }

    @Test func movingADeductionWritesTheWholeRowWithOnlyItsGroupChanged() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let deduction = try #require(model.state.value?.rows.deductions.first)
        await model.move(deduction, to: "g1")
        let patch = try #require(server.requests.first { $0.httpMethod == "PATCH" })
        #expect(patch.url!.query?.contains("id=eq.d1") == true)
        let body = try #require(
            JSONSerialization.jsonObject(with: patch.httpBody!) as? [String: Any])
        #expect(body["group_id"] as? String == "g1")
        #expect(body["amount_cents"] as? Int == 60_000)
        #expect(body["full_amount_cents"] as? Int == 100_000)
        #expect(body["work_use_percent"] as? Double == 60)
        #expect(body["distance_km"] is NSNull)
        #expect(model.moveError == nil)
    }

    @Test func aFailedMoveSaysSo() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        server.failing = ["deduction"]
        let deduction = try #require(model.state.value?.rows.deductions.first)
        await model.move(deduction, to: nil)
        #expect(model.moveError == "Could not move this deduction. Please try again.")
    }

    @Test func creatingCallsTheRPCWithTheReceiptPath() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let write = DeductionWrite(
            memberID: "m1", description: "Pens", amountCents: 500, deductionDate: "2026-08-02",
            basis: .amount, distanceKm: nil, workFromHomeHours: nil, groupID: nil,
            category: .workExpense, fullAmountCents: 500, workUsePercent: 100)
        try await model.create(DeductionSubmission(id: "new", write: write, receiptPath: "h/new/a.pdf"))
        let call = try #require(
            server.requests.first { $0.url!.path.hasSuffix("rpc/create_deduction_with_receipt") })
        let body = try #require(JSONSerialization.jsonObject(with: call.httpBody!) as? [String: Any])
        #expect(body["p_receipt_path"] as? String == "h/new/a.pdf")
        let deduction = try #require(body["p_deduction"] as? [String: Any])
        #expect(deduction["id"] as? String == "new")
        #expect(deduction["household_id"] as? String == "h")
        #expect(deduction["financial_year"] as? Int == 2027)
    }

    @Test func sharedFilesQueueAsWorkExpensesForTheSignedInMember() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        #expect(model.receiveShared([]).isEmpty)
        await model.load()
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("share-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("file")
        try Data("pdf".utf8).write(to: file)
        let item = ShareInbox.Item(
            id: UUID().uuidString, name: "receipt.pdf", mimeType: "application/pdf", size: 3,
            createdAt: Date(), fileURL: file)
        #expect(model.receiveShared([item]) == [item.id])
        let queue = model.queue(for: "m1")
        #expect(queue.items.count == 1)
        #expect(queue.items.first?.file.name == "receipt.pdf")
        #expect(model.ledger.category(forID: queue.items[0].id) == .workExpense)
    }
}

@Suite struct DeductionsPresentationTests {
    private func deduction(_ json: String) throws -> Deduction {
        try JSONDecoder().decode(Deduction.self, from: Data(json.utf8))
    }

    private func row(basis: String, extra: String, workUse: Int = 100) throws -> Deduction {
        try deduction(
            "{\"id\":\"d\",\"household_id\":\"h\",\"member_id\":\"m\",\"financial_year\":2027,\"description\":\"x\",\"amount_cents\":1,\"full_amount_cents\":1,\"work_use_percent\":\(workUse),\"deduction_date\":\"2026-09-01\",\"basis\":\"\(basis)\",\"category\":\"work_expense\",\(extra),\"group_id\":null,\"created_at\":\"2026-01-01T00:00:00Z\",\"updated_at\":\"2026-01-01T00:00:00Z\"}"
        )
    }

    @Test func labelsTheDateWithDistanceHoursOrWorkUse() throws {
        let plain = try row(basis: "amount", extra: "\"distance_km\":null,\"work_from_home_hours\":null")
        #expect(DeductionsPresentation.dateLabel(plain).hasPrefix("1 Sep"))
        let distance = try row(basis: "distance", extra: "\"distance_km\":120,\"work_from_home_hours\":null")
        #expect(DeductionsPresentation.dateLabel(distance).hasSuffix("2026 · 120km"))
        let hours = try row(basis: "hours", extra: "\"distance_km\":null,\"work_from_home_hours\":12.5")
        #expect(DeductionsPresentation.dateLabel(hours).hasSuffix("2026 · 12.5 hours"))
        let part = try row(
            basis: "amount", extra: "\"distance_km\":null,\"work_from_home_hours\":null", workUse: 60)
        #expect(DeductionsPresentation.dateLabel(part).hasSuffix("2026 · 60% work use"))
    }
}

@MainActor
@Suite struct DeductionFormStateTests {
    private func form(initial: Deduction? = nil, extraction: DeductionExtraction? = nil)
        -> DeductionFormState
    {
        DeductionFormState(
            memberID: "m1", financialYear: 2027, initial: initial, extraction: extraction,
            today: "2026-08-01")
    }

    @Test func aReadFillsOnlyWhatTheMemberHasLeftAlone() {
        let state = form()
        state.setDescription("Typed")
        let filled = state.prefill(
            DeductionExtraction(description: "Read", deductionDate: "2026-07-04", amountCents: 1_250))
        #expect(filled)
        #expect(state.description == "Typed")
        #expect(state.amount == "12.5")
        #expect(state.date == "2026-07-04")
        #expect(!state.prefill(DeductionExtraction()))
    }

    @Test func aDollarWorkExpenseApportionsByWorkUse() {
        let state = form()
        state.setAmount("1000")
        state.workUse = "60"
        state.figures = DeductionFigures(
            centsPerKm: 91, maxClaimableKm: 5000, centsPerHour: 70, distanceCents: 0, hoursCents: 0,
            apportionedCents: 60_000)
        let write = state.write()
        #expect(write.amountCents == 60_000)
        #expect(write.fullAmountCents == 100_000)
        #expect(write.workUsePercent == 60)
        #expect(state.canSubmit(receiptBusy: false) == false)
        state.setDescription("Laptop")
        #expect(state.canSubmit(receiptBusy: false))
        #expect(!state.canSubmit(receiptBusy: true))
    }

    @Test func aDonationAndATaxAgentFeeAreClaimedInFullOnTheDollarBasis() {
        let state = form()
        state.chosenBasis = .distance
        state.workUse = "50"
        state.category = .donation
        state.setAmount("50")
        let write = state.write()
        #expect(write.basis == .amount)
        #expect(write.workUsePercent == 100)
        #expect(write.groupID == nil)
        #expect(write.distanceKm == nil)
    }

    @Test func theDistanceBasisClaimsTheEnginesFigureAndWarnsOverTheCap() {
        let state = form()
        state.chosenBasis = .distance
        state.distance = "6000"
        state.figures = DeductionFigures(
            centsPerKm: 91, maxClaimableKm: 5000, centsPerHour: 70, distanceCents: 546_000,
            hoursCents: 0, apportionedCents: 0)
        #expect(state.overCap)
        let write = state.write()
        #expect(write.amountCents == 546_000)
        #expect(write.distanceKm == 6000)
        #expect(write.fullAmountCents == 546_000)
        #expect(state.figuresInput.distanceKm == 6000)
    }

    @Test func editingReopensOnTheFullCostAndKeepsItsBasis() throws {
        let initial = try JSONDecoder().decode(
            Deduction.self,
            from: Data(
                "{\"id\":\"d\",\"household_id\":\"h\",\"member_id\":\"m1\",\"financial_year\":2027,\"description\":\"Laptop\",\"amount_cents\":60000,\"full_amount_cents\":100000,\"work_use_percent\":60,\"deduction_date\":\"2026-08-01\",\"basis\":\"hours\",\"category\":\"work_expense\",\"distance_km\":null,\"work_from_home_hours\":10,\"group_id\":null,\"created_at\":\"2026-01-01T00:00:00Z\",\"updated_at\":\"2026-01-01T00:00:00Z\"}"
                    .utf8))
        let state = form(initial: initial)
        #expect(state.amount == "1000")
        #expect(state.basis == .hours)
        #expect(state.hours == "10")
        #expect(state.workUse == "60")
    }
}

@Suite struct DeductionExtractionTests {
    @Test func readsTheFieldsAReplyCarries() throws {
        let body = Data(
            #"{"model":"m","fields":{"description":"Pens","deduction_date":"2026-08-01","amount_cents":1250}}"#.utf8)
        #expect(
            DeductionExtractor.read(body)
                == DeductionExtraction(
                    description: "Pens", deductionDate: "2026-08-01", amountCents: 1_250))
        #expect(DeductionExtractor.read(Data(#"{"fields":{}}"#.utf8)) == nil)
        #expect(DeductionExtractor.read(Data(#"{"model":"m","fields":{"amount_cents":-1}}"#.utf8))?.isEmpty == true)
    }

    @Test func readsFailuresIntoTheirOwnStates() {
        func outcome(_ json: String) -> DeductionExtractionOutcome {
            DeductionExtractor.readFailure(Data(json.utf8))
        }
        #expect(outcome(#"{"code":"unsupported_type"}"#) == .unsupported(DeductionExtractor.unsupportedMessage))
        #expect(outcome(#"{"configured":false}"#) == .notConfigured(DeductionExtractor.unconfiguredMessage))
        #expect(outcome(#"{"outOfCredit":true,"error":"Top up"}"#) == .outOfCredit("Top up"))
        #expect(outcome(#"{"keyRejected":true}"#) == .keyRejected(DeductionExtractor.keyRejectedMessage))
        #expect(
            outcome(#"{"notReceipt":true,"reason":"A menu."}"#)
                == .notReceipt(message: DeductionExtractor.notReceiptMessage, reason: "A menu."))
        #expect(outcome(#"{"error":"Could not resolve household"}"#) == .failed(DeductionExtractor.failedMessage))
        #expect(DeductionExtractor.readFailure(nil) == .failed(DeductionExtractor.failedMessage))
    }

    @Test func readingThatIsOffHaltsTheQueue() {
        guard case .halt = DeductionExtractor.readResult(.outOfCredit("x")) else {
            Issue.record("not halted")
            return
        }
        guard case .failed(let message) = DeductionExtractor.readResult(
            .notReceipt(message: "No.", reason: "A menu."))
        else {
            Issue.record("not failed")
            return
        }
        #expect(message == "No. A menu.")
    }
}

@Suite struct DeductionReceiptFileTests {
    @Test func aDownloadNameDropsTheGeneratedPrefix() {
        #expect(
            DeductionsService.downloadName("h/d/0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f-scan.heic")
                == "scan.heic")
    }
}
