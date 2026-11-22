import Foundation
import Testing

@testable import Nest

/// Holds the on-device receipt conversion to the server's: `deduction-receipt-parity.json`
/// carries inputs and what `fields.ts` and `money.ts` return for them, and the Swift port
/// must reproduce each exactly. The edge function's `fields_parity_test.ts` runs the same
/// file through the server code.
@Suite struct ReceiptFieldsParityTests {
    struct Fixture: Decodable, Sendable {
        struct Amount: Decodable, Sendable {
            var input: String
            var expected: Int?
        }
        struct Date: Decodable, Sendable {
            var input: String
            var expected: String?
        }
        struct Receipt: Decodable, Sendable {
            struct Input: Decodable, Sendable {
                var is_receipt: Bool
                var not_receipt_reason: String?
                var description: String?
                var deduction_date: String?
                var amount: String?
            }
            struct Expected: Decodable, Equatable, Sendable {
                var isReceipt: Bool
                var notReceiptReason: String?
                var description: String?
                var deductionDate: String?
                var amountCents: Int?
                var missing: [String]
                var unreadable: [String]
            }
            var input: Input
            var expected: Expected
        }
        var amounts: [Amount]
        var dates: [Date]
        var receipts: [Receipt]
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "deduction-receipt-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test func amountsConvertAsTheServerDoes() {
        for item in Self.fixture.amounts {
            #expect(PrintedText.parseCents(item.input) == item.expected, "\(item.input.debugDescription)")
        }
    }

    @Test func datesConvertAsTheServerDoes() {
        for item in Self.fixture.dates {
            #expect(PrintedText.parseIsoDate(item.input) == item.expected, "\(item.input.debugDescription)")
        }
    }

    @Test func receiptsShapeAsTheServerDoes() {
        for item in Self.fixture.receipts {
            let raw = RawReceiptFields(
                isReceipt: item.input.is_receipt, notReceiptReason: item.input.not_receipt_reason,
                description: item.input.description, deductionDate: item.input.deduction_date,
                amount: item.input.amount)
            let reading = raw.reading()
            let actual = Fixture.Receipt.Expected(
                isReceipt: raw.isReceipt, notReceiptReason: raw.notReceiptReason,
                description: reading.description, deductionDate: reading.deductionDate,
                amountCents: reading.amountCents, missing: reading.missing,
                unreadable: reading.unreadable)
            #expect(actual == item.expected, "\(item.input.description ?? "nil")")
        }
    }

    @Test func datesPrintedOnAReceiptConvertWithinTheFinancialYear() {
        let cases: [(String, String?)] = [
            ("06/07/2025", "2025-07-06"), ("6-7-25", "2025-07-06"), ("06.07.2025", "2025-07-06"),
            ("6 July 2025", "2025-07-06"), ("Jul 6, 2025", "2025-07-06"), ("6 Sept 2025", "2025-09-06"),
            ("2025/07/06", "2025-07-06"), ("2025-07-06", "2025-07-06"), ("12 Mar", "2026-03-12"),
            ("12/03", "2026-03-12"), ("20 Aug", "2025-08-20"), ("31/02/2026", nil),
            ("13/13/2025", nil), ("6 Foo 2025", nil), ("July 2025", nil), ("1/2/3/4", nil),
            ("2025-07-06T10:00:00Z", nil), ("yesterday", nil), ("", nil),
        ]
        for (input, expected) in cases {
            #expect(PrintedText.parseDate(input, financialYear: 2026) == expected, "\(input)")
        }
    }

    @Test func aNegativeAmountIsLeftBlankInTheForm() {
        let raw = RawReceiptFields(isReceipt: true, description: "Refund", amount: "(45.00)")
        #expect(raw.reading().amountCents == -4500)
        #expect(raw.reading().extraction.amountCents == nil)
    }
}
