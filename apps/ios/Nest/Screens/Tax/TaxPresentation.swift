import Foundation

/// One line of a member's income or tax build-up, mirroring `TaxBreakdownTable`.
struct BreakdownLine: Equatable, Identifiable, Sendable {
    let label: String
    let annualCents: Int
    /// Reduces the running figure: rendered as a negative.
    var subtract = false
    /// A core line shown even at zero.
    var alwaysShow = false
    /// The built-up subtotal or total, emphasised.
    var total = false
    /// An indented sub-line detailing part of the line above.
    var detail = false

    var id: String { label }

    var isVisible: Bool { alwaysShow || total || annualCents > 0 }
    var signedAnnualCents: Int { subtract ? -annualCents : annualCents }
    var fortnightlyCents: Int { TaxPresentation.jsRound(Double(signedAnnualCents) / 26) }
}

/// One step of the gross-to-take-home waterfall, mirroring `taxWaterfallSteps`.
struct WaterfallStep: Equatable, Identifiable, Sendable {
    enum Kind: Sendable { case income, deduction, superannuation, tax, result }

    let key: String
    let label: String
    let kind: Kind
    let amountCents: Int
    let startCents: Int
    let endCents: Int
    let increase: Bool

    var id: String { key }
    var isEndpoint: Bool { kind == .income || kind == .result }
}

/// A deduction group with its payments and their sum.
struct DeductionGroupRows: Equatable, Identifiable, Sendable {
    let group: DeductionGroup
    let payments: [Deduction]
    var totalCents: Int { payments.reduce(0) { $0 + $1.amountCents } }
    var id: String { group.id }
}

/// The Tax estimate and EOFY screens' labels and splits, mirroring the PWA
/// components so both surfaces divide and word the engine's figures identically.
enum TaxPresentation {
    /// `Math.round`: halves round toward positive infinity.
    static func jsRound(_ value: Double) -> Int { Int((value + 0.5).rounded(.down)) }

    /// The whole-percentage split of gross into take-home and tax, or 0/0 when gross is nil.
    static func takeHomeSplit(afterTaxCents: Int, grossCents: Int) -> (takeHomePct: Int, taxPct: Int) {
        guard grossCents > 0 else { return (0, 0) }
        let takeHome = jsRound(Double(afterTaxCents) / Double(grossCents) * 100)
        return (takeHome, 100 - takeHome)
    }

    /// How a member's gross income becomes taxable income.
    static func incomeLines(
        member: TaxMemberFigures, projectedInterestCents: Int
    ) -> [BreakdownLine] {
        [
            .init(label: "Gross income", annualCents: member.annualGrossCents, alwaysShow: true),
            .init(
                label: "Investment income (projected)", annualCents: projectedInterestCents,
                detail: true),
            .init(
                label: "Net capital gain", annualCents: member.annualNetCapitalGainCents,
                detail: true),
            .init(
                label: "Tax-free one-off payments", annualCents: oneOffTaxFreeCents(member),
                subtract: true),
            .init(
                label: "Concessional super",
                annualCents: member.annualConcessionalContributionsCents, subtract: true),
            .init(label: "Deductions", annualCents: member.annualDeductionsCents, subtract: true),
            .init(
                label: "Taxable income", annualCents: member.breakdown.taxableIncomeCents,
                total: true),
        ]
    }

    /// How the member's tax is built up.
    static func taxLines(_ breakdown: TaxBreakdown) -> [BreakdownLine] {
        [
            .init(label: "Income tax", annualCents: breakdown.incomeTaxCents, alwaysShow: true),
            .init(
                label: "Low Income Tax Offset", annualCents: breakdown.litoOffsetCents,
                subtract: true),
            .init(
                label: "Termination payment offset", annualCents: breakdown.oneOffOffsetCents,
                subtract: true),
            .init(label: "Medicare levy", annualCents: breakdown.medicareLevyCents, alwaysShow: true),
            .init(
                label: "Medicare levy surcharge",
                annualCents: breakdown.medicareLevySurchargeCents),
            .init(label: "HELP/HECS repayment", annualCents: breakdown.helpRepaymentCents),
            .init(label: "Division 293 tax", annualCents: breakdown.division293Cents),
            .init(label: "Total tax", annualCents: breakdown.totalLiabilityCents, total: true),
        ]
    }

    /// A one-off's amount excluded from assessable income entirely.
    static func oneOffTaxFreeCents(_ member: TaxMemberFigures) -> Int {
        member.annualOneOffGrossCents - member.employmentTerminationCents
    }

    /// The steps from gross income down to take-home.
    static func waterfallSteps(_ member: TaxMemberFigures) -> [WaterfallStep] {
        let breakdown = member.breakdown
        let gross = member.annualGrossCents
        let netIncomeTax = max(
            0, breakdown.incomeTaxCents - breakdown.litoOffsetCents - breakdown.oneOffOffsetCents)
        var steps: [WaterfallStep] = [
            .init(
                key: "gross", label: "Gross income", kind: .income, amountCents: gross,
                startCents: 0, endCents: gross, increase: false)
        ]
        var running = gross
        func reduce(_ key: String, _ label: String, _ kind: WaterfallStep.Kind, _ amount: Int) {
            guard amount > 0 else { return }
            let end = running
            running -= amount
            steps.append(
                .init(
                    key: key, label: label, kind: kind, amountCents: amount, startCents: running,
                    endCents: end, increase: false))
        }
        reduce("deductions", "Deductions", .deduction, member.annualDeductionsCents)
        reduce(
            "concessional-super", "Concessional super", .superannuation,
            member.annualConcessionalContributionsCents)
        reduce("income-tax", "Income tax", .tax, netIncomeTax)
        reduce("medicare-levy", "Medicare levy", .tax, breakdown.medicareLevyCents)
        reduce(
            "medicare-levy-surcharge", "Medicare levy surcharge", .tax,
            breakdown.medicareLevySurchargeCents)
        reduce("help-repayment", "HELP/HECS repayment", .tax, breakdown.helpRepaymentCents)
        reduce("division-293", "Division 293 tax", .tax, breakdown.division293Cents)
        if member.annualDeductionsCents > 0 {
            let start = running
            running += member.annualDeductionsCents
            steps.append(
                .init(
                    key: "deductions-kept", label: "Deductions kept", kind: .deduction,
                    amountCents: member.annualDeductionsCents, startCents: start,
                    endCents: running, increase: true))
        }
        steps.append(
            .init(
                key: "take-home", label: "Take-home pay", kind: .result,
                amountCents: member.annualAfterTaxCents, startCents: 0,
                endCents: member.annualAfterTaxCents, increase: false))
        return steps
    }

    /// `1.25%`: a fractional rate to at most two decimals, trailing zeros trimmed.
    static func ratePercent(_ rate: Double) -> String {
        let value = Double(String(format: "%.2f", rate * 100)) ?? 0
        return value == value.rounded() ? "\(Int(value))%" : "\(value)%"
    }

    /// The MLS verdict line: liable and at what rate, covered, or under the threshold.
    static func mlsVerdict(_ mls: MlsTestFigures) -> String {
        if mls.liable { return "Liable at \(ratePercent(mls.rate)) (tier \(mls.tier))" }
        if mls.tier > 0 {
            return "Over the tier \(mls.tier) threshold, but every member holds private hospital cover"
        }
        return "Under the family threshold"
    }

    /// The distance to the next MLS threshold, or that the household is at the top tier.
    static func mlsNext(_ mls: MlsTestFigures) -> String {
        guard let next = mls.next else { return "Already at the top tier." }
        return
            "\(MoneyFormat.cents(next.distanceCents)) to the next threshold at \(MoneyFormat.cents(next.floorCents))."
    }

    /// The private-hospital-cover what-if: the surcharge, or that none applies, and
    /// what cover saves or costs against `premiumCents`.
    static func coverLines(_ result: FamilyMlsFigures, premiumCents: Int) -> (
        surcharge: String, saving: String?, savingCents: Int
    ) {
        let saving = result.totalSurchargeCents - premiumCents
        guard result.tierRate != 0 else {
            return ("Below the family MLS threshold — no surcharge applies.", nil, saving)
        }
        let surcharge =
            "Without hospital cover: combined income \(MoneyFormat.cents(result.combinedIncomeForSurchargeCents)) is in the \(ratePercent(result.tierRate)) MLS tier = \(MoneyFormat.cents(result.totalSurchargeCents))/yr surcharge."
        guard premiumCents > 0 else { return (surcharge, nil, saving) }
        let text =
            saving > 0
            ? "Hospital cover saves \(MoneyFormat.cents(saving))/yr over paying the surcharge."
            : "Hospital cover costs \(MoneyFormat.cents(-saving))/yr more than the surcharge."
        return (surcharge, text, saving)
    }

    /// The withholding position's two lines.
    static func withholdingLines(_ breakdown: TaxBreakdown) -> (withheld: String, tracking: String) {
        let withheld =
            "Withheld so far \(MoneyFormat.cents(breakdown.paygWithheldCents)) of \(MoneyFormat.cents(breakdown.totalLiabilityCents)) estimated tax."
        let balance = breakdown.balanceCents
        let tracking =
            balance == 0
            ? "Tracking toward no refund or bill."
            : "Tracking toward a \(MoneyFormat.cents(abs(balance))) \(balance < 0 ? "refund" : "bill")."
        return (withheld, tracking)
    }

    /// Describes when a live share lapses, e.g. "Expires in 3 days".
    static func expiryLabel(expiresAt: String, now: Date) -> String {
        let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        guard
            let expiry = (try? Date(expiresAt, strategy: fractional))
                ?? (try? Date(expiresAt, strategy: Date.ISO8601FormatStyle()))
        else { return "Expires within a day" }
        let days = Int((expiry.timeIntervalSince(now) / 86_400).rounded(.up))
        return days <= 1 ? "Expires within a day" : "Expires in \(days) days"
    }

    /// `28 Feb 2027` from an ISO `YYYY-MM-DD` date.
    static func isoDate(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return iso }
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return "\(parts[2]) \(months[parts[1] - 1]) \(parts[0])"
    }

    /// `88c/km`: whole cents show no decimals; fractional cents up to two, trimmed.
    static func centsRate(_ cents: Double, unit: String) -> String {
        let value = Double(String(format: "%.2f", cents)) ?? cents
        return value == value.rounded() ? "\(Int(value))c/\(unit)" : "\(value)c/\(unit)"
    }

    /// How a deduction's claim was worked out, or `nil` for one claimed in full.
    static func claimWorkings(
        _ deduction: Deduction, rates: TaxScreenFigures.DeductionRates
    ) -> String? {
        if deduction.basis == .distance, let km = deduction.distanceKm {
            return "\(grouped(km)) km at \(centsRate(rates.centsPerKm, unit: "km"))"
        }
        if deduction.basis == .hours, let hours = deduction.workFromHomeHours {
            return "\(grouped(hours)) hours at \(centsRate(rates.centsPerHour, unit: "hr"))"
        }
        if deduction.workUsePercent < 100 {
            return
                "\(MoneyFormat.cents(deduction.fullAmountCents)) at \(grouped(deduction.workUsePercent))%"
        }
        return nil
    }

    private static func grouped(_ value: Double) -> String {
        value.formatted(.number.locale(Locale(identifier: "en_AU")).grouping(.automatic))
    }

    /// A member's deductions split by their groups, then those in none.
    static func groupDeductions(
        groups: [DeductionGroup], deductions: [Deduction]
    ) -> (groups: [DeductionGroupRows], ungrouped: [Deduction]) {
        (
            groups.map { group in
                DeductionGroupRows(
                    group: group, payments: deductions.filter { $0.groupId == group.id })
            },
            deductions.filter { $0.groupId == nil }
        )
    }

    /// Integer cents from typed dollars; anything unreadable or non-positive reads as zero.
    static func cents(fromDollars text: String) -> Int {
        let cleaned = text.filter { $0.isNumber || $0 == "." }
        guard let dollars = Double(cleaned), dollars > 0 else { return 0 }
        return Int((dollars * 100).rounded())
    }

    /// `1 payslip` / `2 payslips`.
    static func payslipCount(_ count: Int) -> String {
        "Withholding summed from \(count) payslip\(count == 1 ? "" : "s")."
    }
}
