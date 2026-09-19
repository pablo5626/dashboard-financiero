# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal financial dashboard (React + Supabase) built from the spec in
`prompt-dashboard-financiero.md` — read that file first for product intent
(sections, data model rationale, multi-currency, the MonIA CSV import flow).
The Supabase schema lives in `schema.sql` and is the source of truth for the
database; any schema change goes there, not only in the Supabase dashboard.
**All 6 sections are now fully wired to Supabase** (see "Current state of
the 6 sections" below) — there is no more sample-data scaffolding left in
the app (`src/lib/sampleData.js` was deleted once the last section was
connected). `Diario.jsx` (the 6th, added later) is the one exception to
"fully replaces sample data" in spirit only in that it's an additive native
day-to-day entry page run in **hybrid mode** alongside the pre-existing
MonIA CSV import — see its entry under "Current state" for why.

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

## How the user actually operates this, month to month

The code docs below explain how things work; this section explains **what the
user does**, which is not deducible from the code and is what the conventions
around tags and transfers exist to serve.

**The accounts** (state as of Sep 2026 — they're CRUD-able from the UI, so
treat this as a starting map, not a rule to enforce): **Bold** is the cuenta
madre (COP); the hijas are **Nubank, Rappi, Nequi, Dale, Pibank, Efectivo**
(COP), plus **Arq** (USD) and **Arq EUR** (EUR). Two things a fresh session
can't infer: Arq and Arq EUR are **one real multi-currency account** split into
two rows because `accounts.currency` holds a single currency per row; and both
are `kind = 'hija'` even though they sit out the monthly madre→hijas ritual.

**The monthly ritual, in order:**
1. **Start of month, in Cuentas** — review the "Distribución mensual" (it comes
   pre-filled from last month's template), *Guardar distribución*, then
   *Confirmar transferencia real* **once**. That second button is what turns
   the plan into real `account_transfers` rows madre→hija and drops Bold's
   balance; it's deliberately separate, and re-running it duplicates transfers.
2. Load the month's **"Saldos iniciales"** (by hand, or via the iPhone
   Shortcut).
3. **During the month, in Gastos** — import the MonIA CSV with the month/year
   picker (re-importing is safe: it dedups on `monia_id`) and drain the two
   queues: "Pendientes de banco" and "Compras en divisa por confirmar".
4. **Closing check, in Panel** — read the alerts, and confirm each hija's
   "% usado" reconciles against its balance (`disponible − usado = saldo`, see
   Money math). That identity failing is the fastest signal something was
   entered wrong. **Known gap**: the "Gasto real vs. presupuesto por cuenta"
   card that used to show this per-hija `%usado` in `GastosDiarios.jsx` was
   removed (replaced by "Presupuesto por categoría", see that page's entry
   under "Current state of the 6 sections") and was deliberately **not**
   relocated to `Cuentas.jsx` — the user asked to just remove it, not move
   it. As of this writing there is no UI surface left showing the per-hija
   `%usado` number this closing-check step refers to; `Cuentas.jsx` still
   shows `saldo`/`asignado` per hija, so the identity can be checked by hand
   from those two numbers, but not read directly off a single `%` anywhere.

**What to do in each situation, and which MonIA tag it needs:**

| Situación | Qué hace el usuario | Tag en MonIA |
|---|---|---|
| Gasto normal desde una hija COP | Nada: lo trae el CSV | El nombre de la cuenta (`dale`, `nequi`, `pibank`…) |
| Compra desde arq en USD/EUR | Nada al capturar: la trae el CSV (en COP, convertida por MonIA) y luego confirma el monto real en euros/dólares en la cola "Compras en divisa por confirmar" | `arq` / `arq_eur`¹ |
| Mover plata entre cuentas propias | La registra como transferencia en la app, decidiendo el checkbox de presupuesto | `traslado`, solo si además aparece en el CSV |
| Comprar divisas (COP→USD, USD→EUR…) | La registra como transferencia (Cuentas → Historial de transferencias, o el "+" en modo Traslado) — ambos sugieren el monto de destino con la tasa guardada cuando las dos cuentas tienen moneda distinta | `traslado` (o `moneda`, alias viejo) |
| Ingreso que cae fuera del reparto mensual | Nada especial: entra como transacción positiva y amplía el disponible solo | El nombre de la cuenta |
| No sabe de qué cuenta salió | Lo confirma en "Pendientes de banco" | Ninguno |

¹ MonIA's tag input doesn't accept spaces, so a multi-word account name has to
be typed as `arq_eur` on the phone. `parseMonIACSV` normalizes underscore to
space on every tag right after lowercasing it, so it still matches
`accounts.name.toLowerCase()` ("arq eur") — without that normalization the tag
silently fails to match and the row falls through to "pendiente de banco"
instead of landing on arq EUR. Applies to any multi-word tag, not just this one.

Three rules behind that table, in the order they're most often forgotten:
**a transfer is never a gasto** (moving money doesn't consume it — the
consolidated views count the purchase once, where it happened); **MonIA
converts a foreign-currency purchase to COP when it saves it**, so the CSV can
never carry the original EUR/USD amount and the import has to reconstruct it
(see the arq flow below) — `ignorar` still exists, but only for movements
genuinely already entered by hand; and **the budget checkbox on a transfer**
distinguishes "moving money to spend it from the other account" (consumes the
source's budget) from "just rebalancing pockets" (doesn't).

## Architecture

**Stack**: Vite + React 18, plain JSX (no TypeScript), plain CSS with custom
properties for design tokens + CSS Modules per component (no Tailwind),
`react-router-dom` for the 6 top-level sections, Recharts for charts,
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

**Multi-user model (open sign-up, everyone starts empty)**: the app is no
longer single-user. `Login.jsx` has four modes on one screen — Entrar /
Crear cuenta / Olvidé mi contraseña, plus "Nueva contraseña" when
`AuthContext` sees the `PASSWORD_RECOVERY` event (`recovering` state; `App.jsx`
shows `Login` while it's true even though a session exists). Sign-up and
recovery emails redirect back to `window.location.origin + BASE_URL`. **A new
user has zero rows in every table**: `schema.sql` has no trigger on
`auth.users` and no active seed (the commented `insert` blocks are the
original owner's example data and must never run once there is more than one
user, since their `select id from accounts where name = ...` subqueries don't
filter by user). Isolation is 100% RLS — no client query filters by `user_id`.
The account/category names listed elsewhere in this file (Bold, Nequi, Arq,
the `prompt-dashboard-financiero.md` mapping table…) describe the **original
owner's** setup, not something every user gets; each user builds their own from
Ajustes. First-run guidance is `src/components/OnboardingCard.jsx`, a
"Empieza aquí" card at the top of Panel (crear madre → crear una hija → crear
categorías), derived from the data itself (no flag or table) and hidden once
all three exist. While there is no madre, Ajustes → Cuentas only offers to
create the madre (`isMadreForm`), and it accepts an optional initial balance
like any other account. `SettingsPanel` dispatches
`dashboard:accounts-changed` after creating/editing an account or category so
Panel, Cuentas and the onboarding card refresh (same window-event pattern as
`dashboard:debts-changed`); the "+" sheet re-fetches accounts/categories/rates
every time it opens for the same reason.

**Supabase Auth settings live outside the repo**: sign-ups must be enabled,
and Site URL / Redirect URLs must include the GitHub Pages URL
(`.../dashboard-financiero/`) or confirmation/recovery links land on the wrong
page. The default Supabase SMTP allows very few emails per hour, so with email
confirmation on, set up custom SMTP (or turn confirmation off).

**Edge Functions are multi-user** (`supabase/functions/_shared/`): `auth.ts`
(`requireUser` builds a client from the anon key + the caller's JWT, so RLS
applies, and rejects with 401 unless `auth.getUser()` finds a real user — the
gateway's `verify_jwt` also lets the public anon key through), `quota.ts`
(`consumeAiQuota` calls the SQL function `consume_ai_quota`, backed by the
`ai_usage` table, and answers 429 past 60 AI calls per user per day — the
Gemini key is shared, so this is what stops one account from burning it) and
`input.ts` (`sanitizeNameList`). `voice-parse` and `receipt-parse` no longer
hardcode categories/accounts: the client sends the user's own names in the
body (`categories`, `accounts`) and they're injected into the prompt; empty
lists make the model answer `null`. `money-ask` got size caps. Errors from
`supabase.functions.invoke` are unwrapped with
`src/lib/functionErrors.js` so the 429 message reaches the UI instead of
"non-2xx status code". `rates-auto-update` (cron, `verify_jwt = false`, guarded by
`RATES_CRON_SECRET`) upserts the rate pairs for every user that has at least
one account. `quick-capture` (iOS Shortcuts) no longer uses the service role or
a fixed owner: the Shortcut logs in first (see `.claude/rules/shortcuts-ios.md`)
and sends `Authorization: Bearer <access_token>`; the expense currency now
comes from the chosen account.

**Security posture (audited Sep 2026 against a 20-point checklist)**:
- **RLS is the only isolation** and was verified live: every table answers `[]`
  to the public anon key and an anonymous `insert` is rejected. The one
  deliberate exception is `ai_usage`, which has a `select` policy only — a
  generic owner `update` policy would let a user reset their own daily AI
  counter — and is written solely by the `security definer`
  `consume_ai_quota` (execute granted to `authenticated` only).
- **CORS is an allowlist, not `*`**: `_shared/auth.ts` `withCors` reflects the
  origin only for `https://pablo5626.github.io` (the site, and the APK, which
  opens it in Chrome), `localhost`/private-LAN dev origins, or whatever the
  optional `ALLOWED_ORIGINS` secret adds. Bearer-token auth means `*` was never
  CSRF-exploitable, but there is no reason to leave it open.
- **CSP** is injected only at build time by `vite.config.js` (dev needs inline
  scripts for hot reload) as a `<meta>`: `connect-src` is limited to the app's
  own Supabase origin (derived from `VITE_SUPABASE_URL`), `open.er-api.com` and
  `api.pwnedpasswords.com`; inline scripts are allowed by hash computed at build,
  so editing the SPA-redirect snippet can't silently break it. **Any new
  third-party host the browser must call has to be added to `connect-src`
  there**, or the request is blocked. `frame-ancestors` can't be set from a
  `<meta>`, so clickjacking can't be prevented on GitHub Pages.
- **Sessions live in `localStorage`** (supabase-js default); with no
  `dangerouslySetInnerHTML`/`innerHTML` anywhere and the CSP above, that is the
  accepted trade-off. Sign-up checks passwords against Have I Been Pwned by
  k-anonymity (`src/lib/passwordCheck.js`, only a 5-char hash prefix leaves the
  browser, fails open if unreachable).
- **Edge Functions**: upstream (Gemini) and internal errors are logged
  server-side and returned to the client as generic messages; `receipt-parse`
  checks file signatures (magic bytes) against the declared type; the cron
  secret in `rates-auto-update` is compared in constant time and the function
  refuses to run if the secret is unset.
- **Known and accepted**: `npm audit` reports vite/esbuild (dev-server only,
  never in the production bundle — but don't run `npm run dev --host` on an
  untrusted network) and react-router (open redirect via attacker-controlled
  `<Link>` targets, which this app doesn't have); both need major upgrades
  (vite 8, react-router 7) and should be done as a separate, browser-tested
  change. FKs between tables aren't user-scoped, but a foreign id only lets a
  user corrupt their *own* rows (RLS hides everything else), so it isn't
  exploitable. Supabase Auth settings live outside the repo: sign-ups are open
  and email confirmation is on (verified via `/auth/v1/settings`); minimum
  password length, CAPTCHA and leaked-password protection are dashboard
  settings. The repo is public, and `CLAUDE.md`/`prompt-dashboard-financiero.md`
  describe the owner's personal accounts and categories.

**Data layer pattern**: each domain gets one `src/lib/*Api.js` module that
wraps the raw Supabase queries for that domain — `accountsApi.js`,
`allocationsApi.js`, `fixedExpensesApi.js`, `categoriesApi.js`,
`tagsApi.js` (tags catalog CRUD — non-normative, see "A `'tags'` section..."
below), `transactionsApi.js` (CSV parsing + the bank-assignment engine),
`transfersApi.js` (account_transfers CRUD + `sumOutgoingByAccount`, the rule
for what counts as budget used), `debtsApi.js`, `savingsApi.js`,
`panelApi.js` (cross-page aggregates: monthly trend, alerts),
`exchangeRatesApi.js` (manual exchange rates, one row per currency pair),
`userSettingsApi.js` (the single `user_settings` row — today just the
category-budget alert toggle/threshold, see "A `'presupuestos'` section...").
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
defines the 6 destinations (`NAV_ITEMS`) once and renders them as a bottom
tab bar below 768px and a sidebar at/above it — `App.jsx`'s `<Routes>` must
stay in sync with that list if a section is ever added/renamed/removed.
The layout follows iOS HIG conventions adapted to web (safe-area insets,
44px touch targets, no hamburger menu) — see the `ios-hig-design` project
skill and `.claude/rules/diseno-ui.md` before changing it. `AppShell` also
shows a small numeric badge on the "Gastos" nav item (sidebar and tab bar)
counting both queues drained there — unassigned ("pendiente de banco")
transactions plus foreign-currency purchases whose amount is still estimated —
refetched on every route change via `countPendingTransactions()` +
`countPendingCurrencyTransactions()`.

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
adding new tables or charts. **A money `<td>` needs `className="amount-cell"`**
(also defined in `index.css`, next to `.simple-table` — just
`white-space: nowrap`) — `Intl.NumberFormat`'s COP formatting inserts a
literal space between the sign and the digits (`formatCOP(-100000)` →
`"-$ 100.000"`), and without `nowrap` a narrow column can wrap the line
exactly there, splitting "-$" onto its own line. Applied to every `<td>`
that renders `formatCOP`/`formatByCurrency` across the app now — keep doing
so for any new money cell.

**Money math**: an account's current balance is never stored directly — it's
computed as an **anchor + accumulation**: the most recent `monthly_initial_balances`
row at or before the queried month (or 0 as of `accounts.created_at` if that
bolsillo never had one) plus every `account_transfers`/`transactions` row from
that anchor month through the queried month's end (see `resolveAnchorsFromRows`
in `src/lib/balanceAnchors.js`, shared by `fetchBalancesForMonth` in
`accountsApi.js` and `fetchMonthlyTrend` in `panelApi.js`). This replaced an
earlier "one row required per account per month" model — see "Ajuste de saldo
(opcional)" under `Cuentas.jsx` below for why a monthly re-entry stopped being
mandatory. `account_allocations` is the separate "how much was
budgeted this month" figure, not the balance. `parent_account_id` on
`accounts` is purely a structural/UI grouping (e.g. for the Sankey view) —
it says nothing about where an account's money actually comes from; that's
always `account_transfers`. **A hija's saldo (balance) is not the same as
how much of its budget has been spent** — the balance rises the moment it's
funded (via `monthly_initial_balances` or a transfer in), before any real
spending happens, so `Cuentas.jsx`'s hija cards compute the "% usado"
progress bar from `transactionsApi.getAccountFlowsForMonth` (which returns
both `spent` — real negative `transactions` for the month, summed per
account — and `income`, the positive ones) — never from
`balances[account.id]`, otherwise funding a hija to 100% of its budget shows
as "100% usado" before a single peso was actually spent. **The denominator is
`disponible = account_allocations + ingresos reales del mes en esa cuenta`,
not the allocation alone**: money that lands in a hija outside the monthly
madre→hijas ritual (an unexpected income straight into Dale, say) is real
spendable money, and measuring against the plan alone would flag spending it
as an overdraft. `account_allocations` is deliberately left untouched by
this — it keeps meaning exactly "lo que la madre repartió este mes", so
`MonthlyAllocationSection`'s "Total a distribuir" and "Confirmar
transferencia real" keep asking Bold only for what Bold actually owes.
**Transfers never expand the disponible, only real income transactions do** —
a madre→hija transfer *is* the allocation (counting it would double the
budget) and a hija→hija top-up is money that was already inside.

The numerator is **`usado = gasto directo + transferencias salientes`**, not
spending alone: money wired out of a hija is money that left its budget, even
though the purchase itself shows up on the destination account. The real case
this fixes: $300.000 landed in Dale, $333.500 then moved Dale → arq, and the
purchase executed from arq — Dale's balance dropped correctly but its card
still read "5% usado", as if that money were still there to spend. Outgoing
transfers are summed by `transfersApi.sumOutgoingByAccount(transfers,
accounts)`, the single definition of the rule, which **excludes transfers back
to the madre** (returning leftover money to Bold is not using the budget),
**excludes rows flagged `consumes_budget = false`**, and applies the same
currency check as every other per-account view. That flag exists because moving
money between two hijas is ambiguous — it can be funding a purchase that will
execute from the other account (consumes the budget) or just rebalancing
pockets (doesn't) — so both places that create a transfer
(`TransferHistorySection` and the "+" FAB's traslado mode) ask with a
checkbox, defaulted to checked, shown only when neither end is the madre.
It's set at creation and not editable
afterwards: to change it, delete the transfer and re-create it, same as every
other field of a transfer.
`fetchBalancesForMonth` returns it as `transferredOut` at no extra query cost
(it already fetches the month's transfers), and `GastosDiarios.jsx` fetches
them via `getTransfersForMonth` for its "Movido a otras cuentas" column — kept
separate from "Gastado este mes" so that column keeps meaning direct spending
only. This makes the hija card reconcile exactly: **`disponible − usado =
saldo`** (645.420 − 368.500 = 276.920 in that case), which is the quickest way
to sanity-check the math after touching any of these numbers. None of this
makes a transfer a *gasto*: the consolidated views still ignore transfers
entirely and count the purchase once, where it happened. The same money showing
in Dale's "% usado" and in arq's gasto is not double counting — they answer two
different questions.
**The rule for every money aggregation: per-account views stay in the
account's own currency; consolidated (cross-account) views convert to COP.**
`fetchBalancesForMonth(accounts, year, month)` and
`transactionsApi.getAccountFlowsForMonth(accounts, year, month)` are the
canonical per-account pair — both take the full account **objects** (not bare
ids) precisely because they're currency-aware: each account only sums rows
whose `currency` matches that account's own `currency` (default `'COP'`), so a
COP account and a USD account never get their amounts mixed, and
`GastosDiarios.jsx` applies the same check when building `spentByAccount` /
`incomeByAccount`. `panelApi.fetchMonthlyTrend` and `fetchTotalDebt` are the
canonical consolidated pair: they do the equivalent per-row currency check but
additionally convert non-COP amounts to COP (via `exchangeRatesApi.toCOP`)
before summing into a single number — same as `GastosDiarios.jsx`'s
spend-by-category and spend-by-tag charts, which cross accounts of different
currencies and so convert too. Pass `{ convertToCOP: false }` to
`fetchMonthlyTrend` when the caller wants a trend to stay in the linked
account's native currency instead (used by 'proposito' savings goals tied to a
USD account). Amounts of a single transaction are rendered with
`formatByCurrency(t.amount, t.currency)`, never bare `formatCOP` — that's what
made a EUR row print as pesos. `listRecentExpenses` (the recurring
fixed-expense detector) is the one place that simply **drops** non-COP rows
instead of converting: it averages amounts and `FixedExpensesSection` has no
currency concept at all.

**Multi-currency (COP/USD/EUR)**: `accounts.currency` (default `'COP'`) is
the only account-level currency field (free text, no CHECK/enum — any
currency code is technically legal, but only COP/USD/EUR have real support
in the UI, see `CURRENCIES` in `format.js`); `transactions`,
`account_transfers`, `monthly_initial_balances`, `account_allocations`,
`debts`, `fixed_expenses`, and `savings_goals` each carry their own
`currency` too. `arq` isn't a simple USD account — it's a multi-currency
account (several manually-tracked pockets) whose USD and EUR pockets are
each modeled as their own `accounts` row (this stays true — grouping them
visually, see below, never merges the underlying rows). Exchange rates are
**one row per currency pair** in `exchange_rates` (`base_currency`/
`quote_currency`/`rate`, unique per `(user_id, base_currency,
quote_currency)`), edited via `exchangeRatesApi.getRates`/`setRate(base,
quote, rate)` — up to 3 pairs in practice (COP↔USD, COP↔EUR, USD↔EUR); the
USD↔EUR pair is stored directly rather than derived by crossing the two COP
rates, since a real USD→EUR exchange (the most common cross-currency
movement) doesn't necessarily match a rate computed by pivoting through
COP. **There is no standalone "Tasa de cambio" card anymore, and Cuentas.jsx
no longer edits rates inline either** — an earlier iteration rendered a
`renderRateRow(base, quote)` row directly inside each non-COP account's card
(and, before that, a disconnected standalone card); both were removed once
Ajustes → Tasas de cambio (see "Fifth section, 'tasas'" below) became the
one place to edit every pair — keeping a second, duplicate editor on
Cuentas.jsx wasn't worth the upkeep once Settings covered the exact same
`exchange_rates` rows. A `(base, quote, rate)` row always means "1 `quote` = `rate` `base`"
(e.g. `base='COP'`, `quote='USD'`, `rate=4000` → "1 USD = 4000 COP"),
consistently across all 3 pairs — so the USD/EUR row reads "1 EUR = rate
USD" (e.g. `rate=1.16` → 1 EUR = 1.16 USD). **This bit us once already**: a
user-quoted "dollar to euro" rate (e.g. "0.86", meaning "1 USD buys 0.86
EUR") is the *reciprocal* of what this field expects — it must be entered
as `1 / 0.86 ≈ 1.16`, not typed in as-is. There's no validation catching an
inverted rate (any positive number is "valid"), so double-check which
direction a quoted rate is in before saving it here. `exchangeRatesApi.toCOP`
(used for consolidated totals in Panel General/Deudas) and the generic
`convertAmount(amount, from, to, rates)` it's built on both take the full
`rates` array rather than a single scalar, and look up the matching pair
(or its inverse) each time; if no rate is configured for a given
non-COP currency, `toCOP` returns `0` rather than inventing a conversion,
so that currency's balances are silently excluded from consolidated totals
until the user sets it — a warning banner above the accounts grid in
`Cuentas.jsx` surfaces this case (moved there when the standalone rate card
was removed, same underlying check).

**Multi-currency accounts are a real single row now, not two linked rows**
(`accounts.is_multi_currency` + the `account_currencies` table) — this
replaced the older `currency_group_id` design (two separate `accounts` rows,
e.g. `arq` and `arq eur`, linked only for display) after the user explicitly
asked for "one account that really holds several currencies, each with its
own balance," not just a shared card. `arq` is the running example: it's now
a single `accounts` row (`is_multi_currency = true`, `currency = 'USD'` as
its *primary* pocket) with one child row in `account_currencies` per
additional pocket (`{ account_id: arq.id, currency: 'EUR', tag: 'arq eur' }`).
`accountsApi.listAccounts()` attaches those child rows to each account as
`account.extraCurrencies = [{ currency, tag }]`.

Every money-math function that used to assume "one `accounts` row = one
currency" now resolves a **pocket key** instead of a bare account id — see
`src/lib/currencyPockets.js` (`buildPocketIndex`, `resolvePocketKey`,
`flattenAccountPockets`), a small dependency-free module so `accountsApi.js`,
`transfersApi.js` and `transactionsApi.js` can all import it without a
circular import (`accountsApi.js` already imports from `transfersApi.js`).
The convention: a pocket in the account's **primary** currency keeps the old
"plain" key (`accountId`) — fully backward-compatible with any code still
doing `balances[account.id]` — and a pocket in any **additional** currency
gets the composite key `` `${accountId}:${currency}` ``.
`accountsApi.fetchBalancesForMonth`, `accountsApi.totalBalanceInCOP` (new —
sums every pocket of a multi-currency account into one COP figure for
consolidated totals in Panel General/Deudas, since those used to read only
`balances[account.id]` and silently drop the other pockets),
`transfersApi.sumOutgoingByAccount`, and `transactionsApi.getAccountFlowsForMonth`
all use this same convention, as does `GastosDiarios.jsx`'s own inline
per-account spend/income loop (it doesn't call `getAccountFlowsForMonth`,
it recomputes similarly from `monthTransactions`).

The **bank-assignment engine** resolves a *pocket* (`{ accountId, currency }`),
not just an account id: a bare tag (`arq`) matches the account's primary
currency, and each additional pocket's own `tag` (`account_currencies.tag`,
e.g. `"arq eur"`) matches that specific currency on the *same* `accountId` —
see `pocketByTag`/`pocketsByCurrency` in `transactionsApi.js`'s
`importTransactions`. This is the one place a multi-currency account still
needs a secondary identifier per pocket (the `tag` column) — MonIA can only
ever send one tag per row, so something has to disambiguate which pocket a
tag like `arq_eur` (normalized to `"arq eur"`) targets on an account that
otherwise has a single id. `isReservedTag` also checks `extraCurrencies[].tag`
now, so a manually-typed `"arq eur"` tag is still recognized as reserved.

**Editing** happens on the account as a whole in `Cuentas.jsx`: tapping a card's
header turns the card into a full-width edit form (name, primary currency as
`ChipPicker` pills, a "Cuenta multi-moneda" `SwitchRow` that reveals an add/remove
list of extra `{ currency, tag }` pockets, calling
`accountsApi.addAccountCurrency`/`removeAccountCurrency`) — see "The four pages
that used a text 'Editar' button" below. There's no more separate "¿Es otra
moneda de...?" picker on a second account row, since there is no second row.
**Creating** a multi-currency account from scratch also happens in one step, in
Ajustes → Cuentas: picking `Multi-moneda` among the currency pills reveals a
builder (tap a currency to add it, min. 2, optional "cuánto tiene" amount each,
the first one added is the primary) — `createAccount` inserts the
`account_currencies` rows and seeds `monthly_initial_balances` for the current
month from those amounts in the same call, so standing up something like arq no
longer requires creating one account then editing a second one to link it. A pill
switcher inside the card
(`flattenAccountPockets([account])` fed into a local `activePocket` state,
`{ [accountId]: pocketKey }`) still lets the user flip between an account's
pockets instantly, same UX as the old grouped-card design, just backed by
one real row instead of two.

**Known gaps left by this change** (documented rather than silently
unsupported): `QuickCaptureFAB.jsx`'s manual **gasto/ingreso** branch and
`MetasAhorro.jsx`'s `'proposito'` goals still resolve a chosen account to
its **primary** currency only (`currencyOf(id)` / `balances[g.account_id]`)
— there's no pocket picker in those two surfaces yet, so logging a manual
EUR expense against arq, or pointing a savings goal at arq's EUR pocket
specifically, isn't possible from there today (the CSV import path,
`TransferHistorySection`, and — since a later pass, see "Quick capture
(FAB)" below — the FAB's own **transferencia** branch **are** pocket-aware,
via the same `flattenAccountPockets` picker). `TransferHistorySection`'s
transfer-history *table* also still renders the bare account name for a
past transfer's origin/destination, not which pocket — the row's own
`formatByCurrency(amount, currency)` is what actually tells you which pocket
was involved.

**`CurrencyExchangeSection.jsx` (the standalone "Cambio de divisa" quick-swap
widget) was removed** — it duplicated `TransferHistorySection`'s own ability
to register a transfer between two accounts with a converted destination
amount, and once Ajustes → Tasas de cambio also existed for rate editing
(see "Fifth section, 'tasas'" below), the user asked to declutter Cuentas.jsx
of both currency-conversion widgets. Registering a currency swap (COP hija →
arq, or between arq's own pockets) now goes through
`TransferHistorySection`'s own add-transfer form (two manual amounts,
`to_amount`/`to_currency`) or the "+" FAB's traslado mode, which still
suggests "Monto recibido" from the saved rate the same way the removed
widget did (see "Quick capture (FAB)" below) — the saved-rate suggestion
logic itself lives in `exchangeRatesApi.convertAmount`, not in the deleted
component, so nothing about that mechanism was lost.
Non-COP accounts (USD or EUR) are deliberately kept out of
`MonthlyAllocationSection` (madre→hijas monthly distribution) and
`FixedExpensesSection` (recurring fixed expenses) — neither component has
any currency concept, and arq's pockets are used rarely enough (mostly
international purchases) that they don't participate in either monthly
ritual. Individual debts (`Deudas.jsx`) are COP-only in the UI for now —
only the consolidated "Deuda total vs. Patrimonio" comparison is
currency-aware.

**Bank-assignment engine** (full rules in `.claude/rules/motor-asignacion.md`,
implemented in `transactionsApi.js`'s `importTransactions`): a MonIA CSV
row's account is assigned via, in order, (1) a tag matching the lowercased
name of an active hija account, OR a non-COP `currency` when exactly one
active account has that currency (both are "level 1" — real explicit data,
never speculation; tag wins if a row somehow has both), (2) a category with
`is_ambiguous = false` whose entire history has gone to a single account,
(3) otherwise the transaction is left `account_id = null` ("pendiente de
banco") for manual confirmation in `GastosDiarios.jsx`, which also feeds
`category_account_stats` to improve future suggestion ordering. Never add
a 4th, frequency/probability-based auto-assignment level — this is an
explicit, repeatedly-reinforced user rule. Once the account is resolved (at
any level), a **currency reconciliation step** runs: a row whose currency
differs from its account's is converted into the account's currency and
queued for confirmation — see the arq flow below. There is **no fixed list of valid
tags**: the vocabulary *is* the set of active hija account names (`dale`,
`nequi`, … plus `arq` / `arq eur`), so creating an account enables its tag on
its own. MonIA can't type spaces into a tag, so a multi-word name has to go in
as `arq_eur` — see the footnote on the situations table above for the
underscore-to-space normalization that keeps that matching the account name. The old hardcoded `BANK_TAGS` constant was deleted precisely because
it drifted — it gated assignment *and* the spend-by-tag chart exclusion, so a
purchase tagged `arq` silently fell through to "pendiente" and would have
double-counted in that chart.

**Ignored rows (`IGNORED_TAGS` = `traslado`, `moneda`, `ignorar`)** are a third
level-1 signal that, unlike an account tag, does *not* assign an account — it
resolves the row to `account_id = null` on purpose (`assignment_level = 1`,
`assignment_confirmed = true`). It marks a CSV row whose real movement is
**already recorded somewhere else**, for two distinct reasons that share one
behavior: `traslado` (and `moneda`, its historical alias) is a movement between
the user's own accounts — Dale → arq, buying foreign currency — that lives in
`account_transfers`; `ignorar` is a purchase already entered by hand as a
transaction. `ignorar` used to be mandatory for every arq purchase; it isn't
any more (see the foreign-currency flow below), but it stays valid for anything
genuinely entered by hand. Because it's marked
`assignment_confirmed = true` rather than needing the default `false`, it never
shows up in "pendiente de banco" or its badge/alert count — both
`countPendingTransactions` and `listPendingTransactions` filter on
`assignment_confirmed = false`, not just `account_id is null`, specifically so
these rows are excluded without a schema change. On top of that, **these rows
must never count as gasto or ingreso anywhere** — counting the CSV row too
would book the same movement twice, subtracting it from the source account
again and inflating "gastos del mes". The filter is applied at read time via
the exported helper `isIgnoredRow(tags)` in `fetchMonthlyTrend`,
`fetchAlerts`, `listRecentExpenses` and `GastosDiarios.jsx`'s chart loop —
**any new query that sums gastos or ingresos has to filter with it too**, which
is the easy part to forget (each of those queries had to add `tags` to its
`select`).

**Foreign-currency purchases (the arq flow)**: MonIA *lets you type* the amount
in the currency of the purchase (EUR 51.31), but **converts it to COP when it
saves**, so the CSV always arrives in COP and the original amount is gone —
the `currency` column is COP on every row in practice, which is why the
assignment engine's currency rule (level 1c) almost never fires. The purchase is
therefore imported normally with the account's tag (`arq` / `arq eur`) and the
foreign amount is reconstructed at import time by `convertToAccountCurrency`
(`transactionsApi.js`): whenever the resolved account's currency differs from
the row's, `amount`/`currency` are rewritten into the **account's** currency
(estimated with the manual rate from `exchange_rates` via `convertAmount`, or
`0` when no rate is configured for that pair — same "don't invent a conversion"
rule as `toCOP`), the CSV's original figures are kept in `source_amount`/
`source_currency` for audit, and `currency_pending = true` puts the row in the
"Compras en divisa por confirmar" queue in `GastosDiarios.jsx`, where the user
types the exact 51.31 and confirms. Re-importing the same CSV never clobbers a
confirmed amount — the `monia_id` dedup uses `ignoreDuplicates`.

Storing the row as-is is not a neutral alternative: because
`fetchBalancesForMonth` and `getAccountFlowsForMonth` only sum rows whose
currency matches the account's, a COP row on a EUR account is **silently
dropped** — present in the table, invisible in the balance and the "% usado".
That was a latent bug the `ignorar` workaround happened to avoid. The manual
form still exists and still takes its `currency` from the selected account (see
`createManualTransaction`), but it's no longer the required path for arq.

Every `currency_pending` row is marked with a small `≈` (in `GastosDiarios.jsx`)
wherever its amount surfaces outside the confirmation queue — next to the
amount in "Movimientos" and next to "Gastado este mes" in the per-account
budget table (with a tooltip and, for the latter, a count of how many pending
rows are baked into that total) — so an estimate is never visually
indistinguishable from a confirmed amount. In the queue itself, the "tasa
implícita" column stays blank (`escribe el monto real →`) until the user
actually edits the field: the pre-filled draft value **is** the estimate that
was computed by dividing by the manual rate, so dividing back would just
echo that same rate relabeled as "what MonIA used" — showing a fabricated
number instead of admitting nothing real is known yet.

**Alerts system** (`panelApi.fetchAlerts`, rendered in `PanelGeneral.jsx`'s
"Alertas" card): surfaces fixed expenses and debt installments due within
5 days (or overdue), savings goals within 30 days of their target date (or
past it), pending "sin cuenta asignada" transactions, categories that
reached their `monthly_budget` (`categories.monthly_budget`, a flat
monthly cap edited from Ajustes → Categorías — not month-by-month, just one
number that applies every month until changed). That alert is configurable
since Ajustes → Presupuestos existed (see "A `'presupuestos'` section..."
below): it fires from `budget_alert_threshold_pct` (default 100, so the old
"only when exceeded" behavior is the default) and can be switched off with
`budget_alerts_enabled`, both read from `user_settings`; it is `'warning'`
between the threshold and 100% and `'critical'` at/over 100%.
`'divisa_pendiente'` for foreign-currency
purchases still carrying an estimated amount (`currency_pending`), and a
`'anomalia_categoria'` alert when a
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

**Quick capture (FAB) + voice input**: `QuickCaptureFAB.jsx`, mounted in
`AppShell.jsx` on all 6 pages, covers gasto/ingreso/transferencia without
navigating to `GastosDiarios.jsx`/`Cuentas.jsx` — it calls
`transactionsApi.createManualTransaction`/`transfersApi.createTransfers`
directly, the same functions the full pages use. **The floating buttons are
a 2-piece cluster now** (bottom-left: search icon + "+"), plus a separate,
always-visible circular mic button at bottom-right (`styles.fabMic`,
`var(--series-1)` at rest — kept blue rather than matching a MonIA
screenshot's warm/red at-rest color, since this app reserves red/
`--status-critical` for destructive/critical state, turning red only while
actively `listening` via the pre-existing `.micListening` pulse). Tapping the
mic button (`handleMicButtonClick`) resets the form, opens the sheet, and
starts `SpeechRecognition` in one tap — no more opening "+" first and
finding a smaller mic icon buried inside the amount row (that inline button
was removed; the standalone one fully replaces it).

**"+" groups the camera as a satellite bubble instead of a third icon in the
row**: the cluster used to be 3 always-visible icons ("+", lupa, cámara) in
one pill — the user later shared a short reference video
(`other recursos/referencia boton.mp4`, a screen recording of a different
app) showing a single "+" that, on tap, pops a camera bubble directly above
it before opening anything, and asked for that same grouping instead of a
static row. `plusExpanded` (boolean state) gates a `.fabSatellite` button
rendered inside a `.fabPlusWrap` (a `position: relative` wrapper anchoring
the bubble with `position: absolute; bottom: 100%` above "+", with a small
scale/opacity entrance animation) — **the exact tap sequence was a deliberate
choice, confirmed with the user via `AskUserQuestion`** over the alternative
of gating it behind a long-press: a first tap on "+" while collapsed only
sets `plusExpanded = true` (reveals the camera bubble, tints "+" with
`--series-1` via `.fabPlusActive` to signal the armed state, opens nothing
yet); a second tap on "+" while already expanded (`handlePlusButtonClick`)
collapses it and opens the normal manual-capture sheet — so "+" is still the
direct path to logging a gasto/ingreso/transferencia, the camera is the
extra option that surfaces first. Tapping the satellite itself
(`handleCameraButtonClick`, unchanged) collapses `plusExpanded` and opens the
dedicated receipt-scan screen directly. Any other entry point that opens the
sheet (the mic button, the lupa) also collapses `plusExpanded` first, so the
bubble never lingers stuck open over an unrelated screen. The lupa kept its
own always-visible spot in the pill, to the left of the "+"/camera group —
only "+" and the camera regrouped, per what the video specifically showed.
**Tapping anywhere else on the screen while the satellite is expanded also
retracts it** — a `pointerdown` listener on `document` (added/removed via a
`useEffect` gated on `plusExpanded`, so it's never attached while "+" is
collapsed, its normal state) closes the bubble the moment the click target
falls outside `plusWrapRef` (`.fabPlusWrap`), without opening the sheet —
same behavior as a standard menu/popover that dismisses on an outside tap,
requested after the user found the bubble stayed open when they tapped
elsewhere instead of on "+" itself a second time.

**The "+" sheet is a full-screen page on mobile now, not a bottom sheet** —
redone to match a reference screenshot the user shared (a MonIA-style full
screen with generous spacing, no rounded-corner card floating over the tab
bar). `.sheet` drops its `border-radius`/`box-shadow`/`max-height:85dvh` and
instead fills `100dvh` below 768px (the drag-handle affordance was removed
too, since there's no longer a bottom-sheet edge to suggest dragging);
desktop/tablet (≥768px) keeps the previous centered floating card
unchanged, only the mobile branch of the same `min-width: 768px` media
query changed. Inside the gasto/ingreso form, `.form` is `flex: 1` and
`.bottomRow` (the "#" tag toggle + "Guardar") gets `margin-top: auto`, so
the tag/Guardar row anchors to the bottom of the screen instead of sitting
right under the category row — the same generous "espacios" look as the
reference. Descripción → Monto → Cuenta (still right below Monto, unchanged
placement) → categorías stayed in the same order, only the container and
spacing changed. `CategoryEmojiGrid.jsx`'s tiles (shared with `Diario.jsx`)
changed shape to match: a horizontal pill (emoji + name side by side,
`border-radius: 999px`) instead of the earlier vertical panelito (emoji on
top, name below) — still the same horizontally-scrollable row, just a
different chip shape per the reference.

**Date moved to the top, tag moved into the bottom row, on a follow-up
ask**: `form.date` used to live in `.bottomRow` next to "#" and "Guardar"
(a fixed-width `<input type="date">`); it's now the very first field in the
gasto/ingreso branch, right above Descripción, styled as a small
`.topDatePill` (`align-self: flex-start` so it doesn't stretch full-width
like the rest of `.form`'s children under the default `align-items:
stretch`). The tag input moved the other way, into `.bottomRow` itself —
it only renders there once `tagOpen` is true (same toggle as before), as a
flex:1 `.tagInlineInput` sitting between "#" and "Guardar" instead of its
own full-width row below the category grid. Net effect: the row that used
to read "# · fecha · Guardar" now reads "# · [tag cuando está abierto] ·
Guardar", and the fecha pill sits at the top instead. Also dropped
"(opcional)" from the tag placeholder (now just "Tag") — the toggle itself
already makes it obviously optional, so the label was redundant. This
JSX/CSS reshuffle is scoped to the gasto/ingreso branch only, same as the
full-screen change above — transferencia mode's own date field (inside
"Más opciones") is untouched, since it has no tag field to make room for.

**The search icon's behavior was reversed mid-session**: it used to call
`navigate('/gastos')` as "a shortcut into the existing 'Buscar movimientos'
card there, deliberately not a new search modal, since one already exists
and duplicating it wasn't worth the risk" — the user explicitly asked to
undo that: no redirect, the lupa should open search right where you are.
`onOpenSearch` is now passed down from `AppShell.jsx` (same reasoning as
`onSaved`/`refreshPendingCount` — the FAB and the routed page are siblings
under `AppShell`, not parent/child, so a prop is how they talk), and the
button calls `onOpenSearch?.()` instead of navigating. `AppShell.jsx` owns
a `searchOpen` boolean and renders the new `SearchPanel.jsx` (see below)
alongside `QuickCaptureFAB`/`SettingsPanel`. **`GastosDiarios.jsx`'s inline
"Buscar movimientos" card was removed once `SearchPanel.jsx` existed** —
duplicating the same search UI in two places (a page card and a global
popup) wasn't worth the upkeep once the popup covered the same need from
anywhere in the app, so this is the one and only copy of the feature now.

The `voice-parse` pipeline itself is unchanged: a Web Speech API transcript
goes to the `voice-parse` Supabase Edge Function
(`supabase/functions/voice-parse/index.ts`) — a small Deno function with no
DB access that calls Gemini 2.5 Flash (`GEMINI_API_KEY`, switched from
Claude Haiku 4.5 at the user's request — same direct single-fetch pattern,
no multi-provider abstraction layer, since a future provider swap is just as
small an edit as this one was) with the exact category/account list
and Colombian amount slang rules ("mil"/"lucas"=×1.000, "palo(s)"=×1.000.000)
and returns `{ mode, amount, categoryName, accountName, purpose, tag }`; the
component maps those names to ids via `normalizeName` (accent/case-insensitive)
and only ever **prefills** the form — same "never guess and save" principle as
the rest of the app, the user still has to review "Más opciones" and tap
"Guardar". `voice-parse` is called from the browser with the user's real
session, so it's deliberately **not** listed in `supabase/config.toml` and
deploys with default JWT verification (see "Edge Functions are multi-user"
above — the category/account list in the prompt is now the caller's own, sent
in the request body, not a fixed one).

**Live transcript while listening**: adapted from a Google Stitch mockup the
user dropped in `other recursos/` (`entrada_de_voz_registro_inteligente.html`)
— the mockup's literal neon/gradient Tailwind visuals were NOT copied (they
clash with this app's flat `--series-N`/`--status-*` token system), only the
UX idea. `startVoiceCapture` now sets `recognition.interimResults = true`
(was `false`) and `onresult` accumulates interim + final chunks into a new
`voiceTranscript` state, shown live in a small card under the segmented
control while `voiceStatus === 'listening'` — real text the browser already
recognized, not a decorative waveform animation. Before any speech is
detected, that card shows a static `VOICE_EXAMPLES` hint list ("Probá
diciendo: 'Gasté 25.000 en Rappi'"), styled as pills — plain text, not
tappable, since there's no way to "simulate" the user having said it.

**The waveform got built after all, but reading the real microphone** —
after the user asked again (with a reference screenshot) to match the
mockup's audio-wave visual, `startAudioVisualizer` opens a *second*
`getUserMedia({ audio: true })` stream (separate from the one
`SpeechRecognition` uses internally — neither API exposes its raw audio to
the other) into a Web Audio `AnalyserNode` (`fftSize = 64`), and a
`requestAnimationFrame` loop reads `getByteFrequencyData` into the
`audioLevels` state driving 24 bar heights (`.voiceWaveBar`, flat
`var(--series-1)`, no canvas/gradient). This is still real amplitude data,
not the mockup's fake canvas sine-wave animation — the "don't fake what the
mic is actually doing" principle held, just extended to cover the waveform
too once real audio access made it possible. Started in `startVoiceCapture`
right alongside `recognition.start()`; stopped (tracks closed,
`AudioContext` closed, `audioLevels` reset to a flat baseline) in
`recognition.onend`/`onerror` and in `close()` — if `getUserMedia` fails or
isn't supported, `startAudioVisualizer`'s catch silently no-ops and the
card still works with flat bars, since the real transcript never depended
on this second stream.

**Entities-recognized pills**: once `voice-parse` returns, `handleVoiceResult`
stores the raw `result` in a new `voiceResult` state (separate from the
`form` it also prefills) and a `.voiceResultCard` renders Monto/Categoría/
Cuenta/Tipo as colored pills — real values from that same response, shown
alongside the already-prefilled form below it, not a gate the user has to
tap through (unlike the receipt-scan flow's "Confirmar y continuar", voice
already prefilled the form directly before this pass and kept doing so;
the pills are a recap, not a new confirmation step). Cleared by `reset()`,
so switching tabs or opening a new voice/photo capture doesn't leave a
stale result showing.

**Listening screen simplified into two explicit stages, on the user's own
follow-up request**: stage 1 (while listening) dropped the bordered/
background card (`.voiceListeningCard` → `.voiceListeningPlain`, no border,
no fill) and the "Escuchando…"/"EN VIVO" header — it's now just the
waveform, the live transcript (or the example hints before anything's been
said), and two pill buttons, "Detener" and "Aceptar". This also changed
*when* processing happens: `recognition.continuous` is now `true` (was
implicitly `false`) so the browser no longer auto-stops and auto-processes
the moment it detects a pause — that used to cut a transcript short if the
user paused mid-sentence. `onresult` now just keeps rebuilding the full
accumulated `voiceTranscript` from every result each time (interim and
final mixed, no more separating them); nothing gets sent to `voice-parse`
until the user explicitly taps a pill. "Aceptar" (`handleVoiceAccept`)
aborts recognition and calls `handleVoiceResult(voiceTranscript)` with
whatever was captured; "Detener" (`handleVoiceStop`) aborts and discards it,
back to idle, no `voice-parse` call at all. Stage 2 (the entities pills +
the actual editable gasto/ingreso/traslado form, category grid included)
still only appears once `voice-parse` has actually returned — categorías,
cuenta and the rest of the form were never part of the listening screen to
begin with, so "solo después de aceptar" fell out of the existing
`voiceStatus` gating almost for free once stage 1 stopped auto-advancing.

**That gating had a gap the user caught**: the two stages above were still
both branches *inside* the same gasto/ingreso/traslado `<form>`, gated only
by `voiceStatus` — so a mic error (or just closing the sheet before the
first result) fell through to the full form underneath instead of staying
on the wave screen. Fixed the same way `receiptMode` already works: a real
`voiceMode` boolean now gates a third top-level branch in the sheet (voice
screen vs. receipt screen vs. the normal form), not a status flag nested
inside the form. `handleMicButtonClick` sets `voiceMode = true`;
`handleVoiceResult` only sets it back to `false` in the success path,
*after* `voice-parse` actually returns data — an error leaves `voiceMode`
untouched, so the screen stays on the wave with the error message and
"Reintentar"/"Aceptar" pills instead of dropping to an empty form. The
sheet header also swaps identity for this branch now ("Escuchando…"/
"Movimiento por voz" + the EN VIVO badge move here from the old
`.voiceListeningCard`, since that card doesn't exist as a separate box
anymore), same pattern as the receipt header swap. `reset()` clears
`voiceMode` (and `recognition.onerror` now also filters `'aborted'`/
`'no-speech'` out of the error message — those fire on every intentional
`.abort()` from "Detener"/"Aceptar" and on plain silence, neither is a real
error worth showing).

**Account balance shown while picking an account**: also from a Stitch
mockup (`movimiento_r_pido_redise_o_modal.html`), which showed each account
as a chip with its balance underneath. Rather than fork `AccountAutocomplete`
into a second, chip-based picker (it's a shared component with `Diario.jsx`,
and CLAUDE.md already documents keeping entry surfaces consistent), the
existing dropdown-list picker gained an optional `balances` prop — each
option now shows the account's month balance (`formatByCurrency`) right-
aligned, sourced from `accountsApi.fetchBalancesForMonth` (fetched once
alongside `listAccounts()` when the FAB sheet opens). `Diario.jsx`'s copy of
the same component still works exactly as before without the prop (balances
is optional) — it wasn't wired there, to keep this change scoped to the
FAB's primary entry flow.

**A manual transaction saved for "today" now gets the real timestamp**
(`occurredAt: form.date === today() ? new Date().toISOString() : ...T12:00:00Z`)
instead of always being hardcoded to `T12:00:00Z` regardless of when it was
actually entered — that placeholder used to apply unconditionally, so every
manually-entered row showed the same fixed clock time (noon UTC = 7am
Bogotá) in any list that renders `occurred_at` as a time, which is
misleading once a UI actually surfaces hour:minute (see `Diario.jsx`'s
"Movimientos de hoy" below). Backdating to a past day still falls back to
the neutral noon marker, since the real time of day for a past date was
never captured. Fixed in both `QuickCaptureFAB.jsx` and
`GastosDiarios.jsx`'s (now-removed) manual form at the same time; only the
FAB's copy survives today since the Gastos manual form no longer exists
(see below).

This FAB also calls `transactionsApi.suggestCategoryForPurpose` on blur of
the description field — see `purpose_category_stats` under "Current state
of the 6 sections" → `GastosDiarios.jsx`.

**The gasto/ingreso sheet layout was also reworked** (transferencia mode is
untouched — different fields, not part of this pass) to match the same
MonIA reference and philosophy as `Diario.jsx`, through a couple of
iterations: **category is now required** to save (`canSubmit` checks
`form.amount && form.categoryId` for gasto/ingreso; account stays optional,
since "pendiente de banco" is still a valid outcome for a manual row) — a
small `styles.hintCaption` line ("Elegí una categoría para poder guardar.")
explains why the disabled "Guardar" won't respond. Descripción and Monto
are the first two fields, styled as fully chrome-free `.bigInput`s (no
border at all, just placeholder-sized text — a thin `border-top` only
appears between two adjacent `.bigInput`s, as a separator, not a per-field
box) instead of Monto-first-then-buried-in-"Más opciones". Tag input is
hidden behind a small "#" toggle button instead of an always-visible field,
and date moved inline next to "Guardar" in a compact bottom row instead of
living in "Más opciones" — "Más opciones" itself now only exists for
transferencia mode (nota + date).

**Both `.bigInput` and `.amountCardInput` need `outline: none`** — a real bug
the user caught: `transferencia` mode's Monto field has `autoFocus` (it's the
first field there, unlike gasto/ingreso where Descripción is first), so the
browser's own default focus ring rendered as a second, misaligned blue box on
top of `.amountCard`'s own custom `:focus-within` glow, immediately visible
the moment the sheet opened. Both classes now suppress the native outline —
`.amountCard`/the chrome-free `.bigInput` treatment already provide their own
focus affordance, so the native one was always redundant, just invisible
everywhere `autoFocus` isn't used.

**Transferencia mode suggests "Monto recibido" for a cross-currency
transfer** (COP hija → `arq`'s USD/EUR pocket, or between arq's own pockets)
from the saved `exchange_rates` — this existed as a manual-only field before
(`crossCurrency` block, present since the multi-currency-accounts work) but
never used the saved rate at all, so every such transfer required typing
both amounts by hand even though a rate was already on file. A `useEffect`
(gated by `form.mode === 'transferencia' && crossCurrency && form.amount &&
!toAmountTouchedByUser`) calls `exchangeRatesApi.convertAmount` and fills
`form.toAmount`; a `toAmountTouchedByUser` flag (reset whenever the user
picks a different "Desde"/"Hacia" chip or via `reset()`) stops re-suggesting
once the user edits that field by hand — a one-off exchange's real rate
(bank spread, cash house) often doesn't match the saved manual rate exactly.
This is the same suggestion mechanism the now-removed
`CurrencyExchangeSection.jsx` used to provide from Cuentas — registering a
currency swap still gets a rate-based suggestion, just from this FAB or
`TransferHistorySection` instead of a dedicated widget.
`QuickCaptureFAB.jsx` now fetches `exchangeRatesApi.getRates()` alongside
accounts/categories when the sheet first opens, since it never needed rates
before this.

**Transferencia mode became pocket-aware, closing the gap noted above**:
`form.fromAccountId`/`form.toAccountId` became `form.fromKey`/`form.toKey`
(pocket keys, same `{accountId}` / `` `${accountId}:${currency}` `` shape as
`currencyPockets.js`), `pockets = flattenAccountPockets(accounts)` replaces
the flat `accounts` list feeding the "Desde"/"Hacia" chips and `toOptions`,
and `fromPocket`/`toPocket` (resolved via a local `pocketOf(key)`) replace
every `currencyOf(form.fromAccountId)`/`currencyOf(form.toAccountId)` call
in `crossCurrency`, `askConsumesBudget`, `canSubmit`, the rate-suggestion
effect above, and `handleSubmit`'s `createTransfers` payload — directly
mirroring the pattern `TransferHistorySection.jsx` already used, so a
traslado from the "+" can now target, say, arq's EUR pocket specifically,
not just its primary currency. `handleVoiceResult` needed no change for
this: for `mode === 'transferencia'` it never assigned
`fromAccountId`/`toAccountId` to begin with (only a singular `accountId`
that mode doesn't read), so a voice-dictated traslado already required
picking both accounts by hand before this pass too — a preexisting gap, not
one this pass introduced or fixed.

**The "Desde"/"Hacia" chips became one-per-account, not one-per-pocket, on
a later follow-up** — the pocket-aware version above rendered a separate
chip per pocket (e.g. "arq" and "arq eur" as two chips), which the user
flagged as clutter once there was more than one multi-currency account: the
chip rows now come from `accounts.map(...)` directly instead of
`flattenAccountPockets(accounts)`, one chip per account regardless of how
many pockets it has. A new `pocketsOfAccount(accountId)` helper (filters
`pockets` by `accountId`) backs a small currency `<select>`
(`.pocketSelect`) that renders next to the "Desde"/"Hacia" label **only**
when the selected account has more than one pocket (`pocketsOfAccount(...)
.length > 1`) — a single-currency account's chip needs no extra picker,
since there's nothing to choose. Selecting an account chip defaults
`fromKey`/`toKey` to that account's first pocket; the currency `<select>`
only appears afterward to let the user switch to a different pocket of the
*same* account. `toAccountPocketOptions` (the "Hacia" dropdown's option
list) still filters out `form.fromKey` so a same-currency self-transfer
stays impossible while a cross-pocket transfer on the same account (arq USD
→ arq EUR) stays reachable, same rule as before this chip regrouping —
only the chip granularity changed, not the underlying pocket-key state
(`form.fromKey`/`form.toKey`) or any of the cross-currency logic described
above.

**`TransferHistorySection.jsx`'s own inline add-transfer form was removed**
once the FAB above covered the exact same ground (including the pocket
picker) — the component now only renders the transfer-history list, the
per-row `consumes_budget` toggle, and delete; `pockets`/`flattenAccountPockets`
were dropped from this file entirely since nothing here needs them anymore.
The "+" FAB's traslado mode is the only surface left for registering a new
transfer (see two paragraphs above).

**The table became a row-list, on the user's own observation that it felt
inconsistent with the rest of the app** — a Plan subagent audited this
session's other design changes (tap-to-edit rows, the 4-tier budget
progress-bar scale, `<details>` for optional sections, placeholder =
calculated value, one-line "where this is used" captions) and confirmed the
6-column `<table className="simple-table">` (Fecha/Origen/Destino/Monto/
Nota+checkbox/Eliminar) was the one surface left forcing horizontal scroll
on mobile even with `.table-scroll`, and that its "Nota + checkbox +
label" cell was the densest, least explained control in the section. Of the
patterns above, only two genuinely applied here (the subagent explicitly
argued against forcing the rest — no tap-to-edit, since a transfer still has
no edit UI beyond this one flag; no progress bar, since this is a binary
flag, not a %; no `<details>` collapse, since this list is read routinely as
part of the monthly closing check, unlike "Ajuste de saldo"): the one-line
"where it's used" caption, and unifying the row shape with `Diario.jsx`/
`GastosDiarios.jsx`'s Movimientos lists. `TransferHistorySection.module.css`
is new (this component previously had zero CSS module, all inline styles) —
each row (`.transferRow`) shows "Origen → Destino" + a compact date on top,
amount + a binary badge (`.transferBadge`/`.transferBadgeActive`, tokens
only, not the 4-tier `budgetToneColor` scale since there's no % here) on the
right, and a circular "×" delete at the end, matching `.txDelete`'s look
elsewhere. The explanatory line above the list ("'Descuenta presupuesto'
cuenta la plata movida como gasto...") only renders once, not per row, and
only when at least one transfer in the list actually has the toggle (both
ends ≠ madre). `handleToggleConsumesBudget`/`doDelete`/`updateConsumesBudget`
are unchanged — only the JSX/CSS around them changed.

**Category picking and account picking both converged on shared components**
(also used the same way by `Diario.jsx`, so behavior stays consistent
across every entry surface):
- `CategoryEmojiGrid.jsx` is rendered directly (no separate flat "suggested
  chips" row, no "+" *expand* toggle — an earlier iteration had both, removed
  once the grid itself became the single source of truth; that removal
  still stands, don't resurrect a filter/expand toggle). A different "+" was
  added back later (see "Creating a category from the '+' sheet redirects to
  Ajustes" below) — a *create* affordance, not a filter one, so it doesn't
  contradict this. Its CSS is a **horizontally-scrollable flex row**, not a wrapping
  grid (`display:flex; overflow-x:auto` in `CategoryEmojiGrid.module.css`,
  changed from the original `grid-template-columns: repeat(auto-fill,...)`)
  — always shows every category, "swipeable panels" per the user's own
  words, so there's never a need to hide categories behind a toggle. The
  tile shape itself changed later from vertical (emoji on top, name below)
  to a horizontal pill (emoji + name side by side) — see "Date moved to the
  top..." under "Quick capture (FAB)" for that change and why.
  `.grid` also sets `scrollbar-width: none` + a hidden `::-webkit-scrollbar`
  — without it, desktop Chrome on Windows draws a visible horizontal
  scrollbar with click arrows under the row, easy to miss with just one such
  row on screen but read as "everything is duplicated" once
  `QuickCaptureFAB.jsx`'s account chip row (below) added a second
  horizontally-scrolling row right above it, each with its own copy of that
  scrollbar. Same fix applied to `.accountChipRow` in
  `QuickCaptureFAB.module.css` and `.categoryBarsRow` in `Diario.module.css`
  (the "Gasto de hoy por categoría" bars) — any future horizontally-scrolling
  decorative row (not a data table — `.table-scroll` keeps its native
  scrollbar on purpose, that one's a real table) should get this too.
  `QuickCaptureFAB.jsx` reorders (never filters/shortens) the full category
  list every keystroke in Descripción, putting categories matched via
  `listRecentPurposes` substring-matching first — same live-reorder idea as
  before, just expressed as a full reorder feeding the one shared grid
  instead of a separate short chip list. Selecting the already-selected
  tile again deselects it (`onSelect` toggles), matching `CategoryEmojiGrid`'s
  existing toggle behavior in `Diario.jsx`.
- `src/components/AccountAutocomplete.jsx` (new) replaces the account chip
  row in both `QuickCaptureFAB.jsx` and `Diario.jsx`: a single text input
  ("Cuenta") that shows a dropdown of matching accounts as you type
  (substring match, case-insensitive), same interaction shape as typing a
  description and getting suggestions. Tapping an option sets the real
  `accountId` and displays that account's name; typing again after a
  selection clears `accountId` until a new option is picked (`onChange('')`
  in `handleChange` — never lets a stale id linger against changed text).
  Each dropdown option has `onMouseDown={(e) => e.preventDefault()}` so the
  input doesn't blur (and the dropdown doesn't close) before the click
  registers — a standard pattern for custom autocomplete/combobox UIs.
  Chip rows for "Desde"/"Hacia" in `QuickCaptureFAB.jsx`'s transferencia
  mode are untouched (out of scope, same as the rest of that mode).

**Creating a category from the "+" sheet redirects to Ajustes, it doesn't
inline a mini-form**: `CategoryEmojiGrid.jsx` takes an optional
`onCreateClick` prop — when passed, a circular "+" tile (`.addTile`) renders
first in the row, before any category. Only `QuickCaptureFAB.jsx` passes it;
`Diario.jsx`'s copy of the same component doesn't, so it renders exactly as
before. **A first version of this opened an inline emoji+name form right in
the sheet** (same idea as the inline category form in `SettingsPanel.jsx`,
just embedded) — the user asked to undo that: the category row shouldn't
grow more elements, and the full Ajustes form (name/emoji/color/`is_ambiguous`)
is more complete anyway. `handleCreateCategoryClick` instead: (1) sets local
`pendingResumeAfterSettings = true`, (2) hides this sheet with a bare
`setOpen(false)` — **not** `close()`/`reset()`, so `form` (amount, purpose,
account, everything typed so far) stays alive in memory — and (3) dispatches
`dashboard:open-settings` with `{ section: 'categorias' }`, the same event
`Deudas.jsx`'s "Precargar" flow already used to jump Ajustes straight to a
section. `SettingsPanel.jsx`'s `close()` now always dispatches a new
`dashboard:settings-closed` event (harmless no-op for any other listener,
today there isn't one); `QuickCaptureFAB.jsx` listens for it, and when
`pendingResumeAfterSettings` is true it re-fetches `listCategories()` (so
the just-created category is there — the sheet's own categories fetch only
ever runs once per mount, gated by `accounts.length` as a "already loaded"
flag, so nothing else would pick up the change) and calls `setOpen(true)`
to bring the paused sheet back with the same half-filled movement intact.
This only fires when *this* flow set `pendingResumeAfterSettings` — closing
Ajustes any other way (its own "×", the user just browsing it unrelated to
this) is harmless since nothing is listening in that case; `close()` also
resets the flag as a safety net. Both `close()` in `SettingsPanel.jsx` and
`handleCreateCategoryClick`/the listener in `QuickCaptureFAB.jsx` are the
whole mechanism — no new prop, no new global store.

**`categories.emoji` is now required when creating a new category** (not
retroactively enforced on existing categories, or on rename/edit of one
already missing an emoji) — `SettingsPanel.jsx`'s "+ Nueva categoría" form
disables "Crear" until both name and emoji are filled
(`!newCategory.name.trim() || !newCategory.emoji.trim()`), and `handleCreate`
double-checks the same condition before calling `categoriesApi.createCategory`.
Rationale: every category created from now on should render with a real icon
in `CategoryEmojiGrid.jsx`'s horizontally scrollable strip, not the
letter-hash fallback — existing categories created before this rule keep
using that fallback until someone manually edits them to add one.

**Categorías: budget can now be set at creation, is visible without
opening a row, and tapping a row edits it — no more separate "Editar"
button.** This followed directly from adding "Presupuesto por categoría" to
`GastosDiarios.jsx` (see that page's entry below): once a category's
`monthly_budget` actually did something visible and useful, the gaps in how
it was entered became worth fixing. `categoriesApi.createCategory` gained an
`initialBalance`-style optional `monthlyBudget` param (same
insert-time-only pattern as an account's initial balance), and the "+ Nueva
categoría" form in `SettingsPanel.jsx` grew the same "Presupuesto mensual
(opcional)" number input the edit form already had — previously the only
way to set a budget was create the category first, then separately tap
"Editar" to add one. Both the create and edit forms also gained a one-line
caption under that input naming where the number is actually used ("Se
compara contra el gasto real del mes en 'Presupuesto por categoría' (Gastos)
y en los chips de Diario, y avisa en Panel si te pasás") — the feature
existed before but was invisible/undiscoverable at the point of entry. The
collapsed row now shows the configured budget inline (`formatByCurrency(c.monthly_budget,
'COP')` + "/mes", next to the name, only when one is set) instead of hiding
it until "Editar" is tapped. The standalone "Editar" button was removed
entirely — tapping anywhere on a non-editing row now calls `startEdit(c.id)`
directly (`.rowClickable` in `SettingsPanel.module.css`, just a `cursor:
pointer`), same "select it and it's already editable" pattern the
Movimientos lists in `Diario.jsx`/`GastosDiarios.jsx` use; "Archivar" stays
a separate button and calls `e.stopPropagation()` so tapping it doesn't also
open edit mode.

**Editing (and creating) a category got a deeper visual overhaul, from a
Stitch mockup the user dropped in `other recursos/`** (`editar_categor_a_ocio.html`
+ `editar categoria.jpg` for the edit card; `idea de categorias.jpg` for the
collapsed row) — same "structure/UX only, not the literal look" rule as
every other Stitch reference in this app: the mockup's pure-black background,
purple gradients and Tailwind utility colors were **not** copied, only the
layout ideas, rebuilt with this app's own tokens (light/dark aware).

- **Collapsed row is bigger**, on the user's explicit request after sharing
  the reference: `.categoryGlyph` (44×44px, `border-radius: 13px` —
  a rounded-square "squircle" instead of the old 28px circle) + a two-line
  text stack (`.categoryRowText` → `.categoryRowName` bold on top,
  `.categoryRowSubtitle` showing "$X/mes" below, only when a budget is set).
  These are category-only classes, not a resize of the shared `.rowGlyph`/
  `.rowName` — the mockup's row also showed a live "$ gastado hoy" figure,
  which was deliberately **not** copied: this drawer has no month/page
  context to compute that (see "it deliberately does not show a 'gastado
  este mes' figure" below, an existing constraint that still holds).
- **The edit form (and, for consistency, the create form) became a real
  card** (`.categoryEditCard` — a category-only modifier of the shared
  `.editForm`, so debts/goals/accounts editing elsewhere in this drawer are
  untouched) with a bigger live avatar preview (`.categoryEditAvatar`,
  56×56px rounded square reflecting `emoji`/`color` as they're picked) next
  to the name field, uppercase section labels (`.categoryLabel`, e.g.
  "NOMBRE DE LA CATEGORÍA", "PRESUPUESTO MENSUAL (OPCIONAL)") above each
  field group (`.categoryFieldGroup`) instead of bare placeholders, quick
  budget-preset buttons (`.categoryBudgetPresets`, +$50.000/+$100.000/
  +$200.000, additive — tapping twice stacks — plus a "Limpiar" that resets
  to blank) next to the manual amount input, and the explanatory caption
  restyled as a tinted `.categoryInfoCard` box (`color-mix` with
  `--series-1`, tokens only) instead of a plain muted paragraph.
- **"Ambigua" became an iOS-style switch** (`.switchTrack`/`.switchTrackBg`/
  `.switchThumb` wrapping a real (visually hidden but still functional)
  checkbox `<input>` — no new dependency, pure CSS with a `:checked ~`
  sibling selector) instead of a bare native checkbox, with a real
  description line explaining what it actually does (`.categoryHelperText`:
  "Dejala marcada si puede pagarse desde distintas cuentas. Desmarcala solo
  si sabés que siempre sale de la misma [...]" — this field previously had
  **zero explanation** anywhere in the UI, unlike the mockup's own
  description text which was fictional and got rewritten to match this
  app's actual `is_ambiguous`/bank-assignment-engine semantics, see
  `.claude/rules/motor-asignacion.md`).

**Global settings drawer (`SettingsPanel.jsx`)**: category management (the
old "Categorías" card described above, previously on `GastosDiarios.jsx`)
was pulled out into its own always-mounted component, rendered once in
`AppShell.jsx` alongside `QuickCaptureFAB` so it's available on every page —
same "no per-page duplication" reasoning as the FAB. It renders a small
fixed circular trigger (`aria-label="Ajustes"`, `IconSettings`) — pinned
top-left (`env(safe-area-inset-top)`-aware, `z-index: 50`) on mobile
(`< 768px`, tab-bar layout), and **top-right** on tablet/desktop
(`≥ 768px`, sidebar layout), because top-left there sits right against the
sidebar's `.brand` logo. Tapping it opens the same backdrop+sheet pattern
`QuickCaptureFAB` already uses, but **as a two-level menu, not a single
flat form**: the sheet's root view is a list of section rows
(`SETTINGS_SECTIONS`, iOS-Settings-style — glyph + label + subtitle +
chevron), and tapping one drills into that section's content with a "‹
Ajustes" back button in the header replacing the title. This exists so the
panel can grow — the user was explicit that categories won't be the only
thing living here — without the root screen turning into an ever-longer
single form; adding a new setting later means adding one entry to
`SETTINGS_SECTIONS` plus its own content block, not restructuring the
existing ones. The first section is `'categorias'`: the full
category CRUD (create with emoji/color/`is_ambiguous`, inline edit of
name/emoji/color/`is_ambiguous`/`monthly_budget`, archive via
`ConfirmDialog`) and the relocated "Aprender categoría/tag de tu historial"
backfill button. It deliberately does **not** show a "gastado este mes" figure
per category (unlike the old card) — a global settings panel has no month/
page context to compute that against, and re-fetching it just for this
panel wasn't worth the complexity. Every page that reads categories
(`GastosDiarios.jsx`, `Diario.jsx`, `QuickCaptureFAB.jsx`) still calls
`listCategories()` on its own mount/open, same no-global-store pattern as
everywhere else — an edit made here shows up next time that page/sheet
loads, not live while both are open simultaneously. Don't add a new section
to this menu unless the user asks for one.

**Second section, `'cuentas'`**: creating a new hija account (including a
multi-currency one) moved here from the "Agregar cuenta hija" card that used
to live inline in `Cuentas.jsx` — the user asked for account creation to be
a Settings section, same relocation reasoning as categories. `Cuentas.jsx`
keeps everything else (the account cards, balances, edit/archive, the
monthly ritual, transfers) — only *creating a new one* moved. `Cuentas.jsx`,
`Deudas.jsx` and `MetasAhorro.jsx` briefly showed a one-line pointer card
("Para agregar uno nuevo, andá a Ajustes → X") where the old inline form used
to be — the user asked to remove those too, since once the move is known
they read as clutter rather than help, so those pages now simply have no
card there at all instead of a placeholder pointing elsewhere.
Multi-currency's "which currencies and how much of each" step is a
dropdown-based add-one-at-a-time builder (a `<select>` "+ moneda…" + an
optional amount + "Agregar", listing already-added pockets with "Quitar"),
not a row of always-visible checkboxes — the checkbox-per-currency version
this replaced didn't fit well on a narrow phone screen. `Cuentas.jsx`'s own
"¿Es otra moneda de...?" edit-time picker already used this same dropdown
pattern, so this made the create and edit flows consistent instead of two
different UI idioms for the same concept. Submitting calls
`accountsApi.createAccount` directly (no need to `listAccounts()` again
afterward to find the new row, unlike the old inline form — `createAccount`
already returns the inserted row).

**This section can also create the madre**, added once an onboarding audit
found there was no UI path for it at all (the only way to seed the first
`kind='madre'` row used to be a manual `insert` in the Supabase SQL Editor,
which `Cuentas.jsx` used to point the user to directly — that message now
points here instead). A checkbox "Es la cuenta madre" only renders while
`!accounts.some(a => a.kind === 'madre')` (there's only ever one, so it
hides itself once one exists) — checking it hides the currency `<select>`
and multi-moneda builder entirely (the madre is always a single COP account,
per the monthly madre→hijas ritual) and `handleCreateAccount` calls
`createAccount({ kind: 'madre', parentAccountId: null, currency: 'COP' })`
instead of the `kind: 'hija'` branch.

`ColorSwatchPicker` (previously a component defined locally inside
`GastosDiarios.jsx`) moved to `src/components/ui/ColorSwatchPicker.jsx` as a
shared component (used by both `SettingsPanel.jsx` and, historically, the
old card) and its palette was expanded from the original 8 `--series-N`
swatches to 16: the same 8 tokens plus a lighter tint of each
(`color-mix(in srgb, var(--series-N) 55%, white)`), still deriving every
swatch mechanically from the already-validated palette rather than
inventing new hex values, per `diseno-ui.md`'s categorical-color rule.

**Third and fourth sections, `'deudas'` and `'metas'`**: creating a new debt
(either direction — `'debo'`/`'me_deben'`, via a `.segmentRow` two-button
toggle instead of a `<select>`, more legible for a binary choice on a phone)
moved here from `Deudas.jsx`'s "Agregar deuda"/"Registrar préstamo" card, and
creating a new savings goal moved here from `MetasAhorro.jsx`'s "Agregar meta
de ahorro" card — same relocation reasoning as `'cuentas'`, and the same
optimization: the old cards laid out every field in a `flex-wrap` row with
fixed pixel widths (`formInput`/`width: 130` etc.), which was the original,
un-refactored style from before the Settings panel existed and didn't wrap
well on a narrow phone; the Settings versions use the panel's own stacked
`.createForm`/`.textInput`/`.editFormRow` classes instead, same idiom as
`'cuentas'`. Both pages keep everything else — editing, cuotas/abonos,
contribuciones, archive — only *creating a new one* moved, and each shows a
one-line pointer to its Ajustes section instead of the old form.

`Deudas.jsx`'s "Préstamos detectados sin registrar" queue still lives on
that page (it's a review queue tied to imported transactions, not just "add
a debt"), but its "Precargar" button no longer fills a local form — since
that form doesn't live on this page anymore, it now dispatches a
`dashboard:open-settings` window `CustomEvent` (`detail: { section: 'deudas',
prefill: {...} }`) that `SettingsPanel.jsx` listens for: it opens itself,
jumps straight to the Deudas section, and seeds `newDebt` with the real
transaction's name/amount/date/currency plus `sourceTransactionId` (so
`handleCreateDebt` still calls `markLoanTransactionReviewed` on save, same as
before the move). This is the same "siblings under `AppShell` talk through a
window event, not a prop" pattern `onOpenSearch`/`dashboard:transactions-changed`
already established — `SettingsPanel.jsx` is mounted once in `AppShell.jsx`,
not a child of `Deudas.jsx`, so there's no `reload()`/`setForm()` to pass
down directly. The same problem exists in reverse too: `Deudas.jsx` and
`MetasAhorro.jsx` stay mounted underneath the Settings sheet while a debt or
goal is created there, so on success `SettingsPanel.jsx` dispatches
`dashboard:debts-changed` / `dashboard:goals-changed` (plain `Event`s, no
payload needed) and each page subscribes in a `useEffect` calling its own
`reload()` — same shape as `Diario.jsx`'s existing
`dashboard:transactions-changed` listener.

**A `'gastos-fijos'` section** (between `'metas'` and `'tasas'` in
`SETTINGS_SECTIONS`) covers just the alta — the same relocation as
`'cuentas'`/`'deudas'`/`'metas'`, moved out of the create form that used to
live inline at the bottom of `FixedExpensesSection.jsx` (`Cuentas.jsx`).
`handleCreateFixedExpense` calls `fixedExpensesApi.createFixedExpense`
directly (deriving `currency` from whichever account is picked, same
pattern as everywhere else that creates a transaction/expense tied to an
account) and dispatches `dashboard:fixed-expenses-changed` on success, which
`FixedExpensesSection.jsx` listens for to `reload()` — same shape as
`dashboard:debts-changed`/`dashboard:goals-changed`. `Cuentas.jsx` keeps
everything else about fixed expenses (the grouped Pendientes/Pagados list,
tap-to-edit rows, toggle paid, archive) — only *creating* one moved.

**Fifth section, `'tasas'`**: a centralized "Tasas de cambio" editor for the
3 fixed pairs (`RATE_PAIRS` — `CURRENCIES` only has COP/USD/EUR, so this
list is hardcoded rather than derived from active accounts). This started as
a duplicate of `Cuentas.jsx`'s own inline `renderRateRow` per account card —
added "también" (as well) at first, not to replace it — but once both
existed the user asked to declutter Cuentas.jsx, so `renderRateRow` and the
standalone `CurrencyExchangeSection.jsx` widget were both removed from
`Cuentas.jsx` (see "Multi-currency" above and "Known gaps" for
`CurrencyExchangeSection`'s removal). **This Settings section is now the
only place that writes `exchange_rates`.** `Cuentas.jsx` still listens for
`dashboard:rates-changed` (dispatched here on save) and calls its own
`reload()`, same shape as the `debts-changed`/`goals-changed` pair above —
kept so the "faltan tasas configuradas" warning banner and each account's
computed balances refresh live when a rate is saved from Settings, even
though the page itself no longer edits rates.

**"Buscar" fetches today's rate from a real FX-rate API, not from an AI
model** — the user's first ask was for "an AI system" to look up the day's
USD rate, but a live exchange rate is exactly the kind of fact a language
model shouldn't be trusted to answer from training data (no real-time
access, easy to hallucinate a plausible-looking but wrong number) — the
same "never invent a conversion" principle `toCOP`/`convertAmount` already
follow elsewhere in this app. `exchangeRatesApi.fetchLiveRate(base, quote)`
instead calls `https://open.er-api.com/v6/latest/{quote}` directly from the
browser (free, no API key, `Access-Control-Allow-Origin: *` so no CORS
issue and no Edge Function/deploy step needed) and reads `rates[base]` —
matching this app's "1 quote = rate base" convention exactly (see
"Multi-currency" above), so fetching with `(base, quote)` swapped the same
way `setRate` expects avoids
the inversion mistake documented under "Multi-currency" above. Same
prefill-only discipline as voice/receipt parsing: the fetched value only
fills the manual rate input (`rateInputs`), the user still has to review and
tap "Guardar" — nothing is written to `exchange_rates` directly from the
fetch.

**A `'presupuestos'` section (in `SETTINGS_SECTIONS`, right after
`'categorias'`) makes the category-budget alert configurable, from a Stitch
mockup the user dropped in `other recursos/`** (a "Presupuestos" screen with
an "Alertas de presupuesto" toggle, an "Umbral de alerta" slider at 80%, and
a list of categories with "Sin presupuesto establecido" / their budget +
chevron) — same "structure/UX only" rule as always. Unlike most of the
Ajustes visual reworks, **this one is functional and needed a schema
change**: a new `user_settings` table (`schema.sql`, one row per user —
`user_id` is its own primary key — with `budget_alerts_enabled boolean
default true` and `budget_alert_threshold_pct integer default 100`, RLS
added to the same generic `do $$ ... $$` policy loop as every other table),
read/written through the new `src/lib/userSettingsApi.js`
(`getUserSettings` returns the defaults when no row exists yet, so a user who
never opens this section sees exactly the old behavior; `saveUserSettings`
upserts on `user_id`, relying on the column's `default auth.uid()` like every
other `*Api.js` insert here). `panelApi.fetchAlerts` now reads those settings
(one more entry in its existing `Promise.all`) instead of the hardcoded
`spent <= budget` check: the `presupuesto_categoria` alert fires once
`spent >= budget × threshold/100`, is skipped entirely when
`budgetAlertsEnabled` is false (`anomalia_categoria` is a different
mechanism and is unaffected), and now has two levels — `'warning'` between
the threshold and 100%, `'critical'` at/over 100% (it used to be always
`'critical'`, which would read as alarmist at 80%). `PanelGeneral.jsx`'s
`alertText` branches on `a.amount >= a.budget` to say "superó su presupuesto"
vs. "ya lleva X de Y (N% del presupuesto)". In the section itself
(`SettingsPanel.jsx`), the toggle persists immediately, but the `<input
type="range">` (min 50, max 100, step 5, colored with `accent-color:
var(--series-1)` — no custom slider CSS) only updates local state while
dragging and persists on `onMouseUp`/`onTouchEnd`, so dragging doesn't write
once per tick. Below that, a list of every category (reusing the `categories`
state `SettingsPanel` already loads on open — no new fetch) shows its
`monthly_budget` or "Sin presupuesto establecido"; tapping a row calls
`setSection('categorias'); startEdit(c.id)` to jump straight into that
category's edit card rather than duplicating a second edit form here.
`IconBudget` (a bell) is new in `icons.jsx`. **Live-DB step required**: the
`user_settings` table has to be created once in the Supabase SQL Editor (see
`esquema-datos.md`) — until then `getUserSettings()` errors on the missing
table, which `fetchAlerts` propagates.

**A `'tags'` section (in `SETTINGS_SECTIONS`, between `'categorias'` and
`'cuentas'`) manages the new `tags` catalog table** — added because the user
asked for a tags-creation surface in Settings, reusing the same reserved-word
knowledge the bank-assignment engine already had. Until this, `transactions.tags`
was purely free text with no catalog at all (`SearchPanel.jsx`'s tag chips came
from `listTopTags()`, a frequency count over real transactions, not a real
list of "known" tags). `tags` (schema.sql, `id`/`user_id`/`name`/`created_at`,
`unique (user_id, name)`) is **not** a normative table — `transactions.tags`
stays a free `text[]` (see `.claude/rules/motor-asignacion.md`), this is only
a catalog for autocomplete/management, with no FK from `transactions`.
`src/lib/tagsApi.js` (`listTags`, `createTag`, `deleteTag`, `ensureTags`) is
new; `ensureTags(names)` — a batched `upsert(..., { onConflict: 'user_id,name',
ignoreDuplicates: true })` — is the important one: **the catalog grows on its
own from real usage**, not only from manual entry in Settings. It's called
(best-effort, wrapped in try/catch so a tag-catalog hiccup never blocks the
real save) from `transactionsApi.js`'s `createManualTransaction`,
`updateTransactionTags`, `updateTransaction`, and `importTransactions` (the
MonIA CSV path — one batched call per import, not per row, and filtered
through `isReservedTag` first so account-name tags and `IGNORED_TAGS` never
pollute the catalog as if they were real spend-tags). The Settings section
itself (list of tags + delete via `ConfirmDialog`, matching the
"every create needs a delete" rule + a small create form) is mostly a
shortcut to pre-register a tag before using it, or to clean one out of the
catalog — `handleCreateTag` blocks a reserved name up front with the same
`isReservedTag` check, showing why in the inline error instead of a generic
failure. Deleting a tag here only removes it from the catalog — it does
**not** touch `tags` already saved on past transactions (nothing to cascade,
since there's no FK) and, per `ensureTags`, comes right back the next time
it's actually used on a movement — that's by design, not a bug: the delete
button is for tidying the suggestion list, not for un-tagging history. Needs
`IconHash` (new in `icons.jsx`) rather than reusing `IconTag` — "Categorías"
already has that glyph, and two adjacent menu rows with the same icon would
read as a mistake.

**The tag list became a wrapping cloud of pills, from a Stitch mockup the
user dropped in `other recursos/`** (a full-screen "Etiquetas" list) — same
"structure only" rule as always (the mockup's pure-dark background wasn't
copied). `.tagCloud` (`display: flex; flex-wrap: wrap`) replaces the old
one-row-per-tag `.list`/`.row` layout; each `.tagPill` is `#name` with no
visible delete affordance — tapping the pill itself opens the same
`ConfirmDialog` `handleCreateTag`'s sibling delete flow already used, rather
than a separate "Eliminar" link per row. The create input's placeholder
became `"#Nueva etiqueta"` (was `"Nombre (ej. mercado)"`), matching the
mockup's own input copy.

**The remaining Ajustes sections (`'cuentas'`, `'deudas'`, `'metas'`,
`'gastos-fijos'`, `'tasas'`) were redesigned to match Categorías/Presupuestos/
Tags, and every old "Editar" button in the app was replaced by tap-to-edit
with its own layout.** The shared vocabulary lives in
`src/components/ui/FormKit.jsx` (+ `FormKit.module.css`): `Field` (uppercase
label above the control, optional right-side hint), `FieldRow`, `InfoCard`
(tinted caption box, `tone="warning"` variant), `SwitchRow` (iOS switch +
helper text), `ChipPicker` (selectable pills, `allowClear` for optional
fields), `Segmented` (iOS segmented control), `EditCard`/`EditHeader`/
`EditActions` (bordered card, live square avatar + "EDITANDO X" caption +
type badge, Guardar/Cancelar + optional destructive `onDelete`),
`MeterPreview` (live progress bar) and `EditSheet` (modal: full screen on
mobile, centered card ≥768px, closes on Escape/backdrop). `SettingsPanel.jsx`
imports `Field`/`InfoCard`/`SwitchRow`/`ChipPicker`/`Segmented` from there
for its create forms; its Categorías/Presupuestos/Tags code still uses its
own `category*` classes (duplicated CSS, deliberately not merged). In
Ajustes: Cuentas/Deudas/Metas/Gastos fijos are one `editForm categoryEditCard`
card each with a live avatar, currency as `ChipPicker` pills, optional fields
behind a `<details>` (Deudas), an `InfoCard` explaining where the data is
used, and a green `.successCard` after creating; Tasas is now a list of
tappable rows (one per pair, `1 USD = $ 4.000` / "Sin configurar") that expand
into an edit card (`editingRatePair`) with "Buscar tasa de hoy" — all inputs
that take decimals now carry `step="any"` (the rate input had none, so the
browser's native validation rejected any non-integer rate like 1.16 or a
fetched 4123.45).

The four pages that used a text "Editar" button each got a **different**
edit design, on the user's request that every one be distinct rather than
one generic form: **`Cuentas.jsx`** — the card header (`.cardHeader`, avatar +
name + currency line) is the tap target and the card itself becomes
`span-3` and turns into the edit form (moneda principal chips, multi-moneda
switch, extra pockets list with MonIA tag + an `InfoCard` about `arq_eur`,
warning when the primary currency changes because balances only sum rows in
the account's own currency). **`FixedExpensesSection.jsx`** — the 7-column
table became a list grouped into "Pendientes este mes" / "Pagados este mes"
(sorted by due day) with a "day tile" (`.dayTile`, the due day as the hero,
tinted warning/good) instead of a generic avatar, a status pill that toggles
paid without opening edit (`stopPropagation`), and an inline `EditCard` under
the tapped row. **`Deudas.jsx`** — tapping the card header opens an
`EditSheet` (modal, like Gastos' "Editar movimiento") with a live
`MeterPreview` of % pagado/recuperado, the currency shown as a locked dashed
pill, and an `InfoCard` that says a changed total/remaining regenerates the
pending installments. **`MetasAhorro.jsx`** — the card becomes an inline form
with a live projection: `MeterPreview` of progress against the typed target
and an `InfoCard` computing "necesitás aportar ~X/mes" from the typed target
and date (same `monthsUntil` math as the "Aporte sugerido" line). In all four,
"Eliminar" stays reachable both as a link on the collapsed header
(`stopPropagation`) and as the destructive action inside the edit UI,
still behind `ConfirmDialog`. Not verified against real data:
`FixedExpensesSection`'s row list (the account used to test had no fixed
expenses, only its empty state was seen).

**Global search popup (`SearchPanel.jsx`)**: mounted once in `AppShell.jsx`
next to `SettingsPanel`/`QuickCaptureFAB`, controlled from there via a
`searchOpen` boolean (`open`/`onClose` props) — this is the single
implementation of "search movimientos" now, triggered by the lupa button in
`QuickCaptureFAB`'s cluster (see "Quick capture" above for why that changed
from a `navigate('/gastos')` redirect). It's a self-contained backdrop+sheet
overlay, same visual idiom as `SettingsPanel`/`QuickCaptureFAB`'s sheet, but
wider (`max-width: 640px` vs. 420-480px) since it holds a filter form plus a
results list. On open it fetches its own `accounts`/`categories` via
`listAccounts()`/`listCategories()` (no global store, same pattern as every
other component here) and calls `transactionsApi.searchTransactions` with
the same filter shape (`query`, `categoryId`, `accountId`, `tag`,
`dateFrom`, `dateTo`) the old inline card used, capped at 200 results.
Editing a result's tags (`updateTransactionTags`) and deleting one
(`deleteTransaction` behind its own `ConfirmDialog`) both work the same as
before; deleting here does **not** trigger `dashboard:transactions-changed`
(see `Diario.jsx` below) since this panel isn't part of the FAB's
gasto/ingreso/transferencia save path — a page open behind it won't
auto-refresh from a search-panel deletion today, a known gap if that ever
matters. `GastosDiarios.jsx`'s own "Buscar movimientos" card and all of its
dedicated state (`searchFilters`, `searchResults`, `searching`, the
`?focus=buscar` query-param-driven scroll-and-focus effect that briefly
existed to jump to it from the lupa) were deleted once this panel existed —
there's no more search UI on that page at all.

**Redesigned to search live instead of on submit**: the original version
had 6 always-visible fields (query, categoría, cuenta, tag, 2 dates) plus a
"Buscar" button — the user flagged it as too cluttered for something meant
to be fast. Now there's one chrome-free query input (`.bigInput`, same
visual idiom as `QuickCaptureFAB`'s Descripción/Monto fields) that searches
as you type via a 350ms-debounced effect watching `filters`, no submit
button; categoría/cuenta/tag/fechas moved behind a "Filtros" toggle button
(badge shows the count of active secondary filters) that's collapsed by
default — same "don't show what isn't being used" reasoning as
`QuickCaptureFAB`'s tag `#` toggle. No filter at all means no query runs
(`hasAnyFilter` check), so opening the panel doesn't dump the 200 most
recent transactions before the user has typed anything.

**The panel is a full-screen page on mobile now too**, same conversion and
same reasoning as the "+" sheet (see "Quick capture (FAB)" above) —
`.backdrop`/`.panel` in `SearchPanel.module.css` follow the identical
pattern (base rules fill `100dvh` with no rounded corners below 768px, the
existing `min-width: 768px` override keeps the centered floating card on
desktop/tablet unchanged), and the drag-handle affordance was removed for
the same reason (no bottom-sheet edge left to suggest dragging).

**The single query box now searches by descripción, categoría, and tag at
once, not just free text against `purpose`** — the user asked for "esa
línea" (the one search box) to cover all three instead of requiring the
"Filtros" drawer for categoría/tag. `SearchPanel.jsx` resolves which
categories match the typed text client-side (`categories` is already in
memory; accent/case-insensitive substring match via a local `normalize()`
helper, same idea as `normalizeName` in `QuickCaptureFAB.jsx`) and passes
those ids as `matchCategoryIds` to `transactionsApi.searchTransactions`.
That function runs up to 3 variants of the same filtered base query in
parallel — `purpose` ilike, `tags` contains (exact, lowercase — same
operator the dedicated tag filter already used), and `category_id in
matchCategoryIds` — and de-duplicates the merged rows by `id`, because
PostgREST can't express an OR across a column on the queried table
(`purpose`), a related table's column (`categories.name`), and an array
column (`tags`) in a single request. The explicit "Filtros" fields
(categoría `<select>`, cuenta, tag, fechas) are unchanged and still combine
with the query box as regular `AND` conditions, same as before.

**Voice search**: a mic button inside the query field (visible only when
`SpeechRecognitionCtor` exists, same browser-support check as
`QuickCaptureFAB`) starts a `SpeechRecognition` with `interimResults = true`
and writes straight into `filters.query` — no `voice-parse` call, since free
text needs no field extraction, just dictation. Adapted from the same Stitch
mockup batch as the FAB's voice card
(`buscar_movimientos_redise_o_modal.html` had a mic icon inside its search
input); the mockup's own filter layout (all fields always visible) was
**not** adopted since it's the exact design this section replaced above.

**Filter rows visually adapted from the same mockup, kept collapsed behind
"Filtros"**: categoría and cuenta are still real `<select>`s (nothing about
how filtering works changed), but each is now wrapped in a
`.filterPickerRow` — a colored icon badge (`IconTag`/`IconAccounts`, tokens
not hex) + the select (transparent, native arrow hidden via
`appearance: none`) + a decorative chevron — so it reads as a tappable
picker row instead of a bare dropdown, matching the mockup's look without
reintroducing its always-visible layout. The tag field also gained
tappable suggestion chips below it — but sourced from
`transactionsApi.listTopTags()` (most-frequent real tags across the last
500 transactions, excluding `IGNORED_TAGS` and any tag that's actually an
account name, filtered client-side against `accounts` the same way
`GastosDiarios.jsx`'s `accountNameTags` does), never the mockup's hardcoded
`#rappi`/`#supermercado`/`#servicios`/`#salud` — this app doesn't put
placeholder data in front of the user, only real numbers/tags, even for a
"suggestion" UI element.

**Every create/log action needs a matching delete**: transactions, savings
contributions, transfers, accounts, debts (+ installments), fixed
expenses, savings goals, and tags (catalog-only — deleting one from Ajustes
→ Tags doesn't touch `tags` already saved on past transactions, since
there's no FK, see "A `'tags'` section..." below) can all be deleted or
archived from the UI — this is a standing expectation, not something to
add only when the user notices a gap. A resource that's a single current-state value fully
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

**Current state of the 6 sections** (`src/pages/`) — all fully wired to
Supabase, no sample data left anywhere:
- **`Diario.jsx`** (route `/diario`, nav between Panel and Cuentas): a
  dedicated, mobile-first daily-entry page — the start of "Fase 3" from
  `prompt-dashboard-financiero.md` (native entry to eventually replace
  MonIA), explicitly run in **hybrid mode** alongside the MonIA CSV import
  for now, not a replacement yet. Gasto/ingreso only (no transferencia — that
  stays in Cuentas.jsx/QuickCaptureFAB). **This page has no entry form of
  its own any more** — the collapsible "Agregar movimiento" card (and its
  "Foto de recibo" AI button) was removed outright once the floating
  "+"/mic buttons existed on every page: the user's reasoning was that the
  "+" already makes it obvious where to add a movement, so a second,
  collapsed entry point on this specific page was redundant chrome, not a
  convenience. **This orphaned the receipt-photo feature** on this page, but
  it later got the "new home" this section used to speculate about, through
  a couple of iterations: first a text-link inside `QuickCaptureFAB.jsx`'s
  gasto/ingreso sheet, then an always-visible camera button in `fabCluster`
  (next to "+" and the lupa) that jumped straight to the native file picker,
  and finally its own **dedicated screen** — a Google Stitch mockup the user
  dropped in `other recursos/escanear_recibo_registro_inteligente 2.html`
  was the reference for this last shape, adapted to the app's own tokens
  rather than the mockup's literal neon/gradient Tailwind. Tapping the
  camera button (`handleCameraButtonClick`) opens the same bottom sheet but
  with `receiptMode = true`, which swaps out the whole
  gasto/ingreso/traslado segmented form for a standalone view: an icon
  badge + "IA" pill in the header (replacing the usual title-dot), a preview
  card (empty hint state, or the actual chosen photo via
  `URL.createObjectURL` — a real image, not a placeholder), two source
  buttons ("Tomar foto" with `capture="environment"` / "Subir recibo"
  without it, two separate hidden `<input type="file">`s), and once
  `receipt-parse` returns, a result card (monto + categoría detectada) with
  a "Reintentar"/"Confirmar y continuar" footer. The mockup itself showed a
  live camera viewfinder with a scanning-laser animation and OCR bounding
  boxes over a fake receipt graphic — deliberately not built: this app has
  no live camera feed (no `getUserMedia` video element, just a file input),
  so animating a fake scan over a static mockup image would misrepresent
  what's actually happening, the same reasoning that kept voice capture from
  getting a fake waveform. "Confirmar y continuar" does **not** save
  directly like the mockup's "Confirmar y registrar" suggests — same
  prefill-only principle as `voice-parse` everywhere else in this app: it
  fills the normal gasto form (mode forced to `'gasto'`,
  amount/categoría/descripción) and drops `receiptMode` back to `false`, so
  the user still reviews and taps the real "Guardar". `reset()` (called on
  every tab switch and on `close()`) also exits `receiptMode` and revokes
  the preview's object URL, so switching to Ingreso/Traslado — or opening
  voice via the mic button, which calls `reset('gasto')` too — cleanly
  leaves the receipt screen instead of leaving it stuck open underneath.
  **The Edge Function is now deployed and configured** (`receipt-parse`,
  calling Gemini 2.5 Flash via the same `GEMINI_API_KEY` secret as
  `voice-parse` — see "Known deferred scope" below) — picking a photo goes
  through the real round trip now, not just the client-side wiring.

  **Reworked again for a period selector (Hoy/Semana/Mes), a real budget
  indicator, and to drop the 7-day trend chart** — a later pass, driven by a
  MonIA reference screenshot the user shared (mockup's literal look not
  copied, same "structure/UX only" rule as every other reference screenshot
  in this app). Top-to-bottom the page is now: `.pageHeader` (title +
  `PERIODS` segmented control — `hoy`/`semana`/`mes`, local state `period`,
  no shared component with `PanelGeneral.jsx`'s `MonthYearPicker` since Panel
  navigates calendar months and Diario needs relative windows like "last 7
  days"), a chrome-free hero (small "presupuesto restante" caption above the
  big signed total when any category has a budget — see below — then the
  total/pills, same style as before just relabeled "Total de {período}"),
  a horizontal row of **category chips** (not bars anymore — see below), and
  `Card title="Movimientos — {período}"`. **The trend chart is gone
  entirely** (`buildTrendData`, `trendData` state, `TREND_DAYS`, and the
  `Tendencia (últimos N días)` `Card` were all removed) — the user asked
  explicitly for this page to be "así de limpio y sin gráficas".

  **`loadAll` fetches a different range per `period`**: `hoy` →
  `listTransactionsForDay(today())` (unchanged); `semana` → last 7 days
  (`WEEK_DAYS`) via the new `transactionsApi.listTransactionsForDateRange`
  (full joins, unlike the now-deleted `listTransactionsForRange`, which was
  a lighter no-joins variant only the old trend chart needed and got deleted
  alongside it — Diario needs to *list* the movements, not just sum them);
  `mes` → `listTransactionsForMonth(year, month)` of the real current month
  (no year/month picker of its own, always "this month", unlike Panel).
  State/variable names were renamed from the old "today"-only assumption
  (`todayTransactions`→`periodTransactions`, `visibleToday`→`visiblePeriod`,
  `gastoHoy`/`ingresoHoy`/`netHoy`→`gastoPeriodo`/`ingresoPeriodo`/
  `netPeriodo`) since "hoy" stopped being always true.

  **Category chips replace the old proportional vertical bars**
  (`.categoryChipsRow`, same horizontal-scroll-with-hidden-scrollbar trick as
  `CategoryEmojiGrid.jsx`) — each chip is emoji + `formatCompact` amount,
  with a **colored border indicating proximity to that category's
  `categories.monthly_budget`** for the selected period:
  `% usado = gasto de esa categoría en el período / monthly_budget`, mapped
  to `--status-good` (<70%), `--status-warning` (70-99%), `--status-serious`
  (100-119%), `--status-critical` (≥120%) — a category with no budget
  configured gets a neutral `--border-hairline` border, never a color,
  since there's nothing to measure proximity against. Tapping a chip
  (`selectedCategoryId`, toggles off on a second tap) shows a caption below
  ("$X restantes de $Y" / "$X excedido" / "sin presupuesto configurado" for
  one without a budget). The hero's "presupuesto restante" caption is the
  aggregate of the same idea: `Σ(monthly_budget of categories that have one
  configured) − Σ(spend in those same categories, same period)` — categories
  without a budget are excluded from the sum entirely, never treated as a
  $0 budget (same principle `panelApi.fetchAlerts`'s `presupuesto_categoria`
  alert already used). This needed no schema change —
  `categories.monthly_budget` already existed and was already editable from
  Ajustes → Categorías; only the visualization was missing before.

  **Chips widened on the user's own request, to show ~4-5 at a time on a
  phone instead of a denser row** — `.categoryChip` went from `padding: 8px
  10px`/no minimum width to `padding: 12px 16px`/`min-width: 76px`, the
  emoji circle from 32px to 38px, and the amount text from `--font-caption`
  to the next size up (`--font-footnote`). Purely a sizing change, same
  horizontal-scroll/hidden-scrollbar mechanics as before.

  **"Movimientos — {período}" groups by date when `period !== 'hoy'`**
  (`groupTransactionsByDate`, a `Map` keyed by `occurred_at.slice(0,10)`,
  newest day first) — a small header row per day (`.txDateHeader`, e.g.
  "lun, 11 sept") between groups; for `period === 'hoy'` the list renders
  flat with no header, since grouping a single day is a no-op UX-wise. Same
  `renderTxRow` function (edit via `transactionsApi.updateTransaction`, "×"
  delete, both still patch local state instead of `reload()`ing) is shared
  by both render paths. The edit still keeps the transaction's original sign
  and date, same as before. **The inline "✎" edit button was later removed**
  — tapping anywhere on a non-editing `.txRow` now calls `startEdit(t)`
  directly (`.txRowClickable`, just `cursor: pointer`), same "select it and
  it's already editable" pattern `GastosDiarios.jsx`'s Movimientos list
  already used (there it's scoped to `.txInfo`, not the whole row — a minor,
  harmless inconsistency between the two, not worth reconciling on its own).
  "×" delete calls `e.stopPropagation()` so it doesn't also trigger edit.

  **A real width-overflow bug surfaced once the edit row could contain a
  `CategoryEmojiGrid`**: `.page` (this page's own top-level container,
  `display: grid`, not the shared `.grid-auto`) never got the equivalent of
  `.grid-auto > *`/`.kpi-row > *`'s `min-width: 0` rule from `index.css` —
  harmless while every child's content was already narrower than the
  viewport, but `CategoryEmojiGrid`'s horizontally-scrollable chip row
  reports its *max-content* width (the sum of every chip) regardless of its
  own `overflow-x: auto`, so opening a transaction's edit form (which embeds
  that grid) inflated the grid track — and the whole page — wider than the
  screen instead of the chip row scrolling on its own. Fixed the same way as
  everywhere else this bug class has hit: `.page > * { min-width: 0; }` in
  `Diario.module.css`.

  **The edit form itself was later given a card look**, on the user's own
  request for it to be "prettier" — `.txEditRow` went from a flat column
  with just a `border-bottom` (the same as any other list row) to a raised
  card (`background: var(--surface-raised)`, `border-radius: 14px`, real
  padding instead of sitting flush with the list), with a small header row
  (`.txEditHeader`) showing the transaction's category glyph next to an
  uppercase "EDITANDO MOVIMIENTO" caption (`.txEditLabel`) — so the card look
  itself isn't the only signal you're now editing. Same card-for-editing
  idea as Ajustes → Categorías (see below), not shared code between the two
  since they're different pages/components, but the same visual language.

  **The edit form got a deeper rework later, from two Stitch mockups the
  user dropped in `other recursos/`** (`editar_movimiento.jpeg` +
  `editar_movimiento_comida.html`) — same "structure/UX only" rule as every
  other reference in this app (the mockup's dark-only Tailwind palette,
  glow shadows and a fictional "ID: #MOV-8631" were not copied):
  - A **Gasto/Ingreso type badge** (`.txEditTypeBadge`, tokens only —
    `--status-critical`/`--status-good` tints, not the mockup's literal
    rose/emerald hexes) next to the "EDITANDO MOVIMIENTO" label.
  - **Categoría collapsed behind "Cambiar"**: `categoryPickerOpen` (state,
    resets to `false` on every `startEdit`) gates whether `CategoryEmojiGrid`
    renders at all, or a compact current-value row (`.txEditCurrentValue` —
    small glyph + name, tappable, same effect as tapping "Cambiar")
    shows instead. Before this, the full category grid was always expanded
    inside the edit card even when the user only wanted to fix the monto or
    a tag.
  - **Amount got quick-add presets** (`.txEditPresets`, +5.000/+10.000,
    additive like the category-budget presets in Ajustes) next to the monto
    input.
  - **Tags became real multi-select pills** (`editDraft.tags`, an array —
    was `editDraft.tag`, a single string) via `handleDraftAddTag`/
    `handleDraftRemoveTag`, copied from `GastosDiarios.jsx`'s own tag pill
    editor (see that page's entry above) — this closes the gap that section
    used to call out explicitly ("this page's multi-tag pill editor is the
    one to copy if `Diario.jsx` ever needs the same fix"): editing a
    CSV-imported row with several tags (`#efectivo #cerveza`) no longer
    silently drops every tag but the first on save.
  - **Field order now matches the mockup**: Categoría → Monto → Cuenta →
    Etiquetas → Nota o detalle (was Descripción → Monto → Cuenta →
    Categoría → Tag) — each field wrapped in `.txEditField` with an
    uppercase `.txEditFieldLabel` above it, same "label above control"
    idiom Ajustes → Categorías uses.

  **Live refresh via a window event, not a prop, is unchanged**: since this
  page's own entry form is gone, the *only* way to add a movement while
  viewing `/diario` is the floating FAB — but `QuickCaptureFAB` and the
  routed page are siblings under `AppShell`, not parent/child, so there's no
  `reload()` to pass down as a prop. `AppShell.jsx`'s `refreshPendingCount`
  (already called as `QuickCaptureFAB`'s `onSaved`) also does
  `window.dispatchEvent(new Event('dashboard:transactions-changed'))`, and
  `Diario.jsx` wraps its whole fetch (`loadAll`, a `useCallback` depending on
  `[period]` now, so switching the segmented control re-triggers it too) in
  a `useEffect` that both runs it once on mount and subscribes to that event
  — so saving from the FAB while `/diario` is open refreshes it live. This
  remains a narrow, deliberate exception to "no global store": it's a pure
  "something changed, go refetch" signal, no data travels through the event
  itself.
- **`PanelGeneral.jsx`**: consolidated KPIs (balance total, patrimonio
  neto, ingresos/gastos del mes), the alerts list above (including the
  category-anomaly alert), a "Próximos pagos" card (see below), account
  distribution bar chart, 6-month trend line + comparison table, and a
  "Comparativa año a año" card (current YTD vs. same months last year via
  `panelApi.fetchMonthlyTrend`, 2 StatTiles + a 4-line chart with dashed
  lines for the prior year).

  **Month/year selector, added later**: `YEAR`/`MONTH` module constants
  became `year`/`month` state (`MonthYearPicker`, a new shared component
  extracted from the month `<select>` + year `<input type="number">` that
  used to live inline in `GastosDiarios.jsx`'s CSV-import card — that card
  now uses the same extracted component, zero behavior change there), shown
  next to the page title. The load `useEffect` depends on `[year, month]`
  and propagates them to `fetchBalancesForMonth`, `fetchMonthlyTrend` (via
  `lastNMonths(year, month, TREND_MONTHS)`), and the 3 YoY month-range
  calculations. **`fetchTotalDebt()` was deliberately left unparametrized**
  — it has no date filter at all (it's a snapshot of debt *right now*, not
  historical), so "Patrimonio neto" for a past month still subtracts today's
  debt, not that month's — a known, documented limitation, not a bug to fix
  here. **`fetchAlerts()` was also deliberately left unparametrized** — the
  "Alertas" card always shows "today real" regardless of which month the
  rest of the page is navigating, since "what needs my attention now" isn't
  a function of which period you're browsing in the charts.

  **"Próximos pagos" card**: filters the same `alerts` array (already
  fetched) down to `kind === 'gasto_fijo'` and renders each with a "Marcar
  pagado" button calling `fixedExpensesApi.setPaidStatus` directly (against
  `REAL_YEAR`/`REAL_MONTH`, same "always today" reasoning as Alertas, not
  the selected `year`/`month`), then patches `upcomingFixedExpenses` locally
  instead of a full `reload()` — same hot-path pattern as
  `handleToggleInstallment` in `Deudas.jsx`. Sourced from a new
  `fixedExpensesApi.listUpcomingFixedExpenses(year, month, dueSoonDays)`
  rather than re-deriving from `fetchAlerts`'s composite `fx-${id}` alert
  id, so this card gets the real uuid directly instead of string-parsing an
  id that alert objects only assemble for their own `href` purposes.
- **`Cuentas.jsx`**: cuenta madre + hijas CRUD (tap a card's header to edit it —
  name, currency, and
  optionally `is_multi_currency` + extra `account_currencies` pockets so one
  account (like `arq`) can hold several real currency balances at once — see
  "Multi-currency accounts are a real single row now" above for the full
  mechanics; no standalone "Tasa de cambio" card and no inline rate row either —
  rates are edited only in Ajustes → Tasas de cambio), an optional saldo-adjustment
  section covering every active account (`MonthlyInitialBalancesSection.jsx`
  — manual entry or via the iPhone Shortcut described in
  `prompt-dashboard-financiero.md`'s "Fase 2"; both write to
  `monthly_initial_balances` with `source: 'manual'|'shortcut'`; see "Ajuste
  de saldo (opcional)" below for why this stopped being a monthly chore),
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
  `prompt-dashboard-financiero.md`. A transfer between accounts of
  different currency (e.g. a COP hija → **arq**, USD) is supported via two
  manual amounts — `account_transfers.to_amount`/`to_currency` (nullable,
  null for same-currency transfers) hold the destination leg, entered by
  hand rather than auto-converted, since a one-off currency-exchange rate
  doesn't have to match the manual rate in `exchange_rates`;
  `accountsApi.fetchBalancesForMonth` credits the destination account using
  `to_amount`/`to_currency` when present (falling back to `amount`/
  `currency` otherwise) while the source account is always debited in its
  own `amount`/`currency`. A dedicated `CurrencyExchangeSection.jsx` widget
  used to sit above `TransferHistorySection.jsx` as a faster path for that
  same scenario (destination amount pre-filled from the saved rate instead
  of typed by hand) — **it was removed** once it read as duplicate chrome
  next to Ajustes → Tasas de cambio; `TransferHistorySection.jsx`'s own
  add-transfer form and the "+" FAB's traslado mode (which also
  pre-fills "Monto recibido" from the saved rate, see "Quick capture (FAB)")
  are the two remaining ways to register one of these. Also fixed-expenses
  grouped list (Pendientes/Pagados este mes) with tap-to-edit rows,
  toggle-paid and archive (`FixedExpensesSection.jsx` — *creating* one
  moved to Ajustes → Gastos fijos, same relocation pattern as `'cuentas'`/
  `'deudas'`/`'metas'` below; this component now just listens for
  `dashboard:fixed-expenses-changed` to refresh after a create there).
  There is no
  exchange-rate card or inline rate row left on this page at all — every
  pair is edited exclusively from Ajustes → Tasas de cambio (see "Fifth
  section, 'tasas'" above); this page only reads `exchange_rates` for the
  "faltan tasas configuradas" warning banner and for computing balances.

  **Section order on this page, top to bottom**: cuenta madre + hijas cards,
  `MonthlyAllocationSection` (Distribución mensual), `FixedExpensesSection`
  (Gastos fijos), `TransferHistorySection` (Historial de transferencias),
  `MonthlyInitialBalancesSection` (Ajuste de saldo (opcional), now last) —
  swapped with Gastos fijos on the user's own request, no other reasoning
  than reprioritizing what's seen first on the page.

  **`MonthlyInitialBalancesSection.jsx`: a multi-currency account is one
  table row, not one per pocket.** It used to list every pocket as its own
  always-visible row (e.g. "Arq" and "Arq (EUR)" as two separate lines),
  which the user flagged as clutter once there were several such accounts —
  now `accountRows` groups `flattenAccountPockets` back by account, and an
  account with more than one pocket renders as a single row with a small
  currency `<select>` next to the amount input instead of a permanent row
  per currency. `values`/`existing` stay indexed by the same per-pocket key
  as before (`p.key`, `accountId` or `accountId:currency`) — only the render
  grouped, so switching the dropdown and back doesn't lose whatever was
  already typed in the other currency, and `handleSave` is unchanged (it
  still iterates the flat, ungrouped pocket list). Single-currency accounts
  render exactly as before (plain row, no dropdown, since there's nothing to
  pick).

  **"Ajuste de saldo (opcional)" — this section stopped being a monthly
  chore, on the user's own observation that it felt like a duplicate of
  "Distribución mensual".** The two are conceptually different (one is *how
  much you plan to hand each hija*, the other is *what the bank actually
  says a bolsillo has*), but before this change "Saldos iniciales" had no
  fallback at all — an empty field every month, unlike the allocation
  section's previous-month template — so it felt like the same re-typing
  chore twice. The fix wasn't UI-only: `fetchBalancesForMonth`/
  `fetchMonthlyTrend` now resolve an **anchor + accumulation** (see "Money
  math" above and `src/lib/balanceAnchors.js`) instead of requiring a fresh
  `monthly_initial_balances` row every month, so a bolsillo's balance now
  carries forward on its own. This section (renamed from "Saldos iniciales")
  is now wrapped in a collapsed `<details>` ("¿El saldo real de tu banco no
  coincide? Ajustalo acá"), open by default only when a bolsillo already has
  a row for the current month, and each row shows the already-computed
  balance next to the input (as both a caption and the input's placeholder)
  instead of a bare "0" — so using it at all is now explicitly an opt-in
  reconciliation against a real bank discrepancy, not a required monthly
  step. `Cuentas.jsx` passes it the same `balances` it already computes for
  the account cards. The saldo inicial "real" for a normal (non-multi-currency)
  account is now seeded once, at account-creation time — `createAccount`
  gained an `initialBalance` parameter mirroring the one multi-currency
  pockets already had, and Ajustes → Cuentas' alta form gained a matching
  "Saldo inicial (opcional)" field for that path — so "load it once, when
  you create the account" is true for every account, not only multi-currency
  ones.
- **`GastosDiarios.jsx`**: this page shrank a lot mid-session — both its
  category CRUD (moved to `SettingsPanel.jsx`) and its manual entry form and
  search card (see below) are gone, leaving it focused on the MonIA
  import/reconciliation workflow and the month's read-only tables. Order,
  top to bottom: a "Pendientes de banco" confirmation table with
  historical-frequency suggestions, a "Compras en divisa por confirmar"
  queue right below it (rows whose amount is still the estimate produced at
  import — shows MonIA's original COP figure, an editable amount in the
  account's currency, and — once that field is edited — the implied rate
  MonIA used, a free real-market datapoint to check the manual rate
  against; a `≈` marks any such estimate wherever it surfaces elsewhere on
  this page, see the arq flow above), spend-by-category and spend-by-tag
  bar charts, a "candidatos a gasto fijo" detector that flags a description
  repeated in ≥3 of the last 6 months and offers to add it as a recurring
  fixed expense, "Movimientos — mes" (a day-grouped list, not a table — see
  below), "Presupuesto por categoría" (cards with a progress bar — see
  below), and — **moved to the very end of the page** (it used to
  be the first card) — "Importar CSV de MonIA" (dedup via `monia_id`, the
  bank-assignment engine above, using the same `MonthYearPicker` component
  `PanelGeneral.jsx` uses — extracted from what used to be this card's own
  inline month `<select>`/year `<input>`, zero behavior change here). The
  reorder was a deliberate priority flip: import is a once-a-month chore,
  the tables above it are what gets checked far more often, so it no longer
  has to be scrolled past on every visit.

  **Spend-by-category and spend-by-tag bar charts**: the spend-by-tag chart
  excludes tags that name an account — a transaction typically carries both
  an account tag and a descriptive tag in the same `tags` array, so without
  this filter the same amount would be double-counted under both; the
  exclusion set is derived from the hijas' names, the same source of truth
  the assignment engine matches against. **Both charts share one height**,
  `twoColChartHeight = Math.max(120, categoryChartData.length * 28,
  tagChartData.length * 28)` — each used to compute its own height from its
  own row count, so whichever list was shorter left empty space at the
  bottom of its card once CSS Grid stretched both cards in that row to
  match the taller one. **The spend-by-category chart's bars use each
  category's real color** (`c.color || seriesForName(c.name)`, same
  fallback the "Movimientos" glyph and `Diario.jsx` already use) instead of
  a generic rotating palette — the rotating palette had no relationship to
  the color a category is actually assigned in Ajustes, so the same
  category showed a different color in this chart than in every other list
  in the app; spend-by-tag still rotates the generic palette, since tags
  have no color of their own.

  **All bar/line charts in the app dropped their `<CartesianGrid>` guide
  lines and got a tighter axis** (this page's two spend charts,
  `PanelGeneral.jsx`'s "Distribución por cuenta"/"Patrimonio neto"/
  "Tendencia"/"Comparativa año a año", `MetasAhorro.jsx`'s growth chart, and
  `Deudas.jsx`'s "Salud financiera") — the user flagged that every chart
  left a lot of unused blank space on the left. The cause: a horizontal
  `BarChart`'s category `YAxis` right-anchors its tick label against a
  fixed pixel `width`, so any width larger than the label actually needs
  shows up as blank space to the *left* of the whole chart, not between the
  label and the bars — the old hand-picked fixed widths (70–110px) were
  generous guesses that overshot most real account/category/tag names.
  `src/lib/chartUtils.js`'s `estimateCategoryAxisWidth(labels)` (new, small
  dependency-free module, same "no shared store" pattern as
  `currencyPockets.js`) computes the axis width from the longest label
  actually being rendered in that specific chart instead of a fixed guess,
  clamped to a sane `[34, 140]` range. The numeric `YAxis` on the line
  charts (Patrimonio, Tendencia, Comparativa, growth) had the same issue
  with a fixed 60–70px width against `formatCompact`'s short output
  ("1.2M"/"500K") — reduced to a fixed 42–46px, tight enough for that
  format without being computed dynamically (a numeric axis's tick values
  aren't known before Recharts renders them, unlike a category axis's
  labels).

  **"Movimientos — mes" is a day-grouped list, not a table**, redesigned to
  visually match `Diario.jsx`'s list style — a circular category glyph, the
  category name above the bold description, tags as read-only pills, and
  a small day header (`groupTransactionsByDate`) between groups, newest
  first. **Tapping a movement opens a full-transaction edit modal**
  (`editingTx`/`editDraft`, `.editBackdrop`/`.editSheet` in
  `GastosDiarios.module.css`) — purpose, amount, account, category, and
  tags all editable together via `transactionsApi.updateTransaction`, not
  just tags — styled identically to the "+" FAB's full-screen sheet
  (mobile: `100dvh`, `var(--page-plane)`; desktop: centered card,
  `var(--surface-raised)`) so editing feels like the same UI piece as
  adding a movement, instead of an inline expanding row. Tags inside that
  modal are their own editable pills (`editDraft.tags`, add/remove, always
  starting with `#`) rather than a single free-text field. **`Diario.jsx`'s
  edit form copied this exact pill editor later** (see its own entry below)
  — the two pages' `.txTagsEditor`/`.txTagEditable`/`.txTagRemove`/
  `.txTagAddInput` classes are duplicated 1:1 across
  `GastosDiarios.module.css`/`Diario.module.css` (same values, no shared
  import) rather than extracted into one place, consistent with this app's
  existing tolerance for small CSS duplication over a premature shared
  component (see `budgetToneColor`, duplicated the same way for the same
  reason).
  The categoría/cuenta/tag filter row above the list is collapsed behind a
  `.filterToggle` button (`IconFilter`, badge shows the active-filter
  count) instead of always visible, same "don't show what isn't being
  used" reasoning as `SearchPanel.jsx`'s own "Filtros" toggle — it defaults
  open only when the page was deep-linked with a filter already in the URL
  (`?categoryId=&accountId=&tag=`, still read once on mount by
  `useSearchParams`, still built only by `SearchPanel.jsx`'s "Ver en
  Gastos" link for its structured filters). Filtering is still
  **client-side** over the already-fetched `monthTransactions`, not a new
  Supabase query, so the page's other aggregates (charts, "% usado") keep
  seeing the unfiltered month. Delete is unchanged
  (`transactionsApi.deleteTransaction`, a "×" per row).

  **"Presupuesto por categoría" replaced the old "Gasto real vs. presupuesto
  por cuenta" card (a card grid with a progress bar per cuenta hija/pocket)**
  — the user flagged that it was, in effect, showing the same number twice:
  its denominator's first term was `account_allocations.allocated_amount`,
  the exact figure `MonthlyAllocationSection.jsx` ("Distribución mensual" in
  `Cuentas.jsx`) already writes and displays — so opening Cuentas showed
  "Nequi: asignado $500.000" and opening Gastos showed a card that also
  printed "Asignado: $500.000" verbatim, just alongside more numbers (spent,
  moved, income). They weren't literally redundant (one was the *plan*, the
  other the *plan-vs-actuals*), but sharing that one anchor number was
  enough to feel duplicative. A subagent investigation confirmed
  `categories.monthly_budget` (edited in Ajustes → Categorías) already had
  three real, working uses — Diario.jsx's category chip borders + its
  "presupuesto restante" hero caption, and Panel General's
  `presupuesto_categoria`/`anomalia_categoria` alerts — but **no single
  consolidated view** listing every budgeted category with its month-to-date
  spend in one place; `GastosDiarios.jsx` in particular never read
  `monthly_budget` at all before this. The new card fills exactly that gap:
  `categoryBudgetData` filters `categories` to those with `monthly_budget`
  set (a category without one is excluded entirely, never shown as a $0
  budget — same principle as everywhere else in the app), reuses the
  already-computed `spentByCategory` (COP-converted, `isIgnoredRow`-filtered,
  the same map that feeds the spend-by-category chart above it) as the
  numerator, and sorts by `%` descending so the most over-budget category
  surfaces first. Same visual shell as the card it replaced (`.budgetGrid`/
  `.budgetCard`/`.budgetBarTrack` etc. in `GastosDiarios.module.css`, kept
  as-is) and the same `budgetToneColor` 4-tier scale (<70% good, 70–99%
  warning, 100–119% serious, ≥120% critical) `Diario.jsx`'s chips already
  use. **The account-level "% usado" view was not relocated anywhere** — the
  user explicitly asked to just remove it from Gastos, not move it to
  Cuentas.jsx; `allocations`/`transferredOut`/`spentByAccount`/
  `incomeByAccount`/`pendingByAccount` and their fetches
  (`getAllocationsForMonth`, `getTransfersForMonth`/`sumOutgoingByAccount`)
  were deleted from this file since nothing else here used them.

  **The manual expense form is gone** (`createManualTransaction` is no
  longer imported/called from this file at all) — same reasoning as
  `Diario.jsx`'s removed form: the floating "+" already covers manual
  entry, so a second copy of that form on this page was redundant.
  **"Buscar movimientos" is also gone from this page** — it's not deleted,
  it moved to the new global `SearchPanel.jsx` (see "Quick capture" above),
  which is the only surviving copy of the search feature; a brief
  intermediate design (navigate here with `?focus=buscar` and
  scroll-and-focus the old inline card) was built and then replaced within
  the same session once the user asked for a real popup instead of a
  redirect — don't resurrect that query-param approach.
  **Learned category/tag suggestions**: `purpose_category_stats` (schema.sql)
  incrementally learns "descripción (purpose, normalizada) → categoría + tag"
  every time `createManualTransaction` (from `QuickCaptureFAB.jsx` now,
  since this page has none) or `importTransactions` saves a row with a
  resolved category — same incremental-learning shape as
  `category_account_stats`, one level earlier. Because this only learns
  going forward, `transactionsApi.backfillPurposeCategoryStats` (a button in
  `SettingsPanel.jsx`, "Aprender categoría/tag de tu historial") does a
  one-time pass over every already-saved transaction with a category, so
  history from before this feature existed also starts suggesting.
- **`Deudas.jsx`**: debt CRUD (creditor, total/restante, tasa mensual
  opcional, plazo opcional, per-debt `currency` via a `CURRENCIES` picker set
  **only at creation** — the edit form shows it as a read-only label, never a
  `<select>`, because `total_amount`/`remaining_amount`/installment amounts
  are never converted when currency changes, so an editable currency dropdown
  on an existing debt would silently corrupt `toCOP`-based consolidated
  totals (e.g. relabeling a COP debt as USD without converting the number
  multiplies its contribution by the USD/COP rate). Delete and recreate the
  debt if its currency was set wrong — every per-debt amount renders with
  `formatByCurrency`, while the
  consolidated "Deuda total"/"Patrimonio" StatTiles stay in COP via `toCOP`,
  same per-account-vs-consolidated split as the rest of the app), per-debt
  installment calendar with a French fixed-payment amortization generator
  (`generateAmortizationSchedule` in `debtsApi.js`) when both tasa and plazo
  are set, a "regenerar cuotas pendientes" flow that replaces only unpaid
  installments, and the patrimonio-vs-deuda health chart. Amortization
  reconciliation: `debts` has a `schedule_synced_remaining_amount` column
  snapshotting `remaining_amount` at the moment the schedule was last
  generated/regenerated (kept in sync by `toggleInstallmentPaid`); when it
  drifts from the live `remaining_amount` (e.g. a manual payment made
  outside the installment flow) or when `total_amount` changes,
  `handleEditSave` now **auto-triggers** the same "Regenerar cuotas
  pendientes" flow right after saving — still routing through its existing
  `ConfirmDialog` when there are unpaid installments to replace, and
  regenerating silently only when there's nothing pending to lose — instead
  of only showing a warning banner and waiting for the user to click the
  button themselves.

  **Marking a `'debo'` installment paid can now debit a real account, added
  later.** `debt_installments.account_id`/`.linked_transaction_id` already
  existed (added earlier for `'me_deben'` abonos, see `addAbono` below) but
  sat unused for this direction — no schema change was needed to wire them
  up. The installments table gained a "Cuenta" column: unpaid rows show a
  `<select>` (hijas + a "Dinero externo" option meaning "don't touch any
  account balance"), paid rows show plain text (the account used, or
  "Dinero externo"). `handleToggleInstallment` went async: marking paid with
  an account chosen first calls `createManualTransaction` (negative amount,
  same pattern as `handleAddAbono` below) and passes its id into
  `debtsApi.toggleInstallmentPaid(installment, debt, { accountId,
  linkedTransactionId })`; unmarking passes neither — the function resolves
  the revert itself from `installment.linked_transaction_id` (deletes that
  transaction, clears both columns), so the caller never has to remember
  which account a past payment used.
- **`MetasAhorro.jsx`**: both goal kinds — `'proposito'` (tied to a hija
  account, progress = that account's real balance, contribution log is
  annotation-only) and `'puntual'` (progress = sum of logged
  contributions, which *is* `current_amount`'s source of truth) — with a
  growth chart, a pace-based "cumplirás en ~X meses" projection, and a
  planeado-vs-aportado table (only shown when both `target_amount` and
  `target_date` are set). Contributions can be deleted
  (`savingsApi.deleteContribution`); for `'puntual'` goals this also
  decrements `current_amount` to keep it matching the log.

  **A `'puntual'` contribution can now debit a real account too, added
  later — `'proposito'` was deliberately left untouched.** Unlike the debt
  case above, `savings_contributions` had no `account_id`/
  `linked_transaction_id` columns yet, so this needed a real schema change
  (`schema.sql` + a 2-statement live-DB snippet, see `esquema-datos.md`'s
  "Cambios de esquema..." procedure). The account selector in "Agregar
  aporte" only renders `g.kind === 'puntual'` — a `'proposito'` goal's
  progress already comes from the linked account's real balance
  (`fetchMonthlyTrend`), so creating a transaction there too would double-
  count the same money once via the real balance and once via the
  "aporte". `handleAddContribution`, when an account is chosen, creates the
  transaction first (`createManualTransaction`, negative amount,
  `currency` derived from the chosen account, **no category** — the user
  explicitly declined adding a new "Ahorro" category for this) and passes
  its id to `savingsApi.addContribution`; `deleteContribution` reverses it
  the same way `deleteAbono`/the debt case above do, deleting the linked
  transaction before decrementing `current_amount`.

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
- **AI-powered fallback for the purpose→category/tag suggestion
  (`purpose_category_stats`) was evaluated and explicitly declined.** The
  user asked whether the system generalizes semantically (e.g. typing
  "comida" suggesting "Salida a comer", or "cívica" suggesting
  "Transporte") the way a human would, instead of only matching
  previously-seen exact text. A Plan subagent analysis confirmed it does
  not: `normalizePurpose`/`suggestCategoryForPurpose` in
  `transactionsApi.js` only do an exact-text match (`trim + lowercase`, no
  stemming/fuzzy matching/AI), by explicit prior design (see
  `.claude/rules/esquema-datos.md`'s note on `purpose_category_stats`).
  Three options were considered: (1) local fuzzy text matching
  (substring/Levenshtein) — free but doesn't solve true synonyms like
  "comida"/"almuerzo"; (2) a real AI call (Gemini 2.5 Flash, same pattern
  as `voice-parse`) as a fallback only when no exact match exists —
  actually solves semantic cases, estimated at well under $0.15/month even
  at 500 transactions/month since it would only fire on genuinely new
  descriptions, not repeats; (3) Postgres `pg_trgm` trigram similarity —
  free, better than plain substring for typos/partial phrases, but still
  text-based, not semantic. **Decision: don't implement any of the three
  for now** — the user's reasoning was that the existing exact-match system
  already keeps improving on its own as more of the user's real, repeated
  vocabulary gets saved over time (`backfillPurposeCategoryStats` already
  seeds it from history), so the added complexity/latency of an AI
  fallback wasn't worth it yet. If this is revisited later, option 2
  (exact match first, Gemini fallback only on a miss) was the recommended
  approach precisely because it keeps repeated descriptions instant and
  free, and the "never auto-assign, always prefill for review" contract
  that `suggestCategoryForPurpose` already follows must be preserved
  regardless of which matching mechanism ends up used.
- `MonthlyAllocationSection.jsx` still has zero currency awareness by design
  (non-COP accounts — arq's USD and EUR pockets — are filtered out before
  reaching it via `hijasCop` in `Cuentas.jsx`, not made to understand
  currency) — that cut stands. `FixedExpensesSection.jsx`, however, now
  *does* support real multi-currency: it receives the full account list (not
  `accountsCop`) and derives each gasto fijo's `currency` from whichever
  account is selected (`createFixedExpense`/`updateFixedExpense` now write
  `fixed_expenses.currency`, previously a dead column), same "derive from
  account" pattern `QuickCaptureFAB`/`createManualTransaction` already use.
  `listRecentExpenses` still drops non-COP rows for its own separate
  reason: it feeds the fixed-expense *detector*, a distinct code path from
  this CRUD, not touched by this change.
- Individual debts now have a real per-debt `currency` picker in
  `Deudas.jsx`'s create form only (`debtsApi.createDebt` writes
  `debts.currency`, previously always defaulted to `'COP'`) — immutable after
  creation, see the note under "Current state of the 6 sections" above for
  why. Every per-debt display (`formatByCurrency`) reflects it, including the
  "Préstamos detectados sin registrar" candidates table (`tx.currency`, not a
  hardcoded COP) — and `handlePrefillFromCandidate` also carries over the
  source transaction's `currency` into the create form. The consolidated
  "Deuda total vs. Patrimonio" number, `panelApi.fetchTotalDebt`, and the
  Panel's `gasto_fijo`/`deuda` alerts already converted/labeled correctly
  once `currency` stopped being a dead value — no changes were needed there
  beyond passing `currency` through the `select`s.
- A transfer's `consumes_budget` **is** now editable after creation, as a
  deliberate, narrow exception to "no edit UI for transfers": a tappable
  badge ("Descuenta presupuesto" / "No descuenta") on each row of
  `TransferHistorySection.jsx`'s list (shown only for rows
  where neither end is the madre, same condition as at creation) calls
  `transfersApi.updateConsumesBudget(id, value)` and reloads — no
  `ConfirmDialog`, since it's non-destructive and instantly reversible.
  Every other field of a transfer still has no edit UI — delete + recreate
  remains the correction mechanism for those.
- `generateAmortizationSchedule` still only runs once per debt from scratch
  (guarded by "zero installments yet"). Drift reconciliation, however, is no
  longer fully manual: `Deudas.jsx`'s `handleEditSave` now auto-triggers the
  same `handleRegenerateSchedule` flow right after saving an edit, whenever
  the save left `remaining_amount` desynced from `schedule_synced_remaining_amount`
  (same `>1` threshold as the banner) **or** changed `total_amount` (which
  produces no persisted drift signal, so this is the only point it's
  actionable) — provided `interest_rate`/`term_months` are still set. The
  existing `ConfirmDialog` safeguard is preserved when there are unpaid
  installments to replace; it only regenerates silently when there's nothing
  destructive to warn about, exactly like the manual button already did. The
  *standing* banner (visible on any page load, independent of an edit) still
  can't detect a `total_amount`-only change outside that edit-time window —
  fixing that would need a new `schedule_synced_total_amount` column, not
  added here.
- `account_transfers` is still a plain event log with no general per-pair
  uniqueness, **except** the monthly madre→hijas "Confirmar transferencia
  real" action in `MonthlyAllocationSection.jsx`, which now builds a
  deterministic `idempotency_key` per hija (`transfersApi.buildMonthlyAllocationKey`)
  and inserts via `createTransfersIgnoringDuplicates` (`upsert` +
  `onConflict: 'user_id,idempotency_key'` + `ignoreDuplicates: true`) — a
  double-click, a stale reload, or two open tabs confirming the same month
  now gets silently absorbed at the DB level instead of creating duplicate
  real transfers. **The mount-time "already confirmed" check deliberately
  does NOT rely on that key matching** — it treats a hija as already funded
  this month if *any* madre→that-hija transfer exists this month, from any
  origin (the app's own button, the iPhone Shortcut, or a manual entry via
  `TransferHistorySection`), and only shows the button when some hija with
  a nonzero planned amount still lacks one. An earlier version of this guard
  matched only rows carrying the exact ritual `idempotency_key`, which was
  wrong: since the iPhone Shortcut inserts its own madre→hija rows with no
  such key, that version failed to recognize a distribution already done via
  the Shortcut and let a second real click through — this was caught by
  actually triggering it against production data mid-development, and it
  really did create a duplicate real transfer (since deleted). The
  idempotency key is kept only as the DB-level insert guard for a same-session
  double-click/race, not as the source of truth for "already done this
  month." Manual transfers and `QuickCaptureFAB`'s transfer mode still don't
  dedupe (the latter regenerates its `idempotencyKey` on every call and uses
  plain `createTransfers`) — that remains a known gap, unchanged by this fix,
  scoped only to the monthly ritual's own duplicate-confirm risk.
- No iOS Shortcut file is checked into this repo — the user builds and
  maintains it themselves on their phone. As currently designed it does 3
  Supabase REST calls per hija account per month: sign in
  (`/auth/v1/token?grant_type=password` for a fresh `access_token`), then
  upsert into `account_allocations` (`?on_conflict=user_id,account_id,year,month`,
  `Prefer: resolution=merge-duplicates`) and insert into `account_transfers`
  (madre → hija, no upsert — see the duplicate-transfer risk above), using
  `apikey` + `Authorization: Bearer <access_token>` headers throughout.
- Two more Shortcuts follow this same login→insert pattern for real-time
  capture outside the monthly ritual — "Gasto rápido" (2 prompts: amount,
  account) and "Transferencia rápida" (3 prompts: amount, origen, destino,
  `consumes_budget` always `true`) — spec'd in full (exact REST calls,
  headers, JSON bodies) in `.claude/rules/shortcuts-ios.md`. The transfer
  one relies on `account_transfers.idempotency_key` (added to `schema.sql`
  specifically for this) to survive a Back Tap misfire or network retry
  without duplicating a real transfer, since `account_transfers` otherwise
  has no dedup at all (see the risk above). A `QuickCaptureFAB` button in
  `AppShell.jsx` covers the same three actions from inside the app, for
  when picking account/category explicitly (or a cross-currency arq
  transfer) matters more than raw speed — see "Quick capture + voice input"
  under Architecture for its mic button and learned-suggestion prefill.
- **Voice capture is written and deployed but not yet fully verified**: the
  `voice-parse` function has been deployed
  (`npx supabase functions deploy voice-parse --project-ref qxiqqozogggfynkanevt`)
  and calls **Gemini 2.5 Flash** (switched from Claude Haiku 4.5 at the
  user's request — same direct single-fetch-to-the-provider's-REST-API
  pattern, just a different endpoint/key/response shape, no abstraction
  layer added since a future provider swap is just as small an edit) — but
  the `GEMINI_API_KEY` secret (a key from aistudio.google.com, separate from
  any Claude Code subscription) still needs to be created and registered
  (`npx supabase secrets set GEMINI_API_KEY=xxxxx --project-ref qxiqqozogggfynkanevt`,
  no redeploy needed afterward) before the mic button does anything but show
  its "API key no configurada" error. The full round trip (mic → transcript →
  Edge Function → prefilled form) has not been exercised end-to-end in a
  real browser session yet — test on `npm run dev` at `localhost` first
  (`SpeechRecognition` needs a secure context, so it won't fire over
  `http://<lan-ip>:5173`; testing from a phone needs the deployed GitHub
  Pages HTTPS URL instead).
- **Receipt scanning is now deployed too** (`receipt-parse`, same Gemini 2.5
  Flash swap as `voice-parse`) — `GEMINI_API_KEY` is already set on the
  project (same secret both functions share), so "Escanear recibo" should
  work end-to-end. Like voice capture, the full round trip (foto → Edge
  Function → prefilled form) hasn't been exercised in a real browser session
  yet — worth a manual test on `npm run dev`.

## Importable external-agent config detected

An OpenAI Codex config exists at `~/.codex/config.toml` (user-level, outside
this repo). If you want to bring over its MCP servers, slash commands,
subagents, skills, or instructions, reply `/import` to scan it and see what
would come over, then `/import --yes=<digest>` (the scan output names the
digest) to apply the user-level items. No Gemini CLI config was found.
