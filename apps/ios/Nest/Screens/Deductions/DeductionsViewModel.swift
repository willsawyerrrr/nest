import Foundation
import Observation

/// What the Deductions screen renders once loaded.
struct DeductionsContent: Equatable, Sendable {
    let rows: DeductionsRows
    let financialYear: Int
    let availableYears: [Int]
    /// The `members` row whose `user_id` is the session user.
    let currentMemberID: String?
    let householdID: String?
}

/// Mints queue ids and remembers the category each file was added as, so a read is
/// primed for the kind of document chosen when the file was picked. A stored file's
/// path is `<household>/<id>/<uuid>-<name>`, so the id in it finds the category.
final class DeductionCategoryLedger: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: DeductionCategory = .workExpense
    private var byID: [String: DeductionCategory] = [:]

    /// Sets the category the next minted ids are recorded under.
    func expect(_ category: DeductionCategory) { lock.withLock { pending = category } }

    func mint() -> String {
        let id = UUID().uuidString.lowercased()
        lock.withLock { byID[id] = pending }
        return id
    }

    func category(forID id: String) -> DeductionCategory {
        lock.withLock { byID[id] } ?? .workExpense
    }

    func category(forPath path: String) -> DeductionCategory {
        let parts = path.split(separator: "/")
        return parts.count > 1 ? category(forID: String(parts[1])) : .workExpense
    }
}

/// Where the queue's handlers find the household and year they work in.
final class DeductionsContext: @unchecked Sendable {
    private let lock = NSLock()
    private var household: String?
    private var year = 0

    func set(household: String?, financialYear: Int) {
        lock.withLock {
            self.household = household ?? self.household
            year = financialYear
        }
    }

    var snapshot: (household: String?, financialYear: Int) { lock.withLock { (household, year) } }
}

/// Loads the household's deductions, groups and receipts for a financial year through
/// the cache, and performs every write the screen makes. Each member's receipt queue
/// (one per member, as on the web) lives here so a review survives a re-render.
@MainActor @Observable
final class DeductionsViewModel {
    private(set) var state: ScreenState<DeductionsContent> = .loading
    /// The year shown; nil until the options are known.
    private(set) var financialYear: Int?
    /// A write failure the screen shows beneath the list it came from.
    var moveError: String?

    let service: DeductionsService
    let ledger = DeductionCategoryLedger()
    private let context = DeductionsContext()
    private let data: NestData
    private let now: @Sendable () -> Date
    private let options: @Sendable (FinancialYearOptionsInput) async throws -> FinancialYearOptions
    @ObservationIgnored private var queues: [String: UploadQueue<DeductionDraft>] = [:]
    private var available: [Int] = []

    init(
        data: NestData = .live, now: @escaping @Sendable () -> Date = { Date() },
        options: @escaping @Sendable (FinancialYearOptionsInput) async throws -> FinancialYearOptions =
            ScreenEngine.financialYearOptions
    ) {
        self.data = data
        self.now = now
        self.options = options
        service = DeductionsService(data: data)
    }

    /// Streams the screen's rows for the chosen year until the fresh fetch lands. Call
    /// from `.task(id: financialYear)`; `selectFinancialYear` changes the id.
    func load() async {
        do {
            if financialYear == nil {
                let resolved = try await options(
                    FinancialYearOptionsInput(now: SummaryRows.iso(now())))
                available = resolved.available
                financialYear = resolved.current
            }
        } catch {
            state = .failed(NestError(.unknown))
            return
        }
        guard let year = financialYear else { return }
        let userID = try? await data.userID()
        let stream = RowsCombiner.stream(
            initial: DeductionsRows(), sources: DeductionsRows.sources(financialYear: year),
            data: data)
        do {
            for try await snapshot in stream {
                let household = snapshot.rows.members.first?.householdId
                context.set(household: household, financialYear: year)
                state = .loaded(
                    DeductionsContent(
                        rows: snapshot.rows, financialYear: year, availableYears: available,
                        currentMemberID: snapshot.rows.members.first { $0.userId == userID }?.id,
                        householdID: household),
                    isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let content = state.value {
                state = .loaded(content, isRefreshing: false, refreshError: failure)
            } else {
                state = .failed(failure)
            }
        }
    }

    /// Discards the shown state and loads again.
    func retry() async {
        if state.value == nil { state = .loading }
        await load()
    }

    func selectFinancialYear(_ year: Int) {
        guard year != financialYear else { return }
        financialYear = year
    }

    // MARK: Writes

    private var householdID: String? { state.value?.householdID }

    private enum WriteError: Error { case notLoaded }

    private func run(_ operation: () async throws -> Void) async throws {
        do {
            try await operation()
        } catch {
            await load()
            throw error
        }
        await load()
    }

    func create(_ submission: DeductionSubmission) async throws {
        guard let household = householdID, let year = financialYear else { throw WriteError.notLoaded }
        try await run {
            try await service.create(submission, householdID: household, financialYear: year)
        }
    }

    func update(id: String, _ write: DeductionWrite) async throws {
        try await run { try await service.update(id: id, write) }
    }

    func delete(id: String) async throws { try await run { try await service.delete(id: id) } }

    /// Files `deduction` under `groupID` (nil takes it out of its group), writing the whole
    /// row back with only its group changed.
    func move(_ deduction: Deduction, to groupID: String?) async {
        moveError = nil
        do { try await update(id: deduction.id, DeductionWrite(moving: deduction, to: groupID)) } catch {
            moveError = "Could not move this deduction. Please try again."
        }
    }

    func createGroup(memberID: String, name: String) async throws {
        guard let household = householdID, let year = financialYear else { throw WriteError.notLoaded }
        try await run {
            try await service.createGroup(
                memberID: memberID, name: name, householdID: household, financialYear: year)
        }
    }

    func updateGroup(id: String, memberID: String, name: String) async throws {
        try await run { try await service.updateGroup(id: id, memberID: memberID, name: name) }
    }

    func deleteGroup(id: String) async throws {
        try await run { try await service.deleteGroup(id: id) }
    }

    func attachReceipt(
        deductionID: String, file: UploadRules.PreparedFile, existing: DeductionReceipt?
    ) async throws {
        guard let household = householdID else { throw WriteError.notLoaded }
        try await run {
            try await service.attach(
                householdID: household, deductionID: deductionID, file: file, existing: existing)
        }
    }

    func removeReceipt(_ receipt: DeductionReceipt) async throws {
        try await run { try await service.removeReceipt(receipt) }
    }

    // MARK: Receipts

    /// The handlers a single add form's attachment calls into.
    var attachmentHandlers: ReceiptAttachment.Handlers {
        let service = service
        let context = context
        return ReceiptAttachment.Handlers(
            upload: { deductionID, file in
                guard let household = context.snapshot.household else { throw NestError(.unknown) }
                return try await service.uploadPending(
                    householdID: household, deductionID: deductionID, file: file)
            },
            discard: { await service.discard(path: $0) },
            read: { path, category in
                await service.extract(
                    path: path, category: category, financialYear: context.snapshot.financialYear)
            })
    }

    /// The member's bulk receipt queue, created on first use.
    func queue(for memberID: String) -> UploadQueue<DeductionDraft> {
        if let existing = queues[memberID] { return existing }
        let service = service
        let context = context
        let ledger = ledger
        let handlers = UploadHandlers<DeductionDraft>(
            upload: { id, file in
                guard let household = context.snapshot.household else { throw NestError(.unknown) }
                return try await service.uploadPending(
                    householdID: household, deductionID: id, file: file)
            },
            discard: { await service.discard(path: $0) },
            read: { path in
                DeductionExtractor.readResult(
                    await service.extract(
                        path: path, category: ledger.category(forPath: path),
                        financialYear: context.snapshot.financialYear))
            },
            blank: { DeductionDraft(extraction: nil) },
            unsupportedMessage: DeductionExtractor.unsupportedMessage)
        let queue = UploadQueue<DeductionDraft>(handlers: handlers, mintID: { ledger.mint() })
        queues[memberID] = queue
        return queue
    }

    /// Adds receipts picked on the Add card to `memberID`'s queue as `category`; returns
    /// how many were left out for being over the batch limit.
    @discardableResult
    func addReceipts(
        _ files: [UploadRules.PickedFile], memberID: String, category: DeductionCategory
    ) -> Int {
        ledger.expect(category)
        return queue(for: memberID).add(files)
    }

    /// Takes the files shared into the app from other apps into the signed-in member's
    /// queue as work expenses; returns the ids queued, which the caller removes from the
    /// inbox. Nothing is taken until the signed-in member is known.
    func receiveShared(_ items: [ShareInbox.Item]) -> [String] {
        guard let member = state.value?.currentMemberID, !items.isEmpty else { return [] }
        let files = items.compactMap { item -> (String, UploadRules.PickedFile)? in
            guard let copy = Self.copyToTemporary(item.fileURL, name: item.name) else { return nil }
            return (item.id, UploadRules.PickedFile(name: item.name, url: copy))
        }
        addReceipts(files.map(\.1), memberID: member, category: .workExpense)
        return files.map(\.0)
    }

    /// Leaves the screen: deletes every stored file no saved deduction references.
    func close() { for queue in queues.values { queue.closeOut() } }

    /// A copy of a picked or shared file the queue can read after the source goes away.
    nonisolated static func copyToTemporary(_ url: URL, name: String) -> URL? {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("receipts-\(UUID().uuidString)", isDirectory: true)
        let target = directory.appendingPathComponent((name as NSString).lastPathComponent)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: url, to: target)
            return target
        } catch { return nil }
    }
}
