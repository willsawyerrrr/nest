import Foundation

/// One member with their tax profile as listed.
struct MemberTaxRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    /// `Resident` or `Foreign resident`; a member with no profile is a resident.
    let residencyLabel: String
    let hasHospitalCover: Bool
    /// `Born 28 Feb 1990`, or `No date of birth`.
    let dateOfBirthLabel: String
    let residency: TaxResidency
    let dateOfBirth: String?
}

/// Pure presentation of the Members screen, mirroring `MembersScreen` and `TaxProfileList`.
struct MembersPresentation: Equatable, Sendable {
    static let title = "Members & tax profiles"
    static let saveError = "Could not save this tax profile. Please try again."
    static let dateOfBirthHint =
        "Optional. Used for one thing only: their age when a one-off termination payment lands, which sets the rate its concessional part is taxed at. Left blank, the estimate assumes they are below preservation age — the higher rate."

    let financialYear: Int
    let rows: [MemberTaxRow]

    /// `Tax profiles (FY2027)`.
    var sectionTitle: String { "Tax profiles (FY\(financialYear))" }

    init(rows source: MembersRows, financialYear: Int) {
        self.financialYear = financialYear
        rows = source.members.map { member in
            let profile = source.taxProfiles.first { $0.memberId == member.id }
            let residency = profile?.residency ?? .resident
            return MemberTaxRow(
                id: member.id, name: member.name,
                residencyLabel: Self.label(residency),
                hasHospitalCover: profile?.hasPrivateHospitalCover ?? false,
                dateOfBirthLabel: member.dateOfBirth.map { "Born \(BudgetPresentation.date($0))" }
                    ?? "No date of birth",
                residency: residency, dateOfBirth: member.dateOfBirth)
        }
    }

    static func label(_ residency: TaxResidency) -> String {
        residency == .foreignResident ? "Foreign resident" : "Resident"
    }
}

/// The editor's fields as set, and the submission they build.
struct TaxProfileDraft: Equatable, Sendable {
    let memberID: String
    var residency: TaxResidency
    var hasCover: Bool
    var dateOfBirth: String?

    init(row: MemberTaxRow) {
        memberID = row.id
        residency = row.residency
        hasCover = row.hasHospitalCover
        dateOfBirth = row.dateOfBirth
    }

    var submission: TaxProfileSubmission {
        TaxProfileSubmission(
            profile: TaxProfileInput(
                memberID: memberID, residency: residency, hasPrivateHospitalCover: hasCover),
            dateOfBirth: dateOfBirth)
    }
}
