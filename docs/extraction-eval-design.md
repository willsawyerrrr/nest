# Extraction eval design

Evals that choose, per document type, which model reads a document: Apple's
on-device Foundation Models, Private Cloud Compute (PCC) or a Claude model. The
harness, corpus and first results are in
[`on-device-extraction.md`](on-device-extraction.md); this document specifies
what to build and run next. Nothing here has been run, bar the noise pipeline
below, which renders but has not yet been scored.

## Arms

| Arm       | Model                                               | Context                      | Inputs                      | Notes                                                                    |
| --------- | --------------------------------------------------- | ---------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| On-device | `SystemLanguageModel` (`AFM 3 Core`)                | 8192 (OS 27), 4096 (OS 26.4) | PDF text, Vision OCR, image | Offline, private, free. Declines poorly, converts dates in code.         |
| PCC       | `PrivateCloudComputeLanguageModel`                  | 32768                        | PDF text, Vision OCR, image | Managed entitlement, per-user quotas, needs network.                     |
| Haiku 4.5 | `claude-haiku-4-5-20251001` (production pin)        | 200K                         | Native PDF, PNG             | $1 / $5 per MTok. Baseline every other arm is compared with.             |
| Haiku 5.5 | `claude-haiku-5-5`                                  | 1M                           | Native PDF, PNG             | $0.10 / $0.50 per MTok (prompts to 100K). Cheaper candidate replacement. |
| Sonnet    | `claude-sonnet-5-5`                                 | 1M                           | Native PDF, PNG             | $2 / $10. Mid-tier.                                                      |
| Opus      | `claude-opus-5-5`                                   | 1M                           | Native PDF, PNG             | $4 / $20. Quality ceiling candidate.                                     |
| Fable     | `claude-fable-5-2`                                  | 1M                           | Native PDF, PNG             | $8 / $40. Quality ceiling; 30-day retention required, no ZDR.            |
| Cascade   | On-device first, server when the native checks fail | n/a                          | As the first arm            | What the apps ship for receipts; scored as an arm of its own.            |

Model ids and prices are from the Claude API skill's model table (cached
2026-11-03); re-check before each run.

Claude arms need a runner change. The production extractors force a tool
(`tool_choice: { type: 'tool' }`), which Opus 5.5, Sonnet 5.5 and Fable 5.2
reject with a 400. The eval runner uses a `strict: true` tool with
`tool_choice: auto` and an instruction naming the tool (or
`output_config.format`), and re-runs Haiku 4.5 through the same mechanism so a
change in forcing is not mistaken for a change in model. Prompts, schemas and
validators are otherwise the production ones, held constant across arms.

## Decision criteria

Each criterion is a gate (pass or fail, no trading) or a weighted score. Gates
run first; only arms passing every gate are ranked.

| Criterion                      | Kind  | Measure                                                                       | Weight (receipt / payslip / trade) |
| ------------------------------ | ----- | ----------------------------------------------------------------------------- | ---------------------------------- |
| Wrong-but-confident rate       | Gate  | Fields filled, passing the app's checks, and wrong, per field filled          | n/a                                |
| Decline precision and recall   | Gate  | Non-documents declined; real documents not declined                           | n/a                                |
| Impact-weighted field accuracy | Score | Weighted exact-match rate (see Scoring)                                       | 40 / 40 / 40                       |
| Cascade fallback rate          | Gate  | Share of runs the arm cannot answer (context overflow, unavailable, quota)    | n/a                                |
| Stability across repeats       | Score | Field agreement over repeats                                                  | 10 / 10 / 10                       |
| Privacy                        | Score | On-device 3, PCC 2, server Claude 1 (documents already reach Anthropic today) | 15 / 15 / 15                       |
| Cost                           | Score | Dollars per 1000 documents, log-scaled against Haiku 4.5                      | 10 / 10 / 10                       |
| Latency                        | Score | p95 end to end on the target device (interactive for receipts)                | 15 / 10 / 10                       |
| Offline                        | Score | Works with no network                                                         | 5 / 10 / 10                        |
| Device and OS coverage         | Score | Share of the household's devices and OS versions where the arm is available   | 5 / 5 / 5                          |

A document type weights accuracy equally, but a receipt is read interactively
(latency counts more) while a payslip or trade document is usually read in a
bulk queue (offline and context headroom count more). Weights are reviewed
before the first run and frozen in the decision matrix; they are not tuned
after seeing results.

## Corpus

The 17 synthetic clean renders remain tier T0 (regression and parity). Four
tiers, by provenance:

| Tier | Contents                                                                        | Committed                        |
| ---- | ------------------------------------------------------------------------------- | -------------------------------- |
| T0   | The existing seeded clean renders                                               | Generator and labels             |
| T1   | Seeded synthetic documents under the perturbations and layouts below            | Generator, labels, manifest      |
| T2   | Layouts re-skinned from real documents: rows rebuilt by hand with seeded values | Generator and labels             |
| T3   | The household's real documents, labelled by hand                                | Never; scores only, in aggregate |

### Strata

| Type         | Layouts and content                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Receipt      | Thermal till, A4 invoice, e-receipt email PDF, DGR donation receipt, tax agent invoice, GST lines, cash tendered and change, tip, no merchant, foreign currency, handwritten                                                                                             |
| Payslip      | At least six employer layouts, 1 to 4 pages, column orders, year-to-date-only rows, salary sacrifice, STSL, leave loading, back pay, negative lines, super on a later page                                                                                               |
| Trade        | CommSec, SelfWealth, Stake, Pearler and IBKR layouts; sub-cent prices; 1, 10, 40 and 100 trades (the server cap); buy and sell; USD trades; brokerage including GST                                                                                                      |
| Non-document | Letters, bank statements, utility bills, menus, photos of screens or people, blank pages, prompt-injection text, password-protected or corrupt PDFs, image-only PDFs with no text layer, and every real document fed to the other two extractors (the cross-type matrix) |

Variants within each type: dates as `DD/MM/YYYY`, `5 Mar 2025`, `05-03-25` and
US order; `$`, `AUD` and foreign symbols; thousands separators; locales that
print `1.234,56`.

### Noise

Applied by a seeded pipeline (`supabase/functions/_eval/noise.ts`, applied by
`evals/foundation-models/Sources/ExtractionEval/Noise.swift`) and recorded in
`manifest.json` beside `corpus.json`: rotation (up to 15 degrees), perspective
skew, blur, low light and shadow, JPEG quality 30 to 60, scan speckle, partial
crop, two documents on one page (the page and its companion in the manifest,
the label that of the first), and photographed-screen moire.

Every clean document is made into four variants, `<id>.<profile>`, each with a
seed derived from the base seed, document id and profile. The TypeScript
decides every random choice and writes it to the entry, so a variant is
reproducible from its entry alone; Swift only applies the operations, in a fixed
order. Variants share their base document's label, and the clean T0 documents
and `corpus.json` are unchanged.

| Profile        | Operations                                                          | PDF text layer |
| -------------- | ------------------------------------------------------------------- | -------------- |
| `born-digital` | JPEG, and sometimes blur, on the PNG only                           | Yes            |
| `scan`         | Slight rotation, speckle, JPEG; sometimes crop, two-up, blur        | No             |
| `photo`        | Rotation, perspective, low light, JPEG; sometimes shadow, blur, crop | No             |
| `screen`       | Rotation, perspective, moire, blur, JPEG; sometimes low light, crop  | No             |

Each input path is produced from the same perturbed raster: the PNG is the
degraded raster, and for a photographed or scanned variant the PDF is that
raster alone, so the text layer exists only for documents that would have one
(born-digital PDFs); the others must go through OCR or image.

### Real documents without committing them

- Storage: `evals/local/` (git-ignored, outside any synced folder) holds the
  originals, labels and per-document outputs. `evals/out/` is git-ignored too.
  Nothing from T3 appears in a commit, PR, Linear issue or CI log.
- Consent: both household members agree to each of their own documents being
  used and to which arms may see them. Documents naming third parties (an
  employer, a donee, a counterparty) are used only after the third-party
  identifiers are redacted.
- Redaction for T3 arms that send documents off the machine (PCC, Claude):
  names, addresses, TFN, ABN, account and member numbers are painted out of the
  raster and removed from the text layer before sending. Figures and dates stay,
  because they are what is being read; so T3 results measure reading, and the
  labels never leave the machine.
- Re-skinning (T2) is the route to shareable evidence: transcribe a real
  document's layout into the corpus row format (labels, column order, fonts,
  page breaks), replace every value with seeded ones and re-derive the label.
- Labelling: one member labels, the other verifies a 20% sample; disagreements
  are resolved against the document. Labels are raw printed text, as today.
- Reporting: T3 results are published only as aggregates by stratum, never
  per document.

### Size

Rule of thumb for a paired comparison on document-level pass rate,
`MDE = 2.8 * sqrt(discordant / n)` (95% confidence, 80% power), with 20% of
documents discordant between two arms:

| Documents | Smallest detectable difference |
| --------- | ------------------------------ |
| 100       | 12.5 points                    |
| 200       | 8.9 points                     |
| 400       | 6.3 points                     |

A gate on an error rate needs zero events to bound it: 150 documents with no
wrong-but-confident field puts the 95% upper bound at 2% (rule of three).

| Type         | Target documents | Real source documents (T2 + T3) | Rationale                                                |
| ------------ | ---------------- | ------------------------------- | -------------------------------------------------------- |
| Receipt      | 200              | 40                              | Highest volume, widest layout spread                     |
| Payslip      | 100              | 20                              | Fewer layouts; the household has two employers over time |
| Trade        | 80               | 15                              | Long statements dominate difficulty                      |
| Non-document | 120              | 20                              | Declines gate adoption                                   |

The household has few distinct source layouts, and perturbed variants of one
source are correlated, so intervals resample by source document (clustered
bootstrap); the extra variants buy robustness to noise, not independent
samples. Where the real-source count limits power, a result reads as "not
distinguishable" and the cheaper, more private arm is not adopted on it.

## Input paths

| Arm                  | Paths                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On-device, PCC       | `pdftext` (PDFKit text), `ocr` (Vision `RecognizeDocumentsRequest`), `image` (iOS 27 `Attachment`)                                                        |
| On-device, PCC extra | `image-hires` (tiled or higher-resolution `image`), `ocr+image` (transcript plus image); PCC's 32K context is also tried on the 100-trade `pdftext` input |
| Claude               | `pdf` (native document block), `png` (image block), `text` (PDF text layer only, for a like-for-like cut against on-device)                               |

Born-digital documents are run through every path they support; photographed
and scanned documents have no `pdftext` path. The shipped path per document
class (text layer when present, else OCR) is scored as the `auto` path, which is
what a decision actually adopts. `image` on-device was unfit on the clean
corpus; it stays in the matrix to confirm that on PCC and with tiling, not as a
likely winner.

## Scoring

Scoring reuses the edge functions' `readRawFields` and `toExtraction`, so a
value is right exactly when the app would pre-fill it.

- Match: exact after normalisation (cents, ISO date, microdollars, upper-case
  ticker). Descriptions and line labels match by normalised containment, with
  token F1 reported alongside.
- Money tolerance: none for acceptance; a one-cent tolerance is reported as a
  diagnostic to separate rounding from misreading.
- Null is a label: a field printed nowhere must come back empty. Filling it is
  an error (spurious), as is leaving a printed field empty (missing).
- Dates: the strict ISO column gates the server arms. The "printed dates
  accepted" column is credited to an on-device arm only when the native path
  converts that format in code.
- Error classes per field: correct, missing, wrong, spurious, format. Wrong and
  spurious fields that pass the app's checks (printed-in-document, document
  looks like the type) are wrong-but-confident.
- Severe error: a wrong amount, gross, tax withheld, units, price or side, or
  any money error over 1% of the printed value or with the wrong sign.

`supabase/functions/_eval/score.ts` implements this (`outcomeOf`, one outcome
per field, line or trade). A `format` field is text read that could not be
converted, so the app leaves it empty; a run the app rejects as not the
extractor's kind (`declined`) or that failed answers none of a document's units,
so each is missing. Wrong-confident counts wrong and spurious fields over fields
the app would pre-fill; a field's own checks are the conversion in `fields.ts`
and the run claiming the document's kind. Lines (payslip earnings and tax) are
units of weight 3 matched as a multiset, with an unmatched expected line paired
with the most alike unmatched answer as wrong; a trade is one unit of weight 26
(its field weights summed).

### Impact weights

Weights follow what the field feeds downstream.

| Type    | Field weights                                                                                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt | Amount 5 (deduction), date 3 (financial year), description 1                                                                                                                                                |
| Payslip | Gross 5, tax withheld 5 (feeds `paygWithheldCents`), paid-on date 4 (financial year), super 3, salary sacrifice 3, earnings lines 3, tax lines 3 (component), net 2, period dates 2, year-to-date figures 2 |
| Trade   | Ticker 5, side 5, units 5, price 5, date 4 (12-month CGT discount), brokerage 2; a trade counts only when every field matches, and extra or missing trades are scored per trade                             |

### Calibration

The arms report no usable probability, so confidence is a proxy, evaluated
three ways: validators passing; agreement across repeats and across arms; and,
for Claude arms only, a self-reported 0 to 1 added to the schema as an
experiment. Report a reliability table and a risk-coverage curve per proxy: the
share of documents that can be accepted without review at 1% field error. The
cascade's value is this curve, not raw accuracy.

The proxies are `validatorConfidence` (all answered fields converted),
`agreementConfidence` (each run's fields against the other repeats, or against
the same document under the other arms) and a run's `confidence` field.
`riskCoverage` ranks documents by a proxy and reports impact-weighted field
error among those accepted; `coverageAtRisk` reads the share accepted at 1%;
`reliability` bins documents by confidence. Stability is `stability`: per
field, the share of repeats giving the commonest value, averaged over fields
and then documents. Engine results carry repeats in `repeats` (keyed as
`results`; `results` holds the first).

### Intervals

Paired, clustered bootstrap over source documents (10,000 resamples) for every
difference against Haiku 4.5; 95% percentile intervals; Holm correction across
the three types. Non-inferiority margin for adoption: the lower bound of the
impact-weighted accuracy difference is at least -3 points.

`stats.ts` implements `bootstrapDifference` (seeded, both arms re-scored on each
resample of source documents, keyed by a document's `source` and else its id),
`holm`, and `binomialUpper` (exact one-sided 95% bound on wrong-confident over
filled fields; 150 documents of three fields and no events bound it near 0.7%,
and the 15 receipt fields of the seeded corpus only near 18%). The p-value is
two-sided and the Holm adjustment is per arm across the three types.

## Run protocol

- Repeats: 5 per document for every arm; Claude arms at the API default
  sampling (the Messages API no longer accepts `temperature`, so none is
  set); Foundation Models once with greedy sampling and once at default, to
  separate model variance from sampling variance.
- Effort: Claude 5.x arms at `low`, `medium` and `high`, set explicitly (Opus
  5.5 defaults to `medium`); thinking left to the model. Haiku 4.5 has no
  effort. Token usage including thinking is recorded from `usage`.
- Held constant: prompts, tool schemas, financial-year hints, validators,
  corpus version and seed, and the extraction path. Each result records corpus
  hash, git commit, model id, OS build and `SystemLanguageModel` variant.
- Device matrix:

  | Device                                   | OS   | Why                                                      |
  | ---------------------------------------- | ---- | -------------------------------------------------------- |
  | Mac (Apple silicon)                      | 27.x | Where the harness runs today                             |
  | iPhone (eligible, Apple Intelligence on) | 27.x | Where receipts are read; latency and accuracy unmeasured |
  | iPhone                                   | 26.4 | 4096-token context and the older model                   |
  | iPhone (ineligible or AI off)            | any  | Confirms the cascade falls back, not that the arm works  |

- Latency is wall-clock from file in hand to validated result, including PDFKit
  or Vision, first-use model download and warm-up (reported separately from
  warm runs), with thermal state and low-power mode recorded. Claude latency
  includes upload.
- Cost per document comes from `usage` times the price table; on-device is
  zero; PCC is zero but quota-limited, so its quota use is recorded.
- Order: Haiku 4.5 baseline, on-device, PCC, larger Claude models. A run is
  void if the corpus hash changed mid-run.

## Acceptance thresholds

An arm is adopted for a document type only when every gate holds on that type's
corpus (T1 to T3 combined and T3 alone, which must also pass).

| Gate                           | On-device or PCC                                                                            | Larger Claude over Haiku 4.5                       |
| ------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Impact-weighted field accuracy | Lower 95% bound of difference from Haiku 4.5 at least -3 points, and at least 90% absolute  | Upper bound of difference above +3 points          |
| Wrong-but-confident            | Upper 95% bound at most 2% of filled fields, and no higher than Haiku 4.5's point estimate  | Same                                               |
| Severe errors on amount fields | Zero in the corpus                                                                          | Zero                                               |
| Decline                        | At least 95% of non-documents declined; at most 2% of real documents declined               | Same                                               |
| Cannot-answer rate             | At most 10% on the target device (context overflow, unavailable, quota); the rest fall back | n/a                                                |
| Stability                      | At least 98% field agreement over repeats                                                   | Same                                               |
| Latency                        | Receipt p95 at most 15 s on iPhone; payslip and trade p95 at most 30 s                      | p95 at most 30 s                                   |
| Cost (larger Claude only)      | n/a                                                                                         | Added cost justified by the measured accuracy gain |

Decision rule per type: take the first arm that passes, in the order on-device,
PCC, Haiku 4.5 or Haiku 5.5, Sonnet, Opus, Fable. A cascade is adopted over its
first arm when it passes the gates and the risk-coverage curve shows a higher
auto-accept share at 1% error. If no on-device or PCC arm passes, that type
stays on the server, and the failing gate is recorded. Trade documents are
expected to need PCC or the server (up to 12K output tokens against an 8192
context); the eval confirms or refutes that.

## Decision matrix

Filled in per type after the runs. Weighted scores rank only arms that pass
every gate; failed gates are named, not scored.

`report.ts <dir> --baseline <engine>` prints the matrix (`decisionMatrix`) from
the results, plus `<dir>/profiles.json` mapping each engine to an `ArmProfile`
(tier `local` or `claude`, privacy 1 to 3, offline, `costPer1000` by extractor,
device coverage). A gate that cannot be measured from the results (decline
without non-documents, stability without repeats, accuracy without the
baseline) is shown with a `?` and does not pass. The score scales each
criterion to 0 to 1 and applies the weights above: accuracy as measured,
stability as measured, privacy as 3, 2, 1 over 3, cost 0.5 at Haiku 4.5's cost
and 1 at a tenth of it or free (log scale, 0 at ten times), latency as one
minus p95 over the type's limit, offline and coverage as stated. Run the report
over T3 alone as well as over the whole corpus; the gates apply to each.

| Arm        | Accuracy (CI) | Wrong-confident (upper) | Decline | Cannot-answer | p95 latency | $/1000 | Offline | Coverage | Gates | Score |
| ---------- | ------------- | ----------------------- | ------- | ------------- | ----------- | ------ | ------- | -------- | ----- | ----- |
| On-device  |               |                         |         |               |             | 0      | yes     |          |       |       |
| PCC        |               |                         |         |               |             | 0      | no      |          |       |       |
| Cascade    |               |                         |         |               |             |        |         |          |       |       |
| Haiku 4.5  |               |                         |         |               |             |        | no      |          |       |       |
| Haiku 5.5  |               |                         |         |               |             |        | no      |          |       |       |
| Sonnet 5.5 |               |                         |         |               |             |        | no      |          |       |       |
| Opus 5.5   |               |                         |         |               |             |        | no      |          |       |       |
| Fable 5.2  |               |                         |         |               |             |        | no      |          |       |       |

Outcome per type: chosen arm, runner-up, failing gates, and the date, corpus
hash and commit the decision rests on.

## Cost model

Per document, `cost = input_tokens * input_price + output_tokens * output_price`,
with thinking billed as output. Assumed profile until `usage` replaces it:

| Type    | Input tokens (PDF plus text) | Output tokens |
| ------- | ---------------------------- | ------------- |
| Receipt | 2,000                        | 200           |
| Payslip | 5,000                        | 800           |
| Trade   | 8,000                        | 1,500         |

Dollars per 1000 documents, excluding thinking:

| Model      | Receipt | Payslip | Trade  |
| ---------- | ------- | ------- | ------ |
| Haiku 4.5  | 3.00    | 9.00    | 15.50  |
| Haiku 5.5  | 0.30    | 0.90    | 1.55   |
| Sonnet 5.5 | 6.00    | 18.00   | 31.00  |
| Opus 5.5   | 12.00   | 36.00   | 62.00  |
| Fable 5.2  | 24.00   | 72.00   | 124.00 |

Thinking on the 5.x models can multiply output several times, so measured cost
is reported per completed document at each effort level. Batch pricing does not
apply to the interactive path. Running the whole Claude matrix (about 400
documents, 5 repeats, three effort levels for 5.x arms) is estimated at tens of
dollars for the Haiku and Sonnet arms and low hundreds with Opus and Fable; the
runner prints a projected cost from the manifest and requires confirmation
before spending.

## What blocks each arm today

| Arm              | Blocker                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On-device Mac    | None; runs on macOS 27.2 today                                                                                                                                    |
| On-device iPhone | A host app (test target) to run the harness on device; eligible device on iOS 27 and iOS 26.4; Apple Intelligence on; eligibility list is unconfirmed             |
| PCC              | Managed entitlement (the unsigned command-line tool fails with `ModelManagerError` 1046, untested as the cause); a signed host app; per-user quotas bound repeats |
| Haiku 4.5, 5.5   | An Anthropic API key (none was available for the first run); Haiku 5.5 behaviour with the production tool schema unverified                                       |
| Sonnet, Opus     | API key; runner without forced `tool_choice`                                                                                                                      |
| Fable            | API key on an organisation with 30-day retention (no ZDR); household documents leave the device, so T3 needs redaction and consent first                          |
| Real corpus      | Both members' consent, the labelling tool and the redaction step                                                                                                  |

## Phases

| Phase | Work                                                                                                                    | Blocked by                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 0     | Scorer v2 and Claude multi-model runner; Haiku 4.5 baseline on the existing corpus                                      | API key                    |
| 1     | Noise pipeline and layout, locale and adversarial strata (T1); on-device Mac arm on T0 and T1                           | Phase 0 scorer             |
| 2     | Local real-document workflow, re-skinned layouts (T2) and labelled real documents (T3)                                  | Consent                    |
| 3     | iPhone and OS 26.4 on-device runs; PCC arm; larger Claude arms                                                          | Host app, entitlement, key |
| 4     | Apply gates, fill the decision matrix per type, record the outcome in the extraction docs and on the PCC decision issue | Phases 1 to 3              |

Follow-up issues, each one shippable change:

1. Add a seeded noise pipeline to the synthetic corpus renderer.
2. Add layout, locale, long-statement and adversarial strata to the synthetic corpus.
3. Add a local real-document corpus workflow with labelling, redaction and consent.
4. Score extraction with null-correctness, wrong-but-confident, risk-coverage, repeats and clustered bootstrap.
5. Run the Claude arms across models and effort levels with usage and cost capture.
6. Run Foundation Models with repeats, greedy and default sampling and device metadata.
7. Add an eval host app to run the on-device and PCC arms on iPhone and OS 26.4.
8. Request the PCC managed entitlement for the eval host app.
9. Decide the extraction model per document type from the eval results.
