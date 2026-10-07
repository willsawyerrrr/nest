import AppIntents

/// One account's recommended fortnightly pay split, as a result other shortcuts
/// can use. Looked up again by id through `PaySplitEntityQuery`.
struct PaySplitEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Pay split")
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

/// Resolves pay-split entities by account id from the live `pay-split` response,
/// so a shortcut holding one gets the current figure rather than a stale copy.
struct PaySplitEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [PaySplitEntity] {
        let outcome = await paySplitResponse(
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        return outcome.splits.filter { identifiers.contains($0.accountId) }.map(PaySplitEntity.init)
    }
}

/// Speaks the household's recommended fortnightly pay split — what to send to
/// each account — from the `pay-split` edge function, and returns each account's
/// amount for use in other shortcuts. Runs in-process and reads the Keychain
/// session, so it works with the app closed and never opens the app.
struct PaySplitIntent: AppIntent {
    static let title: LocalizedStringResource = "Check Pay Split"
    static let description = IntentDescription(
        "Ask how much to send to each account from your pay each fortnight."
    )

    func perform() async throws -> some IntentResult & ReturnsValue<[PaySplitEntity]> & ProvidesDialog {
        let outcome = await paySplitResponse(
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        return .result(
            value: outcome.splits.map(PaySplitEntity.init),
            dialog: IntentDialog(stringLiteral: outcome.sentence)
        )
    }
}
