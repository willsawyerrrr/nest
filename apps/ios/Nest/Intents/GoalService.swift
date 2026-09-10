import Foundation

/// One goal in the `goal-progress` response.
struct GoalProgress: Decodable, Sendable {
    let name: String
    let savedCents: Int
    let targetCents: Int

    var isMet: Bool { savedCents >= targetCents }
}

/// Response body of the `goal-progress` edge function. `goals` is ordered so the
/// first entry is the one a spoken summary should lead with.
struct GoalProgressSummary: Decodable, Sendable {
    let goals: [GoalProgress]
    let totalSavedCents: Int
    let totalTargetCents: Int
}

enum GoalServiceError: Error {
    case http(status: Int)
}

/// Calls the `goal-progress` edge function with a caller access token and returns
/// the household's savings-goal progress. The transport is injected so tests can
/// stub the network.
struct GoalService: Sendable {
    var send: @Sendable (_ request: URLRequest) async throws -> (Data, URLResponse)

    static let live = GoalService { try await URLSession.shared.data(for: $0) }

    func progress(accessToken: String) async throws -> GoalProgressSummary {
        var request = URLRequest(
            url: SupabaseConfig.url.appendingPathComponent("functions/v1/goal-progress")
        )
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await send(request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw GoalServiceError.http(status: http.statusCode)
        }
        return try JSONDecoder().decode(GoalProgressSummary.self, from: data)
    }
}

/// Turns a savings-goal summary into one spoken sentence.
enum GoalProgressPhrasing {
    static func spokenSummary(_ summary: GoalProgressSummary) -> String {
        guard let lead = summary.goals.first else {
            return "You haven't set up any savings goals yet."
        }

        let total = BufferPhrasing.currency(summary.totalSavedCents)
        let totalTarget = BufferPhrasing.currency(summary.totalTargetCents)

        if summary.goals.count == 1 {
            if lead.isMet {
                return "You've met your \(lead.name) goal — \(total) saved."
            }
            return "You've saved \(total) of \(totalTarget) for \(lead.name)."
        }

        if summary.goals.allSatisfy(\.isMet) {
            return "You've met all \(summary.goals.count) of your savings goals — \(total) saved."
        }

        let closest = summary.goals.first { !$0.isMet } ?? lead
        return "You've saved \(total) of \(totalTarget) across \(summary.goals.count) goals. "
            + "\(closest.name) is at \(BufferPhrasing.currency(closest.savedCents)) of "
            + "\(BufferPhrasing.currency(closest.targetCents))."
    }
}

/// Full spoken response for the savings-goal query, resolving the access token
/// and mapping every failure to a useful sentence. Both dependencies are
/// injected so `perform()` stays a thin shell over testable code.
func goalProgressSpokenResponse(
    accessToken: @Sendable () async throws -> String,
    service: GoalService
) async -> String {
    let token: String
    do {
        token = try await accessToken()
    } catch {
        return "Open Nest and sign in to check your savings goals."
    }

    do {
        let summary = try await service.progress(accessToken: token)
        return GoalProgressPhrasing.spokenSummary(summary)
    } catch GoalServiceError.http(status: 401) {
        return "Open Nest and sign in to check your savings goals."
    } catch {
        return "Couldn't reach Nest just now. Try again in a moment."
    }
}
