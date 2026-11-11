import Foundation

/// A payslip document already in the bucket: the payslip id it is filed under and the
/// object key it landed at. The id travels with the path because the document is stored
/// before the row exists (it is what extraction reads), and the row must be written
/// under that same id.
struct PayslipAttachment: Equatable, Sendable {
    let payslipId: String
    let path: String
}

/// The payslip fields a form supplies for a member. `financial_year` is derived from
/// the payment date, or the pay period's end where the slip states none; the database
/// holds the same rule as a check constraint. Nullable fields encode as explicit nulls,
/// as the PWA sends them.
struct PayslipInput: Encodable, Equatable, Sendable {
    var memberId: String
    var financialYear: Int
    var periodStart: String
    var periodEnd: String
    var paidOn: String?
    var grossCents: Int
    var taxWithheldCents: Int
    var superCents: Int
    var netCents: Int
    var salarySacrificeCents: Int?
    var ytdGrossCents: Int?
    var ytdTaxWithheldCents: Int?
    var ytdSuperCents: Int?
    var note: String?

    enum CodingKeys: String, CodingKey {
        case memberId = "member_id"
        case financialYear = "financial_year"
        case periodStart = "period_start"
        case periodEnd = "period_end"
        case paidOn = "paid_on"
        case grossCents = "gross_cents"
        case taxWithheldCents = "tax_withheld_cents"
        case superCents = "super_cents"
        case netCents = "net_cents"
        case salarySacrificeCents = "salary_sacrifice_cents"
        case ytdGrossCents = "ytd_gross_cents"
        case ytdTaxWithheldCents = "ytd_tax_withheld_cents"
        case ytdSuperCents = "ytd_super_cents"
        case note
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(memberId, forKey: .memberId)
        try container.encode(financialYear, forKey: .financialYear)
        try container.encode(periodStart, forKey: .periodStart)
        try container.encode(periodEnd, forKey: .periodEnd)
        try container.encode(paidOn, forKey: .paidOn)
        try container.encode(grossCents, forKey: .grossCents)
        try container.encode(taxWithheldCents, forKey: .taxWithheldCents)
        try container.encode(superCents, forKey: .superCents)
        try container.encode(netCents, forKey: .netCents)
        try container.encode(salarySacrificeCents, forKey: .salarySacrificeCents)
        try container.encode(ytdGrossCents, forKey: .ytdGrossCents)
        try container.encode(ytdTaxWithheldCents, forKey: .ytdTaxWithheldCents)
        try container.encode(ytdSuperCents, forKey: .ytdSuperCents)
        try container.encode(note, forKey: .note)
    }
}

/// One line as the form supplies it; each kind carries only the reference that means
/// anything for it, as the stored line's check constraint requires.
struct PayslipLineInput: Encodable, Equatable, Sendable {
    var kind: PayslipLineKind
    var sourceInflowId: String?
    var taxComponent: PayslipTaxComponent?
    var label: String
    var amountCents: Int

    enum CodingKeys: String, CodingKey {
        case kind
        case sourceInflowId = "source_inflow_id"
        case taxComponent = "tax_component"
        case label
        case amountCents = "amount_cents"
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(sourceInflowId, forKey: .sourceInflowId)
        try container.encode(taxComponent, forKey: .taxComponent)
        try container.encode(label, forKey: .label)
        try container.encode(amountCents, forKey: .amountCents)
    }
}

/// What a payslip form saves: the id it saves under, the row's fields, the slip's
/// earnings and tax lines, and the document uploaded for it, if any. A nil `attachment`
/// leaves any existing attachment as it is; `lines` is the slip's whole set.
struct PayslipSubmission: Equatable, Sendable {
    var id: String
    var input: PayslipInput
    var lines: [PayslipLineInput]
    var attachment: PayslipAttachment?
}

/// Storing, reading, saving and deleting payslips, the native counterpart of the
/// PWA's `usePayslips`. Documents live in the private `payslips` bucket as
/// `<household_id>/<payslip_id>/<uuid>-<file>`, so the first path segment gates
/// access to the owning household.
protocol PayslipsServicing: Sendable {
    /// Stores a prepared document under `payslipId` and returns where it landed.
    func upload(household: String, payslipId: String, file: UploadRules.PreparedFile) async throws
        -> String
    /// Deletes an uploaded object no payslip references. Best effort.
    func discard(path: String) async
    /// Reads an uploaded slip through `payslip-extract`.
    func read(path: String, financialYear: Int) async -> ExtractionOutcome
    /// Writes a payslip and its lines in one transaction, under the submission's id.
    /// A new attachment supersedes the stored one, which is then dropped best effort.
    func save(_ submission: PayslipSubmission, household: String, superseding: String?) async throws
    /// Removes a payslip and its stored attachment.
    func delete(_ payslip: Payslip) async throws
    /// A short-lived signed URL for viewing a stored attachment, or nil on failure.
    func signedURL(path: String) async -> URL?
}

struct PayslipsService: PayslipsServicing {
    static let bucket = "payslips"
    var data: NestData = .live

    private struct ExtractBody: Encodable, Sendable {
        let path: String
        let financialYear: Int
    }

    private struct SaveParams: Encodable, Sendable {
        let payslip: SavedPayslip
        let lines: [PayslipLineInput]

        enum CodingKeys: String, CodingKey {
            case payslip = "p_payslip"
            case lines = "p_lines"
        }
    }

    /// The `p_payslip` document: the input's columns plus the id, household and document path.
    private struct SavedPayslip: Encodable, Sendable {
        let input: PayslipInput
        let id: String
        let household: String
        let filePath: String?

        private enum ExtraKeys: String, CodingKey {
            case id, householdId = "household_id", filePath = "file_path"
        }

        func encode(to encoder: any Encoder) throws {
            try input.encode(to: encoder)
            var container = encoder.container(keyedBy: ExtraKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(household, forKey: .householdId)
            try container.encode(filePath, forKey: .filePath)
        }
    }

    func upload(household: String, payslipId: String, file: UploadRules.PreparedFile) async throws
        -> String
    {
        let path = UploadRules.objectPath(household: household, record: payslipId, name: file.name)
        try await data.api.upload(
            bucket: Self.bucket, path: path, data: file.data,
            contentType: UploadRules.storedContentType(file.name))
        return path
    }

    func discard(path: String) async {
        try? await data.api.remove(bucket: Self.bucket, paths: [path])
    }

    func read(path: String, financialYear: Int) async -> ExtractionOutcome {
        do {
            let response = try await data.api.invokeRaw(
                "payslip-extract", body: ExtractBody(path: path, financialYear: financialYear))
            if (200..<300).contains(response.status) {
                return PayslipExtractionReader.readExtraction(response.data).map(
                    ExtractionOutcome.read)
                    ?? .failed(message: PayslipExtractionReader.failedMessage)
            }
            return PayslipExtractionReader.readFailure(response.data)
        } catch {
            return PayslipExtractionReader.readFailure(nil)
        }
    }

    func save(_ submission: PayslipSubmission, household: String, superseding: String?) async throws
    {
        let params = SaveParams(
            payslip: SavedPayslip(
                input: submission.input, id: submission.id, household: household,
                filePath: submission.attachment?.path),
            lines: submission.lines)
        try await data.call(
            "upsert_payslip_with_lines", params: params, invalidating: ["payslip", "payslip_line"])
        if let attachment = submission.attachment, let superseding, superseding != attachment.path {
            await discard(path: superseding)
        }
    }

    func delete(_ payslip: Payslip) async throws {
        if let path = payslip.filePath {
            try await data.api.remove(bucket: Self.bucket, paths: [path])
        }
        try await data.delete(
            Payslip.self, filters: [.eq("id", payslip.id)], also: ["payslip_line"])
    }

    func signedURL(path: String) async -> URL? {
        guard let url = try? await data.api.signedURL(bucket: Self.bucket, path: path) else {
            return nil
        }
        // A type that is not safe to show inline is saved rather than rendered.
        guard !UploadRules.canExtract(path),
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return url }
        components.queryItems =
            (components.queryItems ?? []) + [
                URLQueryItem(name: "download", value: UploadRules.downloadName(path))
            ]
        return components.url ?? url
    }
}
