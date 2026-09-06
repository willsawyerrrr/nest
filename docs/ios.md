# iOS app

`apps/ios` is a thin native iOS app. The PWA (`https://nest.willsawyerrrr.dev`)
is the entire product UI; the native app embeds it in a `WKWebView` and adds
Siri / App Intents access to key figures (Linear WSD-95). Slice one exposes a
single read-only query — the household's fortnightly buffer after saving.

Nothing about how the PWA is built, deployed, or served changes because this
app exists.

## The shell

A single-screen SwiftUI app:

- `WebView.swift` — a `UIViewRepresentable` around `WKWebView` loading the
  production PWA URL directly (no local build, no bundled assets), on the
  default persistent `WKWebsiteDataStore` so the web view's own signed-in
  session survives relaunch.
- `ContentView.swift` — the web view plus a loading indicator and a Retry-able
  "couldn't load" state, and the Connect Siri surface (below).

## Native Supabase session

The App Shortcut needs a Supabase access token to call the backend, and the web
view's session lives in `WKWebView` storage the native code cannot read. So the
native app holds its own session, signed in independently of the web view.

- **`supabase-swift` (Auth product only)** via SPM. The edge-function call is
  plain `URLSession` + bearer token, so the `Functions` product is not pulled
  in.
- **`Supabase.swift`** constructs a shared `AuthClient` against the project's
  `auth/v1` endpoint. The project URL and anon key are compiled in as
  constants — both are public client credentials, shipped the same way the PWA
  ships them.
- **`Auth.swift`** — an `@Observable` `AuthModel` wrapping the client: a coarse
  `unknown / signedOut / signedIn` state, `signIn()`, and restore-on-launch
  that reads `supabaseAuth.session` (refreshing an expired token).
- **Google OAuth** runs through
  `supabaseAuth.signInWithOAuth(provider: .google, redirectTo:)`, which opens an
  `ASWebAuthenticationSession`, performs the PKCE exchange, and persists the
  session. It reuses the PWA's existing Google/Supabase OAuth setup unchanged —
  nothing changes in the Google Cloud console.
- **Custom URL scheme** `dev.willsawyerrrr.nest.ios`, declared as
  `CFBundleURLTypes` in `project.yml`. The OAuth redirect target is
  `dev.willsawyerrrr.nest.ios://auth-callback`; `NestApp.swift` also forwards
  `onOpenURL` to `supabaseAuth.session(from:)`.
- **Session storage** is `supabase-swift`'s default `KeychainLocalStorage` — no
  Keychain access group, no App Group. The Intent runs in the app's own process
  (see below), so it reads the stored session directly. The session is
  `kSecAttrAccessibleAfterFirstUnlock`, so a background-launched Intent can read
  it any time after the first unlock following a reboot.

### Supabase dashboard

The household must add `dev.willsawyerrrr.nest.ios://auth-callback` to the
Supabase project's **Auth → URL Configuration → Redirect URLs**. The PWA's
existing entry stays. This is the only backend configuration the native session
needs.

### Connect Siri surface

When there is no native session, `ContentView` shows a dismissible banner over
the top of the web view — "Ask Siri about Nest", one Connect button running
`signIn()`, and connected / not-connected / error feedback. It never blocks the
web view, which is fully usable without a native session.

## The buffer query

- **`Intents/BufferQueryIntent.swift`** — an `AppIntent` with `ProvidesDialog`
  and no `openAppWhenRun`. It reads the held session's access token
  (auto-refreshing), calls the `intent-summary` edge function, and speaks one
  sentence. Signed out or unrefreshable → "Open Nest and sign in to check your
  buffer." Network or decode failure → "Couldn't reach Nest just now."
- **`Intents/BufferService.swift`** — the HTTP call and the spoken-sentence
  formatting as plain, injectable functions (the transport and the token
  provider are parameters), so `perform()` is a thin shell over testable code.
  Money is formatted cents → dollars with an `en_AU` currency `NumberFormatter`;
  a negative buffer is spoken as being over budget.
- **`Intents/NestShortcuts.swift`** — an `AppShortcutsProvider` with one
  `AppShortcut` (a `shortTitle`, the `australiandollarsign.circle` SF Symbol,
  and phrases all containing `\(.applicationName)`), so the phrases reach Siri,
  Spotlight, and the Shortcuts app on install with no further setup.

The Intent lives **in the app target — there is no `AppIntentsExtension`** — so
`perform()` runs in the app's process and reads the Keychain session in
process, with no access group and no App Group.

### `intent-summary` request contract

`POST {SUPABASE_URL}/functions/v1/intent-summary`

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <session access token>` |
| `apikey` | the project anon key |
| `Content-Type` | `application/json` |

Request body: `{}`. Response body: `{ "fortnightlyAfterSavingCents": number }`
(integer minor units; negative when the fortnightly plan is over budget).

## Apple Developer Program

A paid Apple Developer Program membership is **not** required to build, run, or
use this app. Per Apple's App Intents documentation, an `AppShortcutsProvider`
needs no entitlement: a free personal team covers compile, Simulator, on-device
install (7-day provisioning), and the App Shortcut reaching the Shortcuts app,
Spotlight, and Siri. `com.apple.developer.siri` is the legacy SiriKit /
Apple-Intelligence-schema entitlement, which this app uses neither of.

The one thing to confirm on-device is **Siri voice invocation** (as opposed to
running the shortcut from the Shortcuts app or Spotlight). A few third-party
reports claim it still needs the entitlement; this contradicts Apple's docs and
is unverified. If voice invocation specifically fails during household testing,
the paid program comes into play — nothing else about this app does.

## Project structure

- `project.yml` — [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec; the
  source of truth for the Xcode project, its `Info.plist` properties, and the
  SPM dependency. The generated `Nest.xcodeproj` and `Nest/Info.plist` are not
  committed.
- `Nest/` — Swift sources: `NestApp.swift`, `ContentView.swift`, `WebView.swift`,
  `Supabase.swift`, `Auth.swift`, and `Intents/`.

See [`apps/ios/README.md`](../apps/ios/README.md) for build and OAuth-flow
instructions.

## Not in CI

The 4-job `CI Status` check must stay under a minute and no Xcode runner feeds
it. A separate, non-blocking, path-filtered macOS workflow running
`xcodegen generate` + `xcodebuild build` (which also runs
`appintentsmetadataprocessor`, validating the App Shortcut phrases) is tracked
separately. Such an invocation must not override `SWIFT_EXEC` — it breaks App
Intents metadata extraction on Xcode 16+.
