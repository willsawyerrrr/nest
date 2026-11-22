/**
 * The eval corpus's receipts and non-receipts as the native on-device reading is held to
 * them: the text a PDF's text layer holds, the label an ideal extractor reports, and what
 * the app pre-fills from that label. Frozen in
 * `apps/ios/NestTests/Fixtures/deduction-corpus-parity.json`; `fields_parity_test.ts`
 * fails when the corpus and the file drift apart.
 */

import { buildCorpus } from '../_eval/corpus.ts'
import { toExtraction } from './fields.ts'

export function corpusFixture() {
  return buildCorpus().flatMap((doc) => {
    if (doc.kind !== 'deduction' && doc.kind !== 'other') return []
    const text = doc.rows.map((row) => row.join('  ')).join('\n')
    if (doc.kind === 'other') return [{ id: doc.id, financialYear: doc.financialYear, text }]
    const { fields } = toExtraction(doc.label)
    return [{
      id: doc.id,
      financialYear: doc.financialYear,
      text,
      label: {
        description: doc.label.description,
        deductionDate: doc.label.deduction_date,
        amount: doc.label.amount,
      },
      expected: {
        description: fields.description,
        deductionDate: fields.deduction_date,
        amountCents: fields.amount_cents,
      },
    }]
  })
}

if (import.meta.main) console.log(JSON.stringify(corpusFixture(), null, 2))
