import Auth
import Foundation

/// The app's stored session, in the keychain group the app writes it to: the
/// extension's only `keychain-access-groups` entry is the app's default group,
/// so the default `KeychainLocalStorage` reads and updates the app's own item.
///
/// A refresh's rotated tokens are written back to that item, because a refresh
/// token is single-use: leaving the app holding the redeemed one would make
/// its next refresh a reuse, which Supabase Auth answers by revoking the whole
/// session. The Auth client reads the item immediately before refreshing and
/// discards its result if the item changed meanwhile, so a refresh racing the
/// app's never overwrites the app's newer tokens. Deletes are dropped: the
/// extension never clears the session, so it cannot sign the app out.
struct SharedSessionStorage: AuthLocalStorage {
    private let keychain = KeychainLocalStorage()

    func store(key: String, value: Data) throws {
        try keychain.store(key: key, value: value)
    }

    func retrieve(key: String) throws -> Data? {
        try keychain.retrieve(key: key)
    }

    func remove(key: String) throws {}
}

/// The extension's Auth client over the app's session. No auto-refresh loop:
/// the session is refreshed only when a request finds it expired.
let supabaseAuth = AuthClient(
    url: SupabaseConfig.url.appendingPathComponent("auth/v1"),
    headers: [
        "apikey": SupabaseConfig.anonKey,
        "Authorization": "Bearer \(SupabaseConfig.anonKey)",
    ],
    localStorage: SharedSessionStorage(),
    autoRefreshToken: false
)
