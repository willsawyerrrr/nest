import SwiftUI

/// Full-screen shell hosting the embedded PWA, with a loading indicator while
/// the page loads and a Retry-able error state if it fails.
struct ContentView: View {
    private static let pwaURL = URL(string: "https://nest.willsawyerrrr.dev")!

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var reloadToken = UUID()

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
    }

    /// Clears the error, shows the loading indicator again, and forces
    /// `WebView` to be recreated (via a fresh `id`) so it re-issues the load.
    private func retry() {
        loadError = nil
        isLoading = true
        reloadToken = UUID()
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
}
