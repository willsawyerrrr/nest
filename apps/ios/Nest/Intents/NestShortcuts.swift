import AppIntents

/// Registers the query intents as zero-configuration App Shortcuts, so their
/// phrases reach Siri, Spotlight, and the Shortcuts app on install.
struct NestShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: BufferQueryIntent(),
            phrases: [
                "What's my \(.applicationName) buffer",
                "Check my \(.applicationName) buffer",
                "How is my \(.applicationName) buffer looking",
                "Ask \(.applicationName) about my fortnightly buffer",
            ],
            shortTitle: "Fortnightly buffer",
            systemImageName: "australiandollarsign.circle"
        )
        AppShortcut(
            intent: GoalProgressIntent(),
            phrases: [
                "How are my \(.applicationName) savings goals",
                "Check my \(.applicationName) savings goals",
                "How much have I saved in \(.applicationName)",
                "Ask \(.applicationName) about my savings goals",
            ],
            shortTitle: "Savings goals",
            systemImageName: "target"
        )
        AppShortcut(
            intent: BudgetLineIntent(),
            phrases: [
                "How much have I budgeted in \(.applicationName)",
                "Check a \(.applicationName) budget",
                "Ask \(.applicationName) how much is budgeted",
                "Look up a \(.applicationName) budget",
            ],
            shortTitle: "Budget line",
            systemImageName: "chart.pie"
        )
    }
}
