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
/// Two independent threading problems, both worked around with plain GCD
/// rather than Swift Concurrency's actor system — that system is what keeps
/// going wrong here, on Mac Catalyst specifically:
///
/// 1. `run` being `nonisolated` (needed so the completion handler closure
///    below is never inferred `@MainActor` — see its own comment) means
///    `await`ing it from `AuthModel.signIn()`, a `@MainActor` method, runs
///    its body — including the synchronous `session.start()` call — on
///    Swift's background cooperative-thread-pool executor, not the main
///    thread. `ASWebAuthenticationSession.start()` needs the real main
///    thread (undocumented, but confirmed by this crashing at `.start()`
///    itself: `dispatch_assert_queue_fail`). Creating the session and
///    calling `.start()` inside an explicit `DispatchQueue.main.async` fixes
///    that regardless of which executor `run`'s own body happens to run on.
/// 2. `ASWebAuthenticationSession` delivers its completion handler on an XPC
///    reply thread (`com.apple.*.SafariLaunchAgent`) that Swift Concurrency's
///    own "is this the main executor?" check
///    (`swift_task_isCurrentExecutorWithFlagsImpl`) cannot correctly place —
///    resuming a suspended `Task` from it crashes the same way, regardless of
///    how the resuming closure itself is isolated (verified: even a
///    `nonisolated` method on a plain, non-`@MainActor` type crashes the same
///    way; only the XPC thread matters, not any Swift-side annotation).
///    Hopping to `DispatchQueue.main.async` before `continuation.resume`
///    ensures the resume always happens on a thread Dispatch and Swift
///    Concurrency agree is main.
///
/// Nesting the completion handler inside the outer `DispatchQueue.main.async`
/// block (rather than inside a `MainActor.run` or an `@MainActor` function)
/// matters: `DispatchQueue.async`'s closure parameter carries no actor
/// annotation, so the completion handler is never inferred `@MainActor` by
/// its lexical position — only an actually-`@MainActor`-typed enclosing
/// construct does that, which is what caused problem 2 in the first place.
private final class OAuthAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    nonisolated func run(url: URL, callbackURLScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.main.async {
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackURLScheme) {
                    callbackURL,
                    error in
                    DispatchQueue.main.async {
                        if let error {
                            continuation.resume(throwing: error)
                        } else if let callbackURL {
                            continuation.resume(returning: callbackURL)
                        } else {
                            continuation.resume(throwing: URLError(.badServerResponse))
                        }
                    }
                }
                session.presentationContextProvider = self
                session.start()
            }
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
