/** Maps stored equity grants, exercises, and sales to the `@nest/tax` capital-gains engine's inputs. */

import {
  matchEquitySales,
  type EquityLotInput,
  type EquitySaleInput,
  type RealisedGain,
} from '@nest/tax'
import type { EquityRows } from '../rows.ts'

/**
 * The realised capital gains of every equity sale. An option grant's lots are its
 * exercises, each at the strike paid; a share grant's lot is the whole grant at
 * nil cost, since no tax arises on shares granted under the startup concession.
 * A sale's holding period runs from its grant's date.
 */
export function equitySaleGains({ grants, exercises, sales }: EquityRows): RealisedGain[] {
  const grantById = new Map(grants.map((grant) => [grant.id, grant]))
  const lots: EquityLotInput[] = []
  for (const grant of grants) {
    if (grant.instrument_type !== 'option') {
      lots.push({
        memberId: grant.member_id,
        grantId: grant.id,
        label: grant.label,
        grantDate: grant.grant_date,
        acquiredOn: grant.grant_date,
        units: grant.quantity,
        costPerUnitCents: 0,
      })
    }
  }
  for (const exercise of exercises) {
    const grant = grantById.get(exercise.grant_id)
    if (grant) {
      lots.push({
        memberId: exercise.member_id,
        grantId: grant.id,
        label: grant.label,
        grantDate: grant.grant_date,
        acquiredOn: exercise.exercised_on,
        units: exercise.quantity,
        costPerUnitCents: exercise.strike_price_cents,
      })
    }
  }
  const saleInputs: EquitySaleInput[] = sales.flatMap((sale) => {
    const grant = grantById.get(sale.grant_id)
    return grant
      ? [
          {
            memberId: sale.member_id,
            grantId: grant.id,
            label: grant.label,
            soldOn: sale.sold_on,
            units: sale.quantity,
            pricePerShareCents: sale.price_per_share_cents,
            feeCents: sale.fee_cents,
          },
        ]
      : []
  })
  return matchEquitySales(lots, saleInputs).gains
}
