import SwiftUI

/// The native Members route: each member's residency, hospital cover and date of
/// birth for the current financial year, with an inline editor.
struct MembersScreen: View {
    @State private var model: MembersViewModel

    init(model: MembersViewModel = MembersViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { rows in
            MembersContentView(
                presentation: MembersPresentation(rows: rows, financialYear: model.financialYear),
                save: { try await model.save($0) })
        }
        .task { await model.load() }
    }
}

struct MembersContentView: View {
    let presentation: MembersPresentation
    let save: (TaxProfileSubmission) async throws -> Void

    @State private var editingID: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                Text(MembersPresentation.title)
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-0.76)
                    .foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: NestSpacing.sm) {
                    Text(presentation.sectionTitle)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(NestColor.text)
                        .accessibilityAddTraits(.isHeader)
                    VStack(alignment: .leading, spacing: NestSpacing.xs) {
                        ForEach(presentation.rows) { row in
                            if editingID == row.id {
                                TaxProfileForm(
                                    row: row,
                                    onSubmit: { submission in
                                        try await save(submission)
                                        editingID = nil
                                    },
                                    onCancel: { editingID = nil })
                            } else {
                                MemberTaxItem(row: row, onEdit: { editingID = row.id })
                            }
                        }
                    }
                }
            }
            .padding(NestSpacing.md)
        }
    }
}

/// A small light pill, as Mantine's `Badge` at `xs`.
private struct Pill: View {
    let text: String
    var tint: Color = NestColor.dimmedText

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(tint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(
                tint.opacity(0.16),
                in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            .fixedSize()
    }
}

/// The residency pill; `Resident` for a member with no profile.
private struct ResidencyPill: View {
    let row: MemberTaxRow
    var body: some View { Pill(text: row.residencyLabel) }
}

/// The hospital-cover pill, or a muted note when there is no cover.
private struct CoverPill: View {
    let row: MemberTaxRow

    var body: some View {
        if row.hasHospitalCover {
            Pill(text: "Hospital cover", tint: NestColor.positive)
        } else {
            Text("No hospital cover").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
        }
    }
}

/// One member: a dense row where there is room, a bordered card on a phone.
private struct MemberTaxItem: View {
    let row: MemberTaxRow
    let onEdit: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    var body: some View {
        if wide { rowBody } else { cardBody }
    }

    private var name: some View {
        Text(row.name).font(.system(size: 14, weight: .semibold))
            .foregroundStyle(NestColor.text).lineLimit(1)
    }

    private var dateOfBirth: some View {
        Text(row.dateOfBirthLabel).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
    }

    private var edit: some View {
        Button(action: onEdit) {
            Image(systemName: "pencil").font(.system(size: 14))
                .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Edit \(row.name)’s tax profile")
    }

    private var rowBody: some View {
        HStack(spacing: NestSpacing.sm) {
            name.frame(maxWidth: .infinity, alignment: .leading)
            ResidencyPill(row: row).frame(width: 112, alignment: .leading)
            CoverPill(row: row).frame(width: 128, alignment: .leading)
            dateOfBirth.frame(width: 144, alignment: .trailing)
            edit
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }

    private var cardBody: some View {
        HStack(alignment: .top, spacing: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                name
                HStack(spacing: 6) {
                    ResidencyPill(row: row)
                    CoverPill(row: row)
                }
                dateOfBirth
            }
            Spacer(minLength: 0)
            edit
        }
        .padding(NestSpacing.xs)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}

/// The inline editor: residency, hospital cover and date of birth over Save and Cancel.
private struct TaxProfileForm: View {
    let row: MemberTaxRow
    let onSubmit: (TaxProfileSubmission) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: TaxProfileDraft
    @State private var submitting = false
    @State private var failed = false

    init(
        row: MemberTaxRow, onSubmit: @escaping (TaxProfileSubmission) async throws -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.row = row
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(initialValue: TaxProfileDraft(row: row))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(row.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(NestColor.text)
            residencyPicker
            Toggle(isOn: $draft.hasCover) {
                Text("Private hospital cover").font(.system(size: 14)).foregroundStyle(NestColor.text)
            }
            dateOfBirthField
            if failed {
                Text(MembersPresentation.saveError)
                    .font(.system(size: 12)).foregroundStyle(NestColor.negative)
            }
            HStack(spacing: NestSpacing.xs) {
                Button(submitting ? "Saving…" : "Save", action: submit)
                    .buttonStyle(NestPrimaryButtonStyle())
                    .disabled(submitting)
                    .opacity(submitting ? 0.5 : 1)
                Button("Cancel", action: onCancel)
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(NestColor.text)
                    .frame(maxWidth: .infinity).padding(.vertical, NestSpacing.sm).outlined()
                    .disabled(submitting)
            }
        }
        .padding(NestSpacing.sm)
        .outlined()
    }

    private var residencyPicker: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text("Residency").font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            Menu {
                Picker("Residency", selection: $draft.residency) {
                    ForEach(TaxResidency.allCases, id: \.self) {
                        Text(MembersPresentation.label($0)).tag($0)
                    }
                }
            } label: {
                HStack {
                    Text(MembersPresentation.label(draft.residency)).foregroundStyle(NestColor.text)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 11))
                        .foregroundStyle(NestColor.dimmedText)
                }
                .font(NestFont.body)
                .padding(NestSpacing.sm)
                .outlined()
            }
        }
    }

    private var dateOfBirthField: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text("Date of birth").font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            Text(MembersPresentation.dateOfBirthHint)
                .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            HStack {
                if let iso = draft.dateOfBirth {
                    DatePicker(
                        "Date of birth", selection: dateBinding(iso),
                        in: ...Date(), displayedComponents: .date
                    )
                    .labelsHidden()
                    .environment(\.locale, Locale(identifier: "en_AU"))
                    Spacer()
                    Button { draft.dateOfBirth = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(NestColor.dimmedText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear date of birth")
                } else {
                    Button("Set a date") { draft.dateOfBirth = Self.iso(Date()) }
                        .buttonStyle(.plain).foregroundStyle(NestColor.dimmedText)
                    Spacer()
                }
            }
            .font(NestFont.body)
            .padding(NestSpacing.sm)
            .outlined()
        }
    }

    private func dateBinding(_ iso: String) -> Binding<Date> {
        Binding(
            get: { Self.date(iso) ?? Date() },
            set: { draft.dateOfBirth = Self.iso($0) })
    }

    private static func date(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar(identifier: .gregorian).date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func iso(_ date: Date) -> String {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    private func submit() {
        guard !submitting else { return }
        submitting = true
        failed = false
        Task {
            do { try await onSubmit(draft.submission) } catch { failed = true }
            submitting = false
        }
    }
}

private extension View {
    /// A bordered rounded outline on the elevated surface, as a default input or button.
    func outlined() -> some View {
        background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}
