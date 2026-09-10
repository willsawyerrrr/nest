import Foundation

/// The matched budget line in the `budget-line` response.
struct BudgetLineMatch: Decodable, Sendable {
    let name: String
    let amountCents: Int
    let frequency: String
    let intervalCount: Int?
    let fortnightlyCents: Int
    let annualCents: Int
}

/// Response body of the `budget-line` edge function: the best name match (or
/// `nil`), and every budget line name so a miss can say what exists.
struct BudgetLineResponse: Decodable, Sendable {
    let match: BudgetLineMatch?
    let names: [String]
}

enum BudgetLineServiceError: Error {
    case http(status: Int)
}

/// Calls the `budget-line` edge function with a caller access token and the
/// spoken query. The transport is injected so tests can stub the network.
struct BudgetLineService: Sendable {
    var send: @Sendable (_ request: URLRequest) async throws -> (Data, URLResponse)

    static let live = BudgetLineService { try await URLSession.shared.data(for: $0) }

    func lookUp(query: String, accessToken: String) async throws -> BudgetLineResponse {
        var request = URLRequest(
            url: SupabaseConfig.url.appendingPathComponent("functions/v1/budget-line")
        )
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["query": query])

        let (data, response) = try await send(request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw BudgetLineServiceError.http(status: http.statusCode)
        }
        return try JSONDecoder().decode(BudgetLineResponse.self, from: data)
    }
}

/// Turns a `budget-line` response into one spoken sentence.
enum BudgetLinePhrasing {
    /// A planned amount in its own cadence: "$200.00 per week", "$50.00 per
    /// fortnight", "$300.00 every 26 weeks".
    static func perPeriod(amountCents: Int, frequency: String, intervalCount: Int?) -> String {
        let amount = BufferPhrasing.currency(amountCents)
        switch frequency {
        case "weekly": return "\(amount) per week"
        case "fortnightly": return "\(amount) per fortnight"
        case "monthly": return "\(amount) per month"
        case "quarterly": return "\(amount) per quarter"
        case "biannual": return "\(amount) twice a year"
        case "annual": return "\(amount) per year"
        case "every_n_weeks":
            return everyN(intervalCount, unit: "week").map { "\(amount) \($0)" }
                ?? "\(amount) per fortnight"
        case "every_n_months":
            return everyN(intervalCount, unit: "month").map { "\(amount) \($0)" }
                ?? "\(amount) per month"
        default:
            return "\(amount) per fortnight"
        }
    }

    /// "every week" / "every 4 weeks", or `nil` for an absent or non-positive count.
    private static func everyN(_ count: Int?, unit: String) -> String? {
        guard let count, count >= 1 else { return nil }
        return count == 1 ? "every \(unit)" : "every \(count) \(unit)s"
    }

    static func spokenSummary(_ response: BudgetLineResponse, query: String) -> String {
        guard let match = response.match else {
            if response.names.isEmpty {
                return "You haven't set up any budget lines yet."
            }
            return "I couldn't find a budget for \(query). "
                + "You have: \(response.names.joined(separator: ", "))."
        }

        let figure = perPeriod(
            amountCents: match.amountCents,
            frequency: match.frequency,
            intervalCount: match.intervalCount
        )
        return "You've budgeted \(figure) for \(match.name)."
    }
}

/// Full spoken response for the budget query, resolving the access token and
/// mapping every failure to a useful sentence. Both dependencies are injected
/// so `perform()` stays a thin shell over testable code.
func budgetLineSpokenResponse(
    query: String,
    accessToken: @Sendable () async throws -> String,
    service: BudgetLineService
) async -> String {
    let token: String
    do {
        token = try await accessToken()
    } catch {
        return "Open Nest and sign in to check your budget."
    }

    do {
        let response = try await service.lookUp(query: query, accessToken: token)
        return BudgetLinePhrasing.spokenSummary(response, query: query)
    } catch BudgetLineServiceError.http(status: 401) {
        return "Open Nest and sign in to check your budget."
    } catch {
        return "Couldn't reach Nest just now. Try again in a moment."
    }
}
