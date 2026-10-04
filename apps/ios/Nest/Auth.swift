import CryptoKit
import Foundation
import GoogleSignIn
import Observation
import UIKit

/// Observable wrapper around `supabaseAuth` for the SwiftUI layer: a coarse
/// session state plus the native Google sign-in entry point.
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

    /// Signs in with Google Sign-In's native flow and exchanges the resulting ID
    /// token for a Supabase session.
    ///
    /// A fresh random nonce guards the exchange: Google embeds its SHA-256 in
    /// the ID token and Supabase checks the raw value against it.
    func signIn() async {
        lastError = nil
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            guard let presenter = Self.presentingViewController() else {
                throw AuthError.noPresenter
            }
            let nonce = Self.randomNonce()
            let result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter,
                hint: nil,
                additionalScopes: nil,
                nonce: Self.sha256(nonce)
            )
            guard let idToken = result.user.idToken?.tokenString else {
                throw AuthError.noIdToken
            }
            _ = try await supabaseAuth.signInWithIdToken(
                credentials: .init(
                    provider: .google,
                    idToken: idToken,
                    accessToken: result.user.accessToken.tokenString,
                    nonce: nonce
                )
            )
            state = .signedIn
        } catch let error as NSError
            where error.domain == kGIDSignInErrorDomain && error.code == GIDSignInError.canceled.rawValue
        {
            // The member dismissed the sign-in sheet.
        } catch {
            lastError = error.localizedDescription
        }
    }

    private enum AuthError: LocalizedError {
        case noPresenter
        case noIdToken

        var errorDescription: String? {
            switch self {
            case .noPresenter: "There is no window to present Google sign-in from."
            case .noIdToken: "Google did not return an ID token."
            }
        }
    }

    private static func presentingViewController() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.rootViewController
        var top = root
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    private static func randomNonce() -> String {
        Data((0..<32).map { _ in UInt8.random(in: .min ... .max) })
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
