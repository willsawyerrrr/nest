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
/// the page's sign-out request back to the native client.
///
/// The page opens receipts and other documents behind a signed URL with
/// `window.open` after fetching the URL, so the call no longer carries the tap's
/// user activation. `javaScriptCanOpenWindowsAutomatically` lets it through, and
/// the `WKUIDelegate` hands the new-window request's `https` URL to the system
/// browser (a `WKWebView` otherwise drops new-window requests silently).
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
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: SessionBridge.shellFlagScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(context.coordinator, name: "nestAuth")
        configuration.userContentController.add(context.coordinator, name: "nestShare")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // The URL is fixed for the lifetime of the view; nothing to update.
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nestAuth")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nestShare")
        coordinator.stop()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let parent: WebView
        private weak var webView: WKWebView?
        private var sessionObservation: Task<Void, Never>?
        private var foregroundObservation: NSObjectProtocol?
        private let inbox = ShareInbox.shared()
        /// Ids already sent to the current page load. A reload starts the page
        /// afresh, so it forgets them too.
        private var delivered: Set<String> = []
        private var isDelivering = false

        init(_ parent: WebView) {
            self.parent = parent
        }

        deinit {
            sessionObservation?.cancel()
        }

        func stop() {
            sessionObservation?.cancel()
            sessionObservation = nil
            if let foregroundObservation {
                NotificationCenter.default.removeObserver(foregroundObservation)
                self.foregroundObservation = nil
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
            parent.loadError = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            self.webView = webView
            delivered = []
            Task {
                await pushCurrentSession()
                await deliverSharedFiles()
            }
            observeSessionChanges()
            observeForeground()
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

        /// Opens a page-requested new window (`window.open`, `target="_blank"`)
        /// in the system browser. No web view is created, so the request is
        /// handled here and nowhere else.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = SessionBridge.externalURL(for: navigationAction.request) {
                UIApplication.shared.open(url)
            }
            return nil
        }

        /// Handles the page's sign-out request: clear the native session, which
        /// emits `.signedOut` and swaps the web view for the sign-in gate.
        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            switch message.name {
            case "nestAuth":
                Task { try? await supabaseAuth.signOut() }
            case "nestShare":
                // The page has queued these files, so they leave the inbox.
                for id in ShareBridge.queuedIDs(from: message.body) {
                    inbox?.remove(id: id)
                }
            default:
                break
            }
        }

        /// Hands files waiting in the share inbox to the page's deduction
        /// receipt queue whenever the app comes back to the foreground.
        private func observeForeground() {
            guard foregroundObservation == nil else { return }
            foregroundObservation = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in await self?.deliverSharedFiles() }
            }
        }

        /// Sends each pending shared file to the page, once per page load. The
        /// file stays in the inbox until the page acknowledges it, so a page
        /// that cannot take it yet (not loaded, an older build) leaves it for
        /// the next foreground or load.
        private func deliverSharedFiles() async {
            guard let inbox, let webView, !isDelivering else { return }
            isDelivering = true
            defer { isDelivering = false }

            inbox.purgeStale()
            let items = ShareInbox.undelivered(inbox.pending(), delivered: delivered)
            guard !items.isEmpty,
                (try? await webView.evaluateJavaScript(ShareBridge.readyScript)) as? Bool == true
            else { return }

            for item in items {
                guard await send(item, to: webView) else { continue }
                delivered.insert(item.id)
            }
        }

        private func send(_ item: ShareInbox.Item, to webView: WKWebView) async -> Bool {
            guard let handle = try? FileHandle(forReadingFrom: item.fileURL) else { return false }
            defer { try? handle.close() }
            do {
                _ = try await webView.evaluateJavaScript(
                    ShareBridge.beginScript(id: item.id, name: item.name, mimeType: item.mimeType))
                while let data = try handle.read(upToCount: ShareBridge.chunkBytes), !data.isEmpty {
                    _ = try await webView.evaluateJavaScript(
                        ShareBridge.chunkScript(id: item.id, base64: data.base64EncodedString()))
                }
                _ = try await webView.evaluateJavaScript(ShareBridge.finishScript(id: item.id))
                return true
            } catch {
                return false
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
