import Foundation
import Testing

@testable import Nest

@Suite struct TaxPresentationTests {
    @Test func splitsGrossIntoWholePercentages() {
        let split = TaxPresentation.takeHomeSplit(afterTaxCents: 7_550, grossCents: 10_000)
        #expect(split.takeHomePct == 76 && split.taxPct == 24)
        let none = TaxPresentation.takeHomeSplit(afterTaxCents: 0, grossCents: 0)
        #expect(none.takeHomePct == 0 && none.taxPct == 0)
    }

    @Test func roundsHalvesTowardPositiveInfinityLikeMathRound() {
        #expect(TaxPresentation.jsRound(2.5) == 3)
        #expect(TaxPresentation.jsRound(-2.5) == -2)
        #expect(BreakdownLine(label: "x", annualCents: 130, subtract: true).fortnightlyCents == -5)
    }

    @Test func formatsRatesAndCentsRates() {
        #expect(TaxPresentation.ratePercent(0.0125) == "1.25%")
        #expect(TaxPresentation.ratePercent(0.325) == "32.5%")
        #expect(TaxPresentation.ratePercent(0.15) == "15%")
        #expect(TaxPresentation.centsRate(88, unit: "km") == "88c/km")
        #expect(TaxPresentation.centsRate(67.5, unit: "hr") == "67.5c/hr")
    }

    @Test func formatsIsoDates() {
        #expect(TaxPresentation.isoDate("2027-02-28") == "28 Feb 2027")
    }

    @Test func describesWhenAShareLapses() {
        let now = Date(timeIntervalSince1970: 0)
        func label(days: Double) -> String {
            let expiry = ISO8601DateFormatter().string(
                from: now.addingTimeInterval(days * 86_400 - 60))
            return TaxPresentation.expiryLabel(expiresAt: expiry, now: now)
        }
        #expect(label(days: 0.5) == "Expires within a day")
        #expect(label(days: 3) == "Expires in 3 days")
    }

    @Test func wordsTheWithholdingPosition() {
        func breakdown(balance: Int) -> TaxBreakdown {
            .init(
                taxableIncomeCents: 0, incomeForSurchargeCents: 0, incomeTaxCents: 0,
                litoOffsetCents: 0, oneOffOffsetCents: 0, medicareLevyCents: 0,
                medicareLevySurchargeCents: 0, helpRepaymentCents: 0, division293Cents: 0,
                totalLiabilityCents: 10_000, paygWithheldCents: 12_000, balanceCents: balance,
                repaymentIncomeCents: 0)
        }
        #expect(
            TaxPresentation.withholdingLines(breakdown(balance: -2_000)).tracking
                == "Tracking toward a $20.00 refund.")
        #expect(
            TaxPresentation.withholdingLines(breakdown(balance: 500)).tracking
                == "Tracking toward a $5.00 bill.")
        #expect(
            TaxPresentation.withholdingLines(breakdown(balance: 0)).tracking
                == "Tracking toward no refund or bill.")
    }

    @Test func parsesTypedDollarsToCents() {
        #expect(TaxPresentation.cents(fromDollars: "1,234.56") == 123_456)
        #expect(TaxPresentation.cents(fromDollars: "") == 0)
        #expect(TaxPresentation.cents(fromDollars: "abc") == 0)
    }
}
