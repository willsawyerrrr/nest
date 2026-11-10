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
`NSViewRepresentable`, external-link and foreground handling, `ContentView+*.swift`'s
dynamic colours). Every file below applies to all three builds unless noted.

### Navigation shell

Once signed in, `ContentView` shows `NavigationShell` (`Nest/Navigation/`),
the PWA's `TabBar` natively: on iPhone (compact width) a top bar (brand mark,
"What's new", burger) whose burger opens a left drawer over a dimmed scrim; on
iPad, Mac Catalyst and `NestMac` a persistent 240pt sidebar (wordmark lockup, nav,
"What's new" in the footer). Both render `NavMenu` (`NavMenu.swift`) over
`NavEntry.entries(planningActive:)`: Summary stands alone, Plan, Grow, Tax and
Settings are collapsible groups with uppercase headers and chevrons, the active
item takes a brand wash with a leading bar, and a folded group holding the
selected route shows a brand dot. The group holding the selected route opens on
every selection and the rest fold away; toggling a header in between stands.
Planning sits beside Summary while planning mode is on. `⌘1`…`⌘9` jump to a
route and `⇧⌘←` / `⇧⌘→` cycle through them.

`Route` (`Route.swift`) is the single route registry: it enumerates every PWA
path, its `NavSection` groups (Summary, Plan, Grow, Tax, Settings) mirror the
PWA's `NAV_SECTIONS`, and `planning`, `allowance` and `whatsNew` sit outside the
nav (Planning is reached from the planning banner and the Planning mode settings
screen; What's new from the header button). A screen is registered by adding or
editing its `Route` case and `content`; the chrome reads the registry and never
changes. The selected route renders in its own `NavigationStack`, recreated when
the route changes, so pushed details keep a back button.

`Route.content` returns `.native(AnyView)` or `.web(path:)` per route. Every
route not yet native is `.web` and renders `WebRouteView`, which loads `WebApp.url` plus the
path in `WebView` (with its session mirroring) and shows `ErrorView` with a
retry on failure. A screen migrates by returning `.native` for its route (Summary, Breakdowns, Budget, Allowance, Planning mode, Tax estimate, EOFY and Inflows are native;
see [`native-screens.md`](native-screens.md) for the screen pattern). The
shell shows one web view at a time, recreated when the route changes.

### Native design system

`Nest/DesignSystem/` ports the PWA's tokens and primitives (see
[`design-system.md`](design-system.md#native-swiftui)): `Tokens.swift`
(colours, chart hues, spacing, radius, type), `Money.swift` (AU currency
formatting and sign colour), `Components.swift` (card, list row, money text,
pill, form field, primary button, `ErrorView`), `NestCharts.swift` (tokenised
Swift Charts wrappers) and a `#Preview` gallery in `DesignSystemGallery.swift`.
`ErrorView` takes strings only, so callers pass fixed copy per error code and an
upstream response body never reaches the screen.

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
  `App` omits its own `TabBar` (sidebar, mobile top bar and drawer) in the shell,
  since the native burger menu and sidebar own navigation; `.app-shell--native` drops the
  padding that reserved room for that chrome, leaving page content and each
  page's own header.

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
  building against no project. Local dev runs `xcodegen generate` after
  loading the [local env files](operations.md#1password-environments); CI (`ci.yml`'s `build-ios` / `build-catalyst` /
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

## Engines in JavaScriptCore

The tax, plan and household engines run in the app, so native screens compute
the figures the PWA and the MCP server do from one implementation (no Swift
port). `packages/js-core` (`@nest/js-core`) bundles `@nest/tax`, `@nest/plan` and
`@nest/household` with esbuild into one IIFE script,
`apps/ios/Nest/Engine/nest-engines.js`, which installs a `NestEngine` global with
JSON-in, JSON-out entry points: `estimateTax`
(`estimateHouseholdTaxFromRows`, projected onto its scalar cents figures),
`summariseHousehold` (`summariseHouseholdFromRows`, the fortnightly buffer
included), `projectGoalQueue` (the savings-goal queue), `summariseBreakdowns`
(each breakdown's annual and fortnightly roll-up and each item's fortnightly
figure, from `@nest/plan`'s `annualCents` / `fortnightlyCents`) and `budgetOverview`
(`@nest/plan`'s `budgetOverview`: each budget line's fortnightly and annual
amounts, each group's fortnightly subtotal, each allowance reconciled, and which
temporary items are active) and, for the Tax estimate and EOFY screens, `taxScreen`
(the household and per-member estimate with each member's whole tax breakdown, super
cap summary, HELP payoff, projected interest and payslip count), `salarySacrifice`,
`mlsWhatIf` and `householdYear` (the what-if and household year summary the PWA runs
in its components). The inputs are the
rows those functions already take (see `packages/js-core/src/index.ts`).

- **The bundle ships in the app, not fetched.** It is committed, so the Xcode
  build needs no Node toolchain, and lives under `Nest/`, so both `Nest` and
  `NestMac` bundle it as a resource with no `project.yml` entry. `pnpm
  bundle:js-core` rewrites it; `pnpm check:js-core` (run by CI's `check` job)
  fails when it has drifted from the engine sources.
- **`Engine`** (`Nest/Engine/Engine.swift`) is an actor over a `JSContext`, so a
  call runs off the main actor and the context is never used concurrently. It
  takes an `Encodable` input and returns a `Decodable` result (`TaxEstimate`,
  `BudgetSummary`, `GoalQueueProjection` in `EngineTypes.swift`), or raw JSON via
  `call(_:json:)`. A script or call error surfaces as `Engine.Failure`.
- **Numbers.** Money is integer cents and decodes as `Int64`; a trade's unit
  price is an integer count of microdollars, and the engine's `BigInt` products
  stay inside the engine, with only whole cents returned. The bridge serialises
  any `bigint` it would return as a decimal string (`serialise`), since
  `JSON.stringify` throws on one.
- **Parity.** `packages/js-core`'s vitest suite builds cases from the household
  golden fixtures (tax estimate, fortnightly buffer) plus goal-queue and
  microdollar-trade cases, writes the TypeScript output to
  `NestTests/Fixtures/engine-parity.json` (`pnpm update:js-core-fixtures`
  regenerates it; the suite fails when it drifts), and runs the committed bundle
  against it. `EngineParityTests` feeds the same inputs through the Swift `Engine`
  and asserts identical output.

The App Intents below read their figures from edge functions, not a Swift
computation, so they do not use `Engine`.

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
  threatens its memory limit. It then says what to do next, with a line for each
  file left out (not a PDF or image, over 25 MB, or not saved), or one line
  saying the App Group container is unavailable. An extension cannot open its
  containing app, and the responder-chain workaround is not dependable on
  current iOS, so once a file is saved the extension posts a local notification
  ("N files are ready to review") that opens Nest when tapped, and the sheet
  says "Tap the notification to review." The app asks for notification
  permission when it launches; until it is allowed, the sheet says "Open
  Nest to review." instead.
- **macOS extension.** `ShareExtensionMac/` is the native Mac app's counterpart
  (`dev.willsawyerrrr.nest.macos.share-extension`): an `NSViewController` with the
  same activation rule, inbox copy, and result messages, offered in the macOS
  share menu. Once a file is saved it opens the containing app
  (`NSWorkspace.openApplication`), which takes the files as it becomes active.
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

## Push notifications

The web view is a `WKWebView`, which cannot receive Web Push, so the app is
reached over APNs instead. The trigger logic, preferences, and dedupe are shared
with Web Push (see [`architecture.md`](architecture.md#push-notifications)).

- **Entitlement.** `Nest/NestiOS.entitlements` adds `aps-environment` to the
  iOS entitlements; `project.yml` selects it with
  `CODE_SIGN_ENTITLEMENTS[sdk=iphone*]`, so Mac Catalyst and `NestMac` keep their
  own entitlement files. The value is `development`; exporting for TestFlight
  signs with the distribution profile, which swaps in `production`. The App ID's
  Push Notifications capability is enabled by automatic signing at export.
- **Registration.** `NestApp` registers for remote notifications once the
  member allows notifications at launch, except under Mac Catalyst, which
  keys push differently and does not receive APNs. The iOS `NestAppDelegate`
  (`NestAppDelegate+iOS.swift`, wired uniformly on every platform through a
  `PlatformAppDelegateAdaptor` typealias; the macOS one is an empty stand-in)
  receives the token and hands it to `PushRegistrar`, which calls the
  `register_apns_device` RPC through PostgREST with the session's access token
  as soon as it has both a token and a session (retrying after a failed call
  and on each sign-in or foreground). The
  environment is `sandbox` in Debug builds and `production` otherwise. Before the
  page's sign-out request signs out, the app deletes its own `apns_device` row, so
  a signed-out install stops receiving the member's notifications.
- **Tap.** The payload carries `url`, an in-app path. `NestAppDelegate`
  resolves it against the web app's origin (`NotificationRoute` ignores anything
  that is not a same-origin path) and hands it to `NotificationRouter` on the
  main actor, which loads it in the web view: directly when one is showing,
  otherwise it is held and used as the first load once the member is signed in.
  Notifications that arrive in the foreground are shown as banners. The delegate
  uses the completion-handler forms of `didReceive` and `willPresent` and calls
  the completion handler on the main thread: UserNotifications calls them on a
  background queue, and an `async` form would complete from a background
  executor, which makes UIKit abort.
- **Settings page.** In the web view the Notifications settings page reports the
  device as on (`PushStatus` `native`, from `__NEST_NATIVE_SHELL__`) with no web
  opt-in, shows the per-trigger toggles, and its test button sends to the app.
  Turning notifications off or back on is done in iOS Settings.
- **Not covered.** Mac Catalyst and the native Mac app do not register for
  APNs. Backend credentials are set up in
  [`operations.md`](operations.md#apns-auth-key-setup).

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

## Native data layer

`Nest/Data/` is the data access the native screens build on, over the same
Supabase session as the Intents (`supabaseAuth`), with no Functions or PostgREST
SDK products — plain `URLSession` requests carrying the user's bearer token and
the anon key.

- **`SupabaseAPI`** — typed PostgREST `select` / `insert` / `update` / `delete`
  (a delete with no filter is refused), RPC (`rpc` for a result, `call` for a
  side effect), Storage signed URLs and edge-function `invoke`. The transport and
  token provider are injected, so tests stub the network with a closure.
- **Models** (`Models.swift`) — hand-written `Codable` rows for `households`,
  `members`, `accounts`, `budget_line`, `savings_goal`, `inflows`, `payslip`,
  `deduction` and `pay_split`, plus the Postgres enums they use. Dates and
  timestamps stay ISO strings; each model's `CodingKeys` raw values are the exact
  column names. Types are hand-written rather than generated: the app has no
  TypeScript or codegen toolchain, a screen needs a handful of tables, and
  `NestRowSchemaTests` compares every model's columns and every enum's values
  with `apps/pwa/src/lib/database.types.ts` (generated from the migrations), so a
  column or enum change fails the iOS build until the model follows. Further
  tables are added the same way.
- **`RowCache`** — the last-fetched rows of each query as JSON files under
  `Caches/NestRows/<user id>/` (`<table>__<digest of the query>.json`), a plain
  file store that behaves identically on iOS, Catalyst and macOS. The system may
  purge it; a missing or unreadable file is a cache miss. Entries are scoped per
  user id, and `NestData.live` clears the whole cache when the session ends.
- **`NestData`** — `rows(_:filters:order:limit:)` returns a stream that yields the
  cached rows first (`Snapshot.isCached == true`), then the fetched rows, which
  replace the cache. A failed fetch ends the stream with a `NestError` after any
  cached snapshot. Every write (`insert`, `update`, `delete`, `call`) drops the
  cached queries of its own table plus any `also` / `invalidating` tables it
  affects — even when the write fails, since the server may have applied it.
- **`NestError`** — every failure surfaces as a `NestError` with a stable `code`
  (`unauthenticated`, `forbidden`, `not_found`, `conflict`, `invalid_request`,
  `rate_limited`, `offline`, `timeout`, `server`, `decoding`, `unknown`) and a
  fixed `userMessage` per code. The code comes from the HTTP status, refined by
  the upstream JSON `code` (PostgREST `PGRST301`, Postgres SQLSTATE classes
  `42501`, `23505`, `22`/`23`); `URLError`s map to `offline` / `timeout`, decode
  failures to `decoding`. Upstream message text is never read or shown.

## Project structure

- `project.yml` — [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec; the
  source of truth for the Xcode project, its `Info.plist` properties, and the
  SPM dependency. `Nest`'s `supportedDestinations: [iOS, macCatalyst]` is what
  makes it a two-platform target rather than a separate macOS project; its
  `Info.plist` carries no `LSRequiresIPhoneOS` key, since that key excludes
  Catalyst outright. The generated `Nest.xcodeproj` and `Nest/Info.plist` are
  not committed.
- `Nest/` — Swift sources: `NestApp.swift`, `ContentView.swift`, `Navigation/`,
  `DesignSystem/`, `Screens/` (the [native screens](native-screens.md)), `WebView.swift`,
  `SessionBridge.swift`, `ShareBridge.swift`, `Supabase.swift`, `Auth.swift`,
  `PushNotifications.swift`, `Data/` (the [native data layer](#native-data-layer)),
  `NestAppDelegate+iOS.swift` /
  `NestAppDelegate+macOS.swift`, and `Intents/`. The iOS/macOS divergence in
  `Auth.swift`, `ContentView.swift`, `NestAppDelegate+*.swift`, and
  `NestApp.swift` lives in per-platform `+iOS`/`+macOS` files excluded per
  target in `project.yml`, the way `WebView.swift`'s `makeNSView`/`makeUIView`
  already isolates its own. `Engine/` holds the JavaScriptCore `Engine`, its
  result types, and the bundled `nest-engines.js`.
- `ShareExtension/` — the share extension (`ShareViewController.swift`, its
  entitlements; `Info.plist` is generated).
- `Shared/` — `ShareInbox.swift` and `ShareSummary.swift`, compiled into both
  `Nest` and `ShareExtension`.
- `NestTests/` — Swift Testing unit tests for the Intent logic (each service's
  phrasing, its request shape, and the signed-out / HTTP-failure sentence
  mapping), for `SessionBridge`'s injected JavaScript and string escaping, for
  the share inbox (storing, limits, ordering, cleanup, hand-off scripts), and for
  push registration (token encoding, notification routes, the register/unregister
  requests, and the registrar's retry behaviour), money formatting and sign
  colour, the route table and route-to-URL mapping, for the data layer (request
  shapes, error mapping, the row cache and its invalidation, and the model-vs-schema
  drift guard), and for `Engine` (the parity fixtures in `NestTests/Fixtures/`).

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
