import Foundation

/// Converts text as printed on a receipt into values, mirroring `money.ts` and the
/// shaping in `deduction-extract/fields.ts` so the on-device read and the server read
/// agree. Money is converted by integer arithmetic on the digit strings; anything not
/// unambiguously an amount or a calendar date is nil, never a guess.
enum PrintedText {
    private static let placeholders: Set<String> = [
        "", "-", "–", "—", ".", "null", "nil", "none", "n/a", "na", "notshown", "notstated",
        "notapplicable", "unknown",
    ]

    /// English month names, for dates printed with the month spelt out.
    static let months = [
        "january", "february", "march", "april", "may", "june", "july", "august", "september",
        "october", "november", "december",
    ]

    /// The most dollar digits held exactly once multiplied into cents.
    private static let maxDollarDigits = 13

    /// JavaScript's `\s`: what `money.ts` treats as whitespace.
    private static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F,
            0x3000, 0xFEFF:
            true
        default: false
        }
    }

    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool { ("0"..."9").contains(scalar) }

    private static func string<S: Sequence>(_ scalars: S) -> String where S.Element == Unicode.Scalar {
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars)
        return String(view)
    }

    /// The text without whitespace.
    static func squeezed(_ text: String) -> String {
        string(text.unicodeScalars.filter { !isSpace($0) })
    }

    /// Whether `text` is how a model says a field is absent.
    static func isPlaceholder(_ text: String) -> Bool {
        placeholders.contains(squeezed(text).lowercased())
    }

    /// Trims reported text, or nil when it is empty or a placeholder.
    static func readText(_ raw: String?) -> String? {
        guard let raw else { return nil }
        var scalars = Substring(raw).unicodeScalars
        while let first = scalars.first, isSpace(first) { scalars.removeFirst() }
        while let last = scalars.last, isSpace(last) { scalars.removeLast() }
        let text = String(scalars)
        return isPlaceholder(text) ? nil : text
    }

    /// The length in scalars of a leading `AUD`, `AU$`, `A$` or `$`, in any case.
    private static func currencyLength(_ text: ArraySlice<Unicode.Scalar>) -> Int? {
        let head = string(text.prefix(3)).lowercased()
        if head == "aud" || head == "au$" { return 3 }
        if head.hasPrefix("a$") { return 2 }
        return head.hasPrefix("$") ? 1 : nil
    }

    /// Text with leading currency marks removed, for matching an amount against a document.
    static func withoutCurrency(_ text: String) -> String {
        var scalars = ArraySlice(squeezed(text).unicodeScalars)
        while let length = currencyLength(scalars) { scalars = scalars.dropFirst(length) }
        return string(scalars)
    }

    /// Integer cents from printed money text, or nil when it is not unambiguously an amount.
    /// Handles thousands separators, `$` / `A$` / `AUD`, absent cents, and parenthesised,
    /// leading and trailing negatives.
    static func parseCents(_ raw: String?) -> Int? {
        guard let raw else { return nil }
        var text = ArraySlice(raw.unicodeScalars.filter { !isSpace($0) })
        if isPlaceholder(string(text)) { return nil }

        var negative = false
        if text.first == "(" && text.last == ")" {
            negative = true
            text = text.dropFirst().dropLast()
        }
        if text.last == "-" {
            if negative { return nil }
            negative = true
            text = text.dropLast()
        }

        var signed = negative
        while true {
            if let length = currencyLength(text) {
                text = text.dropFirst(length)
            } else if !signed, let first = text.first, first == "-" || first == "+" {
                signed = true
                negative = first == "-"
                text = text.dropFirst()
            } else {
                break
            }
        }

        guard text.contains(where: isDigit) else { return nil }
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return nil }

        var fraction = ""
        if parts.count == 2 {
            guard (1...2).contains(parts[1].count), parts[1].allSatisfy(isDigit) else { return nil }
            fraction = string(parts[1])
        }

        let whole = parts[0]
        var dollars: String
        if whole.contains(",") {
            let groups = whole.split(separator: ",", omittingEmptySubsequences: false)
            guard groups.count >= 2, (1...3).contains(groups[0].count),
                groups.dropFirst().allSatisfy({ $0.count == 3 }),
                groups.allSatisfy({ $0.allSatisfy(isDigit) })
            else { return nil }
            dollars = groups.map(string).joined()
        } else {
            guard whole.allSatisfy(isDigit) else { return nil }
            dollars = string(whole)
        }
        if dollars.isEmpty { dollars = "0" }
        guard dollars.drop(while: { $0 == "0" }).count <= maxDollarDigits,
            let wholeDollars = Int(dollars)
        else { return nil }

        let cents = wholeDollars * 100 + (Int(fraction.padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0)
        return negative && cents != 0 ? -cents : cents
    }

    /// An ISO `YYYY-MM-DD` date, or nil when the text is not a real calendar date.
    static func parseIsoDate(_ raw: String?) -> String? {
        guard let raw else { return nil }
        var scalars = Substring(raw).unicodeScalars
        while let first = scalars.first, isSpace(first) { scalars.removeFirst() }
        while let last = scalars.last, isSpace(last) { scalars.removeLast() }
        let parts = scalars.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
            parts.allSatisfy({ $0.allSatisfy(isDigit) }),
            let year = Int(string(parts[0])), let month = Int(string(parts[1])),
            let day = Int(string(parts[2])), (1...12).contains(month)
        else { return nil }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        guard (1...lengths[month - 1]).contains(day) else { return nil }
        return String(scalars)
    }
}

extension PrintedText {
    /// An ISO date from a date as printed on an Australian receipt: `DD/MM/YYYY` (also `-`
    /// and `.`, a two-digit year, or year first), `6 July 2025`, `Jul 6, 2025`, or ISO. A
    /// date with no year resolves inside `financialYear` (1 July before to 30 June).
    /// Nil when the text is not unambiguously a real calendar date.
    static func parseDate(_ raw: String?, financialYear: Int) -> String? {
        if let iso = parseIsoDate(raw) { return iso }
        guard let text = readText(raw) else { return nil }
        var numbers: [Substring] = []
        var months: [Int] = []
        for token in text.split(whereSeparator: { !($0.isASCII && ($0.isNumber || $0.isLetter)) }) {
            if token.allSatisfy(\.isNumber) {
                numbers.append(token)
            } else if token.allSatisfy(\.isLetter) {
                let word = token.lowercased()
                guard word.count >= 3,
                    let month = Self.months.firstIndex(where: { $0.hasPrefix(word) })
                else { return nil }
                months.append(month + 1)
            } else {
                return nil
            }
        }
        guard months.count <= 1 else { return nil }

        var day: Substring, year: Substring?
        var month: Int
        if let named = months.first {
            month = named
            switch numbers.count {
            case 1: day = numbers[0]
            case 2:
                let yearFirst = numbers[0].count == 4
                day = numbers[yearFirst ? 1 : 0]
                year = numbers[yearFirst ? 0 : 1]
            default: return nil
            }
        } else {
            switch numbers.count {
            case 2: (day, month) = (numbers[0], Int(numbers[1]) ?? 0)
            case 3:
                let yearFirst = numbers[0].count == 4
                day = numbers[yearFirst ? 2 : 0]
                month = Int(numbers[1]) ?? 0
                year = numbers[yearFirst ? 0 : 2]
            default: return nil
            }
        }
        guard day.count <= 2, let dayValue = Int(day) else { return nil }
        var yearValue: Int
        if let year {
            guard year.count == 2 || year.count == 4, let value = Int(year) else { return nil }
            yearValue = year.count == 2 ? 2000 + value : value
        } else {
            yearValue = month >= 7 ? financialYear - 1 : financialYear
        }
        func padded(_ value: Int, _ width: Int) -> String {
            String(repeating: "0", count: max(0, width - String(value).count)) + String(value)
        }
        return parseIsoDate("\(padded(yearValue, 4))-\(padded(month, 2))-\(padded(dayValue, 2))")
    }
}

/// The literal text the model reports for each receipt field, normalised as the server
/// does: trimmed, and a placeholder is absent.
struct RawReceiptFields: Equatable, Sendable {
    var isReceipt: Bool
    var notReceiptReason: String?
    var description: String?
    var deductionDate: String?
    var amount: String?

    init(
        isReceipt: Bool, notReceiptReason: String? = nil, description: String? = nil,
        deductionDate: String? = nil, amount: String? = nil
    ) {
        self.isReceipt = isReceipt
        self.notReceiptReason = PrintedText.readText(notReceiptReason)
        self.description = PrintedText.readText(description)
        self.deductionDate = PrintedText.readText(deductionDate)
        self.amount = PrintedText.readText(amount)
    }

    /// The fields converted to column-shaped values. With a `financialYear` a date may be
    /// printed in the receipt's own format; without one only ISO dates convert, as on the
    /// server.
    func reading(financialYear: Int? = nil) -> ReceiptReading {
        ReceiptReading(self, financialYear: financialYear)
    }
}

/// A receipt's fields converted from the reported text, with the fields that came back
/// empty or unconvertible named.
struct ReceiptReading: Equatable, Sendable {
    var description: String?
    var deductionDate: String?
    /// Signed, as the server reports it; a negative is not a receipt total.
    var amountCents: Int?
    /// Fields the receipt did not show.
    var missing: [String] = []
    /// Fields whose text was read but could not be converted safely.
    var unreadable: [String] = []

    init(_ raw: RawReceiptFields, financialYear: Int? = nil) {
        description = raw.description
        if let financialYear {
            deductionDate = PrintedText.parseDate(raw.deductionDate, financialYear: financialYear)
        } else {
            deductionDate = PrintedText.parseIsoDate(raw.deductionDate)
        }
        amountCents = PrintedText.parseCents(raw.amount)
        note("description", source: raw.description, value: description)
        note("deduction_date", source: raw.deductionDate, value: deductionDate)
        note("amount_cents", source: raw.amount, value: amountCents)
    }

    private mutating func note<Value>(_ key: String, source: String?, value: Value?) {
        guard value == nil else { return }
        if source == nil { missing.append(key) } else { unreadable.append(key) }
    }

    /// The values to pre-fill the form with; a negative amount is left blank.
    var extraction: DeductionExtraction {
        DeductionExtraction(
            description: description, deductionDate: deductionDate,
            amountCents: amountCents.flatMap { $0 >= 0 ? $0 : nil })
    }
}
