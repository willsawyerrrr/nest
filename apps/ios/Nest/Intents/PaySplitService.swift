import Foundation

/// One account's fortnightly figure in the `pay-split` response.
struct PaySplitAccount: Decodable, Sendable, Equatable {
    let accountId: String
    let name: String
    let fortnightlyCents: Int
}

/// Response body of the `pay-split` edge function: the recommended transfers out
/// of the pay account, the accounts whose amount stays put, and what is unrouted.
struct PaySplitSummary: Decodable, Sendable {
    let hasPayAccount: Bool
    let splits: [PaySplitAccount]
    let totalCents: Int
    let stays: [PaySplitAccount]
    let unassignedFortnightlyCents: Int
}

enum PaySplitServiceError: Error {
    case http(status: Int)
}

/// Calls the `pay-split` edge function with a caller access token and returns the
/// household's recommended pay splits. The transport is injected so tests can
/// stub the network.
struct PaySplitService: Sendable {
    var send: @Sendable (_ request: URLRequest) async throws -> (Data, URLResponse)

    static let live = PaySplitService { try await URLSession.shared.data(for: $0) }

    func summary(accessToken: String) async throws -> PaySplitSummary {
        var request = URLRequest(
            url: SupabaseConfig.url.appendingPathComponent("functions/v1/pay-split")
        )
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await send(request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw PaySplitServiceError.http(status: http.statusCode)
        }
        return try JSONDecoder().decode(PaySplitSummary.self, from: data)
    }
}

/// Turns a pay-split summary into one spoken sentence.
enum PaySplitPhrasing {
    static func spokenSummary(_ summary: PaySplitSummary) -> String {
        let unassigned = summary.unassignedFortnightlyCents > 0
            ? " \(BufferPhrasing.currency(summary.unassignedFortnightlyCents)) more isn't routed to an account yet."
            : ""

        if summary.splits.isEmpty {
            if summary.stays.isEmpty && !unassigned.isEmpty {
                return "None of your budget is routed to an account yet, so there's no pay split. "
                    + "Set a funding account on your budget items in Nest."
            }
            if summary.stays.isEmpty {
                return "You haven't set up a pay split yet. Route your budget items to accounts in Nest."
            }
            if !summary.hasPayAccount {
                return "Choose the account your pay lands in, in Nest, to see your pay split."
                    + unassigned
            }
            return "Everything stays in your pay account, so there's nothing to transfer." + unassigned
        }

        let parts = summary.splits.map {
            "\(BufferPhrasing.currency($0.fortnightlyCents)) to \($0.name)"
        }
        let list: String
        if parts.count == 1 {
            list = parts[0]
        } else {
            list = parts.dropLast().joined(separator: ", ") + " and " + parts[parts.count - 1]
        }
        let total = parts.count > 1
            ? ", \(BufferPhrasing.currency(summary.totalCents)) in total"
            : ""
        return "Each fortnight, send \(list)\(total)." + unassigned
    }
}

/// What the pay-split query yields: the sentence to speak and the splits behind it.
struct PaySplitOutcome: Sendable {
    let sentence: String
    let splits: [PaySplitAccount]
}

/// Full response for the pay-split query, resolving the access token and mapping
/// every failure to a useful sentence. Both dependencies are injected so
/// `perform()` stays a thin shell over testable code.
func paySplitResponse(
    accessToken: @Sendable () async throws -> String,
    service: PaySplitService
) async -> PaySplitOutcome {
    let signIn = PaySplitOutcome(
        sentence: "Open Nest and sign in to check your pay split.", splits: []
    )
    let token: String
    do {
        token = try await accessToken()
    } catch {
        return signIn
    }

    do {
        let summary = try await service.summary(accessToken: token)
        return PaySplitOutcome(
            sentence: PaySplitPhrasing.spokenSummary(summary), splits: summary.splits
        )
    } catch PaySplitServiceError.http(status: 401) {
        return signIn
    } catch {
        return PaySplitOutcome(
            sentence: "Couldn't reach Nest just now. Try again in a moment.", splits: []
        )
    }
}
