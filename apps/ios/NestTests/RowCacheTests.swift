import Foundation
import Testing

@testable import Nest

@Suite struct RowCacheTests {
    private func makeCache() -> RowCache {
        RowCache(
            directory: FileManager.default.temporaryDirectory
                .appendingPathComponent("RowCacheTests-\(UUID().uuidString)", isDirectory: true)
        )
    }

    private struct Item: Codable, Equatable { let id: Int }

    @Test func missIsNil() async {
        let cache = makeCache()
        #expect(await cache.read(Item.self, key: QueryKey(table: "t"), user: "u") == nil)
    }

    @Test func roundTripsRows() async {
        let cache = makeCache()
        let key = QueryKey(table: "t", filters: [.eq("a", "1")])
        await cache.write([Item(id: 1), Item(id: 2)], key: key, user: "u")
        #expect(await cache.read(Item.self, key: key, user: "u") == [Item(id: 1), Item(id: 2)])
    }

    @Test func keysDifferByQueryButNotFilterOrder() {
        let a = QueryKey(table: "t", filters: [.eq("a", "1"), .eq("b", "2")])
        let b = QueryKey(table: "t", filters: [.eq("b", "2"), .eq("a", "1")])
        let c = QueryKey(table: "t", filters: [.eq("a", "1")])
        #expect(a.fileName == b.fileName)
        #expect(a.fileName != c.fileName)
        #expect(
            a.fileName
                != QueryKey(table: "t", filters: [.eq("a", "1"), .eq("b", "2")], limit: 1).fileName)
    }

    @Test func entriesAreScopedPerUser() async {
        let cache = makeCache()
        let key = QueryKey(table: "t")
        await cache.write([Item(id: 1)], key: key, user: "u1")
        #expect(await cache.read(Item.self, key: key, user: "u2") == nil)
    }

    @Test func invalidateDropsOnlyTheNamedTablesForThatUser() async {
        let cache = makeCache()
        let other = QueryKey(table: "other")
        await cache.write([Item(id: 1)], key: QueryKey(table: "t"), user: "u")
        await cache.write([Item(id: 2)], key: QueryKey(table: "t", limit: 3), user: "u")
        await cache.write([Item(id: 3)], key: other, user: "u")
        await cache.write([Item(id: 4)], key: QueryKey(table: "t"), user: "v")

        await cache.invalidate(tables: ["t"], user: "u")

        #expect(await cache.read(Item.self, key: QueryKey(table: "t"), user: "u") == nil)
        #expect(await cache.read(Item.self, key: QueryKey(table: "t", limit: 3), user: "u") == nil)
        #expect(await cache.read(Item.self, key: other, user: "u") == [Item(id: 3)])
        #expect(await cache.read(Item.self, key: QueryKey(table: "t"), user: "v") == [Item(id: 4)])
    }

    @Test func invalidateDoesNotMatchATablePrefix() async {
        let cache = makeCache()
        await cache.write([Item(id: 1)], key: QueryKey(table: "pay_split"), user: "u")
        await cache.invalidate(tables: ["pay"], user: "u")
        #expect(
            await cache.read(Item.self, key: QueryKey(table: "pay_split"), user: "u") == [
                Item(id: 1)
            ])
    }

    @Test func clearDropsEveryUser() async {
        let cache = makeCache()
        let key = QueryKey(table: "t")
        await cache.write([Item(id: 1)], key: key, user: "u1")
        await cache.write([Item(id: 1)], key: key, user: "u2")
        await cache.clear()
        #expect(await cache.read(Item.self, key: key, user: "u1") == nil)
        #expect(await cache.read(Item.self, key: key, user: "u2") == nil)
    }

    @Test func anUnreadableEntryIsAMiss() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("RowCacheTests-\(UUID().uuidString)", isDirectory: true)
        let cache = RowCache(directory: directory)
        let key = QueryKey(table: "t")
        await cache.write([Item(id: 1)], key: key, user: "u")
        let file = directory.appendingPathComponent("u").appendingPathComponent(key.fileName)
        try Data("not json".utf8).write(to: file)
        #expect(await cache.read(Item.self, key: key, user: "u") == nil)
    }
}
