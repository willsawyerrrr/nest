import GoogleSignIn
import SwiftUI

@main
struct NestApp: App {
    @State private var auth = AuthModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .task { auth.start() }
                .onChange(of: auth.state) { _, state in
                    // The pay-split phrases name accounts the signed-in household
                    // routes pay to, so they refresh once a session exists.
                    if state == .signedIn {
                        NestShortcuts.updateAppShortcutParameters()
                    }
                }
                .onOpenURL { url in
                    _ = GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}
