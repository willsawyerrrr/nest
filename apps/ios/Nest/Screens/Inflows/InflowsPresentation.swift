import Foundation

/// One inflow in the list: the labels and figures `InflowList` shows for it.
struct InflowListRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    /// The dimmed suffix beside the name: member and type, or `Non-taxable · type`.
    let subtitle: String
    let typeLabel: String
    let memberName: String?
    let isTaxable: Bool
    /// The entered amount: a flat amount, or a wage's `rate × hours`.
    let amount: String
    /// The cadence badge: the amount's period, or `One-off`.
    let cadence: String
    /// The fortnightly figure; `nil` for a one-off, which has none.
    let fortnightlyCents: Int64?
    /// The dimmed qualification line, or `nil` when none applies.
    let caption: String?
    /// Whether all the inflow's money is behind it.
    let isEnded: Bool
}

/// The Inflows screen's derived figures and labels, mirroring the PWA's `InflowList`
/// so both surfaces label and order identically. Fortnightly figures come from the
/// engine; this only looks them up and labels them.
struct InflowsPresentation: Sendable {
    let rows: InflowsRows
    let fortnightlies: InflowFortnightlies
    let now: Date

    /// The inflows with ended ones sunk to the bottom, otherwise in stored order.
    var list: [InflowListRow] {
        let fortnightly = Dictionary(
            fortnightlies.items.map { ($0.inflowId, $0.fortnightlyCents) },
            uniquingKeysWith: { first, _ in first })
        let built = rows.inflows.map { inflow in
            Self.row(
                inflow, memberName: memberName(inflow.memberId), fortnightlyCents: fortnightly[inflow.id] ?? nil,
                now: now)
        }
        return built.filter { !$0.isEnded } + built.filter(\.isEnded)
    }

    func inflow(id: String) -> Inflow? { rows.inflows.first { $0.id == id } }

    private func memberName(_ id: String?) -> String? {
        id.flatMap { id in rows.members.first { $0.id == id }?.name } ?? (id == nil ? nil : "Unknown")
    }

    static func row(
        _ inflow: Inflow, memberName: String?, fortnightlyCents: Int64?, now: Date
    ) -> InflowListRow {
        InflowListRow(
            id: inflow.id, name: inflow.name,
            subtitle: subtitle(inflow, memberName: memberName),
            typeLabel: typeLabel(inflow.type), memberName: memberName,
            isTaxable: inflow.taxable, amount: describeAmount(inflow),
            cadence: cadenceLabel(inflow), fortnightlyCents: fortnightlyCents,
            caption: caption(inflow), isEnded: isEnded(inflow, now: now))
    }

    // MARK: Labels

    static func typeLabel(_ type: InflowType) -> String {
        switch type {
        case .salary: "Salary"
        case .wage: "Wage"
        case .other: "Other"
        case .reimbursement: "Reimbursement"
        case .hobby: "Hobby income"
        case .gift: "Gift"
        }
    }

    static func treatmentLabel(_ treatment: OneOffTaxTreatment) -> String {
        switch treatment {
        case .ordinary: "Ordinary income"
        case .genuineRedundancy: "Genuine redundancy"
        case .employmentTermination: "Employment termination payment"
        case .unusedLeave: "Unused leave on redundancy"
        }
    }

    /// `Weekly`, `Annually`, `Every 4 weeks`, `Every month`, or `Every N weeks`.
    static func frequencyLabel(_ frequency: Frequency, interval: Int?) -> String {
        BreakdownsPresentation.frequencyLabel(frequency, interval: interval)
    }

    /// The entered amount: a flat amount, or a wage's rate × hours.
    static func describeAmount(_ inflow: Inflow) -> String {
        if inflow.type == .wage {
            let rate = MoneyFormat.cents(inflow.hourlyRateCents ?? 0)
            return "\(rate) × \(trimmed(inflow.hoursPerPeriod ?? 0)) hrs"
        }
        return MoneyFormat.cents(inflow.amountCents ?? 0)
    }

    /// A number as JavaScript prints it: no trailing `.0`.
    static func trimmed(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    static func cadenceLabel(_ inflow: Inflow) -> String {
        guard let schedule = inflow.schedule else { return "One-off" }
        return frequencyLabel(schedule, interval: inflow.intervalCount)
    }

    /// How often the money arrives where that is not the period the amount is
    /// expressed over (`Paid fortnightly` beside a yearly amount); `nil` otherwise.
    static func payCadenceLabel(_ inflow: Inflow) -> String? {
        guard let paySchedule = inflow.paySchedule else { return nil }
        if paySchedule == inflow.schedule && inflow.payIntervalCount == inflow.intervalCount {
            return nil
        }
        return "Paid \(frequencyLabel(paySchedule, interval: inflow.payIntervalCount).lowercased())"
    }

    static func occasionalLabel(_ inflow: Inflow) -> String? {
        inflow.arrivesEveryPayPeriod ? nil : "Only some pay periods"
    }

    /// When a one-off lands and, for a taxable one, the concession it is assessed under.
    static func oneOffCaption(_ inflow: Inflow) -> String? {
        guard let paidOn = inflow.paidOn else { return nil }
        let paid = "One-off \u{00B7} \(formatIsoDate(paidOn))"
        guard let treatment = inflow.oneOffTaxTreatment else { return paid }
        return "\(paid) \u{00B7} \(treatmentLabel(treatment))"
    }

    /// `Joint · 60% / 40%` for a joint inflow; `nil` otherwise.
    static func jointCaption(_ inflow: Inflow) -> String? {
        guard inflow.isJoint, let percent = inflow.memberSplitPercent else { return nil }
        return "Joint \u{00B7} \(trimmed(percent))% / \(trimmed(100 - percent))%"
    }

    /// The effective window: `1 Jul 2026 – 14 Sep 2026`, `from …`, `until …`, or `nil`.
    static func effectiveDatesCaption(_ inflow: Inflow) -> String? {
        switch (inflow.startsOn, inflow.endsOn) {
        case (let start?, let end?): "\(formatIsoDate(start)) \u{2013} \(formatIsoDate(end))"
        case (let start?, nil): "from \(formatIsoDate(start))"
        case (nil, let end?): "until \(formatIsoDate(end))"
        case (nil, nil): nil
        }
    }

    /// The dimmed second line: every qualification that applies, joined by ` · `.
    static func caption(_ inflow: Inflow) -> String? {
        let parts = [
            oneOffCaption(inflow), jointCaption(inflow), payCadenceLabel(inflow),
            occasionalLabel(inflow), effectiveDatesCaption(inflow),
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// The dimmed row subtitle: the type, prefixed by the member or `Non-taxable`.
    static func subtitle(_ inflow: Inflow, memberName: String?) -> String {
        let type = typeLabel(inflow.type)
        if !inflow.taxable { return "Non-taxable \u{00B7} \(type)" }
        if let memberName { return "\(memberName) \u{00B7} \(type)" }
        return type
    }

    /// Whether the inflow's money is all behind it: a recurring one whose window has
    /// closed, or a one-off already paid. Compared by local date, so an inflow
    /// ending today is still live.
    static func isEnded(_ inflow: Inflow, now: Date) -> Bool {
        guard let last = inflow.paidOn ?? inflow.endsOn else { return false }
        return last < isoDate(now)
    }

    // MARK: Dates

    /// `YYYY-MM-DD` of `date` in the local calendar.
    static func isoDate(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    /// An ISO date as a short local date (`28 Feb 2027`), as `formatIsoDate` does.
    static func formatIsoDate(_ iso: String) -> String {
        guard let date = parseIsoDate(iso) else { return iso }
        return date.formatted(
            .dateTime.day().month(.abbreviated).year().locale(Locale(identifier: "en_AU")))
    }

    static func parseIsoDate(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
