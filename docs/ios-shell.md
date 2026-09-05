# iOS shell prototype

`apps/ios` is a minimal native iOS app that embeds the production PWA
(`https://nest.willsawyerrrr.dev`) in a `WKWebView`. It exists to let the
household evaluate whether the embedded-PWA experience is good enough to
justify investing in App Intents (Linear WSD-95) before committing to that
larger scope.

**This is a prototype pending a go/no-go call, not a committed platform
change.** The PWA remains the product and the one thing both iOS and web
run; nothing about how the PWA is built, deployed, or served changes because
this app exists. If the household decides not to proceed with WSD-95,
`apps/ios` is expected to be deleted.

## What it is

A single-screen SwiftUI app:

- A full-screen `WKWebView` loads the production PWA URL directly — no local
  build of the PWA, no bundled assets.
- The default (persistent) `WKWebsiteDataStore` is used, so the Supabase Auth
  session and cookies survive an app relaunch — this is a full sign-in flow
  through the PWA's existing Google OAuth, not a stripped-down demo.
- A loading indicator shows while the page loads, and a simple "couldn't
  load" state with a Retry button shows if the load fails (no network, DNS
  failure, etc.).

See [`apps/ios/README.md`](../apps/ios/README.md) for the project structure
and how to generate and open the Xcode project.

## What it explicitly is not

- No App Intents, no Siri integration, no share extension, no document
  intake — all deferred to WSD-95 if the household proceeds.
- No App Store Connect setup, no distribution signing/provisioning — this is
  local-build-and-side-load-only, built and run from a personal free
  developer account or the Simulator.
- Not part of CI: `.github/workflows/` only covers the TypeScript/Postgres
  surface, and no Xcode runner is available. A future iOS CI job (build +
  lint on PRs touching `apps/ios`) is a reasonable follow-up if the prototype
  graduates into committed scope, but is out of scope for the prototype
  itself.

## Bundle identifier

`dev.willsawyerrrr.nest.ios`, under the `dev.willsawyerrrr.*` reverse-DNS the
app's domain implies.
