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
/// On Mac Catalyst, `ASWebAuthenticationSession` delivers its completion
/// handler on an XPC reply thread (`com.apple.*.SafariLaunchAgent`) that Swift
/// Concurrency's own "is this the main executor?" check
/// (`swift_task_isCurrentExecutorWithFlagsImpl`) cannot correctly place —
/// resuming a suspended `Task` from it crashes with `dispatch_assert_queue_fail`
/// regardless of how the resuming closure itself is isolated (verified: even a
/// `nonisolated` method on a plain, non-`@MainActor` type crashes the same
/// way; only the XPC thread matters, not any Swift-side annotation). The fix
/// is to never let a continuation resume ON that thread: hop to the real main
/// queue with `DispatchQueue.main.async` first, so by the time
/// `continuation.resume` runs, the thread it runs on is unambiguously the one
/// Dispatch and Swift Concurrency agree is main.
private final class OAuthAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    /// `nonisolated` as defense in depth — verified it makes no observable
    /// difference to the crash on its own (the XPC thread is the problem, not
    /// this method's isolation) — but there is no reason to leave it inferred.
    nonisolated func run(url: URL, callbackURLScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
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

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}
