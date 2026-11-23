import SwiftUI

/// The Budget screen's actual-spend controls, as the PWA's `ActualSpendBar`:
/// the reconciled fortnight with steppers back and forward (never past the
/// current one), whether pending spend counts, the spend in no group, and the
/// way into the category → group map.
struct ActualSpendBar: View {
    @Bindable var model: ActualSpendViewModel
    let onEditCategoryGroups: () -> Void

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(spacing: NestSpacing.xs) {
                HStack {
                    stepper("chevron.left", label: "Previous fortnight", action: model.previous)
                    Spacer(minLength: NestSpacing.xs)
                    VStack(spacing: 0) {
                        Text(ActualSpendPresentation.heading(isCurrent: model.isCurrent))
                            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                        Text(model.period.map(ActualSpendPresentation.periodLabel) ?? " ")
                            .font(.system(size: 15, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(NestColor.text)
                            .accessibilityLabel(
                                "Reconciled fortnight \(model.period.map(ActualSpendPresentation.periodLabel) ?? "")")
                    }
                    Spacer(minLength: NestSpacing.xs)
                    stepper("chevron.right", label: "Next fortnight", action: model.next)
                        .disabled(model.isCurrent)
                }
                HStack {
                    Toggle("Include pending", isOn: $model.includePending)
                        .toggleStyle(.switch).tint(NestColor.brand).controlSize(.small)
                        .font(NestFont.small).foregroundStyle(NestColor.text)
                        .fixedSize()
                    Spacer(minLength: NestSpacing.xs)
                    if let unbudgeted = model.spend.flatMap({
                        ActualSpendPresentation.unbudgeted($0.unbudgeted)
                    }) {
                        Text(unbudgeted).font(NestFont.small).monospacedDigit()
                            .foregroundStyle(NestColor.dimmedText)
                            .accessibilityLabel("Spend in no group \(unbudgeted)")
                    }
                }
                if let error = model.error {
                    Text(error.userMessage).font(NestFont.caption)
                        .foregroundStyle(NestColor.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button("Category groups", action: onEditCategoryGroups)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(NestColor.navActiveText)
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("category-groups")
            }
        }
    }

    private func stepper(_ systemImage: String, label: String, action: @escaping () -> Void)
        -> some View
    {
        Button(action: action) {
            Image(systemName: systemImage).font(.system(size: 12, weight: .semibold))
                .foregroundStyle(NestColor.text)
                .frame(width: 28, height: 28)
                .outlined()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A group's spend beneath its planned subtotal: what was spent, and what is
/// left or by how much it went over.
struct GroupSpendLine: View {
    let title: String
    let spend: ActualSpendPresentation.GroupSpend

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(spend.spent).foregroundStyle(NestColor.dimmedText)
                .accessibilityLabel("\(title) actual spend \(spend.spent)")
            Spacer()
            Text(spend.remaining).foregroundStyle(spend.sign.color ?? NestColor.dimmedText)
                .accessibilityLabel("\(title) left to spend \(spend.remaining)")
        }
        .font(NestFont.small).monospacedDigit()
    }
}

/// The Up category → budget group map, as the PWA's `CategoryGroupsModal`: each
/// child category under its parent picks the shared default, a group, or no group.
struct CategoryGroupsSheet: View {
    @State private var model: CategoryGroupsViewModel
    @Environment(\.dismiss) private var dismiss

    init(model: CategoryGroupsViewModel = CategoryGroupsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Category groups").font(NestFont.title).foregroundStyle(NestColor.text)
                Spacer()
                Button("Done") { dismiss() }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(NestColor.navActiveText)
                    .buttonStyle(.plain)
            }
            .padding(NestSpacing.lg)
            ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { sections in
                CategoryGroupsList(model: model, sections: sections)
            }
        }
        .background(NestColor.background)
        .task { await model.load() }
        #if os(iOS)
            .presentationDetents([.large])
        #endif
        #if os(macOS)
            .frame(minWidth: 420, minHeight: 520)
        #endif
    }
}

struct CategoryGroupsList: View {
    let model: CategoryGroupsViewModel
    let sections: [CategoryGroupSection]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text("The budget group each Up category’s spend counts toward.")
                    .font(NestFont.small).foregroundStyle(NestColor.dimmedText)
                if let failure = model.failure {
                    Text(failure).font(NestFont.small).foregroundStyle(NestColor.negative)
                }
                if sections.isEmpty {
                    NestEmptyState(text: "No Up categories yet.")
                }
                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: NestSpacing.xs) {
                        Text(section.name).font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(NestColor.text)
                        ForEach(section.rows) { row in
                            HStack {
                                Text(row.name).font(NestFont.small).foregroundStyle(NestColor.text)
                                Spacer(minLength: NestSpacing.xs)
                                picker(row)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, NestSpacing.lg)
            .padding(.bottom, NestSpacing.lg)
        }
    }

    private func picker(_ row: CategoryGroupRow) -> some View {
        Menu {
            ForEach(ActualSpendPresentation.choices, id: \.self) { choice in
                Button(ActualSpendPresentation.choiceLabel(choice, defaultGroup: row.defaultGroup)) {
                    Task { await model.set(row, to: choice) }
                }
            }
        } label: {
            HStack {
                Text(ActualSpendPresentation.choiceLabel(row.choice, defaultGroup: row.defaultGroup))
                    .font(.system(size: 12)).foregroundStyle(NestColor.text).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10))
                    .foregroundStyle(NestColor.dimmedText)
            }
            .padding(.horizontal, NestSpacing.xs)
            .frame(width: 170, height: 30)
            .outlined()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(row.name) group")
    }
}

#Preview("Actual spend bar") {
    ActualSpendBar(model: ActualSpendViewModel(), onEditCategoryGroups: {})
        .padding()
        .background(NestColor.background)
}

#Preview("Group spend") {
    VStack {
        GroupSpendLine(
            title: "Needs",
            spend: ActualSpendPresentation.groupSpend(plannedCents: 500_00, spentCents: 412_50))
        GroupSpendLine(
            title: "Wants",
            spend: ActualSpendPresentation.groupSpend(plannedCents: 100_00, spentCents: 112_00))
    }
    .padding()
    .background(NestColor.background)
}

#Preview("Category groups") {
    CategoryGroupsList(
        model: CategoryGroupsViewModel(),
        sections: [
            CategoryGroupSection(
                name: "Good Life",
                rows: [
                    CategoryGroupRow(
                        id: "booze", name: "Booze", defaultGroup: .discretionary, choice: .shared),
                    CategoryGroupRow(
                        id: "restaurants-and-cafes", name: "Restaurants & Cafes", defaultGroup: .wants,
                        choice: .override(.needs)),
                ]),
            CategoryGroupSection(
                name: "Personal",
                rows: [
                    CategoryGroupRow(
                        id: "investments", name: "Investments", defaultGroup: .investments,
                        choice: .override(nil))
                ]),
        ]
    )
    .background(NestColor.background)
}
