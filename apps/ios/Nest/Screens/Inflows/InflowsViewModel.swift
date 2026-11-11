import Foundation
import Observation

/// What the Inflows screen renders once loaded.
struct InflowsContent: Equatable, Sendable {
    let rows: InflowsRows
    let fortnightlies: InflowFortnightlies
}

/// Loads the household's inflows and members through the cache, draws each inflow's
/// fortnightly figure in the engine and publishes the result. Writes go to the
/// database, or into the planning sandbox while planning mode is on, as the PWA's
/// household collection does.
@MainActor @Observable
final class InflowsViewModel {
    private(set) var state: ScreenState<InflowsContent> = .loading

    private let data: NestData
    private let summarise: @Sendable (InflowsInput) async throws -> InflowFortnightlies
    private let previewDraft: @Sendable (InflowDraftInput) async throws -> InflowDraftPreview
    private let now: @Sendable () -> Date
    private let planning: PlanningStore

    init(
        data: NestData = .live,
        summarise: @escaping @Sendable (InflowsInput) async throws -> InflowFortnightlies =
            ScreenEngine.summariseInflows,
        previewDraft: @escaping @Sendable (InflowDraftInput) async throws -> InflowDraftPreview =
            ScreenEngine.previewInflowDraft,
        now: @escaping @Sendable () -> Date = Date.init,
        planning: PlanningStore = .shared
    ) {
        self.data = data
        self.summarise = summarise
        self.previewDraft = previewDraft
        self.now = now
        self.planning = planning
    }

    /// The instant the screen reads at, for the ended/live split.
    var instant: Date { now() }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: InflowsRows(), sources: InflowsRows.sources, data: data)
        do {
            for try await snapshot in stream {
                planning.select(household: snapshot.rows.members.first?.householdId)
                let sandbox = planning.state
                let rows = sandbox.active ? snapshot.rows.sandboxed(by: sandbox) : snapshot.rows
                let fortnightlies = try await summarise(rows.input)
                state = .loaded(
                    InflowsContent(rows: rows, fortnightlies: fortnightlies),
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

    /// The figures the form shows back from `form`: the stated annual total, what one
    /// payment comes to and a one-off's split. `nil` when the engine cannot answer.
    func preview(_ form: InflowFormState, members: [Member]) async -> InflowDraftPreview? {
        let dateOfBirth = members.first { $0.id == form.memberID }?.dateOfBirth
        return try? await previewDraft(form.draftInput(now: now(), dateOfBirth: dateOfBirth))
    }

    // MARK: Writes

    /// Adds an inflow, then reloads.
    func create(_ input: InflowInput) async throws {
        let household = state.value?.rows.members.first?.householdId
        if planning.isActive {
            guard let household else { throw NestError(.invalidRequest) }
            planning.create(.inflows, row: Self.sandboxRow(input, household: household, now: now()))
            await load()
            return
        }
        guard let household else { throw NestError(.invalidRequest) }
        try await data.insert(Inflow.self, values: input.insertValues(householdID: household))
        await load()
    }

    /// Saves `input` over the inflow `id`, then reloads.
    func update(id: String, _ input: InflowInput) async throws {
        if planning.isActive {
            planning.update(.inflows, id: id, patch: PlanningLayer.json(of: input) ?? [:])
            await load()
            return
        }
        try await data.update(Inflow.self, values: input, filters: [.eq("id", id)])
        await load()
    }

    /// Removes the inflow `id`, then reloads.
    func delete(id: String) async throws {
        if planning.isActive {
            planning.delete(.inflows, id: id)
            await load()
            return
        }
        try await data.delete(Inflow.self, filters: [.eq("id", id)])
        await load()
    }

    /// A whole inflow row for the sandbox: the input's columns plus the ones the
    /// database would set.
    static func sandboxRow(_ input: InflowInput, household: String, now: Date) -> JSONRow {
        var row = PlanningLayer.json(of: input) ?? [:]
        let stamp = now.formatted(.iso8601)
        row["id"] = .string(UUID().uuidString.lowercased())
        row["household_id"] = .string(household)
        row["created_at"] = .string(stamp)
        row["updated_at"] = .string(stamp)
        return row
    }
}
