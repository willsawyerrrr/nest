import Foundation
import Testing

@testable import Nest

@Suite struct HouseholdPresentationTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func household(code: String?, expires: String?) -> Household {
        let json = """
            {"id":"h","name":"Home","invite_code":\(code.map { "\"\($0)\"" } ?? "null"),\
            "invite_code_expires_at":\(expires.map { "\"\($0)\"" } ?? "null"),\
            "pay_account_id":null,"timezone":"Australia/Sydney",\
            "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
            """
        return try! JSONDecoder().decode(Household.self, from: Data(json.utf8))
    }

    @Test func expiryRoundsDaysUpAndFloorsAtOne() {
        func label(_ seconds: Double) -> String {
            HouseholdPresentation.expiryLabel(expiresAt: now.addingTimeInterval(seconds), now: now)
        }
        #expect(label(3_600) == "Expires within a day")
        #expect(label(86_400) == "Expires within a day")
        #expect(label(86_401) == "Expires in 2 days")
        #expect(label(2.5 * 86_400) == "Expires in 3 days")
        #expect(label(7 * 86_400) == "Expires in 7 days")
    }

    @Test func hintEndsWithTheExpiry() {
        #expect(
            HouseholdPresentation.activeHint(expiresAt: now.addingTimeInterval(3 * 86_400), now: now)
                == "Share this code with others so they can join your household. It works once and then expires. Expires in 3 days.")
    }

    @Test func anUnexpiredCodeIsActive() {
        let expires = ISO8601DateFormatter().string(from: now.addingTimeInterval(86_400))
        let invite = HouseholdPresentation.activeInvite(
            household(code: "ABC123", expires: expires), now: now)
        #expect(invite?.code == "ABC123")
    }

    @Test func anExpiredOrMissingCodeIsInactive() {
        let past = ISO8601DateFormatter().string(from: now.addingTimeInterval(-1))
        #expect(HouseholdPresentation.activeInvite(household(code: "A", expires: past), now: now) == nil)
        #expect(HouseholdPresentation.activeInvite(household(code: nil, expires: nil), now: now) == nil)
        #expect(
            HouseholdPresentation.activeInvite(household(code: "A", expires: nil), now: now) == nil)
    }

    @Test func parsesPostgresTimestamps() {
        #expect(HouseholdPresentation.date(from: "2026-01-01T00:00:00+00:00") != nil)
        #expect(HouseholdPresentation.date(from: "2026-01-01T00:00:00.123456+00:00") != nil)
        #expect(HouseholdPresentation.date(from: "nonsense") == nil)
    }
}
