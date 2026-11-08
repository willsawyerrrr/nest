import SwiftUI

/// A money figure that reads `was → now (±change)` when planning mode has moved
/// it, and as a plain figure otherwise.
struct ComparedAmount: View {
    let baselineCents: Int?
    let proposedCents: Int
    var colouring = true

    var body: some View {
        if let baselineCents, baselineCents != proposedCents {
            let delta = proposedCents - baselineCents
            HStack(spacing: NestSpacing.xxs) {
                Text(MoneyFormat.cents(baselineCents)).monospacedDigit()
                    .foregroundStyle(NestColor.dimmedText)
                Image(systemName: "arrow.right").foregroundStyle(NestColor.dimmedText)
                MoneyText(cents: proposedCents, colouring: colouring)
                Text("(\(delta > 0 ? "+" : "")\(MoneyFormat.cents(delta)))").monospacedDigit()
                    .foregroundStyle(MoneySign(cents: delta).color ?? NestColor.dimmedText)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                "\(MoneyFormat.cents(baselineCents)) becomes \(MoneyFormat.cents(proposedCents)), a change of \(MoneyFormat.cents(delta))"
            )
        } else {
            MoneyText(cents: proposedCents, colouring: colouring)
        }
    }
}

/// A standing reminder shown while planning mode is on, linking to its review.
struct PlanningBanner: View {
    private let planning = PlanningStore.shared

    var body: some View {
        if planning.isActive {
            NestCard {
                HStack(spacing: NestSpacing.sm) {
                    NestPill(text: "Planning mode", tone: .warning)
                    Text("Changes stay on this device until you save them.")
                        .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    Spacer(minLength: NestSpacing.xs)
                    NavigationLink("Review", value: Route.planning)
                }
            }
            .accessibilityIdentifier("planning-banner")
        }
    }
}
