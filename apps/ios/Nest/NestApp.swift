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
                .onOpenURL { url in
                    _ = GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}
