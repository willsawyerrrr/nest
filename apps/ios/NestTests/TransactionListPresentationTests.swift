import Foundation
import Testing

@testable import Nest

struct TransactionListPresentationTests {
    private func transaction(memberID: String?, customer: String?) throws -> LedgerTransaction {
        func value(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
        let json = ReviewFixtures.transaction("t1")
            .replacingOccurrences(of: "\"member_id\":null", with: "\"member_id\":\(value(memberID))")
            .replacingOccurrences(
                of: "\"performing_customer_name\":null",
                with: "\"performing_customer_name\":\(value(customer))")
        return try JSONDecoder().decode(LedgerTransaction.self, from: Data(json.utf8))
    }

    private var members: [Member] {
        get throws {
            try JSONDecoder().decode(
                [Member].self,
                from: Data(
                    """
                    [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
                    "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\(ReviewFixtures.stamp)}]
                    """.utf8))
        }
    }

    @Test func attributesToTheOwnerOrJoint() throws {
        let members = try members
        #expect(
            TransactionListPresentation.attribution(members, try transaction(memberID: "m1", customer: nil))
                == "Alex")
        #expect(
            TransactionListPresentation.attribution(members, try transaction(memberID: "m9", customer: nil))
                == "Unknown")
        #expect(
            TransactionListPresentation.attribution(members, try transaction(memberID: nil, customer: nil))
                == "Joint")
        #expect(
            TransactionListPresentation.attribution(
                members, try transaction(memberID: nil, customer: "$alex")) == "Joint · $alex")
    }

    @Test func categoryChoicesLeadWithUncategorisedThenEachParentAndItsChildren() throws {
        let categories = try JSONDecoder().decode(
            [UpCategory].self,
            from: Data(
                """
                [{"id":"good-life","name":"Good Life","parent_id":null},\
                {"id":"restaurants-and-cafes","name":"Restaurants & Cafes","parent_id":"good-life"},\
                {"id":"gifts-and-charity","name":"Gifts & Charity","parent_id":"good-life"},\
                {"id":"home","name":"Home","parent_id":null}]
                """.utf8))

        let groups = TransactionListPresentation.categoryOptions(categories)

        #expect(groups.map(\.name) == [nil, "Good Life", "Home"])
        #expect(groups[0].options == [FilterOption(value: "none", label: "Uncategorised")])
        #expect(
            groups[1].options.map(\.label)
                == ["All Good Life", "Gifts & Charity", "Restaurants & Cafes"])
        #expect(groups[2].options.map(\.value) == ["home"])
    }

    @Test func noFiltersNarrowNothing() {
        #expect(!TransactionFilters().isActive)
        #expect(TransactionFilters().query().isEmpty)
        #expect(TransactionFilters(status: "settled").isActive)
    }

    @Test func dayBoundsAreLocalMidnightsInUTC() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Australia/Sydney")!
        #expect(
            TransactionFilters.dayStart("2026-07-01", offset: 0, calendar: calendar)
                == "2026-06-30T14:00:00.000Z")
        #expect(
            TransactionFilters.dayStart("2026-12-31", offset: 1, calendar: calendar)
                == "2026-12-31T13:00:00.000Z")
        #expect(TransactionFilters.dayStart("nope", offset: 0, calendar: calendar) == nil)
    }
}
