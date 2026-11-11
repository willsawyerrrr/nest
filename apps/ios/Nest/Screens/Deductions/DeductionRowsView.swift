import SwiftUI

/// The deduction being dragged to a group, shared by the draggable rows and the drop
/// targets of one member's list.
@MainActor @Observable
final class DeductionDrag {
    var draggingID: String?
}

/// A region deductions can be dropped on. While a deduction is dragged and the region is
/// a valid target for it, the region is outlined, and filled while the deduction is over it.
struct DeductionDropTarget<Content: View>: View {
    let dropID: String
    let drag: DeductionDrag
    let deductions: [Deduction]
    let groups: [DeductionGroup]
    let onMove: (Deduction, String?) -> Void
    @ViewBuilder let content: Content
    @State private var isOver = false

    private var dragged: Deduction? { deductions.first { $0.id == drag.draggingID } }
    private var isValid: Bool {
        dragged.map { DeductionDrop.result(for: $0, dropID: dropID, groups: groups).isValid } ?? false
    }

    var body: some View {
        content
            .background(
                (isValid && isOver ? NestColor.brand.opacity(0.12) : Color.clear),
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay {
                if isValid {
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.brand, style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
                        .padding(-2)
                        .allowsHitTesting(false)
                }
            }
            .onDrop(
                of: [.plainText],
                delegate: DropHandler(
                    isOver: $isOver, resolve: {
                        guard let dragged else { return nil }
                        let result = DeductionDrop.result(for: dragged, dropID: dropID, groups: groups)
                        return result.isValid ? (dragged, result.groupID) : nil
                    },
                    finish: { move in
                        drag.draggingID = nil
                        if let move { onMove(move.0, move.1) }
                    }))
    }

    private struct DropHandler: DropDelegate {
        @Binding var isOver: Bool
        let resolve: () -> (Deduction, String?)?
        let finish: ((Deduction, String?)?) -> Void

        func validateDrop(info: DropInfo) -> Bool { resolve() != nil }
        func dropEntered(info: DropInfo) { isOver = true }
        func dropExited(info: DropInfo) { isOver = false }
        func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
        func performDrop(info: DropInfo) -> Bool {
            isOver = false
            let move = resolve()
            finish(move)
            return move != nil
        }
    }
}

/// One deduction: a dense bordered card on a phone, a table-like row from the regular
/// width up. The description carries its "Receipt" link inline; `drag` adds the grip.
struct DeductionItemView: View {
    let deduction: Deduction
    let hasReceipt: Bool
    var drag: DeductionDrag?
    let onViewReceipt: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass == .regular }
    #else
        private var wide: Bool { true }
    #endif

    private var title: AttributedString {
        var text = AttributedString(deduction.description)
        text.font = .system(size: 14, weight: .semibold)
        text.foregroundColor = NestColor.text
        if hasReceipt {
            var link = AttributedString(" Receipt")
            link.font = .system(size: 12)
            link.foregroundColor = NestColor.brand
            link.link = URL(string: "nest-receipt://view")
            text += link
        }
        return text
    }

    private var money: some View {
        Text(MoneyFormat.cents(deduction.amountCents))
            .font(.system(size: 14, weight: .bold)).monospacedDigit()
            .foregroundStyle(NestColor.text)
    }

    private var controls: some View {
        HStack(spacing: 4) {
            if let drag {
                Image(systemName: "circle.grid.2x3.fill")
                    .font(.system(size: 13)).foregroundStyle(NestColor.dimmedText)
                    .frame(width: 24, height: 28)
                    .onDrag {
                        drag.draggingID = deduction.id
                        return NSItemProvider(object: deduction.id as NSString)
                    }
                    .accessibilityLabel("Drag \(deduction.description) to a group")
            }
            EditDeleteActions(onEdit: onEdit, onDelete: onDelete)
        }
    }

    private var titleText: some View {
        Text(title)
            .environment(\.openURL, OpenURLAction { _ in onViewReceipt(); return .handled })
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        if wide {
            VStack(spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: NestSpacing.md) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        titleText
                        Text(DeductionsPresentation.dateLabel(deduction))
                            .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                            .fixedSize()
                    }
                    money.frame(width: 112, alignment: .trailing)
                    controls
                }
                .padding(.vertical, 6)
                Divider().overlay(NestColor.border)
            }
        } else {
            HStack(alignment: .top, spacing: NestSpacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    titleText
                    Text(DeductionsPresentation.dateLabel(deduction))
                        .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
                HStack(spacing: 4) {
                    money
                    controls
                }
            }
            .padding(FormMetric.xs)
            .background(
                NestColor.surface,
                in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                    .strokeBorder(NestColor.border, lineWidth: 1))
        }
    }
}

/// One group, collapsed to its name, payment count and total; expanding shows its payments
/// and the control that adds the next. A donations group has no edit or delete control.
struct DeductionGroupCard<Payments: View>: View {
    let entry: GroupedPayments
    let onEdit: () -> Void
    let onDelete: () -> Void
    @ViewBuilder let payments: Payments
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: NestSpacing.sm) {
                Button { withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 12, weight: .medium))
                        Text(entry.group.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        Text(entry.paymentLabel).font(.system(size: 12))
                            .foregroundStyle(NestColor.dimmedText).fixedSize()
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(NestColor.text)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isButton)
                .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                Text(MoneyFormat.cents(entry.totalCents))
                    .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(NestColor.text)
                if entry.group.kind == "standard" {
                    EditDeleteActions(onEdit: onEdit, onDelete: onDelete)
                }
            }
            if expanded { VStack(alignment: .leading, spacing: 6) { payments } }
        }
        .padding(FormMetric.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}

/// Names a group: a subscription paid monthly, a trip's several receipts, anything
/// claimed in more than one payment. A group holds no amount of its own.
struct DeductionGroupForm: View {
    let initial: DeductionGroup?
    let onSubmit: (String) async throws -> Void
    var onCancel: (() -> Void)?
    @State private var name: String
    @State private var submitting = false
    @State private var error: String?

    init(
        initial: DeductionGroup?, onSubmit: @escaping (String) async throws -> Void,
        onCancel: (() -> Void)?
    ) {
        self.initial = initial
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _name = State(initialValue: initial?.name ?? "")
    }

    private var canSubmit: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        FormCard {
            TextInput(
                label: "Name", description:
                    "A subscription paid monthly, a trip's several receipts, anything claimed in more than one payment. Each payment under it is claimed in its own right; the group totals them.",
                placeholder: "e.g. Adobe Creative Cloud, or Bali conference trip", text: $name)
            if let error { FormError(message: error) }
            FormFooter(
                submitLabel: initial == nil ? "Add group" : "Save changes", canSubmit: canSubmit,
                submitting: submitting,
                onSubmit: {
                    Task {
                        submitting = true
                        error = nil
                        do { try await onSubmit(name.trimmingCharacters(in: .whitespaces)) } catch {
                            self.error = "Could not save this group. Please try again."
                        }
                        submitting = false
                    }
                }, onCancel: onCancel)
        }
    }
}
