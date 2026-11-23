import Auth
import Foundation

/// Shared Auth client. Sessions persist to the default `KeychainLocalStorage`
/// with no explicit access group, so the item lands in the app's default
/// group, the first `keychain-access-groups` entry
/// (`$(AppIdentifierPrefix)dev.willsawyerrrr.nest`). The App Shortcut runs in
/// this same process; the notification content extension holds that group
/// too and reads the same item (`NotificationContent/SharedSession.swift`).
let supabaseAuth = AuthClient(
    url: SupabaseConfig.url.appendingPathComponent("auth/v1"),
    headers: [
        "apikey": SupabaseConfig.anonKey,
        "Authorization": "Bearer \(SupabaseConfig.anonKey)",
    ],
    localStorage: AuthClient.Configuration.defaultLocalStorage
)
