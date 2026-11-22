import Foundation
import Testing

@testable import Nest

/// Synthetic receipt text only.
@Suite struct ReceiptCheckTests {
    static let receipt = """
        OFFICEWORKS
        Tax Invoice
        ABN 11 222 333 444
        Date 06/07/2025
        Ergonomic chair        $1,124.50
        Total (incl GST $102.23) $1,124.50
        """

    private func doubts(_ raw: RawReceiptFields, text: String = receipt, year: Int = 2026) -> [String] {
        ReceiptCheck.doubts(raw, in: text, financialYear: year)
    }

    private let good = RawReceiptFields(
        isReceipt: true, description: "Officeworks", deductionDate: "06/07/2025", amount: "$1,124.50")

    @Test func aGroundedReadingHasNoDoubts() {
        #expect(doubts(good).isEmpty)
    }

    @Test func aFieldTheReceiptDoesNotShowIsNotADoubt() {
        let raw = RawReceiptFields(isReceipt: true, amount: "$1,124.50")
        #expect(doubts(raw).isEmpty)
    }

    @Test func aReadingWithNoAmountIsDoubtful() {
        let raw = RawReceiptFields(isReceipt: true, description: "Officeworks")
        #expect(doubts(raw) == ["no amount was read"])
    }

    @Test func aDocumentThatDoesNotLookLikeAReceiptIsDoubtful() {
        let letter = "Riverside Community Library\nMembership renewal\nExpires 30/06/2026"
        let raw = RawReceiptFields(isReceipt: true, description: "Riverside Community Library", amount: "30.00")
        #expect(doubts(raw, text: letter).contains("the document does not look like a receipt"))
        let statement = "Example Bank\nOpening balance $2,310.55\nClosing balance $2,845.10 total"
        let bank = RawReceiptFields(isReceipt: true, description: "Example Bank", amount: "$2,845.10")
        #expect(doubts(bank, text: statement).contains("the document does not look like a receipt"))
    }

    @Test func anAmountNotInTheDocumentIsDoubtful() {
        let raw = RawReceiptFields(isReceipt: true, description: "Officeworks", amount: "$1,142.50")
        #expect(doubts(raw) == ["amount is not in the document"])
    }

    @Test func anAmountMayDropTheCurrencySign() {
        let raw = RawReceiptFields(isReceipt: true, amount: "1,124.50")
        #expect(doubts(raw).isEmpty)
    }

    @Test func aDescriptionNotInTheDocumentIsDoubtful() {
        let raw = RawReceiptFields(isReceipt: true, description: "Bunnings", amount: "$1,124.50")
        #expect(doubts(raw) == ["description is not in the document"])
    }

    @Test func aTransposedDayAndMonthIsDoubtful() {
        let raw = RawReceiptFields(isReceipt: true, deductionDate: "07/06/2025", amount: "$1,124.50")
        #expect(doubts(raw) == ["deduction_date is not in the document"])
    }

    @Test func aYearlessDateInsideTheFinancialYearIsGrounded() {
        let text = "Cafe Roma\n12 Mar\nTotal 18.00"
        let raw = RawReceiptFields(isReceipt: true, deductionDate: "12 Mar", amount: "18.00")
        #expect(doubts(raw, text: text).isEmpty)
    }

    @Test func aMonthNameGroundsTheMonth() {
        let text = "Total 5.00\n6 July 2025"
        let raw = RawReceiptFields(isReceipt: true, deductionDate: "6 July 2025", amount: "5.00")
        #expect(doubts(raw, text: text).isEmpty)
        let converted = RawReceiptFields(isReceipt: true, deductionDate: "2025-07-06", amount: "5.00")
        #expect(doubts(converted, text: text).isEmpty)
        let wrongMonth = RawReceiptFields(isReceipt: true, deductionDate: "2025-08-06", amount: "5.00")
        #expect(doubts(wrongMonth, text: text) == ["deduction_date is not in the document"])
    }

    @Test func aConvertedDateMustMatchTheOrderPrinted() {
        let raw = RawReceiptFields(isReceipt: true, deductionDate: "2025-06-07", amount: "$1,124.50")
        #expect(doubts(raw) == ["deduction_date is not in the document"])
        let right = RawReceiptFields(isReceipt: true, deductionDate: "2025-07-06", amount: "$1,124.50")
        #expect(doubts(right).isEmpty)
    }

    @Test func unconvertibleTextIsDoubtful() {
        let raw = RawReceiptFields(isReceipt: true, description: "Officeworks", amount: "1,124.5O")
        #expect(doubts(raw).contains("amount_cents could not be converted"))
    }

    @Test func aNegativeAmountIsDoubtful() {
        let text = "Refund (45.00)"
        let raw = RawReceiptFields(isReceipt: true, amount: "(45.00)")
        #expect(doubts(raw, text: text + " total") == ["amount_cents is negative"])
    }

    @Test func anEmptyReadingIsDoubtful() {
        #expect(doubts(RawReceiptFields(isReceipt: true)) == ["no amount was read"])
    }
}
