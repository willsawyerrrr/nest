import Foundation

/// One category picker group: a parent and its assignable children.
struct UpCategoryGroup: Equatable, Sendable, Identifiable {
    let name: String
    let items: [UpCategory]
    var id: String { name }
}

/// Up's category taxonomy as the review screen and the review notification
/// pick from it.
enum UpCategories {
    /// Up's child categories grouped under their parents, both alphabetical,
    /// leaving out a parent with no children.
    static func groups(_ categories: [UpCategory]) -> [UpCategoryGroup] {
        let byName: (UpCategory, UpCategory) -> Bool = {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        return categories.filter { $0.parentId == nil }.sorted(by: byName).compactMap { parent in
            let items = categories.filter { $0.parentId == parent.id }.sorted(by: byName)
            return items.isEmpty ? nil : UpCategoryGroup(name: parent.name, items: items)
        }
    }

    /// `Parent › Child`, the child alone where its parent is unknown, the id
    /// where the category is unknown, or nil when uncategorised.
    static func label(_ categories: [UpCategory], _ id: String?) -> String? {
        guard let id else { return nil }
        guard let child = categories.first(where: { $0.id == id }) else { return id }
        guard let parent = categories.first(where: { $0.id == child.parentId }) else {
            return child.name
        }
        return "\(parent.name) › \(child.name)"
    }

    /// The picker's label for a chosen category: the child's name.
    static func pickerLabel(_ categories: [UpCategory], _ id: String?) -> String {
        guard let id else { return "Uncategorised" }
        return categories.first { $0.id == id }?.name ?? id
    }
}
