import Foundation

/// The engine's projections for one set of rows: each goal's funding, each
/// active goal's own projection and each queued goal's place in the queue.
struct GoalsFigures: Equatable, Sendable {
    var contributions: [String: Int]
    var active: [String: GoalProjection]
    var queued: [String: QueuedGoalProjection]
}

/// The real rows a planning-mode comparison reads, with the figures from them.
struct GoalsBaseline: Equatable, Sendable {
    var rows: GoalsRows
    var figures: GoalsFigures
    /// Every real goal projected as if it were drawing its real funding now.
    var asActive: [String: GoalProjection]
}

/// One run of an ETA or figure; a comparison reads `real → proposed (±change)`.
enum GoalSegment: Equatable, Sendable {
    case plain(String)
    case struck(String)
    case proposed(String)
    case delta(String, MoneySign)
}

extension [GoalSegment] {
    /// The text with no styling.
    var text: String {
        map {
            switch $0 {
            case .plain(let value), .struck(let value), .proposed(let value), .delta(let value, _): value
            }
        }.joined()
    }
}

/// A goal's status flag.
struct GoalStatus: Equatable, Sendable {
    let label: String
    let tone: NestPill.Tone
}

/// A goal as listed: progress, status flag and ETA line.
struct GoalRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let balanceCents: Int
    let targetCents: Int
    let percent: Double
    let status: GoalStatus
    let eta: [GoalSegment]
    let contribution: [GoalSegment]
    let contributionCents: Int
    let saverName: String?
    let saverDeleted: Bool

    var roundedPercent: Int { Int(percent.rounded()) }
}

/// What the Goals screen renders once loaded.
struct GoalsContent: Equatable, Sendable {
    let rows: GoalsRows
    let figures: GoalsFigures
    let baseline: GoalsBaseline?
    let householdID: String?
    let now: Date
}

/// The Goals screen's rows and copy, mirroring the PWA's `goalProjection` and
/// `GoalList` so both surfaces label and divide identically.
struct GoalsPresentation: Equatable, Sendable {
    static let emptyMessage =
        "No goals yet. A new goal waits under Upcoming until a Savings or Investments budget line funds it."
    static let upcomingNote =
        "Saved towards once the goals above finish. Drag to reorder. A new goal waits here until a Savings or Investments budget line funds it."

    let active: [GoalRow]
    let queued: [GoalRow]

    init(content: GoalsContent) {
        let rows = content.rows
        let figures = content.figures
        let (active, queued) = rows.partition(contributions: figures.contributions)
        let baseline = content.baseline

        self.active = active.compactMap { goal in
            guard let projection = figures.active[goal.id] else { return nil }
            let contribution = figures.contributions[goal.id] ?? 0
            let real = baseline?.asActive[goal.id]
            let realContribution = baseline.map { $0.figures.contributions[goal.id] ?? 0 }
            return Self.row(
                goal, saver: rows.saver(for: goal),
                balance: rows.balanceCents(of: goal),
                display: Self.activeDisplay(
                    goal, balance: rows.balanceCents(of: goal), contributionCents: contribution,
                    projection: projection, baseline: real),
                contributionCents: contribution, baselineContributionCents: realContribution)
        }
        self.queued = queued.compactMap { goal in
            guard let projection = figures.queued[goal.id] else { return nil }
            return Self.row(
                goal, saver: rows.saver(for: goal), balance: rows.balanceCents(of: goal),
                display: Self.queuedDisplay(
                    goal, balance: rows.balanceCents(of: goal), projection: projection,
                    baseline: baseline?.figures.queued[goal.id]),
                contributionCents: 0, baselineContributionCents: nil)
        }
    }

    private static func row(
        _ goal: SavingsGoal, saver: GoalSaver?, balance: Int,
        display: (status: GoalStatus, eta: [GoalSegment]), contributionCents: Int,
        baselineContributionCents: Int?
    ) -> GoalRow {
        GoalRow(
            id: goal.id, name: goal.name, balanceCents: balance, targetCents: goal.targetAmountCents,
            percent: percent(target: goal.targetAmountCents, balance: balance),
            status: display.status, eta: display.eta,
            contribution: compare(
                baseline: baselineContributionCents ?? contributionCents, proposed: contributionCents),
            contributionCents: contributionCents,
            saverName: saver.map(\.name), saverDeleted: saver?.isDeletedAtSource ?? false)
    }

    /// The percent of a target a balance covers, 100 for a zero target.
    static func percent(target: Int, balance: Int) -> Double {
        target > 0 ? min(100, Double(balance) / Double(target) * 100) : 100
    }

    static func fortnights(_ count: Int) -> String {
        "\(count) \(count == 1 ? "fortnight" : "fortnights")"
    }

    /// `4.50% p.a. assumed`, or `nil` when the goal models no interest.
    static func rateNote(bps: Int?) -> String? {
        guard let bps, bps > 0 else { return nil }
        return String(format: "%.2f%% p.a. assumed", Double(bps) / 100)
    }

    private static func withRate(
        _ goal: SavingsGoal, alreadyMet: Bool, _ status: GoalStatus, _ eta: [GoalSegment]
    ) -> (status: GoalStatus, eta: [GoalSegment]) {
        guard !alreadyMet, let note = rateNote(bps: goal.annualInterestBps) else { return (status, eta) }
        return (status, eta + [.plain(" · \(note)")])
    }

    // MARK: Comparisons

    /// A money figure, or `real → proposed (±change)` where the sandbox moved it.
    static func compare(baseline: Int, proposed: Int) -> [GoalSegment] {
        guard baseline != proposed else { return [.plain(MoneyFormat.cents(proposed))] }
        let change = proposed - baseline
        let sign = change > 0 ? "+" : "\u{2212}"
        return [
            .struck(MoneyFormat.cents(baseline)), .plain(" \u{2192} "),
            .proposed(MoneyFormat.cents(proposed)), .plain(" "),
            .delta("(\(sign)\(MoneyFormat.cents(abs(change))))", MoneySign(cents: change)),
        ]
    }

    /// A date, or `real → proposed (N days sooner|later)` where the sandbox moved it.
    static func compareDate(baseline: String?, proposed: String?) -> [GoalSegment] {
        func show(_ iso: String?) -> String { iso.map(BudgetPresentation.date) ?? "no ETA" }
        guard baseline != proposed else { return [.plain(show(proposed))] }
        var segments: [GoalSegment] = [
            .struck(show(baseline)), .plain(" \u{2192} "), .proposed(show(proposed)),
        ]
        if let baseline, let proposed, let days = dayDelta(from: baseline, to: proposed) {
            let magnitude = "\(abs(days)) day\(abs(days) == 1 ? "" : "s")"
            segments += [
                .plain(" "),
                .delta(days < 0 ? "(\(magnitude) sooner)" : "(\(magnitude) later)", days < 0 ? .positive : .negative),
            ]
        }
        return segments
    }

    private static func dayDelta(from: String, to: String) -> Int? {
        func parse(_ iso: String) -> Date? {
            let parts = iso.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return nil }
            return Calendar(identifier: .gregorian).date(
                from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        }
        guard let a = parse(from), let b = parse(to) else { return nil }
        return Calendar(identifier: .gregorian).dateComponents([.day], from: a, to: b).day
    }

    // MARK: Displays

    private static let reached = GoalStatus(label: "Reached", tone: .positive)
    private static let onTrack = GoalStatus(label: "On track", tone: .positive)
    private static let behind = GoalStatus(label: "Behind", tone: .warning)
    private static let noETA = GoalStatus(label: "No ETA", tone: .neutral)

    /// An active goal's status flag and ETA line.
    static func activeDisplay(
        _ goal: SavingsGoal, balance: Int, contributionCents: Int, projection: GoalProjection,
        baseline: GoalProjection?
    ) -> (status: GoalStatus, eta: [GoalSegment]) {
        if projection.alreadyMet {
            return withRate(goal, alreadyMet: true, reached, [.plain("Goal reached.")])
        }
        if let targetDate = goal.targetDate {
            let required = Int(projection.requiredFortnightlyContributionCents ?? 0)
            let isOnTrack = contributionCents >= required
            let suffix = isOnTrack ? "" : " (contributing \(MoneyFormat.perFortnight(contributionCents)))"
            let baselineRequired = Int(baseline?.requiredFortnightlyContributionCents ?? Int64(required))
            let lead = "By \(BudgetPresentation.date(targetDate)) needs "
            let eta: [GoalSegment] =
                baselineRequired == required
                ? [.plain("\(lead)\(MoneyFormat.perFortnight(required))\(suffix)")]
                : [.plain(lead)] + compare(baseline: baselineRequired, proposed: required)
                    + [.plain(" / fn\(suffix)")]
            return withRate(goal, alreadyMet: false, isOnTrack ? onTrack : behind, eta)
        }
        if let count = projection.fortnightsToTarget, let completion = projection.projectedCompletionDate {
            let lead = "\(fortnights(count)) \u{2014} "
            let baselineISO = baseline?.projectedCompletionDate ?? completion
            let eta: [GoalSegment] =
                baselineISO == completion
                ? [.plain("\(lead)\(BudgetPresentation.date(completion))")]
                : [.plain(lead)] + compareDate(baseline: baselineISO, proposed: completion)
            return withRate(goal, alreadyMet: false, onTrack, eta)
        }
        return withRate(goal, alreadyMet: false, noETA, [.plain("Link a savings item to project an ETA.")])
    }

    /// A queued goal's status flag and ETA line.
    static func queuedDisplay(
        _ goal: SavingsGoal, balance: Int, projection: QueuedGoalProjection,
        baseline: QueuedGoalProjection?
    ) -> (status: GoalStatus, eta: [GoalSegment]) {
        if projection.alreadyMet {
            return withRate(goal, alreadyMet: true, reached, [.plain("Goal reached.")])
        }
        guard let start = projection.projectedStartDate else {
            return withRate(
                goal, alreadyMet: false, noETA, [.plain("No projected start \u{2014} fund a goal above.")])
        }
        let startsLead = "Starts \(BudgetPresentation.date(start)) · "
        if let targetDate = goal.targetDate {
            let required = Int(projection.requiredFortnightlyContributionCents ?? 0)
            let completion = projection.projectedCompletionDate
            let isOnTrack = completion.map { $0 <= targetDate } ?? false
            let baselineRequired = Int(baseline?.requiredFortnightlyContributionCents ?? Int64(required))
            let lead = "\(startsLead)By \(BudgetPresentation.date(targetDate)) needs "
            let eta: [GoalSegment] =
                baselineRequired == required
                ? [.plain("\(lead)\(MoneyFormat.perFortnight(required))")]
                : [.plain(lead)] + compare(baseline: baselineRequired, proposed: required)
                    + [.plain(" / fn")]
            return withRate(goal, alreadyMet: false, isOnTrack ? onTrack : behind, eta)
        }
        let upcoming = GoalStatus(label: "Upcoming", tone: .info)
        guard let completion = projection.projectedCompletionDate else {
            return withRate(goal, alreadyMet: false, upcoming, [.plain("\(startsLead)no completion projected")])
        }
        let lead =
            projection.fortnightsToTarget.map { "\(startsLead)\(fortnights($0)) \u{2014} " } ?? startsLead
        let baselineISO = baseline?.projectedCompletionDate ?? completion
        let eta: [GoalSegment] =
            baselineISO == completion
            ? [.plain("\(lead)\(BudgetPresentation.date(completion))")]
            : [.plain(lead)] + compareDate(baseline: baselineISO, proposed: completion)
        return withRate(goal, alreadyMet: false, upcoming, eta)
    }

    // MARK: Queue order

    /// The queued ids after dropping `dragged` onto `over`, or `nil` for a no-op.
    static func nextQueueOrder(_ ids: [String], dragged: String, over: String) -> [String]? {
        guard dragged != over, let from = ids.firstIndex(of: dragged), let to = ids.firstIndex(of: over)
        else { return nil }
        var reordered = ids
        reordered.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        return reordered
    }
}
