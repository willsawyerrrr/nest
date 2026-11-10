import Foundation
import SwiftUI

/// A top-level section of the nav, mirroring the PWA's `NAV_SECTIONS` groups.
enum NavSection: CaseIterable, Identifiable, Hashable {
    case summary, plan, grow, tax, settings

    var id: Self { self }

    var title: String {
        switch self {
        case .summary: "Summary"
        case .plan: "Plan"
        case .grow: "Grow"
        case .tax: "Tax"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .summary: "chart.pie"
        case .plan: "list.bullet.rectangle"
        case .grow: "chart.line.uptrend.xyaxis"
        case .tax: "doc.text"
        case .settings: "gearshape"
        }
    }

    /// The section's routes in display order.
    var routes: [Route] { Route.allCases.filter { $0.section == self } }
}

/// What a route renders: a native screen, or the PWA page at a path.
enum RouteContent {
    case native(AnyView)
    case web(path: String)
}

/// Every destination the PWA serves, keyed by its path. Screens migrate one at
/// a time: a route moves from `.web` to `.native` in `content`.
enum Route: String, CaseIterable, Identifiable, Hashable {
    case summary = "/summary"
    case inflows = "/inflows"
    case budget = "/budget"
    case breakdowns = "/breakdowns"
    case gifts = "/gifts"
    case splits = "/splits"
    case netWorth = "/net-worth"
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
        case .planning: "Planning"
        case .allowance: "Allowance"
        case .whatsNew: "What's new"
        }
    }

    /// The nav section holding the route; `nil` for routes outside the nav.
    var section: NavSection? {
        switch self {
        case .summary: .summary
        case .inflows, .budget, .breakdowns, .gifts, .splits: .plan
        case .netWorth, .goals, .wishlist, .superannuation, .equity, .investments: .grow
        case .tax, .payslips, .deductions, .helpDebt, .eofy: .tax
        case .household, .members, .connections, .notifications, .planningMode: .settings
        case .planning, .allowance, .whatsNew: nil
        }
    }

    /// The route's renderer: its native screen, or the web fallback for a route
    /// not yet migrated.
    var content: RouteContent {
        switch self {
        case .summary: .native(AnyView(SummaryScreen()))
        case .breakdowns: .native(AnyView(BreakdownsScreen()))
        case .budget: .native(AnyView(BudgetScreen()))
        case .allowance: .native(AnyView(AllowanceScreen()))
        case .planning: .native(AnyView(PlanningScreen()))
        case .planningMode: .native(AnyView(PlanningModeScreen()))
        case .wishlist: .native(AnyView(WishlistScreen()))
        default: .web(path: path)
        }
    }

    /// The web page for `path` under `base`.
    static func url(forPath path: String, base: URL = WebApp.url) -> URL {
        URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }

    /// The route's web page.
    var url: URL { Self.url(forPath: path) }
}
