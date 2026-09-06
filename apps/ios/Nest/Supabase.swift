import Auth
import Foundation

/// Public coordinates of the Nest Supabase project. The anon key is a
/// publishable client credential — the PWA ships the same value in its bundle.
enum SupabaseConfig {
    static let url = URL(string: "https://dgfeittjtxjtgbretdkj.supabase.co")!
    static let anonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnZmVpdHRqdHhqdGdicmV0ZGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzE2OTQsImV4cCI6MjA5OTk0NzY5NH0.l_Ux7V1Fax7cPLZG9CBg01VHZxlq40Yfh53e7BdnnQ4"

    /// Custom URL scheme registered in `Info.plist`; the OAuth redirect target.
    static let authCallback = URL(string: "dev.willsawyerrrr.nest.ios://auth-callback")!
}

/// Shared Auth client. Sessions persist to the default `KeychainLocalStorage`
/// (no access group): the App Shortcut runs in this same process, so it reads
/// the stored session directly with no App Group.
let supabaseAuth = AuthClient(
    url: SupabaseConfig.url.appendingPathComponent("auth/v1"),
    headers: [
        "apikey": SupabaseConfig.anonKey,
        "Authorization": "Bearer \(SupabaseConfig.anonKey)",
    ],
    redirectToURL: SupabaseConfig.authCallback,
    localStorage: AuthClient.Configuration.defaultLocalStorage
)
