import Testing

@testable import Nest

@Suite struct GoalProgressPhrasingTests {
    private func summary(
        _ goals: [GoalProgress],
        totalSaved: Int? = nil,
        totalTarget: Int? = nil
    ) -> GoalProgressSummary {
        GoalProgressSummary(
            goals: goals,
            totalSavedCents: totalSaved ?? goals.reduce(0) { $0 + $1.savedCents },
            totalTargetCents: totalTarget ?? goals.reduce(0) { $0 + $1.targetCents }
        )
    }

    @Test func speaksAPromptToSetOneUpWhenThereAreNoGoals() {
        #expect(
            GoalProgressPhrasing.spokenSummary(summary([]))
                == "You haven't set up any savings goals yet."
        )
    }

    @Test func namesTheGoalWhenThereIsExactlyOne() {
        let one = GoalProgress(name: "Japan trip", savedCents: 4_200_00, targetCents: 10_000_00)

        #expect(
            GoalProgressPhrasing.spokenSummary(summary([one]))
                == "You've saved $4,200.00 of $10,000.00 for Japan trip."
        )
    }

    @Test func celebratesAMetSingleGoal() {
        let met = GoalProgress(name: "New laptop", savedCents: 3_000_00, targetCents: 3_000_00)

        #expect(
            GoalProgressPhrasing.spokenSummary(summary([met]))
                == "You've met your New laptop goal — $3,000.00 saved."
        )
    }

    @Test func leadsWithTheFirstUnmetGoalAcrossSeveral() {
        let goals = [
            GoalProgress(name: "Car", savedCents: 8_000_00, targetCents: 8_000_00),
            GoalProgress(name: "House deposit", savedCents: 12_000_00, targetCents: 60_000_00),
            GoalProgress(name: "Holiday", savedCents: 500_00, targetCents: 5_000_00),
        ]

        #expect(
            GoalProgressPhrasing.spokenSummary(summary(goals))
                == "You've saved $20,500.00 of $73,000.00 across 3 goals. "
                    + "House deposit is at $12,000.00 of $60,000.00."
        )
    }

    @Test func celebratesWhenEveryGoalIsMet() {
        let goals = [
            GoalProgress(name: "A", savedCents: 1_000_00, targetCents: 1_000_00),
            GoalProgress(name: "B", savedCents: 2_000_00, targetCents: 2_000_00),
        ]

        #expect(
            GoalProgressPhrasing.spokenSummary(summary(goals))
                == "You've met all 2 of your savings goals — $3,000.00 saved."
        )
    }
}
