import SwiftUI
import WebKit

/// `UIViewRepresentable` wrapper around `WKWebView` that loads a fixed URL and
/// reports load progress and failures through its bindings.
///
/// Uses the default, persistent `WKWebsiteDataStore` (rather than an ephemeral
/// one) so cookies and local storage — and with them the Supabase Auth
/// session — survive a relaunch of the app.
struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // The URL is fixed for the lifetime of the view; nothing to update.
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: WebView

        init(_ parent: WebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
            parent.loadError = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            reportFailure(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            reportFailure(error)
        }

        /// Surfaces a navigation failure, ignoring `NSURLErrorCancelled` —
        /// which fires whenever a newer navigation supersedes this one and is
        /// not a real failure.
        private func reportFailure(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            parent.isLoading = false
            parent.loadError = error.localizedDescription
        }
    }
}
