import Charts
import SwiftUI

/// "Projected forward": a collapsible card holding the horizon control and the
/// projection chart. Its open state is remembered on the device.
struct ProjectionCard: View {
    @Bindable var model: NetWorthViewModel
    let presentation: NetWorthPresentation
    @AppStorage("net-worth-projection-open") private var isOpen = false
    @State private var selected: String?

    var body: some View {
        VStack(spacing: NestSpacing.xs) {
            NestCard {
                VStack(alignment: .leading, spacing: NestSpacing.sm) {
                    Button { isOpen.toggle() } label: {
                        HStack(spacing: NestSpacing.xs) {
                            Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                                .font(.system(size: 14, weight: .semibold))
                            Text("Projected forward").font(.system(size: 16, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        .foregroundStyle(NestColor.text)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
                    if isOpen {
                        SegmentedInput(
                            options: ProjectionHorizon.allCases.map { ($0, $0.label) },
                            selection: $model.horizon
                        )
                        .accessibilityLabel("Projection horizon")
                        if presentation.hasData {
                            chart
                            Text(NetWorthPresentation.chartNote)
                                .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                        } else {
                            NestEmptyState(text: NetWorthPresentation.chartEmpty)
                        }
                    }
                }
            }
            HStack(spacing: 4) {
                Text("Projected net worth")
                ComparedAmount(
                    baselineCents: presentation.baselineProjectionEndCents,
                    proposedCents: presentation.projectionEndCents, colouring: false)
            }
            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
        }
    }

    private var chart: some View {
        let rows = presentation.rows
        let step = max(1, rows.count / 6)
        let labels = rows.enumerated().filter { $0.offset % step == 0 }.map(\.element.year)
        return VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Chart {
                ForEach(rows) { row in
                    AreaMark(x: .value("Year", row.year), y: .value("Amount", row.superCents), series: .value("Series", "Super"))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(NetWorthColor.superannuation.color.opacity(0.25))
                    AreaMark(x: .value("Year", row.year), y: .value("Amount", row.cashCents), series: .value("Series", "Cash & other"))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(NetWorthColor.cash.color.opacity(0.25))
                    if presentation.showsEquity {
                        AreaMark(x: .value("Year", row.year), y: .value("Amount", row.equityCents), series: .value("Series", "Equity"))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(NetWorthColor.equity.color.opacity(0.25))
                    }
                }
                ForEach(rows) { row in
                    LineMark(x: .value("Year", row.year), y: .value("Amount", row.totalCents), series: .value("Series", "Net worth"))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(NetWorthColor.total.color)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                }
                if let selected {
                    RuleMark(x: .value("Year", selected)).foregroundStyle(NestColor.border)
                }
            }
            .chartXSelection(value: $selected)
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine().foregroundStyle(NestColor.border)
                    AxisValueLabel {
                        if let cents = value.as(Int.self) {
                            Text(MoneyFormat.compact(cents: cents)).font(NestFont.caption)
                                .foregroundStyle(NestColor.dimmedText)
                        }
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: labels) { _ in
                    AxisValueLabel().font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                }
            }
            .frame(height: 260)
            .accessibilityLabel("Net worth projection")
            legend
            if let row = rows.first(where: { $0.year == selected }) {
                ProjectionBreakdown(row: row)
            }
        }
    }

    private var legend: some View {
        HStack(spacing: NestSpacing.sm) {
            LegendItem(label: "Super", color: .superannuation)
            LegendItem(label: "Cash & other", color: .cash)
            if presentation.showsEquity { LegendItem(label: "Equity", color: .equity) }
            LegendItem(label: "Net worth", color: .total)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct LegendItem: View {
    let label: String
    let color: NetWorthColor

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color.color).frame(width: 8, height: 8)
            Text(label).font(NestFont.caption).foregroundStyle(NestColor.text)
        }
    }
}

/// The selected year's whole picture: every asset and liability, then the total.
private struct ProjectionBreakdown: View {
    let row: ProjectionRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.year).font(.system(size: 14, weight: .semibold))
            ForEach(NetWorthPresentation.tooltipItems(row)) { item in
                HStack {
                    Circle().fill(item.color.color).frame(width: 10, height: 10)
                    Text(item.label).font(NestFont.caption)
                    Spacer()
                    Text(MoneyFormat.cents(item.cents)).font(NestFont.caption).monospacedDigit()
                }
            }
            Divider()
            HStack {
                Text("Net worth").font(.system(size: 12, weight: .semibold))
                Spacer()
                Text(MoneyFormat.cents(row.totalCents)).font(.system(size: 12, weight: .semibold)).monospacedDigit()
            }
        }
        .foregroundStyle(NestColor.text)
        .padding(NestSpacing.sm)
        .background(NestColor.surfaceRaised, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
