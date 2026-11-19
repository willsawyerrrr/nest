import Foundation

/// A whole-number field's text as an integer, `nil` when blank or not a whole number.
private func wholeNumber(_ text: String) -> Int? {
    Int(text.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces))
}

/// The grant form's fields as typed, and the rules turning them into an
/// `EquityGrantInput` as the PWA's `EquityGrantForm` does.
struct GrantDraft: Equatable, Sendable {
    var label = ""
    var instrumentType = EquityPresentation.option
    var quantity = ""
    /// ISO `YYYY-MM-DD`; `nil` until picked.
    var grantDate: String?
    var cliffMonths = "12"
    var vestingPeriodMonths = "48"
    var vestingFrequency = "monthly"
    var strikePrice = ""
    var pricePerShare = ""
    var priceAsOf: String?

    init(today: String) { grantDate = today }

    init(grant: EquityGrant) {
        label = grant.label
        instrumentType = grant.instrumentType
        quantity = String(Int(grant.quantity))
        grantDate = grant.grantDate
        cliffMonths = String(grant.cliffMonths)
        vestingPeriodMonths = String(grant.vestingPeriodMonths)
        vestingFrequency = grant.vestingFrequency
        strikePrice = PayslipDraft.dollars(grant.strikePriceCents)
        pricePerShare = PayslipDraft.dollars(grant.pricePerShareCents)
        priceAsOf = grant.priceAsOf
    }

    var isOption: Bool { instrumentType == EquityPresentation.option }

    /// A grant needs a label, a whole quantity, a grant date and a vesting period
    /// of at least a month.
    var canSubmit: Bool {
        !label.trimmingCharacters(in: .whitespaces).isEmpty
            && (wholeNumber(quantity).map { $0 >= 0 } ?? false) && grantDate != nil
            && (wholeNumber(vestingPeriodMonths) ?? 0) > 0
    }

    /// The input to save, or `nil` while the draft cannot be submitted. A blank
    /// cliff reads as none, a blank price per share as $0 and a share grant
    /// carries no strike.
    func input(memberID: String) -> EquityGrantInput? {
        guard canSubmit, let grantDate, let quantity = wholeNumber(quantity) else { return nil }
        return EquityGrantInput(
            memberID: memberID, label: label.trimmingCharacters(in: .whitespaces),
            instrumentType: instrumentType, quantity: quantity, grantDate: grantDate,
            cliffMonths: wholeNumber(cliffMonths) ?? 0,
            vestingPeriodMonths: wholeNumber(vestingPeriodMonths) ?? 1,
            vestingFrequency: vestingFrequency,
            strikePriceCents: isOption ? PayslipDraft.cents(strikePrice) : nil,
            pricePerShareCents: PayslipDraft.cents(pricePerShare) ?? 0, priceAsOf: priceAsOf)
    }
}

/// The exercise form's fields as typed, as the PWA's `EquityExerciseForm`.
struct ExerciseDraft: Equatable, Sendable {
    var grantID: String?
    var exercisedOn: String?
    var quantity = ""
    var strike: String
    var marketPrice = ""

    /// A new exercise against the first of `grants`, at its strike.
    init(grants: [EquityGrant], today: String) {
        grantID = grants.first?.id
        exercisedOn = today
        strike = PayslipDraft.dollars(grants.first?.strikePriceCents ?? 0)
    }

    init(exercise: EquityExercise) {
        grantID = exercise.grantId
        exercisedOn = exercise.exercisedOn
        quantity = String(Int(exercise.quantity))
        strike = PayslipDraft.dollars(exercise.strikePriceCents)
        marketPrice = PayslipDraft.dollars(exercise.marketPricePerShareCents)
    }

    /// Picks the grant; a new exercise takes the picked grant's strike.
    mutating func pick(_ grant: EquityGrant, adding: Bool) {
        grantID = grant.id
        if adding { strike = PayslipDraft.dollars(grant.strikePriceCents ?? 0) }
    }

    /// The options typed, or 0 while blank.
    var units: Int { wholeNumber(quantity) ?? 0 }

    /// The input to save, or `nil` while it cannot be: it needs a grant, a date,
    /// positive options, a strike and no `limitError`.
    func input(memberID: String, limitError: String?) -> EquityExerciseInput? {
        guard let grantID, let exercisedOn, units > 0, let strike = PayslipDraft.cents(strike),
            limitError == nil
        else { return nil }
        return EquityExerciseInput(
            memberID: memberID, grantID: grantID, exercisedOn: exercisedOn, quantity: units,
            strikePriceCents: strike, marketPricePerShareCents: PayslipDraft.cents(marketPrice))
    }
}

/// The sale form's fields as typed, as the PWA's `EquitySaleForm`.
struct SaleDraft: Equatable, Sendable {
    var grantID: String?
    var soldOn: String?
    var quantity = ""
    var price = ""
    var fee = PayslipDraft.dollars(0)

    /// A new sale from the first of `grants`.
    init(grants: [EquityGrant], today: String) {
        grantID = grants.first?.id
        soldOn = today
    }

    init(sale: EquitySale) {
        grantID = sale.grantId
        soldOn = sale.soldOn
        quantity = String(Int(sale.quantity))
        price = PayslipDraft.dollars(sale.pricePerShareCents)
        fee = PayslipDraft.dollars(sale.feeCents)
    }

    /// The shares typed, or 0 while blank.
    var units: Int { wholeNumber(quantity) ?? 0 }

    /// The input to save, or `nil` while it cannot be: it needs a grant, a date,
    /// positive shares, a price and no `limitError`.
    func input(memberID: String, limitError: String?) -> EquitySaleInput? {
        guard let grantID, let soldOn, units > 0, let price = PayslipDraft.cents(price),
            limitError == nil
        else { return nil }
        return EquitySaleInput(
            memberID: memberID, grantID: grantID, soldOn: soldOn, quantity: units,
            pricePerShareCents: price, feeCents: PayslipDraft.cents(fee) ?? 0)
    }
}

/// The units a grant's recorded exercises and sales have moved, as `@nest/household`'s
/// `grantHoldings`, and the PWA's `exerciseError` / `saleError` built on them.
enum EquityLimits {
    struct Holdings: Equatable {
        let exercised: Int
        let sold: Int
        let unexercised: Int
        let sellable: Int
    }

    /// `grant`'s holdings, leaving out the exercise `ignoreExercise` and the sale
    /// `ignoreSale` (the row being edited).
    static func holdings(
        _ grant: EquityGrant, exercises: [EquityExercise], sales: [EquitySale],
        ignoreExercise: String? = nil, ignoreSale: String? = nil
    ) -> Holdings {
        let exercised = exercises.filter { $0.grantId == grant.id && $0.id != ignoreExercise }
            .reduce(0) { $0 + Int($1.quantity) }
        let sold = sales.filter { $0.grantId == grant.id && $0.id != ignoreSale }
            .reduce(0) { $0 + Int($1.quantity) }
        let quantity = Int(grant.quantity)
        let isOption = grant.instrumentType == EquityPresentation.option
        return Holdings(
            exercised: exercised, sold: sold,
            unexercised: isOption ? max(0, quantity - exercised) : 0,
            sellable: max(0, (isOption ? exercised : quantity) - sold))
    }

    /// Why exercising `quantity` options cannot be saved, or `nil` when it can:
    /// exercised options cannot exceed the grant, nor fall below what has been sold.
    static func exerciseError(
        _ grant: EquityGrant, exercises: [EquityExercise], sales: [EquitySale], quantity: Int,
        ignoring id: String? = nil
    ) -> String? {
        let held = holdings(grant, exercises: exercises, sales: sales, ignoreExercise: id)
        if quantity > held.unexercised {
            return "Only \(EquityPresentation.count(held.unexercised)) options are left to exercise."
        }
        if held.exercised + quantity < held.sold {
            return "Exercised options cannot fall below the shares already sold."
        }
        return nil
    }

    /// Why selling `quantity` shares cannot be saved, or `nil` when it can: sold
    /// shares cannot exceed those exercised (an option grant) or granted (a share grant).
    static func saleError(
        _ grant: EquityGrant, exercises: [EquityExercise], sales: [EquitySale], quantity: Int,
        ignoring id: String? = nil
    ) -> String? {
        let held = holdings(grant, exercises: exercises, sales: sales, ignoreSale: id)
        return quantity > held.sellable
            ? "Only \(EquityPresentation.count(held.sellable)) shares are left to sell." : nil
    }
}
