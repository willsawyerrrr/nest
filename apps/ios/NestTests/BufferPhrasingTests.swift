import Testing

@testable import Nest

@Suite struct BufferPhrasingTests {
    @Test func speaksAPositiveBufferAsMoneyAfterSaving() {
        #expect(
            BufferPhrasing.spokenSummary(fortnightlyAfterSavingCents: 1_234_56)
                == "Your fortnightly buffer is $1,234.56 after saving."
        )
    }

    @Test func speaksANegativeBufferAsOverBudget() {
        #expect(
            BufferPhrasing.spokenSummary(fortnightlyAfterSavingCents: -50_00)
                == "Your fortnightly plan is over budget by $50.00 after saving."
        )
    }

    @Test func speaksAZeroBufferAsThePositiveCase() {
        #expect(
            BufferPhrasing.spokenSummary(fortnightlyAfterSavingCents: 0)
                == "Your fortnightly buffer is $0.00 after saving."
        )
    }

    @Test func formatsCentsAsAustralianDollarsToTwoPlaces() {
        #expect(BufferPhrasing.currency(0) == "$0.00")
        #expect(BufferPhrasing.currency(7) == "$0.07")
        #expect(BufferPhrasing.currency(2_00) == "$2.00")
        #expect(BufferPhrasing.currency(1_000_000_00) == "$1,000,000.00")
    }
}
