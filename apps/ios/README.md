# Nest iOS app

A thin native iOS app that embeds the production PWA
(`https://nest.willsawyerrrr.dev`) in a `WKWebView` and adds Siri / App Intents
access to key figures (Linear WSD-95). The first Intent speaks the household's
fortnightly buffer after saving. See [`docs/ios.md`](../../docs/ios.md) for the
full design.

## Structure

- `project.yml` — [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec; the
  source of truth for the Xcode project, its `Info.plist` properties, and the
  `supabase-swift` SPM dependency (Auth product only). The generated
  `Nest.xcodeproj` and `Nest/Info.plist` are not committed.
- `Nest/`
  - `NestApp.swift` — SwiftUI entry point; injects `AuthModel`, forwards
    `onOpenURL` to the Supabase client.
  - `ContentView.swift` — the web view plus loading and error overlays and the
    dismissible Connect Siri banner.
  - `WebView.swift` — `UIViewRepresentable` around `WKWebView` on the default
    persistent data store.
  - `Supabase.swift` — project URL + anon key constants and the shared
    `AuthClient` (default `KeychainLocalStorage`).
  - `Auth.swift` — `@Observable` `AuthModel`: session state, Google OAuth,
    restore-on-launch.
  - `Intents/BufferQueryIntent.swift` — the fortnightly-buffer `AppIntent`.
  - `Intents/BufferService.swift` — injectable HTTP call to `intent-summary`
    and spoken-sentence formatting.
  - `Intents/GoalProgressIntent.swift` — the savings-goal `AppIntent`.
  - `Intents/GoalService.swift` — injectable HTTP call to `goal-progress` and
    its spoken-sentence formatting.
  - `Intents/NestShortcuts.swift` — the `AppShortcutsProvider` (one shortcut
    per intent).
- `NestTests/` — Swift Testing unit tests over the pieces each `perform()`
  delegates to: the phrasing (cents → spoken sentence), the service request
  shape and status handling, and the signed-out / failure-to-sentence mapping.

## Building

Requires Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`):

```sh
cd apps/ios
xcodegen generate
open Nest.xcodeproj
```

`xcodebuild` resolves the SPM graph and runs `appintentsmetadataprocessor`,
which validates the App Shortcut phrases:

```sh
xcodebuild -project apps/ios/Nest.xcodeproj -scheme Nest \
  -destination 'generic/platform=iOS Simulator' \
  -skipPackagePluginValidation -skipMacroValidation build
```

Do not pass `SWIFT_EXEC=` — it breaks App Intents metadata extraction.

`xcodebuild test` (with a concrete simulator `-destination`) runs the
`NestTests` suite. `.github/workflows/ios.yml` does the generate + build + test
on every push that touches `apps/ios/**`; it is informational, not a required
check.

A free personal Apple team is enough to build, run on the Simulator or a
device, and use the App Shortcut. There is no App Store Connect setup.

## Running the OAuth flow in the Simulator

1. Add `dev.willsawyerrrr.nest.ios://auth-callback` to the Supabase project's
   **Auth → URL Configuration → Redirect URLs**.
2. Run the app. Tap **Connect** on the Connect Siri banner.
3. `ASWebAuthenticationSession` opens Google sign-in; complete it. The redirect
   to `dev.willsawyerrrr.nest.ios://auth-callback` returns to the app and the
   session persists to the Keychain — it survives relaunch and is read in
   process by `BufferQueryIntent`.
4. Test the intents from the Shortcuts app (search "Check Fortnightly Buffer" /
   "Check Savings Goals") or Spotlight — **on a real device**. The Simulator
   fails to invoke an App Shortcut ("Unable to run App Shortcut") whatever the
   code; it is fine for the OAuth flow, the web shell, and `xcodebuild test`.

## Edge function dependencies

Each Intent calls a Supabase edge function, sending the session access token as
a bearer and the anon key as `apikey` with a `{}` body. Both must be deployed
for the Intents to return a figure.

- `BufferQueryIntent` → `intent-summary`
  (`supabase/functions/intent-summary`) → `{ "fortnightlyAfterSavingCents": number }`.
- `GoalProgressIntent` → `goal-progress`
  (`supabase/functions/goal-progress`) →
  `{ "goals": { name, savedCents, targetCents }[], "totalSavedCents", "totalTargetCents" }`.
