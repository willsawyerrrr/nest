import Foundation

/// Every row the Wishlist screen reads.
struct WishlistRows: Codable, Sendable, Equatable {
    var items: [WishlistItem] = []
    var members: [Member] = []

    /// The wishlist ordered by name and the members ordered by name, as the PWA reads them.
    static var sources: [TableSource<WishlistRows>] {
        [
            .table(WishlistItem.self, order: [Order(column: "name")]) { $0.items = $1 },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
        ]
    }

    /// The household new items belong to (every member row shares it).
    var householdID: String? { members.first?.householdId }
}

/// The fields a wishlist form supplies. `member_id` and `note` encode as `null`
/// when unset, so an edit clears them.
struct WishlistItemInput: Encodable, Equatable, Sendable {
    let name: String
    let amountCents: Int
    let memberID: String?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case name, note
        case amountCents = "amount_cents"
        case memberID = "member_id"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(amountCents, forKey: .amountCents)
        try container.encode(memberID, forKey: .memberID)
        try container.encode(note, forKey: .note)
    }
}

/// An insert body: the input plus the owning household.
struct WishlistInsert: Encodable, Sendable {
    let householdID: String
    let input: WishlistItemInput

    enum CodingKeys: String, CodingKey { case householdID = "household_id" }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(householdID, forKey: .householdID)
        try input.encode(to: encoder)
    }
}
