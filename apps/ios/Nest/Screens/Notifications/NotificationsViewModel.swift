import Foundation
import Observation

/// Loads the member's notification preferences and members through the cache,
/// writes preferences, and sends the test notification.
@MainActor @Observable
final class NotificationsViewModel {
    /// The test send's outcome, shown under the controls.
    enum TestState: Equatable {
        case idle, sending
        case sent(String)
        case failed(String)
    }

    private(set) var state: ScreenState<NotificationsRows> = .loading
    private(set) var test: TestState = .idle
    /// Choices being saved, shown until the write settles.
    private(set) var pending: [NotificationTrigger: Bool] = [:]

    private let data: NestData

    init(data: NestData = .live) {
        self.data = data
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: NotificationsRows(), sources: NotificationsRows.sources, data: data)
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

    /// Turns a trigger on or off for the signed-in member, then reloads. A
    /// failed write leaves the switch as it was.
    func setEnabled(_ trigger: NotificationTrigger, _ next: Bool) async throws {
        pending[trigger] = next
        defer { pending[trigger] = nil }
        guard let rows = state.value, let userID = try? await data.userID(),
            let member = rows.member(userID: userID)
        else { throw NestError(.invalidRequest) }
        try await data.upsert(
            NotificationPreference.self,
            values: NotificationPreferenceUpsert(
                householdID: member.householdId, memberID: member.id, trigger: trigger,
                enabled: next),
            onConflict: NotificationPreferenceUpsert.onConflict)
        await load()
    }

    /// Sends a test push to every device the member has registered.
    func sendTest() async {
        test = .sending
        do {
            let result: PushTestResult = try await data.api.invoke("push-test")
            test = .sent(NotificationsPresentation.describe(result))
        } catch {
            test = .failed(NotificationsPresentation.testFailed)
        }
    }
}
