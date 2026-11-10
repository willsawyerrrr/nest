import Foundation
import Observation

/// The engine calls the Tax and EOFY screens make, injectable so tests stub them.
struct TaxEngine: Sendable {
    var screen: @Sendable (TaxScreenInput) async throws -> TaxScreenFigures = ScreenEngine.taxScreen
    var salarySacrifice: @Sendable (SalarySacrificeInput) async throws -> SalarySacrificeResult =
        ScreenEngine.salarySacrifice
    var mls: @Sendable (DependentChildrenInput) async throws -> FamilyMlsFigures =
        ScreenEngine.mlsWhatIf
    var household: @Sendable (DependentChildrenInput) async throws -> HouseholdYearFigures =
        ScreenEngine.householdYear
}

/// What the Tax estimate and EOFY screens render once loaded.
struct TaxContent: Sendable {
    let rows: TaxRows
    let figures: TaxScreenFigures
    /// The engine input the figures came from, re-run by the what-ifs.
    let input: TaxScreenInput
    let engine: TaxEngine

    var financialYear: Int { figures.financialYear }
}

/// What `share-create` returns: the plaintext token, shown once, and whether it emailed.
struct CreatedShare: Decodable, Sendable, Equatable {
    let token: String
    let expiresAt: String
    let emailSent: Bool
}

/// Loads the household's rows for a financial year through the cache, runs the
/// tax figures in the engine and publishes them. The Tax route reads the current
/// year; the EOFY route reads the selected one and also manages the share link.
@MainActor @Observable
final class TaxViewModel {
    enum Mode: Sendable { case tax, eofy }

    private(set) var state: ScreenState<TaxContent> = .loading
    /// The year shown; EOFY changes it, and the screen reloads on the change.
    var financialYear: Int

    let mode: Mode
    fileprivate let data: NestData
    private let engine: TaxEngine
    private let now: @Sendable () -> Date
    private let planning: PlanningStore

    init(
        mode: Mode, data: NestData = .live, engine: TaxEngine = TaxEngine(),
        now: @escaping @Sendable () -> Date = Date.init, planning: PlanningStore = .shared
    ) {
        self.mode = mode
        self.data = data
        self.engine = engine
        self.now = now
        self.planning = planning
        financialYear = FinancialYear.containing(now())
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let year = financialYear
        let instant = now()
        if let shown = state.value, shown.financialYear != year { state = .loading }
        let stream = RowsCombiner.stream(
            initial: TaxRows(),
            sources: TaxRows.sources(financialYear: year, eofy: mode == .eofy), data: data)
        do {
            for try await snapshot in stream {
                guard year == financialYear else { return }
                let sandbox = planning.state
                let useSandbox = mode == .tax && sandbox.active
                if mode == .tax { planning.select(household: snapshot.rows.members.first?.householdId) }
                let rows = useSandbox ? snapshot.rows.sandboxed(by: sandbox) : snapshot.rows
                let input = rows.input(
                    financialYear: year, now: instant, real: useSandbox ? snapshot.rows : nil)
                let figures = try await engine.screen(input)
                state = .loaded(
                    TaxContent(rows: rows, figures: figures, input: input, engine: engine),
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

    /// Mints (or replaces) the household's share via `share-create`, then reloads
    /// so the live share shows.
    func createShare(financialYear: Int, recipientEmail: String) async throws -> CreatedShare {
        struct Body: Encodable, Sendable {
            let financialYear: Int
            let recipientEmail: String
        }
        let created: CreatedShare = try await data.invoke(
            "share-create", body: Body(financialYear: financialYear, recipientEmail: recipientEmail),
            invalidating: [ShareGrant.table])
        await load()
        return created
    }

    /// Revokes the household's live share, then reloads.
    func revokeShare() async throws {
        try await data.call("revoke_share_grant", invalidating: [ShareGrant.table])
        await load()
    }
}

extension TaxViewModel {
    /// A time-limited URL for a receipt or payslip document, or `nil` when it cannot be signed.
    func signedURL(bucket: String, path: String) async -> URL? {
        try? await data.api.signedURL(bucket: bucket, path: path)
    }
}
