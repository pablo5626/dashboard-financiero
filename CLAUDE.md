# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal financial dashboard (React + Supabase) built from the spec in
`prompt-dashboard-financiero.md` — read that file first for product intent
(sections, data model rationale, multi-currency, the MonIA CSV import flow).
The Supabase schema lives in `schema.sql` and is the source of truth for the
database; any schema change goes there, not only in the Supabase dashboard.
**All 5 sections are now fully wired to Supabase** (see "Current state of
the 5 sections" below) — there is no more sample-data scaffolding left in
the app (`src/lib/sampleData.js` was deleted once the last section was
connected).

Detailed, already-decided project rules live in `.claude/rules/*.md` — one
topic per file (nomenclature, data-model conventions, the bank-assignment
engine, tech stack choices, UI/dataviz rules, env/security handling). Read
the relevant one before touching that area; they capture decisions that
aren't otherwise obvious from the code.

## Commands

```
npm install       # install dependencies
npm run dev        # Vite dev server (add --host to expose on LAN for phone testing)
npm run build       # production build (also the fastest way to catch syntax/import errors)
npm run preview     # preview the production build
```

No lint or test scripts are configured in this project. Always run
`npm run build` after any change and fix errors before considering a change
done — it's the fastest signal for a broken import or JSX mistake.

Supabase credentials go in `.env.local` (gitignored) as `VITE_SUPABASE_URL`
and `VITE_SUPABASE_ANON_KEY` — copy `.env.example` and fill in real values.
**Never put real values in `.env.example` itself** — it's the committed
template and must stay generic placeholders. Vite does not hot-reload env
changes; restart `npm run dev` after editing `.env.local`.

**Live-DB schema changes**: any schema change needs *both* the edit to
`schema.sql` and a standalone one-time SQL snippet handed to the user to
run once in the Supabase SQL Editor — see
`.claude/rules/esquema-datos.md` ("Cambios de esquema en la base de datos
ya viva") for the `auth.uid()`-is-null and multi-statement-rollback
gotchas before writing one.

**GitHub Pages deploy**: `.github/workflows/deploy.yml` builds with
`npm ci && npm run build` (injecting `VITE_SUPABASE_URL`/
`VITE_SUPABASE_ANON_KEY` from repo Actions secrets, since `.env.local`
is never committed) and publishes `dist/` via `actions/deploy-pages` on
every push to `master` — the repo's Pages source must be set to "GitHub
Actions" (Settings → Pages) for this to take effect, not "Deploy from a
branch". `vite.config.js` sets `base: '/dashboard-financiero/'` to match
the project-page subpath, `main.jsx`'s `BrowserRouter` reads that same
path via `basename={import.meta.env.BASE_URL}`, and `public/404.html` +
a small inline script in `index.html` implement the standard
rafgraph/spa-github-pages redirect trick so deep-linked routes survive a
hard refresh (GitHub Pages has no server-side rewrites). Before this
setup existed, GitHub Pages served the raw, unbuilt `index.html`
straight from the repo (pointing at `/src/main.jsx`, which browsers
can't execute without a bundler) — a blank white page with a 503 on that
request was the symptom; if that returns, check the Pages source
setting first.

## Architecture

**Stack**: Vite + React 18, plain JSX (no TypeScript), plain CSS with custom
properties for design tokens + CSS Modules per component (no Tailwind),
`react-router-dom` for the 5 top-level sections, Recharts for charts,
`@supabase/supabase-js` as the only data backend (no separate REST API),
`papaparse` for parsing the MonIA CSV client-side.

**Auth gate**: `src/main.jsx` wraps the app in `AuthProvider`
(`src/lib/AuthContext.jsx`), which tracks the Supabase session.
`src/App.jsx` renders `Login` (`src/pages/Login.jsx`) whenever there's no
session, and otherwise renders `AppShell` + the routed pages. This isn't
optional decoration: every table has RLS keyed on `auth.uid()`
(see `schema.sql`), so any query made without a signed-in session silently
returns empty rows rather than erroring — an empty page can mean "not
authenticated," not "no data."

**Data layer pattern**: each domain gets one `src/lib/*Api.js` module that
wraps the raw Supabase queries for that domain — `accountsApi.js`,
`allocationsApi.js`, `fixedExpensesApi.js`, `categoriesApi.js`,
`transactionsApi.js` (CSV parsing + the bank-assignment engine),
`debtsApi.js`, `savingsApi.js`, `panelApi.js` (cross-page aggregates:
monthly trend, alerts), `exchangeRatesApi.js` (manual COP↔USD rate).
Pages call these directly from `useEffect`/`useState` — there is no global
store or data-fetching library; keep that pattern rather than introducing
one. The common per-page shape is a `reload()` async function called once
on mount and again after every mutation; that means most mutations trigger
a handful of re-fetches, which is intentionally simple, **except** where
a hot, frequently-tapped action (e.g. toggling a debt installment paid) was
switched to a local `setState` patch instead because the full `reload()`
was noticeably slow on mobile — see `handleToggleInstallment` in
`Deudas.jsx` for the pattern to copy if another action needs the same fix.

**Navigation / responsive layout**: `src/components/layout/AppShell.jsx`
defines the 5 destinations (`NAV_ITEMS`) once and renders them as a bottom
tab bar below 768px and a sidebar at/above it — `App.jsx`'s `<Routes>` must
stay in sync with that list if a section is ever added/renamed/removed.
The layout follows iOS HIG conventions adapted to web (safe-area insets,
44px touch targets, no hamburger menu) — see the `ios-hig-design` project
skill and `.claude/rules/diseno-ui.md` before changing it. `AppShell` also
shows a small numeric badge on the "Gastos" nav item (sidebar and tab bar)
when there are unassigned ("pendiente de banco") transactions, refetched
on every route change via `countPendingTransactions()`.

**Design tokens**: all color/typography/spacing values are CSS custom
properties defined once in `src/index.css` (categorical/sequential/status
color slots come from the `dataviz` skill's validated palette, with light
and dark values both declared there). Charts and components must reference
these via `var(--series-1)`, `var(--status-critical)`, etc. — never a
literal hex — so dark mode (`prefers-color-scheme` + `[data-theme]`) keeps
working without touching chart code. Part-whole comparisons are always a
horizontal bar chart (`layout="vertical"` BarChart), never a pie/donut —
see `.claude/rules/diseno-ui.md`; this has been followed consistently
(account distribution, category spend, tag spend, patrimonio vs. deuda).
**Any `<table className="simple-table">` must be wrapped in a
`<div className="table-scroll">`** (a plain `overflow-x: auto`, defined in
`index.css`) — without it, a wide table forces the whole page wider than
the viewport instead of scrolling on its own, because `.grid-auto`/
`.kpi-row` children need `min-width: 0` (already set globally in
`index.css`) to allow shrinking; `body` also has `overflow-x: hidden` as a
last-resort guard. This was a real bug hit on mobile mid-session — keep
both parts (`min-width: 0` on grid children + `table-scroll` wrapper) when
adding new tables or charts.

**Money math**: an account's current balance is never stored directly — it's
computed as `monthly_initial_balance + net account_transfers + sum of that
month's transactions.amount` (see `fetchBalancesForMonth` in
`accountsApi.js`). `account_allocations` is the separate "how much was
budgeted this month" figure, not the balance. `parent_account_id` on
`accounts` is purely a structural/UI grouping (e.g. for the Sankey view) —
it says nothing about where an account's money actually comes from; that's
always `account_transfers`. **A hija's saldo (balance) is not the same as
how much of its budget has been spent** — the balance rises the moment it's
funded (via `monthly_initial_balances` or a transfer in), before any real
spending happens, so `Cuentas.jsx`'s hija cards compute the "% usado"
progress bar from `transactionsApi.getSpentByAccountForMonth` (real negative
`transactions` for the month, summed per account) against `account_allocations`
— never from `balances[account.id]` — otherwise funding a hija to 100% of
its budget shows as "100% usado" before a single peso was actually spent.
`fetchBalancesForMonth(accounts, year, month)`
takes the full account **objects** (not bare ids) because it's
currency-aware: each account only sums rows whose `currency` matches that
account's own `currency` (default `'COP'`), so a COP account and a USD
account never get their amounts mixed. `panelApi.fetchMonthlyTrend` and
`fetchTotalDebt` do the equivalent per-row currency check but additionally
convert non-COP amounts to COP (via `exchangeRatesApi.toCOP`) before
summing into a single consolidated number — pass `{ convertToCOP: false }`
to `fetchMonthlyTrend` when the caller wants a trend to stay in the
linked account's native currency instead (used by 'proposito' savings
goals tied to a USD account).

**Multi-currency (COP/USD)**: `accounts.currency` (default `'COP'`) is the
only account-level currency field; `transactions`, `account_transfers`,
`monthly_initial_balances`, `account_allocations`, `debts`,
`fixed_expenses`, and `savings_goals` each carry their own `currency` too.
The manual exchange rate (one live row, `exchange_rates` table,
`base_currency='COP'`/`quote_currency='USD'`) is edited from a "Tasa de
cambio" card in `Cuentas.jsx` via `exchangeRatesApi.getRate`/`setRate`; if
it isn't set yet, `toCOP` returns `0` for USD amounts rather than
inventing a conversion, so USD balances are silently excluded from
consolidated totals (Panel General, Deudas) until the user sets it — a
warning is shown on that Cuentas card when this is the case. USD accounts
are deliberately kept out of `MonthlyAllocationSection` (madre→hijas
monthly distribution) and `FixedExpensesSection` (recurring fixed
expenses) — neither component has any currency concept, and the one real
USD account (**arq**) is used ~once a year for international purchases,
so it doesn't participate in either monthly ritual. Individual debts
(`Deudas.jsx`) are COP-only in the UI for now — only the consolidated
"Deuda total vs. Patrimonio" comparison is currency-aware.

**Bank-assignment engine** (full rules in `.claude/rules/motor-asignacion.md`,
implemented in `transactionsApi.js`'s `importTransactions`): a MonIA CSV
row's account is assigned via, in order, (1) a recognized bank tag in the
row's `tags`, OR a non-COP `currency` when exactly one active account has
that currency (both are "level 1" — real explicit data, never speculation;
tag wins if a row somehow has both), (2) a category with
`is_ambiguous = false` whose entire history has gone to a single account,
(3) otherwise the transaction is left `account_id = null` ("pendiente de
banco") for manual confirmation in `GastosDiarios.jsx`, which also feeds
`category_account_stats` to improve future suggestion ordering. Never add
a 4th, frequency/probability-based auto-assignment level — this is an
explicit, repeatedly-reinforced user rule.

**Alerts system** (`panelApi.fetchAlerts`, rendered in `PanelGeneral.jsx`'s
"Alertas" card): surfaces fixed expenses and debt installments due within
5 days (or overdue), savings goals within 30 days of their target date (or
past it), pending "sin cuenta asignada" transactions, categories that
exceeded their `monthly_budget` (`categories.monthly_budget`, a flat
monthly cap edited from a "Presupuesto por categoría" card in
`GastosDiarios.jsx` — not month-by-month, just one number that applies
every month until changed), and a `'anomalia_categoria'` alert when a
category's spend this month exceeds 1.5× its trailing-6-month average
(reuses the same widened query `fetchAlerts` already runs for the budget
check, no new Supabase call). Every alert carries an `href` so it renders
as a `<Link>` to the page where it's resolved.

**Confirmation dialogs**: every destructive or state-changing confirmation
in the app uses `src/components/ui/ConfirmDialog.jsx` (a themed,
dark-mode-aware modal following the iOS HIG "Alert" pattern — title as a
question, brief consequence line, destructive action + cancel) — **never**
a native `window.confirm()`/`alert()`, which don't respect the app's
design system or dark mode. Every page that can delete/archive something
follows the same local-state pattern: a `confirm*` state holding the
pending target (or `null`), a `handle*` that sets it, a `do*` that performs
the action and clears it, and one `<ConfirmDialog>` rendered near the end
of the component. Copy this pattern for any new delete/destructive action
instead of reaching for `window.confirm`.

**Every create/log action needs a matching delete**: transactions, savings
contributions, transfers, accounts, debts (+ installments), fixed
expenses, and savings goals can all be deleted or archived from the UI —
this is a standing expectation, not something to add only when the user
notices a gap. A resource that's a single current-state value fully
overwritten on save (the monthly allocation amounts, the monthly initial
balances) is fine without a delete button, since re-entering the right
number and saving is an equivalent fix and there's no historical log being
polluted — but anything that accumulates as a list over time needs an
explicit delete with a `ConfirmDialog`. When deleting needs to keep a
derived total in sync (e.g. `savingsApi.deleteContribution` decrementing a
`'puntual'` goal's `current_amount` by the same amount `addContribution`
incremented it by), that adjustment lives in the same API function as the
delete.

**Client-generated IDs must not use `crypto.randomUUID()`** — that API only
exists in secure contexts (HTTPS or `localhost`), and this app gets tested
a lot over plain `http://<lan-ip>:5173` from a phone/iPad
(`npm run dev --host`), where it's `undefined` and throws. Use a small
non-cryptographic fallback instead (see `generateLocalId` in
`transactionsApi.js`, used for manually-entered transactions' synthetic
`monia_id`) — a personal single-user app has no need for
cryptographically-strong randomness here, just uniqueness.

**Loading state on reload, not just first mount**: a component with a
boolean `loading` state must only flip it back to `true` on the very first
fetch, never on every subsequent `reload()`. `MonthlyAllocationSection.jsx`
and `MonthlyInitialBalancesSection.jsx` used to call `setLoading(true)` at
the top of their effect on every re-run — since their props are re-derived
(new array/object references) on *every* `Cuentas.jsx` render, that fired
on every unrelated save/delete elsewhere on the page, briefly collapsing
those cards down to a one-line "Cargando…" and back, which shifted the
page's layout enough to look like the browser jumped scroll position. Fix:
initialize `loading` to `true`, only ever set it `false` (never back to
`true`) — subsequent reloads swap in new data silently, no blank flash.

**Current state of the 5 sections** (`src/pages/`) — all fully wired to
Supabase, no sample data left anywhere:
- **`PanelGeneral.jsx`**: consolidated KPIs (balance total, patrimonio
  neto, ingresos/gastos del mes), the alerts list above (including the
  category-anomaly alert), account distribution bar chart, 6-month trend
  line + comparison table, and a "Comparativa año a año" card (current YTD
  vs. same months last year via `panelApi.fetchMonthlyTrend`, 2 StatTiles +
  a 4-line chart with dashed lines for the prior year).
- **`Cuentas.jsx`**: cuenta madre + hijas CRUD (name, currency), a monthly
  initial-balances editor covering every active account
  (`MonthlyInitialBalancesSection.jsx` — manual entry or via the iPhone
  Shortcut described in `prompt-dashboard-financiero.md`'s "Fase 2"; both
  write to `monthly_initial_balances` with `source: 'manual'|'shortcut'`),
  monthly allocation editor with previous-month templating
  (`MonthlyAllocationSection.jsx`), which also has a "Confirmar
  transferencia real" button that turns that month's planned amounts into
  actual `account_transfers` rows (madre → each hija) once, so the
  madre's computed balance drops automatically instead of needing a
  manual `monthly_initial_balances` adjustment — kept as a deliberate
  second step from "Guardar distribución" because `account_transfers` has
  no upsert key, so merging the two would duplicate transfers on every
  re-save of the plan; a `TransferHistorySection.jsx` below it lists the
  month's transfers (any account pair, not just madre→hija) with a small
  add/delete form, covering the "Historial de transferencias" line from
  `prompt-dashboard-financiero.md`. Also fixed-expenses CRUD with
  per-month paid status (`FixedExpensesSection.jsx`), and the
  exchange-rate card.
- **`GastosDiarios.jsx`**: MonIA CSV import (month/year picker, dedup via
  `monia_id`), the bank-assignment engine above, a "Pendientes de banco"
  confirmation table with historical-frequency suggestions, per-category
  monthly budgets, spend-by-category and spend-by-tag bar charts, gasto
  real vs. presupuesto asignado per cuenta hija, a "candidatos a gasto
  fijo" detector that flags a description repeated in ≥3 of the last 6
  months and offers to add it as a recurring fixed expense, a manual
  expense form (`transactionsApi.createManualTransaction`) that brought
  forward the prompt's "Fase 3" manual-entry idea early, for testing —
  `monia_id` is `not null`/unique so manual rows get a synthetic
  `manual-<id>` id (see `generateLocalId` gotcha above) and
  `origin: 'manual'`; the account picker is optional (blank = "pendiente
  de banco", same as an imported row) — and a free-text/multi-filter
  "Buscar movimientos" card (`transactionsApi.searchTransactions`, capped
  at 200 results) that searches the *entire* history, unlike every other
  table on this page which is scoped to the active month/year picker.
  Every transaction table on this page (pendientes, búsqueda, movimientos
  del mes) has a delete action wired to `transactionsApi.deleteTransaction`
  — deleting one and reimporting the same CSV re-adds it, since the
  `monia_id` dedup row is gone.
- **`Deudas.jsx`**: debt CRUD (creditor, total/restante, tasa mensual
  opcional, plazo opcional), per-debt installment calendar with a French
  fixed-payment amortization generator (`generateAmortizationSchedule` in
  `debtsApi.js`) when both tasa and plazo are set, a "regenerar cuotas
  pendientes" flow that replaces only unpaid installments, and the
  patrimonio-vs-deuda health chart. Amortization reconciliation: `debts`
  has a `schedule_synced_remaining_amount` column snapshotting
  `remaining_amount` at the moment the schedule was last
  generated/regenerated (kept in sync by `toggleInstallmentPaid`); when it
  drifts from the live `remaining_amount` (e.g. a manual payment made
  outside the installment flow), `Deudas.jsx` shows a warning banner next
  to "Regenerar cuotas pendientes" rather than silently letting the
  schedule go stale.
- **`MetasAhorro.jsx`**: both goal kinds — `'proposito'` (tied to a hija
  account, progress = that account's real balance, contribution log is
  annotation-only) and `'puntual'` (progress = sum of logged
  contributions, which *is* `current_amount`'s source of truth) — with a
  growth chart, a pace-based "cumplirás en ~X meses" projection, and a
  planeado-vs-aportado table (only shown when both `target_amount` and
  `target_date` are set). Contributions can be deleted
  (`savingsApi.deleteContribution`); for `'puntual'` goals this also
  decrements `current_amount` to keep it matching the log.

**Category/account naming is constrained**: only the categories and
accounts listed in `prompt-dashboard-financiero.md`'s mapping table (plus
whatever the user has since added through the app, or explicitly asked to
add — e.g. `Servicios` was added this way) are valid — see
`.claude/rules/nomenclatura.md`. `MonAi-List-*.csv` in the repo root is
reference material for understanding the import format only; it is never a
data source and its category name variants must not be propagated into the
schema or UI.

## Known deferred scope

These were explicitly discussed and left out — don't "fix" them
unprompted, they're deliberate cuts, not oversights:
- `MonthlyAllocationSection.jsx`/`FixedExpensesSection.jsx` have zero
  currency awareness by design (USD accounts are filtered out before
  reaching them, not made to understand currency).
- Debts, `fixed_expenses`, and `account_allocations` all have their own
  `currency` column in the schema, but only `debts` (via the consolidated
  total) and `accounts` actually branch on it anywhere in the UI today.
- `generateAmortizationSchedule` only runs once per debt (guarded by "zero
  installments yet"); regenerating replaces unpaid installments and
  recomputes the remaining term as `term_months - cuotas ya pagadas`.
  Drift from a changed `total_amount` or a partial manual payment made
  outside the installment flow is *detected and surfaced* (see the
  `schedule_synced_remaining_amount` warning banner above) but never
  auto-reconciled — the user still has to hit "Regenerar cuotas
  pendientes" themselves to fix it.
- `account_transfers` is a plain event log with no per-pair uniqueness —
  running the same "confirm transfer" action twice for the same month (in
  the app or, more easily, by re-running the iPhone Shortcut described in
  the next bullet) creates duplicate real transfers with no built-in guard; deleting
  the extra row from `TransferHistorySection` is the only fix today.
- No iOS Shortcut file is checked into this repo — the user builds and
  maintains it themselves on their phone. As currently designed it does 3
  Supabase REST calls per hija account per month: sign in
  (`/auth/v1/token?grant_type=password` for a fresh `access_token`), then
  upsert into `account_allocations` (`?on_conflict=user_id,account_id,year,month`,
  `Prefer: resolution=merge-duplicates`) and insert into `account_transfers`
  (madre → hija, no upsert — see the duplicate-transfer risk above), using
  `apikey` + `Authorization: Bearer <access_token>` headers throughout.

## Importable external-agent config detected

An OpenAI Codex config exists at `~/.codex/config.toml` (user-level, outside
this repo). If you want to bring over its MCP servers, slash commands,
subagents, skills, or instructions, reply `/import` to scan it and see what
would come over, then `/import --yes=<digest>` (the scan output names the
digest) to apply the user-level items. No Gemini CLI config was found.
