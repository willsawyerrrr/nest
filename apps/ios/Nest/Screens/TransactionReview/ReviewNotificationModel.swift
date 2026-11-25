import Foundation
import Observation

/// The expanded review notification's state: the transaction's current
/// category, loaded with `ReviewNotificationLoader`.
@MainActor @Observable
final class ReviewNotificationModel {
    enum State: Equatable {
        case loading
        case loaded(ReviewNotificationSummary)
        case failed(message: String)
    }

    private(set) var state: State = .loading
    private let loader: ReviewNotificationLoader

    init(loader: ReviewNotificationLoader = ReviewNotificationLoader()) {
        self.loader = loader
    }

    /// Loads the notification's transaction, or fails when it names none.
    func load(transactionID: String?) async {
        state = .loading
        guard let transactionID else {
            state = .failed(message: Self.message(NestError(.notFound)))
            return
        }
        do {
            state = .loaded(try await loader.summary(transactionID: transactionID))
        } catch {
            state = .failed(message: Self.message(error))
        }
    }

    private static func message(_ error: Error) -> String {
        switch (error as? NestError)?.code {
        case .unauthenticated: "Open Nest to sign in, then try again."
        case .notFound: "Nest can no longer find this transaction."
        case let code?: NestError(code).userMessage
        case nil: NestError(.unknown).userMessage
        }
    }
}
