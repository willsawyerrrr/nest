import SwiftUI

/// The native Planning mode settings route: the switch that turns the sandbox
/// on and off.
struct PlanningModeScreen: View {
    private let planning = PlanningStore.shared
    private let data: NestData

    init(data: NestData = .live) {
        self.data = data
    }

    var body: some View {
        ScrollView {
            NestCard {
                VStack(alignment: .leading, spacing: NestSpacing.sm) {
                    Toggle(
                        "Planning mode",
                        isOn: Binding(
                            get: { planning.isActive },
                            set: { $0 ? planning.enter() : planning.exit() })
                    )
                    .font(.system(size: 16, weight: .semibold))
                    Text(
                        "Try changes to your pays, bills and savings goals and watch every figure update, without saving anything. Only those three are sandboxed — every other screen still saves normally."
                            + (planning.isActive
                                ? " \(planning.pendingCount) pending change\(planning.pendingCount == 1 ? "" : "s"); turn off to discard."
                                : "")
                    )
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    if planning.isActive {
                        NavigationLink("Review pending changes", value: Route.planning)
                    }
                }
            }
            .padding(NestSpacing.md)
        }
        .background(NestColor.background)
        .task { await selectHousehold() }
    }

    /// Scopes the sandbox to the signed-in household before the switch is used.
    private func selectHousehold() async {
        do {
            for try await snapshot in data.rows(Member.self) {
                planning.select(household: snapshot.rows.first?.householdId)
            }
        } catch {}
    }
}
