import AuthenticationServices
import Foundation
import Observation
import UIKit

/// Observable wrapper around `supabaseAuth` for the SwiftUI layer: a coarse
/// session state plus the Google OAuth entry point.
///
/// The native app owns the one Supabase session for the whole product — the
/// embedded web app included — so this drives a blocking sign-in gate, and the
/// web view is handed the same session (see `WebView.swift`).
@MainActor
@Observable
final class AuthModel {
    enum SessionState: Equatable {
        /// The Keychain has not been read yet.
        case unknown
        case signedOut
        case signedIn
    }

    private(set) var state: SessionState = .unknown

    /// The last sign-in failure, if any, for the sign-in screen to show.
    private(set) var lastError: String?

    private var observation: Task<Void, Never>?

    /// Mirrors `supabaseAuth`'s session into `state` for the lifetime of the
    /// app. `authStateChanges` emits an initial value immediately (the restore
    /// on launch) and again on every token refresh and sign-out — including the
    /// sign-out the web view asks for.
    func start() {
        guard observation == nil else { return }
        observation = Task { [weak self] in
            for await (_, session) in supabaseAuth.authStateChanges {
                self?.state = session == nil ? .signedOut : .signedIn
            }
        }
    }

    /// Runs Google OAuth in an `ASWebAuthenticationSession` and persists the
    /// resulting session to the Keychain.
    ///
    /// Drives the flow by hand — `getOAuthSignInURL` plus `session(from:)` —
    /// rather than `supabaseAuth`'s own `signInWithOAuth(provider:redirectTo:…)`
    /// convenience. See `OAuthAuthenticator` below for why: resuming the
    /// underlying continuation directly from `ASWebAuthenticationSession`'s
    /// XPC callback thread crashes with `dispatch_assert_queue_fail` on Mac
    /// Catalyst, and neither version — the convenience method's nor a
    /// hand-rolled one — avoids it just by tweaking Swift actor-isolation
    /// annotations.
    func signIn() async {
        lastError = nil
        do {
            guard let scheme = SupabaseConfig.authCallback.scheme else {
                lastError = "The OAuth callback URL has no scheme."
                return
            }
            let authURL = try supabaseAuth.getOAuthSignInURL(
                provider: .google,
                redirectTo: SupabaseConfig.authCallback
            )
            let callbackURL = try await OAuthAuthenticator().run(url: authURL, callbackURLScheme: scheme)
            _ = try await supabaseAuth.session(from: callbackURL)
            state = .signedIn
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The member dismissed the sign-in sheet.
        } catch {
            lastError = error.localizedDescription
        }
    }
}

/// Runs one OAuth round trip in `ASWebAuthenticationSession` and resolves with
/// the resulting callback URL.
///
/// `session.start()` needs the real main thread (confirmed by an earlier
/// crash at that exact call when `run`'s body ran on Swift's background
/// cooperative-thread-pool executor instead) — `DispatchQueue.main.async`
/// around session creation guarantees that regardless of which executor
/// `run` itself happens to run on.
///
/// The completion handler is the harder problem. `ASWebAuthenticationSession`
/// delivers it on an XPC reply thread, and merely *entering* a closure
/// literal written inline here — regardless of `nonisolated` on `run`, and
/// regardless of whether the closure's own first statement is a plain
/// `DispatchQueue.main.async` hop — crashes with `dispatch_assert_queue_fail`
/// on Mac Catalyst: the compiler still attaches actor-isolation-preserving
/// instrumentation to a closure literal lexically written inside a function
/// whose call chain traces back to `@MainActor` code, and that
/// instrumentation — not any dispatch queue the callback body itself touches
/// — is what traps. The confirmed community workaround (Apple Developer
/// Forums thread 783897) is to have the closure do nothing but forward to a
/// genuinely separate `nonisolated` function — not a nested closure — which
/// resumes the continuation directly and synchronously, no `DispatchQueue`
/// hop at all: `CheckedContinuation.resume` is documented safe from any
/// thread, so there was never a need to land back on main for it specifically
/// — only the compiler's closure-literal instrumentation needed avoiding.
private final class OAuthAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    nonisolated func run(url: URL, callbackURLScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.main.async {
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackURLScheme) {
                    callbackURL,
                    error in
                    OAuthAuthenticator.resume(continuation, callbackURL: callbackURL, error: error)
                }
                session.presentationContextProvider = self
                session.start()
            }
        }
    }

    /// A genuinely separate function, not a closure literal — the whole
    /// point (see `run`'s comment).
    nonisolated private static func resume(
        _ continuation: CheckedContinuation<URL, Error>,
        callbackURL: URL?,
        error: Error?
    ) {
        if let error {
            continuation.resume(throwing: error)
        } else if let callbackURL {
            continuation.resume(returning: callbackURL)
        } else {
            continuation.resume(throwing: URLError(.badServerResponse))
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}
