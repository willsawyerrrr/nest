import Foundation
import Testing

@testable import Nest

/// Holds the native Investments to the PWA's figures: `trades-parity.json` carries
/// rows and what the PWA's Investments tab shows for them. The screen's own
/// assembly (`InvestmentsRows.input`) feeds the bundled engine, and the result and
/// the labels `InvestmentsPresentation` draws must equal them.
@Suite struct TradesParityTests {
    struct Line: Codable, Equatable {
        var title: String
        var cells: [String]
        var figure: Int
        var figureCaption: String
    }

    struct TradeExpected: Codable, Equatable {
        var id: String
        var date: String
        var units: String
        var price: String
        var brokerage: String
        var fee: String?
        var valueCents: Int
        var hasDocument: Bool
    }

    struct MemberExpected: Codable, Equatable {
        var memberId: String
        var holdings: [Line]
        var gains: [Line]
        var unmatched: [String]
        var trades: [TradeExpected]
    }

    struct Expected: Decodable, Sendable {
        var portfolio: Portfolio
        var members: [MemberExpected]
    }

    struct Fixture: Decodable, Sendable {
        var name: String
        var rows: InvestmentsRows
        var expected: Expected
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "trades-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let portfolio = try await engine.portfolio(fixture.rows.input)
            #expect(portfolio == fixture.expected.portfolio, "\(fixture.name)")
        }
    }

    @Test func presentationLabelsMatchThePWA() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let content = InvestmentsContent(
                rows: fixture.rows, portfolio: try await engine.portfolio(fixture.rows.input))
            let sections = InvestmentsPresentation(content: content).sections
            let actual = sections.map { section in
                MemberExpected(
                    memberId: section.memberID,
                    holdings: section.holdings.map(Self.line), gains: section.gains.map(Self.line),
                    unmatched: section.unmatched,
                    trades: section.trades.map {
                        TradeExpected(
                            id: $0.id, date: $0.date, units: $0.units, price: $0.price,
                            brokerage: $0.brokerage, fee: $0.fee, valueCents: $0.valueCents,
                            hasDocument: $0.documentPath != nil)
                    })
            }
            #expect(actual == fixture.expected.members, "\(fixture.name)")
        }
    }

    private static func line(_ line: InvestmentsPresentation.Line) -> Line {
        Line(
            title: line.title, cells: line.cells, figure: line.figureCents,
            figureCaption: line.caption)
    }

    @Test func typedAmountsParseLikeThePWA() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        let figures = try await engine.tradeFigures(
            TradeFiguresInput(units: "1.5", price: "33.083072", fee: "9.50"))
        #expect(figures == TradeFigures(units: 1.5, priceMicrodollars: 33_083_072, feeCents: 950))
    }
}
