# Design system

A bold, dark-first system for the PWA. Dark is the primary scheme; light mode is
a high-contrast paper counterpart. Every colour is a named Mantine scale, so
components reference tokens — never raw hex.

## Theme & tokens

The Mantine theme is `apps/pwa/src/theme.ts`; semantic and chart tokens live in
`apps/pwa/src/lib/tokens.ts`.

### Colour scales

Custom `MantineColorsTuple` scales (base shade = index 5):

- **`brand`** — electric lime, the primary colour (`primaryShade` pinned to 5 in
  both schemes). Base `#b6f400`.
- **`dark`** — neutral surfaces. Mantine maps the page body to `dark-7`
  (`#0b0f14`), elevated default surfaces (cards, inputs) to `dark-6` (`#141a21`)
  with `dark-5` (`#1b232c`) one step higher, subtle borders to `dark-4`
  (`#26303a`), dimmed text to `dark-2` (`#8b99a6`), body text to `dark-0`
  (`#e6edf3`) — so a bordered default surface reads as elevated with no
  per-component background.
- **`positive`** — money-up green, base `#3ddc84` (distinct from the brand lime).
- **`negative`** — money-down magenta-red, base `#ff4d6d`.
- **`warning`** — amber, base `#f5a524`.
- **`info`** — cyan, base `#22d3ee`.

`defaultColorScheme="dark"` is set on both `ColorSchemeScript` and
`MantineProvider` (`apps/pwa/src/main.tsx`); `autoContrast` is on. `index.html`
carries `theme-color`/PWA `background_color` `#0b0f14` to match the dark canvas.
Dark stays the default; the in-app `ColorSchemeToggle` flips to the light paper
counterpart, and `ColorSchemeScript` persists the choice. As `primaryColor` is
`brand`, focus rings render in lime automatically.

`semanticColors` names the non-neutral scales; sign colouring resolves per scheme
via `light-dark(...)` in `moneyColor` (`apps/pwa/src/lib/money.ts`) so figures
clear WCAG AA in both.

### Type

Fonts load from `@fontsource-variable`: **Space Grotesk** for headings, **Inter**
for body (`main.tsx`). Headings are weight 700, stepping sharply from a display
h1 (`rem(38)`, tight `1.05` line-height) down to h6 (`rem(14)`) so a page title
reads as a bold display line and section headings sit clearly below it. Money
renders with `tabular-nums lining-nums` so figures align in columns.

### Radius & spacing

`defaultRadius: 'md'`; radius scale xs `rem(4)` → xl `rem(20)`. Spacing adds a
sub-`xs` step `xxs: rem(4)` so tight rows use a token, not a raw `gap={4}`.

### Component defaultProps

The theme restyles Mantine components app-wide:

- **Card** — `withBorder`, `radius: 'md'`, `padding: 'lg'`, plus a soft drop
  shadow and a dark-mode inset top-edge highlight, so an elevated surface steps
  clearly off the near-black page base.
- **Button** — `radius: 'md'`, weight 600. The primary action (default/`filled`,
  brand-coloured) carries a subtle electric-lime glow; a coloured or non-filled
  button (red delete, ghost cancel) stays flat.
- **Badge** — `variant: 'light'`, `radius: 'sm'`, `textTransform: 'none'` so every
  pill renders its label in natural case as written (e.g. "Fortnightly", "Every 7
  weeks", "Needs", "On track", "Salary"), overriding Mantine's default uppercasing.
- **Title** — the display h1 (`order={1}`) carries a negative `letter-spacing`
  (`-0.02em`) so the heavy Space Grotesk reads as a bold display line, applied
  as a token here rather than per-screen.
- **ActionIcon** — `variant: 'subtle'`.
- Inputs (**TextInput**, **NumberInput**, **Select**, **SegmentedControl**,
  **Switch**, **Checkbox**) — `size: 'sm'` with `radius: 'md'` (Checkbox `sm`).

### Chart palette

`chartColors` maps the six budget groups plus buffer/tax/sacrifice segments to
CSS-variable colour refs; `chartPalette` is the ordered categorical palette
(budget-group order) a multi-series chart cycles through. Charts reference these
tokens, never inline hex.

The six budget groups span six distinct hues so a chart or category chip reads as
a varied spectrum, not a single family: Needs → indigo, Wants → violet,
Discretionary → pink, Temporary → orange, Savings → teal, Investments → cyan. The
buffer is neutral grey, tax reuses the `negative` (cost) family, and salary
sacrifice takes the brand lime. Each key resolves to a `light-dark()` pair — a
deeper shade on the light surface, a vivid one on the near-black dark base — so
every hue stays legible and mutually distinguishable in both schemes.
`chartColorName` exposes the same mapping as Mantine base-colour names, for a
`Badge` or `ThemeIcon` `color` that derives its own scheme-aware shade — so a
category chip (a budget-group badge) stays in step with its chart hue.

### Net-worth palette

The net-worth section has its own colour map — separate from the budget-group
categorical palette — so its projection-chart bands and its view-section glyphs
draw from one source and cannot drift. `netWorthColors` gives the scheme-aware
CSS colour refs (the projection chart's series and tooltip swatches, via
`NET_WORTH_SERIES_COLORS`); `netWorthColorName` gives the Mantine base-colour
names for each `SectionAccent` glyph in `NetWorthView`. Both derive from the same
per-key hues: super → teal, cash → indigo, equity → violet, HELP liability →
`negative` (cost) red, debt accounts → orange, excluded → grey, and the net-worth
total → brand lime. The shades mirror the matching categorical hues, so the chart
reads identically whether a colour is sourced here or from the budget-group
palette.

## Shared primitives

In `apps/pwa/src/components/`. Each collapses a repeated pattern onto one control
so the rule it enforces holds app-wide.

- **`AppCard`** — the standard elevated surface, wrapping `Card` with the themed
  border/radius/shadow. `density` (`comfortable` = `lg` padding, `compact` = `sm`)
  picks padding; `component="form"` + `onSubmit` render it as an inline editor.
  Replaces bespoke `<Card withBorder radius=… p=…>`.
- **`PageSection`** — the page scaffold: a root `Stack`, one display `Title`
  (order 1, tight tracking, identical on mobile and desktop), optional dimmed
  `intro`, and `gap` for vertical rhythm. Every tab wraps its body in this.
- **`AddButton`** — the one "Add …" affordance: full-width, solid electric-lime
  (the default `filled` brand button with the theme glow), leading plus icon.
  Takes `label`; settles the primary-action treatment for every add action.
- **`ColorSchemeToggle`** — a sun/moon `ActionIcon` flipping between the light and
  dark schemes; dark stays the default. Rendered in the desktop sidebar footer
  and the mobile top bar.
- **`MoneyText`** — the app's one money renderer. Formats `cents` via
  `formatCents` with tabular figures; `colored` tints by sign via `moneyColor`.
- **`EditAction`** — the one edit affordance: a subtle pencil `ActionIcon`
  labelled `Edit`.
- **`ListRow`** — one dense, table-like row: `children` columns in a `nowrap`
  `Group` over a bottom rule, with an optional `caption` second line (string =
  dimmed caption, node = as-is). The desktop counterpart to a compact `AppCard`.
- **`EmptyState`** — the standard dimmed "nothing here yet" message for an empty
  list.
- **`EditDeleteActions`** — an `EditAction` pencil beside a red trash delete
  control; `onEdit`/`onDelete`.
- **`MoneyInput`** — `NumberInput` preset for AU dollars: `$` prefix, comma
  thousands separator, two fixed decimals, dot-only decimal separator. All
  `NumberInput` props pass through.
- **`FortnightlyAmount`** — an emphasised fortnightly `MoneyText` with a dimmed
  `/ fn` suffix, baseline-aligned; `Group` props spread for column placement.

## Conventions

- **List layout.** Long or variable-length lists use the dense `ListRow` on
  desktop with a mobile card; short per-member or per-section surfaces use
  `AppCard`.
- **Badges.** Most use `variant="light"` `size="xs"`. A frequency label is neutral
  and high-contrast (`variant="default"`, giving standard border + surface +
  body-color text that reads clearly in both schemes); a badge that encodes a
  category — a budget group, inflow type, or equity instrument — takes a distinct
  hue from the categorical palette (`chartColorName` for budget groups); a status
  badge takes a semantic `color` (on-track `positive`, behind `warning`, a held Up
  transaction `warning`); a badge that only qualifies its row — a purchase's
  `From Up` source, an inactive inflow, a line's routing — stays neutral
  `color="gray"` so it recedes behind the classifying badges. Every
  badge renders its label in natural case (set globally in the theme); source
  labels are written that way, so no per-badge `tt` override is needed.
- **Add / edit.** Exactly one add affordance (`AddButton`) and one edit pencil
  (`EditAction` / `EditDeleteActions`) across the app.
- **Page scaffolding.** Every screen wraps its body in `PageSection` — one title,
  the same on mobile and desktop.
- **Collapsing a section.** One idiom throughout: a full-width `UnstyledButton`
  header carrying `aria-expanded` + `aria-controls`, led by a chevron
  (`IconChevronDown` open, `IconChevronRight` closed), over a `Collapse` holding
  the body.
- **Navigation.** The nav groups its tabs under that idiom, each header a quiet
  dimmed uppercase label — one size below the items inset beneath it, tracked out
  and bold — so it stays legible beside them without competing. A header never
  takes the active item's lime bar and wash — it labels rather than leads — so a
  group folded over the current page marks itself with a single lime dot instead.
- **Charts.** All charts draw from the shared token palette
  (`chartColors` / `chartPalette`).
- **Money.** Every money figure renders through `MoneyText` (or
  `FortnightlyAmount`) with tabular figures.

## Logo

The brand mark is the goose-in-nest `apps/pwa/public/icon.svg`, drawn for the
near-black canvas (`#0b0f14`). The `Logo` component consumes it live by URL —
`variant="mark"` renders the icon alone, `variant="lockup"` pairs it with the
"nest" wordmark set in live Space Grotesk heading text — so edits to the single
SVG flow through to every surface. The goose's off-white body would vanish on
light paper, so the mark restores its dark canvas as a rounded tile behind it in
light mode only, via `light-dark(var(--mantine-color-dark-6), transparent)` — dark
mode stays on transparency, unchanged. The favicon, apple-touch, and PWA PNG icons
(`favicon-32.png`, `apple-touch-icon.png`, `pwa-192.png`, `pwa-512.png`,
`pwa-maskable-512.png`) are derived from the same SVG.
