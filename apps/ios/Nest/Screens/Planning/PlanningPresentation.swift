import Foundation

/// One held sandbox change, as the Planning screen lists it.
struct PendingChange: Equatable, Identifiable, Sendable {
    enum Kind: String, Sendable {
        case edit, new, removed

        var title: String {
            switch self {
            case .edit: "Edited"
            case .new: "New"
            case .removed: "Removed"
            }
        }
    }

    let table: PlanningTable
    let rowID: String
    let name: String
    let kind: Kind
    /// `was → now` for one edited field, a count for several; `nil` otherwise.
    let detail: String?

    var id: String { "\(table.rawValue)/\(rowID)" }
}

/// A row the Planning screen offers for a what-if amount edit.
struct EditableAmount: Equatable, Identifiable, Sendable {
    let table: PlanningTable
    let rowID: String
    let name: String
    /// The column the edit patches.
    let column: String
    let cents: Int

    var id: String { "\(table.rawValue)/\(rowID)" }
}

/// Pure functions turning the sandbox and the rows into what the Planning screen
/// shows, so they test without a screen.
enum PlanningPresentation {
    /// Every held change, tables in sandbox order, each table's edits then
    /// creations then removals.
    static func pending(_ state: PlanningState, real: SummaryRows) -> [PendingChange] {
        PlanningTable.allCases.flatMap { table -> [PendingChange] in
            let layer = state.layer(table)
            let originals = originalRows(table, real: real)
            let edits = layer.updates.keys.sorted().compactMap { id -> PendingChange? in
                guard layer.creates.allSatisfy({ $0["id"] != .string(id) }),
                    let original = originals[id]
                else { return nil }
                return PendingChange(
                    table: table, rowID: id, name: name(of: original) ?? table.title,
                    kind: .edit, detail: describe(layer.updates[id] ?? [:], from: original))
            }
            let news = layer.creates.compactMap { row -> PendingChange? in
                guard case .string(let id)? = row["id"] else { return nil }
                return PendingChange(
                    table: table, rowID: id, name: name(of: row) ?? table.title, kind: .new,
                    detail: nil)
            }
            let removals = layer.deletes.map { id in
                PendingChange(
                    table: table, rowID: id, name: originals[id].flatMap(name(of:)) ?? table.title,
                    kind: .removed, detail: nil)
            }
            return edits + news + removals
        }
    }

    /// The rows a what-if amount edit is offered on: inflows with a stated
    /// amount, manual budget lines (a line derived from a breakdown or gifts is
    /// read-only), and savings goals' targets. Reads the sandboxed rows, so each
    /// amount is what the plan currently holds.
    static func editable(_ rows: SummaryRows) -> [EditableAmount] {
        rows.inflows.compactMap { row in
            row.amountCents.map {
                EditableAmount(
                    table: .inflows, rowID: row.id, name: row.name, column: "amount_cents", cents: $0)
            }
        }
            + rows.budgetLines.filter { $0.breakdownId == nil && !$0.isGiftLine }.map {
                EditableAmount(
                    table: .budgetLine, rowID: $0.id, name: $0.name, column: "amount_cents",
                    cents: $0.amountCents)
            }
            + rows.savingsGoals.map {
                EditableAmount(
                    table: .savingsGoal, rowID: $0.id, name: $0.name,
                    column: "target_amount_cents", cents: $0.targetAmountCents)
            }
    }

    /// Dollars typed by hand (`1,234.50`, `$20`) as integer cents; `nil` when
    /// the text is not a non-negative amount with at most two decimals.
    static func parseCents(_ text: String) -> Int? {
        let cleaned = text.filter { $0 != "$" && $0 != "," && !$0.isWhitespace }
        guard !cleaned.isEmpty, let dollars = Decimal(string: cleaned, locale: Locale(identifier: "en_US")),
            dollars >= 0
        else { return nil }
        var cents = dollars * 100
        var whole = Decimal()
        NSDecimalRound(&whole, &cents, 0, .plain)
        guard whole == cents else { return nil }
        return NSDecimalNumber(decimal: whole).intValue
    }

    private static func originalRows(_ table: PlanningTable, real: SummaryRows) -> [String: JSONRow] {
        func index<T: NestRow>(_ rows: [T]) -> [String: JSONRow] where T.ID == String {
            Dictionary(
                uniqueKeysWithValues: rows.compactMap { row in
                    PlanningLayer.json(of: row).map { (row.id, $0) }
                })
        }
        switch table {
        case .inflows: return index(real.inflows)
        case .budgetLine: return index(real.budgetLines)
        case .savingsGoal: return index(real.savingsGoals)
        }
    }

    private static func name(of row: JSONRow) -> String? {
        if case .string(let name)? = row["name"] { name } else { nil }
    }

    private static func describe(_ patch: JSONRow, from original: JSONRow) -> String? {
        guard patch.count == 1, let (column, value) = patch.first else {
            return patch.isEmpty ? nil : "\(patch.count) fields changed"
        }
        return "\(label(column)) \(show(original[column], column)) → \(show(value, column))"
    }

    private static func label(_ column: String) -> String {
        let words = column.replacingOccurrences(of: "_cents", with: "").split(separator: "_")
        return words.joined(separator: " ").capitalized
    }

    private static func show(_ value: JSONValue?, _ column: String) -> String {
        switch value {
        case .int(let cents)? where column.hasSuffix("_cents"): MoneyFormat.cents(cents)
        case .int(let number)?: String(number)
        case .double(let number)?: String(number)
        case .string(let text)?: text
        case .bool(let flag)?: flag ? "yes" : "no"
        default: "none"
        }
    }
}
