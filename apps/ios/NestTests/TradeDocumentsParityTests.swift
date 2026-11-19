import Foundation
import Testing

@testable import Nest

/// Holds the native contract-note flow to the PWA: `trade-documents-parity.json` carries
/// `trade-extract` replies with the drafts the PWA reads from them, the input its form
/// submits for each draft left as read (the integer-microdollar price round-tripped
/// through the dollars field) and whether the repeat-trade warning shows, plus failure
/// bodies and the outcome each reads as.
@Suite struct TradeDocumentsParityTests {
    struct Values: Decodable {
        var ticker: String?
        var side: TradeSide?
        var traded_on: String?
        var units: Double?
        var price_per_unit_microdollars: Int64?
        var fee_cents: Int?

        var native: TradeValues {
            TradeValues(
                ticker: ticker, side: side, tradedOn: traded_on, units: units,
                priceMicrodollars: price_per_unit_microdollars, feeCents: fee_cents)
        }
    }

    struct Input: Decodable {
        var member_id: String
        var ticker: String
        var side: TradeSide
        var traded_on: String
        var units: Double
        var price_per_unit_microdollars: Int64
        var fee_cents: Int64

        var native: TradeInput {
            TradeInput(
                memberID: member_id, ticker: ticker, side: side, tradedOn: traded_on, units: units,
                priceMicrodollars: price_per_unit_microdollars, feeCents: fee_cents)
        }
    }

    struct Draft: Decodable {
        var values: Values
        var check: [String]
        var input: Input?
        var `repeat`: Bool
    }

    struct Reply: Decodable {
        var name: String
        var expected: [Draft]?
    }

    struct Failure: Decodable {
        struct Outcome: Decodable {
            var status: String
            var message: String
        }

        var expected: Outcome
    }

    struct Fixture: Decodable {
        var memberId: String
        var trades: [Trade]
        var replies: [Reply]
        var failures: [Failure]
    }

    private final class BundleLocator {}

    private static let data: Data = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "trade-documents-parity", withExtension: "json")!
        return try! Data(contentsOf: url)
    }()

    private static let fixture = try! JSONDecoder().decode(Fixture.self, from: data)

    /// Each `section` entry's `body` as its own JSON bytes (nil for a JSON null), read
    /// with `JSONSerialization` as the reader reads a live reply.
    private static func bodies(_ section: String) -> [Data?] {
        let root = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        return (root[section] as! [[String: Any]]).map { entry in
            let body = entry["body"]!
            return body is NSNull
                ? nil : try! JSONSerialization.data(withJSONObject: body, options: .fragmentsAllowed)
        }
    }

    @Test func repliesReadLikeThePWA() {
        for (reply, body) in zip(Self.fixture.replies, Self.bodies("replies")) {
            let read = TradeExtractionReader.readExtraction(body!)
            let expected = reply.expected?.map {
                ExtractedTrade(values: $0.values.native, check: $0.check)
            }
            #expect(read == expected, "\(reply.name)")
        }
    }

    @Test func draftsSubmitAndWarnLikeThePWA() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        let fixture = Self.fixture
        let rows = InvestmentsRows(trades: fixture.trades)
        let presentation = InvestmentsPresentation(
            content: InvestmentsContent(rows: rows, portfolio: try await engine.portfolio(rows.input)))
        for reply in fixture.replies {
            for draft in reply.expected ?? [] {
                let form = TradeDraft(values: draft.values.native, today: "2026-01-01")
                let figures = try await engine.tradeFigures(form.figuresInput)
                let input = form.input(memberID: fixture.memberId, figures: figures)
                #expect(input == draft.input?.native, "\(reply.name)")
                let warns = input.map { presentation.isRepeat($0, ignoring: nil) } ?? false
                #expect(warns == draft.repeat, "\(reply.name)")
            }
        }
    }

    @Test func failuresReadLikeThePWA() {
        for (failure, body) in zip(Self.fixture.failures, Self.bodies("failures")) {
            let outcome = TradeExtractionReader.readFailure(body)
            let actual: (String, String)? =
                switch outcome {
                case .unsupported(let message): ("unsupported", message)
                case .off(let message): ("off", message)
                case .failed(let message): ("failed", message)
                case .read: nil
                }
            #expect(actual?.0 == failure.expected.status)
            #expect(actual?.1 == failure.expected.message)
        }
    }
}
