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
                    Task { _ = try? await supabaseAuth.session(from: url) }
                }
        }
    }
}
