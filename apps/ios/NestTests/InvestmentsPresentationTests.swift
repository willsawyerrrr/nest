import Foundation
import Testing

@testable import Nest

@Suite struct InvestmentsPresentationTests {
    @Test func unitsReadWithTheirNoun() {
        #expect(InvestmentsPresentation.unitsText(1) == "1 unit")
        #expect(InvestmentsPresentation.unitsText(1.5) == "1.5 units")
        #expect(InvestmentsPresentation.unitsText(1234.567891) == "1,234.567891 units")
    }

    @Test func unitPricesKeepUpToSixPlaces() {
        #expect(InvestmentsPresentation.unitPrice(33_083_072) == "$33.083072")
        #expect(InvestmentsPresentation.unitPrice(98_500_000) == "$98.50")
    }

    @Test func datesAreShort() {
        #expect(InvestmentsPresentation.date("2027-02-28") == "28 Feb 2027")
    }

    @Test func draftFieldTextRoundTripsExactly() {
        #expect(TradeDraft.microdollars(33_083_072) == "33.083072")
        #expect(TradeDraft.microdollars(98_500_000) == "98.5")
        #expect(TradeDraft.microdollars(5_000_000) == "5")
        #expect(TradeDraft.microdollars(1_050) == "0.00105")
        #expect(TradeDraft.cents(950) == "9.50")
        #expect(TradeDraft.decimal(1234.5) == "1234.5")
    }

    @Test func aDraftNeedsATickerPositiveUnitsAndAPrice() {
        var draft = TradeDraft(today: "2026-01-01")
        let figures = TradeFigures(units: 2, priceMicrodollars: 1_000_000, feeCents: 0)
        #expect(!draft.canSubmit(figures))
        draft.ticker = " vas "
        #expect(draft.canSubmit(figures))
        #expect(!draft.canSubmit(TradeFigures(units: 0, priceMicrodollars: 1, feeCents: 0)))
        #expect(!draft.canSubmit(TradeFigures(units: 1, priceMicrodollars: nil, feeCents: 0)))
        #expect(!draft.canSubmit(nil))
        #expect(draft.input(memberID: "m1", figures: figures)?.ticker == "VAS")
    }

    @Test func aRepeatedTradeIsFlaggedUnlessItIsTheOneBeingEdited() throws {
        let trade = try JSONDecoder().decode(
            [Trade].self, from: Data(Investments.tradeJSONForTests.utf8))
        let member = try JSONDecoder().decode(
            [Member].self, from: Data(Investments.memberJSONForTests.utf8))
        let presentation = InvestmentsPresentation(
            content: InvestmentsContent(
                rows: InvestmentsRows(trades: trade, members: member, documents: []),
                portfolio: Portfolio(members: [], tradeValues: [])))
        let same = TradeInput(
            memberID: "m1", ticker: "VAS", side: .buy, tradedOn: "2024-01-10", units: 10,
            priceMicrodollars: 90_000_000, feeCents: 0)
        #expect(presentation.isRepeat(same, ignoring: nil))
        #expect(!presentation.isRepeat(same, ignoring: "t1"))
    }
}

private enum Investments {
    static let tradeJSONForTests = """
        [{"id":"t1","household_id":"h","member_id":"m1","ticker":"VAS","side":"buy",\
        "traded_on":"2024-01-10","units":10,"price_per_unit_microdollars":90000000,\
        "fee_cents":950,"source":"manual","external_id":null,"document_id":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let memberJSONForTests = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
}
