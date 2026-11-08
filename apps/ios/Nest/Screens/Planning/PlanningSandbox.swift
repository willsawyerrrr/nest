import Foundation

/// A JSON value, so a sandbox patch can carry any column's value (and `null`).
enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

/// One row as a JSON object keyed by column name.
typealias JSONRow = [String: JSONValue]

/// The tables planning mode sandboxes; every other table keeps writing real data.
enum PlanningTable: String, CaseIterable, Codable, Sendable {
    case inflows
    case budgetLine = "budget_line"
    case savingsGoal = "savings_goal"

    var title: String {
        switch self {
        case .inflows: "Inflow"
        case .budgetLine: "Budget line"
        case .savingsGoal: "Savings goal"
        }
    }
}

/// One table's pending sandbox edits: field patches keyed by row id, whole rows
/// created in the sandbox, and the ids of real rows hidden from it.
struct PlanningLayer: Codable, Equatable, Sendable {
    var updates: [String: JSONRow] = [:]
    var creates: [JSONRow] = []
    var deletes: [String] = []

    init(updates: [String: JSONRow] = [:], creates: [JSONRow] = [], deletes: [String] = []) {
        self.updates = updates
        self.creates = creates
        self.deletes = deletes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        updates = try container.decodeIfPresent([String: JSONRow].self, forKey: .updates) ?? [:]
        creates = try container.decodeIfPresent([JSONRow].self, forKey: .creates) ?? []
        deletes = try container.decodeIfPresent([String].self, forKey: .deletes) ?? []
    }

    var pendingCount: Int { updates.count + creates.count + deletes.count }

    /// Merges `patch` into `id`'s field patches.
    func updating(_ id: String, patch: JSONRow) -> PlanningLayer {
        var layer = self
        layer.updates[id, default: [:]].merge(patch) { _, new in new }
        return layer
    }

    /// Removes `id`: a sandbox-created row is dropped outright, a real row is
    /// hidden. Any field patch for `id` is discarded either way.
    func deleting(_ id: String) -> PlanningLayer {
        var layer = self
        layer.updates[id] = nil
        let wasCreated = layer.creates.contains { $0["id"] == .string(id) }
        layer.creates.removeAll { $0["id"] == .string(id) }
        if !wasCreated && !layer.deletes.contains(id) { layer.deletes.append(id) }
        return layer
    }

    /// Removes every trace of `id`: its patch, its create and its delete.
    func resetting(_ id: String) -> PlanningLayer {
        var layer = self
        layer.updates[id] = nil
        layer.creates.removeAll { $0["id"] == .string(id) }
        layer.deletes.removeAll { $0 == id }
        return layer
    }

    /// `rows` with hidden rows dropped, patched rows merged by id and
    /// sandbox-created rows appended. A row that no longer decodes after a patch
    /// is dropped.
    func apply<T: NestRow>(to rows: [T]) -> [T] where T.ID == String {
        let hidden = Set(deletes)
        func patched(_ row: JSONRow, id: String) -> JSONRow {
            row.merging(updates[id] ?? [:]) { _, new in new }
        }
        let existing = rows.filter { !hidden.contains($0.id) }.compactMap { row -> T? in
            guard updates[row.id] != nil, let object = Self.json(of: row) else { return row }
            return Self.row(patched(object, id: row.id))
        }
        let created = creates.compactMap { row -> T? in
            guard case .string(let id)? = row["id"], !hidden.contains(id) else { return nil }
            return Self.row(patched(row, id: id))
        }
        return existing + created
    }

    static func json<T: Encodable>(of row: T) -> JSONRow? {
        guard let data = try? JSONEncoder().encode(row) else { return nil }
        return try? JSONDecoder().decode(JSONRow.self, from: data)
    }

    private static func row<T: Decodable>(_ object: JSONRow) -> T? {
        guard let data = try? JSONEncoder().encode(object) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

/// The whole sandbox for one household: whether it is on, and the per-table edits
/// keyed by `PlanningTable.rawValue`.
struct PlanningState: Codable, Equatable, Sendable {
    var active = false
    var overrides: [String: PlanningLayer] = [:]

    static let inactive = PlanningState()

    init(active: Bool = false, overrides: [String: PlanningLayer] = [:]) {
        self.active = active
        self.overrides = overrides
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        active = try container.decodeIfPresent(Bool.self, forKey: .active) ?? false
        let raw = try container.decodeIfPresent([String: PlanningLayer].self, forKey: .overrides)
        overrides = (raw ?? [:]).filter { PlanningTable(rawValue: $0.key) != nil }
    }

    func layer(_ table: PlanningTable) -> PlanningLayer {
        overrides[table.rawValue] ?? PlanningLayer()
    }

    var pendingCount: Int { overrides.values.reduce(0) { $0 + $1.pendingCount } }
}
