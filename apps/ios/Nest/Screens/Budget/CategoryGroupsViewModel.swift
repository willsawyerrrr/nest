import Foundation
import Observation

/// Every row the category groups editor reads.
struct CategoryGroupsRows: Sendable, Equatable {
    var categories: [UpCategory] = []
    var defaults: [CategoryGroupDefault] = []
    var overrides: [CategoryGroupOverride] = []
    /// The household's members, whose household an override is written to.
    var members: [Member] = []

    static let sources: [TableSource<CategoryGroupsRows>] = [
        .table(UpCategory.self) { $0.categories = $1 },
        .table(CategoryGroupDefault.self) { $0.defaults = $1 },
        .table(CategoryGroupOverride.self) { $0.overrides = $1 },
        .table(Member.self) { $0.members = $1 },
    ]
}

/// What a category's spend counts toward, as picked in the editor.
enum CategoryGroupChoice: Hashable, Sendable {
    /// The shared default (`up_category_default_group`); no household override.
    case shared
    /// An override to `group`, or to no group when nil.
    case override(BudgetGroup?)
}

/// One Up child category in the editor.
struct CategoryGroupRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    /// The shared default's group; nil counts it toward no group.
    let defaultGroup: BudgetGroup?
    let choice: CategoryGroupChoice
}

/// One Up parent category and its children, both alphabetical.
struct CategoryGroupSection: Equatable, Identifiable, Sendable {
    let name: String
    let rows: [CategoryGroupRow]

    var id: String { name }
}

/// The Up category → budget group map: loads each child category with its
/// shared default and the household's override, and writes `up_category_group`.
/// A write drops the cached `budget_actual_spend` results, so the Budget
/// screen's actuals regroup.
@MainActor @Observable
final class CategoryGroupsViewModel {
    private(set) var state: ScreenState<[CategoryGroupSection]> = .loading
    /// Fixed copy for the last failed change, cleared by the next.
    private(set) var failure: String?

    private let data: NestData
    private var householdID: String?

    init(data: NestData = .live) {
        self.data = data
    }

    /// Streams the rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: CategoryGroupsRows(), sources: CategoryGroupsRows.sources, data: data)
        do {
            for try await snapshot in stream {
                householdID = snapshot.rows.members.first?.householdId
                state = .loaded(
                    Self.sections(snapshot.rows), isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let sections = state.value {
                state = .loaded(sections, isRefreshing: false, refreshError: failure)
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

    /// Counts `row`'s spend toward `choice`, then reloads: the shared default
    /// deletes the household's override, any other choice upserts one.
    func set(_ row: CategoryGroupRow, to choice: CategoryGroupChoice) async {
        failure = nil
        do {
            guard let householdID else { throw NestError(.invalidRequest) }
            switch choice {
            case .shared:
                try await data.delete(
                    CategoryGroupOverride.self,
                    filters: [.eq("household_id", householdID), .eq("category_id", row.id)],
                    also: [ActualSpendParams.function])
            case .override(let group):
                try await data.upsert(
                    CategoryGroupOverride.self,
                    values: OverrideUpsert(householdID: householdID, categoryID: row.id, lineGroup: group),
                    onConflict: "household_id,category_id", also: [ActualSpendParams.function])
            }
        } catch {
            failure = "Couldn’t change \(row.name)’s group. Try again."
        }
        await load()
    }

    /// Each parent with its child categories, both alphabetical, as the picker groups them.
    static func sections(_ rows: CategoryGroupsRows) -> [CategoryGroupSection] {
        let defaults = Dictionary(
            rows.defaults.map { ($0.categoryId, $0.lineGroup) }, uniquingKeysWith: { first, _ in first })
        let overrides = Dictionary(
            rows.overrides.map { ($0.categoryId, $0.lineGroup) }, uniquingKeysWith: { first, _ in first })
        return UpCategories.groups(rows.categories).map { parent in
            CategoryGroupSection(
                name: parent.name,
                rows: parent.items.map { category in
                    CategoryGroupRow(
                        id: category.id, name: category.name, defaultGroup: defaults[category.id],
                        choice: overrides[category.id].map { .override($0) } ?? .shared)
                })
        }
    }
}

/// The `up_category_group` row an override writes; a nil group is written as null.
private struct OverrideUpsert: Encodable, Sendable {
    let householdID: String
    let categoryID: String
    let lineGroup: BudgetGroup?

    enum CodingKeys: String, CodingKey {
        case householdID = "household_id"
        case categoryID = "category_id"
        case lineGroup = "line_group"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(householdID, forKey: .householdID)
        try container.encode(categoryID, forKey: .categoryID)
        try container.encode(lineGroup, forKey: .lineGroup)
    }
}
