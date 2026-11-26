import Foundation
import SwiftUI

/// A top-level section of the nav, mirroring the PWA's `NAV_SECTIONS` groups, plus Review.
enum NavSection: CaseIterable, Identifiable, Hashable {
    case summary, plan, review, grow, tax, settings

    var id: Self { self }

    var title: String {
        switch self {
        case .summary: "Summary"
        case .plan: "Plan"
        case .review: "Review"
        case .grow: "Grow"
        case .tax: "Tax"
        case .settings: "Settings"
        }
    }

    /// The section's routes in display order.
    var routes: [Route] { Route.allCases.filter { $0.section == self } }
}

/// One entry in the nav: a standalone route, or a collapsible group of them.
enum NavEntry: Identifiable, Hashable {
    case item(Route)
    case group(NavSection)

    var id: String {
        switch self {
        case .item(let route): route.id
        case .group(let section): section.title
        }
    }

    /// The nav in display order, as the PWA's `navSections`: Summary stands
    /// alone, every other section is a group (even one holding a single route),
    /// and Planning sits beside Summary while planning mode is on.
    static func entries(planningActive: Bool) -> [NavEntry] {
        NavSection.allCases.flatMap { section -> [NavEntry] in
            guard section != .summary else {
                let items = section.routes.map(NavEntry.item)
                return planningActive ? items + [.item(.planning)] : items
            }
            return [.group(section)]
        }
    }

    /// Every route in display order, each group's routes in place.
    static func flattened(_ entries: [NavEntry]) -> [Route] {
        entries.flatMap { entry -> [Route] in
            switch entry {
            case .item(let route): [route]
            case .group(let section): section.routes
            }
        }
    }
}

/// What a route renders: a native screen, or the PWA page at a path.
enum RouteContent {
    case native(AnyView)
    case web(path: String)
}

/// Every destination the PWA serves, keyed by its path.
enum Route: String, CaseIterable, Identifiable, Hashable {
    case summary = "/summary"
    case inflows = "/inflows"
    case budget = "/budget"
    case breakdowns = "/breakdowns"
    case gifts = "/gifts"
    case splits = "/splits"
    case transactions = "/transactions"
    case transactionReview = "/transactions/review"
    case netWorth = "/net-worth"
    case accounts = "/accounts"
    case goals = "/goals"
    case wishlist = "/wishlist"
    case superannuation = "/super"
    case equity = "/equity"
    case investments = "/investments"
    case tax = "/tax"
    case payslips = "/payslips"
    case deductions = "/deductions"
    case helpDebt = "/help-debt"
    case eofy = "/eofy"
    case household = "/settings/account"
    case members = "/settings/members"
    case connections = "/settings/connections"
    case notifications = "/settings/notifications"
    case planningMode = "/settings/planning-mode"
    case documents = "/settings/documents"
    // Routes outside the primary nav.
    case planning = "/planning"
    case allowance = "/allowance"
    case whatsNew = "/whats-new"

    var id: String { rawValue }

    /// The path on the web app.
    var path: String { rawValue }

    var title: String {
        switch self {
        case .summary: "Summary"
        case .inflows: "Inflows"
        case .budget: "Budget"
        case .breakdowns: "Breakdowns"
        case .gifts: "Gifts"
        case .splits: "Pay splits"
        case .netWorth: "Net worth"
        case .accounts: "Accounts"
        case .goals: "Goals"
        case .wishlist: "Wishlist"
        case .superannuation: "Super"
        case .equity: "Equity"
        case .investments: "Investments"
        case .tax: "Estimate"
        case .payslips: "Payslips"
        case .deductions: "Deductions"
        case .helpDebt: "HELP debt"
        case .eofy: "EOFY"
        case .household: "Household"
        case .members: "Members & tax profiles"
        case .connections: "Connections"
        case .notifications: "Notifications"
        case .planningMode: "Planning mode"
        case .documents: "Documents"
        case .planning: "Planning"
        case .allowance: "Allowance"
        case .whatsNew: "What's new"
        case .transactions: "Transactions"
        case .transactionReview: "To review"
        }
    }

    /// The nav section holding the route; `nil` for routes outside the nav.
    var section: NavSection? {
        switch self {
        case .summary: .summary
        case .inflows, .budget, .breakdowns, .gifts, .splits: .plan
        case .transactions, .transactionReview: .review
        case .netWorth, .accounts, .goals, .wishlist, .superannuation, .equity, .investments: .grow
        case .tax, .payslips, .deductions, .helpDebt, .eofy: .tax
        case .household, .members, .connections, .notifications, .planningMode, .documents: .settings
        case .planning, .allowance, .whatsNew: nil
        }
    }

    /// The route's native screen, opening Goals or Budget with `draft` prefilled
    /// in its add form, and transaction review focused on the transaction `id`.
    @MainActor func content(draft: PromoteDraft? = nil, id: String? = nil) -> RouteContent {
        switch self {
        case .summary: .native(AnyView(SummaryScreen()))
        case .breakdowns: .native(AnyView(BreakdownsScreen()))
        case .inflows: .native(AnyView(InflowsScreen()))
        case .budget: .native(AnyView(BudgetScreen(draft: draft)))
        case .goals: .native(AnyView(GoalsScreen(draft: draft)))
        case .gifts: .native(AnyView(GiftsScreen()))
        case .allowance: .native(AnyView(AllowanceScreen()))
        case .planning: .native(AnyView(PlanningScreen()))
        case .splits: .native(AnyView(SplitsScreen()))
        case .planningMode: .native(AnyView(PlanningModeScreen()))
        case .documents: .native(AnyView(DocumentsSettingsScreen()))
        case .wishlist: .native(AnyView(WishlistScreen()))
        case .household: .native(AnyView(HouseholdScreen()))
        case .netWorth: .native(AnyView(NetWorthScreen()))
        case .accounts: .native(AnyView(AccountsScreen()))
        case .tax: .native(AnyView(TaxScreen()))
        case .eofy: .native(AnyView(EofyScreen()))
        case .payslips: .native(AnyView(PayslipsScreen()))
        case .deductions: .native(AnyView(DeductionsScreen()))
        case .members: .native(AnyView(MembersScreen()))
        case .connections: .native(AnyView(ConnectionsScreen()))
        case .notifications: .native(AnyView(NotificationsScreen()))
        case .whatsNew: .native(AnyView(WhatsNewScreen()))
        case .equity: .native(AnyView(EquityScreen()))
        case .superannuation: .native(AnyView(SuperScreen()))
        case .investments: .native(AnyView(InvestmentsScreen()))
        case .helpDebt: .native(AnyView(HelpDebtScreen()))
        case .transactions: .native(AnyView(TransactionListScreen()))
        case .transactionReview: .native(AnyView(TransactionReviewScreen(focusID: id)))
        }
    }

    /// The web page for `path` under `base`.
    static func url(forPath path: String, base: URL = WebApp.url) -> URL {
        URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }

    /// The route's web page.
    var url: URL { Self.url(forPath: path) }
}
