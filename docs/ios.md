# iOS and macOS app

`apps/ios` is a thin native app with two Xcode targets built from one set of
sources: `Nest` (iOS and Mac Catalyst destinations) and `NestMac` (a native
AppKit/SwiftUI macOS app). The PWA
(`https://nest.willsawyerrrr.dev`) is the entire product UI; the native app
embeds it in a `WKWebView` and adds Siri / App Intents access to key figures.
Four read-only queries so far: the household's fortnightly buffer after
saving, its savings-goal progress, how much a named budget line is planned
at, and its recommended pay split.

Nothing about how the PWA is built, deployed, or served changes because this
app exists. `Nest`'s two destinations differ only by
`project.yml`'s `supportedDestinations: [iOS, macCatalyst]`. `NestMac` compiles
the same `Nest/` and `Shared/` sources for macOS; the few platform differences
are `#if os(macOS)` branches (`Auth.swift`'s presenting window, `WebView.swift`'s
`NSViewRepresentable`, external-link and foreground handling, `ContentView.swift`'s
dynamic colours). Every file below applies to all three builds unless noted.

### Native macOS target

`NestMac` (`dev.willsawyerrrr.nest.macos`, product name `Nest`, macOS 15 — the
floor for Spotlight's `indexAppEntities`) is an App Sandbox, hardened-runtime
app with the `network.client` and `8558CXPT9G.dev.willsawyerrrr.nest` App Group
entitlements and a `keychain-access-groups` entry for
`8558CXPT9G.dev.willsawyerrrr.nest.macos` (`NestMac/Nest.entitlements`). The
group is team-prefixed because macOS grants that form to a Developer ID–signed
app, where a `group.` identifier needs the portal to register it
(`ShareInbox.appGroupIdentifier` picks it per platform). The keychain access
group is what Google Sign-In and `supabase-swift`'s `KeychainLocalStorage` need
to persist the session, so the native session persists on macOS exactly as on
iOS and the App Intents read it in process.

Both the app and the share extension are signed with Developer ID provisioning
profiles (`Nest macOS Developer ID`, `Nest macOS Share Extension Developer ID`,
type `MAC_APP_DIRECT`, on the `dev.willsawyerrrr.nest.macos[.share-extension]`
App IDs with the App Groups capability), which authorise those restricted
entitlements; without one macOS refuses the keychain save and Google Sign-In
reports a keychain error. `scripts/package-mac-app.sh` fetches each profile by
name through the App Store Connect API (the notarisation key,
`scripts/install-developer-id-profile.mjs`) and hands them to `xcodebuild` as
`NEST_MAC_APP_PROFILE` / `NEST_MAC_EXTENSION_PROFILE`, which `project.yml` maps
to each target's `PROVISIONING_PROFILE_SPECIFIER` (empty for every other build).
Recreate a profile with `POST /v1/profiles` (`profileType: MAC_APP_DIRECT`, the
`DEVELOPER_ID_APPLICATION_G2` certificate) if one is ever deleted. The app
exposes the same four
App Intents and App Shortcuts and the same Spotlight index as `Nest`, and its
embedded share extension is `ShareExtensionMac/`. Google Sign-In uses
`GIDSignIn.signIn(withPresenting: NSWindow…)` with the same public iOS-type OAuth
client ID as `Nest`; if Google rejects that client for the macOS bundle ID, add an
iOS-type client for `dev.willsawyerrrr.nest.macos` to the Supabase Google provider's
Client IDs and set it as `GIDClientID` (and its reversed URL scheme) in
`project.yml`. `NestMacTests` runs the shared `NestTests` sources against it. Siri
voice invocation of an App Shortcut is unavailable on macOS (see above).

## The shell

A single-screen SwiftUI app:

- `WebView.swift` — a `UIViewRepresentable` (`NSViewRepresentable` on macOS) around `WKWebView` loading the
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
sign-in, at launch — and the web view runs on the session the native layer injects
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
  token refresh and sign-out. Two `WKScriptMessageHandler`s take the page's
  requests: `nestReady` pushes the session again, and `nestAuth`'s `signOut`
  calls `supabaseAuth.signOut()`. The page posts to `nestReady` once its hooks
  exist, because a push that beats them is dropped and would leave the loading
  screen up. It is a separate handler because an installed build treats every
  `nestAuth` message as a sign-out, so the page never posts anything else there.
- **Documents open in the system browser.** The PWA opens a receipt, payslip, or
  trade document with `window.open` once its signed URL is fetched, which by then
  has lost the tap's user activation. `WebView.swift` sets
  `javaScriptCanOpenWindowsAutomatically` so the call is allowed, and its
  `WKUIDelegate.createWebViewWith` passes the request's `https` URL
  (`SessionBridge.externalURL`) to `UIApplication.open` and creates no web view;
  without a delegate a `WKWebView` drops new-window requests silently.
- **PWA side** (gated entirely on `window.__NEST_NATIVE_SHELL__`, set only by the
  user script — a browser or Safari-PWA member is byte-identical to today):
  `lib/supabase.ts` creates the client with `persistSession: false,
  autoRefreshToken: false` in the shell; `lib/nativeShell.ts` is the flag check;
  `lib/nativeAuthBridge.ts` installs `window.__nestApplySession` /
  `window.__nestClearSession`, posts to `nestReady`, and routes the in-app sign-out through the
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
  building against no project. Local dev runs `xcodegen generate` under
  `op run --environment b5zkkwxuutlttwbrv5xhgojye4 --environment 3i642eynjpsx2uctyqlexobgge --environment we4tm6dkfoffx42g243qr7ju6m --`; CI (`ci.yml`'s `build-ios` / `build-catalyst` /
  `build-macos`) loads the 1Password Environments (see
  [`operations.md`](operations.md#1password-environments)).
- **`Auth.swift`** — an `@Observable` `AuthModel` wrapping the client: a coarse
  `unknown / signedOut / signedIn` state, `signIn()`, and `start()`, which
  iterates `supabaseAuth.authStateChanges` for the life of the app so the gate
  reflects the launch restore, every token refresh, and the sign-out the web
  view asks for.
- **Google sign-in** — `AuthModel.signIn()` runs Google Sign-In's native flow
  (`GIDSignIn`, from the `GoogleSignIn-iOS` package) and exchanges the ID token
  with `supabaseAuth.signInWithIdToken`, which persists the session. A fresh
  random nonce guards the exchange: its SHA-256 goes to Google, which embeds it
  in the ID token, and the raw value goes to Supabase to check against it. It
  uses an iOS-type Google OAuth client, whose public client ID is `GIDClientID`
  in `project.yml`; no client secret is involved.
- **Custom URL scheme** — the iOS client's reversed ID
  (`com.googleusercontent.apps.<id>`), declared as `CFBundleURLTypes` in
  `project.yml`. Google Sign-In returns through it, and `NestApp.swift` forwards
  `onOpenURL` to `GIDSignIn.sharedInstance.handle`.
- **Session storage** is `supabase-swift`'s default `KeychainLocalStorage` — no
  Keychain access group, and the App Group carries only shared files. The Intent runs in the app's own process
  (see below), so it reads the stored session directly. The session is
  `kSecAttrAccessibleAfterFirstUnlock`, so a background-launched Intent can read
  it any time after the first unlock following a reboot.

### Supabase dashboard

The household must add the iOS client ID to the Supabase project's **Auth →
Providers → Google → Client IDs**, comma-separated after the PWA's web client ID
(which stays first). The iOS client needs no secret, and nothing else changes in
the backend.

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
  "how much do we budget for groceries in Nest": takes a required `line`
  parameter, calls `budget-line`, and speaks the matched line's amount in its own
  cadence ("$200.00 per week for Groceries"). The parameter is a
  `BudgetLineEntity` (`AppEntity`); `BudgetLineEntityQuery` offers, resolves
  (`entities(for:)`) and name-matches (`entities(matching:)`, case- and
  spacing-insensitive, exact then shortest) the household's budget lines from the
  live response, and offers none when signed out or unreachable. No match → names
  the household's budget lines; none at all → prompts to set one up.
- **`Intents/SpotlightIndex.swift`** — indexes every budget line and every
  pay-split account in Spotlight as an `IndexedEntity` (iOS 18+; earlier systems
  skip it), with the planned amount, a one-line description, and the name's words
  as keywords so the system matches them semantically. Only planned figures
  shared by the household are indexed — no balance or transaction. `NestApp`
  refreshes the index once a session exists and whenever the app becomes active,
  and empties it on sign-out.
- **`Intents/PaySplitIntent.swift`** + **`Intents/PaySplitService.swift`** —
  "how much goes to Japan in Nest": takes a required `account` parameter, calls
  `pay-split`, and speaks that account's recommended fortnightly transfer ("$400.00
  goes to Japan each fortnight."). Omitted or unresolved, Siri asks "Which
  account?" and offers the options. The parameter is a `PaySplitEntity`
  (`AppEntity`); `PaySplitEntityQuery` offers (`suggestedEntities`) and resolves
  (`entities(for:)`) the household's recommended-split accounts from the live
  response, and offers none when signed out or unreachable. The intent also
  returns the refreshed `PaySplitEntity` (name and fortnightly dollar amount, or
  nothing when the account has no split) for use in other shortcuts. Other
  answers: the pay account itself → nothing is transferred to it; no pay account
  chosen → asks the member to choose one in Nest; an account nothing is routed
  to → says so; nothing routed at all → prompts to set up routing. `NestApp`
  calls `NestShortcuts.updateAppShortcutParameters()` once a session exists and
  whenever the app becomes active so the phrases pick up the household's accounts
  and budget lines. The answer is one account's
  figure; the household-wide breakdown stays in the PWA (see
  [`pay-splits.md`](pay-splits.md)).
- **`Intents/NestShortcuts.swift`** — an `AppShortcutsProvider` with one
  `AppShortcut` per intent (each a `shortTitle`, an SF Symbol, and phrases all
  containing `\(.applicationName)`; the budget-line and pay-split phrases also carry their `line` / `account` parameter, e.g. "How much do we budget for \(\.$line) in Nest"), so the phrases reach Siri, Spotlight, and
  the Shortcuts app on install with no further setup.

In every service the HTTP call and the spoken-sentence formatting are plain
injectable functions (the transport and the token provider are parameters), so
each `perform()` is a thin shell over testable code. Money is formatted
cents → dollars with an `en_AU` currency `NumberFormatter`.

The intents live **in the app target — there is no `AppIntentsExtension`** — so
`perform()` runs in the app's process and reads the Keychain session in
process, with no access group.

### Request contracts

Each is `POST {SUPABASE_URL}/functions/v1/<name>` with these headers:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <session access token>` |
| `apikey` | the project anon key |
| `Content-Type` | `application/json` |

`intent-summary`, `goal-progress` and `pay-split` take a `{}` body; `budget-line` takes
`{ "query": string }` (empty to list every line).

- `intent-summary` → `{ "fortnightlyAfterSavingCents": number }` (integer minor
  units; negative when the fortnightly plan is over budget).
- `goal-progress` →
  `{ "goals": { "name": string, "savedCents": number, "targetCents": number }[], "totalSavedCents": number, "totalTargetCents": number }`.
  `goals` is ordered dated-first by target date, then undated by name; a goal's
  `savedCents` is its linked Up saver's synced balance where it links one, else
  the manually entered figure.
- `budget-line` →
  `{ "match": Line | null, "lines": Line[], "names": string[] }` where `Line` is
  `{ "id": string, "name": string, "amountCents": number, "frequency": string, "intervalCount": number | null, "fortnightlyCents": number, "annualCents": number }`.
  `match` is the budget line whose name best fits `query` — an exact
  case-insensitive match, else the shortest name overlapping it — or `null`;
  `lines` is every budget line sorted by name (an empty `query` matches none);
  `names` is every budget line name, sorted. `amountCents` is the planned amount
  at its own `frequency`; `fortnightlyCents` / `annualCents` are the `@nest/plan`
  normalisations.

- `pay-split` → (the intent reads one account's entry from `splits`)
  `{ "hasPayAccount": boolean, "splits": { "accountId": string, "name": string, "fortnightlyCents": number }[], "totalCents": number, "stays": { ...same shape }[], "unassignedFortnightlyCents": number }`.
  The same recommendation the PWA Splits tab shows: `splits` are the other
  routed accounts (every one when a pay account is chosen, else only savers),
  each rounded up to the nearest $5 and ordered by name; `stays` are the routed
  accounts that need no transfer; `name` has any leading emoji stripped.

## Share extension

A PDF or image shared from another app (Mail, Files, Photos, Safari) can be
added to Nest from the share sheet's **Nest** destination, and each file becomes
a draft deduction to review.

- **Extension.** `ShareExtension/` is a share extension
  (`dev.willsawyerrrr.nest.share-extension`), embedded in `Nest` and built for
  both destinations. Its `NSExtensionActivationRule` is a predicate that offers
  Nest when at least one attachment conforms to `com.adobe.pdf` or
  `public.image`. `ShareViewController` loads each attachment with
  `loadFileRepresentation`, which hands over a file on disk, and copies it into
  the App Group inbox; no file is read into the extension's memory, so size never
  threatens its memory limit. It then says "Saved to Nest. Open Nest to review.",
  with a line for each file left out (not a PDF or image, over 25 MB, or not
  saved), or one line saying the App Group container is unavailable. An extension cannot open its containing app, and the responder-chain
  workaround is not dependable on current iOS, so the member opens Nest
  themselves.
- **macOS extension.** `ShareExtensionMac/` is the native Mac app's counterpart
  (`dev.willsawyerrrr.nest.macos.share-extension`): an `NSViewController` with the
  same activation rule, inbox copy, and result messages, offered in the macOS
  share menu.
- **App Group.** `group.dev.willsawyerrrr.nest`, in `Nest.entitlements` and
  `ShareExtension.entitlements`. The native Mac app uses the team-prefixed
  `8558CXPT9G.dev.willsawyerrrr.nest` in `NestMac/Nest.entitlements` and
  `ShareExtensionMac/ShareExtension.entitlements`, authorised by its Developer ID
  profiles.
  `Shared/ShareInbox.swift` (compiled into both
  targets) owns the `SharedReceipts/` folder in the group container: one
  `<uuid>/` directory per file holding `file` and `meta.json` (name, media type,
  size, time), written under a `.tmp-` name and renamed into place so the app
  never reads a half-copied file. Types are decided by extension as in the PWA
  (PDF, JPEG, PNG, GIF, WebP, HEIC/HEIF); a name without one takes the
  extension its type identifier implies.
- **Hand-off.** `WebView.swift`'s coordinator sends pending files to the page after
  each load and whenever the app becomes active, after purging files older than
  seven days. The web view exists only while signed in, so a file shared while
  signed out stays in the inbox until the member signs in. Each file crosses as
  `window.__nestShare.begin(id, name, type)`, base64 `chunk`s of 384 KiB (each
  encoded separately), and `finish(id)` (`ShareBridge.swift`). The PWA queues the
  file and posts `{ type: 'queued', ids }` to the `nestShare` message handler;
  only then does the app delete its copy. A page that has no bridge (an older
  build) or reloads before queuing leaves the file in the inbox for the next
  attempt. The app sends each id once per page load, and the PWA ignores an id it
  has already received, so a file never becomes two drafts.
- **PWA side** (`lib/nativeShare.ts`, `hooks/useSharedFiles.ts`,
  `components/SharedFilesRedirect.tsx`; gated on `window.__NEST_NATIVE_SHELL__`):
  arriving files wait in memory. `SharedFilesRedirect` takes the member to
  `/deductions`, where the signed-in member's receipt queue
  (`useDeductionReceiptQueue`, see [`bulk-upload.md`](bulk-upload.md)) adds them
  as work expenses, each a draft whose category stays editable. A co-member's
  list never takes them.

## Apple Developer Program

A paid Apple Developer Program membership is **not** required to build, run, or
use this app on either platform. Per Apple's App Intents documentation, an
`AppShortcutsProvider` needs no entitlement: a free personal team covers
compile, Simulator, on-device install (7-day provisioning), a local Mac
Catalyst build, and the App Shortcut reaching the Shortcuts app and Spotlight
on both platforms. (The share extension is the exception: its App Group
needs the paid team to register, so sharing into Nest runs on TestFlight builds.)
`com.apple.developer.siri` is the legacy SiriKit /
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
real iOS device**; the queries answer. **The iOS Simulator cannot reliably
invoke an App Shortcut** — it fails with "Unable to run App Shortcut" regardless
of the code — so test the intents on iOS hardware. The Simulator is still fine
for the sign-in flow, the web shell, and `xcodebuild test`. A Mac Catalyst build
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
  `SessionBridge.swift`, `ShareBridge.swift`, `Supabase.swift`, `Auth.swift`, and
  `Intents/`.
- `ShareExtension/` — the share extension (`ShareViewController.swift`, its
  entitlements; `Info.plist` is generated).
- `Shared/` — `ShareInbox.swift` and `ShareSummary.swift`, compiled into both
  `Nest` and `ShareExtension`.
- `NestTests/` — Swift Testing unit tests for the Intent logic (each service's
  phrasing, its request shape, and the signed-out / HTTP-failure sentence
  mapping), for `SessionBridge`'s injected JavaScript and string escaping, and
  for the share inbox (storing, limits, ordering, cleanup, hand-off scripts).

See [`apps/ios/README.md`](../apps/ios/README.md) for build and sign-in-flow
instructions.

## CI

`.github/workflows/ci.yml` runs `build-ios`, `build-catalyst` and `build-macos` on
`macos-latest` runners: `build-ios` (the iOS Simulator destination),
`build-catalyst` (the Mac Catalyst destination) and `build-macos` (the `NestMac`
scheme). Each runs `xcodegen generate`,
then `xcodebuild build` (which runs `appintentsmetadataprocessor`, so a
malformed App Shortcut phrase — a missing `\(.applicationName)`, a duplicate
identifier, an unresolvable parameter type — fails the build on both
destinations), then `xcodebuild test`. Neither overrides `SWIFT_EXEC` (that
drops `--compile-time-extraction` and breaks App Intents metadata extraction
on Xcode 16+) and both pass `-skipMacroValidation` /
`-skipPackagePluginValidation` so a fresh runner does not stall on a macro or
plugin approval prompt. `build-catalyst` and `build-macos` additionally pass
`CODE_SIGNING_ALLOWED=NO`, since a runner carries no development team and
Catalyst and macOS builds, unlike the Simulator, always sign.

All three are **required** — the `changes` job (`dorny/paths-filter`) gates them on
`apps/ios/**` (or the workflow file itself) having changed, and `ci-status`
`needs` all three, so a real regression blocks the merge; a PR that leaves
`apps/ios/` untouched gets `skipped` on all three, which `ci-status` treats the same
as a pass rather than waiting forever on a check that never ran. See
[`architecture.md`](architecture.md#ci).

## Deployment

`.github/workflows/deploy-ios.yml` archives the `Nest` scheme unsigned, signs it at export with the team's cloud-managed distribution certificate, and uploads it to TestFlight on every merge to `main` that touches `apps/ios/**`. The archive embeds the share extension, so the export's automatic signing (`-allowProvisioningUpdates`, with the App Store Connect API key) also registers the extension's App ID, the `group.dev.willsawyerrrr.nest` App Group, and their profiles. See [`operations.md`](operations.md#deployment).
