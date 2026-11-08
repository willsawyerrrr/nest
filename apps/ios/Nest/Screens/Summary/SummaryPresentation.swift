import Foundation

/// The basis the donut and ledger are read on: take-home (post-tax) cash, or gross income.
enum IncomeBasis: String, CaseIterable, Identifiable, Sendable {
    case takeHome = "take-home"
    case gross

    var id: Self { self }
    var title: String { self == .gross ? "Gross" : "Take-home" }
}

/// One ledger line: its label, amounts and rendering flags.
struct LedgerRow: Equatable, Identifiable, Sendable {
    let label: String
    let amounts: BudgetSummary.Amounts
    /// A running subtotal (Gross / Available / After Outgoing / After Saving).
    let running: Bool
    /// Whether the amount takes the money-sign colour.
    var signed = false

    var id: String { label }
}

/// A donut slice: its label, fortnightly amount, colour and share of the basis.
struct AllocationSegment: Equatable, Identifiable, Sendable {
    let name: String
    let cents: Int64
    let color: ChartColorKey
    let portion: Double

    var id: String { name }
}

/// The Summary's derived figures, mirroring the PWA's `SummaryView` so both
/// surfaces label and divide the engine's figures identically.
struct SummaryPresentation: Sendable {
    let summary: BudgetSummary

    private typealias GroupPath = KeyPath<BudgetSummary.Groups, BudgetSummary.Group>

    private static var groups: [(path: GroupPath, label: String, color: ChartColorKey)] {
        [
            (\.needs, "Needs", .needs), (\.wants, "Wants", .wants),
            (\.discretionary, "Discretionary", .discretionary),
            (\.temporary, "Temporary", .temporary),
            (\.savings, "Savings", .savings), (\.investments, "Investments", .investments),
        ]
    }
    private static let outgoing: Set<String> = ["Needs", "Wants", "Discretionary", "Temporary"]

    /// Take-home available cash plus the tax and salary-sacrifice slices ahead of it.
    var gross: BudgetSummary.Amounts {
        .init(
            fortnightlyCents: summary.available.fortnightlyCents + summary.tax.fortnightlyCents
                + summary.salarySacrifice.fortnightlyCents,
            annualCents: summary.available.annualCents + summary.tax.annualCents
                + summary.salarySacrifice.annualCents)
    }

    /// The fortnightly amount the basis's shares divide against.
    func basisCents(_ basis: IncomeBasis) -> Int64 {
        basis == .gross ? gross.fortnightlyCents : summary.available.fortnightlyCents
    }

    func portion(of cents: Int64, basis: IncomeBasis) -> Double {
        let total = basisCents(basis)
        return total == 0 ? 0 : Double(cents) / Double(total)
    }

    /// Each non-empty group, then a Buffer slice for a positive After Saving
    /// remainder; the gross basis prepends positive Tax and Salary sacrifice slices.
    func segments(_ basis: IncomeBasis) -> [AllocationSegment] {
        var result: [AllocationSegment] = []
        func add(_ name: String, _ cents: Int64, _ color: ChartColorKey) {
            if cents > 0 {
                result.append(
                    .init(name: name, cents: cents, color: color, portion: portion(of: cents, basis: basis)))
            }
        }
        if basis == .gross {
            add("Tax", summary.tax.fortnightlyCents, .tax)
            add("Salary sacrifice", summary.salarySacrifice.fortnightlyCents, .sacrifice)
        }
        for group in Self.groups {
            add(group.label, summary.groups[keyPath: group.path].fortnightlyCents, group.color)
        }
        add("Buffer", summary.afterSaving.fortnightlyCents, .buffer)
        return result
    }

    /// The reconciliation in order: on the gross basis Gross, Tax and Salary
    /// sacrifice lead; then Available, the outgoing groups, After Outgoing, the
    /// saving groups and After Saving.
    func ledger(_ basis: IncomeBasis) -> [LedgerRow] {
        func rows(outgoing: Bool) -> [LedgerRow] {
            Self.groups.filter { Self.outgoing.contains($0.label) == outgoing }.map {
                let group = summary.groups[keyPath: $0.path]
                return LedgerRow(
                    label: $0.label,
                    amounts: .init(
                        fortnightlyCents: group.fortnightlyCents, annualCents: group.annualCents),
                    running: false)
            }
        }
        var result: [LedgerRow] = []
        if basis == .gross {
            result += [
                LedgerRow(label: "Gross", amounts: gross, running: true),
                LedgerRow(label: "Tax", amounts: summary.tax, running: false),
                LedgerRow(label: "Salary sacrifice", amounts: summary.salarySacrifice, running: false),
            ]
        }
        result.append(LedgerRow(label: "Available", amounts: summary.available, running: true))
        result += rows(outgoing: true)
        result.append(LedgerRow(label: "After Outgoing", amounts: summary.afterOutgoing, running: true))
        result += rows(outgoing: false)
        result.append(
            LedgerRow(label: "After Saving", amounts: summary.afterSaving, running: true, signed: true))
        return result
    }

    /// Whether there is anything to reconcile.
    var hasData: Bool {
        summary.available.annualCents != 0 || summary.outgoings.annualCents != 0
            || summary.savingsBlock.annualCents != 0 || summary.oneOffCents != 0
    }

    /// `12.3%`.
    static func percent(_ portion: Double) -> String {
        portion.formatted(
            .percent.precision(.fractionLength(1)).locale(Locale(identifier: "en_AU")))
    }
}
