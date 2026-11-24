# On-device extraction evaluation

Compares the server extraction path (`payslip-extract`, `deduction-extract`,
`trade-extract`, Claude Haiku 4.5 with a forced tool schema) with Apple
Foundation Models over one labelled corpus. The harness lives in two places:

- `supabase/functions/_eval/`: the corpus and its labels (`corpus.ts`), the
  Haiku runner (`haiku.ts`), the scorer (`score.ts`) and the report
  (`report.ts`). Deno, covered by the `functions` CI job.
- `evals/foundation-models/`: a Swift package (macOS 27) that renders the
  corpus (`render`), prints SDK facts (`facts`) and runs Foundation Models
  (`run`). Not built in CI; it needs a Mac with Apple Intelligence.

## Corpus

Synthetic and seeded: no real payslip, receipt or contract note is stored, and
none belongs in git. Each document is a table of printed rows rendered to a PDF
(with a text layer) and a 150 dpi PNG. It holds 6 payslips (STSL component,
first pay of the year where year-to-date equals the period, a row printed
year-to-date only, salary sacrifice, no super and no year-to-date columns), 5
receipts (invoice date beside a due date, cash tendered and change, no
merchant), 4 trade documents (one to three trades, and a 40-trade statement) and
2 documents of none of these kinds, which every extractor must decline.

A label is the raw text an ideal extractor reports. Engines and labels are
scored through the edge functions' own `readRawFields` and `toExtraction`, so a
figure is right exactly when the app would pre-fill the same value (cents, ISO
date, microdollars). A payslip is scored per field plus its earnings and tax
lines (the year-to-date-only row must not appear), a receipt per field, a trade
document per whole trade. Extras are counted as spurious, not subtracted. A
second column accepts dates printed `DD/MM/YYYY`, separating a misread date from
one the model returned in the wrong format, which on-device code could convert.

`report.ts` also prints, per engine and extractor, impact-weighted accuracy,
error classes (correct, missing, wrong, spurious, format), wrong-confident and
severe errors, stability over repeats and risk-coverage under each confidence
proxy, and a decision matrix against a baseline engine; see
[`extraction-eval-design.md`](extraction-eval-design.md#scoring).

`corpus.ts` also writes `manifest.json`: 68 noisy variants (each document as
`born-digital`, `scan`, `photo` and `screen`) derived from the clean documents
by a seeded pipeline and sharing their labels. `render` writes each as
`files/<id>.<profile>.pdf` and `.png`; only `born-digital` variants have a PDF
text layer. See [`extraction-eval-design.md`](extraction-eval-design.md#noise).
`run` and the scorer read only `corpus.json`, so variants are not yet scored.

Real documents for local runs go under `evals/local/` and `evals/out/`, both
git-ignored.

## Running

```sh
deno run --allow-write supabase/functions/_eval/corpus.ts evals/out
swift run --package-path evals/foundation-models ExtractionEval render evals/out
swift run --package-path evals/foundation-models ExtractionEval run evals/out pdftext
swift run --package-path evals/foundation-models ExtractionEval run evals/out ocr
swift run --package-path evals/foundation-models ExtractionEval run evals/out image
swift run --package-path evals/foundation-models ExtractionEval run evals/out image-hires
swift run --package-path evals/foundation-models ExtractionEval run evals/out ocr+image --repeats 5
swift run --package-path evals/foundation-models ExtractionEval run evals/out pdftext --repeats 5 --sampling greedy
deno run --allow-env --allow-read --allow-write --allow-net --allow-run=git \
  supabase/functions/_eval/haiku.ts evals/out --dry-run        # projected cost only, no key
ANTHROPIC_API_KEY=… deno run --allow-env --allow-read --allow-write --allow-net \
  --allow-run=git supabase/functions/_eval/haiku.ts evals/out --media pdf,png
deno run --allow-read supabase/functions/_eval/report.ts evals/out --baseline claude-haiku-4-5-pdf
```

`run` takes `--model system|pcc`, `--sampling default|greedy` (default
`default`), `--repeats <n>` (default 1) and `--only <id>,<id>`. The inputs:

| Path | Input to the model |
| -- | -- |
| `pdftext` | The PDF's text layer, via PDFKit |
| `ocr` | Vision `RecognizeDocumentsRequest` transcript of the PNG |
| `image` | The PNG as an iOS 27 `Attachment` |
| `image-hires` | The PNG cut into four full-width bands overlapping by 10%, each its own `Attachment` |
| `ocr+image` | The `ocr` transcript and the PNG as an `Attachment` |

Results go to `results/fm-<model>-<path>.json`, or `…-greedy.json` for greedy
sampling. Each result is its first repeat, so the scorer reads it unchanged,
plus `runs`, every repeat, which the report scores as repeats (stability, and a
cold/warm latency table). Every run records `repeat`, `sampling`, `ms`,
`timing` (`cold` for the process's first generation, which pays model load and
warm-up, else `warm`), `thermalState`, `lowPowerMode`, `osBuild`, `osVersion`,
`modelVariant` and `contextSize`; the file's `device` repeats the constant ones.

The Vision OCR model downloads on first use, taking about 80 seconds, so a
first `ocr` run looks hung.

## Confirmed against the SDK

Source: the iOS 27.2 SDK's `FoundationModels` module interface, the Xcode
documentation, and `ExtractionEval facts` run on macOS 27.2.1 (Xcode 27.2).

- Context size: `SystemLanguageModel.contextSize` is a hard-coded 4096 before
  iOS 27 (back-deployed from 26.4) and 8192 at runtime on 27.2. It counts the
  prompt, instructions, schema and the answer together. The on-device model
  reports variant `AFM 3 Core`; the SDK also names `coreAdvanced3`.
- Private Cloud Compute: `PrivateCloudComputeLanguageModel.contextSize` is
  32768 at runtime (async, throwing). Apple's docs require a managed entitlement
  to develop against it, and it has per-user quotas.
- Image input: `Attachment` with `ImageAttachmentContent` (from a `CGImage`,
  `CIImage`, `CVPixelBuffer` or URL) is iOS, macOS and visionOS 27.0 and later.
  `LanguageModelCapabilities.vision` is true for the on-device and Private Cloud
  Compute models on this machine. There is no PDF input: PDFs go through PDFKit
  text or are rasterised.
- Token budgeting: `SystemLanguageModel.tokenCount(for:)` is 26.4 and later, for
  prompts, instructions, tools and schemas.
- Availability: `.unavailable` carries `deviceNotEligible`,
  `appleIntelligenceNotEnabled` or `modelNotReady`.

## Not confirmed

- Eligible devices: the SDK and its documentation give no list; they point to
  Apple's Apple Intelligence page. `availability` is the runtime check.
- Private Cloud Compute extraction: the harness's PCC runs fail before
  generating, with `ModelManagerServices.ModelManagerError` code 1046, though
  `availability` reads `available`. The unsigned command-line tool holds no
  managed entitlement, which is the likely cause but is untested.
- iPhone behaviour: every figure below is from a Mac. Latency and the on-device
  model's accuracy on iPhone hardware are unmeasured.
- Claude arms on this corpus: not run, as no Anthropic key was available.
  `haiku.ts` runs the production prompts and tools on every Claude arm (see
  Claude arms below). The comparison is open until it runs.

## Claude arms

`haiku.ts <dir>` runs the production extractors' prompts, tools and field
readers on Haiku 4.5, Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.2. Opus 5.5,
Sonnet 5.5 and Fable 5.2 reject a forced `tool_choice`, so every arm, Haiku 4.5
included, gets a `strict` tool, `tool_choice: auto` and a system instruction
naming the tool. No `temperature`, `top_p` or `top_k` is sent. Haiku 5.5, Sonnet
5.5 and Opus 5.5 send adaptive thinking; Fable thinks always and takes no
`thinking` parameter; every 5.x arm sets `output_config.effort` explicitly.
Thinking arms get 8,000 output tokens beyond the production cap.

Flags: `--arms` (default all), `--efforts` (default `low,medium,high`, 5.x arms
only), `--media` (default `pdf,png,text`), `--repeats` (default 5), `--only`,
`--dry-run` (print the projection and stop) and `--force` (rerun an engine whose
results exist; otherwise it is skipped). `text` reads `<dir>/files/<id>.txt`, the
PDF's text layer (for example `pdftotext -layout`), and sends it inline as the
on-device `pdftext` path does.

The runner prints a projected cost from `corpus.json` at the design's assumed
token profile, excluding thinking, and spends nothing until `yes` is typed.
Each engine writes `results/claude-<arm>[-<effort>]-<media>.json`: the scorer's
`results` and `repeats`, plus per run `effort`, `inputTokens`, `outputTokens`
(thinking included, as billed), `costNanoUsd` (integer nanodollars from the
price table), `stopReason` and `ms` (including SDK retries), and `meta` with the
model id, corpus SHA-256 and git commit.

## Results

Foundation Models on-device (`AFM 3 Core`), one run per document, macOS 27.2.1.
"Correct" counts fields, lines and whole trades; see Corpus.

| Path | Extractor | Correct | Printed dates accepted | Spurious | Failed | Median ms | Max prompt tokens |
| -- | -- | -- | -- | -- | -- | -- | -- |
| pdftext | payslip | 79/87 (91%) | 79/87 (91%) | 2 | 0/8 | 6590 | 1034 |
| pdftext | deduction | 13/17 (76%) | 14/17 (82%) | 0 | 0/7 | 1306 | 366 |
| pdftext | trade | 42/47 (89%) | 47/47 (100%) | 5 | 0/6 | 2017 | 1309 |
| ocr | payslip | 61/87 (70%) | 61/87 (70%) | 2 | 0/8 | 8817 | 1056 |
| ocr | deduction | 13/17 (76%) | 13/17 (76%) | 0 | 0/7 | 1466 | 372 |
| ocr | trade | 2/47 (4%) | 6/47 (13%) | 5 | 1/6 | 5770 | 509 |
| image | payslip | 7/87 (8%) | 7/87 (8%) | 12 | 0/8 | 10652 | 911 |
| image | deduction | 4/17 (24%) | 4/17 (24%) | 0 | 0/7 | 3482 | 406 |
| image | trade | 2/47 (4%) | 2/47 (4%) | 45 | 0/6 | 4579 | 522 |

What they show:

- A text layer is the viable input. Reading the PDF's text, payslips and trade
  documents are mostly right. The receipt misses are two dates (one printed
  `DD/MM/YYYY`, one omitted from the invoice that also prints a due date) and
  two unrelated documents read as receipts.
- Image input reads small print unreliably: it returned plausible figures that
  are not on the page (spurious payslip lines, invented trades). Treat it as
  unfit for figures until a higher-resolution or tiled input is shown to work.
- OCR is only as good as the transcript. The transcript flattens columns and can
  carry stray characters (a date followed by junk). The 40-trade statement
  overflowed the context by 2 tokens (8194 of 8192), and most of the OCR trade
  shortfall is that one document.
- The 40-trade statement fit as PDF text and all 40 trades came back. 100
  trades, the server cap, was not tried.
- The on-device model does not reliably decline other documents. With PDF text
  the letter was read as a payslip and as a receipt, and the bank statement as a
  receipt; both were rightly declined as trade documents.
- The model often prints dates as `DD/MM/YYYY` despite an ISO instruction, so an
  on-device path needs to convert dates in code.

The results above are for the clean digital renders. Photographed or scanned
documents will be harder for every path, so these figures are an upper bound;
the noisy variants exist to measure that but have not been run.

## Native receipt path

The native apps' receipt extractor follows these findings: the PDF text layer or
Vision OCR as input (never image input), dates converted in Swift, explicit
checks that the document looks like a receipt and that every value read is
printed in it, and a context-window guard, with the server as the fallback. The
corpus's receipts and non-receipts are frozen as
`apps/ios/NestTests/Fixtures/deduction-corpus-parity.json`; see
[`native-screens.md`](native-screens.md#uploads).
