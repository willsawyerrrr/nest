import Foundation
import Testing

@testable import Nest

/// Guards the hand-written row models against drift from the generated PWA
/// types (`apps/pwa/src/lib/database.types.ts`, produced from the migrations):
/// each model's columns must match its table's `Row` exactly, and each Swift
/// enum must hold exactly its Postgres enum's values.
@Suite struct NestRowSchemaTests {
    private static let types: String = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("apps/pwa/src/lib/database.types.ts")
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }()

    /// The column names of `table`'s `Row` block.
    private func columns(of table: String) -> Set<String> {
        guard let start = Self.types.range(of: "\n      \(table): {\n        Row: {\n"),
            let end = Self.types.range(
                of: "\n        }", range: start.upperBound..<Self.types.endIndex)
        else { return [] }
        return Set(
            Self.types[start.upperBound..<end.lowerBound].split(separator: "\n").compactMap {
                $0.split(separator: ":").first.map { $0.trimmingCharacters(in: .whitespaces) }
            })
    }

    /// The values of the `Enums` entry `name` in the `Constants` block.
    private func enumValues(_ name: String) -> Set<String> {
        guard let constants = Self.types.range(of: "export const Constants"),
            let start = Self.types.range(
                of: "      \(name): [", range: constants.upperBound..<Self.types.endIndex),
            let end = Self.types.range(of: "],", range: start.upperBound..<Self.types.endIndex)
        else { return [] }
        return Set(
            Self.types[start.upperBound..<end.lowerBound].split(whereSeparator: {
                ", \n".contains($0)
            })
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "'\"")) }
            .filter { !$0.isEmpty })
    }

    private func check<T: NestRow>(_: T.Type) {
        let modelled = Set(T.CodingKeys.allCases.map(\.rawValue))
        let expected = columns(of: T.table)
        #expect(!expected.isEmpty, "no `\(T.table)` Row in database.types.ts")
        #expect(
            modelled == expected,
            "\(T.table) drifted: \(modelled.symmetricDifference(expected).sorted())")
    }

    @Test func modelsMatchTheGeneratedColumns() {
        check(Household.self)
        check(Member.self)
        check(Account.self)
        check(BudgetLine.self)
        check(SavingsGoal.self)
        check(Inflow.self)
        check(Payslip.self)
        check(PayslipLine.self)
        check(Deduction.self)
        check(DeductionGroup.self)
        check(DeductionReceipt.self)
        check(PaySplit.self)
        check(TaxProfile.self)
        check(SuperContribution.self)
        check(HelpDebt.self)
        check(TemporaryItem.self)
        check(MemberAllowance.self)
        check(AccountWithBalance.self)
        check(Breakdown.self)
        check(BreakdownItem.self)
        check(WishlistItem.self)
        check(Trade.self)
        check(EquityGrant.self)
        check(EquityExercise.self)
        check(EquitySale.self)
        check(SuperProfile.self)
        check(GiftRecipient.self)
        check(GiftOccasion.self)
        check(GiftBudget.self)
        check(GiftPurchase.self)
        check(GiftDiscretionaryBudget.self)
        check(GiftTransactionDismissal.self)
        check(GiftTransaction.self)
        check(AccountDirectoryEntry.self)
        check(RedbarkConnection.self)
    }

    /// The signed-in role reads every `share_grant` column but the credential's hash
    /// and the creator.
    @Test func shareGrantModelsTheReadableColumns() {
        let modelled = Set(ShareGrant.CodingKeys.allCases.map(\.rawValue))
        #expect(
            modelled == columns(of: ShareGrant.table).subtracting([
                "token_hash", "created_by_member_id",
            ]))
    }

    @Test func calendarFeedReadsOnlyItsGrantedColumns() {
        let modelled = Set(CalendarFeed.CodingKeys.allCases.map(\.rawValue))
        #expect(modelled.isSubset(of: columns(of: CalendarFeed.table)))
        #expect(!modelled.contains("token_hash"))
        #expect(Set(CalendarFeed.columns.split(separator: ",").map(String.init)) == modelled)
    }

    @Test func enumsMatchThePostgresEnums() {
        func values<E: CaseIterable & RawRepresentable<String>>(_: E.Type) -> Set<String> {
            Set(E.allCases.map(\.rawValue))
        }
        #expect(values(Frequency.self) == enumValues("frequency"))
        #expect(values(BudgetGroup.self) == enumValues("budget_group"))
        #expect(values(AccountType.self) == enumValues("account_type"))
        #expect(values(LedgerSource.self) == enumValues("ledger_source"))
        #expect(values(InflowType.self) == enumValues("inflow_type"))
        #expect(values(OneOffTaxTreatment.self) == enumValues("one_off_tax_treatment"))
        #expect(values(DeductionBasis.self) == enumValues("deduction_basis"))
        #expect(values(DeductionCategory.self) == enumValues("deduction_category"))
        #expect(values(BreakdownKind.self) == enumValues("breakdown_kind"))
        #expect(values(TaxResidency.self) == enumValues("tax_residency"))
        #expect(values(SuperContributionKind.self) == enumValues("super_contribution_kind"))
        #expect(values(SuperContributionMode.self) == enumValues("super_contribution_mode"))
    }

    @Test func decodesARowWithEveryColumn() throws {
        let json = """
            {"id":"m1","household_id":"h1","user_id":"u1","name":"Will","email":null,\
            "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
            "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
            """
        let member = try JSONDecoder().decode(Member.self, from: Data(json.utf8))
        #expect(member.householdId == "h1")
        #expect(try JSONDecoder().decode(Member.self, from: JSONEncoder().encode(member)) == member)
    }
}
