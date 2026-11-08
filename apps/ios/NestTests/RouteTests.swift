import Foundation
import Testing

@testable import Nest

struct RouteTests {
    @Test func pathsAreUniqueAndAbsolute() {
        let paths = Route.allCases.map(\.path)
        #expect(Set(paths).count == paths.count)
        #expect(paths.allSatisfy { $0.hasPrefix("/") })
    }

    @Test func navMirrorsThePWAGroups() {
        #expect(NavSection.summary.routes.map(\.path) == ["/summary"])
        #expect(
            NavSection.plan.routes.map(\.path)
                == ["/inflows", "/budget", "/breakdowns", "/gifts", "/splits"])
        #expect(
            NavSection.grow.routes.map(\.path)
                == ["/net-worth", "/goals", "/wishlist", "/super", "/equity", "/investments"])
        #expect(
            NavSection.tax.routes.map(\.path)
                == ["/tax", "/payslips", "/deductions", "/help-debt", "/eofy"])
        #expect(
            NavSection.settings.routes.map(\.path)
                == [
                    "/settings/account", "/settings/members", "/settings/connections",
                    "/settings/notifications", "/settings/planning-mode",
                ])
    }

    @Test func routesOutsideTheNavHaveNoSection() {
        #expect(Route.allCases.filter { $0.section == nil } == [.planning, .allowance, .whatsNew])
    }

    @Test func nativeRoutesAreTheMigratedScreensAndEveryOtherRouteIsTheWebFallback() {
        let native: Set<Route> = [
            .summary, .breakdowns, .budget, .allowance, .planning, .planningMode,
        ]
        for route in Route.allCases {
            switch route.content {
            case .native:
                #expect(native.contains(route))
            case .web(let path):
                #expect(!native.contains(route))
                #expect(path == route.path)
            }
        }
    }

    @Test func mapsRoutesToWebURLs() {
        let base = URL(string: "https://example.com")!
        #expect(
            Route.url(forPath: "/summary", base: base).absoluteString
                == "https://example.com/summary")
        #expect(
            Route.url(forPath: "/settings/account", base: base).absoluteString
                == "https://example.com/settings/account")
        #expect(Route.budget.url == WebApp.url.appendingPathComponent("budget"))
    }
}
