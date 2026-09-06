import SwiftUI

/// Full-screen shell hosting the embedded PWA, with a loading indicator while
/// the page loads and a Retry-able error state if it fails.
struct ContentView: View {
    private static let pwaURL = URL(string: "https://nest.willsawyerrrr.dev")!

    @Environment(AuthModel.self) private var auth

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var reloadToken = UUID()
    @State private var siriBannerDismissed = false

    var body: some View {
        ZStack {
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
        .overlay(alignment: .top) {
            if auth.state == .signedOut && !siriBannerDismissed {
                ConnectSiriBanner(onDismiss: { siriBannerDismissed = true })
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: auth.state)
        .animation(.default, value: siriBannerDismissed)
    }

    /// Clears the error, shows the loading indicator again, and forces
    /// `WebView` to be recreated (via a fresh `id`) so it re-issues the load.
    private func retry() {
        loadError = nil
        isLoading = true
        reloadToken = UUID()
    }
}

/// Dismissible prompt, shown only without a native session, that runs Google
/// OAuth so the App Shortcut can read the household's buffer by voice. The web
/// view stays fully usable behind it.
private struct ConnectSiriBanner: View {
    let onDismiss: () -> Void

    @Environment(AuthModel.self) private var auth
    @State private var isSigningIn = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mic.circle.fill")
                .font(.title2)
                .foregroundStyle(.tint)

            VStack(alignment: .leading, spacing: 2) {
                Text("Ask Siri about Nest")
                    .font(.subheadline.weight(.semibold))
                Text(auth.lastError ?? "Connect your account to check your fortnightly buffer by voice.")
                    .font(.caption)
                    .foregroundStyle(auth.lastError == nil ? Color.secondary : Color.red)
            }

            Spacer(minLength: 8)

            if isSigningIn {
                ProgressView()
            } else {
                Button(auth.lastError == nil ? "Connect" : "Retry") {
                    Task {
                        isSigningIn = true
                        await auth.signIn()
                        isSigningIn = false
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(4)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .shadow(radius: 8, y: 2)
        .padding(.horizontal, 12)
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
