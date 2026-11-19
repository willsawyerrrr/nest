import Foundation
import Observation

/// What the Budget and Allowance screens render once loaded.
struct BudgetContent: Equatable, Sendable {
    let rows: BudgetRows
    let overview: BudgetOverview
    /// The signed-in member, the only one whose allowance shows what is drawn.
    let currentMemberID: String?
    let now: Date
}

/// Loads the household's budget rows through the cache, runs the figures in the
/// engine and publishes the result. Budget and Allowance share it: each screen
/// projects `BudgetContent` its own way. Budget-line writes go to the database,
/// or into the planning sandbox while planning mode is on; allowances and
/// breakdowns are not sandboxed, so their writes are always real.
@MainActor @Observable
final class BudgetViewModel {
    private(set) var state: ScreenState<BudgetContent> = .loading

    private let data: NestData
    private let overview: @Sendable (BudgetOverviewInput) async throws -> BudgetOverview
    private let now: @Sendable () -> Date
    private let planning: PlanningStore

    init(
        data: NestData = .live,
        overview: @escaping @Sendable (BudgetOverviewInput) async throws -> BudgetOverview =
            ScreenEngine.budgetOverview,
        now: @escaping @Sendable () -> Date = Date.init,
        planning: PlanningStore = .shared
    ) {
        self.planning = planning
        self.data = data
        self.overview = overview
        self.now = now
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let instant = now()
        let userID = try? await data.userID()
        let stream = RowsCombiner.stream(
            initial: BudgetRows(),
            sources: BudgetRows.sources(financialYear: FinancialYear.containing(instant)),
            data: data)
        do {
            for try await snapshot in stream {
                planning.select(household: snapshot.rows.members.first?.householdId)
                let rows =
                    planning.state.active ? snapshot.rows.sandboxed(by: planning.state) : snapshot.rows
                let figures = try await overview(rows.input(now: instant))
                let content = BudgetContent(
                    rows: rows, overview: figures,
                    currentMemberID: rows.members.first { $0.userId == userID }?.id,
                    now: instant)
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

    /// Whether planning mode is on, where a derived line is read-only: its edit
    /// writes a breakdown, which the sandbox does not cover.
    var isPlanning: Bool { planning.isActive }

    // MARK: Writes

    /// Adds a manual budget line, then reloads.
    func createLine(_ input: BudgetLineInput) async throws {
        guard let household = state.value?.rows.members.first?.householdId else {
            throw NestError(.invalidRequest)
        }
        if planning.isActive {
            planning.create(
                .budgetLine, row: Self.sandboxRow(input, household: household, now: now()))
        } else {
            try await data.insert(BudgetLine.self, values: input.insertValues(householdID: household))
        }
        await load()
    }

    /// Saves `input` over the line `id`, then reloads.
    func updateLine(id: String, _ input: BudgetLineInput) async throws {
        if planning.isActive {
            planning.update(.budgetLine, id: id, patch: PlanningLayer.json(of: input) ?? [:])
        } else {
            try await data.update(BudgetLine.self, values: input, filters: [.eq("id", id)])
        }
        await load()
    }

    /// Removes the line `id`, then reloads.
    func deleteLine(id: String) async throws {
        if planning.isActive {
            planning.delete(.budgetLine, id: id)
        } else {
            try await data.delete(BudgetLine.self, filters: [.eq("id", id)])
        }
        await load()
    }

    /// Saves a derived line's edit, as the PWA's `useDerivedLineEditor`: a generic
    /// line's name and group go to its breakdown and the line, a gift line's group
    /// to the line alone (its name stays partition-derived), and the funding
    /// account to the line unless a gift member line's reconcile owns it.
    func updateDerivedLine(_ line: BudgetLine, _ values: DerivedLineValues) async throws {
        guard line.isGiftLine || line.breakdownId != nil else { return }
        if !line.isGiftLine, let breakdown = line.breakdownId {
            try await data.update(
                Breakdown.self, values: BreakdownPatch(name: values.name, lineGroup: values.group),
                filters: [.eq("id", breakdown)], also: [BudgetLine.table])
        }
        var input = BudgetLineInput(line)
        input.lineGroup = values.group
        if !line.isGiftLine { input.name = values.name }
        if line.giftRecipientMemberId == nil { input.destinationAccountId = values.destinationAccountId }
        try await data.update(BudgetLine.self, values: input, filters: [.eq("id", line.id)])
        await load()
    }

    /// Saves `input` over the allowance `id`, then reloads.
    func updateAllowance(id: String, _ input: MemberAllowanceInput) async throws {
        try await data.update(MemberAllowance.self, values: input, filters: [.eq("id", id)])
        await load()
    }

    /// A whole budget line row for the sandbox: the input's columns plus the ones
    /// the database would set.
    static func sandboxRow(_ input: BudgetLineInput, household: String, now: Date) -> JSONRow {
        var row = PlanningLayer.json(of: input) ?? [:]
        let stamp = now.formatted(.iso8601)
        row["id"] = .string(UUID().uuidString.lowercased())
        row["household_id"] = .string(household)
        row["created_at"] = .string(stamp)
        row["updated_at"] = .string(stamp)
        return row
    }
}

/// The breakdown columns a generic derived line's edit writes.
private struct BreakdownPatch: Encodable, Sendable {
    let name: String
    let lineGroup: BudgetGroup

    enum CodingKeys: String, CodingKey {
        case name
        case lineGroup = "line_group"
    }
}
