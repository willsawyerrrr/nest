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
    /// convenience, which nests its `ASWebAuthenticationSession` completion
    /// handler inside a `@MainActor` closure. `ASWebAuthenticationSession`
    /// delivers that handler on an XPC queue
    /// (`com.apple.*.SafariLaunchAgent`), and resuming a continuation the
    /// compiler infers as `@MainActor`-isolated from that queue crashes with
    /// `dispatch_assert_queue_fail` on Mac Catalyst — a known Swift
    /// Concurrency/AuthenticationServices interaction, not something a retry
    /// or presentation tweak works around. `OAuthAuthenticator` below is a
    /// plain, non-actor-isolated type so its closures are never inferred
    /// `@MainActor` in the first place.
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
/// Deliberately not `@MainActor` and not nested inside any actor-isolated
/// closure (see `AuthModel.signIn()`), so neither the completion handler nor
/// `presentationAnchor(for:)` is inferred `@MainActor` — that inference is
/// what makes resuming the continuation from `ASWebAuthenticationSession`'s
/// XPC callback queue fatal. `presentationAnchor(for:)` is still called on the
/// main thread in practice, so `MainActor.assumeIsolated` there is safe; it
/// only avoids the *inferred-isolation* trap, not main-thread work itself.
private final class OAuthAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    func run(url: URL, callbackURLScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackURLScheme) {
                callbackURL,
                error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: URLError(.badServerResponse))
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
