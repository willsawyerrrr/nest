import Foundation

/// Every row the Household screen reads.
struct HouseholdRows: Codable, Sendable, Equatable {
    var households: [Household] = []

    /// The households the signed-in user belongs to, as the PWA reads them (RLS scopes the result).
    static var sources: [TableSource<HouseholdRows>] {
        [.table(Household.self) { $0.households = $1 }]
    }

    /// The household shown: the first, as the PWA picks it.
    var household: Household? { households.first }
}
