# Nest iOS shell (prototype)

A minimal native iOS app that embeds the production PWA
(`https://nest.willsawyerrrr.dev`) in a `WKWebView`. It exists to evaluate
whether the embedded-PWA experience is good enough to justify investing in
App Intents (Linear WSD-95) — see [`docs/ios-shell.md`](../../docs/ios-shell.md)
for the full context. It is a prototype, not a committed platform: the PWA
remains the product.

## Structure

- `project.yml` — [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec; the
  source of truth for the Xcode project and its `Info.plist` properties. The
  generated `Nest.xcodeproj` and `Nest/Info.plist` are not committed.
- `Nest/` — Swift sources.
  - `NestApp.swift` — SwiftUI app entry point.
  - `ContentView.swift` — full-screen shell: the web view plus loading and
    error overlays.
  - `WebView.swift` — `UIViewRepresentable` wrapping `WKWebView`, using the
    default (persistent) `WKWebsiteDataStore` so the signed-in session
    survives relaunch.

## Building

Requires Xcode (not installed/verified in this environment — see the PR that
introduced this app for what has and hasn't been build-verified) and
[XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`):

```sh
cd apps/ios
xcodegen generate
open Nest.xcodeproj
```

Build and run on a simulator or a personal free developer account/device —
this is local-build-and-side-load-only; there is no App Store Connect setup.
