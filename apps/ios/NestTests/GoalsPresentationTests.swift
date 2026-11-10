import Foundation
import Testing

@testable import Nest

@Suite struct GoalsPresentationTests {
    @Test func aMovedFigureReadsRealToProposedWithItsChange() {
        #expect(GoalsPresentation.compare(baseline: 100_00, proposed: 100_00).text == "$100.00")
        #expect(
            GoalsPresentation.compare(baseline: 100_00, proposed: 125_50).text
                == "$100.00 \u{2192} $125.50 (+$25.50)")
        #expect(
            GoalsPresentation.compare(baseline: 100_00, proposed: 75_00).text
                == "$100.00 \u{2192} $75.00 (\u{2212}$25.00)")
    }

    @Test func aMovedEtaReadsDaysSoonerOrLater() {
        #expect(
            GoalsPresentation.compareDate(baseline: "2028-06-13", proposed: "2028-06-13").text
                == "13 Jun 2028")
        #expect(
            GoalsPresentation.compareDate(baseline: "2028-06-13", proposed: "2028-06-10").text
                == "13 Jun 2028 \u{2192} 10 Jun 2028 (3 days sooner)")
        #expect(
            GoalsPresentation.compareDate(baseline: "2028-06-13", proposed: "2028-06-14").text
                == "13 Jun 2028 \u{2192} 14 Jun 2028 (1 day later)")
        #expect(
            GoalsPresentation.compareDate(baseline: nil, proposed: "2028-06-14").text
                == "no ETA \u{2192} 14 Jun 2028")
    }

    @Test func dropsOntoTheTargetRowAsTheDragKitDoes() {
        let ids = ["a", "b", "c", "d"]
        #expect(GoalsPresentation.nextQueueOrder(ids, dragged: "a", over: "c") == ["b", "c", "a", "d"])
        #expect(GoalsPresentation.nextQueueOrder(ids, dragged: "d", over: "b") == ["a", "d", "b", "c"])
        #expect(GoalsPresentation.nextQueueOrder(ids, dragged: "a", over: "a") == nil)
        #expect(GoalsPresentation.nextQueueOrder(ids, dragged: "a", over: "z") == nil)
    }

    @Test func notesTheAssumedRateOnlyWhenOneIsModelled() {
        #expect(GoalsPresentation.rateNote(bps: 450) == "4.50% p.a. assumed")
        #expect(GoalsPresentation.rateNote(bps: 0) == nil)
        #expect(GoalsPresentation.rateNote(bps: nil) == nil)
    }

    @Test func percentCapsAtTheWholeAndTakesAZeroTargetAsMet() {
        #expect(GoalsPresentation.percent(target: 100, balance: 250) == 100)
        #expect(GoalsPresentation.percent(target: 0, balance: 0) == 100)
        #expect(GoalsPresentation.percent(target: 200, balance: 50) == 25)
    }

    @Test func pluralisesFortnights() {
        #expect(GoalsPresentation.fortnights(1) == "1 fortnight")
        #expect(GoalsPresentation.fortnights(40) == "40 fortnights")
    }
}

@Suite struct GoalDraftTests {
    @Test func readsDollarsAndPercentsAsTheForm() {
        #expect(GoalDraft.cents("$1,234.56") == 123_456)
        #expect(GoalDraft.cents("") == nil)
        #expect(GoalDraft.cents("abc") == nil)
        #expect(GoalDraft.basisPoints("4.5") == 450)
        #expect(GoalDraft.basisPoints("") == nil)
        #expect(GoalDraft.dollars(123_450) == "1234.50")
        #expect(GoalDraft.percent(450) == "4.5")
        #expect(GoalDraft.percent(300) == "3")
    }

    @Test func needsANameAndATarget() {
        var draft = GoalDraft()
        #expect(!draft.canSubmit)
        draft.name = "  Car "
        #expect(!draft.canSubmit)
        draft.targetAmount = "5000"
        #expect(draft.canSubmit)
        let input = draft.input(queuePosition: 2)
        #expect(input.name == "Car")
        #expect(input.targetAmountCents == 500_000)
        #expect(input.currentBalanceCents == 0)
        #expect(input.queuePosition == 2)
        #expect(input.targetDate == nil && input.plannedContributionCents == nil)
    }

    @Test func linkingASaverNamesAnUnnamedGoalOnly() {
        let account = AccountWithBalance.fixture(id: "s1", name: "Rainy day")
        let saver = GoalSaver(account)!
        var draft = GoalDraft()
        draft.link(saver)
        #expect(draft.name == "Rainy day" && draft.linkedAccountID == "s1")
        draft.name = "Mine"
        draft.link(saver)
        #expect(draft.name == "Mine")
    }

    @Test func theInputEncodesEveryKeyIncludingNulls() throws {
        let json = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(GoalDraft().input(queuePosition: nil))) as! [String: Any]
        #expect(
            Set(json.keys) == [
                "name", "target_amount_cents", "target_date", "current_balance_cents",
                "linked_account_id", "annual_interest_bps", "queue_position",
                "planned_contribution_cents",
            ])
        #expect(json["target_date"] is NSNull)
    }
}

extension AccountWithBalance {
    static func fixture(id: String, name: String, balance: Int = 0) -> AccountWithBalance {
        let json = """
            {"balance_cents":\(balance),"created_at":"2026-01-01T00:00:00Z","currency":"AUD",\
            "deleted_from_source_at":null,"exclude_from_net_worth":false,"external_id":null,\
            "household_id":"h","id":"\(id)","name":"\(name)","owner_member_id":null,\
            "source":"up","type":"savings","updated_at":"2026-01-01T00:00:00Z"}
            """
        return try! JSONDecoder().decode(AccountWithBalance.self, from: Data(json.utf8))
    }
}
