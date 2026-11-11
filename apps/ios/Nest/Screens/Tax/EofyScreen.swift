import SwiftUI

/// The native EOFY route: a per-member filing-prep rollup of a financial year's tax
/// estimate and withholding position, deductions, super contributions and HELP debt,
/// the household's year with the Medicare levy surcharge test, and the tax-agent
/// share link. Nothing here is editable beyond the share.
struct EofyScreen: View {
    @State private var model: TaxViewModel

    init(model: TaxViewModel = TaxViewModel(mode: .eofy)) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            EofyContentView(content: content, model: model)
        }
        .task(id: model.financialYear) { await model.load() }
    }
}

struct EofyContentView: View {
    let content: TaxContent
    let model: TaxViewModel

    var body: some View {
        TaxPage(
            title: "EOFY summary (FY\(content.financialYear))",
            intro:
                "Each member’s tax estimate — net of the tax their payslips actually withheld — plus their deductions, super contributions, and HELP debt for the selected financial year, gathered in one place for tax-return prep."
        ) {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                EofyShareControl(content: content, model: model)
                header
                HouseholdYearSummary(content: content)
                if content.rows.members.isEmpty {
                    Text("No household members yet.").font(.system(size: 14))
                        .foregroundStyle(NestColor.dimmedText)
                        .frame(maxWidth: .infinity).padding(NestSpacing.xl)
                } else {
                    ForEach(content.rows.members) { member in
                        EofyMemberCard(content: content, model: model, member: member)
                    }
                }
                TaxCaption(
                    "Capital gains are counted only for the share and ETF trades recorded on the Investments tab and the equity sales recorded on the Equity tab."
                )
            }
        }
    }

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom) {
                select
                Spacer()
                links
            }
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                select
                links
            }
        }
    }

    private var select: some View {
        FinancialYearSelect(
            financialYear: model.financialYear,
            availableFinancialYears: content.figures.availableFinancialYears
        ) { model.financialYear = $0 }
    }

    private var links: some View {
        HStack(spacing: NestSpacing.md) {
            ForEach(
                [
                    ("Tax", Route.tax), ("Payslips", .payslips), ("Deductions", .deductions),
                    ("Super", .superannuation), ("HELP debt", .helpDebt),
                ], id: \.1
            ) { title, route in
                NavigationLink(value: route) {
                    Text(title).font(.system(size: 14)).foregroundStyle(NestColor.brand)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Creates, shows and revokes the household's single live EOFY share link. The
/// plaintext link is never stored server-side, so it is shown once, right after it
/// is created; a later visit shows the share as active with no link to copy.
struct EofyShareControl: View {
    let content: TaxContent
    let model: TaxViewModel

    @State private var formYear: Int
    @State private var email = ""
    @State private var busy = false
    @State private var justCreated: CreatedShare?
    @State private var failure: String?
    @State private var copied = false

    init(content: TaxContent, model: TaxViewModel) {
        self.content = content
        self.model = model
        _formYear = State(initialValue: content.financialYear)
    }

    private var status: ShareGrant? { content.rows.shareGrants.first }
    private var isActive: Bool { status != nil || justCreated != nil }
    private var expiresAt: String? { status?.expiresAt ?? justCreated?.expiresAt }
    private var shareURL: String? {
        justCreated.map { "\(WebApp.url.absoluteString)/share/eofy/\($0.token)" }
    }

    var body: some View {
        TaxCard(padding: NestSpacing.lg) {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                TaxSubtitle(text: "Share with your tax agent", size: 16)
                if isActive { active } else { create }
                if let failure { TaxAlert(text: failure) }
            }
        }
    }

    private var active: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            if let expiresAt {
                Text("Active — \(TaxPresentation.expiryLabel(expiresAt: expiresAt, now: Date()))")
                    .font(.system(size: 14)).foregroundStyle(NestColor.text)
            }
            if let status {
                Text(
                    "Shared with \(status.recipientEmail) for FY\(status.financialYear). These are estimates for planning purposes, not a filed tax return."
                )
                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            }
            if let shareURL {
                HStack(spacing: NestSpacing.xs) {
                    Text(shareURL).font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(NestColor.text).textSelection(.enabled)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(
                            NestColor.surfaceRaised,
                            in: RoundedRectangle(cornerRadius: NestRadius.xs))
                    Button(copied ? "Copied" : "Copy link") {
                        copyToPasteboard(shareURL)
                        copied = true
                    }
                    .buttonStyle(NestLightButtonStyle(small: true))
                }
            }
            Button("Revoke") { Task { await revoke() } }
                .buttonStyle(NestSubtleDangerButtonStyle())
                .disabled(busy)
                .padding(.leading, -NestSpacing.sm)
        }
    }

    private var create: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(
                "Send a read-only, 7-day link to a tax agent with this financial year's EOFY summary. Creating a new share replaces any share already active."
            )
            .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom, spacing: NestSpacing.xs) {
                    emailField
                    year
                }
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    emailField
                    year
                }
            }
            Button {
                Task { await send() }
            } label: {
                if busy { ProgressView().controlSize(.small) } else { Text("Send") }
            }
            .buttonStyle(NestLightButtonStyle())
            .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            .opacity(email.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
        }
    }

    private var emailField: some View {
        TaxField(label: "Tax agent's email") {
            TextField("agent@example.com", text: $email)
                .textFieldStyle(NestTextFieldStyle())
                .autocorrectionDisabled()
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                #endif
        }
        .frame(minWidth: 200)
    }

    private var year: some View {
        FinancialYearSelect(
            financialYear: formYear,
            availableFinancialYears: content.figures.availableFinancialYears
        ) { formYear = $0 }
    }

    private func send() async {
        busy = true
        failure = nil
        defer { busy = false }
        do {
            justCreated = try await model.createShare(
                financialYear: formYear,
                recipientEmail: email.trimmingCharacters(in: .whitespaces))
            email = ""
            copied = false
        } catch {
            failure = ((NestError.from(error) as? NestError) ?? NestError(.unknown)).userMessage
        }
    }

    private func revoke() async {
        busy = true
        failure = nil
        defer { busy = false }
        do {
            try await model.revokeShare()
            justCreated = nil
        } catch {
            failure = ((NestError.from(error) as? NestError) ?? NestError(.unknown)).userMessage
        }
    }
}

/// The household for the selected year: combined figures with a per-member table,
/// then the Medicare levy surcharge family-income test.
struct HouseholdYearSummary: View {
    let content: TaxContent
    @State private var dependentChildren = 0
    @State private var summary: HouseholdYearFigures?

    var body: some View {
        TaxCard(padding: NestSpacing.lg) {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                TaxSubtitle(text: "Household (FY\(content.financialYear))", size: 18)
                if let summary {
                    figures(summary)
                    membersTable(summary)
                    mlsTest(summary.mls)
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Household")
        .task(id: dependentChildren) {
            summary = try? await content.engine.household(
                DependentChildrenInput(rows: content.input, dependentChildren: dependentChildren))
        }
    }

    private func figures(_ summary: HouseholdYearFigures) -> some View {
        VStack(spacing: 4) {
            FigureLine(label: "Gross income", cents: summary.grossIncomeCents)
            if summary.netCapitalGainCents > 0 {
                FigureLine(label: "of which net capital gain", cents: summary.netCapitalGainCents)
            }
            FigureLine(label: "Deductions", cents: summary.deductionsCents)
            FigureLine(label: "Concessional super", cents: summary.concessionalSuperCents)
            FigureLine(label: "Taxable income", cents: summary.taxableIncomeCents, bold: 600)
            FigureLine(label: "Total tax", cents: summary.taxCents)
            FigureLine(label: "Net take-home", cents: summary.afterTaxCents, bold: 700)
        }
    }

    private func membersTable(_ summary: HouseholdYearFigures) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(spacing: 0) {
                row(
                    ["Member", "Gross", "Taxable", "Tax", "Super"], header: true)
                ForEach(summary.members, id: \.memberId) { member in
                    row(
                        [
                            content.rows.members.first { $0.id == member.memberId }?.name
                                ?? "Member",
                            MoneyFormat.cents(member.grossIncomeCents),
                            MoneyFormat.cents(member.taxableIncomeCents),
                            MoneyFormat.cents(member.taxCents),
                            MoneyFormat.cents(member.concessionalSuperCents),
                        ], header: false)
                }
            }
            .frame(minWidth: 420)
        }
        .accessibilityLabel("Household members")
    }

    private func row(_ cells: [String], header: Bool) -> some View {
        HStack {
            ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
                Text(cell).monospacedDigit()
                    .fontWeight(header ? .semibold : .regular)
                    .foregroundStyle(header ? NestColor.dimmedText : NestColor.text)
                    .frame(maxWidth: .infinity, alignment: index == 0 ? .leading : .trailing)
            }
        }
        .font(.system(size: 13)).padding(.vertical, 6)
    }

    private func mlsTest(_ mls: MlsTestFigures) -> some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            TaxSubtitle(text: "Medicare levy surcharge test")
            CountField(label: "Dependent children", value: $dependentChildren)
                .frame(width: 160)
            FigureLine(label: "Family income for MLS", cents: mls.familyIncomeCents, bold: 600)
            Text(TaxPresentation.mlsVerdict(mls)).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.text)
            if mls.liable { FigureLine(label: "Surcharge", cents: mls.totalSurchargeCents) }
            Text(TaxPresentation.mlsNext(mls)).font(.system(size: 14))
                .foregroundStyle(NestColor.dimmedText)
            TaxCaption(
                "Family income is taxable income plus reportable super contributions; reportable fringe benefits and net investment losses are not recorded."
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Medicare levy surcharge test")
    }
}

/// One member's filing-prep summary for the year.
private struct EofyMemberCard: View {
    let content: TaxContent
    let model: TaxViewModel
    let member: Member

    private var estimate: TaxMemberFigures? {
        content.figures.estimate.members.first { $0.memberId == member.id }
    }
    private var extras: TaxMemberExtras? {
        content.figures.memberExtras.first { $0.memberId == member.id }
    }

    var body: some View {
        TaxCard {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text(member.name).font(.system(size: 18, weight: .bold))
                    .foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                section("Tax estimate") { taxSummary }
                section("Deductions") { deductions }
                section("Super contributions") { superSummary }
                section("HELP debt") { helpSummary }
                let documents = content.rows.payslips.filter {
                    $0.memberId == member.id && $0.filePath != nil
                }
                section("Payslip documents") { payslipDocuments(documents) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(member.name)
    }

    private func section<Body: View>(_ title: String, @ViewBuilder body: () -> Body) -> some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            TaxSubtitle(text: title)
            body()
        }
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
    }

    @ViewBuilder private var taxSummary: some View {
        if let estimate {
            let breakdown = estimate.breakdown
            VStack(alignment: .leading, spacing: 4) {
                FigureLine(label: "Taxable income", cents: breakdown.taxableIncomeCents, bold: 600)
                if estimate.annualNetCapitalGainCents > 0 {
                    FigureLine(label: "Net capital gain", cents: estimate.annualNetCapitalGainCents)
                }
                FigureLine(
                    label: "Income tax",
                    cents: max(0, breakdown.incomeTaxCents - breakdown.litoOffsetCents))
                FigureLine(label: "Medicare levy", cents: breakdown.medicareLevyCents)
                if breakdown.medicareLevySurchargeCents > 0 {
                    FigureLine(
                        label: "Medicare levy surcharge", cents: breakdown.medicareLevySurchargeCents)
                }
                FigureLine(label: "HELP repayment", cents: breakdown.helpRepaymentCents)
                if breakdown.division293Cents > 0 {
                    FigureLine(label: "Division 293 tax", cents: breakdown.division293Cents)
                }
                FigureLine(label: "Total tax liability", cents: breakdown.totalLiabilityCents, bold: 700)
                FigureLine(
                    label: "Net take-home", cents: estimate.annualAfterTaxCents, bold: 700,
                    colouring: true)
                let count = extras?.payslipCount ?? 0
                if count == 0 {
                    TaxCaption(
                        "No payslips recorded for FY\(content.financialYear), so no withholding is netted against this liability.",
                        italic: true)
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        WithholdingPosition(breakdown: breakdown)
                        TaxCaption(TaxPresentation.payslipCount(count))
                    }
                }
            }
        } else {
            empty("No income to estimate yet.")
        }
    }

    @ViewBuilder private var deductions: some View {
        let mine = content.rows.deductions.filter { $0.memberId == member.id }
        let groups = content.rows.deductionGroups.filter { $0.memberId == member.id }
        if mine.isEmpty && groups.isEmpty {
            empty("No deductions claimed.")
        } else {
            let grouped = TaxPresentation.groupDeductions(groups: groups, deductions: mine)
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                FigureLine(
                    label: "Total deductions claimed", cents: mine.reduce(0) { $0 + $1.amountCents },
                    bold: 600)
                ForEach(grouped.groups) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        FigureLine(label: entry.group.name, cents: entry.totalCents, bold: 600)
                        if entry.payments.isEmpty {
                            TaxCaption("No payments", italic: true)
                        } else {
                            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                                ForEach(entry.payments) { DeductionItem(content: content, model: model, deduction: $0) }
                            }
                            .padding(.leading, NestSpacing.sm)
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(entry.group.name)
                }
                ForEach(grouped.ungrouped) { DeductionItem(content: content, model: model, deduction: $0) }
            }
        }
    }

    @ViewBuilder private var superSummary: some View {
        if let cap = extras?.capSummary, cap.concessionalCents != 0 || cap.nonConcessionalCents != 0 {
            SuperCapsSummary(summary: cap)
        } else {
            empty("No super contributions recorded.")
        }
    }

    @ViewBuilder private var helpSummary: some View {
        let balance = content.rows.helpDebts.first { $0.memberId == member.id }?.balanceCents ?? 0
        if balance == 0 {
            empty("No HELP/HECS debt on file.")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                FigureLine(label: "Standing HELP balance", cents: balance, bold: 600)
                FigureLine(
                    label: "Estimated FY\(content.financialYear) repayment",
                    cents: estimate?.breakdown.helpRepaymentCents ?? 0)
                if let payoff = extras?.helpPayoff { TaxCaption(payoff.summary) }
            }
        }
    }

    @ViewBuilder private func payslipDocuments(_ documents: [Payslip]) -> some View {
        if documents.isEmpty {
            empty("No payslip documents attached.")
        } else {
            HStack(spacing: NestSpacing.xs) {
                ForEach(documents) { payslip in
                    DocumentLink(
                        title: payslip.paidOn.map(TaxPresentation.isoDate) ?? "Payslip", model: model,
                        bucket: "payslips", path: payslip.filePath ?? "")
                }
            }
        }
    }
}

/// One claimed deduction: description, date and receipt link beside the amount and its workings.
private struct DeductionItem: View {
    let content: TaxContent
    let model: TaxViewModel
    let deduction: Deduction

    var body: some View {
        let receipt = content.rows.deductionReceipts.first { $0.deductionId == deduction.id }
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            VStack(alignment: .leading, spacing: 2) {
                Text(deduction.description).font(.system(size: 14)).foregroundStyle(NestColor.text)
                HStack(spacing: NestSpacing.xs) {
                    TaxCaption(TaxPresentation.isoDate(deduction.deductionDate))
                    if deduction.basis != .hours {
                        if let receipt {
                            DocumentLink(
                                title: "Receipt", model: model, bucket: "receipts",
                                path: receipt.storagePath, small: true)
                        } else {
                            TaxCaption("No receipt", italic: true)
                        }
                    }
                }
            }
            Spacer(minLength: NestSpacing.xs)
            VStack(alignment: .trailing, spacing: 0) {
                MoneyText(cents: deduction.amountCents, colouring: false)
                    .font(.system(size: 14, weight: .semibold))
                if let workings = TaxPresentation.claimWorkings(
                    deduction, rates: content.figures.deductionRates)
                {
                    TaxCaption(workings).multilineTextAlignment(.trailing)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// A link that signs a short-lived Storage URL and opens it.
private struct DocumentLink: View {
    let title: String
    let model: TaxViewModel
    let bucket: String
    let path: String
    var small = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button(title) {
            Task { if let url = await model.signedURL(bucket: bucket, path: path) { openURL(url) } }
        }
        .buttonStyle(.plain)
        .font(.system(size: small ? 12 : 12))
        .foregroundStyle(NestColor.brand)
    }
}

/// A member's contribution-cap status: concessional and non-concessional usage
/// against their caps and the estimated government co-contribution.
struct SuperCapsSummary: View {
    let summary: SuperCapFigures

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            capLine("Concessional", summary.concessionalCents, summary.concessionalCapCents)
            TaxCaption("Cap includes carry-forward from prior years.")
            if summary.concessionalOverCap {
                TaxAlert(
                    text:
                        "Over the concessional cap (\(MoneyFormat.cents(summary.concessionalCapCents))). Excess is taxed at your marginal rate."
                )
            }
            capLine(
                "Non-concessional", summary.nonConcessionalCents, summary.nonConcessionalCapCents)
            TaxCaption("Bring-forward may allow up to 3× the cap.")
            if summary.nonConcessionalOverCap {
                TaxAlert(
                    text:
                        "Over the non-concessional cap (\(MoneyFormat.cents(summary.nonConcessionalCapCents))) — unless bring-forward applies."
                )
            }
            if summary.coContributionCents > 0 {
                TaxAlert(
                    text:
                        "Estimated government co-contribution \(MoneyFormat.cents(summary.coContributionCents)), added to super.",
                    tone: .positive)
            }
        }
    }

    private func capLine(_ label: String, _ used: Int, _ cap: Int) -> some View {
        (Text("\(label): ") + Text(MoneyFormat.cents(used)).fontWeight(.semibold).foregroundColor(
            NestColor.text) + Text(" of \(MoneyFormat.cents(cap)) used"))
            .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
    }
}
