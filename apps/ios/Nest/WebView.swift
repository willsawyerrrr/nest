import Auth
import SwiftUI
import WebKit

/// `UIViewRepresentable` wrapper around `WKWebView` that loads a fixed URL and
/// reports load progress and failures through its bindings.
///
/// Uses the default, persistent `WKWebsiteDataStore` (rather than an ephemeral
/// one) so cookies and local storage survive a relaunch of the app.
///
/// The native app owns the one Supabase session (`supabaseAuth`); this view
/// mirrors it into the page. A `.atDocumentStart` user script marks the page as
/// running in the shell, the current session is pushed on every load and on
/// every `authStateChanges` emission, and the `nestAuth` message handler takes
/// the page's sign-out request back to the native client. The `nestOpen`
/// message handler opens a document URL the page cannot open itself (a
/// `WKWebView` ignores `window.open`) in the system browser.
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
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: SessionBridge.shellFlagScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(context.coordinator, name: "nestAuth")
        configuration.userContentController.add(context.coordinator, name: "nestOpen")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // The URL is fixed for the lifetime of the view; nothing to update.
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nestAuth")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nestOpen")
        coordinator.stop()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        private let parent: WebView
        private weak var webView: WKWebView?
        private var sessionObservation: Task<Void, Never>?

        init(_ parent: WebView) {
            self.parent = parent
        }

        deinit {
            sessionObservation?.cancel()
        }

        func stop() {
            sessionObservation?.cancel()
            sessionObservation = nil
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
            parent.loadError = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            self.webView = webView
            Task { await pushCurrentSession() }
            observeSessionChanges()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            reportFailure(error)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            reportFailure(error)
        }

        /// Handles the page's requests. `nestAuth` signs out: clear the native
        /// session, which emits `.signedOut` and swaps the web view for the
        /// sign-in gate. `nestOpen` opens an `https` URL in the system browser.
        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            switch message.name {
            case "nestAuth":
                Task { try? await supabaseAuth.signOut() }
            case "nestOpen":
                guard let url = SessionBridge.openableURL(from: message.body) else { return }
                UIApplication.shared.open(url)
            default:
                break
            }
        }

        /// Reads the current session — refreshing it if it has expired, so the
        /// page never receives a stale token — and pushes it into the page.
        private func pushCurrentSession() async {
            let session = try? await supabaseAuth.session
            apply(session)
        }

        /// Keeps the page in step with later token refreshes and sign-outs.
        private func observeSessionChanges() {
            guard sessionObservation == nil else { return }
            sessionObservation = Task { [weak self] in
                for await (_, session) in supabaseAuth.authStateChanges {
                    self?.apply(session)
                }
            }
        }

        private func apply(_ session: Session?) {
            let script =
                session.map {
                    SessionBridge.applySessionScript(
                        accessToken: $0.accessToken, refreshToken: $0.refreshToken
                    )
                } ?? SessionBridge.clearSessionScript
            webView?.evaluateJavaScript(script)
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
