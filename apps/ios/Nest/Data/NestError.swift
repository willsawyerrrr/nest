import Foundation

/// Every failure the data layer surfaces. `code` is stable and safe to log or
/// branch on; `userMessage` is fixed copy per code. Upstream bodies and
/// messages never reach the user, and are not kept.
struct NestError: Error, Equatable, Sendable {
    enum Code: String, CaseIterable, Sendable {
        case unauthenticated
        case forbidden
        case notFound = "not_found"
        case conflict
        case invalidRequest = "invalid_request"
        case rateLimited = "rate_limited"
        case offline
        case timeout
        case server
        case decoding
        case unknown
    }

    let code: Code
    /// HTTP status of the upstream response, when there was one.
    let status: Int?
    /// Upstream error `code` (a PostgREST/Postgres SQLSTATE or edge-function code), for diagnostics only.
    let upstreamCode: String?

    init(_ code: Code, status: Int? = nil, upstreamCode: String? = nil) {
        self.code = code
        self.status = status
        self.upstreamCode = upstreamCode
    }

    /// Fixed copy for `code`.
    var userMessage: String {
        switch code {
        case .unauthenticated: "Your session has expired. Sign in again to continue."
        case .forbidden: "You don't have access to that."
        case .notFound: "We couldn't find that. It may have been removed."
        case .conflict: "That conflicts with something that already exists."
        case .invalidRequest: "That change isn't valid. Check it and try again."
        case .rateLimited: "Too many requests. Try again in a moment."
        case .offline: "You're offline. Check your connection and try again."
        case .timeout: "Nest took too long to respond. Try again."
        case .server: "Something went wrong on our side. Try again in a moment."
        case .decoding:
            "Nest sent something this version of the app can't read. Update the app and try again."
        case .unknown: "Something went wrong. Try again."
        }
    }

    /// Maps a non-2xx response. The status decides the code, except where the
    /// upstream `code` is more specific (an expired JWT, a Postgres constraint
    /// or permission class).
    static func response(status: Int, body: Data) -> NestError {
        let upstream = UpstreamBody(body)
        let code: Code
        switch (status, upstream.code) {
        case (_, "PGRST301"), (_, "PGRST303"): code = .unauthenticated
        case (_, "42501"): code = .forbidden
        case (_, "23505"): code = .conflict
        case (_, let c?) where c.hasPrefix("23") || c.hasPrefix("22"): code = .invalidRequest
        case (401, _): code = .unauthenticated
        case (403, _): code = .forbidden
        case (404, _), (406, _): code = .notFound
        case (409, _): code = .conflict
        case (408, _), (504, _): code = .timeout
        case (429, _): code = .rateLimited
        case (400..<500, _): code = .invalidRequest
        case (500..., _): code = .server
        default: code = .unknown
        }
        return NestError(code, status: status, upstreamCode: upstream.code)
    }

    /// Maps any thrown error: a `NestError` passes through, `URLError`s become
    /// network codes, `DecodingError` becomes `.decoding`, and a cancelled task
    /// stays a `CancellationError`.
    static func from(_ error: Error) -> Error {
        switch error {
        case let error as NestError: return error
        case is CancellationError: return error
        case let error as URLError:
            switch error.code {
            case .cancelled: return CancellationError()
            case .timedOut: return NestError(.timeout)
            default: return NestError(.offline)
            }
        case is DecodingError: return NestError(.decoding)
        default: return NestError(.unknown)
        }
    }
}

/// The JSON error shapes upstream services use: PostgREST (`code`), Storage
/// (`statusCode`) and edge functions (`code` or bare `error`). Only a code is
/// read; message text is ignored.
private struct UpstreamBody {
    let code: String?

    init(_ data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            code = nil
            return
        }
        code = object["code"] as? String
    }
}
