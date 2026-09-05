# Document intake

Letting a payslip or deduction receipt reach Nest from **outside the PWA** —
shared straight from Mail, Files, or a scanned document, without opening the
app first. A member mints a bearer token from the Connections settings page, builds a
one-off iOS Shortcut around it (steps below), and from then on sharing a file
to that Shortcut posts it to Nest, where it waits in an inbox on the Payslips
or Deductions tab to be reviewed and confirmed.

## Why a Shortcut, and not a native share-sheet integration

Two platform mechanisms would normally do this on iOS, and neither is
reachable from a PWA:

- **App Intents** (the framework behind Shortcuts actions, Spotlight, and
  Siri) is declared inside a compiled native app's own binary. There is no
  web/JS equivalent, and Nest's fixed scope is one PWA for iOS and web with no
  native app (see [`CLAUDE.md`](../CLAUDE.md)) — building one just to host an
  intent is a far bigger commitment than a share flow justifies.
- **The Web Share Target API** (`share_target` in the web app manifest) is
  the standard way a web app registers itself as a share-sheet destination —
  supported on Chrome/Android — but Safari has never implemented it, and
  WebKit's own tracking bug for it has sat open for years with no signal it
  is coming.

Both are dead ends purely on WebKit's side, not anything Nest's own code
could work around.

## The mechanism: Shortcuts + a bearer token

The [Shortcuts app](https://support.apple.com/guide/shortcuts) doesn't need
App Intents to do this — a Shortcut can appear in the system share sheet on
its own, and its **Get Contents of URL** action can `POST` the shared file as
`multipart/form-data` to any HTTPS endpoint with custom headers. So the
household builds one small Shortcut, once, that:

1. Accepts a shared file (a PDF or an image) from the share sheet.
2. Sends it to `document-intake` with the member's own bearer token as an
   `Authorization: Bearer <token>` header.

This follows the same shape as the household's Up personal access token: a
long-lived credential the member pastes in once, rather than anything
resembling OAuth inside a Shortcut (which the platform doesn't support
well). See [`../supabase/functions/README.md`](../supabase/functions/README.md#document-intake)
for the function itself.

## What happens on the Nest side

`document-intake` (`verify_jwt = false`, since the caller carries no Supabase
session — the bearer token is the whole of the credential) validates the
token, checks the file's type and size, and stages it: the bytes land in the
private `document-intake` Storage bucket and a `document_intake` row records
who it's for and which tab it's queued on. **Nothing is created yet** — no
payslip, no deduction. The household opens the Payslips or Deductions tab,
sees the staged file in a small inbox card, and taps **Review**: this opens
the ordinary add form, pre-filled by the exact same
`payslip-extract`/`deduction-extract` pipeline a picked file already goes
through, with every field editable. Only the member's own **Save** persists
anything — extraction, and now document intake, never write a figure
directly. **Dismiss** discards the staged file without creating anything.

This is deliberate: a payslip or a deduction is tax-relevant data, and the
"member confirms everything extraction reads" rule the rest of the app
follows (see [`payslips.md`](payslips.md), the Tax deductions section of
[`CLAUDE.md`](../CLAUDE.md)) applies here without exception, whatever the
file's route in.

## Data model

Two tables (`supabase/migrations/20260909000000_document_intake.sql`):

- **`document_intake_token`** — one live token per member. Unlike
  `share_grant` (one per household, mintable by any member), this token acts
  as a *specific* member submitting their own documents, so
  `create_document_intake_token` / `revoke_document_intake_token` are both
  SECURITY DEFINER RPCs that resolve the caller's own member from their JWT —
  there is no `member_id` parameter, mirroring `up-connect`/`up-disconnect`'s
  own-member-only shape rather than `share_grant`'s household-wide one. Only
  `token_hash` (`sha256(token)`) is stored; the plaintext is returned once by
  `create_document_intake_token` and never persisted client-side either.
  Every household member can see *whether* a co-member has a live token and
  since when (the same transparency `members.up_connected_at` gives the Up
  connection), but never the token itself.
- **`document_intake`** — the staging row a successful upload creates:
  household, member, `kind` (`'payslip'` or `'deduction'`), and the object's
  Storage path. Household-wide read and delete for `authenticated`, exactly
  the same boundary as `payslip`/`deduction` themselves (`member_id` is a tax
  attribution, not a privacy boundary) — but **no insert grant to
  `authenticated` at all**. The only writer is `document-intake`'s
  service-role client; a member never creates a staging row directly.

Storage: a private `document-intake` bucket, laid out as
`<household_id>/<intake_id>/<file>` exactly like `payslips`/`receipts`.
Household members can read (to review) and delete (to dismiss, or to clean up
after a review is saved) objects under their own household's prefix; only the
edge function inserts, via its service-role client, which bypasses Storage
RLS regardless of policy.

## Building the Shortcut

These steps follow the iOS 26 Shortcuts app. iOS 26 folded Apple Intelligence
actions into Shortcuts but left the pieces this flow needs — a Share Sheet
input and one **Get Contents of URL** action — unchanged, so the shape carries
forward; only menu wording tends to drift between releases.

1. **Generate a token.** Open Nest → Settings → Connections → **Document intake**, and
   tap **Generate token**. Copy the endpoint URL shown on the same card, and
   copy the token — it is shown once and Nest never stores it, so if you lose
   it, generate a new one (this replaces the old one, which stops working).
2. **Open the Shortcuts app** → **+** (top right) to create a new shortcut.
3. **Turn on the Share Sheet input.** Tap the shortcut's name at the top of
   the editor to open its settings, choose **Details**, and turn on **Show in
   Share Sheet**. Under **Accepted Types** (shown once the toggle is on),
   leave **Files** and **Images** selected and turn the rest off — that is
   what makes the Shortcut appear when you share a PDF or a photo from Mail,
   Files, or elsewhere. The editor adds a **Receive Files and images input
   from Share Sheet** action at the top automatically; leave its "If there's
   no input" set to **Continue** so a stray run without a file fails cleanly
   rather than posting nothing.
4. **Add "Get Contents of URL".** Tap **+ Add Action**, search for
   *Get Contents of URL*, and add it. Expand **Show More** and set:
   - **URL** — the endpoint you copied (ends in
     `/functions/v1/document-intake`).
   - **Method** — `POST`.
   - **Headers** — add one: key `Authorization`, value `Bearer <your token>`
     (paste your token after the word `Bearer` and a space).
   - **Request Body** — **Form**, then **Add new field** twice:
     - `kind` — a **Text** field, value `payslip` or `deduction` (see step 6
       for why you'll build one Shortcut of each).
     - `file` — a **File** field; tap its value and pick the **Shortcut Input**
       variable so it carries whatever file was shared in.
5. **Name it** something recognisable in the share sheet — "Nest — Add
   payslip" or "Nest — Add deduction" — and tap **Done**.
6. **Build a second copy for the other kind.** A Shortcut posts one fixed
   `kind`, so from the Shortcuts grid touch and hold the shortcut →
   **Duplicate**, then change only the `kind` field's value and the name.
   "Nest — Add payslip" and "Nest — Add deduction" sit side by side in the
   share sheet, both using the same token.

From then on: open a payslip PDF (in Mail, or after scanning one with the
Files app), tap **Share**, choose "Nest — Add payslip", and it lands in
Nest's Payslips tab inbox within moments — ready to review, never saved until
you confirm it. The first run asks once for permission to send the file to the
endpoint; tap **Allow Always** to skip it thereafter.

## Limits

- **File types and size**: PDF, JPEG, PNG, or WebP — the same set
  `payslip-extract`/`deduction-extract` read. Images are capped at 5 MB and
  PDFs at 20 MB, the same caps extraction applies when the file is later
  reviewed; a Shortcut posting anything else gets a clear error back, visible
  in the Shortcuts app's own run log.
- **No push notification on arrival.** A staged file sits quietly in the
  inbox until the household next opens the relevant tab — deciding *when* to
  notify is out of scope for push in general (see the Push notifications
  section of [`CLAUDE.md`](../CLAUDE.md)), and document intake does not carve
  out an exception.
- **One token per member**, not per device: installing the Shortcut on a
  second device means pasting the same token again, and revoking it logs out
  every device sharing it at once. There is no per-device token list.
- **iOS/Shortcuts only** for now — an equivalent on desktop Safari, or
  Android's Web Share Target API (which Nest could actually implement,
  unlike Safari's absence of it), is future work, not built.
