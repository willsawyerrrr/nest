import CoreSpotlight
import Foundation
import Testing

@testable import Nest

private func line(
    _ name: String,
    id: String? = nil,
    cents: Int = 200_00,
    frequency: String = "weekly",
    intervalCount: Int? = nil
) -> BudgetLineMatch {
    BudgetLineMatch(
        id: id ?? name.lowercased(), name: name, amountCents: cents, frequency: frequency,
        intervalCount: intervalCount, fortnightlyCents: 0, annualCents: 0
    )
}

@Suite struct BudgetLineMatchingTests {
    private let lines = [line("Groceries"), line("Rent & rates"), line("Rent"), line("Car rental")]

    @Test func matchesAnExactNameIgnoringCaseAndSpacing() {
        #expect(BudgetLineMatching.filter(lines, matching: "  GROCERIES ").map(\.name) == ["Groceries"])
    }

    @Test func listsExactThenShortestContainingNames() {
        #expect(
            BudgetLineMatching.filter(lines, matching: "rent").map(\.name)
                == ["Rent", "Car rental", "Rent & rates"]
        )
    }

    @Test func matchesWhenTheNameIsInsideTheSpokenQuery() {
        #expect(
            BudgetLineMatching.filter([line("Gym")], matching: "my gym membership").map(\.name)
                == ["Gym"]
        )
    }

    @Test func matchesNothingForAnEmptyQueryOrNoMatch() {
        #expect(BudgetLineMatching.filter(lines, matching: "   ").isEmpty)
        #expect(BudgetLineMatching.filter(lines, matching: "holidays").isEmpty)
        #expect(BudgetLineMatching.filter([], matching: "rent").isEmpty)
    }
}

@Suite struct BudgetLineEntityTests {
    @Test func carriesTheLineAmountAndCadence() {
        let entity = BudgetLineEntity(line("Groceries", id: "l1", cents: 200_50, frequency: "weekly"))

        #expect(entity.id == "l1")
        #expect(entity.name == "Groceries")
        #expect(entity.plannedAmount == 200.50)
        #expect(entity.cadence == "per week")
    }

    @Test func readsAnIntervalCadence() {
        #expect(
            BudgetLinePhrasing.cadence(frequency: "every_n_weeks", intervalCount: 4) == "every 4 weeks"
        )
        #expect(BudgetLinePhrasing.cadence(frequency: "biannual", intervalCount: nil) == "twice a year")
    }
}

@Suite struct BudgetLineLoadTests {
    private func service(returning json: String) -> BudgetLineService {
        BudgetLineService { request in
            (
                Data(json.utf8),
                HTTPURLResponse(
                    url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
                )!
            )
        }
    }

    @Test func returnsEveryLine() async {
        let load = await budgetLineLoad(
            accessToken: { "t" },
            service: service(
                returning: #"""
                {"match":null,"lines":[{"id":"l1","name":"Groceries","amountCents":20000,
                "frequency":"weekly","intervalCount":null,"fortnightlyCents":40000,
                "annualCents":1040000}],"names":["Groceries"]}
                """#
            )
        )

        guard case .lines(let lines) = load else { Issue.record("expected lines"); return }
        #expect(lines.map(\.id) == ["l1"])
    }

    @Test func foldsAMissingSessionAndAnUnreachableServiceIntoCases() async {
        struct NoSession: Error {}
        let failing = BudgetLineService { _ in throw BudgetLineServiceError.http(status: 500) }
        let unauthorised = BudgetLineService { _ in throw BudgetLineServiceError.http(status: 401) }

        let noSession = await budgetLineLoad(accessToken: { throw NoSession() }, service: failing)
        let expired = await budgetLineLoad(accessToken: { "t" }, service: unauthorised)
        let unreachable = await budgetLineLoad(accessToken: { "t" }, service: failing)

        guard case .signedOut = noSession else { Issue.record("expected signedOut"); return }
        guard case .signedOut = expired else { Issue.record("expected signedOut"); return }
        guard case .unreachable = unreachable else { Issue.record("expected unreachable"); return }
    }
}

@Suite struct SpotlightListingTests {
    @Test func describesABudgetLineWithItsAmount() {
        let listing = SpotlightListing.budgetLine(line("Car service", cents: 300_00, frequency: "every_n_weeks", intervalCount: 26))

        #expect(listing.title == "Car service")
        #expect(listing.summary == "$300.00 every 26 weeks")
        #expect(listing.description == "Budgeted $300.00 every 26 weeks for Car service.")
        #expect(listing.keywords == ["Car service", "Car", "service", "budget", "budget line", "planned spending"])
    }

    @Test func describesAPaySplitAccountWithItsFortnightlyAmount() {
        let listing = SpotlightListing.paySplit(
            PaySplitAccount(accountId: "a1", name: "Japan", fortnightlyCents: 400_00)
        )

        #expect(listing.title == "Japan")
        #expect(listing.summary == "$400.00 per fortnight")
        #expect(listing.description == "$400.00 per fortnight of your pay goes to Japan.")
        #expect(listing.keywords == ["Japan", "pay split", "transfer", "account"])
    }

    @Test func dropsDuplicateKeywordsIgnoringCase() {
        let listing = SpotlightListing.budgetLine(line("Budget"))

        #expect(listing.keywords == ["Budget", "budget line", "planned spending"])
    }

    @Test func buildsTheSpotlightAttributes() {
        let attributes = SpotlightListing.budgetLine(line("Groceries")).attributeSet

        #expect(attributes.contentDescription == "Budgeted $200.00 per week for Groceries.")
        #expect(attributes.keywords?.contains("Groceries") == true)
    }
}
