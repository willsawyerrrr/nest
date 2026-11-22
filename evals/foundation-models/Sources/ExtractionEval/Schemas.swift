import FoundationModels

/// The generated shapes mirror the edge functions' tool schemas, field for field, so a
/// result encodes (snake case) to the raw fields the server path's `readRawFields` reads.

@Generable
struct PayslipLine: Codable {
  @Guide(description: "The row's label exactly as printed.")
  var label: String
  @Guide(description: "Amount in the THIS PAY column as printed; omit if that column is empty.")
  var periodAmount: String?
  @Guide(description: "Amount in the YEAR TO DATE column as printed.")
  var ytdAmount: String?
  @Guide(description: "For tax rows: payg, or stsl for a study loan component; omit if unclear.")
  var component: String?
}

@Generable
struct PayslipFields: Codable {
  var isPayslip: Bool
  @Guide(description: "First day of the pay period as YYYY-MM-DD.")
  var periodStart: String?
  @Guide(description: "Last day of the pay period as YYYY-MM-DD.")
  var periodEnd: String?
  @Guide(description: "Payment date as YYYY-MM-DD.")
  var paidOn: String?
  @Guide(description: "Gross pay this period, as printed.")
  var gross: String?
  @Guide(description: "Total tax withheld this period, as printed: the TOTAL TAX figure.")
  var taxWithheld: String?
  @Guide(description: "Employer superannuation this period, as printed.")
  var `super`: String?
  @Guide(description: "Net pay this period, as printed.")
  var net: String?
  @Guide(description: "Salary-sacrificed super this period, as printed.")
  var salarySacrifice: String?
  @Guide(description: "Year-to-date gross, as printed.")
  var ytdGross: String?
  @Guide(description: "Year-to-date total tax withheld, as printed.")
  var ytdTaxWithheld: String?
  @Guide(description: "Year-to-date super, as printed.")
  var ytdSuper: String?
  @Guide(description: "Every earnings row, in order, never the TOTAL row.")
  var earningsLines: [PayslipLine]
  @Guide(description: "Every tax row, in order, never the TOTAL row.")
  var taxLines: [PayslipLine]
}

@Generable
struct ReceiptFields: Codable {
  var isReceipt: Bool
  @Guide(description: "The merchant name printed on the receipt; else what was purchased.")
  var description: String?
  @Guide(description: "The receipt date as YYYY-MM-DD.")
  var deductionDate: String?
  @Guide(description: "The total amount paid, as printed.")
  var amount: String?
}

@Generable
struct Trade: Codable {
  @Guide(description: "The ticker code alone, such as VAS.")
  var ticker: String?
  @Guide(description: "buy or sell.")
  var side: String?
  @Guide(description: "The trade date as YYYY-MM-DD.")
  var tradeDate: String?
  @Guide(description: "Units traded, as printed.")
  var units: String?
  @Guide(description: "Price per unit with every printed decimal place.")
  var pricePerUnit: String?
  @Guide(description: "Brokerage fee as printed.")
  var brokerageFee: String?
}

@Generable
struct TradeFields: Codable {
  var isTradeDocument: Bool
  @Guide(description: "One entry per buy or sell on the document.")
  var trades: [Trade]
}

/// What each extractor is told, condensed from the server prompts to the rules that matter.
enum Instructions {
  static let common = """
    Report only what the document prints, character for character, including separators and \
    currency signs. Never compute, convert or round a figure. Report dates as YYYY-MM-DD \
    (Australian documents write DD/MM/YYYY). Leave a field out when the document does not show it.
    """

  static func text(for kind: String, financialYear: Int) -> String {
    switch kind {
    case "payslip":
      return """
        You read Australian payslips. \(common) The financial year runs 1 July \(financialYear - 1) \
        to 30 June \(financialYear). Earnings and tax sections print a this-pay column beside a \
        year-to-date column: report each separately and never copy a year-to-date figure into this \
        pay; a row with an amount only in the year-to-date column has no period amount. If the \
        document is not a payslip, set isPayslip to false.
        """
    case "deduction":
      return """
        You read receipts and invoices. \(common) Report the total paid, not subtotals, GST, \
        cash tendered or change. If the document is not a receipt, set isReceipt to false.
        """
    default:
      return """
        You read broker contract notes and trade statements. \(common) List every buy and sell. \
        If the document is not a trade document, set isTradeDocument to false.
        """
    }
  }

  static func ask(for kind: String) -> String {
    switch kind {
    case "payslip": "Read this payslip and record its fields."
    case "deduction": "Read this receipt and record its fields."
    default: "Read this document and record its trades."
    }
  }
}
