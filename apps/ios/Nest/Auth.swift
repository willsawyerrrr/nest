import AuthenticationServices
import Foundation
import Observation

/// Observable wrapper around `supabaseAuth` for the SwiftUI layer: a coarse
/// session state plus the Google OAuth entry point.
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

    /// The last sign-in failure, if any, for the Connect Siri surface to show.
    private(set) var lastError: String?

    /// Reads any persisted session on launch, refreshing it if it has expired.
    func restore() async {
        let session = try? await supabaseAuth.session
        state = session == nil ? .signedOut : .signedIn
    }

    /// Runs Google OAuth in an `ASWebAuthenticationSession` and persists the
    /// resulting session to the Keychain.
    func signIn() async {
        lastError = nil
        do {
            _ = try await supabaseAuth.signInWithOAuth(
                provider: .google,
                redirectTo: SupabaseConfig.authCallback
            )
            state = .signedIn
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The member dismissed the sign-in sheet.
        } catch {
            lastError = error.localizedDescription
        }
    }
}
