import AppIntents

/// Speaks how the household's savings goals are tracking, from the
/// `goal-progress` edge function. Runs in-process and reads the Keychain
/// session, so it works with the app closed and never opens the app.
struct GoalProgressIntent: AppIntent {
    static let title: LocalizedStringResource = "Check Savings Goals"
    static let description = IntentDescription(
        "Ask how your household's savings goals are tracking."
    )

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let sentence = await goalProgressSpokenResponse(
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        return .result(dialog: IntentDialog(stringLiteral: sentence))
    }
}
