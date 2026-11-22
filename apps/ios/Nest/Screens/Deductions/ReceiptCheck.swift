import Foundation

/// Tests a model's reading of a receipt against the text it was given. A small model can
/// invent a plausible figure, so each value it reports must be traceable to the document;
/// anything that is not leaves the document to the server.
enum ReceiptCheck {
    /// Words a receipt or invoice prints beside what was paid.
    private static let receiptWords = [
        "total", "invoice", "receipt", "gst", "amount paid", "amount due", "donation",
    ]

    /// Phrases that mark a statement of account, which is never a receipt.
    private static let statementMarks = ["opening balance", "closing balance"]

    /// What is doubtful about `raw` read from `text`, empty when it can be trusted. The model
    /// does not reliably decline other documents, so the text must look like a receipt, show
    /// an amount, and every value read must be found in it.
    static func doubts(_ raw: RawReceiptFields, in text: String, financialYear: Int) -> [String] {
        let reading = raw.reading(financialYear: financialYear)
        var doubts = reading.unreadable.map { "\($0) could not be converted" }
        let lowered = text.lowercased()
        if !receiptWords.contains(where: lowered.contains)
            || statementMarks.contains(where: lowered.contains)
        {
            doubts.append("the document does not look like a receipt")
        }
        if reading.amountCents == nil && !reading.unreadable.contains("amount_cents") {
            doubts.append("no amount was read")
        }
        if let cents = reading.amountCents, cents < 0 { doubts.append("amount_cents is negative") }

        if let description = raw.description, !contains(description, in: text) {
            doubts.append("description is not in the document")
        }
        if let amount = raw.amount, reading.amountCents != nil,
            !PrintedText.withoutCurrency(text).lowercased().contains(
                PrintedText.withoutCurrency(amount).lowercased())
        {
            doubts.append("amount is not in the document")
        }
        if let date = reading.deductionDate, let printed = raw.deductionDate,
            !dateIsPrinted(printed, iso: date, in: text, financialYear: financialYear)
        {
            doubts.append("deduction_date is not in the document")
        }
        return doubts
    }

    /// Whether `value` appears in `text`, ignoring case, accents and spacing.
    private static func contains(_ value: String, in text: String) -> Bool {
        func folded(_ string: String) -> String {
            PrintedText.squeezed(string).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        }
        return folded(text).contains(folded(value))
    }

    /// Whether a date is printed in `text`. A date reported as printed must appear as
    /// written. One the model converted to ISO must appear in a numeric form with day, month
    /// and year in that order (`06/07/2025`, `6-7-25`), or with a month name beside its
    /// day, and a year unless the date falls inside the financial year.
    private static func dateIsPrinted(
        _ raw: String, iso: String, in text: String, financialYear: Int
    ) -> Bool {
        let flat = PrintedText.squeezed(text).lowercased()
        if PrintedText.parseIsoDate(raw) == nil {
            return flat.contains(PrintedText.squeezed(raw).lowercased())
        }
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return false }
        let (year, month, day) = (parts[0], parts[1], parts[2])
        let inYear = iso >= "\(financialYear - 1)-07-01" && iso <= "\(financialYear)-06-30"

        func pad(_ value: Int) -> String { value < 10 ? "0\(value)" : "\(value)" }
        let days = Set([pad(day), "\(day)"]), months = Set([pad(month), "\(month)"])
        var years = [String(year), pad(year % 100)]
        if inYear { years.append("") }
        for separator in ["/", "-", "."] {
            for day in days {
                for month in months {
                    for year in years {
                        let tail = year.isEmpty ? "" : separator + year
                        if flat.contains(day + separator + month + tail) { return true }
                    }
                }
            }
        }

        let runs = text.split(whereSeparator: { !("0"..."9").contains($0) })
            .map { (value: Int($0) ?? -1, length: $0.count) }
        let words = text.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init)
        let namePrinted = words.contains { $0.count >= 3 && PrintedText.months[month - 1].hasPrefix($0) }
        let yearPrinted = runs.contains {
            ($0.length == 4 && $0.value == year) || ($0.length == 2 && $0.value == year % 100)
        }
        return namePrinted && runs.contains { $0.value == day && $0.length <= 2 }
            && (yearPrinted || inYear)
    }
}
