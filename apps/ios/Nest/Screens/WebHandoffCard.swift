import SwiftUI

/// A card that opens a web page in a sheet, for what a native screen leaves to
/// the web app (a chart, or editing). The sheet is the same web fallback a
/// non-native route shows.
struct WebHandoffCard: View {
    let title: String
    let message: String
    let action: String
    let path: String
    @State private var isPresented = false

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                Text(title).font(NestFont.heading).foregroundStyle(NestColor.text)
                Text(message).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                Button(action) { isPresented = true }
            }
        }
        .sheet(isPresented: $isPresented) {
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Done") { isPresented = false }.padding(NestSpacing.md)
                }
                WebRouteView(path: path)
            }
        }
    }
}
