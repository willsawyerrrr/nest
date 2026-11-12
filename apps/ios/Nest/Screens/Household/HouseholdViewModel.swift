import Foundation
import Observation

/// Loads the household and the signed-in email, and creates, regenerates and revokes its invite code.
@MainActor @Observable
final class HouseholdViewModel {
    private(set) var state: ScreenState<HouseholdRows> = .loading
    private(set) var email = ""

    private let data: NestData
    private let currentEmail: @Sendable () async -> String?
    private let signOutAction: @Sendable () async -> Void

    init(
        data: NestData = .live,
        currentEmail: @escaping @Sendable () async -> String? = {
            try? await supabaseAuth.session.user.email
        },
        signOut: @escaping @Sendable () async -> Void = {
            await PushRegistrar.shared.unregister()
            try? await supabaseAuth.signOut()
        }
    ) {
        self.data = data
        self.currentEmail = currentEmail
        signOutAction = signOut
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        email = await currentEmail() ?? ""
        let stream = RowsCombiner.stream(
            initial: HouseholdRows(), sources: HouseholdRows.sources, data: data)
        do {
            for try await snapshot in stream {
                state = .loaded(snapshot.rows, isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let rows = state.value {
                state = .loaded(rows, isRefreshing: false, refreshError: failure)
            } else {
                state = .failed(failure)
            }
        }
    }

    /// Discards the shown state and loads again.
    func retry() async {
        if state.value == nil { state = .loading }
        await load()
    }

    /// Creates an invite code, replacing any active one, then reloads.
    func createInviteCode() async throws {
        try await data.call("create_invite_code", invalidating: [Household.table])
        await load()
    }

    /// Revokes the active invite code, then reloads.
    func revokeInviteCode() async throws {
        try await data.call("revoke_invite_code", invalidating: [Household.table])
        await load()
    }

    func signOut() async { await signOutAction() }
}
