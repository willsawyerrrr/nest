import SwiftUI

/// A member's super editor (fund name and balance) in the PWA's bordered form card.
/// The balance prefills with the effective balance today; a save is a true-up.
struct SuperProfileForm: View {
    let memberName: String
    let onSubmit: (SuperProfileValues) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: SuperProfileDraft
    @State private var submitting = false
    @State private var error: String?

    init(
        memberName: String, draft: SuperProfileDraft,
        onSubmit: @escaping (SuperProfileValues) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.memberName = memberName
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(initialValue: draft)
    }

    var body: some View {
        FormCard {
            Text(memberName).font(.system(size: 16, weight: .semibold)).foregroundStyle(NestColor.text)
            if draft.isTrueUp {
                Text(SuperProfileDraft.trueUpNote).font(.system(size: 12))
                    .foregroundStyle(NestColor.dimmedText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TextInput(label: "Fund name", placeholder: "e.g. AustralianSuper", text: $draft.fundName)
            TextInput(label: draft.balanceLabel, prefix: "$", decimal: true, text: $draft.balance)
            if let error { FormError(message: error) }
            FormFooter(
                submitLabel: draft.submitLabel, canSubmit: true, submitting: submitting,
                onSubmit: { Task { await submit() } }, onCancel: onCancel)
        }
    }

    private func submit() async {
        guard !submitting else { return }
        submitting = true
        error = nil
        do { try await onSubmit(draft.values) } catch { self.error = SuperProfileDraft.saveError }
        submitting = false
    }
}

/// The add and edit form for one super contribution, in the PWA's bordered form card.
struct SuperContributionForm: View {
    let memberID: String
    let otherMembers: [Member]
    let isEditing: Bool
    let onSubmit: (SuperContributionInput) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: SuperContributionDraft
    @State private var submitting = false
    @State private var error: String?

    init(
        memberID: String, members: [Member], editing: SuperContribution?,
        onSubmit: @escaping (SuperContributionInput) async throws -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.memberID = memberID
        otherMembers = members.filter { $0.id != memberID }
        isEditing = editing != nil
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(initialValue: editing.map(SuperContributionDraft.init(contribution:)) ?? .init())
    }

    private var contributorOptions: [(value: String, label: String)] {
        (draft.contributorID.isEmpty ? [("", "Select a member")] : [])
            + otherMembers.map { ($0.id, $0.name) }
    }

    var body: some View {
        FormCard {
            SelectInput(
                label: "Kind",
                options: SuperContributionDraft.kinds.map { ($0, SuperPresentation.kindLabel($0)) },
                selection: $draft.kind)
            if draft.isSpouse {
                SelectInput(
                    label: "Contributor", description: "The member making this spouse contribution.",
                    options: contributorOptions, selection: $draft.contributorID)
            }
            SegmentedInput(
                options: [(SuperContributionMode.amount, "Amount"), (.percent, "Percent of salary")],
                selection: $draft.mode
            )
            .accessibilityLabel("Contribution mode")
            if draft.isPercent {
                TextInput(
                    label: "Percent of gross salary", suffix: "%", decimal: true, text: $draft.percent)
            } else {
                TextInput(label: "Contribution amount", prefix: "$", decimal: true, text: $draft.amount)
            }
            FrequencyInput(
                frequency: $draft.frequency, interval: $draft.interval,
                intervalLabel: SuperContributionDraft.intervalLabel)
            HStack(spacing: 10) {
                Toggle("", isOn: $draft.fhssEligible).labelsHidden().tint(NestColor.brand).fixedSize()
                Text("FHSS eligible").font(.system(size: 14)).foregroundStyle(NestColor.text)
            }
            .accessibilityElement(children: .combine)
            if let error { FormError(message: error) }
            FormFooter(
                submitLabel: isEditing ? "Save changes" : "Add contribution",
                canSubmit: draft.canSubmit, submitting: submitting,
                onSubmit: { Task { await submit() } }, onCancel: onCancel)
        }
    }

    private func submit() async {
        guard let input = draft.input(memberID: memberID), !submitting else { return }
        submitting = true
        error = nil
        do { try await onSubmit(input) } catch { self.error = SuperContributionDraft.saveError }
        submitting = false
    }
}
