import SwiftUI

#Preview("Design system") {
    @Previewable @State var text = "Groceries"
    let months = ["Jul", "Aug", "Sep", "Oct"]
    let points = months.enumerated().flatMap { index, month in
        [
            ChartPoint(x: month, cents: 120_000 + index * 15_000, series: .needs),
            ChartPoint(x: month, cents: 60_000 + index * 5_000, series: .wants),
        ]
    }
    ScrollView {
        VStack(alignment: .leading, spacing: NestSpacing.lg) {
            Text("Design system").font(NestFont.display).foregroundStyle(NestColor.text)
            NestCard {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    NestListRow(title: "Salary", subtitle: "Fortnightly", systemImage: "banknote") {
                        MoneyText(cents: 312_050)
                    }
                    NestListRow(title: "Rent", systemImage: "house") { MoneyText(cents: -185_000) }
                    NestListRow(title: "Buffer") { MoneyText(cents: 0) }
                }
            }
            HStack {
                ForEach(NestPill.Tone.allCases, id: \.self) { NestPill(text: "\($0)", tone: $0) }
            }
            NestField(label: "Name", text: $text)
            Button("Save") {}.buttonStyle(NestPrimaryButtonStyle())
            NestCard { NestBarChart(points: points).frame(height: 160) }
            NestCard { NestLineChart(points: points).frame(height: 160) }
            ErrorView(
                title: "Couldn't load", message: "Check your connection and try again.", onRetry: {}
            )
            .frame(height: 240)
        }
        .padding(NestSpacing.md)
    }
    .background(NestColor.background)
}
