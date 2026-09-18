// "Ancla" de saldo: en vez de exigir una fila de monthly_initial_balances por
// cuenta por mes, cada fila es un punto de reconciliación puntual y opcional
// ("el banco dice que este bolsillo arrancó el mes X con este monto"). El
// saldo de cualquier mes se resuelve buscando, por bolsillo, la fila más
// reciente con (year, month) <= el mes consultado y acumulando desde ahí —
// sin ninguna fila, el ancla es 0 en el mes de accounts.created_at (antes de
// eso la cuenta no existía). fetchBalancesForMonth (accountsApi.js) y
// fetchMonthlyTrend (panelApi.js) comparten esta resolución para no tener
// cada una su propia noción de "desde cuándo se acumula". Sin dependencias de
// dominio (mismo patrón que currencyPockets.js/chartUtils.js, ver
// .claude/rules/stack-tecnico.md) para que accountsApi.js (que ya importa de
// transfersApi.js) y panelApi.js puedan importarlo sin crear un ciclo.
import { supabase } from './supabaseClient.js'
import { buildPocketIndex, resolvePocketKey, pocketKeyFor } from './currencyPockets.js'

export function monthStartStr(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

// Todo el historial de monthly_initial_balances de estas cuentas, sin acotar
// año/mes — Postgres/PostgREST no da un "top-1 por grupo" sin RPC, así que la
// fila más reciente <= un mes target se resuelve en JS sobre este resultado
// (ver resolveAnchorsFromRows) en vez de pedir "el mes exacto" en cada
// llamada.
export async function fetchAllInitialBalanceRows(accountIds) {
  if (accountIds.length === 0) return []
  const { data, error } = await supabase
    .from('monthly_initial_balances')
    .select('account_id, year, month, initial_balance, currency')
    .in('account_id', accountIds)
  if (error) throw error
  return data
}

// Para cada bolsillo (accountId, o accountId:currency de una cuenta
// multi-moneda), la fila explícita más reciente con (year,month) <= target.
// Sin ninguna fila -> ancla sintética en el mes de creación de la cuenta,
// balance 0. Se usa accounts.created_at para TODOS los bolsillos de una
// cuenta multi-moneda, incluida una moneda agregada después de crearla: no
// vale una columna created_at nueva en account_currencies solo para esto,
// porque no puede haber movimientos en un bolsillo antes de que exista —
// "0 desde que se creó la cuenta" y "0 desde que se agregó el bolsillo" dan
// el mismo resultado hasta que ese bolsillo tenga su primer movimiento real.
export function resolveAnchorsFromRows(rows, accounts, targetYear, targetMonth) {
  const pocketIndex = buildPocketIndex(accounts)
  const targetKey = targetYear * 12 + targetMonth
  const anchors = {}

  for (const row of rows) {
    const rowKey = row.year * 12 + row.month
    if (rowKey > targetKey) continue
    const key = resolvePocketKey(pocketIndex, row.account_id, row.currency)
    if (!key) continue
    const current = anchors[key]
    if (!current || rowKey > current.year * 12 + current.month) {
      anchors[key] = { year: row.year, month: row.month, balance: Number(row.initial_balance) }
    }
  }

  for (const a of accounts) {
    const created = new Date(a.created_at)
    const createdAnchor = { year: created.getUTCFullYear(), month: created.getUTCMonth() + 1, balance: 0 }
    const pockets = [a.id, ...(a.extraCurrencies ?? []).map((c) => pocketKeyFor(a.id, c.currency))]
    for (const key of pockets) anchors[key] ??= createdAnchor
  }
  return anchors
}

// El mes-ancla más antiguo entre todos los bolsillos resueltos — desde ahí
// hay que traer transacciones/transferencias para que el acumulado de
// cualquier bolsillo particular quede completo.
export function earliestAnchorMonth(anchors) {
  return Object.values(anchors).reduce((earliest, a) => (
    !earliest || a.year * 12 + a.month < earliest.year * 12 + earliest.month ? a : earliest
  ), null)
}
