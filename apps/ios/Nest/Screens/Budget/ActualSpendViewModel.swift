import Foundation
import Observation

/// The Budget screen's actual spend: the pay-cycle fortnight being reconciled
/// and each group's spend over it from `budget_actual_spend`. The fortnight
/// steps from the household's stored inflows, never planning mode's sandbox, so
/// planning cannot move it.
@MainActor @Observable
final class ActualSpendViewModel {
    /// The fortnight shown; nil until the inflows have loaded.
    private(set) var period: SpendPeriod?
    /// The fortnight's spend; nil while it loads.
    private(set) var spend: ActualSpend?
    /// Why the last load failed; any spend already shown stays.
    private(set) var error: NestError?
    /// Whole fortnights back from the current one: 0 or negative.
    private(set) var offset = 0
    /// Whether pending transactions count.
    var includePending = false
    /// Bumped to reload after the category map changes.
    private(set) var revision = 0
    /// What `spend` was read for, so a changed fortnight or pending choice never shows stale figures.
    @ObservationIgnored private var shown: ActualSpendParams?

    private let data: NestData
    private let fortnight: @Sendable (SpendFortnightInput) async throws -> SpendPeriod
    private let fold: @Sendable (ActualSpendInput) async throws -> ActualSpend
    private let now: @Sendable () -> Date

    init(
        data: NestData = .live,
        fortnight: @escaping @Sendable (SpendFortnightInput) async throws -> SpendPeriod =
            ScreenEngine.spendFortnight,
        fold: @escaping @Sendable (ActualSpendInput) async throws -> ActualSpend =
            ScreenEngine.actualSpend,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.data = data
        self.fortnight = fortnight
        self.fold = fold
        self.now = now
    }

    /// Whether the fortnight shown holds today, past which there is nothing to step to.
    var isCurrent: Bool { offset == 0 }

    /// What a load reads; the screen reloads whenever it changes.
    struct Request: Equatable {
        let offset: Int
        let includePending: Bool
        let revision: Int
    }

    var request: Request {
        Request(offset: offset, includePending: includePending, revision: revision)
    }

    /// Steps to the fortnight before the one shown.
    func previous() { offset -= 1 }

    /// Steps to the fortnight after the one shown, never past the current one.
    func next() { offset = min(0, offset + 1) }

    /// Reloads the spend, as after the category map changes.
    func refresh() { revision += 1 }

    /// Places the fortnight from the inflows, then streams its spend, cached
    /// first. Call from `.task(id: request)`.
    func load() async {
        let request = request
        let today = InflowsPresentation.isoDate(now())
        var loaded: SpendPeriod?
        error = nil
        do {
            for try await snapshot in data.rows(Inflow.self) {
                let period = try await fortnight(
                    SpendFortnightInput(
                        inflows: snapshot.rows.map(SpendFortnightInput.PayCycleInflow.init),
                        today: today, offset: request.offset))
                guard period != loaded else { continue }
                loaded = period
                self.period = period
                let params = ActualSpendParams(period: period, includePending: request.includePending)
                if params != shown {
                    spend = nil
                    shown = params
                }
                for try await rows in data.rpcRows(
                    ActualSpendParams.function, params: params, as: ActualSpendRow.self)
                {
                    spend = try await fold(ActualSpendInput(rows: rows.rows))
                }
            }
        } catch is CancellationError {
            return
        } catch {
            self.error = (NestError.from(error) as? NestError) ?? NestError(.unknown)
        }
    }
}
