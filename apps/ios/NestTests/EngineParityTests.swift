import Foundation
import Testing

@testable import Nest

/// Runs the fixtures `packages/js-core`'s vitest suite generates through the
/// Swift `Engine`, asserting the output equals what the TypeScript engines
/// produce.
@Suite struct EngineParityTests {
    struct Fixture: Decodable, Sendable, CustomTestStringConvertible {
        var name: String
        var entry: String
        var input: JSONValue
        var expected: JSONValue

        var testDescription: String { name }
    }

    /// A JSON document, compared structurally.
    enum JSONValue: Codable, Equatable, Sendable {
        case null
        case bool(Bool)
        case integer(Int64)
        case number(Double)
        case string(String)
        case array([JSONValue])
        case object([String: JSONValue])

        init(from decoder: Decoder) throws {
            let single = try decoder.singleValueContainer()
            if single.decodeNil() {
                self = .null
            } else if let value = try? single.decode(Bool.self) {
                self = .bool(value)
            } else if let value = try? single.decode(Int64.self) {
                self = .integer(value)
            } else if let value = try? single.decode(Double.self) {
                self = .number(value)
            } else if let value = try? single.decode(String.self) {
                self = .string(value)
            } else if let value = try? single.decode([JSONValue].self) {
                self = .array(value)
            } else {
                self = .object(try single.decode([String: JSONValue].self))
            }
        }

        func encode(to encoder: Encoder) throws {
            var single = encoder.singleValueContainer()
            switch self {
            case .null: try single.encodeNil()
            case .bool(let value): try single.encode(value)
            case .integer(let value): try single.encode(value)
            case .number(let value): try single.encode(value)
            case .string(let value): try single.encode(value)
            case .array(let value): try single.encode(value)
            case .object(let value): try single.encode(value)
            }
        }
    }

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "engine-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private final class BundleLocator {}

    /// One engine over the host app's bundled `nest-engines.js`.
    private static let engine = Task { try Engine(bundle: Bundle(for: Engine.self)) }

    @Test(arguments: fixtures)
    func matchesTheTypeScriptEngines(_ fixture: Fixture) async throws {
        let engine = try await Self.engine.value
        let entry = try #require(Engine.Entry(rawValue: fixture.entry))
        let output = try await engine.call(entry, json: JSONEncoder().encode(fixture.input))
        #expect(try JSONDecoder().decode(JSONValue.self, from: output) == fixture.expected)
    }

    @Test func coversEveryEngineEntry() {
        let entries = Set(Self.fixtures.map(\.entry))
        #expect(
            entries == [
                "estimateTax", "summariseHousehold", "projectGoalQueue", "summariseBreakdowns",
                "budgetOverview",
            ])
    }

    @Test func decodesTheMicrodollarTradeEstimateToExactCents() async throws {
        let fixture = try #require(Self.fixtures.first { $0.name.contains("microdollar") })
        let engine = try await Self.engine.value
        let estimate: TaxEstimate = try await engine.call(.estimateTax, fixture.input)
        #expect(estimate.annualGrossCents == 515_060_734)
        #expect(estimate.members.map(\.memberId) == ["m1"])
    }

    @Test func decodesTheBufferAndGoalQueueIntoTypedResults() async throws {
        let engine = try await Self.engine.value
        let summary = try #require(
            Self.fixtures.first { $0.name == "fortnightly buffer: a salary with needs and savings lines" })
        let buffer: BudgetSummary = try await engine.call(.summariseHousehold, summary.input)
        #expect(buffer.available.fortnightlyCents == 3_456_92)
        #expect(buffer.afterSaving.fortnightlyCents == 3_456_92 - 2_000_00 - 400_00)

        let queue = try #require(Self.fixtures.first { $0.name == "goal queue: case 1" })
        let projection: GoalQueueProjection = try await engine.call(.projectGoalQueue, queue.input)
        #expect(projection.active.count == 2)
        #expect(projection.queued.count == 3)
        #expect(projection.queued[1].alreadyMet)
        #expect(projection.queued[0].projectedStartDate == "2027-09-07")
        #expect(projection.active[0].requiredFortnightlyContributionCents == nil)
    }

    @Test func aBundleWithoutTheScriptFails() throws {
        let empty = try #require(Bundle(path: NSTemporaryDirectory()))
        #expect(throws: Engine.Failure.bundleMissing) { _ = try Engine(bundle: empty) }
    }
}
