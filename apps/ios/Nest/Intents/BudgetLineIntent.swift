import AppIntents

/// Speaks how much the household has budgeted for a named spending category,
/// from the `budget-line` edge function. Runs in-process and reads the Keychain
/// session, so it works with the app closed and never opens the app.
///
/// The `query` is free text — Siri prompts for it, or a Shortcut fills it — and
/// the edge function matches it against the household's budget line names.
struct BudgetLineIntent: AppIntent {
    static let title: LocalizedStringResource = "Check a Budget"
    static let description = IntentDescription(
        "Ask how much your household has budgeted for a spending category."
    )

    @Parameter(title: "Budget line", requestValueDialog: "Which budget line?")
    var query: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let sentence = await budgetLineSpokenResponse(
            query: query,
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        return .result(dialog: IntentDialog(stringLiteral: sentence))
    }
}
