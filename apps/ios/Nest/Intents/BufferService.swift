import Foundation

/// Response body of the `intent-summary` edge function.
struct IntentSummary: Decodable, Sendable {
    let fortnightlyAfterSavingCents: Int
}

enum BufferServiceError: Error {
    case http(status: Int)
}

/// Calls the `intent-summary` edge function with a caller access token and
/// returns the household's fortnightly after-saving buffer in cents.
///
/// The transport is injected so tests can stub the network.
struct BufferService: Sendable {
    var send: @Sendable (_ request: URLRequest) async throws -> (Data, URLResponse)

    static let live = BufferService { try await URLSession.shared.data(for: $0) }

    func fortnightlyAfterSavingCents(accessToken: String) async throws -> Int {
        var request = URLRequest(
            url: SupabaseConfig.url.appendingPathComponent("functions/v1/intent-summary")
        )
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await send(request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw BufferServiceError.http(status: http.statusCode)
        }
        return try JSONDecoder().decode(IntentSummary.self, from: data).fortnightlyAfterSavingCents
    }
}

/// Turns a signed cents figure into one spoken sentence.
enum BufferPhrasing {
    static func spokenSummary(fortnightlyAfterSavingCents cents: Int) -> String {
        let amount = currency(abs(cents))
        if cents < 0 {
            return "Your fortnightly plan is over budget by \(amount) after saving."
        }
        return "Your fortnightly buffer is \(amount) after saving."
    }

    static func currency(_ cents: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: "en_AU")
        let dollars = Decimal(cents) / 100
        return formatter.string(from: dollars as NSDecimalNumber) ?? "$\(dollars)"
    }
}

/// Full spoken response for the buffer query, resolving the access token and
/// mapping every failure to a useful sentence. Both dependencies are injected
/// so `perform()` stays a thin shell over testable code.
func bufferQuerySpokenResponse(
    accessToken: @Sendable () async throws -> String,
    service: BufferService
) async -> String {
    let token: String
    do {
        token = try await accessToken()
    } catch {
        return "Open Nest and sign in to check your buffer."
    }

    do {
        let cents = try await service.fortnightlyAfterSavingCents(accessToken: token)
        return BufferPhrasing.spokenSummary(fortnightlyAfterSavingCents: cents)
    } catch BufferServiceError.http(status: 401) {
        return "Open Nest and sign in to check your buffer."
    } catch {
        return "Couldn't reach Nest just now. Try again in a moment."
    }
}
