import Foundation
import Testing

@testable import Nest

/// Holds the native Deductions screen to the PWA's figures: `deductions-parity.json`
/// carries rows and the figures the PWA computes from them. The bundled engine and the
/// screen's own presentation must reproduce them exactly.
@Suite struct DeductionsParityTests {
    struct FiguresCase: Decodable, Sendable {
        struct Input: Decodable, Sendable {
            var financialYear: Int
            var distanceKm: Double?
            var hours: Double?
            var fullAmountCents: Int?
            var workUsePercent: Double?
        }
        var input: Input
        var expected: DeductionFigures
    }

    struct YearsCase: Decodable, Sendable {
        struct Input: Decodable, Sendable { var now: String }
        var input: Input
        var expected: FinancialYearOptions
    }

    struct Household: Decodable, Sendable {
        struct Rows: Decodable, Sendable {
            var deductions: [Deduction]
            var groups: [DeductionGroup]
        }
        struct Expected: Decodable, Sendable {
            struct Group: Decodable, Sendable {
                var id: String
                var paymentIds: [String]
                var totalCents: Int
            }
            struct Drop: Decodable, Sendable {
                var deductionId: String
                var dropId: String
                var result: String?
                var valid: Bool
            }
            var memberTotalCents: Int
            var groups: [Group]
            var ungroupedIds: [String]
            var drops: [Drop]
        }
        var rows: Rows
        var expected: Expected
    }

    struct Fixture: Decodable, Sendable {
        var figures: [FiguresCase]
        var years: [YearsCase]
        var household: Household
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "deductions-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test func engineFiguresMatchThePWA() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for example in Self.fixture.figures {
            let input = DeductionFiguresInput(
                financialYear: example.input.financialYear, distanceKm: example.input.distanceKm,
                hours: example.input.hours, fullAmountCents: example.input.fullAmountCents,
                workUsePercent: example.input.workUsePercent)
            #expect(try await engine.deductionFigures(input) == example.expected, "\(example.input)")
        }
    }

    @Test func financialYearOptionsMatchThePWA() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for example in Self.fixture.years {
            let options = try await engine.financialYearOptions(
                FinancialYearOptionsInput(now: example.input.now))
            #expect(options == example.expected, "\(example.input.now)")
        }
    }

    @Test func groupingAndTotalsMatchThePWA() {
        let household = Self.fixture.household
        let member = memberRow("m1")
        let rows = DeductionsRows(
            members: [member],
            deductions: household.rows.deductions,
            groups: household.rows.groups.filter { $0.financialYear == 2027 })
        let presentation = DeductionsPresentation(rows: rows).members[0]
        #expect(presentation.totalCents == household.expected.memberTotalCents)
        #expect(
            presentation.groups.map { [$0.id, $0.totalCents.description] + $0.payments.map(\.id) }
                == household.expected.groups.map {
                    [$0.id, $0.totalCents.description] + $0.paymentIds
                })
        #expect(presentation.ungrouped.map(\.id) == household.expected.ungroupedIds)
    }

    @Test func dropRulesMatchThePWA() {
        let household = Self.fixture.household
        for drop in household.expected.drops {
            let deduction = household.rows.deductions.first { $0.id == drop.deductionId }!
            let result = DeductionDrop.result(
                for: deduction, dropID: drop.dropId, groups: household.rows.groups)
            #expect(result.isValid == drop.valid, "\(drop.deductionId) on \(drop.dropId)")
            #expect(result.groupID == drop.result, "\(drop.deductionId) on \(drop.dropId)")
        }
    }

    private func memberRow(_ id: String) -> Member {
        try! JSONDecoder().decode(
            Member.self,
            from: Data(
                """
                {"id":"\(id)","household_id":"h1","user_id":"u","name":"Will","email":null,\
                "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
                "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
                """.utf8))
    }
}
