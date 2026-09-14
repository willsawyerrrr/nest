# Nest iOS and macOS app

A thin native app that embeds the production PWA
(`https://nest.willsawyerrrr.dev`) in a `WKWebView` and adds Siri / App Intents
access to key figures (Linear WSD-95). One native Google sign-in covers both the
shell and the embedded web app: the native app owns the Supabase session and
mirrors it into the web view. See [`docs/ios.md`](../../docs/ios.md) for the full
design.

The `Nest` target is a single iOS codebase built for two destinations — iOS and
Mac Catalyst (Linear WSD-193) — with no source changes between them: the same
`WKWebView` shell, the same `AuthModel`/Keychain session, and the same three
App Intents run on both. The one behavioural difference is Siri voice
invocation, which macOS does not support for App Intents at all (see
[`docs/ios.md`](../../docs/ios.md#apple-developer-program)) — the Shortcuts app
and Spotlight still work on both platforms.

## Structure

- `project.yml` — [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec; the
  source of truth for the Xcode project, its `Info.plist` properties, and the
  `supabase-swift` SPM dependency (Auth product only). The generated
  `Nest.xcodeproj` and `Nest/Info.plist` are not committed.
- `Nest/`
  - `NestApp.swift` — SwiftUI entry point; injects `AuthModel`, starts its
    session observation, forwards `onOpenURL` to the Supabase client.
  - `ContentView.swift` — the sign-in gate: `SignInView` while signed out, the
    web view (plus loading and error overlays) once signed in.
  - `WebView.swift` — `UIViewRepresentable` around `WKWebView` on the default
    persistent data store; mirrors the native session into the page and takes
    its sign-out request back.
  - `SessionBridge.swift` — builds the JavaScript the shell injects: the
    `window.__NEST_NATIVE_SHELL__` marker and the apply/clear-session calls.
  - `Supabase.swift` — project URL + anon key constants and the shared
    `AuthClient` (default `KeychainLocalStorage`).
  - `Auth.swift` — `@Observable` `AuthModel`: session state, Google OAuth, and
    the `authStateChanges` observation behind the gate.
  - `Intents/BufferQueryIntent.swift` — the fortnightly-buffer `AppIntent`.
  - `Intents/BufferService.swift` — injectable HTTP call to `intent-summary`
    and spoken-sentence formatting.
  - `Intents/GoalProgressIntent.swift` — the savings-goal `AppIntent`.
  - `Intents/GoalService.swift` — injectable HTTP call to `goal-progress` and
    its spoken-sentence formatting.
  - `Intents/BudgetLineIntent.swift` — the budget-line `AppIntent` (a free-text
    `query` parameter).
  - `Intents/BudgetLineService.swift` — injectable HTTP call to `budget-line`
    and its per-cadence spoken-sentence formatting.
  - `Intents/NestShortcuts.swift` — the `AppShortcutsProvider` (one shortcut
    per intent).
- `NestTests/` — Swift Testing unit tests over the pieces each `perform()`
  delegates to: the phrasing (cents → spoken sentence), the service request
  shape and status handling, and the signed-out / failure-to-sentence mapping —
  plus `SessionBridge` (the injected sign-in JavaScript and its string
  escaping).

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

For Mac Catalyst, swap the destination; a CI runner (or any Mac with no
development team configured) also needs `CODE_SIGNING_ALLOWED=NO`, since
Catalyst — unlike the Simulator — always signs:

```sh
xcodebuild -project apps/ios/Nest.xcodeproj -scheme Nest \
  -destination 'platform=macOS,variant=Mac Catalyst' \
  -skipPackagePluginValidation -skipMacroValidation CODE_SIGNING_ALLOWED=NO build
```

Do not pass `SWIFT_EXEC=` — it breaks App Intents metadata extraction.

`xcodebuild test` (with a concrete simulator `-destination`, or the same
Catalyst `-destination` above) runs the `NestTests` suite — 42 tests, and they
pass identically on both destinations with no source changes between them.
`.github/workflows/ci.yml`'s `build-ios` / `build-catalyst` jobs do the
generate + build + test for both destinations on every PR/push that touches
`apps/ios/**`; both are required checks (see
[`docs/ios.md`](../../docs/ios.md#ci)).

A free personal Apple team is enough to build, run on the Simulator, a device,
or as a local Mac app, and to use the App Shortcut. There is no App Store
Connect setup, on either platform.

## Running the OAuth flow in the Simulator

1. Add `dev.willsawyerrrr.nest.ios://auth-callback` to the Supabase project's
   **Auth → URL Configuration → Redirect URLs**.
2. Run the app. On the sign-in screen, tap **Continue with Google**.
3. `ASWebAuthenticationSession` opens Google sign-in; complete it. The redirect
   to `dev.willsawyerrrr.nest.ios://auth-callback` returns to the app and the
   session persists to the Keychain — it survives relaunch, is read in process
   by the Intents, and is mirrored into the web view, which loads already
   signed in.
4. Test the intents from the Shortcuts app (search "Check Fortnightly Buffer" /
   "Check Savings Goals") or Spotlight — **on a real device**. The Simulator
   fails to invoke an App Shortcut ("Unable to run App Shortcut") whatever the
   code; it is fine for the OAuth flow, the web shell, and `xcodebuild test`.

A Mac Catalyst build has no simulator equivalent — running it from Xcode (or a
built `.app`) is already the "real device" case above: the OAuth flow, the App
Shortcuts, and Spotlight all work the same way they do on an iPhone, except
Siri voice invocation, which macOS does not support at all (see
[`docs/ios.md`](../../docs/ios.md#apple-developer-program)).

## Edge function dependencies

Each Intent calls a Supabase edge function, sending the session access token as
a bearer and the anon key as `apikey`. All must be deployed for the Intents to
return a figure.

- `BufferQueryIntent` → `intent-summary`
  (`supabase/functions/intent-summary`), `{}` body → `{ "fortnightlyAfterSavingCents": number }`.
- `GoalProgressIntent` → `goal-progress`
  (`supabase/functions/goal-progress`), `{}` body →
  `{ "goals": { name, savedCents, targetCents }[], "totalSavedCents", "totalTargetCents" }`.
- `BudgetLineIntent` → `budget-line`
  (`supabase/functions/budget-line`), `{ "query": string }` body →
  `{ "match": { name, amountCents, frequency, intervalCount, fortnightlyCents, annualCents } | null, "names": string[] }`.
