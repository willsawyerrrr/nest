import Foundation

/// Every row the Members screen reads.
struct MembersRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var taxProfiles: [TaxProfile] = []

    /// Members ordered by name and the tax profiles of `financialYear`, as the PWA reads them.
    static func sources(financialYear: Int) -> [TableSource<MembersRows>] {
        [
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(
                TaxProfile.self, filters: [.eq("financial_year", String(financialYear))]
            ) { $0.taxProfiles = $1 },
        ]
    }

    /// The household new profiles belong to (every member row shares it).
    var householdID: String? { members.first?.householdId }
}

/// The tax-profile fields a form supplies for a member in the current financial year.
struct TaxProfileInput: Encodable, Equatable, Sendable {
    let memberID: String
    let residency: TaxResidency
    let hasPrivateHospitalCover: Bool

    enum CodingKeys: String, CodingKey {
        case residency
        case memberID = "member_id"
        case hasPrivateHospitalCover = "has_private_hospital_cover"
    }
}

/// What one member's editor saves: the year's profile, and the date of birth,
/// which belongs to the member rather than the year (`nil` clears it).
struct TaxProfileSubmission: Equatable, Sendable {
    let profile: TaxProfileInput
    let dateOfBirth: String?
}

/// A tax-profile insert body: the input plus its household and year.
struct TaxProfileInsert: Encodable, Sendable {
    let householdID: String
    let financialYear: Int
    let input: TaxProfileInput

    enum CodingKeys: String, CodingKey {
        case householdID = "household_id"
        case financialYear = "financial_year"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(householdID, forKey: .householdID)
        try container.encode(financialYear, forKey: .financialYear)
        try input.encode(to: encoder)
    }
}

/// The `set_member_date_of_birth` arguments; a `nil` date encodes as `null`, clearing it.
struct DateOfBirthParams: Encodable, Sendable {
    let memberID: String
    let dateOfBirth: String?

    enum CodingKeys: String, CodingKey {
        case memberID = "p_member_id"
        case dateOfBirth = "p_date_of_birth"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(memberID, forKey: .memberID)
        try container.encode(dateOfBirth, forKey: .dateOfBirth)
    }
}
