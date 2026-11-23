import Foundation

/// Public coordinates of the Nest Supabase project — not secret (the anon key
/// is a publishable client credential, shipped the same way in the PWA
/// bundle), but external to the build rather than hardcoded, so a fork can
/// point at its own Supabase project without editing source. `xcodegen
/// generate` substitutes `SUPABASE_URL` / `SUPABASE_ANON_KEY` from the process
/// environment into `Info.plist` (`project.yml`).
enum SupabaseConfig {
    static let url = URL(string: infoPlistValue("SupabaseURL"))!
    static let anonKey = infoPlistValue("SupabaseAnonKey")

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
                    + "environment variables by running `xcodegen generate` "
                    + "under `load-env`."
            )
        }
        return value
    }
}
