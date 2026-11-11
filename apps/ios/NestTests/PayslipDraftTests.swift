import Foundation
import Testing

@testable import Nest

@MainActor
@Suite struct PayslipDraftTests {
    private func extraction() -> PayslipExtraction {
        PayslipExtraction(
            model: "m", dates: [.periodStart: "2026-07-06", .periodEnd: "2026-07-19"],
            amounts: [.gross: 500_000, .taxWithheld: 125_000, .super: 57_500, .net: 375_000],
            earnings: [ExtractedLine(label: "Salary", amountCents: 500_000)],
            tax: [ExtractedTaxLine(line: ExtractedLine(label: "PAYG", amountCents: 125_000), component: nil)])
    }

    private let options = [InflowOption(value: "salary", label: "Salary")]

    @Test func opensOnAFortnightEndingToday() {
        let draft = PayslipDraft(today: "2026-07-19")
        #expect(draft.periodStart == "2026-07-06")
        #expect(draft.periodEnd == "2026-07-19")
        #expect(!draft.canSubmit(busy: false))
    }

    @Test func aReadFillsWhatTheMemberHasNotMadeTheirOwn() {
        let draft = PayslipDraft(today: "2026-07-19")
        draft.setAmount(.gross, "999.00")
        let summary = draft.prefill(extraction(), options: options)
        #expect(draft.amount(.gross) == "999.00")
        #expect(draft.amount(.taxWithheld) == "1250.00")
        #expect(!summary.filled.contains("gross_cents"))
        #expect(summary.filledLines == [.earning, .tax])
        #expect(draft.lines(of: .earning).first?.sourceInflowId == "salary")
        #expect(draft.lines(of: .tax).first?.component == nil)
        #expect(draft.canSubmit(busy: false) == false)
        draft.change(draft.lines(of: .tax)[0].id) { $0.component = .payg }
        #expect(draft.canSubmit(busy: false))
        #expect(!draft.canSubmit(busy: true))
    }

    @Test func aKindTheMemberEditedIsNotItemisedAgain() {
        let draft = PayslipDraft(today: "2026-07-19")
        draft.addLine(.earning)
        draft.change(draft.lines[0].id) { $0.label = "Mine"; $0.amount = "1.00" }
        let summary = draft.prefill(extraction(), options: options)
        #expect(summary.filledLines == [.tax])
        #expect(draft.lines(of: .earning).map(\.label) == ["Mine"])
    }

    @Test func aSavedPayslipKeepsItsFigures() throws {
        let payslip = try JSONDecoder().decode(
            Payslip.self,
            from: Data(
                """
                {"id":"p","household_id":"h","member_id":"m","financial_year":2027,
                "period_start":"2026-07-06","period_end":"2026-07-19","paid_on":null,
                "gross_cents":100000,"tax_withheld_cents":20000,"super_cents":11500,"net_cents":80000,
                "salary_sacrifice_cents":null,"ytd_gross_cents":null,"ytd_tax_withheld_cents":null,
                "ytd_super_cents":null,"file_path":null,"note":null,
                "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
                """.utf8))
        let draft = PayslipDraft(initial: payslip, today: "2026-08-01")
        draft.prefill(extraction(), options: options)
        #expect(draft.amount(.gross) == "1000.00")
        #expect(draft.periodStart == "2026-07-06")
        #expect(draft.amount(.ytdGross) == "")
    }

    @Test func anInvertedPeriodBlocksSubmission() {
        let draft = PayslipDraft(today: "2026-07-19")
        draft.prefill(extraction(), options: options)
        draft.setDate(.periodEnd, "2026-07-01")
        #expect(draft.periodInverted)
        #expect(!draft.canSubmit(busy: false))
    }

    @Test func derivesTheFinancialYearFromThePayDate() {
        let draft = PayslipDraft(today: "2026-06-28")
        #expect(draft.financialYear == 2026)
        draft.setDate(.paidOn, "2026-07-01")
        #expect(draft.financialYear == 2027)
    }

    @Test func roundsDollarsToCentsHalfUp() {
        #expect(PayslipDraft.cents("12.345") == 1235)
        #expect(PayslipDraft.cents("$1,234.50") == 123_450)
        #expect(PayslipDraft.cents("") == nil)
        #expect(PayslipDraft.cents("-20.00") == -2000)
        #expect(PayslipDraft.dollars(123_450) == "1234.50")
    }

    @Test func tracksWhatTheLinesLeaveUnitemised() {
        let draft = PayslipDraft(today: "2026-07-19")
        draft.setAmount(.gross, "1000")
        draft.setAmount(.taxWithheld, "200")
        draft.addLine(.earning)
        draft.change(draft.lines[0].id) { $0.label = "Salary"; $0.amount = "800" }
        #expect(draft.unallocatedCents == 20_000)
        #expect(draft.unallocatedTaxCents == 20_000)
    }

    @Test func submitsExplicitNullsAndOnlyTheReferenceThatMeansSomethingForEachKind() throws {
        let draft = PayslipDraft(today: "2026-07-19")
        draft.prefill(extraction(), options: options)
        draft.change(draft.lines(of: .tax)[0].id) { $0.component = .payg }
        let submission = try #require(draft.submission(id: "id", memberID: "m1", attachment: nil))
        #expect(submission.input.financialYear == 2027)
        #expect(submission.lines.map(\.kind) == [.earning, .tax])
        #expect(submission.lines[0].taxComponent == nil && submission.lines[1].sourceInflowId == nil)
        let json = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(submission.input)) as? [String: Any])
        #expect(json["paid_on"] is NSNull)
        #expect(json["salary_sacrifice_cents"] is NSNull)
        #expect(json["gross_cents"] as? Int == 500_000)
    }
}
