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
}
