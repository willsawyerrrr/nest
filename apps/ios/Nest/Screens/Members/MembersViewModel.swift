import Foundation
import Observation

/// Loads the household's members and the year's tax profiles through the cache, and saves them.
@MainActor @Observable
final class MembersViewModel {
    private(set) var state: ScreenState<MembersRows> = .loading
    /// The financial year the profiles are scoped to.
    let financialYear: Int

    private let data: NestData

    init(data: NestData = .live, now: Date = Date()) {
        self.data = data
        financialYear = FinancialYear.containing(now)
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: MembersRows(), sources: MembersRows.sources(financialYear: financialYear),
            data: data)
        do {
            for try await snapshot in stream {
                state = .loaded(snapshot.rows, isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let rows = state.value {
                state = .loaded(rows, isRefreshing: false, refreshError: failure)
            } else {
                state = .failed(failure)
            }
        }
    }

    /// Discards the shown state and loads again.
    func retry() async {
        if state.value == nil { state = .loading }
        await load()
    }

    /// Upserts the member's profile for the year (updating the row for the member and
    /// year, else inserting one), then records their date of birth, then reloads.
    func save(_ submission: TaxProfileSubmission) async throws {
        let profile = submission.profile
        let updated = try await data.update(
            TaxProfile.self, values: profile,
            filters: [
                .eq("member_id", profile.memberID), .eq("financial_year", String(financialYear)),
            ])
        if updated.isEmpty {
            guard let household = state.value?.householdID else { throw NestError(.invalidRequest) }
            try await data.insert(
                TaxProfile.self,
                values: TaxProfileInsert(
                    householdID: household, financialYear: financialYear, input: profile))
        }
        try await data.call(
            "set_member_date_of_birth",
            params: DateOfBirthParams(memberID: profile.memberID, dateOfBirth: submission.dateOfBirth),
            invalidating: [Member.table])
        await load()
    }
}
