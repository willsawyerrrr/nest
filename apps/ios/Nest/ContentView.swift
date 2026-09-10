import SwiftUI

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

/// Full-screen Google sign-in. This is the app's only login: the native session
/// it establishes is mirrored into the embedded web app, so there is no second
/// sign-in inside the web view.
private struct SignInView: View {
    @Environment(AuthModel.self) private var auth
    @State private var isSigningIn = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "bird.fill")
                .font(.system(size: 52))
                .foregroundStyle(.tint)
            Text("Nest")
                .font(.largeTitle.weight(.bold))
            Text("Track income, tax, spending, and savings for your household.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            if let error = auth.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Button {
                Task {
                    isSigningIn = true
                    await auth.signIn()
                    isSigningIn = false
                }
            } label: {
                if isSigningIn {
                    ProgressView()
                } else {
                    Text("Continue with Google")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isSigningIn)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
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
                .foregroundStyle(.secondary)
            Text("Couldn't load Nest")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}

#Preview {
    ContentView()
        .environment(AuthModel())
}
