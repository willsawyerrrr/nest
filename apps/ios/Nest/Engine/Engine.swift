import Foundation
import JavaScriptCore

/// The `@nest/tax`, `@nest/plan` and `@nest/household` engines, run in
/// JavaScriptCore from the bundle in `nest-engines.js`.
///
/// An actor, so each call runs off the main actor, and a `JSContext` (which is
/// not thread-safe) is only ever touched by one call at a time. Rows go in as
/// JSON, in the shapes the web app and the MCP server feed the same functions;
/// results come back as `Decodable`. Money is integer cents throughout, and a
/// trade's unit price stays an integer count of microdollars.
actor Engine {
    /// An engine entry point, named as the bundle's `NestEngine` global exposes it.
    enum Entry: String, Sendable {
        case estimateTax
        case summariseHousehold
        case projectGoalQueue
        case summariseBreakdowns
        case budgetOverview
        case taxScreen
        case salarySacrifice
        case mlsWhatIf
        case householdYear
    }

    enum Failure: Error, Equatable {
        case bundleMissing
        case contextUnavailable
        case scriptFailed(String)
        case entryMissing(String)
        case callFailed(String)
    }

    private final class BundleToken {}

    private let context: JSContext
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    /// Loads the bundle shipped in `bundle`'s resources and evaluates it.
    init(bundle: Bundle = Bundle(for: BundleToken.self)) throws {
        guard
            let url = bundle.url(forResource: "nest-engines", withExtension: "js"),
            let script = try? String(contentsOf: url, encoding: .utf8)
        else { throw Failure.bundleMissing }
        guard let context = JSContext() else { throw Failure.contextUnavailable }
        var thrown: String?
        context.exceptionHandler = { _, exception in thrown = exception?.toString() }
        context.evaluateScript(script, withSourceURL: url)
        if let thrown { throw Failure.scriptFailed(thrown) }
        context.exceptionHandler = nil
        self.context = context
    }

    /// Runs `entry` over `input`, a JSON document, and returns the JSON result.
    func call(_ entry: Entry, json input: Data) throws -> Data {
        guard
            let engine = context.objectForKeyedSubscript("NestEngine"),
            let function = engine.objectForKeyedSubscript(entry.rawValue),
            !function.isUndefined
        else { throw Failure.entryMissing(entry.rawValue) }
        var thrown: String?
        context.exceptionHandler = { _, exception in thrown = exception?.toString() }
        defer { context.exceptionHandler = nil }
        let result = function.call(withArguments: [String(decoding: input, as: UTF8.self)])
        if let thrown { throw Failure.callFailed(thrown) }
        guard let text = result?.toString() else { throw Failure.callFailed("no result") }
        return Data(text.utf8)
    }

    /// Encodes `input`, runs `entry`, and decodes the result as `Output`.
    func call<Output: Decodable>(
        _ entry: Entry, _ input: some Encodable, as output: Output.Type = Output.self
    ) throws -> Output {
        try decoder.decode(Output.self, from: call(entry, json: encoder.encode(input)))
    }

    /// The household's whole-year tax estimate for `input`'s rows.
    func estimateTax(_ input: some Encodable) throws -> TaxEstimate {
        try call(.estimateTax, input)
    }

    /// The household's reconciled Summary, including the fortnightly buffer.
    func summariseHousehold(_ input: some Encodable) throws -> BudgetSummary {
        try call(.summariseHousehold, input)
    }

    /// The savings-goal queue's projected start and completion dates.
    func projectGoalQueue(_ input: some Encodable) throws -> GoalQueueProjection {
        try call(.projectGoalQueue, input)
    }

    /// Each breakdown's rolled-up totals and each item's fortnightly figure.
    func summariseBreakdowns(_ input: some Encodable) throws -> BreakdownRollups {
        try call(.summariseBreakdowns, input)
    }

    /// The Budget screen's figures: each line's amounts, each group's subtotal,
    /// each allowance reconciled and which temporary items are active.
    func budgetOverview(_ input: some Encodable) throws -> BudgetOverview {
        try call(.budgetOverview, input)
    }

    /// The Tax estimate and EOFY screens' figures.
    func taxScreen(_ input: some Encodable) throws -> TaxScreenFigures {
        try call(.taxScreen, input)
    }

    /// A member's salary-sacrifice what-if.
    func salarySacrifice(_ input: some Encodable) throws -> SalarySacrificeResult {
        try call(.salarySacrifice, input)
    }

    /// The family Medicare levy surcharge if no member held private hospital cover.
    func mlsWhatIf(_ input: some Encodable) throws -> FamilyMlsFigures {
        try call(.mlsWhatIf, input)
    }

    /// The household's combined year figures and its Medicare levy surcharge test.
    func householdYear(_ input: some Encodable) throws -> HouseholdYearFigures {
        try call(.householdYear, input)
    }
}
