import Foundation

/// One grant: its labels, vesting progress and values.
struct GrantRow: Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let instrumentLabel: String
    let isOption: Bool
    let frequencyLabel: String
    /// `6,458 / 10,000 vested`.
    let vestedLabel: String
    let netCents: Int64
    /// An option grant's gross vested value and exercise cost; `nil` for shares.
    let valueLine: String?
    /// Units exercised, sold and held; `nil` when none has moved.
    let activityLine: String?

    /// The one-line caption of the dense row: the value and activity lines joined.
    var caption: String? {
        let parts = [valueLine, activityLine].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " — ")
    }
}

/// A recorded exercise or sale.
struct ActivityRow: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let detail: String
}

/// One member's grants, exercises and sales.
struct MemberEquity: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let grants: [GrantRow]
    /// `nil` when the member holds no option grant (the section is not shown).
    let exercises: [ActivityRow]?
    /// `nil` when the member holds no grant.
    let sales: [ActivityRow]?
}

/// The Equity screen's labels and rows, mirroring the PWA's `EquityScreen` so both
/// surfaces label and group identically. Figures come from the engine; this only
/// looks them up and labels them.
struct EquityPresentation: Sendable {
    static let title = "Equity"
    static let intro =
        "Each member’s startup equity grants, vesting after a cliff. Unexercised vested options are valued at their gain over the strike; exercised shares still held at the price per share; sold shares leave your holdings. The value counts toward household net worth. Keep the price per share current yourself."
    static let option = "option"
    static let noGrants = "No grants yet."
    static let noExercises = "No exercises recorded."
    static let noSales = "No sales recorded."

    let content: EquityContent

    /// Each member in name order with their grants and, as the PWA shows them,
    /// the exercises (when they hold an option grant) and sales (when they hold a grant).
    var members: [MemberEquity] {
        let figures = Dictionary(
            content.figures.map { ($0.grantId, $0) }, uniquingKeysWith: { first, _ in first })
        let labels = Dictionary(
            content.rows.grants.map { ($0.id, $0.label) }, uniquingKeysWith: { first, _ in first })
        func grantLabel(_ id: String) -> String { labels[id] ?? "Grant" }
        return content.rows.members.map { member in
            let grants = content.rows.grants.filter { $0.memberId == member.id }
            let hasOptions = grants.contains { $0.instrumentType == Self.option }
            return MemberEquity(
                id: member.id, name: member.name,
                grants: grants.map { row($0, figures[$0.id]) },
                exercises: hasOptions
                    ? content.rows.exercises.filter { $0.memberId == member.id }.map {
                        Self.exercise($0, grantLabel: grantLabel($0.grantId))
                    } : nil,
                sales: grants.isEmpty
                    ? nil
                    : content.rows.sales.filter { $0.memberId == member.id }.map {
                        Self.sale($0, grantLabel: grantLabel($0.grantId))
                    })
        }
    }

    private func row(_ grant: EquityGrant, _ figures: GrantFigures?) -> GrantRow {
        let figures = figures ?? GrantFigures(
            grantId: grant.id, vested: 0, exercised: 0, sold: 0, held: 0, grossCents: 0,
            exerciseCents: 0, netCents: 0)
        let isOption = grant.instrumentType == Self.option
        return GrantRow(
            id: grant.id, label: grant.label,
            instrumentLabel: Self.instrumentLabel(grant.instrumentType), isOption: isOption,
            frequencyLabel: Self.frequencyLabel(grant.vestingFrequency),
            vestedLabel: "\(Self.count(figures.vested)) / \(Self.count(Int(grant.quantity))) vested",
            netCents: figures.netCents,
            valueLine: isOption
                ? "Vested value \(MoneyFormat.cents(Int(figures.grossCents))) · Exercise cost "
                    + MoneyFormat.cents(Int(figures.exerciseCents))
                : nil,
            activityLine: Self.activity(
                exercised: figures.exercised, sold: figures.sold, held: figures.held))
    }

    /// `Options` or `Shares`; an unknown type reads as stored.
    static func instrumentLabel(_ type: String) -> String {
        switch type {
        case "option": "Options"
        case "share": "Shares"
        default: type
        }
    }

    /// `Monthly`, `Quarterly` or `Annual`; an unknown frequency reads as stored.
    static func frequencyLabel(_ frequency: String) -> String {
        switch frequency {
        case "monthly": "Monthly"
        case "quarterly": "Quarterly"
        case "annual": "Annual"
        default: frequency
        }
    }

    /// `1,000 exercised · 500 sold · 2,500 shares held`, listing only what applies;
    /// `nil` when nothing has been exercised or sold.
    static func activity(exercised: Int, sold: Int, held: Int) -> String? {
        let parts = [
            exercised > 0 ? "\(count(exercised)) exercised" : nil,
            sold > 0 ? "\(count(sold)) sold" : nil,
            exercised > 0 || sold > 0 ? "\(count(held)) shares held" : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func exercise(_ exercise: EquityExercise, grantLabel: String) -> ActivityRow {
        ActivityRow(
            id: exercise.id, title: "\(count(Int(exercise.quantity))) × \(grantLabel)",
            detail: [
                date(exercise.exercisedOn),
                "strike \(MoneyFormat.cents(exercise.strikePriceCents))",
                exercise.marketPricePerShareCents.map { "market \(MoneyFormat.cents($0))" },
            ].compactMap { $0 }.joined(separator: " · "))
    }

    static func sale(_ sale: EquitySale, grantLabel: String) -> ActivityRow {
        ActivityRow(
            id: sale.id, title: "\(count(Int(sale.quantity))) × \(grantLabel)",
            detail: [
                date(sale.soldOn),
                "\(MoneyFormat.cents(sale.pricePerShareCents)) per share",
                sale.feeCents > 0 ? "fees \(MoneyFormat.cents(sale.feeCents))" : nil,
            ].compactMap { $0 }.joined(separator: " · "))
    }

    /// A whole quantity with thousands separators, as `toLocaleString()`.
    static func count(_ quantity: Int) -> String {
        quantity.formatted(.number.locale(Locale(identifier: "en_US")))
    }

    /// An ISO date as the PWA's `formatIsoDate`: `28 Feb 2027`.
    static func date(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        guard parts.count == 3,
            let date = calendar.date(
                from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        else { return iso }
        return date.formatted(
            Date.FormatStyle(locale: Locale(identifier: "en_AU"), timeZone: .gmt)
                .day().month(.abbreviated).year())
    }
}
