import Foundation
import SwiftUI

/// Which way a money figure points; the single source of its colour.
enum MoneySign: Equatable, Sendable {
    case positive, negative, zero

    init(cents: Int) {
        self = cents > 0 ? .positive : cents < 0 ? .negative : .zero
    }

    /// The text colour for the sign; `nil` inherits the neutral colour for zero.
    var color: Color? {
        switch self {
        case .positive: NestColor.positive
        case .negative: NestColor.negative
        case .zero: nil
        }
    }
}

/// AU currency formatting for integer cents, mirroring `lib/money.ts`.
enum MoneyFormat {
    /// `$1,234.56`, or `-$1,234.56` for a negative amount.
    static func cents(_ cents: Int) -> String {
        (Decimal(cents) / 100).formatted(.currency(code: "AUD").locale(Locale(identifier: "en_AU")))
    }

    /// Abbreviated whole dollars for dense labels: `$0`, `$500`, `$50k`,
    /// `$1.2M`, `-$50k`. At most one decimal, with a trailing `.0` trimmed.
    static func compact(cents: Int) -> String {
        let dollars = Double(cents) / 100
        let sign = dollars < 0 ? "-" : ""
        let magnitude = abs(dollars)
        if magnitude >= 1_000_000 { return "\(sign)$\(trimmed(magnitude / 1_000_000))M" }
        if magnitude >= 1_000 { return "\(sign)$\(trimmed(magnitude / 1_000))k" }
        return "\(sign)$\(Int(magnitude.rounded()))"
    }

    /// `$1,234.56 / fn`.
    static func perFortnight(_ cents: Int) -> String { "\(Self.cents(cents)) / fn" }

    /// `$1,234.56 / year`.
    static func perYear(_ cents: Int) -> String { "\(Self.cents(cents)) / year" }

    private static func trimmed(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
    }
}
