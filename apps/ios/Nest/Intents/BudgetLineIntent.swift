import AppIntents

/// Speaks how much the household has budgeted for a named spending category,
/// from the `budget-line` edge function. Runs in-process and reads the Keychain
/// session, so it works with the app closed and never opens the app.
///
/// The `line` is a `BudgetLineEntity`, so an App Shortcut phrase can name it
/// inline ("How much do we budget for groceries in Nest") and Siri resolves the
/// spoken name against the household's budget lines.
struct BudgetLineIntent: AppIntent {
    static let title: LocalizedStringResource = "Check a Budget"
    static let description = IntentDescription(
        "Ask how much your household has budgeted for a spending category."
    )

    @Parameter(title: "Budget line", requestValueDialog: "Which budget line?")
    var line: BudgetLineEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Check the budget for \(\.$line)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let sentence = await budgetLineSpokenResponse(
            query: line.name,
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        return .result(dialog: IntentDialog(stringLiteral: sentence))
    }
}
