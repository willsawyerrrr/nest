import Foundation
import Testing

@testable import Nest

private enum Rollups {
    static let value = BreakdownRollups(
        totals: [.init(breakdownId: "b1", annualCents: 5_200_00, fortnightlyCents: 200_00)],
        items: [.init(itemId: "i1", fortnightlyCents: 150_00)])

    static let breakdownJSON = """
        [{"id":"b1","household_id":"h","name":"Utilities","line_group":"needs","kind":"generic",\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let itemJSON = """
        [{"id":"i1","household_id":"h","breakdown_id":"b1","name":"Power","amount_cents":30000,\
        "frequency":"monthly","interval_count":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
}

@MainActor
@Suite struct BreakdownsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "breakdown": Rollups.breakdownJSON, "breakdown_item": Rollups.itemJSON,
        ]
        var failing: Set<String> = []
        var paths: [String] = []
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.paths.append(table)
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
            .appendingPathComponent("BreakdownsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> BreakdownsViewModel {
        BreakdownsViewModel(data: data, rollUp: { _ in Rollups.value })
    }

    @Test func loadsBothTablesThenShowsTheRollup() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.rollups == Rollups.value)
        #expect(model.state.value?.rows.breakdowns.map(\.name) == ["Utilities"])
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(Set(server.paths) == ["breakdown", "breakdown_item"])
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["breakdown_item"]
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
        server.failing = ["breakdown"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.rollups == Rollups.value)
        #expect(error?.code == .server)
    }
}

@Suite struct BreakdownsPresentationTests {
    private func content() throws -> BreakdownsContent {
        let rows = BreakdownsRows(
            breakdowns: try JSONDecoder().decode(
                [Breakdown].self, from: Data(Rollups.breakdownJSON.utf8)),
            items: try JSONDecoder().decode([BreakdownItem].self, from: Data(Rollups.itemJSON.utf8)))
        return BreakdownsContent(rows: rows, rollups: Rollups.value)
    }

    @Test func labelsTheGroupAndTotals() throws {
        let row = try #require(BreakdownsPresentation(content: content()).rows.first)
        #expect(row.groupLabel == "Needs")
        #expect(row.annualCents == 5_200_00 && row.fortnightlyCents == 200_00)
    }

    @Test func detailListsTheBreakdownsItemsWithTheirFortnightlyFigure() throws {
        let detail = try #require(BreakdownsPresentation(content: content()).detail(id: "b1"))
        #expect(detail.items.map(\.name) == ["Power"])
        #expect(detail.items.first?.frequencyLabel == "Monthly")
        #expect(detail.items.first?.fortnightlyCents == 150_00)
    }

    @Test func aMissingBreakdownHasNoDetail() throws {
        #expect(try BreakdownsPresentation(content: content()).detail(id: "gone") == nil)
    }

    @Test func labelsFrequenciesLikeThePWA() {
        func label(_ frequency: Frequency, _ interval: Int? = nil) -> String {
            BreakdownsPresentation.frequencyLabel(frequency, interval: interval)
        }
        #expect(label(.weekly) == "Weekly")
        #expect(label(.biannual) == "Biannually")
        #expect(label(.annual) == "Annually")
        #expect(label(.everyNWeeks, 4) == "Every 4 weeks")
        #expect(label(.everyNWeeks, 1) == "Every week")
        #expect(label(.everyNMonths, 1) == "Every month")
        #expect(label(.everyNMonths) == "Every N months")
    }
}
