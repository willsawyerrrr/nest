import Foundation
import Testing

@testable import Nest

struct AccountsPresentationTests {
    private func account(
        _ id: String, _ name: String, _ type: String, cents: Int, owner: String? = nil,
        source: String = "up", deleted: Bool = false, excluded: Bool = false
    ) -> String {
        """
        {"id":"\(id)","household_id":"h","name":"\(name)","type":"\(type)","source":"\(source)",\
        "balance_cents":\(cents),"owner_member_id":\(owner.map { "\"\($0)\"" } ?? "null"),\
        "exclude_from_net_worth":\(excluded),"deleted_from_source_at":\(deleted ? "\"2026-10-01\"" : "null"),\
        "external_id":null,"currency":"AUD","created_at":"","updated_at":""}
        """
    }

    private func rows(_ accounts: [String]) throws -> AccountsRows {
        let members = """
            [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
            "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
            "created_at":"","updated_at":""}]
            """
        let decoder = JSONDecoder()
        return AccountsRows(
            accounts: try decoder.decode(
                [AccountWithBalance].self, from: Data("[\(accounts.joined(separator: ","))]".utf8)),
            members: try decoder.decode([Member].self, from: Data(members.utf8)))
    }

    @Test func labelsEveryTypeAndSource() {
        #expect(
            AccountType.displayOrder.map(\.label)
                == ["Spending", "Savings", "Offset", "Credit", "Home loan", "Other"])
        #expect(LedgerSource.allCases.map(\.label) == ["Up", "Manual", "Redbark"])
    }

    @Test func groupsByTypeInDisplayOrderWithTotals() throws {
        let presentation = AccountsPresentation(
            rows: try rows([
                account("l", "Home loan", "home_loan", cents: -400_000_00, source: "redbark"),
                account("b", "Bills", "savings", cents: 2_000_00),
                account("a", "Holiday", "savings", cents: 500_00, excluded: true),
                account("s", "💳 Alex's Spending", "transaction", cents: 120_00, owner: "m1"),
            ]))
        #expect(presentation.groups.map(\.label) == ["Spending", "Savings", "Home loan"])
        #expect(presentation.groups.map { $0.rows.map(\.id) } == [["s"], ["b", "a"], ["l"]])
        #expect(presentation.groups.map(\.totalCents) == [120_00, 2_500_00, -400_000_00])
    }

    @Test func describesEachAccount() throws {
        let presentation = AccountsPresentation(
            rows: try rows([
                account("s", "💳 Alex's Spending", "transaction", cents: 120_00, owner: "m1"),
                account(
                    "o", "Old", "other", cents: 0, owner: "gone", source: "manual", deleted: true,
                    excluded: true),
                account("j", "Joint", "savings", cents: 0),
            ]))
        let byID = Dictionary(
            uniqueKeysWithValues: presentation.groups.flatMap(\.rows).map { ($0.id, $0) })
        #expect(byID["s"]?.label == "Alex's Spending")
        #expect(byID["s"]?.emoji == "💳")
        #expect(byID["s"]?.owner == "Alex")
        #expect(byID["s"]?.source == "Up")
        #expect(byID["j"]?.owner == "Joint")
        #expect(byID["o"]?.owner == "Unknown")
        #expect(byID["o"]?.source == "Manual")
        #expect(byID["o"]?.isDeleted == true && byID["o"]?.isExcluded == true)
        #expect(byID["s"]?.isDeleted == false && byID["s"]?.isExcluded == false)
    }

    @Test func noAccountsIsNoGroups() throws {
        #expect(AccountsPresentation(rows: try rows([])).groups.isEmpty)
    }
}
