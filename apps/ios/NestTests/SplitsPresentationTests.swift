import Foundation
import Testing

@testable import Nest

@Suite struct SplitsPresentationTests {
    @Test func roundsUpToTheNextFiveDollarsNeverBelow() {
        #expect(SplitsPresentation.roundCentsUp(300_00) == 300_00)
        #expect(SplitsPresentation.roundCentsUp(300_01) == 305_00)
        #expect(SplitsPresentation.roundCentsUp(0) == 0)
        #expect(SplitsPresentation.roundCentsUp(123, step: 0) == 123)
    }

    @Test func aNeverConfirmedSplitAlwaysNeedsAnUpdate() {
        #expect(SplitsPresentation.needsUpdate(300_00, configured: nil))
        #expect(SplitsPresentation.needsUpdate(300_00, configured: 295_00))
        #expect(!SplitsPresentation.needsUpdate(300_00, configured: 300_00))
    }

    @Test func withAPayAccountEveryOtherAccountIsRecommended() {
        #expect(
            SplitsPresentation.isRecommended(isPayAccount: false, isSaver: false, hasPayAccount: true))
        #expect(
            !SplitsPresentation.isRecommended(isPayAccount: true, isSaver: false, hasPayAccount: true))
        #expect(
            SplitsPresentation.isRecommended(isPayAccount: false, isSaver: true, hasPayAccount: false))
        #expect(
            !SplitsPresentation.isRecommended(
                isPayAccount: false, isSaver: false, hasPayAccount: false))
    }

    @Test func readsAnAccountsLeadingEmoji() {
        #expect(SplitsPresentation.emoji(of: "✈️ Japan") == "✈️")
        #expect(SplitsPresentation.emoji(of: "Bills") == nil)
        #expect(SplitsPresentation.emoji(of: "🏠") == nil)
    }

    private func row(_ id: String, _ label: String, exact: Int) -> SplitRow {
        SplitRow(
            id: id, emoji: nil, label: label, deletedAtSource: false, exactCents: exact,
            roundedCents: exact, configuredCents: nil, needsUpdate: true, lines: [])
    }

    @Test func sortsByTitleOrAmountAndReversesForDescending() {
        let rows = [row("1", "Bravo", exact: 5), row("2", "alpha", exact: 9), row("3", "Charlie", exact: 5)]
        #expect(
            SplitsPresentation.sorted(rows, by: .title, ascending: true).map(\.id) == ["2", "1", "3"])
        #expect(
            SplitsPresentation.sorted(rows, by: .title, ascending: false).map(\.id) == ["3", "1", "2"])
        // Equal amounts keep routing order; descending reverses the whole order.
        #expect(
            SplitsPresentation.sorted(rows, by: .amount, ascending: true).map(\.id) == ["1", "3", "2"])
        #expect(
            SplitsPresentation.sorted(rows, by: .amount, ascending: false).map(\.id) == ["2", "3", "1"])
    }

    @Test func labelsTheDriftLineAndItsAction() {
        let drifted = SplitRow(
            id: "a", emoji: nil, label: "Japan", deletedAtSource: false, exactCents: 396_00,
            roundedCents: 400_00, configuredCents: 350_00, needsUpdate: true, lines: [])
        #expect(drifted.driftNote == "was $350.00 → $400.00 / fn")
        #expect(drifted.confirmLabel == "Confirm")
        #expect(drifted.exactNote == "$396.00 exact")
        let unset = SplitRow(
            id: "a", emoji: nil, label: "Japan", deletedAtSource: false, exactCents: 400_00,
            roundedCents: 400_00, configuredCents: nil, needsUpdate: true, lines: [])
        #expect(unset.driftNote == "Not set yet")
        #expect(unset.confirmLabel == "Mark as set")
        #expect(unset.exactNote == nil)
    }

    @Test func aClearedPayAccountEncodesAsAnExplicitNull() throws {
        let json = try JSONEncoder().encode(PayAccountParams(accountID: nil))
        #expect(String(decoding: json, as: UTF8.self) == #"{"p_account_id":null}"#)
    }
}
