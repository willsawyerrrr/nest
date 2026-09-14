import Auth
import Foundation

/// Public coordinates of the Nest Supabase project — not secret (the anon key
/// is a publishable client credential, shipped the same way in the PWA
/// bundle), but external to the build rather than hardcoded, so a fork can
/// point at its own Supabase project without editing source. `xcodegen
/// generate` substitutes `SUPABASE_URL` / `SUPABASE_ANON_KEY` from the process
/// environment into `Info.plist` (`project.yml`); see `apps/ios/.env.example`.
enum SupabaseConfig {
    static let url = URL(string: infoPlistValue("SupabaseURL"))!
    static let anonKey = infoPlistValue("SupabaseAnonKey")

    /// Custom URL scheme registered in `Info.plist`; the OAuth redirect target.
    static let authCallback = URL(string: "dev.willsawyerrrr.nest.ios://auth-callback")!

    /// Reads a key `xcodegen generate` substituted into `Info.plist`, failing
    /// loudly rather than silently building against no project: unset in the
    /// environment, XcodeGen leaves its literal `${VAR}` placeholder behind
    /// rather than an empty string, so that counts as missing too.
    private static func infoPlistValue(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
            !value.isEmpty, !value.contains("${")
        else {
            fatalError(
                "Info.plist has no \(key) — set the SUPABASE_URL / SUPABASE_ANON_KEY "
                    + "environment variables (see apps/ios/.env.example) before `xcodegen generate`."
            )
        }
        return value
    }
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
