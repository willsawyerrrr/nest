import SwiftUI

/// Which bulk action is saving, so only its button shows progress.
enum BulkReviewAction { case review, categorise }

/// A transaction a bulk action could not save, named for the alert.
struct BulkFailureLine: Equatable, Identifiable {
    let id: String
    let label: String
    let code: String?
}

/// A square checkbox, the PWA's `xs` Mantine checkbox: ticked, part-ticked, or empty.
struct ReviewCheckbox: View {
    enum Value { case on, mixed, off }
    let value: Value
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(
                systemName: value == .on
                    ? "checkmark.square.fill" : value == .mixed ? "minus.square.fill" : "square"
            )
            .font(.system(size: 16))
            .foregroundStyle(value == .off ? NestColor.dimmedText : NestColor.brand)
            .frame(width: 24, height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(value == .on ? "Selected" : value == .mixed ? "Partly selected" : "")
        .accessibilityAddTraits(value == .on ? .isSelected : [])
    }
}

/// Select all, the selected count, and the bulk actions: mark the selection
/// reviewed as it stands, or set one category on all of it.
struct BulkReviewBar: View {
    let selectable: Int
    let selectedCount: Int
    let groups: [UpCategoryGroup]
    let busy: BulkReviewAction?
    let onSelectAll: (Bool) -> Void
    let onReviewMany: () -> Void
    let onCategoriseMany: (String) -> Void

    @State private var categoryID: String?

    private var none: Bool { selectedCount == 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: FormMetric.xs) {
            HStack(spacing: FormMetric.xs) {
                HStack(spacing: 6) {
                    ReviewCheckbox(
                        value: selectedCount == selectable ? .on : none ? .off : .mixed,
                        label: none ? "Select all" : "\(selectedCount) selected"
                    ) { onSelectAll(selectedCount != selectable) }
                    Text(none ? "Select all" : "\(selectedCount) selected")
                        .font(.system(size: 12)).foregroundStyle(NestColor.text)
                        .accessibilityHidden(true)
                }
                .disabled(busy != nil)
                .frame(minHeight: 30)
                if !none {
                    bulkButton("Mark reviewed", for: .review, style: .light, perform: onReviewMany)
                        .disabled(busy == .categorise)
                }
            }
            if !none {
                HStack(spacing: FormMetric.xs) {
                    categoryMenu
                    bulkButton("Apply", for: .categorise, style: .primary) {
                        if let categoryID { onCategoriseMany(categoryID) }
                    }
                    .disabled(categoryID == nil || busy == .review)
                }
            }
        }
    }

    private var categoryMenu: some View {
        Menu {
            ForEach(groups) { group in
                Section(group.name) {
                    ForEach(group.items) { item in
                        Button(item.name) { categoryID = item.id }
                    }
                }
            }
        } label: {
            HStack {
                Text(
                    categoryID == nil
                        ? "Set category"
                        : UpCategories.pickerLabel(
                            groups.flatMap(\.items), categoryID)
                )
                .font(.system(size: 12)).lineLimit(1)
                .foregroundStyle(categoryID == nil ? NestColor.dimmedText : NestColor.text)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10))
                    .foregroundStyle(NestColor.dimmedText)
            }
            .padding(.horizontal, FormMetric.sm)
            .frame(maxWidth: 200, minHeight: 30)
            .outlined()
        }
        .buttonStyle(.plain)
        .disabled(busy != nil)
        .accessibilityLabel("Category for selected")
    }

    private func bulkButton(
        _ title: String, for action: BulkReviewAction, style: ReviewButtonStyle.Kind,
        perform: @escaping () -> Void
    ) -> some View {
        Button(action: perform) {
            HStack(spacing: 4) {
                if busy == action { ProgressView().controlSize(.small) }
                Text(title)
            }
        }
        .buttonStyle(ReviewButtonStyle(kind: style))
    }
}

/// Why each transaction a bulk action could not save is still waiting, with a
/// Connections link where that is the fix.
struct BulkFailureAlert: View {
    let failures: [BulkFailureLine]
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    "\(failures.count) couldn't be saved and \(failures.count == 1 ? "is" : "are") still waiting for review"
                )
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.negative)
                ForEach(failures) { failure in
                    Text(
                        "\(failure.label): \(ReviewFailure.message(failure.code))"
                    )
                    .font(.system(size: 14)).foregroundStyle(NestColor.text)
                }
                if failures.contains(where: {
                    ReviewFailure.needsConnections($0.code)
                }) {
                    NavigationLink(value: Route.connections) {
                        Text("Open Connections").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(NestColor.brand)
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(NestColor.negative).frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(FormMetric.xs)
        .background(
            NestColor.negative.opacity(0.12),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}
