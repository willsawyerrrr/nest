import SwiftUI
import UIKit

/// The app shell. The native app owns the one Supabase session, so this is a
/// blocking sign-in gate: `SignInView` when signed out, the embedded PWA once
/// signed in. The web view is handed the same session (see `WebView.swift`), so
/// the member signs in exactly once.
struct ContentView: View {
    private static let pwaURL = URL(string: "https://nest.willsawyerrrr.dev")!

    @Environment(AuthModel.self) private var auth

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var reloadToken = UUID()

    var body: some View {
        ZStack {
            switch auth.state {
            case .unknown:
                ProgressView()
                    .progressViewStyle(.circular)
                    .scaleEffect(1.5)
            case .signedOut:
                SignInView()
            case .signedIn:
                webView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NestPalette.background)
        .animation(.default, value: auth.state)
    }

    @ViewBuilder
    private var webView: some View {
        WebView(url: Self.pwaURL, isLoading: $isLoading, loadError: $loadError)
            .id(reloadToken)
            .ignoresSafeArea()

        if isLoading && loadError == nil {
            ProgressView()
                .progressViewStyle(.circular)
                .scaleEffect(1.5)
        }

        if let loadError {
            LoadErrorView(message: loadError, onRetry: retry)
        }
    }

    /// Clears the error, shows the loading indicator again, and forces
    /// `WebView` to be recreated (via a fresh `id`) so it re-issues the load.
    private func retry() {
        loadError = nil
        isLoading = true
        reloadToken = UUID()
    }
}

/// Full-screen Google sign-in, styled to match the PWA's `SignInScreen` — the
/// goose-in-nest mark, dark-first palette, and brand-lime button from
/// `theme.ts` — so the native gate doesn't read as a different, unstyled app.
/// This is the app's only login: the native session it establishes is
/// mirrored into the embedded web app, so there is no second sign-in inside
/// the web view.
private struct SignInView: View {
    @Environment(AuthModel.self) private var auth

    var body: some View {
        VStack(spacing: 24) {
            logo
            Text("Track income, tax, spending, and savings for your household.")
                .font(.subheadline)
                .foregroundStyle(NestPalette.dimmedText)
                .multilineTextAlignment(.center)

            if let error = auth.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button {
                auth.signIn()
            } label: {
                Group {
                    if auth.isSigningIn {
                        ProgressView()
                            .tint(.black)
                    } else {
                        Text("Continue with Google")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(NestPalette.brand)
            .foregroundStyle(.black)
            .controlSize(.large)
            .disabled(auth.isSigningIn)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NestPalette.background)
    }

    /// The goose mark beside the "nest" wordmark, mirroring `Logo.tsx`'s
    /// `lockup` variant: the mark restores a dark tile behind it in light mode
    /// only, since it was drawn for a near-black canvas.
    private var logo: some View {
        HStack(spacing: 18) {
            Image("NestMark")
                .resizable()
                .scaledToFit()
                .frame(width: 56, height: 56)
                .background(NestPalette.markTile, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text("nest")
                .font(.system(size: 50, weight: .semibold, design: .rounded))
                .foregroundStyle(NestPalette.text)
        }
    }
}

/// A simple "couldn't load" state shown when the web view's navigation fails.
private struct LoadErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 48))
                .foregroundStyle(NestPalette.dimmedText)
            Text("Couldn't load Nest")
                .font(.headline)
                .foregroundStyle(NestPalette.text)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(NestPalette.dimmedText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
                .tint(NestPalette.brand)
                .foregroundStyle(.black)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NestPalette.background)
    }
}

/// The subset of the PWA's dark-first palette (`apps/pwa/src/theme.ts`) this
/// screen needs, ported by hand since the two apps share no design-token
/// source. Each colour resolves per colour scheme the way Mantine's
/// `light-dark(...)` does on the web.
private enum NestPalette {
    static let background = Color(light: .white, dark: Color(hex: 0x0B0F14))
    static let text = Color(light: Color(hex: 0x1A1B1E), dark: Color(hex: 0xE6EDF3))
    static let dimmedText = Color(light: Color(hex: 0x6B7280), dark: Color(hex: 0x8B99A6))
    /// Brand accent (electric lime, shade 5) — `autoContrast` pairs it with
    /// black text on both schemes.
    static let brand = Color(hex: 0xB6F400)
    /// Restores the mark's near-black canvas behind it in light mode only.
    static let markTile = Color(light: Color(hex: 0x141A21), dark: .clear)
}

private extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    /// A colour that resolves to `light` or `dark` by the active colour scheme.
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }
}

#Preview {
    ContentView()
        .environment(AuthModel())
}
