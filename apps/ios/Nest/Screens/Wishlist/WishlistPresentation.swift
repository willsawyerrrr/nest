import Foundation

/// Which field the wishlist rows are ordered by.
enum WishlistSortKey: String, SortKey {
    case title, amount

    var label: String { self == .title ? "Title" : "Amount" }
    static let storageKey = "wishlist-sort"
    static let defaultKey = Self.title
}

typealias WishlistSort = SortPreference<WishlistSortKey>

/// One wishlist item as listed.
struct WishlistItemRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let amountCents: Int
    let memberID: String?
    /// The owner pill, or `nil` when the item belongs to no one in particular.
    let ownerName: String?
    let note: String?
}

/// A wishlist item promoted to a goal or a budget line: its name and amount seed
/// the target's add form.
struct PromoteDraft: Codable, Equatable, Hashable, Sendable {
    var name: String
    var amountCents: Int
}

/// What a promote action opens: the Goals or Budget add form, prefilled.
struct WishlistPromotion: Hashable, Identifiable, Sendable {
    enum Target: Hashable, Sendable { case goal, budget }

    let target: Target
    let draft: PromoteDraft

    init(_ target: Target, row: WishlistItemRow) {
        self.target = target
        draft = PromoteDraft(name: row.name, amountCents: row.amountCents)
    }

    var id: Self { self }
}

/// Pure presentation of the wishlist, mirroring `WishlistScreen`.
struct WishlistPresentation: Equatable, Sendable {
    static let title = "Wishlist"
    static let intro =
        "Things you’re saving up to buy one day — kept apart from the budget. Promote one to a savings goal or a Discretionary budget line when you’re ready; the wishlist item stays until you delete it."
    static let emptyMessage = "Nothing on your wishlist yet."
    static let addLabel = "Add wishlist item"
    static let deleteTitle = "Delete wishlist item?"
    static let saveError = "Could not save this wishlist item. Please try again."

    let rows: [WishlistItemRow]
    let members: [Member]

    init(rows source: WishlistRows, sort: WishlistSort) {
        members = source.members
        let owned = source.items.map { item in
            WishlistItemRow(
                id: item.id, name: item.name, amountCents: item.amountCents,
                memberID: item.memberId,
                ownerName: item.memberId.map { Self.memberName(source.members, id: $0) },
                note: item.note)
        }
        rows = Self.sorted(owned, by: sort)
    }

    /// The member's name, or `Unknown` when none matches, as the PWA's `memberName`.
    static func memberName(_ members: [Member], id: String) -> String {
        members.first { $0.id == id }?.name ?? "Unknown"
    }

    /// Ascending order by the key (title ignoring case, ties in stored order), reversed for descending.
    static func sorted(_ rows: [WishlistItemRow], by sort: WishlistSort) -> [WishlistItemRow] {
        sort.sorted(rows) { a, b in
            switch sort.key {
            case .title: a.name.localizedCompare(b.name)
            case .amount: a.amountCents.compared(to: b.amountCents)
            }
        }
    }
}

/// The add/edit form's fields as typed, and the input they build.
struct WishlistDraft: Equatable, Sendable {
    var name = ""
    var amount = ""
    var memberID: String?
    var note = ""

    init() {}

    init(row: WishlistItemRow) {
        name = row.name
        amount = String(format: "%.2f", Double(row.amountCents) / 100)
        memberID = row.memberID
        note = row.note ?? ""
    }

    /// The typed amount as dollars, or `nil` when blank or not a number.
    private var dollars: Double? {
        let cleaned = amount.replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "$", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value.isFinite else { return nil }
        return value
    }

    /// A name and a positive amount, as the PWA's form requires.
    var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && (dollars ?? 0) > 0
    }

    var input: WishlistItemInput {
        let trimmedNote = note.trimmingCharacters(in: .whitespaces)
        return WishlistItemInput(
            name: name.trimmingCharacters(in: .whitespaces),
            amountCents: Int(((dollars ?? 0) * 100).rounded()), memberID: memberID,
            note: trimmedNote.isEmpty ? nil : trimmedNote)
    }
}
