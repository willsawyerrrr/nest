import Foundation
import Observation

/// What the Super screen renders once loaded: the rows and the engine's figures.
struct SuperContent: Equatable, Sendable {
    let rows: SuperRows
    let summary: SuperSummary
    let financialYear: Int
}

/// Loads the household's super rows through the cache, summarises them in the
/// engine, and projects each member's balance under assumptions kept in
/// `UserDefaults` (shared by the household, with each member's age).
@MainActor @Observable
final class SuperViewModel {
    private(set) var state: ScreenState<SuperContent> = .loading
    private(set) var projections: [SuperProjection?] = []
    private(set) var ages: [String: Double]

    static let assumptionsKey = "super-retirement-assumptions"
    static let agesKey = "super-retirement-ages"

    private let data: NestData
    private let summarise: @Sendable (SuperInput) async throws -> SuperSummary
    private let project: @Sendable (SuperProjectionsInput) async throws -> [SuperProjection?]
    private let now: @Sendable () -> Date
    private let defaults: UserDefaults
    private var stored: RetirementAssumptions?

    init(
        data: NestData = .live,
        summarise: @escaping @Sendable (SuperInput) async throws -> SuperSummary =
            ScreenEngine.summariseSuper,
        project: @escaping @Sendable (SuperProjectionsInput) async throws -> [SuperProjection?] =
            ScreenEngine.projectSuper,
        now: @escaping @Sendable () -> Date = Date.init,
        defaults: UserDefaults = .standard
    ) {
        self.data = data
        self.summarise = summarise
        self.project = project
        self.now = now
        self.defaults = defaults
        ages = Self.readAges(defaults)
    }

    /// The assumptions in force: the stored ones, else the engine's defaults with
    /// the retirement age at the preservation age.
    var effectiveAssumptions: RetirementAssumptions? {
        state.value.map { resolved($0.summary) }
    }

    private func resolved(_ summary: SuperSummary) -> RetirementAssumptions {
        if let stored { return stored }
        var defaults = summary.defaultAssumptions
        defaults.retirementAge = Double(summary.preservationAge)
        return defaults
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let instant = now()
        let year = FinancialYear.containing(instant)
        let stream = RowsCombiner.stream(
            initial: SuperRows(), sources: SuperRows.sources(financialYear: year), data: data)
        do {
            for try await snapshot in stream {
                let summary = try await summarise(snapshot.rows.input(now: instant))
                stored = Self.readAssumptions(defaults, fallback: summary.defaultAssumptions)
                let content = SuperContent(rows: snapshot.rows, summary: summary, financialYear: year)
                projections = try await projected(content)
                state = .loaded(content, isRefreshing: snapshot.isCached, refreshError: nil)
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

    /// Sets one assumption (an empty field is 0, as in the PWA), saves it and re-projects.
    func setAssumption(_ keyPath: WritableKeyPath<RetirementAssumptions, Double>, to value: Double?) async {
        guard var next = effectiveAssumptions else { return }
        next[keyPath: keyPath] = value ?? 0
        stored = next
        if let data = try? JSONEncoder().encode(next) {
            defaults.set(data, forKey: Self.assumptionsKey)
        }
        await reproject()
    }

    /// Sets a member's age (`nil` clears it), saves it and re-projects.
    func setAge(_ age: Double?, for memberID: String) async {
        ages[memberID] = age
        if let data = try? JSONEncoder().encode(ages) {
            defaults.set(data, forKey: Self.agesKey)
        }
        await reproject()
    }

    private func reproject() async {
        guard let content = state.value else { return }
        if let result = try? await projected(content) { projections = result }
    }

    private func projected(_ content: SuperContent) async throws -> [SuperProjection?] {
        try await project(
            SuperProjectionsInput(
                entries: content.rows.members.map { member in
                    let figures = content.summary.members.first { $0.memberId == member.id }
                    return .init(
                        currentBalanceCents: figures?.effectiveBalanceCents ?? 0,
                        netAnnualContributionCents: figures?.netAnnualContributionCents ?? 0,
                        age: ages[member.id])
                },
                assumptions: resolved(content.summary)))
    }

    /// The stored assumptions, each missing or non-finite field filled from
    /// `fallback`; `nil` when none were saved.
    static func readAssumptions(_ defaults: UserDefaults, fallback: RetirementAssumptions)
        -> RetirementAssumptions?
    {
        guard let data = defaults.data(forKey: assumptionsKey),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        func value(_ key: String, _ fallback: Double) -> Double {
            guard let number = (raw[key] as? NSNumber)?.doubleValue, number.isFinite else {
                return fallback
            }
            return number
        }
        return RetirementAssumptions(
            retirementAge: value("retirementAge", fallback.retirementAge),
            expectedReturnPct: value("expectedReturnPct", fallback.expectedReturnPct),
            inflationPct: value("inflationPct", fallback.inflationPct),
            contributionGrowthPct: value("contributionGrowthPct", fallback.contributionGrowthPct))
    }

    private static func readAges(_ defaults: UserDefaults) -> [String: Double] {
        guard let data = defaults.data(forKey: agesKey),
            let ages = try? JSONDecoder().decode([String: Double].self, from: data)
        else { return [:] }
        return ages.filter { $0.value.isFinite }
    }
}
