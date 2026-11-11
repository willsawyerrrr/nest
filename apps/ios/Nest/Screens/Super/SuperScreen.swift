import SwiftUI

/// The native Super route: each member's profile, contribution caps and
/// contributions, then the retirement projection. Editing stays in the web app.
struct SuperScreen: View {
    @State private var model: SuperViewModel

    init(model: SuperViewModel = SuperViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            if let assumptions = model.effectiveAssumptions {
                SuperContentView(
                    presentation: SuperPresentation(
                        content: content, projections: model.projections,
                        assumptions: assumptions, ages: model.ages),
                    model: model)
            }
        }
        .task { await model.load() }
    }
}

struct SuperContentView: View {
    let presentation: SuperPresentation
    let model: SuperViewModel

    var body: some View {
        NestPageSection(title: presentation.title, intro: SuperPresentation.intro) {
            ForEach(presentation.sections) { section in
                MemberBlock(section: section)
            }
            WebHandoffCard(
                title: "Edit super",
                message: "Editing profiles and contributions happens in the web app.",
                action: "Open Super on the web", path: Route.superannuation.path)
            RetirementBlock(presentation: presentation, model: model)
        }
    }
}

private struct MemberBlock: View {
    let section: SuperMemberSection

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            ProfileRow(row: section.profile)
            if let caps = section.caps { CapsBlock(caps: caps) }
            Text("Contributions").font(.system(size: 15, weight: .semibold))
                .foregroundStyle(NestColor.text).accessibilityAddTraits(.isHeader)
            if section.contributions.isEmpty {
                NestEmptyState(text: "No contributions yet.")
            }
            ForEach(section.contributions) { ContributionRowView(row: $0) }
        }
    }
}

private struct ProfileRow: View {
    let row: SuperProfileRow

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                HStack(spacing: NestSpacing.sm) {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: NestSpacing.xs) {
                            Text(row.memberName).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(NestColor.text).lineLimit(1)
                            NestPill(
                                text: row.isEstimated ? "Estimated" : "Current",
                                tone: row.isEstimated ? .info : .neutral)
                        }
                        if let fund = row.fundName {
                            Text(fund).font(NestFont.caption)
                                .foregroundStyle(NestColor.dimmedText).lineLimit(1)
                        } else {
                            Text("No fund set").font(NestFont.caption).italic()
                                .foregroundStyle(NestColor.dimmedText)
                        }
                    }
                    Spacer(minLength: NestSpacing.sm)
                    MoneyText(cents: row.effectiveCents, colouring: false)
                        .font(.system(size: 14, weight: .bold))
                }
                if let caption = row.caption {
                    Text(caption).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct CapsBlock: View {
    let caps: SuperCapsRow

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(caps.lines, id: \.label) { line in
                VStack(alignment: .leading, spacing: 0) {
                    (Text("\(line.label): ")
                        + Text(MoneyFormat.cents(line.usedCents)).fontWeight(.semibold)
                        .foregroundColor(NestColor.text)
                        + Text(" of \(MoneyFormat.cents(line.capCents)) used"))
                        .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    Text(line.note).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    if let warning = line.warning {
                        Callout(tone: .negative, text: warning).padding(.top, 4)
                    }
                }
            }
            if let note = caps.coContribution { Callout(tone: .positive, text: note) }
        }
    }
}

private struct ContributionRowView: View {
    let row: SuperContributionRow

    var body: some View {
        NestCard(padding: NestSpacing.xs) {
            HStack(spacing: NestSpacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.kind).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    HStack(spacing: 6) {
                        NestPill(text: row.frequency)
                        if row.isFHSS { NestPill(text: "FHSS", tone: .positive) }
                        if let contributor = row.contributor {
                            Text(contributor).font(NestFont.caption)
                                .foregroundStyle(NestColor.dimmedText)
                        }
                    }
                }
                Spacer(minLength: NestSpacing.sm)
                Text(row.value).font(.system(size: 14, weight: .bold)).monospacedDigit()
                    .foregroundStyle(NestColor.text)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct RetirementBlock: View {
    let presentation: SuperPresentation
    let model: SuperViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text("Retirement projection").font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.text).accessibilityAddTraits(.isHeader)
            Text(SuperPresentation.projectionNote).font(NestFont.caption)
                .foregroundStyle(NestColor.dimmedText)
            AssumptionsCard(assumptions: presentation.assumptions, model: model)
            ForEach(presentation.sections) { section in
                ProjectionCard(
                    section: section, age: presentation.ages[section.id], model: model)
            }
        }
    }
}

private struct AssumptionsCard: View {
    let assumptions: RetirementAssumptions
    let model: SuperViewModel

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                HStack(spacing: NestSpacing.xs) {
                    Circle().fill(NestColor.brand).frame(width: 8, height: 8)
                    Text("Assumptions").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text)
                }
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 130), spacing: NestSpacing.xs)],
                    spacing: NestSpacing.xs
                ) {
                    field("Retirement age", \.retirementAge, "")
                    field("Expected return", \.expectedReturnPct, "%")
                    field("Inflation", \.inflationPct, "%")
                    field("Contribution growth", \.contributionGrowthPct, "%")
                }
            }
        }
        .overlay(alignment: .leading) {
            Rectangle().fill(NestColor.brand).frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }

    private func field(
        _ label: String, _ keyPath: WritableKeyPath<RetirementAssumptions, Double>, _ suffix: String
    ) -> some View {
        NumberField(label: label, value: assumptions[keyPath: keyPath], suffix: suffix) { value in
            Task { await model.setAssumption(keyPath, to: value) }
        }
    }
}

/// A labelled compact numeric field; an empty field reports `nil`.
private struct NumberField: View {
    let label: String
    let value: Double?
    var suffix = ""
    let onChange: (Double?) -> Void
    @State private var text: String

    init(label: String, value: Double?, suffix: String = "", onChange: @escaping (Double?) -> Void) {
        self.label = label
        self.value = value
        self.suffix = suffix
        self.onChange = onChange
        _text = State(initialValue: value.map(Self.format) ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(NestColor.text)
            HStack(spacing: 2) {
                TextField("", text: $text)
                    #if os(iOS)
                        .keyboardType(.decimalPad)
                    #endif
                    .onChange(of: text) { _, new in
                        let parsed = Double(new.trimmingCharacters(in: .whitespaces))
                        if new.isEmpty || parsed != nil { onChange(parsed) }
                    }
                if !suffix.isEmpty { Text(suffix).foregroundStyle(NestColor.dimmedText) }
            }
            .textFieldStyle(.plain)
            .font(.system(size: 14)).foregroundStyle(NestColor.text)
            .padding(.horizontal, NestSpacing.xs).padding(.vertical, 6)
            .background(
                NestColor.surfaceRaised,
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
        }
    }

    private static func format(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}

private struct Figure: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).font(.system(size: 12)).tracking(0.48)
                .foregroundStyle(NestColor.dimmedText)
            Text(value).font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
        }
    }
}

private struct ProjectionCard: View {
    let section: SuperMemberSection
    let age: Double?
    let model: SuperViewModel

    var body: some View {
        let card = section.projection
        NestCard(padding: NestSpacing.md) {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                HStack(alignment: .bottom, spacing: NestSpacing.sm) {
                    Text(section.name).font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(NestColor.text)
                    Spacer()
                    NumberField(label: "Current age", value: age) { value in
                        Task { await model.setAge(value, for: section.id) }
                    }
                    .frame(width: 110)
                    .accessibilityLabel("\(section.name) current age")
                }
                if let projection = card.projection {
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("PROJECTED AT RETIREMENT").font(.system(size: 12)).tracking(0.48)
                                .foregroundStyle(NestColor.dimmedText)
                            MoneyText(cents: Int(projection.realCents), colouring: false)
                                .font(.system(size: 30, weight: .bold, design: .rounded))
                            Text("in today’s dollars").font(.system(size: 14))
                                .foregroundStyle(NestColor.dimmedText)
                        }
                        Spacer()
                        Figure(label: "Nominal", value: MoneyFormat.cents(Int(projection.nominalCents)))
                    }
                    GrowthBar(card: card, name: section.name)
                    HStack(alignment: .top) {
                        Figure(label: "Years to retirement", value: String(projection.yearsToRetirement))
                        Spacer()
                        Figure(
                            label: "Est. net contribution",
                            value: MoneyFormat.perYear(card.netAnnualContributionCents))
                    }
                } else {
                    Text("Enter \(section.name)’s current age to project their balance at retirement.")
                        .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                }
            }
        }
    }
}

private struct GrowthBar: View {
    let card: SuperProjectionCard
    let name: String

    var body: some View {
        VStack(spacing: 6) {
            GeometryReader { proxy in
                HStack(spacing: 0) {
                    Rectangle().fill(NestColor.brand)
                        .frame(width: proxy.size.width * Double(card.currentPct) / 100)
                    Rectangle().fill(NestColor.positive)
                        .frame(width: proxy.size.width * Double(card.growthPct) / 100)
                    Spacer(minLength: 0)
                }
                .background(NestColor.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            }
            .frame(height: 18)
            .accessibilityElement()
            .accessibilityLabel("\(name) balance growth")
            .accessibilityValue("\(card.currentPct)% current, \(card.growthPct)% growth")
            HStack {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Now").font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    MoneyText(cents: card.currentBalanceCents, colouring: false)
                        .font(.system(size: 14, weight: .semibold))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text("At \(card.retirementAge)").font(NestFont.caption)
                        .foregroundStyle(NestColor.dimmedText)
                    MoneyText(cents: Int(card.projection?.nominalCents ?? 0), colouring: false)
                        .font(.system(size: 14, weight: .semibold))
                }
            }
        }
    }
}
