import Foundation
import Observation

/// What the Payslips screen renders once loaded: the rows and the engine's measurements.
struct PayslipsContent: Equatable, Sendable {
    let rows: PayslipsRows
    let overview: PayslipsOverview
    let financialYear: Int

    /// The household the rows belong to, which the stored documents are filed under.
    var householdID: String? { rows.members.first?.householdId }
}

/// Loads the household's payslips and the rows behind their expectations through the
/// cache, measures them in the engine and publishes the result. Saving and deleting
/// go through the service, then reload.
@MainActor @Observable
final class PayslipsViewModel {
    private(set) var state: ScreenState<PayslipsContent> = .loading

    let service: any PayslipsServicing
    let now: @Sendable () -> Date

    private let data: NestData
    private let measure: @Sendable (PayslipsInput) async throws -> PayslipsOverview

    init(
        data: NestData = .live,
        service: (any PayslipsServicing)? = nil,
        measure: @escaping @Sendable (PayslipsInput) async throws -> PayslipsOverview =
            ScreenEngine.payslipsOverview,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.data = data
        self.service = service ?? PayslipsService(data: data)
        self.measure = measure
        self.now = now
    }

    /// The financial year the screen shows: the current one.
    var financialYear: Int { FinancialYear.containing(now()) }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let year = financialYear
        let stream = RowsCombiner.stream(
            initial: PayslipsRows(), sources: PayslipsRows.sources(financialYear: year), data: data)
        do {
            for try await snapshot in stream {
                let overview = try await measure(snapshot.rows.input(financialYear: year))
                state = .loaded(
                    PayslipsContent(rows: snapshot.rows, overview: overview, financialYear: year),
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

    /// Writes a payslip and its lines, then reloads. A superseded document is the
    /// stored one the submission's attachment replaces.
    func save(_ submission: PayslipSubmission) async throws {
        guard let content = state.value, let household = content.householdID else {
            throw NestError(.unknown)
        }
        let superseded = content.rows.payslips.first { $0.id == submission.id }?.filePath
        do {
            try await service.save(submission, household: household, superseding: superseded)
        } catch {
            throw NestError.from(error)
        }
        await load()
    }

    /// Removes a payslip and its stored document, then reloads.
    func delete(_ payslip: Payslip) async throws {
        do { try await service.delete(payslip) } catch { throw NestError.from(error) }
        await load()
    }

    /// A short-lived URL for a stored payslip document.
    func documentURL(path: String) async -> URL? {
        await service.signedURL(path: path)
    }
}
