import Foundation
import Testing

@testable import Nest

private enum Fixture {
    static let members = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"},\
        {"id":"m2","household_id":"h","user_id":"v","name":"Sam","email":null,\
        "date_of_birth":null,"up_connected_at":"2026-01-01T00:00:00Z","up_sync_failed_at":"2026-02-01T00:00:00Z",\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let connections = """
        [{"id":"c1","household_id":"h","member_id":"m1","institution_name":"ANZ","status":"active",\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let feed = #"[{"household_id":"h","created_at":"2026-01-01T00:00:00Z"}]"#
}

@MainActor
@Suite struct ConnectionsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "members": Fixture.members, "redbark_connection": Fixture.connections,
            "calendar_feed": Fixture.feed,
            "redbark-connect": #"{"linkSessionId":"ls1","url":"https://consent.example/x"}"#,
            "redbark-connect-complete": #"{"connected":true}"#,
            "create_calendar_feed_token": "\"tok en/1\"",
        ]
        var failing: [String: String] = [:]
        private let lock = NSLock()
        private var recorded: [(method: String, name: String, query: String, body: String)] = []
        var requests: [(method: String, name: String, query: String, body: String)] {
            lock.withLock { recorded }
        }
        func record(_ request: URLRequest) {
            lock.withLock {
                recorded.append(
                    (
                        request.httpMethod ?? "", request.url!.lastPathComponent,
                        request.url!.query ?? "",
                        request.httpBody.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                    ))
            }
        }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let name = request.url!.lastPathComponent
                    server.record(request)
                    let failure = server.failing[name]
                    let status = failure == nil ? 200 : 500
                    return (
                        Data((failure ?? server.bodies[name] ?? "{}").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: status, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("ConnectionsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData, defaults: UserDefaults? = nil) -> ConnectionsViewModel {
        ConnectionsViewModel(
            data: data, defaults: defaults ?? UserDefaults(suiteName: "Connections-\(UUID())")!,
            feedBase: URL(string: "https://example.supabase.co")!,
            returnURL: URL(string: "https://nest.example/settings/connections")!)
    }

    @Test func loadsMembersConnectionsAndFeed() async {
        let model = model(makeData(Server(), directory: directory()))
        await model.load()
        let rows = model.state.value
        #expect(rows?.members.map(\.name) == ["Alex", "Sam"])
        #expect(rows?.redbarkConnections.map(\.institutionName) == ["ANZ"])
        #expect(rows?.calendarFeed?.householdId == "h")
        #expect(rows?.member(userID: model.userID)?.name == "Alex")
    }

    @Test func readsOnlyTheCalendarFeedColumnsAndOrdersConnectionsNewestFirst() async {
        let server = Server()
        await model(makeData(server, directory: directory())).load()
        let feed = server.requests.first { $0.name == "calendar_feed" }
        #expect(feed?.query.contains("select=household_id,created_at") == true)
        let connections = server.requests.first { $0.name == "redbark_connection" }
        #expect(connections?.query.contains("order=created_at.desc") == true)
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["members": "{}"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedRows() async {
        let server = Server()
        let dir = directory()
        await model(makeData(server, directory: dir)).load()
        server.failing = ["redbark_connection": "{}"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let rows, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(rows.members.count == 2)
        #expect(error?.code == .server)
    }

    @Test func connectingUpSendsTheTokenThenReloadsMembers() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.connectUp(token: "up:yeah:abc")
        let post = try #require(server.requests.first { $0.name == "up-connect" })
        #expect(post.body == #"{"token":"up:yeah:abc"}"#)
        #expect(server.requests.last?.method == "GET")
        #expect(model.upError == nil && !model.upBusy)
    }

    @Test func aFailedUpConnectReportsFixedCopy() async {
        let server = Server()
        server.failing = ["up-connect": #"{"error":"bad token up:yeah:abc"}"#]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.connectUp(token: "up:yeah:abc")
        #expect(model.upError?.code == .server)
        #expect(!(model.upError?.userMessage.contains("abc") ?? true))
    }

    @Test func disconnectingUpCallsTheFunctionThenReloads() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.disconnectUp()
        #expect(server.requests.contains { $0.name == "up-disconnect" })
        #expect(server.requests.last?.method == "GET")
    }

    @Test func startingABankConnectionKeepsTheSessionAndReturnsTheConsentURL() async throws {
        let server = Server()
        let defaults = UserDefaults(suiteName: "Connections-\(UUID())")!
        let model = model(makeData(server, directory: directory()), defaults: defaults)
        let url = await model.startBankConnection()
        #expect(url == URL(string: "https://consent.example/x"))
        #expect(defaults.string(forKey: ConnectionsViewModel.linkSessionKey) == "ls1")
        let post = try #require(server.requests.first { $0.name == "redbark-connect" })
        #expect(post.body == #"{"returnUrl":"https:\/\/nest.example\/settings\/connections"}"#)
    }

    @Test func aFailedBankConnectCarriesTheFunctionsCode() async {
        let server = Server()
        server.failing = ["redbark-connect": #"{"code":"plan_upgrade_required"}"#]
        let model = model(makeData(server, directory: directory()))
        #expect(await model.startBankConnection() == nil)
        #expect(model.bankFailure == .init(code: "plan_upgrade_required"))
        model.dismissBankFailure()
        #expect(model.bankFailure == nil)
    }

    @Test func completingAConnectedLinkSyncsReloadsAndClearsTheSession() async {
        let server = Server()
        let defaults = UserDefaults(suiteName: "Connections-\(UUID())")!
        defaults.set("ls1", forKey: ConnectionsViewModel.linkSessionKey)
        let model = model(makeData(server, directory: directory()), defaults: defaults)
        await model.completePendingConnection()
        #expect(model.completeResult == .connected)
        #expect(defaults.string(forKey: ConnectionsViewModel.linkSessionKey) == nil)
        let names = server.requests.map(\.name)
        let complete = names.firstIndex(of: "redbark-connect-complete")
        let sync = names.firstIndex(of: "redbark-sync")
        #expect(complete != nil && sync != nil && complete! < sync!)
        #expect(server.requests.last?.method == "GET")
    }

    @Test func completingResolvesPendingFailedAndErroredLinks() async {
        for (body, failing, expected): (String, Bool, RedbarkCompleteResult) in [
            (#"{"connected":false,"status":"pending"}"#, false, .pending),
            (#"{"connected":false,"status":"failed"}"#, false, .failed(code: nil)),
            (#"{"code":"redbark_auth_failed"}"#, true, .failed(code: "redbark_auth_failed")),
        ] {
            let server = Server()
            if failing {
                server.failing = ["redbark-connect-complete": body]
            } else {
                server.bodies["redbark-connect-complete"] = body
            }
            let defaults = UserDefaults(suiteName: "Connections-\(UUID())")!
            defaults.set("ls1", forKey: ConnectionsViewModel.linkSessionKey)
            let model = model(makeData(server, directory: directory()), defaults: defaults)
            await model.completePendingConnection()
            #expect(model.completeResult == expected)
            #expect(defaults.string(forKey: ConnectionsViewModel.linkSessionKey) == nil)
        }
    }

    @Test func withoutAPendingLinkNothingIsCalled() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.completePendingConnection()
        #expect(server.requests.isEmpty && model.completeResult == nil)
    }

    @Test func disconnectingABankSendsTheConnectionIdThenReloads() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.disconnectBank(id: "c1")
        let post = try #require(server.requests.first { $0.name == "redbark-disconnect" })
        #expect(post.body == #"{"connectionId":"c1"}"#)
        #expect(server.requests.last?.method == "GET")
    }

    @Test func aFailedBankDisconnectReportsAFailure() async {
        let server = Server()
        server.failing = ["redbark-disconnect": "{}"]
        let model = model(makeData(server, directory: directory()))
        await model.disconnectBank(id: "c1")
        #expect(model.bankFailure != nil && !model.bankBusy)
    }

    @Test func creatingTheFeedKeepsItsURLsOnceAndRevokingClearsThem() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.createFeed()
        #expect(
            model.feedLinks
                == .init(
                    https: "https://example.supabase.co/functions/v1/calendar-ics?token=tok%20en%2F1",
                    webcal: "webcal://example.supabase.co/functions/v1/calendar-ics?token=tok%20en%2F1"))
        await model.revokeFeed()
        #expect(model.feedLinks == nil)
        #expect(server.requests.contains { $0.name == "revoke_calendar_feed_token" })
    }

    @Test func aFailedFeedCallReportsAnError() async {
        let server = Server()
        server.failing = ["create_calendar_feed_token": "{}"]
        let model = model(makeData(server, directory: directory()))
        await model.createFeed()
        #expect(model.feedError?.code == .server && model.feedLinks == nil)
    }
}

@Suite struct ConnectionsPresentationTests {
    private func member(up: String?, failed: String?) throws -> Member {
        let json = """
            {"id":"m","household_id":"h","user_id":"u","name":"A","email":null,"date_of_birth":null,\
            "up_connected_at":\(up.map { "\"\($0)\"" } ?? "null"),\
            "up_sync_failed_at":\(failed.map { "\"\($0)\"" } ?? "null"),\
            "created_at":"2026","updated_at":"2026"}
            """
        return try JSONDecoder().decode(Member.self, from: Data(json.utf8))
    }

    @Test func upStatusPrefersAFailureOverConnected() throws {
        #expect(try ConnectionsPresentation.upStatus(member(up: "t", failed: "t")).label == "Needs reconnecting")
        #expect(try ConnectionsPresentation.upStatus(member(up: "t", failed: nil)).label == "Connected")
        #expect(try ConnectionsPresentation.upStatus(member(up: nil, failed: nil)).label == "Not connected")
        #expect(try ConnectionsPresentation.upStatus(member(up: "t", failed: nil)).tone == .positive)
    }

    @Test func failureCopyIsKeyedOnTheCode() {
        let upgrade = ConnectionsPresentation.failureMessage(code: "plan_upgrade_required")
        #expect(String(upgrade.characters).hasSuffix("Upgrade your plan."))
        #expect(upgrade.runs.contains { $0.link == ConnectionsPresentation.redbarkBillingURL })
        #expect(
            String(ConnectionsPresentation.failureMessage(code: "redbark_auth_failed").characters)
                == "Bank connections are misconfigured. Try again later.")
        #expect(
            String(ConnectionsPresentation.failureMessage(code: nil).characters)
                == "Redbark is unavailable right now. Try again shortly.")
    }

    @Test func bannersTitleEachOutcome() {
        #expect(ConnectionsPresentation.banner(for: .connected).title == "Bank connected")
        #expect(ConnectionsPresentation.banner(for: .pending).title == "Still connecting")
        #expect(ConnectionsPresentation.banner(for: .failed(code: nil)).title == "Connection failed")
    }

    @Test func unknownNamesFallBack() throws {
        #expect(ConnectionsPresentation.memberName([], id: "x") == "Unknown")
        let connection = try JSONDecoder().decode(
            RedbarkConnection.self,
            from: Data(
                #"{"id":"c","household_id":"h","member_id":"m","institution_name":null,"status":"expired","created_at":"t","updated_at":"t"}"#
                    .utf8))
        #expect(ConnectionsPresentation.institution(connection) == "Unknown institution")
        #expect(ConnectionsPresentation.bankStatus(connection).tone == .neutral)
    }

    @Test func submitLabelFollowsTheReconnectState() {
        #expect(ConnectionsPresentation.upSubmitLabel(needsReconnecting: true) == "Reconnect")
        #expect(ConnectionsPresentation.upSubmitLabel(needsReconnecting: false) == "Connect")
    }
}
