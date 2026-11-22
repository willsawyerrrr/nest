import AppIntents

/// The native screens an App Shortcut can open, each a `Route`.
enum ScreenShortcut: String, AppEnum, CaseIterable {
    case summary, transactionReview, gifts, goals, budget

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Screen"

    static let caseDisplayRepresentations: [ScreenShortcut: DisplayRepresentation] = [
        .summary: "Summary",
        .transactionReview: "Transactions to review",
        .gifts: "Gifts",
        .goals: "Savings goals",
        .budget: "Budget",
    ]

    var route: Route {
        switch self {
        case .summary: .summary
        case .transactionReview: .transactionReview
        case .gifts: .gifts
        case .goals: .goals
        case .budget: .budget
        }
    }
}

/// Opens Nest on one of its native screens, through the same router a tapped
/// notification uses, so a cold launch shows the screen once the member is
/// signed in.
struct OpenScreenIntent: AppIntent {
    static let title: LocalizedStringResource = "Open a Screen"
    static let description = IntentDescription("Open a screen in Nest.")
    static let openAppWhenRun = true

    @Parameter(title: "Screen")
    var screen: ScreenShortcut

    init() {}

    init(screen: ScreenShortcut) {
        self.screen = screen
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationRouter.shared.open(NotificationDestination(route: screen.route))
        return .result()
    }
}
