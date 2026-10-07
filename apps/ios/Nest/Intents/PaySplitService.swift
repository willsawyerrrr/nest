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

/// What loading the pay split yielded.
enum PaySplitLoad: Sendable {
    case summary(PaySplitSummary)
    case signedOut
    case unreachable
}

/// Resolves the access token and loads the summary, folding every failure into a
/// case. Both dependencies are injected so callers stay thin shells over
/// testable code.
func paySplitLoad(
    accessToken: @Sendable () async throws -> String,
    service: PaySplitService
) async -> PaySplitLoad {
    let token: String
    do {
        token = try await accessToken()
    } catch {
        return .signedOut
    }

    do {
        return .summary(try await service.summary(accessToken: token))
    } catch PaySplitServiceError.http(status: 401) {
        return .signedOut
    } catch {
        return .unreachable
    }
}

/// Turns one account's place in the pay split into a spoken sentence.
enum PaySplitPhrasing {
    static func spokenAnswer(_ summary: PaySplitSummary, accountId: String, name: String) -> String {
        if let split = summary.splits.first(where: { $0.accountId == accountId }) {
            return "\(BufferPhrasing.currency(split.fortnightlyCents)) goes to \(split.name) each fortnight."
        }
        if !summary.hasPayAccount && !summary.stays.isEmpty {
            return "Choose the account your pay lands in, in Nest, to see your pay split."
        }
        if summary.stays.contains(where: { $0.accountId == accountId }) {
            return "\(name) is your pay account, so nothing is transferred to it."
        }
        if summary.splits.isEmpty && summary.stays.isEmpty {
            return "You haven't set up a pay split yet. Route your budget items to accounts in Nest."
        }
        return "Nothing is routed to \(name) yet. Set it as a budget item's funding account in Nest."
    }
}

/// What the pay-split query yields: the sentence to speak and the account's split,
/// when it has one.
struct PaySplitOutcome: Sendable {
    let sentence: String
    let split: PaySplitAccount?
}

/// Full response for one account's pay split, mapping every failure to a useful
/// sentence.
func paySplitResponse(
    accountId: String,
    name: String,
    accessToken: @Sendable () async throws -> String,
    service: PaySplitService
) async -> PaySplitOutcome {
    switch await paySplitLoad(accessToken: accessToken, service: service) {
    case .signedOut:
        return PaySplitOutcome(
            sentence: "Open Nest and sign in to check your pay split.", split: nil
        )
    case .unreachable:
        return PaySplitOutcome(
            sentence: "Couldn't reach Nest just now. Try again in a moment.", split: nil
        )
    case .summary(let summary):
        return PaySplitOutcome(
            sentence: PaySplitPhrasing.spokenAnswer(summary, accountId: accountId, name: name),
            split: summary.splits.first { $0.accountId == accountId }
        )
    }
}
