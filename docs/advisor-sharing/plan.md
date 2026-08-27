# Implementation plan: EOFY share links for a tax agent

## Design summary

Reuse the EOFY tab's own client-side composition rather than re-implementing
tax logic server-side. Today `EofySection.tsx` loads six RLS-scoped
collections plus payslips, feeds them through pure functions in
`apps/pwa/src/lib/tax.ts` / `apps/pwa/src/lib/payslips.ts` (built on
`@nest/tax`), and renders the presentational `EofyScreen.tsx`. The new
public share page does the identical assembly, just sourcing its rows from
a new public edge function instead of Supabase-authenticated hooks, and
rendering the *same* `EofyScreen` component. This guarantees the shared
view mirrors the EOFY tab by construction, and avoids duplicating the tax
engine in Deno.

Three new edge functions, one new table, two new RPCs, one new Vault
secret, and PWA additions that stay additive to `EofyScreen.tsx`'s
existing props.

## Data model

New migration, e.g. `supabase/migrations/20260831000000_share_grant.sql`:

```sql
create table public.share_grant (
  household_id uuid primary key references public.households on delete cascade,
  financial_year integer not null,
  token_hash text not null unique,
  recipient_email text not null,
  created_by_member_id uuid references public.members(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.share_grant is 'At most one live, time-limited, read-only EOFY share per household. Not a household membership — a bearer token for a scoped, anonymous read path (eofy-share / eofy-share-file), following the temporary-invite-code TTL idiom but issuing a token for a read, not a join.';
comment on column public.share_grant.token_hash is 'sha256(token), hex. The plaintext token is returned once by create_share_grant and never stored; only the hash is compared on redemption.';
```

- `household_id` is the primary key — enforces "at most one live share per
  household" as a schema-level guarantee.
- No `revoked_at`: revoke deletes the row outright (no history/audit
  list, and shrinks the window a token_hash sits at rest).
- Token: two concatenated, dash-stripped `gen_random_uuid()`s (64 hex
  chars, ~244 bits). Hash with core Postgres `sha256(bytea)`:
  `encode(sha256(convert_to(v_token, 'UTF8')), 'hex')`.

RLS — deliberately tighter than the `invite_code` precedent, since this
token gates real tax data:

```sql
alter table public.share_grant enable row level security;

create policy "household members read their share" on public.share_grant
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

-- No insert/update/delete policy, and no such GRANT to `authenticated` at
-- all — every write goes through create_share_grant / revoke_share_grant
-- (SECURITY DEFINER), so a direct PostgREST write is impossible.

revoke select on public.share_grant from authenticated;
grant select (household_id, financial_year, recipient_email, expires_at, created_at)
  on public.share_grant to authenticated; -- column-level: never token_hash

grant select on public.share_grant to service_role; -- eofy-share/eofy-share-file read by token hash
```

Also grant `service_role` read access on every table the new functions
query directly (withheld by default in this project — see
`push_subscription`'s `grant select, delete ... to service_role` as the
only existing precedent):

```sql
grant select on public.members, public.inflows, public.tax_profile,
  public.super_contribution, public.super_profile, public.help_debt,
  public.deduction, public.deduction_receipt, public.payslip
  to service_role;
```

### RPCs (same migration)

```sql
create function public.create_share_grant(p_financial_year integer, p_recipient_email text)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_household_id uuid;
  v_member_id uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires_at timestamptz := now() + interval '7 days';
begin
  select hid into v_household_id from public.household_ids_for_current_user() as hid limit 1;
  if v_household_id is null then raise exception 'caller has no household'; end if;
  select id into v_member_id from public.members where user_id = (select auth.uid()) and household_id = v_household_id;

  insert into public.share_grant (household_id, financial_year, token_hash, recipient_email, created_by_member_id, expires_at)
    values (v_household_id, p_financial_year, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_recipient_email, v_member_id, v_expires_at)
    on conflict (household_id) do update set
      financial_year = excluded.financial_year, token_hash = excluded.token_hash,
      recipient_email = excluded.recipient_email, created_by_member_id = excluded.created_by_member_id,
      expires_at = excluded.expires_at, created_at = now();

  return query select v_token, v_expires_at;
end; $$;
revoke execute on function public.create_share_grant(integer, text) from public;
grant execute on function public.create_share_grant(integer, text) to authenticated;

create function public.revoke_share_grant() returns void
language plpgsql security definer set search_path = '' as $$
declare v_household_id uuid;
begin
  select hid into v_household_id from public.household_ids_for_current_user() as hid limit 1;
  if v_household_id is null then raise exception 'caller has no household'; end if;
  delete from public.share_grant where household_id = v_household_id;
end; $$;
revoke execute on function public.revoke_share_grant() from public;
grant execute on function public.revoke_share_grant() to authenticated;
```

### Vault secret for email

Same idiom as `vapid_keys()`:

```sql
create function public.resend_api_key() returns text
language sql security definer set search_path = '' stable as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key';
$$;
revoke execute on function public.resend_api_key() from public;
grant execute on function public.resend_api_key() to service_role;
```

Set by hand per `docs/operations.md`'s existing pattern:
`select vault.create_secret('<key>', 'resend_api_key');`.

## Decisions confirmed with product owner

- Email provider: **Resend**.
- Share-creation UI: lives on the **EOFY tab**, next to the financial-year
  selector, defaulting the share's FY to whatever's currently selected.
- Data scope: `eofy-share` returns the **same raw rows** the EOFY tab
  itself loads (full inflow history, standing HELP balance, all tax/super
  profile rows) — matches exactly what the household's own tab depends on
  to compute correctly, rather than a trimmed/re-derived subset.

## Edge functions

Three new functions under `supabase/functions/`, each `index.ts`
(wiring) + a pure logic module + `_test.ts`, matching
`push-key`/`deduction-extract`'s shape. New shared module
`supabase/functions/_shared/shareGrant.ts`:

```ts
export interface ShareGrant { householdId: string; financialYear: number; expiresAt: string }
export async function resolveShareGrant(admin: SupabaseClient, token: string):
  Promise<{ grant: ShareGrant } | { error: { status: number; message: string } }>
// hashes token with the same sha256-hex scheme as create_share_grant, selects by
// token_hash, checks expires_at > now(); 401 on no match, 401 on expired (never
// leak "expired" vs "never existed" — same message either way)
```

### `supabase/functions/eofy-share/` — `verify_jwt = false` in `supabase/config.toml`

Request: `POST { token: string }`. Response:
```ts
{
  financialYear: number
  members: { id: string; name: string }[]              // no email/user_id
  inflows: Tables<'inflows'>[]                          // unfiltered, mirrors useInflows — proration needs the whole set
  taxProfiles: Tables<'tax_profile'>[]                  // financial_year = grant.financial_year
  superContributions: Tables<'super_contribution'>[]
  superProfiles: Tables<'super_profile'>[]
  helpDebts: Tables<'help_debt'>[]                      // unfiltered, mirrors useHelpDebts
  deductions: Tables<'deduction'>[]
  deductionReceipts: Tables<'deduction_receipt'>[]      // pre-filtered to deductions in scope
  payslips: Tables<'payslip'>[]
}
```
`index.ts` builds the service-role client, calls `resolveShareGrant`, then
queries each table `eq('household_id', grant.householdId)` (plus
`eq('financial_year', ...)` where FY-scoped), 401/404 on an invalid/expired
token. Pure module `data.ts` takes injected `resolveGrant`/`loadRows` deps
(same DI pattern as `push-key/key.ts`) so the shaping logic is unit-tested
without a network.

### `supabase/functions/eofy-share-file/` — `verify_jwt = false`

Request: `POST { token: string; bucket: 'receipts' | 'payslips'; path: string }`.
This is the feature's main new security surface — the token holder must
get a signed URL only for a file legitimately part of this share's scope,
never blanket Storage access.

`file.ts` logic:
1. `resolveShareGrant(admin, token)` → grant or 401.
2. Reject if `path`'s first segment ≠ `grant.householdId` (400).
3. Scope check by bucket:
   - `receipts`: `path` must equal some `deduction_receipt.storage_path`
     whose `deduction_id` belongs to a `deduction` row with
     `household_id = grant.householdId and financial_year = grant.financialYear`.
   - `payslips`: `path` must equal some `payslip.file_path` with
     `household_id = grant.householdId and financial_year = grant.financialYear`.
   - Anything else → 403.
4. `admin.storage.from(bucket).createSignedUrl(path, 300)` (5-minute TTL —
   shorter than the household's own 3600s, since this is a lower-trust
   anonymous bearer) and return `{ url: string, expiresIn: 300 }`.

### `supabase/functions/share-create/` — JWT-verified (default)

Authenticated, called from the EOFY tab. Request:
`POST { financialYear: number; recipientEmail: string }`.

`index.ts`: extend `_shared/caller.ts`'s `ResolvedCaller` to also expose
the `asUser` client it already builds internally (small, additive
change), so `create.ts` can:
1. `asUser.rpc('create_share_grant', { p_financial_year, p_recipient_email })`
   → `{ token, expires_at }` (runs RPC as the caller so `auth.uid()`
   resolves — must NOT use the service-role client here).
2. `admin.rpc('resend_api_key')` → key; mint the grant regardless of
   whether the key is set, so the household still gets a link even if
   email sending is unavailable (see step 4).
3. If the key is present: `fetch('https://api.resend.com/emails', ...)`
   with `Authorization: Bearer <key>`, sending the share link.
4. Respond `{ token, expiresAt, emailSent: boolean }` regardless of the
   Resend call's outcome — an email failure doesn't invalidate the grant
   just minted; the PWA shows/copies the link as a fallback.

Pure module `create.ts` takes injected `mintGrant`/`sendEmail` deps for
testing, same DI shape as `push-key`.

## Storage RLS

No change to the existing `receipts`/`payslips` bucket policies (still
gated by `household_ids_for_current_user()`) — an anonymous bearer has no
`auth.uid()` so those policies never match it, by design.
`eofy-share-file` deliberately goes around Storage RLS with a
service-role client, which is why its own scope check (above) is the
entire security boundary for that path and needs the most direct tests.

## PWA changes

### Reused/extended `EofyScreen.tsx`

Additive-only prop changes (existing `EofySection.tsx` callers unaffected
unless noted):
- `showTabLinks?: boolean` (default `true`) — hides the Tax/Payslips/
  Deductions/Super/HELP debt anchor links, which point at authenticated
  routes the tax agent has no session for.
- `disclaimerNote?: string` — renders a second dimmed note alongside the
  existing "excludes capital gains tax" line; the shared route passes
  placeholder copy ("These figures are estimates for planning purposes,
  not a filed tax return."), the authenticated route passes nothing.
- `members: Pick<Member, 'id' | 'name'>[]` — narrow the existing
  `Member[]` type (structurally compatible) so the shared payload's
  `{id,name}`-only members type-checks without a parallel prop.
- New optional section: `payslipDocuments?: { id: string; memberId:
  string; paidOn: string | null; filePath: string }[]` +
  `payslipSignedUrl?: (path: string) => Promise<string | null>` — a
  "Payslip documents" subsection per member, rendered only when both are
  supplied. Feeding `usePayslips`'s existing `signedUrl`/`file_path` into
  this new section on the authenticated route too is a small, justified
  extension (no new table/RPC — it surfaces data `usePayslips` already
  loads).

### New route: `apps/pwa/src/routes/EofyShareSection.tsx` (public)

- `apps/pwa/src/hooks/useEofyShareData.ts` — `supabase.functions.invoke
  ('eofy-share', { body: { token } })`, returns the row arrays typed
  exactly as the existing hooks' row types so `estimateHouseholdTaxFromRows`,
  `superCapSummaryFromRows`, `helpPayoffByMember`, `paygWithheldFromRows`,
  `payslipCountByMember` (all already in `lib/tax.ts`/`lib/payslips.ts`)
  run unmodified.
- `EofyShareSection.tsx` composes those exactly as `EofySection.tsx`
  does, then renders `<EofyScreen availableFinancialYears={[financialYear]}
  onFinancialYearChange={() => {}} showTabLinks={false}
  disclaimerNote="..." payslipDocuments={...}
  payslipSignedUrl={(path) => supabase.functions.invoke('eofy-share-file',
  { body: { token, bucket: 'payslips', path } })...}
  signedUrl={(path) => ... bucket: 'receipts' ...} />` — a single-entry
  `availableFinancialYears` reuses `FinancialYearSelect` unmodified as a
  fixed, non-changeable display.
- Loading/error/expired states via `EmptyState`, e.g. "This share link
  has expired or been revoked."

### Routing: `apps/pwa/src/App.tsx`

The whole app today gates on `session` before rendering anything, so the
public share route must be matched before that gate:
```tsx
export default function App() {
  return (
    <Routes>
      <Route path="/share/eofy/:token" element={<Suspense fallback={<LoadingScreen/>}><EofyShareSection/></Suspense>} />
      <Route path="*" element={<AuthGate />} />
    </Routes>
  )
}
```
`AuthGate` is the current body of `App()` (session check →
`SignInScreen`/`AuthedApp`), renamed and moved, unchanged otherwise.
`EofyShareSection` is lazy-loaded like the other route sections and never
imports `supabase.auth`.

### Share creation UI

On `EofySection.tsx`, next to `FinancialYearSelect`, defaulting its FY
field to whatever FY is currently selected.

- `apps/pwa/src/hooks/useShareGrant.ts` — bespoke (not
  `useHouseholdCollection`, since `share_grant` is single-row-per-household
  keyed on `household_id`, not `id`): `status: ShareGrantRow | null`,
  `create(financialYear, email) → invoke('share-create', ...)`,
  `revoke() → supabase.rpc('revoke_share_grant')`.
- `apps/pwa/src/components/EofyShareControl.tsx` — email input + FY
  (defaulted, editable) + Send; once created, shows "Active — expires in
  N days" with a **Copy link** button
  (`${window.location.origin}/share/eofy/${token}`, shown once, same
  "returned once" treatment as VAPID/push keys) and a Revoke button.
  Copy-link-as-fallback covers email deliverability failures/spam-foldering.

## Ordered implementation steps

1. Migration: `share_grant` table, RLS, `create_share_grant`/
   `revoke_share_grant` RPCs, `resend_api_key()`, the `service_role` read
   grants on the seven source tables. Add
   `supabase/tests/rls/share_grant.sql` and wire it into
   `supabase/tests/rls/README.md` + the `rls` job in `.github/workflows/ci.yml`.
2. `_shared/shareGrant.ts` (+ test) and the small `_shared/caller.ts`
   extension to expose `asUser`.
3. `eofy-share` function (+ tests) — data shaping only, no Storage.
4. `eofy-share-file` function (+ tests) — Storage scope-check + signed URL.
5. Add both to `supabase/config.toml` with `verify_jwt = false`, matching
   `up-webhook`'s block.
6. `share-create` function (+ tests); operator sets `resend_api_key` in
   Vault and a `PWA_APP_URL` (or similar) env var for building the link —
   document in `docs/operations.md`.
7. `EofyScreen.tsx` additive prop changes + its existing test file gets
   new cases; `EofySection.tsx` updated to pass the new payslip-documents
   data (using `usePayslips`'s existing `signedUrl`).
8. `useShareGrant.ts`, `EofyShareControl.tsx`, wired into `EofySection.tsx`.
9. `useEofyShareData.ts`, `EofyShareSection.tsx`, `App.tsx` routing split.
10. Docs: a new `docs/eofy-sharing.md` (sibling to `docs/payslips.md`),
    plus updates to `CLAUDE.md` (a new bullet under Fixed scope
    decisions), `docs/architecture.md` (Security section — the new
    SECURITY DEFINER/anonymous-bearer idiom) and `docs/operations.md`
    (Vault secrets — `resend_api_key`).

## Risks

- **Token leakage via forwarded/misdelivered email**: mitigated by 7-day
  auto-expiry, manual revoke, and the token's read-only/EOFY-only/
  single-FY scope. The share page should set `Referrer-Policy: no-referrer`
  (meta tag or a Vercel header rule scoped to `/share/*`) since the token
  sits in the URL path.
- **Token brute-forcing**: 64 hex chars (~244 bits) makes guessing
  infeasible; no additional rate-limiting needed for v1.
- **Storage over-exposure**: the entire risk surface of `eofy-share-file`
  is its own scope check, not Storage RLS — needs the most direct tests: a
  path from another household, a path from the same household but a
  different FY's deduction/payslip, and a path with no matching row must
  all be rejected.
- **Email-provider secret handling**: follows the established Vault-only,
  `service_role`-only read pattern; the Resend API key never reaches the
  client.
- **Drift-check coverage**: the three new function directories are picked
  up automatically by `scripts/check-function-drift.js`'s directory scan
  — confirm after first deploy that `check:function-drift` reports all
  three.
- **CI time budget**: proportionate to what `deduction-extract`/
  `payslip-extract` already cost the `functions`/`rls` jobs; check CI
  wall-clock after landing.

## Rollout

No feature-flag mechanism exists in this codebase — ship via the normal
migration/function auto-deploy pipeline. Until `resend_api_key` is set in
Vault, `share-create` still mints the grant and returns the link
(`emailSent: false`), so the UI can ship and degrade gracefully until the
operator sets the secret post-deploy.

## Test approach

**RLS** (`supabase/tests/rls/share_grant.sql`):
- `create_share_grant` from an authenticated household member creates a
  row visible only to that household.
- A second `create_share_grant` call replaces the row rather than adding
  a second one.
- `revoke_share_grant()` deletes the row; a no-op when there's no active
  share.
- `token_hash` is not selectable by `authenticated`.
- A direct insert/update/delete on `share_grant` as `authenticated` fails.

**Edge functions** (`*_test.ts` beside each module, DI-based):
- `shareGrant_test.ts`: valid token resolves; expired, revoked, and
  malformed tokens all report the same generic 401.
- `eofy-share/data_test.ts`: shapes a fake row set; a resolution failure
  short-circuits before any table read.
- `eofy-share-file/file_test.ts`: accepts an in-scope path; rejects a
  path from another household, an out-of-scope FY, and a path with no
  matching row.
- `share-create/create_test.ts`: happy path mints + sends via injected
  deps; an email-send failure still returns `emailSent: false` with the
  token present; a missing Resend key is surfaced distinctly.

**PWA**:
- `useEofyShareData.test.ts`, `EofyShareSection.test.tsx` (loading/
  expired/happy-path renders).
- `EofyScreen.test.tsx`: new cases for `showTabLinks={false}`,
  `disclaimerNote`, and the payslip-documents section.
- `useShareGrant.test.ts`, `EofyShareControl.test.tsx`.

### Critical files for implementation

- `supabase/migrations/20260831000000_share_grant.sql` (new — table,
  RLS, RPCs, Vault secret function)
- `supabase/functions/eofy-share/data.ts` and
  `supabase/functions/eofy-share-file/file.ts` (new — the data-shaping
  and, especially, the Storage scope-check logic)
- `supabase/functions/share-create/create.ts` (new — RPC + Resend wiring)
- `apps/pwa/src/components/EofyScreen.tsx` (edit — additive props reused
  by both the authenticated and shared views)
- `apps/pwa/src/App.tsx` (edit — routing split so `/share/eofy/:token`
  bypasses the session gate)
