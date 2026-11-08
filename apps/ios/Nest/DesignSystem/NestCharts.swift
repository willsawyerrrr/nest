import Charts
import SwiftUI

/// One plotted value: an amount in integer cents on an x category, in a series.
struct ChartPoint: Identifiable, Sendable {
    let x: String
    let cents: Int
    let series: ChartColorKey
    var id: String { "\(series.rawValue)/\(x)" }
}

private extension View {
    /// Token-styled axes: hairline grids, dimmed compact-dollar labels.
    func nestChartAxes() -> some View {
        chartYAxis {
            AxisMarks { value in
                AxisGridLine().foregroundStyle(NestColor.border)
                AxisValueLabel {
                    if let cents = value.as(Int.self) {
                        Text(MoneyFormat.compact(cents: cents))
                            .font(NestFont.caption)
                            .foregroundStyle(NestColor.dimmedText)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel().font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        }
    }
}

private func seriesKeys(_ points: [ChartPoint]) -> [ChartColorKey] {
    ChartColorKey.allCases.filter { key in points.contains { $0.series == key } }
}

/// A stacked bar chart drawn from the categorical chart palette.
struct NestBarChart: View {
    let points: [ChartPoint]

    var body: some View {
        let keys = seriesKeys(points)
        Chart(points) { point in
            BarMark(x: .value("Category", point.x), y: .value("Amount", point.cents))
                .foregroundStyle(by: .value("Series", point.series.rawValue))
                .cornerRadius(NestRadius.xs)
        }
        .chartForegroundStyleScale(domain: keys.map(\.rawValue), range: keys.map(\.color))
        .chartLegend(.hidden)
        .nestChartAxes()
    }
}

/// A line chart drawn from the categorical chart palette.
struct NestLineChart: View {
    let points: [ChartPoint]

    var body: some View {
        let keys = seriesKeys(points)
        Chart(points) { point in
            LineMark(x: .value("Category", point.x), y: .value("Amount", point.cents))
                .foregroundStyle(by: .value("Series", point.series.rawValue))
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
        }
        .chartForegroundStyleScale(domain: keys.map(\.rawValue), range: keys.map(\.color))
        .chartLegend(.hidden)
        .nestChartAxes()
    }
}
