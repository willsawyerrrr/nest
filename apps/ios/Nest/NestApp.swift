import GoogleSignIn
import SwiftUI

@main
struct NestApp: App {
    @State private var auth = AuthModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .task { auth.start() }
                .onChange(of: auth.state) { _, state in
                    refreshSystemSurfaces(for: state)
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { refreshSystemSurfaces(for: auth.state) }
                }
                .onOpenURL { url in
                    _ = GIDSignIn.sharedInstance.handle(url)
                }
        }
    }

    /// The App Shortcut phrases and the Spotlight index name the household's
    /// budget lines and routed accounts, so they refresh once a session exists
    /// and whenever the app becomes active, and the index empties on sign-out.
    private func refreshSystemSurfaces(for state: AuthModel.SessionState) {
        switch state {
        case .signedIn:
            NestShortcuts.updateAppShortcutParameters()
            Task { await SpotlightIndexer.shared.refresh() }
        case .signedOut:
            Task { await SpotlightIndexer.shared.clear() }
        case .unknown:
            break
        }
    }
}
