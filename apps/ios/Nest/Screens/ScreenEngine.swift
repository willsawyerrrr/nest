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

    static func taxScreen(_ input: TaxScreenInput) async throws -> TaxScreenFigures {
        do { return try await shared.value.taxScreen(input) } catch { throw NestError(.unknown) }
    }

    static func salarySacrifice(_ input: SalarySacrificeInput) async throws
        -> SalarySacrificeResult
    {
        do { return try await shared.value.salarySacrifice(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func mlsWhatIf(_ input: DependentChildrenInput) async throws -> FamilyMlsFigures {
        do { return try await shared.value.mlsWhatIf(input) } catch { throw NestError(.unknown) }
    }

    static func householdYear(_ input: DependentChildrenInput) async throws
        -> HouseholdYearFigures
    {
        do { return try await shared.value.householdYear(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func summariseInflows(_ input: InflowsInput) async throws -> InflowFortnightlies {
        do { return try await shared.value.summariseInflows(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func previewInflowDraft(_ input: InflowDraftInput) async throws -> InflowDraftPreview {
        do { return try await shared.value.previewInflowDraft(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func paySplitRoutes(_ input: PaySplitRoutesInput) async throws -> PaySplitRoutes {
        do { return try await shared.value.paySplitRoutes(input) } catch { throw NestError(.unknown) }
    }

    static func payslipsOverview(_ input: PayslipsInput) async throws -> PayslipsOverview {
        do { return try await shared.value.payslipsOverview(input) } catch {
            throw NestError(.unknown)
        }
    }
    static func deductionFigures(_ input: DeductionFiguresInput) async throws -> DeductionFigures {
        do { return try await shared.value.deductionFigures(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func financialYearOptions(_ input: FinancialYearOptionsInput) async throws
        -> FinancialYearOptions
    {
        do { return try await shared.value.financialYearOptions(input) } catch {
            throw NestError(.unknown)
        }
    }

    /// The Deductions form's figures; a failed engine call leaves them at zero.
    static func figures(_ input: DeductionFiguresInput) async -> DeductionFigures {
        (try? await deductionFigures(input)) ?? .zero
    }

    static func summariseEquity(_ input: EquityInput) async throws -> [GrantFigures] {
        do { return try await shared.value.summariseEquity(input) } catch {
            throw NestError(.unknown)
        }
    }

    static func netWorth(_ input: NetWorthInput) async throws -> NetWorthOutcome {
        do { return try await shared.value.netWorth(input) } catch {
            throw NestError(.unknown)
        }
    }
}
