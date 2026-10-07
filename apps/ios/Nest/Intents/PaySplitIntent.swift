import AppIntents

/// One account's recommended fortnightly pay split, as the intent's account
/// parameter and as a result other shortcuts can use. Resolved by id from the
/// live `pay-split` response through `PaySplitEntityQuery`.
struct PaySplitEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Account")
    static let defaultQuery = PaySplitEntityQuery()

    let id: String

    @Property(title: "Account")
    var name: String

    @Property(title: "Fortnightly amount")
    var fortnightlyAmount: Double

    init(_ account: PaySplitAccount) {
        id = account.accountId
        name = account.name
        fortnightlyAmount = Double(account.fortnightlyCents) / 100
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(BufferPhrasing.currency(Int((fortnightlyAmount * 100).rounded()))) per fortnight"
        )
    }
}

/// Offers and resolves the household's accounts that pay is split into, from the
/// live `pay-split` response. Signed out or unreachable, it offers none.
struct PaySplitEntityQuery: EntityQuery {
    private func splits() async -> [PaySplitAccount] {
        let load = await paySplitLoad(
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        guard case .summary(let summary) = load else { return [] }
        return summary.splits
    }

    func entities(for identifiers: [String]) async throws -> [PaySplitEntity] {
        await splits().filter { identifiers.contains($0.accountId) }.map(PaySplitEntity.init)
    }

    func suggestedEntities() async throws -> [PaySplitEntity] {
        await splits().map(PaySplitEntity.init)
    }
}

/// Speaks how much of the household's fortnightly pay goes to one account, from
/// the `pay-split` edge function, and returns that account's split for use in
/// other shortcuts. Runs in-process and reads the Keychain session, so it works
/// with the app closed and never opens the app.
struct PaySplitIntent: AppIntent {
    static let title: LocalizedStringResource = "Check Pay Split"
    static let description = IntentDescription(
        "Ask how much of your pay goes to one account each fortnight."
    )

    @Parameter(title: "Account", requestValueDialog: "Which account?")
    var account: PaySplitEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Check the pay split for \(\.$account)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<PaySplitEntity?> & ProvidesDialog {
        let outcome = await paySplitResponse(
            accountId: account.id,
            name: account.name,
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        return .result(
            value: outcome.split.map(PaySplitEntity.init),
            dialog: IntentDialog(stringLiteral: outcome.sentence)
        )
    }
}
