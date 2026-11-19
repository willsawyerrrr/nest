import Foundation
import Testing

@testable import Nest

/// Holds the native budget line and allowance forms to the PWA's rules:
/// `budget-form-parity.json` carries stored rows with whether the PWA's own form
/// can save each and the columns it writes, plus the PWA's management-link and
/// annualising helpers' answers. The native form state opened on the same rows
/// must agree.
@Suite struct BudgetFormParityTests {
    struct Outcome<Input: Decodable & Sendable>: Decodable, Sendable {
        var canSubmit: Bool
        var input: Input?
    }

    struct LineCase: Decodable, Sendable {
        var name: String
        var line: BudgetLine
        var allowances: [AllowanceChoice]
        var expected: Outcome<BudgetLineInput>
    }

    struct AllowanceCase: Decodable, Sendable {
        var name: String
        var allowance: MemberAllowance
        var drawnAnnualCents: Int
        var expected: Outcome<MemberAllowanceInput>
    }

    struct LinkCase: Decodable, Sendable {
        var value: String
        var valid: Bool
        var normalised: String?
    }

    struct CadenceCase: Decodable, Sendable {
        var amountCents: Int
        var frequency: Frequency
        var interval: Int?
        var annualCents: Int
    }

    struct Fixture: Decodable, Sendable {
        var lines: [LineCase]
        var allowances: [AllowanceCase]
        var links: [LinkCase]
        var cadences: [CadenceCase]
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "budget-form-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test func lineFormsSaveWhatThePWAFormSaves() {
        for testCase in Self.fixture.lines {
            let form = BudgetLineFormState(initial: testCase.line, allowances: testCase.allowances)
            #expect(form.canSubmit == testCase.expected.canSubmit, "\(testCase.name)")
            #expect(form.input == testCase.expected.input, "\(testCase.name)")
        }
    }

    @Test func allowanceFormsSaveWhatThePWAFormSaves() {
        for testCase in Self.fixture.allowances {
            let form = MemberAllowanceFormState(
                initial: testCase.allowance, drawnAnnualCents: testCase.drawnAnnualCents)
            #expect(form.canSubmit == testCase.expected.canSubmit, "\(testCase.name)")
            #expect(form.input == testCase.expected.input, "\(testCase.name)")
        }
    }

    @Test func managementLinksNormaliseAsThePWADoes() {
        for link in Self.fixture.links {
            #expect(ManagementURL.isValid(link.value) == link.valid, "\(link.value.prefix(40))")
            #expect(ManagementURL.normalise(link.value) == link.normalised, "\(link.value.prefix(40))")
        }
    }

    @Test func amountsAnnualiseAsThePlanDoes() {
        for cadence in Self.fixture.cadences {
            #expect(
                cadence.frequency.annualCents(cadence.amountCents, interval: cadence.interval)
                    == cadence.annualCents)
        }
    }

    @Test func aGroupChangeClearsWhatTheNewGroupCannotCarry() {
        var form = BudgetLineFormState(
            defaultGroup: .discretionary, defaultAllowanceMemberId: "m1",
            allowances: [AllowanceChoice(memberId: "m1", name: "Ada’s allowance", remainingAnnualCents: 100)])
        form.destinationAccountId = "a1"
        #expect(form.drawnFrom != nil && !form.showsAccountPicker)
        form.setGroup(.savings)
        #expect(form.allowanceMemberId == nil && form.destinationAccountId == nil)
        #expect(form.showsGoalPicker && !form.showsAllowancePicker)
        form.goalId = "g1"
        form.setGroup(.needs)
        #expect(form.goalId == nil && form.showsAccountPicker)
    }

    @Test func aPromotedDraftSeedsANewDiscretionaryLine() {
        let form = BudgetLineFormState(
            draft: BudgetLineDraft(name: "New couch", amountCents: 3_500_00), defaultGroup: .discretionary)
        #expect(form.name == "New couch" && form.amount == "3500.00")
        #expect(form.group == .discretionary && form.frequency == .fortnightly)
        #expect(form.initial == nil)
    }

    @Test func aTemporaryItemNeedsANameAContributionAndADate() throws {
        var form = TemporaryItemFormState(today: "2026-11-19")
        #expect(form.targetDate == "2026-11-19" && !form.canSubmit)
        form.name = " Car rego "
        form.contribution = "40"
        let input = try #require(form.input)
        #expect(input == TemporaryItemInput(name: "Car rego", contributionCents: 40_00, targetDate: "2026-11-19"))
        form.targetDate = nil
        #expect(!form.canSubmit)
    }
}
