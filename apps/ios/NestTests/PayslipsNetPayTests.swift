import Foundation
import Testing

@testable import Nest

/// The native net-pay readings word the engine's corroboration as the PWA's
/// `NetPayReceived` components do, and the screen reads and dates credits as
/// `useSalaryCredits` does.
@Suite struct PayslipsNetPayTests {
    private func match(
        _ status: NetPay.CreditMatch.Status, net: Int64? = nil, modelled: Int64? = nil
    ) -> NetPay.CreditMatch {
        status == .missing
            ? .init(status: .missing)
            : .init(
                status: status, creditId: "t1", postedOn: "2026-07-22", amountCents: 3_750_00,
                netDifferenceCents: net, modelledDifferenceCents: modelled)
    }

    @Test func aCreditNoteSaysWhereTheNetLanded() {
        #expect(PayslipsPresentation.creditNote(match(.missing)) == .missing)
        #expect(
            PayslipsPresentation.creditNote(match(.matched, net: 0, modelled: 0))
                == .landed(landed: "Landed in Up 22 Jul 2026: $3,750.00", net: nil, plan: nil))
        guard
            case .landed(_, let net?, let plan?) = PayslipsPresentation.creditNote(
                match(.differs, net: -50_00, modelled: 12_00))
        else {
            Issue.record("expected both differences")
            return
        }
        #expect(net.text == "$50.00 less than the slip’s net")
        #expect(net.sign == .negative)
        #expect(plan.text == "$12.00 more than the plan’s net")
        #expect(plan.sign == .positive)
        #expect(
            PayslipsPresentation.creditNote(match(.differs, net: 5_00, modelled: nil))
                == .landed(
                    landed: "Landed in Up 22 Jul 2026: $3,750.00",
                    net: DifferenceModel(cents: 5_00, against: "the slip’s net"), plan: nil))
    }

    private func credit(_ id: String, slip: String? = "p1", drift: Bool = false) -> NetPay.Credit {
        .init(
            id: id, postedOn: "2026-08-05", amountCents: 3_750_00, payer: "Acme", payslipId: slip,
            daysSincePrevious: drift ? 21 : 14, cadenceDrift: drift,
            previousDifferenceCents: drift ? -500_00 : 0, amountDrift: drift)
    }

    @Test func aMemberNetPayBlockSummarisesTheirCredits() throws {
        #expect(
            PayslipsPresentation.netPay(
                .init(memberId: "m1", credits: [], receivedCents: 0, payslipCount: 1, matchedCount: 0,
                      cadenceDays: nil)) == nil)
        let single = try #require(
            PayslipsPresentation.netPay(
                .init(memberId: "m1", credits: [credit("t1")], receivedCents: 3_750_00,
                      payslipCount: 0, matchedCount: 0, cadenceDays: nil)))
        #expect(single.count == "across 1 credit")
        #expect(single.qualifiers == "")
        let model = try #require(
            PayslipsPresentation.netPay(
                .init(memberId: "m1", credits: [credit("t2", slip: nil, drift: true), credit("t1")],
                      receivedCents: 7_000_00, payslipCount: 3, matchedCount: 2, cadenceDays: 14)))
        #expect(model.count == "across 2 credits")
        #expect(model.qualifiers == " · 2 of 3 slips matched · paid every 14 days")
        let drifted = model.credits[0]
        #expect(drifted.date == "5 Aug 2026")
        #expect(drifted.noPayslip)
        #expect(drifted.cadenceNote == "21 days after the previous pay; paid every 14")
        #expect(drifted.amountDrift?.text == "$500.00 less than the previous pay")
        #expect(model.credits[1].cadenceNote == nil)
        #expect(model.credits[1].amountDrift == nil)
        #expect(!model.credits[1].noPayslip)
    }

    @Test func unattributedCreditsNameTheirPayersOnce() {
        func candidate(_ id: String, _ payer: String) -> NetPay.Candidate {
            .init(id: id, postedOn: "2026-09-01", amountCents: 1_00, memberId: nil, payer: payer,
                  transactionType: "Salary")
        }
        #expect(PayslipsPresentation.unattributedNote([]) == nil)
        #expect(
            PayslipsPresentation.unattributedNote([candidate("t1", "QVS ")])
                == "1 salary credit from QVS landed in a joint account this year. Add a payslip they carry to link them to whoever was paid.")
        #expect(
            PayslipsPresentation.unattributedNote([
                candidate("t1", "QVS"), candidate("t2", "Acme"), candidate("t3", " QVS"),
            ])?.hasPrefix("3 salary credits from QVS, Acme landed") == true)
    }

    private var brisbane: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Australia/Brisbane")!
        return calendar
    }

    @Test func creditsAreReadAroundTheFinancialYearInLocalTime() {
        let bounds = PayslipsRows.creditBounds(financialYear: 2027, calendar: brisbane)
        #expect(bounds.from == "2026-06-29T14:00:00Z")
        #expect(bounds.to == "2027-07-07T14:00:00Z")
    }

    @Test func aCreditIsDatedOnItsLocalDayAndEncodesAbsentFieldsAsNull() throws {
        let row: [String: Any?] = [
            "account_id": "joint", "amount_cents": 3_750_00, "category_id": nil,
            "created_at": "2026-01-01T00:00:00Z", "deep_link_url": nil, "description": "Acme",
            "external_category": nil, "external_category_since": "2026-01-01T00:00:00Z",
            "external_id": nil, "external_parent_category": nil, "household_id": "h1", "id": "t1",
            "is_categorizable": false, "kind": "income", "member_id": nil, "notes": nil,
            "performing_customer_name": nil, "posted_at": "2026-07-21T15:30:00+00:00",
            "reviewed_at": nil, "reviewed_by_member_id": nil, "source": "up", "status": "settled",
            "transaction_type": nil, "up_message": nil, "up_note": nil,
            "updated_at": "2026-01-01T00:00:00Z",
        ]
        let data = try JSONSerialization.data(withJSONObject: row.mapValues { $0 ?? NSNull() })
        let transaction = try JSONDecoder().decode(LedgerTransaction.self, from: data)
        let input = SalaryCreditInput(transaction, calendar: brisbane)
        #expect(input.postedOn == "2026-07-22")
        let encoded = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        #expect(encoded["member_id"] is NSNull)
        #expect(encoded["transaction_type"] is NSNull)
        #expect(encoded["posted_on"] as? String == "2026-07-22")
        #expect(encoded["amount_cents"] as? Int == 3_750_00)
    }

    @Test func thePresentationCarriesTheCorroboration() throws {
        let fixture = try #require(PayslipsParityTests.fixtures.first { $0.rows.credits.count > 0 })
        let presentation = PayslipsPresentation(
            content: PayslipsContent(
                rows: fixture.rows, overview: fixture.expected, financialYear: fixture.financialYear))
        let netPay = try #require(fixture.expected.netPay)
        let notes = presentation.members.flatMap(\.cards).compactMap(\.detail.creditNote)
        #expect(notes.count == netPay.byPayslip.count)
        #expect(notes.contains(.missing))
        #expect(presentation.members.contains { $0.netPay != nil })
        #expect(presentation.unattributedNote?.contains("QVS") == true)

        let none = try #require(PayslipsParityTests.fixtures.first { $0.rows.credits.isEmpty })
        let bare = PayslipsPresentation(
            content: PayslipsContent(
                rows: none.rows, overview: none.expected, financialYear: none.financialYear))
        #expect(bare.unattributedNote == nil)
        #expect(bare.members.allSatisfy { $0.netPay == nil })
        #expect(bare.members.flatMap(\.cards).allSatisfy { $0.detail.creditNote == nil })
    }
}
