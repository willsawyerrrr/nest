import SwiftUI

/// Where the embedded web app is served.
enum WebApp {
    static let url = URL(string: "https://nest.willsawyerrrr.dev")!
}

/// The app shell. The native app owns the one Supabase session, so this is a
/// blocking sign-in gate: `SignInView` when signed out, the `NavigationShell` once
/// signed in. The web view is handed the same session (see `WebView.swift`), so
/// the member signs in exactly once.
struct ContentView: View {
    @Environment(AuthModel.self) private var auth

    var body: some View {
        ZStack {
            switch auth.state {
            case .unknown:
                ProgressView()
                    .progressViewStyle(.circular)
                    .scaleEffect(1.5)
            case .signedOut:
                SignInView()
            case .signedIn:
                NavigationShell()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NestColor.background)
        .animation(.default, value: auth.state)
    }
}

/// Full-screen Google sign-in, styled to match the PWA's `SignInScreen` — the
/// goose-in-nest mark, dark-first palette, and brand-lime button from
/// `theme.ts` — so the native gate doesn't read as a different, unstyled app.
/// This is the app's only login: the native session it establishes is
/// mirrored into the embedded web app, so there is no second sign-in inside
/// the web view.
private struct SignInView: View {
    @Environment(AuthModel.self) private var auth

    var body: some View {
        VStack(spacing: 24) {
            logo
            Text("Track income, tax, spending, and savings for your household.")
                .font(.subheadline)
                .foregroundStyle(NestColor.dimmedText)
                .multilineTextAlignment(.center)

            if let error = auth.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await auth.signIn() }
            } label: {
                Group {
                    if auth.isSigningIn {
                        ProgressView()
                            .tint(.black)
                    } else {
                        Text("Continue with Google")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(NestColor.brand)
            .foregroundStyle(.black)
            .controlSize(.large)
            .disabled(auth.isSigningIn)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NestColor.background)
    }

    /// The goose mark beside the "nest" wordmark, mirroring `Logo.tsx`'s
    /// `lockup` variant: the mark restores a dark tile behind it in light mode
    /// only, since it was drawn for a near-black canvas.
    private var logo: some View {
        HStack(spacing: 18) {
            Image("NestMark")
                .resizable()
                .scaledToFit()
                .frame(width: 56, height: 56)
                .background(
                    NestColor.markTile, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text("nest")
                .font(.system(size: 50, weight: .semibold, design: .rounded))
                .foregroundStyle(NestColor.text)
        }
    }
}

#Preview {
    ContentView()
        .environment(AuthModel())
}
