import Foundation
import Testing

@testable import Nest

private enum Members {
    static let memberJSON = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
        "date_of_birth":"1990-02-28","up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let profileJSON = """
        [{"id":"t1","household_id":"h","member_id":"m1","financial_year":2027,\
        "residency":"resident","has_private_hospital_cover":false,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
}

@MainActor
@Suite struct MembersViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "members": Members.memberJSON, "tax_profile": Members.profileJSON,
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(method: String, table: String, query: String, body: String)] = []
        var requests: [(method: String, table: String, query: String, body: String)] {
            lock.withLock { recorded }
        }
        func record(_ request: URLRequest) {
            lock.withLock {
                recorded.append(
                    (
                        request.httpMethod ?? "",
                        request.url!.path.split(separator: "/").last.map(String.init) ?? "",
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
                    server.record(request)
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    let failed = server.failing.contains(table)
                    return (
                        Data((failed ? "{}" : server.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("MembersViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private let now = ISO8601DateFormatter().date(from: "2026-11-11T00:00:00Z")!

    private func input(cover: Bool = true) -> TaxProfileInput {
        TaxProfileInput(memberID: "m1", residency: .foreignResident, hasPrivateHospitalCover: cover)
    }

    @Test func loadsMembersAndTheCurrentYearsProfiles() async {
        let server = Server()
        let model = MembersViewModel(data: makeData(server, directory: directory()), now: now)
        await model.load()
        #expect(model.financialYear == 2027)
        #expect(model.state.value?.members.map(\.name) == ["Alex"])
        #expect(model.state.value?.taxProfiles.map(\.id) == ["t1"])
        let profileGet = server.requests.first { $0.table == "tax_profile" }
        #expect(profileGet?.query.contains("financial_year=eq.2027") == true)
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["tax_profile"]
        let model = MembersViewModel(data: makeData(server, directory: directory()), now: now)
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
        await MembersViewModel(data: makeData(server, directory: dir), now: now).load()
        server.failing = ["members"]
        let again = MembersViewModel(data: makeData(server, directory: dir), now: now)
        await again.load()
        guard case .loaded(let rows, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(rows.members.map(\.name) == ["Alex"])
        #expect(error?.code == .server)
    }

    @Test func savingUpdatesTheExistingProfileThenSetsTheDateOfBirth() async throws {
        let server = Server()
        let model = MembersViewModel(data: makeData(server, directory: directory()), now: now)
        await model.load()
        try await model.save(TaxProfileSubmission(profile: input(), dateOfBirth: nil))
        let patch = try #require(server.requests.first { $0.method == "PATCH" })
        #expect(patch.table == "tax_profile")
        #expect(patch.query.contains("member_id=eq.m1") && patch.query.contains("financial_year=eq.2027"))
        #expect(patch.body.contains("\"residency\":\"foreign_resident\""))
        #expect(!server.requests.contains { $0.method == "POST" && $0.table == "tax_profile" })
        let rpc = try #require(server.requests.first { $0.table == "set_member_date_of_birth" })
        #expect(rpc.body.contains("\"p_member_id\":\"m1\"") && rpc.body.contains("\"p_date_of_birth\":null"))
        #expect(server.requests.last?.method == "GET")
    }

    @Test func savingInsertsAProfileWhenTheMemberHasNone() async throws {
        let server = Server()
        let model = MembersViewModel(data: makeData(server, directory: directory()), now: now)
        await model.load()
        server.bodies["tax_profile"] = "[]"
        try await model.save(TaxProfileSubmission(profile: input(), dateOfBirth: "1991-03-04"))
        let post = try #require(server.requests.first { $0.method == "POST" && $0.table == "tax_profile" })
        #expect(post.body.contains("\"household_id\":\"h\"") && post.body.contains("\"financial_year\":2027"))
        let rpc = try #require(server.requests.first { $0.table == "set_member_date_of_birth" })
        #expect(rpc.body.contains("\"p_date_of_birth\":\"1991-03-04\""))
    }

    @Test func aFailedSaveThrows() async {
        let server = Server()
        let model = MembersViewModel(data: makeData(server, directory: directory()), now: now)
        await model.load()
        server.failing = ["tax_profile"]
        await #expect(throws: NestError.self) {
            try await model.save(TaxProfileSubmission(profile: input(), dateOfBirth: nil))
        }
    }
}

@Suite struct MembersPresentationTests {
    @Test func theSectionTitleNamesTheFinancialYear() {
        #expect(MembersPresentation(rows: MembersRows(), financialYear: 2027).sectionTitle == "Tax profiles (FY2027)")
    }

    @Test func aDraftBuildsTheSubmission() {
        let row = MemberTaxRow(
            id: "m1", name: "Alex", residencyLabel: "Resident", hasHospitalCover: false,
            dateOfBirthLabel: "No date of birth", residency: .resident, dateOfBirth: nil)
        var draft = TaxProfileDraft(row: row)
        draft.residency = .foreignResident
        draft.hasCover = true
        draft.dateOfBirth = "1990-02-28"
        #expect(
            draft.submission
                == TaxProfileSubmission(
                    profile: TaxProfileInput(
                        memberID: "m1", residency: .foreignResident, hasPrivateHospitalCover: true),
                    dateOfBirth: "1990-02-28"))
    }
}
