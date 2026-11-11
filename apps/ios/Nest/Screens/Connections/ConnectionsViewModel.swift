import Foundation
import Observation

/// Loads the household's members, Redbark connections and calendar feed through the
/// cache, and drives connecting and disconnecting Up and Redbark and minting the feed.
/// Secrets (the Up token, the feed token) are held only for the call that uses them
/// and are never logged or cached.
@MainActor @Observable
final class ConnectionsViewModel {
    /// A failed Redbark connect, carrying the edge function's stable error code.
    struct BankFailure: Equatable {
        let code: String?
    }

    /// The subscription URLs of a feed minted this session, shown once.
    struct FeedLinks: Equatable {
        let https: String
        let webcal: String
    }

    /// The `UserDefaults` key a pending Link Session id is kept under across the
    /// trip to Redbark's hosted consent flow, so the result is resolved on return.
    static let linkSessionKey = "redbark-link-session-id"

    private(set) var state: ScreenState<ConnectionsRows> = .loading
    private(set) var upBusy = false
    private(set) var upError: NestError?
    private(set) var bankBusy = false
    private(set) var bankFailure: BankFailure?
    private(set) var completeResult: RedbarkCompleteResult?
    private(set) var feedBusy = false
    private(set) var feedError: NestError?
    private(set) var feedLinks: FeedLinks?
    /// The signed-in user's id, resolved on `load()`.
    private(set) var userID: String?

    private let data: NestData
    private let defaults: UserDefaults
    private let feedBase: URL
    private let returnURL: URL

    init(
        data: NestData = .live, defaults: UserDefaults = .standard,
        feedBase: URL = SupabaseConfig.url, returnURL: URL = Route.connections.url
    ) {
        self.data = data
        self.defaults = defaults
        self.feedBase = feedBase
        self.returnURL = returnURL
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        userID = try? await data.userID()
        let stream = RowsCombiner.stream(
            initial: ConnectionsRows(), sources: ConnectionsRows.sources, data: data)
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

    // MARK: Up

    /// Sends the token to `up-connect`, then reloads the members.
    func connectUp(token: String) async {
        upBusy = true
        upError = nil
        defer { upBusy = false }
        do {
            let _: IgnoredResponse = try await data.api.invoke(
                "up-connect", body: UpConnectBody(token: token))
            await refresh([Member.table])
        } catch {
            upError = Self.failure(error)
        }
    }

    /// Calls `up-disconnect`, then reloads the members.
    func disconnectUp() async {
        upBusy = true
        upError = nil
        defer { upBusy = false }
        do {
            let _: IgnoredResponse = try await data.api.invoke("up-disconnect")
            await refresh([Member.table])
        } catch {
            upError = Self.failure(error)
        }
    }

    // MARK: Redbark

    /// Calls `redbark-connect`, keeps the returned link session id for the return
    /// trip, and returns Redbark's hosted consent URL to open. `nil` on failure,
    /// which sets `bankFailure`.
    func startBankConnection() async -> URL? {
        bankBusy = true
        bankFailure = nil
        defer { bankBusy = false }
        do {
            let link: RedbarkLink = try await data.api.invoke(
                "redbark-connect", body: RedbarkConnectBody(returnUrl: returnURL.absoluteString))
            defaults.set(link.linkSessionId, forKey: Self.linkSessionKey)
            return link.url
        } catch {
            bankFailure = BankFailure(code: (Self.failure(error)).upstreamCode)
            return nil
        }
    }

    /// Resolves a link session left behind by a trip to Redbark's consent flow via
    /// `redbark-connect-complete`, clearing it whatever the outcome. A connected
    /// result also runs `redbark-sync` so the new accounts appear at once.
    func completePendingConnection() async {
        guard let linkSessionId = defaults.string(forKey: Self.linkSessionKey) else { return }
        defaults.removeObject(forKey: Self.linkSessionKey)
        bankBusy = true
        defer { bankBusy = false }
        do {
            let completion: RedbarkCompletion = try await data.api.invoke(
                "redbark-connect-complete",
                body: RedbarkCompleteBody(linkSessionId: linkSessionId))
            if completion.connected {
                completeResult = .connected
                _ = try? await data.api.invoke("redbark-sync") as IgnoredResponse
                await refresh([
                    RedbarkConnection.table, AccountWithBalance.table, Account.table,
                ])
            } else {
                completeResult = completion.status == "failed" ? .failed(code: nil) : .pending
            }
        } catch {
            completeResult = .failed(code: Self.failure(error).upstreamCode)
        }
    }

    /// Calls `redbark-disconnect` for `connectionId`, then reloads.
    func disconnectBank(id connectionId: String) async {
        bankBusy = true
        bankFailure = nil
        defer { bankBusy = false }
        do {
            let _: IgnoredResponse = try await data.api.invoke(
                "redbark-disconnect", body: RedbarkDisconnectBody(connectionId: connectionId))
            await refresh([
                RedbarkConnection.table, AccountWithBalance.table, Account.table,
            ])
        } catch {
            bankFailure = BankFailure(code: Self.failure(error).upstreamCode)
        }
    }

    func dismissCompleteResult() { completeResult = nil }
    func dismissBankFailure() { bankFailure = nil }

    // MARK: Calendar feed

    /// Mints (or replaces) the household's feed token, keeping its URLs to show once.
    func createFeed() async {
        feedBusy = true
        feedError = nil
        defer { feedBusy = false }
        do {
            let token: String = try await data.api.rpc("create_calendar_feed_token")
            let urls = ConnectionsPresentation.feedURLs(token: token, base: feedBase)
            feedLinks = FeedLinks(https: urls.https, webcal: urls.webcal)
            await refresh([CalendarFeed.table])
        } catch {
            feedError = Self.failure(error)
        }
    }

    /// Revokes the household's feed token.
    func revokeFeed() async {
        feedBusy = true
        feedError = nil
        defer { feedBusy = false }
        do {
            try await data.api.call("revoke_calendar_feed_token")
            feedLinks = nil
            await refresh([CalendarFeed.table])
        } catch {
            feedError = Self.failure(error)
        }
    }

    // MARK: Plumbing

    /// Drops the cached rows of `tables` and reloads.
    private func refresh(_ tables: Set<String>) async {
        if let user = try? await data.userID() {
            await data.cache.invalidate(tables: tables, user: user)
        }
        await load()
    }

    private static func failure(_ error: Error) -> NestError {
        (NestError.from(error) as? NestError) ?? NestError(.unknown)
    }
}
