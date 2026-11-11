import Foundation
import Testing

@testable import Nest

@Suite struct PayslipExtractionTests {
    private func read(_ json: String) -> PayslipExtraction? {
        PayslipExtractionReader.readExtraction(Data(json.utf8))
    }

    @Test func readsFieldsAndLinesAndDropsNegativeTotals() throws {
        let extraction = try #require(
            read(
                """
                {"model":"m","fields":{"period_start":"2026-07-06","gross_cents":500000,
                "tax_withheld_cents":-100,"net_cents":300000,"super_cents":null},
                "lines":{"earnings":[{"label":"Salary","amount_cents":500000},
                {"label":"","amount_cents":1},{"label":"Reversal","amount_cents":-2000},
                {"label":"Odd","amount_cents":1.5}],
                "tax":[{"label":"PAYG","amount_cents":1000,"component":"payg"},
                {"label":"Other","amount_cents":5,"component":"mystery"}]}}
                """))
        #expect(extraction.dates == [.periodStart: "2026-07-06"])
        #expect(extraction.amounts == [.gross: 500_000, .net: 300_000])
        #expect(extraction.earnings.map(\.label) == ["Salary", "Reversal", "Odd"])
        #expect(extraction.earnings.map(\.amountCents) == [500_000, -2_000, nil])
        #expect(extraction.tax.map(\.component) == [.payg, nil])
    }

    @Test func aBodyWithoutAModelIsNotAReading() {
        #expect(read("{}") == nil)
        #expect(read("not json") == nil)
    }

    @Test func readsFailuresIntoTheirOwnStates() {
        func failure(_ json: String?) -> ExtractionOutcome {
            PayslipExtractionReader.readFailure(json.map { Data($0.utf8) })
        }
        #expect(failure(#"{"code":"unsupported_type"}"#)
            == .unsupported(message: PayslipExtractionReader.unsupportedMessage))
        #expect(failure(#"{"configured":false}"#)
            == .notConfigured(message: PayslipExtractionReader.unconfiguredMessage))
        #expect(failure(#"{"outOfCredit":true,"error":"Top up"}"#) == .outOfCredit(message: "Top up"))
        #expect(failure(#"{"keyRejected":true}"#)
            == .keyRejected(message: PayslipExtractionReader.keyRejectedMessage))
        #expect(failure(#"{"notPayslip":true,"reason":"A menu"}"#)
            == .notPayslip(message: PayslipExtractionReader.notPayslipMessage, reason: "A menu"))
        #expect(failure(#"{"error":"Could not resolve household"}"#)
            == .failed(message: PayslipExtractionReader.failedMessage))
        #expect(failure(nil) == .failed(message: PayslipExtractionReader.failedMessage))
    }

    @Test func aReadingThatIsOffHaltsTheQueue() {
        guard case .halt = PayslipExtractionReader.readResult(.outOfCredit(message: "x")) else {
            Issue.record("not halted")
            return
        }
        guard case .failed(let message) = PayslipExtractionReader.readResult(
            .notPayslip(message: "No.", reason: "Menu"))
        else {
            Issue.record("not failed")
            return
        }
        #expect(message == "No. Menu")
    }

    @Test func matchesAnInflowOnlyByItsWholeName() {
        let options = [
            InflowOption(value: "a", label: "Salary"), InflowOption(value: "b", label: "On-call"),
            InflowOption(value: "c", label: "On-call "),
        ]
        #expect(PayslipExtractionReader.matchInflow(label: "  salary ", options: options) == "a")
        #expect(PayslipExtractionReader.matchInflow(label: "Salary bonus", options: options) == nil)
        #expect(PayslipExtractionReader.matchInflow(label: "on-call", options: options) == nil)
        #expect(PayslipExtractionReader.matchInflow(label: "", options: options) == nil)
    }
}
