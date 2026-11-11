import Auth
import SwiftUI
import WebKit

#if os(macOS)
import AppKit
/// The platform's `UIViewRepresentable` / `NSViewRepresentable`.
private typealias PlatformViewRepresentable = NSViewRepresentable
#else
import UIKit
private typealias PlatformViewRepresentable = UIViewRepresentable
#endif

/// Representable wrapper around `WKWebView` that loads a fixed URL and
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
struct WebView: PlatformViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView { makeWebView(context: context) }
    func updateNSView(_ webView: WKWebView, context: Context) {}
    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        dismantle(webView, coordinator: coordinator)
    }
    #else
    func makeUIView(context: Context) -> WKWebView { makeWebView(context: context) }
    func updateUIView(_ webView: WKWebView, context: Context) {
        // The URL is fixed for the lifetime of the view; nothing to update.
    }
    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        dismantle(webView, coordinator: coordinator)
    }
    #endif

    private func makeWebView(context: Context) -> WKWebView {
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
        configuration.userContentController.add(context.coordinator, name: "nestReady")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.load(URLRequest(url: NotificationRouter.shared.take() ?? url))
        return webView
    }

    private static func dismantle(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nestAuth")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nestReady")
        coordinator.stop()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let parent: WebView
        private weak var webView: WKWebView?
        private var sessionObservation: Task<Void, Never>?

        init(_ parent: WebView) {
            self.parent = parent
        }

        deinit {
            sessionObservation?.cancel()
        }

        /// Opens the pages tapped notifications name: the one waiting from
        /// before the page loaded, and any that follow.
        private func openNotificationURLs(in webView: WKWebView) {
            let router = NotificationRouter.shared
            router.handler = { [weak webView] url in webView?.load(URLRequest(url: url)) }
            if let url = router.take() { webView.load(URLRequest(url: url)) }
        }

        func stop() {
            NotificationRouter.shared.handler = nil
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
            openNotificationURLs(in: webView)
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
                #if os(macOS)
                NSWorkspace.shared.open(url)
                #else
                UIApplication.shared.open(url)
                #endif
            }
            return nil
        }

        /// Handles the page's requests. `nestReady` pushes the session once the
        /// page's hooks exist. `nestAuth`'s `signOut` clears the native session,
        /// which emits `.signedOut` and swaps the web view for the sign-in gate.
        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            switch message.name {
            case "nestAuth":
                switch SessionBridge.pageRequest(from: message.body) {
                case .signOut:
                    Task {
                        await PushRegistrar.shared.unregister()
                        try? await supabaseAuth.signOut()
                    }
                case nil: break
                }
            case "nestReady":
                Task { await pushCurrentSession() }
            default:
                break
            }
        }

        /// Reads the current session — refreshing it if it has expired, so the
        /// page never receives a stale token — and pushes it into the page.
        private func pushCurrentSession() async {
            guard let session = try? await supabaseAuth.session else { return }
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
