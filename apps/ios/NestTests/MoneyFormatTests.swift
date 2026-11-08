import Testing

@testable import Nest

struct MoneyFormatTests {
    @Test func formatsCentsAsAustralianDollars() {
        #expect(MoneyFormat.cents(123_456) == "$1,234.56")
        #expect(MoneyFormat.cents(5) == "$0.05")
        #expect(MoneyFormat.cents(0) == "$0.00")
        #expect(MoneyFormat.cents(-123_456) == "-$1,234.56")
    }

    @Test(arguments: [
        (0, "$0"), (50_000, "$500"), (5_000_000, "$50k"),
        (15_000_000, "$150k"), (120_000_000, "$1.2M"), (-5_000_000, "-$50k"),
    ])
    func compactsDollars(cents: Int, expected: String) {
        #expect(MoneyFormat.compact(cents: cents) == expected)
    }

    @Test func formatsRates() {
        #expect(MoneyFormat.perFortnight(123_456) == "$1,234.56 / fn")
        #expect(MoneyFormat.perYear(123_456) == "$1,234.56 / year")
    }

    @Test func choosesSignFromAmount() {
        #expect(MoneySign(cents: 1) == .positive)
        #expect(MoneySign(cents: -1) == .negative)
        #expect(MoneySign(cents: 0) == .zero)
        #expect(MoneySign.zero.color == nil)
        #expect(MoneySign.positive.color != nil)
        #expect(MoneySign.negative.color != nil)
    }
}
