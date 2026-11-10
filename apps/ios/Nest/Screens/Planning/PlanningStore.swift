import Foundation
import Observation

/// The planning-mode sandbox of the signed-in household, held on this device.
/// Screens read `state` to layer the sandbox over the real rows; `revision`
/// changes with every mutation so a screen can reload when the sandbox moves.
///
/// The sandbox persists in `UserDefaults` under `planning-mode:<household id>`,
/// so it survives a relaunch. It is separate from the web app's sandbox, which
/// lives in the web view's own storage.
@MainActor @Observable
final class PlanningStore {
    static let shared = PlanningStore()

    private(set) var state = PlanningState.inactive
    private(set) var revision = 0
    private(set) var householdID: String?

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isActive: Bool { state.active }
    var pendingCount: Int { state.pendingCount }

    static func key(_ householdID: String) -> String { "planning-mode:\(householdID)" }

    /// Loads `householdID`'s sandbox when it differs from the one held. Returns
    /// whether the held sandbox changed.
    @discardableResult
    func select(household id: String?) -> Bool {
        guard id != householdID else { return false }
        householdID = id
        state = id.flatMap(read) ?? .inactive
        revision += 1
        return true
    }

    func enter() { commit(PlanningState(active: true)) }

    func exit() {
        if let householdID { defaults.removeObject(forKey: Self.key(householdID)) }
        state = .inactive
        revision += 1
    }

    /// Drops every pending change, staying in planning mode.
    func discard() { commit(PlanningState(active: state.active)) }

    func update(_ table: PlanningTable, id: String, patch: JSONRow) {
        mutate(table) { $0.updating(id, patch: patch) }
    }

    func create(_ table: PlanningTable, row: JSONRow) {
        mutate(table) { $0.creating(row) }
    }

    func delete(_ table: PlanningTable, id: String) {
        mutate(table) { $0.deleting(id) }
    }

    func reset(_ table: PlanningTable, id: String) {
        mutate(table) { $0.resetting(id) }
    }

    private func mutate(_ table: PlanningTable, _ change: (PlanningLayer) -> PlanningLayer) {
        var next = state
        next.overrides[table.rawValue] = change(state.layer(table))
        commit(next)
    }

    private func commit(_ next: PlanningState) {
        state = next
        revision += 1
        guard let householdID, let data = try? JSONEncoder().encode(next) else { return }
        defaults.set(data, forKey: Self.key(householdID))
    }

    private func read(_ householdID: String) -> PlanningState? {
        defaults.data(forKey: Self.key(householdID)).flatMap {
            try? JSONDecoder().decode(PlanningState.self, from: $0)
        }
    }
}

extension SummaryRows {
    /// The rows with the sandbox laid over the three tables it covers.
    func sandboxed(by state: PlanningState) -> SummaryRows {
        var rows = self
        rows.inflows = state.layer(.inflows).apply(to: inflows)
        rows.budgetLines = state.layer(.budgetLine).apply(to: budgetLines)
        rows.savingsGoals = state.layer(.savingsGoal).apply(to: savingsGoals)
        return rows
    }
}

extension BudgetRows {
    /// The rows with the sandbox laid over the three tables it covers.
    func sandboxed(by state: PlanningState) -> BudgetRows {
        var rows = self
        rows.budgetLines = state.layer(.budgetLine).apply(to: budgetLines)
        rows.savingsGoals = state.layer(.savingsGoal).apply(to: savingsGoals)
        return rows
    }
}
