import Foundation
import Testing

@testable import Nest

/// Holds the Equity forms' drafts to the PWA's `EquityGrantForm`,
/// `EquityExerciseForm` and `EquitySaleForm` rules.
@Suite struct EquityDraftTests {
    private func grant(
        _ id: String = "g1", type: String = "option", quantity: Double = 1_000,
        strike: Int? = 50
    ) -> EquityGrant {
        let json = """
            {"id":"\(id)","household_id":"h","member_id":"m1","label":"Acme",\
            "instrument_type":"\(type)","quantity":\(quantity),"grant_date":"2025-01-01",\
            "cliff_months":12,"vesting_period_months":48,"vesting_frequency":"monthly",\
            "strike_price_cents":\(strike.map(String.init) ?? "null"),\
            "price_per_share_cents":250,"price_as_of":null,\
            "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
            """
        return try! JSONDecoder().decode(EquityGrant.self, from: Data(json.utf8))
    }

    private func exercise(_ id: String, quantity: Double) -> EquityExercise {
        let json = """
            {"id":"\(id)","household_id":"h","member_id":"m1","grant_id":"g1",\
            "exercised_on":"2025-08-30","quantity":\(quantity),"strike_price_cents":50,\
            "market_price_per_share_cents":null,\
            "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
            """
        return try! JSONDecoder().decode(EquityExercise.self, from: Data(json.utf8))
    }

    private func sale(_ id: String, quantity: Double) -> EquitySale {
        let json = """
            {"id":"\(id)","household_id":"h","member_id":"m1","grant_id":"g1",\
            "sold_on":"2026-05-01","quantity":\(quantity),"price_per_share_cents":250,\
            "fee_cents":0,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
            """
        return try! JSONDecoder().decode(EquitySale.self, from: Data(json.utf8))
    }

    @Test func aNewGrantNeedsALabelAndQuantity() {
        var draft = GrantDraft(today: "2026-11-18")
        #expect(!draft.canSubmit)
        draft.label = "  Acme  "
        draft.quantity = "1,000"
        #expect(draft.canSubmit)
        draft.vestingPeriodMonths = "0"
        #expect(!draft.canSubmit)
    }

    @Test func aGrantInputReadsBlanksAsThePWADoes() throws {
        var draft = GrantDraft(today: "2026-11-18")
        draft.label = " Acme "
        draft.quantity = "500"
        draft.cliffMonths = ""
        draft.strikePrice = "0.505"
        let input = try #require(draft.input(memberID: "m1"))
        #expect(input.label == "Acme" && input.quantity == 500 && input.cliffMonths == 0)
        #expect(input.strikePriceCents == 51 && input.pricePerShareCents == 0)
        #expect(input.grantDate == "2026-11-18" && input.priceAsOf == nil)
        draft.instrumentType = "share"
        #expect(draft.input(memberID: "m1")?.strikePriceCents == nil)
    }

    @Test func editingAGrantStartsFromItsColumns() {
        let draft = GrantDraft(grant: grant())
        #expect(draft.quantity == "1000" && draft.strikePrice == "0.50")
        #expect(draft.pricePerShare == "2.50" && draft.cliffMonths == "12")
    }

    @Test func anEditedGrantEncodesAClearedColumnAsNull() throws {
        var draft = GrantDraft(grant: grant())
        draft.instrumentType = "share"
        let data = try JSONEncoder().encode(try #require(draft.input(memberID: "m1")))
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["strike_price_cents"] is NSNull && body["price_as_of"] is NSNull)
    }

    @Test func aNewExerciseTakesThePickedGrantsStrike() {
        let first = grant("g1", strike: 50)
        let second = grant("g2", strike: 120)
        var draft = ExerciseDraft(grants: [first, second], today: "2026-11-18")
        #expect(draft.grantID == "g1" && draft.strike == "0.50")
        draft.pick(second, adding: true)
        #expect(draft.grantID == "g2" && draft.strike == "1.20")
        draft.pick(first, adding: false)
        #expect(draft.strike == "1.20")
    }

    @Test func anExerciseNeedsOptionsAndAStrikeAndNoLimitError() {
        var draft = ExerciseDraft(grants: [grant()], today: "2026-11-18")
        #expect(draft.input(memberID: "m1", limitError: nil) == nil)
        draft.quantity = "10"
        #expect(draft.input(memberID: "m1", limitError: nil)?.quantity == 10)
        #expect(draft.input(memberID: "m1", limitError: "no") == nil)
        draft.strike = ""
        #expect(draft.input(memberID: "m1", limitError: nil) == nil)
    }

    @Test func aSaleDefaultsItsFeeToZero() throws {
        var draft = SaleDraft(grants: [grant()], today: "2026-11-18")
        draft.quantity = "5"
        draft.price = "3"
        let input = try #require(draft.input(memberID: "m1", limitError: nil))
        #expect(input.feeCents == 0 && input.pricePerShareCents == 300 && input.soldOn == "2026-11-18")
    }

    @Test func exercisedOptionsCannotFallBelowTheSharesSold() {
        let exercises = [exercise("e1", quantity: 100), exercise("e2", quantity: 50)]
        let sales = [sale("s1", quantity: 120)]
        #expect(
            EquityLimits.exerciseError(
                grant(), exercises: exercises, sales: sales, quantity: 10, ignoring: "e2")
                == "Exercised options cannot fall below the shares already sold.")
        #expect(
            EquityLimits.exerciseError(
                grant(), exercises: exercises, sales: sales, quantity: 20, ignoring: "e2") == nil)
    }

    @Test func aDatabaseRefusalReadsAsItsFixedCopy() {
        let refused = NestError(.invalidRequest, refusal: "equity_sale_exceeds_holding")
        #expect(
            EquityPresentation.failure(refused, fallback: "x")
                == "Sold shares cannot exceed the shares held.")
        #expect(EquityPresentation.failure(NestError(.server), fallback: "x") == "x")
    }
}
