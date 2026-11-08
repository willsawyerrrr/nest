import SwiftUI

/// The native Allowance route: the signed-in member's allowance, how much of it
/// is drawn and left, and the items drawn from it. With no allowance it says so.
struct AllowanceScreen: View {
    @State private var model: BudgetViewModel

    init(model: BudgetViewModel = BudgetViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            AllowanceContentView(presentation: BudgetPresentation(content: content))
        }
        .task { await model.load() }
    }
}

struct AllowanceContentView: View {
    let presentation: BudgetPresentation

    var body: some View {
        ScrollView {
            VStack(spacing: NestSpacing.md) {
                if let allowance = presentation.ownAllowance {
                    NestCard {
                        VStack(alignment: .leading, spacing: NestSpacing.xs) {
                            Text(allowance.title).font(NestFont.heading)
                                .foregroundStyle(NestColor.text)
                            AllowanceRowView(row: allowance)
                            Text(BudgetPresentation.allowanceNote)
                                .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                        }
                    }
                    NestCard {
                        VStack(alignment: .leading, spacing: NestSpacing.xs) {
                            Text("Items").font(NestFont.heading).foregroundStyle(NestColor.text)
                            if presentation.drawnLines.isEmpty {
                                Text("Nothing drawn from your allowance yet.")
                                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                            }
                            ForEach(presentation.drawnLines) { BudgetLineRowView(row: $0) }
                            Text(BudgetPresentation.overdrawGuard)
                                .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                                .accessibilityIdentifier("overdraw-guard")
                        }
                    }
                    WebHandoffCard(
                        title: "Edit allowance",
                        message: "Adding and changing allowance items happens in the web app.",
                        action: "Open Allowance on the web", path: Route.allowance.path)
                } else {
                    Text("You have no spending allowance yet.")
                        .foregroundStyle(NestColor.dimmedText)
                        .multilineTextAlignment(.center)
                        .padding(NestSpacing.xl)
                }
            }
            .padding(NestSpacing.md)
        }
    }
}
