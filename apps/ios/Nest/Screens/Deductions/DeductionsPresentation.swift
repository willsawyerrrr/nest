import Foundation

/// Which drop a dragged deduction takes, mirroring the PWA's `deductionDrop.ts`.
enum DeductionDrop {
    /// The id of the droppable that clears a deduction's group.
    static let ungroupedID = "ungrouped"

    /// The id of the droppable for a group.
    static func dropID(group id: String) -> String { "group:\(id)" }

    enum Result: Equatable, Sendable {
        /// Not a valid move.
        case invalid
        /// Take the deduction out of its group.
        case ungrouped
        /// File the deduction under the group with this id.
        case group(String)

        /// The `group_id` the move writes; nil for ungrouped. Nil too when invalid.
        var groupID: String? {
            if case .group(let id) = self { id } else { nil }
        }

        var isValid: Bool { self != .invalid }
    }

    /// The move dropping `deduction` on `dropID` makes. A drop is invalid onto a group of
    /// another member or financial year, onto where the deduction already sits, or across
    /// the donations boundary: a donation sits in a donations group alone.
    static func result(
        for deduction: Deduction, dropID: String, groups: [DeductionGroup]
    ) -> Result {
        if dropID == ungroupedID {
            return deduction.groupId == nil || deduction.category == .donation
                ? .invalid : .ungrouped
        }
        guard
            let group = groups.first(where: { Self.dropID(group: $0.id) == dropID }),
            group.id != deduction.groupId,
            group.memberId == deduction.memberId,
            group.financialYear == deduction.financialYear,
            (group.kind == "donations") == (deduction.category == .donation)
        else { return .invalid }
        return .group(group.id)
    }
}

/// One group with the payments filed under it and their sum.
struct GroupedPayments: Equatable, Identifiable, Sendable {
    let group: DeductionGroup
    let payments: [Deduction]
    let totalCents: Int

    var id: String { group.id }

    /// `1 payment` or `N payments`.
    var paymentLabel: String { payments.count == 1 ? "1 payment" : "\(payments.count) payments" }
}

/// One member's deductions as the screen lists them.
struct MemberDeductions: Equatable, Identifiable, Sendable {
    let member: Member
    let totalCents: Int
    let groups: [GroupedPayments]
    let ungrouped: [Deduction]

    var id: String { member.id }
}

/// The Deductions screen's derived figures and labels, mirroring the PWA's
/// `DeductionsScreen`, `DeductionItem` and `DeductionGroup` so both surfaces total,
/// group and label identically.
struct DeductionsPresentation: Sendable {
    let rows: DeductionsRows

    /// Each member's deductions, in member order. A group's total is summed from its
    /// payments, never stored; the member's total counts grouped and ungrouped alike.
    var members: [MemberDeductions] {
        rows.members.map { member in
            let deductions = rows.deductions.filter { $0.memberId == member.id }
            let groups = rows.groups.filter { $0.memberId == member.id }
            return MemberDeductions(
                member: member,
                totalCents: deductions.reduce(0) { $0 + $1.amountCents },
                groups: Self.grouped(groups: groups, deductions: deductions),
                ungrouped: deductions.filter { $0.groupId == nil })
        }
    }

    static func grouped(groups: [DeductionGroup], deductions: [Deduction]) -> [GroupedPayments] {
        groups.map { group in
            let payments = deductions.filter { $0.groupId == group.id }
            return GroupedPayments(
                group: group, payments: payments,
                totalCents: payments.reduce(0) { $0 + $1.amountCents })
        }
    }

    /// The receipt stored for `deduction`, if any.
    func receipt(for deduction: Deduction) -> DeductionReceipt? {
        rows.receipts.first { $0.deductionId == deduction.id }
    }

    /// The date, plus the claimed distance (`1 Aug 2026 · 120km`), the hours
    /// (`1 Aug 2026 · 40 hours`) or the work-use share (`1 Aug 2026 · 60% work use`).
    static func dateLabel(_ deduction: Deduction) -> String {
        let date = formatISODate(deduction.deductionDate)
        if deduction.basis == .distance, let km = deduction.distanceKm {
            return "\(date) · \(number(km))km"
        }
        if deduction.basis == .hours, let hours = deduction.workFromHomeHours {
            return "\(date) · \(number(hours)) hours"
        }
        if deduction.workUsePercent < 100 {
            return "\(date) · \(number(deduction.workUsePercent))% work use"
        }
        return date
    }

    /// `1 Aug 2026` for an ISO date, built without a timezone shift.
    static func formatISODate(_ iso: String) -> String {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return iso }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        else { return iso }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "d MMM yyyy"
        return formatter.string(from: date)
    }

    /// A number as JavaScript prints it: `120`, not `120.0`.
    static func number(_ value: Double) -> String {
        value == value.rounded() && abs(value) < 1e15
            ? String(Int(value)) : String(value)
    }
}
