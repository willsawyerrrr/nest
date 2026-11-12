import SwiftUI

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

/// The native Household route: the household's name, the signed-in email with sign out, and
/// the single-use invite code.
struct HouseholdScreen: View {
    @State private var model: HouseholdViewModel

    init(model: HouseholdViewModel = HouseholdViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { rows in
            HouseholdContentView(
                name: rows.household?.name ?? "", email: model.email,
                household: rows.household,
                signOut: { await model.signOut() },
                create: { try await model.createInviteCode() },
                revoke: { try await model.revokeInviteCode() })
        }
        .task { await model.load() }
    }
}

struct HouseholdContentView: View {
    let name: String
    let email: String
    let household: Household?
    let signOut: () async -> Void
    let create: () async throws -> Void
    let revoke: () async throws -> Void

    @State private var failed = false
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text(HouseholdPresentation.title)
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-0.76)
                    .foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                accountCard
                inviteCard
            }
            .padding(NestSpacing.md)
        }
        .alert("Couldn't update the invite code", isPresented: $failed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(HouseholdPresentation.actionError)
        }
    }

    private var accountCard: some View {
        NestCard {
            VStack(spacing: NestSpacing.md) {
                Text(name)
                    .font(NestFont.display).tracking(-0.68)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(NestColor.text)
                Text(HouseholdPresentation.signedInAs(email))
                    .font(.system(size: 16)).foregroundStyle(NestColor.dimmedText)
                Button(HouseholdPresentation.signOutLabel) { Task { await signOut() } }
                    .buttonStyle(HouseholdButtonStyle(kind: .standard))
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var inviteCard: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text(HouseholdPresentation.inviteTitle)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                TimelineView(.everyMinute) { context in
                    if let household,
                        let invite = HouseholdPresentation.activeInvite(household, now: context.date)
                    {
                        activeInvite(invite, now: context.date)
                    } else {
                        noInvite
                    }
                }
            }
        }
    }

    private func activeInvite(_ invite: (code: String, expiresAt: Date), now: Date) -> some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            HStack(spacing: NestSpacing.xs) {
                Text(HouseholdPresentation.inviteCodeLabel)
                    .font(.system(size: 16)).foregroundStyle(NestColor.text)
                Text(invite.code)
                    .font(.system(size: 16, design: .monospaced)).foregroundStyle(NestColor.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(
                        NestColor.surfaceRaised,
                        in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
                Button(copied ? HouseholdPresentation.copiedLabel : HouseholdPresentation.copyLabel) {
                    copy(invite.code)
                }
                .buttonStyle(HouseholdButtonStyle(kind: .light, small: true))
            }
            Text(HouseholdPresentation.activeHint(expiresAt: invite.expiresAt, now: now))
                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            HStack(spacing: NestSpacing.xs) {
                Button(HouseholdPresentation.regenerateLabel) { run(create) }
                    .buttonStyle(HouseholdButtonStyle(kind: .light, small: true))
                Button(HouseholdPresentation.revokeLabel) { run(revoke) }
                    .buttonStyle(HouseholdButtonStyle(kind: .subtleRed, small: true))
            }
        }
    }

    private var noInvite: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(HouseholdPresentation.createHint)
                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            Button(HouseholdPresentation.createLabel) { run(create) }
                .buttonStyle(HouseholdButtonStyle(kind: .light))
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action() } catch { failed = true }
        }
    }

    private func copy(_ code: String) {
        #if os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(code, forType: .string)
        #else
            UIPasteboard.general.string = code
        #endif
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1))
            copied = false
        }
    }
}

/// Mantine's `default`, `light` and red `subtle` button variants.
private struct HouseholdButtonStyle: ButtonStyle {
    enum Kind { case standard, light, subtleRed }
    let kind: Kind
    var small = false

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous)
        configuration.label
            .font(.system(size: small ? 12 : 14, weight: .semibold))
            .foregroundStyle(foreground)
            .frame(maxWidth: small ? nil : .infinity)
            .padding(.horizontal, small ? 10 : 16)
            .frame(height: small ? 30 : 36)
            .background(background, in: shape)
            .overlay { if kind == .standard { shape.strokeBorder(NestColor.border, lineWidth: 1) } }
            .opacity(configuration.isPressed ? 0.8 : 1)
    }

    private var foreground: Color {
        switch kind {
        case .standard: NestColor.text
        case .light: NestColor.navActiveText
        case .subtleRed: NestColor.negative
        }
    }

    private var background: Color {
        switch kind {
        case .standard: NestColor.background
        case .light: NestColor.brand.opacity(0.18)
        case .subtleRed: .clear
        }
    }
}
