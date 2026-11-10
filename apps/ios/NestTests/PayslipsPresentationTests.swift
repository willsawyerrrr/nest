import Foundation
import Testing

@testable import Nest

@Suite struct PayslipsPresentationTests {
    @Test func varianceNoteSpellsOutTheDirection() {
        #expect(VarianceNote(cents: nil).text == "No projection to compare")
        #expect(VarianceNote(cents: nil, nullNote: "Not measured per period").text == "Not measured per period")
        #expect(VarianceNote(cents: 0).text == "On plan")
        #expect(VarianceNote(cents: 45_000).text == "$450.00 above plan")
        #expect(VarianceNote(cents: -45_000).text == "$450.00 below plan")
        #expect(VarianceNote(cents: 1).sign == .positive)
        #expect(VarianceNote(cents: -1).sign == .negative)
        #expect(VarianceNote(cents: 0).sign == .zero)
    }

    @Test func coverageNoteOnlyQualifiesAPartialYear() {
        func position(covered: Int, count: Int) -> PayslipsOverview.Position {
            .init(actualCents: 0, expectedCents: nil, varianceCents: nil, coveredCount: covered, payslipCount: count)
        }
        #expect(PayslipsPresentation.coverageNote(position(covered: 3, count: 4)) == "Across 3 of 4 slips")
        #expect(PayslipsPresentation.coverageNote(position(covered: 4, count: 4)) == nil)
        #expect(PayslipsPresentation.coverageNote(position(covered: 0, count: 4)) == nil)
    }

    @Test func filesAPayslipByThePayDateOrThePeriodEnd() {
        #expect(PayslipsPresentation.financialYear(paidOn: "2026-07-01", periodEnd: "2026-06-28") == 2027)
        #expect(PayslipsPresentation.financialYear(paidOn: nil, periodEnd: "2026-06-28") == 2026)
        #expect(PayslipsPresentation.financialYear(paidOn: "2027-06-30", periodEnd: "2027-06-30") == 2027)
    }

    @Test func formatsDatesLikeThePWA() {
        #expect(PayslipsPresentation.date("2027-02-28") == "28 Feb 2027")
        #expect(PayslipsPresentation.date("2026-07-06") == "6 Jul 2026")
    }

    private func variance(gross: Int64?, tax: Int64, superCents: Int64, partlyUnmeasured: Bool = false)
        -> PayslipVariance
    {
        PayslipVariance(
            basis: .cadence, partCycleReason: nil, cadenceInflowId: nil, periodDays: 14,
            cadencePeriodDays: 14, financialYearDays: 365, expectedGrossCents: nil,
            grossVarianceCents: gross, grossPartlyUnmeasured: partlyUnmeasured,
            unmeasuredGrossCents: 0, lineGroups: [], unallocatedCents: 0,
            expectedTaxWithheldCents: 0, taxWithheldVarianceCents: tax, taxGroups: [],
            unallocatedTaxCents: 0, superBaseCents: 0, expectedSuperGuaranteeCents: 0,
            expectedConcessionalCents: 0, expectedSuperCents: 0, actualSuperCents: 0,
            superVarianceCents: superCents)
    }

    @Test func theHeadlineIsTheLargestVarianceAndGrossWinsATie() {
        #expect(PayslipsPresentation.headline(variance(gross: 100, tax: -500, superCents: 200)).label == "Tax withheld")
        #expect(PayslipsPresentation.headline(variance(gross: 500, tax: -500, superCents: 500)).label == "Gross")
        #expect(PayslipsPresentation.headline(variance(gross: nil, tax: 0, superCents: 0)).label == "Gross")
    }

    @Test func thePillNamesWhatItReadsAndItsDirection() {
        #expect(PayslipsPresentation.pill(variance(gross: 450_00, tax: 0, superCents: 0))
            == VariancePillModel(text: "$450.00 above", tone: .positive))
        #expect(PayslipsPresentation.pill(variance(gross: 0, tax: -90_00, superCents: 0))
            == VariancePillModel(text: "Tax withheld $90.00 below", tone: .negative))
        #expect(PayslipsPresentation.pill(variance(gross: 0, tax: 0, superCents: 0))
            == VariancePillModel(text: "On plan", tone: .neutral))
        #expect(PayslipsPresentation.pill(variance(gross: nil, tax: 0, superCents: 0, partlyUnmeasured: true))
            == VariancePillModel(text: "Not measured this period", tone: .neutral))
        #expect(PayslipsPresentation.pill(variance(gross: nil, tax: 0, superCents: 0))
            == VariancePillModel(text: "No projection to compare", tone: .neutral))
    }
}
