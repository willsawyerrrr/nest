import AppIntents

/// Speaks the household's fortnightly after-saving buffer, computed live by the
/// `intent-summary` edge function. Runs in-process and reads the Keychain
/// session, so it works with the app closed and never opens the app.
struct BufferQueryIntent: AppIntent {
    static let title: LocalizedStringResource = "Check Fortnightly Buffer"
    static let description = IntentDescription(
        "Ask for your household's fortnightly buffer after saving."
    )

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let sentence = await bufferQuerySpokenResponse(
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        return .result(dialog: IntentDialog(stringLiteral: sentence))
    }
}
