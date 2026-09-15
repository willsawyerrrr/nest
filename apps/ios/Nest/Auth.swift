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

    /// Whether a sign-in attempt is in flight, for the sign-in screen's
    /// button. `signIn()` is not `async` (see its own comment), so this
    /// replaces what would otherwise be a caller-side `await`-bracketed
    /// `@State` flag.
    private(set) var isSigningIn = false

    private var observation: Task<Void, Never>?
    private var authenticator: OAuthAuthenticator?

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

    /// Starts Google OAuth in an `ASWebAuthenticationSession`.
    ///
    /// Deliberately not `async`, and deliberately never resumes a
    /// pre-existing suspended `Task`/`CheckedContinuation` from
    /// `ASWebAuthenticationSession`'s completion handler — see
    /// `OAuthAuthenticator`'s comment for the four things that were tried and
    /// failed before landing on this shape. `OAuthAuthenticator.start`'s
    /// completion closure spawns a *fresh* `Task` instead, which sidesteps
    /// the problem entirely: creating a new task from an arbitrary thread is
    /// an ordinary, well-supported operation, unlike resuming one that
    /// already exists.
    func signIn() {
        lastError = nil
        isSigningIn = true
        guard let scheme = SupabaseConfig.authCallback.scheme else {
            lastError = "The OAuth callback URL has no scheme."
            isSigningIn = false
            return
        }
        let authURL: URL
        do {
            authURL = try supabaseAuth.getOAuthSignInURL(
                provider: .google,
                redirectTo: SupabaseConfig.authCallback
            )
        } catch {
            lastError = error.localizedDescription
            isSigningIn = false
            return
        }

        let authenticator = OAuthAuthenticator()
        self.authenticator = authenticator
        authenticator.start(url: authURL, callbackURLScheme: scheme) { [weak self] result in
            Task { @MainActor in
                self?.completeSignIn(with: result)
            }
        }
    }

    /// Runs on a freshly spawned `Task`, on the main actor, once
    /// `OAuthAuthenticator` has already safely crossed back from
    /// `ASWebAuthenticationSession`'s XPC callback thread. Persists the
    /// resulting session to the Keychain via `session(from:)`.
    private func completeSignIn(with result: Result<URL, Error>) {
        authenticator = nil
        Task {
            defer { isSigningIn = false }
            do {
                let callbackURL = try result.get()
                _ = try await supabaseAuth.session(from: callbackURL)
                state = .signedIn
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                // The member dismissed the sign-in sheet.
            } catch {
                lastError = error.localizedDescription
            }
        }
    }
}

/// Runs one OAuth round trip in `ASWebAuthenticationSession` and reports the
/// resulting callback URL via a plain completion handler — never `async`,
/// never a `CheckedContinuation`.
///
/// Four different fixes were tried and each one crashed identically
/// (`dispatch_assert_queue_fail`, Mac Catalyst only) when
/// `ASWebAuthenticationSession`'s completion handler — delivered on an XPC
/// reply thread — tried to resume a `CheckedContinuation` back into the
/// `Task` that was suspended awaiting it: `nonisolated` on the resuming
/// function, hopping to `DispatchQueue.main.async` before the resume, running
/// `session.start()` on the main queue, and routing the resume through a
/// genuinely separate `nonisolated` function (a fix confirmed working for
/// someone else's build, per Apple Developer Forums thread 783897) all made
/// no difference. The common thread across every failure: something about
/// `continuation.resume` itself — not the isolation of whatever calls it —
/// keeps checking whether the calling thread matches the executor the
/// original `withCheckedContinuation` call was made under, and that check is
/// what traps on Mac Catalyst when the calling thread is the XPC one.
///
/// So this type never creates a `CheckedContinuation` that crosses the XPC
/// boundary at all. `start`'s completion parameter is a plain, ordinary
/// closure with no Swift Concurrency machinery of its own; `AuthModel` is
/// responsible for spawning a *fresh* `Task` from it once control is safely
/// back in ordinary code, rather than resuming one that already exists.
private final class OAuthAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var completion: ((Result<URL, Error>) -> Void)?
    private var session: ASWebAuthenticationSession?

    /// Call on the main thread. `completion` fires exactly once, from
    /// whichever thread `ASWebAuthenticationSession` happens to deliver its
    /// completion handler on — never assume main there.
    func start(url: URL, callbackURLScheme: String, completion: @escaping (Result<URL, Error>) -> Void) {
        self.completion = completion
        // A bound method reference, not a closure literal written inline —
        // deliberately, though unlike the fixes in this type's own doc
        // comment this one is unverified in isolation; the fix that matters
        // is `completeSignIn` never resuming a pre-existing continuation.
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: callbackURLScheme,
            completionHandler: handleCompletion
        )
        self.session = session
        session.presentationContextProvider = self
        session.start()
    }

    private func handleCompletion(callbackURL: URL?, error: Error?) {
        let completion = self.completion
        self.completion = nil
        self.session = nil
        if let error {
            completion?(.failure(error))
        } else if let callbackURL {
            completion?(.success(callbackURL))
        } else {
            completion?(.failure(URLError(.badServerResponse)))
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
