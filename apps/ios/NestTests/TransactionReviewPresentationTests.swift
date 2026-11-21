import Foundation
import Testing

@testable import Nest

@Suite struct TransactionReviewPresentationTests {
    private let categories = [
        UpCategory(id: "good-life", name: "Good Life", parentId: nil),
        UpCategory(id: "home", name: "Home", parentId: nil),
        UpCategory(id: "empty", name: "Empty", parentId: nil),
        UpCategory(id: "restaurants-and-cafes", name: "Restaurants & Cafes", parentId: "good-life"),
        UpCategory(id: "gifts-and-charity", name: "Gifts & Charity", parentId: "good-life"),
        UpCategory(id: "groceries", name: "Groceries", parentId: "home"),
    ]

    private func transaction(_ json: String) throws -> LedgerTransaction {
        try JSONDecoder().decode(LedgerTransaction.self, from: Data(json.utf8))
    }

    @Test func groupsChildCategoriesUnderTheirParentsAlphabetically() {
        let groups = TransactionReviewPresentation.groups(categories)
        #expect(groups.map(\.name) == ["Good Life", "Home"])
        #expect(groups[0].items.map(\.id) == ["gifts-and-charity", "restaurants-and-cafes"])
    }

    @Test func labelsACategoryParentFirst() {
        #expect(TransactionReviewPresentation.label(categories, "groceries") == "Home › Groceries")
        #expect(TransactionReviewPresentation.label(categories, nil) == nil)
        #expect(TransactionReviewPresentation.label(categories, "mystery") == "mystery")
        #expect(
            TransactionReviewPresentation.label(
                [UpCategory(id: "c", name: "Child", parentId: "gone")], "c") == "Child")
        #expect(TransactionReviewPresentation.pickerLabel(categories, "groceries") == "Groceries")
        #expect(TransactionReviewPresentation.pickerLabel(categories, nil) == "Uncategorised")
    }

    @Test func summarisesARow() throws {
        let row = TransactionReviewPresentation.row(
            try transaction(ReviewFixtures.transaction("t1", status: "pending")),
            categories: categories, accountName: "Spending",
            calendar: Calendar(identifier: .gregorian))
        #expect(row.title == "Cafe Lune")
        #expect(row.category == "Good Life › Restaurants & Cafes")
        #expect(row.pending)
        #expect(!row.reviewed && row.categorisable && !row.isGift)
        #expect(row.upNote == "Brunch")
        #expect(row.upMessage == nil)
        #expect(row.deepLink == URL(string: "up://transaction/t1"))
    }

    @Test func namesAnUnnamedUncategorisedGiftPlainly() throws {
        let unnamed = TransactionReviewPresentation.row(
            try transaction(ReviewFixtures.transaction("t1", description: "", category: nil)),
            categories: categories, accountName: nil)
        #expect(unnamed.title == "Card purchase")
        #expect(unnamed.category == "Uncategorised")
        let gift = TransactionReviewPresentation.row(
            try transaction(ReviewFixtures.transaction("t2", category: "gifts-and-charity")),
            categories: categories, accountName: nil)
        #expect(gift.isGift)
    }

    @Test func doesNotRepeatAFocusedTransactionAlreadyListedAndSaysWhenCapped() throws {
        let one = try transaction(ReviewFixtures.transaction("t1"))
        var rows = TransactionReviewRows(transactions: [one], focused: [one])
        #expect(TransactionReviewPresentation(rows: rows).rows.count == 1)
        #expect(!TransactionReviewPresentation(rows: rows).isCapped)
        rows.transactions = Array(repeating: one, count: TransactionReviewRows.pageSize)
        #expect(TransactionReviewPresentation(rows: rows).isCapped)
    }

    @Test func rendersOurOwnCopyPerCode() {
        #expect(
            TransactionReviewPresentation.errorMessage("up_rate_limited")
                == "Up is busy right now. Try again in a minute.")
        #expect(
            TransactionReviewPresentation.errorMessage("up_not_connected")
                == "Connect Up in Connections to change a category.")
        #expect(
            TransactionReviewPresentation.errorMessage(nil) == "Could not save this review. Try again.")
        #expect(TransactionReviewPresentation.needsConnections("up_auth_failed"))
        #expect(!TransactionReviewPresentation.needsConnections("up_rejected"))
    }

    @Test func acceptsOnlyAUUIDAsTheFocus() {
        #expect(
            TransactionReviewRows.validFocusID("11111111-2222-3333-4444-555555555555")
                == "11111111-2222-3333-4444-555555555555")
        #expect(TransactionReviewRows.validFocusID("nope") == nil)
        #expect(TransactionReviewRows.validFocusID(nil) == nil)
    }
}
