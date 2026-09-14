# iOS and macOS app

`apps/ios` is a thin native app, built from one codebase for two destinations —
iOS and Mac Catalyst (Linear WSD-95, WSD-193). The PWA
(`https://nest.willsawyerrrr.dev`) is the entire product UI; the native app
embeds it in a `WKWebView` and adds Siri / App Intents access to key figures.
Three read-only queries so far: the household's fortnightly buffer after
saving, its savings-goal progress, and how much a named budget line is planned
at.

Nothing about how the PWA is built, deployed, or served changes because this
app exists. Nothing in the Swift source differs between the two destinations
either — `project.yml`'s `supportedDestinations: [iOS, macCatalyst]` on the
one `Nest` target is the entire difference; every file below applies to both.

## The shell

A single-screen SwiftUI app:

- `WebView.swift` — a `UIViewRepresentable` around `WKWebView` loading the
  production PWA URL directly (no local build, no bundled assets), on the
  default persistent `WKWebsiteDataStore`. It also mirrors the native session
  into the page (below).
- `ContentView.swift` — a blocking sign-in gate: `SignInView` while signed out,
  the web view (plus a loading indicator and a Retry-able "couldn't load"
  state) once signed in.

## One login: native owns the session, the web view mirrors it

The App Shortcut needs a Supabase access token to call the backend with the app
closed, and the web view's own session lives in `WKWebView` storage the native
code cannot read. So the **native app is the single session owner** — one Google
OAuth, at launch — and the web view runs on the session the native layer injects
into it. A member signs in once.

The native side must own token refresh (a Siri intent refreshes with the web
view unloaded), so the web view must not refresh independently — two clients
rotating one refresh token evict each other.

- **`SessionBridge.swift`** builds the injected JavaScript: the
  `window.__NEST_NATIVE_SHELL__ = true` marker, and calls to
  `window.__nestApplySession(accessToken, refreshToken)` /
  `window.__nestClearSession()`.
- **`WebView.swift`** adds a `.atDocumentStart` `WKUserScript` for the marker,
  pushes the current session (refreshed if expired) on every `didFinish`, and
  keeps a task iterating `supabaseAuth.authStateChanges` to re-push on every
  token refresh and sign-out. A `nestAuth` `WKScriptMessageHandler` takes the
  page's sign-out request and calls `supabaseAuth.signOut()`.
- **PWA side** (gated entirely on `window.__NEST_NATIVE_SHELL__`, set only by the
  user script — a browser or Safari-PWA member is byte-identical to today):
  `lib/supabase.ts` creates the client with `persistSession: false,
  autoRefreshToken: false` in the shell; `lib/nativeShell.ts` is the flag check;
  `lib/nativeAuthBridge.ts` installs `window.__nestApplySession` /
  `window.__nestClearSession` and routes the in-app sign-out through the
  `nestAuth` handler; `AuthGate` shows the loading screen (never the web
  sign-in screen) in the shell until the injected session lands.

The native session is still Keychain-stored and still read in process by the
Intents — that part is unchanged; what changed is that it is now also the web
view's session.

### Native Supabase session

- **`supabase-swift` (Auth product only)** via SPM. The edge-function call is
  plain `URLSession` + bearer token, so the `Functions` product is not pulled
  in.
- **`Supabase.swift`** constructs a shared `AuthClient` against the project's
  `auth/v1` endpoint. The project URL and anon key are public client
  credentials, shipped the same way the PWA ships them — but external to the
  build rather than hardcoded, so a fork can point at its own Supabase project
  without editing source: `xcodegen generate` substitutes `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` from the environment into `Info.plist`
  (`project.yml`'s `info.properties`), and `Supabase.swift` reads them via
  `Bundle.main`, failing loudly (`fatalError`) if either is missing rather than
  building against no project. Local dev sources them from `apps/ios/.env`
  (see `.env.example`); CI (`ci.yml`'s `build-ios` / `build-catalyst`) from the
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` repository Variables.
- **`Auth.swift`** — an `@Observable` `AuthModel` wrapping the client: a coarse
  `unknown / signedOut / signedIn` state, `signIn()`, and `start()`, which
  iterates `supabaseAuth.authStateChanges` for the life of the app so the gate
  reflects the launch restore, every token refresh, and the sign-out the web
  view asks for.
- **Google OAuth** runs through
  `supabaseAuth.signInWithOAuth(provider: .google, redirectTo:)`, which opens an
  `ASWebAuthenticationSession`, performs the PKCE exchange, and persists the
  session. It reuses the PWA's existing Google/Supabase OAuth setup unchanged —
  nothing changes in the Google Cloud console.
- **Custom URL scheme** `dev.willsawyerrrr.nest.ios`, declared as
  `CFBundleURLTypes` in `project.yml`. The OAuth redirect target is
  `dev.willsawyerrrr.nest.ios://auth-callback`; `NestApp.swift` also forwards
  `onOpenURL` to `supabaseAuth.session(from:)` for that redirect.
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

### Sign-in gate

Signed out, `ContentView` shows `SignInView` — a Nest lockup and one "Continue
with Google" button running `signIn()`, with the last error beneath it. Signed
in, it shows the web view. Sign-out from the web app (Household settings) posts
to the `nestAuth` handler, which clears the native session; the gate then swaps
back to `SignInView`.

## The query intents

Each intent is an `AppIntent` with `ProvidesDialog` and no `openAppWhenRun`: it
reads the held session's access token (auto-refreshing), calls one edge
function, and speaks a sentence. Signed out or unrefreshable → "Open Nest and
sign in…"; network or decode failure → "Couldn't reach Nest just now."

- **`Intents/BufferQueryIntent.swift`** + **`Intents/BufferService.swift`** —
  "what's my buffer": calls `intent-summary`, speaks the fortnightly
  after-saving figure (spoken as over budget when negative).
- **`Intents/GoalProgressIntent.swift`** + **`Intents/GoalService.swift`** —
  "how are my savings goals": calls `goal-progress`, speaks the household total
  saved against the total target and leads with the nearest-dated unmet goal (or
  celebrates when every goal is met, or prompts to set one up when there are
  none).
- **`Intents/BudgetLineIntent.swift`** + **`Intents/BudgetLineService.swift`** —
  "how much is budgeted for groceries": takes a free-text `query` (a `String`
  `@Parameter` Siri prompts for), calls `budget-line`, and speaks the matched
  line's amount in its own cadence ("$200.00 per week for Groceries"). No match
  → names the household's budget lines; none at all → prompts to set one up. An
  App Shortcut phrase can't carry a free-text parameter, so the shortcut phrase
  is parameterless and Siri asks which line; a spoken-inline `AppEntity` for
  line names is a follow-up, the same as for a per-goal parameter.
- **`Intents/NestShortcuts.swift`** — an `AppShortcutsProvider` with one
  `AppShortcut` per intent (each a `shortTitle`, an SF Symbol, and phrases all
  containing `\(.applicationName)`), so the phrases reach Siri, Spotlight, and
  the Shortcuts app on install with no further setup.

In every service the HTTP call and the spoken-sentence formatting are plain
injectable functions (the transport and the token provider are parameters), so
each `perform()` is a thin shell over testable code. Money is formatted
cents → dollars with an `en_AU` currency `NumberFormatter`.

The intents live **in the app target — there is no `AppIntentsExtension`** — so
`perform()` runs in the app's process and reads the Keychain session in
process, with no access group and no App Group.

### Request contracts

Each is `POST {SUPABASE_URL}/functions/v1/<name>` with these headers:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <session access token>` |
| `apikey` | the project anon key |
| `Content-Type` | `application/json` |

`intent-summary` and `goal-progress` take a `{}` body; `budget-line` takes
`{ "query": string }`.

- `intent-summary` → `{ "fortnightlyAfterSavingCents": number }` (integer minor
  units; negative when the fortnightly plan is over budget).
- `goal-progress` →
  `{ "goals": { "name": string, "savedCents": number, "targetCents": number }[], "totalSavedCents": number, "totalTargetCents": number }`.
  `goals` is ordered dated-first by target date, then undated by name; a goal's
  `savedCents` is its linked Up saver's synced balance where it links one, else
  the manually entered figure.
- `budget-line` →
  `{ "match": { "name": string, "amountCents": number, "frequency": string, "intervalCount": number | null, "fortnightlyCents": number, "annualCents": number } | null, "names": string[] }`.
  `match` is the budget line whose name best fits `query` — an exact
  case-insensitive match, else the shortest name overlapping it — or `null`;
  `names` is every budget line name, sorted. `amountCents` is the planned amount
  at its own `frequency`; `fortnightlyCents` / `annualCents` are the `@nest/plan`
  normalisations.

## Apple Developer Program

A paid Apple Developer Program membership is **not** required to build, run, or
use this app on either platform. Per Apple's App Intents documentation, an
`AppShortcutsProvider` needs no entitlement: a free personal team covers
compile, Simulator, on-device install (7-day provisioning), a local Mac
Catalyst build, and the App Shortcut reaching the Shortcuts app and Spotlight
on both platforms. `com.apple.developer.siri` is the legacy SiriKit /
Apple-Intelligence-schema entitlement, which this app uses neither of.

On iOS, the one thing to confirm on-device is **Siri voice invocation** (as
opposed to running the shortcut from the Shortcuts app or Spotlight). A few
third-party reports claim it still needs the entitlement; this contradicts
Apple's docs and is unverified. If voice invocation specifically fails during
household testing, the paid program comes into play — nothing else about the
iOS side does.

**On macOS, Siri voice invocation of an App Shortcut is not available at all**
— confirmed by Apple DTS (developer forum thread 764609): intents declared for
App Shortcuts are available in the macOS Shortcuts app, but Siri voice
invocation of them is not, regardless of entitlement or payment tier. The
Shortcuts app and Spotlight are unaffected. This is a platform limitation, not
something the paid program unlocks.

The App Shortcuts have been run from Spotlight and the Shortcuts app **on a
real iOS device**; both queries answer. **The iOS Simulator cannot reliably
invoke an App Shortcut** — it fails with "Unable to run App Shortcut" regardless
of the code — so test the intents on iOS hardware. The Simulator is still fine
for the OAuth flow, the web shell, and `xcodebuild test`. A Mac Catalyst build
has no simulator: running it is already the "real device" case, and
`Metadata.appintents` is produced and validated in its build product exactly as
it is for iOS.

## Project structure

- `project.yml` — [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec; the
  source of truth for the Xcode project, its `Info.plist` properties, and the
  SPM dependency. `Nest`'s `supportedDestinations: [iOS, macCatalyst]` is what
  makes it a two-platform target rather than a separate macOS project; its
  `Info.plist` carries no `LSRequiresIPhoneOS` key, since that key excludes
  Catalyst outright. The generated `Nest.xcodeproj` and `Nest/Info.plist` are
  not committed.
- `Nest/` — Swift sources: `NestApp.swift`, `ContentView.swift`, `WebView.swift`,
  `SessionBridge.swift`, `Supabase.swift`, `Auth.swift`, and `Intents/`.
- `NestTests/` — Swift Testing unit tests for the Intent logic (each service's
  phrasing, its request shape, and the signed-out / HTTP-failure sentence
  mapping) and for `SessionBridge`'s injected JavaScript and string escaping.

See [`apps/ios/README.md`](../apps/ios/README.md) for build and OAuth-flow
instructions.

## CI

`.github/workflows/ci.yml` runs `build-ios` and `build-catalyst` on
`macos-latest` runners: `build-ios` (the iOS Simulator destination) and
`build-catalyst` (the Mac Catalyst destination). Each runs `xcodegen generate`,
then `xcodebuild build` (which runs `appintentsmetadataprocessor`, so a
malformed App Shortcut phrase — a missing `\(.applicationName)`, a duplicate
identifier, an unresolvable parameter type — fails the build on both
destinations), then `xcodebuild test`. Neither overrides `SWIFT_EXEC` (that
drops `--compile-time-extraction` and breaks App Intents metadata extraction
on Xcode 16+) and both pass `-skipMacroValidation` /
`-skipPackagePluginValidation` so a fresh runner does not stall on a macro or
plugin approval prompt. `build-catalyst` additionally passes
`CODE_SIGNING_ALLOWED=NO`, since a runner carries no development team and
Catalyst, unlike the Simulator, always signs.

Both are **required** — the `changes` job (`dorny/paths-filter`) gates them on
`apps/ios/**` (or the workflow file itself) having changed, and `ci-status`
`needs` both, so a real regression blocks the merge; a PR that leaves
`apps/ios/` untouched gets `skipped` on both, which `ci-status` treats the same
as a pass rather than waiting forever on a check that never ran. See
[`architecture.md`](architecture.md#ci).
