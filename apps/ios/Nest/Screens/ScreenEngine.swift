import Foundation

/// The app's one `Engine`, created on first use. A failure to load the bundle is
/// reported to the screen as an unknown error.
enum ScreenEngine {
    static let shared = Task { try Engine() }

    static func summarise(_ input: SummaryInput) async throws -> BudgetSummary {
        do { return try await shared.value.summariseHousehold(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func summariseBreakdowns(_ input: BreakdownsInput) async throws -> BreakdownRollups {
        do { return try await shared.value.summariseBreakdowns(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func budgetOverview(_ input: BudgetOverviewInput) async throws -> BudgetOverview {
        do { return try await shared.value.budgetOverview(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func projectGoalQueue(_ input: GoalQueueInput) async throws -> GoalQueueProjection {
        do { return try await shared.value.projectGoalQueue(input) } catch {
            throw NestError(.unknown)
        }
    }
}
