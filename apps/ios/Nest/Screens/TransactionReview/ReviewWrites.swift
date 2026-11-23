import Foundation

/// What a review does to the transaction's Up category.
enum ReviewCategory: Equatable, Sendable {
    /// Leaves Up's category as it is.
    case unchanged
    /// Sets the child category, or clears it with nil.
    case set(String?)
}

/// How a review ended: saved, or refused with the stable code that picks its copy.
enum ReviewOutcome: Equatable, Sendable {
    case saved
    case failed(code: String?)
}

/// The `up-categorise` request body.
struct UpCategoriseBody: Encodable, Sendable {
    let transactionId: String
    let categoryId: String?

    enum CodingKeys: String, CodingKey {
        case transactionId = "transaction_id"
        case categoryId = "category_id"
    }

    /// Encodes a nil category as an explicit `null`, which clears it on Up.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(transactionId, forKey: .transactionId)
        try container.encode(categoryId, forKey: .categoryId)
    }
}

/// The `review_transaction` parameters that mark a transaction reviewed.
struct ReviewTransactionParams: Encodable, Sendable {
    let transactionId: String
    /// The note to store (blank clears it); nil leaves the note as it is.
    var note: String?

    enum CodingKeys: String, CodingKey {
        case transactionId = "p_transaction_id"
        case note = "p_note"
    }
}

/// Nest's own copy for a failed review.
enum ReviewFailure {
    /// The message for a failure's code; never the upstream text.
    static func message(_ code: String?) -> String {
        switch code {
        case "invalid_request": "Nest could not send that change. Try again."
        case "transaction_not_found": "Nest can no longer find this transaction."
        case "not_up_transaction": "Only an Up transaction can be recategorised."
        case "not_categorisable": "Up does not let this transaction be categorised."
        case "unknown_category": "Up does not have that category. Pick another."
        case "parent_category": "Pick a subcategory: Up assigns only those to a transaction."
        case "server_error": "Something went wrong. Try again."
        case "up_not_connected": "Connect Up in Connections to change a category."
        case "up_auth_failed": "Up rejected your token. Reconnect Up in Connections."
        case "up_rate_limited": "Up is busy right now. Try again in a minute."
        case "up_transaction_not_found": "Up has no such transaction for your token."
        case "up_rejected": "Up would not accept that category for this transaction."
        case "up_unavailable": "Up is unavailable right now. Try again shortly."
        case "save_failed": "Saved in Up, but Nest couldn't update its copy. Try again."
        default: "Could not save this review. Try again."
        }
    }

    /// Whether a failure is fixed in Connections, so its message links there.
    static func needsConnections(_ code: String?) -> Bool {
        code == "up_not_connected" || code == "up_auth_failed"
    }
}
