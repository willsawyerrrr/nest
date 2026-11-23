import Foundation

/// How a variance reads: its size with the direction spelled out, so a tint is never
/// read alone. `nil` cents has nothing to compare against, which is stated rather than
/// shown as a zero; `nullNote` says which of the reasons it is.
struct VarianceNote: Equatable, Sendable {
    enum Reading: Equatable, Sendable {
        case note(String)
        case onPlan
        case above(Int64)
        case below(Int64)
    }

    let reading: Reading

    /// What a figure with no variance to show says, where nothing more specific applies.
    static let noProjection = "No projection to compare"

    init(cents: Int64?, nullNote: String = VarianceNote.noProjection) {
        switch cents {
        case nil: reading = .note(nullNote)
        case 0?: reading = .onPlan
        case let value? where value > 0: reading = .above(value)
        case let value?: reading = .below(-value)
        }
    }

    /// The sign the figure is coloured by: above plan positive, below plan negative.
    var sign: MoneySign {
        switch reading {
        case .above: .positive
        case .below: .negative
        default: .zero
        }
    }

    var text: String {
        switch reading {
        case .note(let note): note
        case .onPlan: "On plan"
        case .above(let cents): "\(MoneyFormat.cents(Int(cents))) above plan"
        case .below(let cents): "\(MoneyFormat.cents(Int(cents))) below plan"
        }
    }
}

/// One figure: its label, the amount and any variance beneath, with an optional
/// qualifier under the variance.
struct FigureCellModel: Equatable, Identifiable, Sendable {
    let label: String
    let cents: Int64
    var variance: VarianceNote?
    var note: String?
    var id: String { label }
}

/// The headline variance as a single pill.
struct VariancePillModel: Equatable, Sendable {
    let text: String
    let tone: NestPill.Tone
}

/// A line group or tax group row of a slip's breakdown.
struct BreakdownRowModel: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let caption: String
    let actualCents: Int64
    let variance: VarianceNote
}

/// A signed difference spelled out against what it is measured against, coloured by sign.
struct DifferenceModel: Equatable, Sendable {
    let cents: Int64
    let against: String

    var text: String {
        "\(MoneyFormat.cents(Int(abs(cents)))) \(cents > 0 ? "more" : "less") than \(against)"
    }

    var sign: MoneySign { MoneySign(cents: Int(cents)) }
}

/// The Up credit that carried a payslip, measured against the slip's and the plan's net.
enum CreditNoteModel: Equatable, Sendable {
    case missing
    /// `landed` names when and how much; `net` is nil where the credit matches the slip.
    case landed(landed: String, net: DifferenceModel?, plan: DifferenceModel?)

    static let missingText = "No matching credit in Up"
    static let matchedText = " — matches the slip’s net"
}

/// One of a member's salary credits as the net-pay block lists it.
struct NetPayCreditModel: Equatable, Identifiable, Sendable {
    let id: String
    let date: String
    let payer: String
    let amountCents: Int64
    let noPayslip: Bool
    let cadenceNote: String?
    let amountDrift: DifferenceModel?
}

/// A member's net pay as it landed in Up over the year.
struct MemberNetPayModel: Equatable, Sendable {
    let receivedCents: Int64
    /// `across 3 credits`.
    let count: String
    /// `· 2 of 3 slips matched · paid every 14 days`, or empty.
    let qualifiers: String
    let credits: [NetPayCreditModel]

    static let title = "Net pay received in Up"
    /// Credits listed before the rest fold behind "Show all".
    static let collapsedCount = 6
}

/// A payslip's expanded body.
struct PayslipDetailModel: Equatable, Sendable {
    let figures: [FigureCellModel]
    /// The Up credit that carried the slip; nil where the household has no credits.
    let creditNote: CreditNoteModel?
    let earnings: [BreakdownRowModel]
    let earningsNote: String?
    let tax: [BreakdownRowModel]
    let taxNote: String?
    let unmeasuredGrossNote: String?
    let partCycleNote: String?
    let note: String?
    let documentPath: String?
}

/// One payslip as the list shows it.
struct PayslipCardModel: Equatable, Identifiable, Sendable {
    let payslip: Payslip
    let period: String
    let paid: String?
    let pill: VariancePillModel
    let detail: PayslipDetailModel
    var id: String { payslip.id }
    var grossCents: Int { payslip.grossCents }
}

/// A row of the year's position on pay no period measures.
struct UnmeasuredRowModel: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let caption: String
    let actualCents: Int64
    let variance: VarianceNote
}

/// A member's payslips and their year to date.
struct MemberPayslipsModel: Equatable, Identifiable, Sendable {
    let member: Member
    let countLabel: String
    let totals: [FigureCellModel]?
    let reportedNote: String?
    let unmeasured: [UnmeasuredRowModel]
    let netPay: MemberNetPayModel?
    let cards: [PayslipCardModel]
    var id: String { member.id }
}

/// The Payslips screen's derived figures and labels, mirroring the PWA's
/// `PayslipsScreen` and `PayslipCard` so both surfaces label identically. Every
/// figure comes from the engine; this only looks them up and words them.
struct PayslipsPresentation: Sendable {
    let content: PayslipsContent

    static let intro =
        "What each pay event actually paid, measured line by line against the projected inflows and the tax estimate. Withholding entered here is what turns the Tax tab’s estimated liability into a refund or a bill; withholding more than the plan expects points to a refund, not a problem."

    var title: String { "Payslips (FY\(content.financialYear))" }

    var members: [MemberPayslipsModel] {
        content.rows.members.map(memberModel)
    }

    /// Up salary credits no member can be tied to, as the PWA's `UnattributedSalaryNote`;
    /// nil where there are none.
    var unattributedNote: String? {
        Self.unattributedNote(content.overview.netPay?.unattributed ?? [])
    }

    private var creditMatches: [String: NetPay.CreditMatch] {
        Dictionary(
            (content.overview.netPay?.byPayslip ?? []).map { ($0.payslipId, $0.match) },
            uniquingKeysWith: { first, _ in first })
    }

    private var inflowNames: [String: String] {
        Dictionary(
            content.rows.inflows.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }

    private func memberModel(_ member: Member) -> MemberPayslipsModel {
        let payslips = content.rows.payslips.filter { $0.memberId == member.id }
        let overview = content.overview.members.first { $0.memberId == member.id }
        let variances = Dictionary(
            (overview?.variances ?? []).map { ($0.payslipId, $0.variance) },
            uniquingKeysWith: { first, _ in first })
        let names = inflowNames
        let matches = creditMatches
        return MemberPayslipsModel(
            member: member,
            countLabel: payslips.count == 1 ? "1 payslip" : "\(payslips.count) payslips",
            totals: payslips.isEmpty ? nil : overview.map(Self.totalCells),
            reportedNote: overview.flatMap(Self.reportedNote),
            unmeasured: (overview?.unmeasured ?? []).map { position in
                UnmeasuredRowModel(
                    id: position.sourceInflowId,
                    name: names[position.sourceInflowId] ?? "",
                    caption:
                        "\(MoneyFormat.cents(Int(position.expectedCents))) projected to \(Self.date(position.asAt)), \(MoneyFormat.cents(Int(position.annualExpectedCents))) for the year",
                    actualCents: position.actualCents, variance: VarianceNote(cents: position.varianceCents))
            },
            netPay: content.overview.netPay?.members.first { $0.memberId == member.id }
                .flatMap(Self.netPay),
            cards: payslips.compactMap { payslip in
                variances[payslip.id].map {
                    Self.card(
                        payslip, variance: $0, inflowNames: names, creditMatch: matches[payslip.id])
                }
            })
    }

    // MARK: Year to date

    static func totalCells(_ overview: PayslipsOverview.Member) -> [FigureCellModel] {
        let totals = overview.totals
        let positions = overview.positions
        return [
            FigureCellModel(
                label: "YTD gross", cents: totals.grossCents,
                variance: VarianceNote(
                    cents: positions.gross.varianceCents,
                    nullNote: overview.unmeasured.isEmpty
                        ? VarianceNote.noProjection : "This pay is measured across the year, below"),
                note: coverageNote(positions.gross)),
            FigureCellModel(
                label: "YTD withheld", cents: totals.taxWithheldCents,
                variance: VarianceNote(cents: positions.taxWithheld.varianceCents),
                note: coverageNote(positions.taxWithheld)),
            FigureCellModel(
                label: "YTD super", cents: totals.superCents + totals.salarySacrificeCents,
                variance: VarianceNote(cents: positions.super.varianceCents),
                note: coverageNote(positions.super)),
        ]
    }

    /// How much of the year a position speaks for, where it speaks for less than the
    /// figure it sits under. Nil where every slip is covered, and where none is.
    static func coverageNote(_ position: PayslipsOverview.Position) -> String? {
        if position.coveredCount == 0 || position.coveredCount == position.payslipCount {
            return nil
        }
        return "Across \(position.coveredCount) of \(position.payslipCount) slips"
    }

    /// The gap between the year-to-date gross printed on the latest slip and the gross
    /// summed from the slips entered; nil when the two agree or no slip reports one.
    static func reportedNote(_ overview: PayslipsOverview.Member) -> String? {
        guard let reported = overview.reported else { return nil }
        let gap = reported.grossCents - overview.totals.grossCents
        if gap == 0 { return nil }
        return
            "The latest slip reports \(MoneyFormat.cents(Int(reported.grossCents))) gross year to date, \(MoneyFormat.cents(Int(abs(gap)))) \(gap > 0 ? "more than" : "less than") the slips entered here."
    }

    // MARK: Cards

    static func card(
        _ payslip: Payslip, variance: PayslipVariance, inflowNames: [String: String],
        creditMatch: NetPay.CreditMatch? = nil
    ) -> PayslipCardModel {
        PayslipCardModel(
            payslip: payslip, period: periodLabel(payslip),
            paid: payslip.paidOn.map { "Paid \(date($0))" }, pill: pill(variance),
            detail: detail(
                payslip, variance: variance, inflowNames: inflowNames, creditMatch: creditMatch))
    }

    /// A payslip's inclusive pay period as a short date range.
    static func periodLabel(_ payslip: Payslip) -> String {
        "\(date(payslip.periodStart)) – \(date(payslip.periodEnd))"
    }

    /// What a null gross variance on this slip means.
    static func grossNullNote(_ variance: PayslipVariance) -> String {
        variance.grossPartlyUnmeasured ? "Not measured this period" : VarianceNote.noProjection
    }

    /// The variance a collapsed card leads with: the largest of the slip's three by
    /// size. Gross wins a tie.
    static func headline(_ variance: PayslipVariance) -> (label: String, cents: Int64?) {
        func size(_ cents: Int64?) -> Int64 { abs(cents ?? 0) }
        let figures: [(label: String, cents: Int64?)] = [
            ("Gross", variance.grossVarianceCents),
            ("Tax withheld", variance.taxWithheldVarianceCents),
            ("Super", variance.superVarianceCents),
        ]
        return figures.dropFirst().reduce(figures[0]) { leader, figure in
            size(figure.cents) > size(leader.cents) ? figure : leader
        }
    }

    static func pill(_ variance: PayslipVariance) -> VariancePillModel {
        let (label, cents) = headline(variance)
        let prefix = label == "Gross" ? "" : "\(label) "
        switch cents {
        case nil: return VariancePillModel(text: prefix + grossNullNote(variance), tone: .neutral)
        case 0?: return VariancePillModel(text: prefix + "On plan", tone: .neutral)
        case let value?:
            let size = MoneyFormat.cents(Int(abs(value)))
            return VariancePillModel(
                text: "\(prefix)\(size) \(value > 0 ? "above" : "below")",
                tone: value > 0 ? .positive : .negative)
        }
    }

    static let partCycleNotes: [PartCycleReason: String] = [
        .partPeriod:
            "This period is only part of a turn of the pay cycle its earnings are drawn on, so the plan figures are that share of a whole pay period.",
        .inflowDates:
            "This period is a whole turn of the pay cycle, but the projection behind it changed partway through — usually a pay rise, entered as the old rate ending and the new one starting — so each rate’s plan figures are exactly its share, and the shares add up to a whole pay period.",
    ]

    static func taxComponentLabel(_ component: PayslipTaxComponent) -> String {
        switch component {
        case .payg: "PAYG income tax"
        case .stsl: "STSL (study loan)"
        }
    }

    static func detail(
        _ payslip: Payslip, variance: PayslipVariance, inflowNames: [String: String],
        creditMatch: NetPay.CreditMatch? = nil
    ) -> PayslipDetailModel {
        let figures = [
            FigureCellModel(
                label: "Gross", cents: Int64(payslip.grossCents),
                variance: VarianceNote(
                    cents: variance.grossVarianceCents, nullNote: grossNullNote(variance))),
            FigureCellModel(
                label: "Tax withheld", cents: Int64(payslip.taxWithheldCents),
                variance: VarianceNote(cents: variance.taxWithheldVarianceCents)),
            FigureCellModel(
                label: "Super", cents: variance.actualSuperCents,
                variance: VarianceNote(cents: variance.superVarianceCents)),
            FigureCellModel(label: "Net", cents: Int64(payslip.netCents)),
        ]
        let earnings = variance.lineGroups.map { group in
            let unmeasured = group.basis == .occasional || group.basis == .oneOff
            return BreakdownRowModel(
                id: group.sourceInflowId ?? "unmapped",
                title: group.sourceInflowId.flatMap { inflowNames[$0] } ?? "Not mapped to an inflow",
                caption: group.labels.joined(separator: ", "), actualCents: group.actualCents,
                variance: VarianceNote(
                    cents: group.varianceCents,
                    nullNote: unmeasured ? "Not measured per period" : VarianceNote.noProjection))
        }
        let tax = variance.taxGroups.map { group in
            BreakdownRowModel(
                id: group.component.rawValue, title: taxComponentLabel(group.component),
                caption: group.labels.joined(separator: ", "), actualCents: group.actualCents,
                variance: VarianceNote(cents: group.varianceCents))
        }
        return PayslipDetailModel(
            figures: figures, creditNote: creditMatch.map(creditNote), earnings: earnings,
            earningsNote: unallocatedNote(
                variance.unallocatedCents, over: "of the gross is not itemised.",
                under: "more than the gross is itemised."),
            tax: tax,
            taxNote: unallocatedNote(
                variance.unallocatedTaxCents, over: "of the tax withheld is not itemised.",
                under: "more than the tax withheld is itemised."),
            unmeasuredGrossNote: variance.grossPartlyUnmeasured
                ? "\(MoneyFormat.cents(Int(variance.unmeasuredGrossCents))) of the gross is pay that no pay period expects — an allowance landing in only some of them, or a one-off landing on a day of its own — so the gross is not measured against the plan here; its year-to-date position is above the list. Tax withheld still expects the year’s liability spread evenly, so a period carrying this pay withholds more than that."
                : nil,
            partCycleNote: variance.partCycleReason.flatMap { partCycleNotes[$0] },
            note: payslip.note, documentPath: payslip.filePath)
    }

    // MARK: Net pay

    /// How a slip's net stands against the credit that carried it, as the PWA's
    /// `PayslipCreditNote`.
    static func creditNote(_ match: NetPay.CreditMatch) -> CreditNoteModel {
        guard match.status != .missing, let postedOn = match.postedOn,
            let amount = match.amountCents
        else { return .missing }
        let net = match.status == .matched
            ? nil : match.netDifferenceCents.map { DifferenceModel(cents: $0, against: "the slip’s net") }
        let plan = match.modelledDifferenceCents.flatMap {
            $0 == 0 ? nil : DifferenceModel(cents: $0, against: "the plan’s net")
        }
        return .landed(
            landed: "Landed in Up \(date(postedOn)): \(MoneyFormat.cents(Int(amount)))", net: net,
            plan: plan)
    }

    /// A member's salary credits over the year, as the PWA's `MemberNetPayBlock`; nil
    /// for a member with none.
    static func netPay(_ netPay: NetPay.Member) -> MemberNetPayModel? {
        if netPay.credits.isEmpty { return nil }
        let count = netPay.credits.count
        var qualifiers = ""
        if netPay.payslipCount > 0 {
            qualifiers += " · \(netPay.matchedCount) of \(netPay.payslipCount) slips matched"
        }
        if let cadence = netPay.cadenceDays { qualifiers += " · paid every \(cadence) days" }
        return MemberNetPayModel(
            receivedCents: netPay.receivedCents,
            count: count == 1 ? "across 1 credit" : "across \(count) credits",
            qualifiers: qualifiers,
            credits: netPay.credits.map { credit in
                NetPayCreditModel(
                    id: credit.id, date: date(credit.postedOn), payer: credit.payer,
                    amountCents: credit.amountCents, noPayslip: credit.payslipId == nil,
                    cadenceNote: credit.cadenceDrift
                        ? "\(credit.daysSincePrevious.map(String.init) ?? "") days after the previous pay; paid every \(netPay.cadenceDays.map(String.init) ?? "")"
                        : nil,
                    amountDrift: credit.amountDrift
                        ? credit.previousDifferenceCents.map {
                            DifferenceModel(cents: $0, against: "the previous pay")
                        }
                        : nil)
            })
    }

    /// Joint-account salary from payers no slip matched; nil for none.
    static func unattributedNote(_ credits: [NetPay.Candidate]) -> String? {
        if credits.isEmpty { return nil }
        var seen = Set<String>()
        let payers = credits.map { $0.payer.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { seen.insert($0).inserted }
        let count = credits.count == 1 ? "1 salary credit" : "\(credits.count) salary credits"
        return
            "\(count) from \(payers.joined(separator: ", ")) landed in a joint account this year. Add a payslip they carry to link them to whoever was paid."
    }

    private static func unallocatedNote(_ cents: Int64, over: String, under: String) -> String? {
        cents == 0 ? nil : "\(MoneyFormat.cents(Int(abs(cents)))) \(cents > 0 ? over : under)"
    }

    // MARK: Dates

    /// An ISO date (`YYYY-MM-DD`) as a short date (`28 Feb 2027`), as the PWA's `formatIsoDate`.
    static func date(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return iso }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        else { return iso }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "d MMM yyyy"
        return formatter.string(from: date)
    }

    /// The AU financial year (ending-year label) a payslip is filed under: the year its
    /// attribution date falls in, the date the pay landed or, where the slip states none,
    /// the pay period's last day.
    static func financialYear(paidOn: String?, periodEnd: String) -> Int {
        let iso = paidOn ?? periodEnd
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return 0 }
        return parts[0] + (parts[1] >= 7 ? 1 : 0)
    }
}
