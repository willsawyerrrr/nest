import Foundation

/// Every row the Equity screen reads.
struct EquityRows: Codable, Sendable, Equatable {
    var grants: [EquityGrant] = []
    var exercises: [EquityExercise] = []
    var sales: [EquitySale] = []
    var members: [Member] = []

    /// The grants by grant date, the exercises and sales oldest first, and the
    /// members by name, as the PWA reads them.
    static var sources: [TableSource<EquityRows>] {
        [
            .table(EquityGrant.self, order: [Order(column: "grant_date")]) { $0.grants = $1 },
            .table(
                EquityExercise.self,
                order: [Order(column: "exercised_on"), Order(column: "created_at")]
            ) { $0.exercises = $1 },
            .table(
                EquitySale.self, order: [Order(column: "sold_on"), Order(column: "created_at")]
            ) { $0.sales = $1 },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
        ]
    }

    /// The engine input at `now`: every grant with its exercises and sales.
    func input(now: Date) -> EquityInput {
        EquityInput(
            grants: grants, exercises: exercises.map(EquityInput.Movement.init),
            sales: sales.map(EquityInput.Movement.init), now: SummaryRows.iso(now))
    }
}

/// The engine's `EquityInput`. Grants encode with their column names.
struct EquityInput: Encodable, Sendable {
    /// An exercise or sale, as the roll-up reads it.
    struct Movement: Encodable, Sendable {
        let grantId: String
        let quantity: Double

        enum CodingKeys: String, CodingKey {
            case grantId = "grant_id"
            case quantity
        }

        init(_ exercise: EquityExercise) {
            grantId = exercise.grantId
            quantity = exercise.quantity
        }

        init(_ sale: EquitySale) {
            grantId = sale.grantId
            quantity = sale.quantity
        }
    }

    let grants: [EquityGrant]
    let exercises: [Movement]
    let sales: [Movement]
    let now: String
}
