import GoogleSignIn
import SwiftUI
import UserNotifications

@main
struct NestApp: App {
    @State private var auth = AuthModel()
    @Environment(\.scenePhase) private var scenePhase
    #if os(iOS) && !targetEnvironment(macCatalyst)
    @UIApplicationDelegateAdaptor(NestAppDelegate.self) private var appDelegate
    #endif

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .task {
                    auth.start()
                    requestNotificationAuthorization()
                }
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

    /// The share extension posts a notification that opens Nest when tapped,
    /// and Nest's own alerts arrive over APNs, both of which need the member's
    /// permission, asked for when the app launches. Once it is granted the app
    /// registers for remote notifications.
    private func requestNotificationAuthorization() {
        #if !os(macOS)
        Task {
            let center = UNUserNotificationCenter.current()
            #if os(iOS) && !targetEnvironment(macCatalyst)
            if (try? await center.requestAuthorization(options: [.alert, .sound])) == true {
                UIApplication.shared.registerForRemoteNotifications()
            }
            #else
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
            #endif
        }
        #endif
    }

    /// The App Shortcut phrases and the Spotlight index name the household's
    /// budget lines and routed accounts, so they refresh once a session exists
    /// and whenever the app becomes active, and the index empties on sign-out.
    private func refreshSystemSurfaces(for state: AuthModel.SessionState) {
        switch state {
        case .signedIn:
            NestShortcuts.updateAppShortcutParameters()
            Task { await PushRegistrar.shared.sync() }
            Task { await SpotlightIndexer.shared.refresh() }
        case .signedOut:
            Task { await SpotlightIndexer.shared.clear() }
        case .unknown:
            break
        }
    }
}
