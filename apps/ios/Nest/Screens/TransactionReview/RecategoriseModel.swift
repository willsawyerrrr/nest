import Foundation
import Observation

/// The review notification's category picker: loads the transaction's choices,
/// then saves the member's pick with `NotificationRecategoriser`.
@MainActor @Observable
final class RecategoriseModel {
    enum State: Equatable {
        case loading
        case choosing(RecategoriseChoices)
        /// Saving the pick: a category id, or nil for uncategorised.
        case saving(RecategoriseChoices, categoryID: String?)
        case saved(message: String)
        /// A failed load (no choices) or save, with Nest's copy for it.
        case failed(RecategoriseChoices?, message: String)
    }

    private(set) var state: State = .loading
    private var transactionID: String?
    private let recategoriser: NotificationRecategoriser

    init(recategoriser: NotificationRecategoriser = NotificationRecategoriser()) {
        self.recategoriser = recategoriser
    }

    var isSaved: Bool {
        if case .saved = state { true } else { false }
    }

    /// Loads the choices for the notification's transaction, or fails when it
    /// names none.
    func load(transactionID: String?) async {
        self.transactionID = transactionID
        state = .loading
        guard let transactionID else {
            state = .failed(nil, message: Self.loadMessage(NestError(.notFound)))
            return
        }
        do {
            state = .choosing(try await recategoriser.choices(transactionID: transactionID))
        } catch {
            state = .failed(nil, message: Self.loadMessage(error))
        }
    }

    /// Saves `categoryID` (nil for uncategorised): picking the current category
    /// only marks the transaction reviewed.
    func pick(_ categoryID: String?) async {
        guard case .choosing(let choices) = state, let transactionID else { return }
        state = .saving(choices, categoryID: categoryID)
        let unchanged = categoryID == choices.currentID
        let outcome = await recategoriser.review(
            transactionID: transactionID, category: unchanged ? .unchanged : .set(categoryID))
        switch outcome {
        case .saved:
            state = .saved(message: Self.savedMessage(choices, categoryID, unchanged: unchanged))
        case .failed(let code):
            state = .failed(choices, message: ReviewFailure.message(code))
        }
    }

    /// Returns to the picker after a failed save, or loads again after a failed load.
    func retry() async {
        guard case .failed(let choices, _) = state else { return }
        if let choices {
            state = .choosing(choices)
        } else {
            await load(transactionID: transactionID)
        }
    }

    private static func savedMessage(
        _ choices: RecategoriseChoices, _ categoryID: String?, unchanged: Bool
    ) -> String {
        if unchanged { return "Marked reviewed." }
        let name = categoryID.flatMap { id in
            choices.groups.lazy.flatMap(\.items).first { $0.id == id }?.name
        }
        return name.map { "Moved to \($0) and marked reviewed." }
            ?? "Uncategorised and marked reviewed."
    }

    private static func loadMessage(_ error: Error) -> String {
        switch (error as? NestError)?.code {
        case .unauthenticated: "Open Nest to sign in, then try again."
        case .notFound: "Nest can no longer find this transaction."
        case let code?: NestError(code).userMessage
        case nil: NestError(.unknown).userMessage
        }
    }
}
