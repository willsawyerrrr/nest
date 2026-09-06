import AppIntents

/// Registers the buffer query as a zero-configuration App Shortcut, so its
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
    }
}
