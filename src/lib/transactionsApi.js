import Papa from 'papaparse'
import { supabase } from './supabaseClient.js'
import { listAccounts } from './accountsApi.js'
import { listCategories } from './categoriesApi.js'

// Tags de banco/medio de pago reconocidos por el motor de asignación
// (nivel 1 — ver .claude/rules/motor-asignacion.md). Deben coincidir con el
// nombre (en minúsculas) de una cuenta hija real para poder asignarla.
const BANK_TAGS = ['dale', 'nequi', 'rappi', 'nubank', 'efectivo', 'pibank']

// Tag de nivel 1 que, a diferencia de BANK_TAGS, no asigna una cuenta sino
// que resuelve la fila a "sin cuenta, a propósito" (gastos puntuales de
// manejo de divisas, ya expresados en COP en el CSV) — nunca debe entrar a
// la cola de "pendiente de banco" ni sumar a sus contadores/alertas.
const MONEY_TAG = 'moneda'

// Parsea el CSV exportado de MonIA (columnas: date, purpose, amount,
// currency, category, emoji, creator, creator_name, tags, timezone, id) a
// un shape intermedio en camelCase, sin tocar Supabase todavía.
export function parseMonIACSV(csvText) {
  const { data, errors } = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  if (errors.length) throw new Error(errors[0].message)

  return data
    .map((row) => ({
      moniaId: row.id?.trim(),
      occurredAt: row.date?.trim(),
      purpose: row.purpose?.trim() ?? '',
      amount: Number(row.amount),
      currency: row.currency?.trim() || 'COP',
      categoryName: row.category?.trim() || null,
      emoji: row.emoji?.trim() || null,
      creator: row.creator?.trim() || null,
      creatorName: row.creator_name?.trim() || null,
      tags: (row.tags || '').split(';').map((t) => t.trim().toLowerCase()).filter(Boolean),
      sourceTimezone: row.timezone?.trim() || null,
    }))
    .filter((r) => r.moniaId && r.occurredAt && !Number.isNaN(r.amount))
}

export function filterRowsByMonth(rows, year, month) {
  return rows.filter((r) => {
    const d = new Date(r.occurredAt)
    return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month
  })
}

function tagAssignedAccountId(tags, accountIdByLowerName) {
  for (const tag of tags) {
    if (BANK_TAGS.includes(tag) && accountIdByLowerName[tag]) return accountIdByLowerName[tag]
  }
  return null
}

// Nivel 1 (variante moneda, ver .claude/rules/motor-asignacion.md): si la
// fila trae una moneda distinta de COP y existe exactamente una cuenta hija
// activa con esa moneda, se asigna esa cuenta — dato real explícito del CSV
// (currency), no especulación, igual de confiable que un tag de banco.
function currencyAssignedAccountId(currency, accountsByCurrency) {
  if (!currency || currency === 'COP') return null
  const candidates = accountsByCurrency[currency]
  return candidates && candidates.length === 1 ? candidates[0] : null
}

// Para categorías no ambiguas (categories.is_ambiguous = false), busca si en
// el histórico ya confirmado esa categoría *siempre* fue a una única cuenta.
// Solo esas se auto-asignan (nivel 2) — si hay 0 o >1 cuentas distintas en el
// histórico, la transacción cae a nivel 3 (pendiente).
async function fetchSingleAccountHistoryByCategory(categoryIds) {
  if (categoryIds.length === 0) return {}
  const { data, error } = await supabase
    .from('transactions')
    .select('category_id, account_id')
    .in('category_id', categoryIds)
    .not('account_id', 'is', null)
  if (error) throw error

  const accountsByCategory = {}
  for (const row of data) {
    if (!accountsByCategory[row.category_id]) accountsByCategory[row.category_id] = new Set()
    accountsByCategory[row.category_id].add(row.account_id)
  }
  const singleAccountByCategory = {}
  for (const [categoryId, accountIds] of Object.entries(accountsByCategory)) {
    if (accountIds.size === 1) singleAccountByCategory[categoryId] = [...accountIds][0]
  }
  return singleAccountByCategory
}

// Importa las filas ya parseadas del CSV que caigan en year/month, aplicando
// el motor de asignación de 3 niveles y deduplicando por monia_id vía el
// unique constraint (user_id, monia_id) en Postgres — nunca solo en cliente.
export async function importTransactions(rows, year, month) {
  const monthRows = filterRowsByMonth(rows, year, month)
  if (monthRows.length === 0) return { imported: 0, skipped: 0, totalInMonth: 0 }

  const [accounts, categories] = await Promise.all([listAccounts(), listCategories()])
  const accountIdByLowerName = Object.fromEntries(
    accounts.filter((a) => a.kind === 'hija').map((a) => [a.name.toLowerCase(), a.id])
  )
  const accountsByCurrency = {}
  for (const a of accounts.filter((a) => a.kind === 'hija')) {
    const cur = a.currency || 'COP'
    ;(accountsByCurrency[cur] ??= []).push(a.id)
  }
  const categoryByLowerName = Object.fromEntries(categories.map((c) => [c.name.trim().toLowerCase(), c]))

  const unambiguousCategoryIds = [...new Set(
    monthRows
      .map((r) => (r.categoryName ? categoryByLowerName[r.categoryName.toLowerCase()] : null))
      .filter((c) => c && c.is_ambiguous === false)
      .map((c) => c.id)
  )]
  const singleAccountByCategory = await fetchSingleAccountHistoryByCategory(unambiguousCategoryIds)

  const payload = monthRows.map((r) => {
    const category = r.categoryName ? categoryByLowerName[r.categoryName.toLowerCase()] : null
    const tagAccountId = tagAssignedAccountId(r.tags, accountIdByLowerName)
    const currencyAccountId = currencyAssignedAccountId(r.currency, accountsByCurrency)

    let accountId = null
    let assignmentLevel = 3
    let assignmentConfirmed = false

    if (tagAccountId) {
      accountId = tagAccountId
      assignmentLevel = 1
      assignmentConfirmed = true
    } else if (r.tags.includes(MONEY_TAG)) {
      // Resuelto a propósito sin cuenta — corta acá, nunca cae a nivel 2/3.
      accountId = null
      assignmentLevel = 1
      assignmentConfirmed = true
    } else if (currencyAccountId) {
      accountId = currencyAccountId
      assignmentLevel = 1
      assignmentConfirmed = true
    } else if (category?.is_ambiguous === false && singleAccountByCategory[category.id]) {
      accountId = singleAccountByCategory[category.id]
      assignmentLevel = 2
      assignmentConfirmed = true
    }

    return {
      monia_id: r.moniaId,
      occurred_at: r.occurredAt,
      purpose: r.purpose,
      amount: r.amount,
      currency: r.currency,
      category_id: category?.id ?? null,
      emoji: r.emoji,
      creator: r.creator,
      creator_name: r.creatorName,
      tags: r.tags,
      source_timezone: r.sourceTimezone,
      account_id: accountId,
      assignment_level: assignmentLevel,
      assignment_confirmed: assignmentConfirmed,
      origin: 'csv_import',
    }
  })

  const { data, error } = await supabase
    .from('transactions')
    .upsert(payload, { onConflict: 'user_id,monia_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw error

  return { imported: data.length, skipped: payload.length - data.length, totalInMonth: monthRows.length }
}

// Alta manual de un gasto (Fase 3 del prompt original, adelantada para
// pruebas) — no viene de MonIA, así que no hay un `id` real del CSV para
// deduplicar; se genera uno sintético para satisfacer el unique constraint
// (user_id, monia_id) sin colisionar nunca con un id real de MonIA.
// No usa crypto.randomUUID(): esa API solo existe en contextos seguros
// (HTTPS o localhost) y esta app se prueba seguido por LAN vía http:// —
// ahí `crypto.randomUUID` no existe y rompe silenciosamente.
function generateLocalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function createManualTransaction({ purpose, amount, occurredAt, categoryId, accountId, tags }) {
  const { data, error } = await supabase.from('transactions').insert({
    monia_id: `manual-${generateLocalId()}`,
    occurred_at: occurredAt,
    purpose,
    amount,
    currency: 'COP',
    category_id: categoryId || null,
    account_id: accountId || null,
    tags: tags ?? [],
    assignment_level: accountId ? 3 : null,
    assignment_confirmed: !!accountId,
    origin: 'manual',
  }).select().single()
  if (error) throw error
  return data
}

export async function countPendingTransactions() {
  const { count, error } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('account_id', null)
    .eq('assignment_confirmed', false)
  if (error) throw error
  return count ?? 0
}

export async function listPendingTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, categories(name)')
    .is('account_id', null)
    .eq('assignment_confirmed', false)
    .order('occurred_at', { ascending: false })
  if (error) throw error
  return data
}

// Sugerencias de cuenta por categoría, ordenadas por frecuencia de
// confirmación histórica (category_account_stats con tag = null, ya que las
// transacciones pendientes por definición no traen tag de banco reconocido).
export async function fetchSuggestionsForCategories(categoryIds) {
  const ids = [...new Set(categoryIds.filter(Boolean))]
  if (ids.length === 0) return {}
  const { data, error } = await supabase
    .from('category_account_stats')
    .select('category_id, account_id, confirm_count')
    .in('category_id', ids)
    .is('tag', null)
  if (error) throw error

  const map = {}
  for (const row of data) {
    if (!map[row.category_id]) map[row.category_id] = []
    map[row.category_id].push({ accountId: row.account_id, count: row.confirm_count })
  }
  for (const key of Object.keys(map)) map[key].sort((a, b) => b.count - a.count)
  return map
}

// Confirmación manual de nivel 3: asigna la cuenta y alimenta
// category_account_stats para mejorar el orden de sugerencias futuras.
export async function confirmAssignment(transactionId, accountId, categoryId) {
  const { error: updateError } = await supabase
    .from('transactions')
    .update({ account_id: accountId, assignment_level: 3, assignment_confirmed: true })
    .eq('id', transactionId)
  if (updateError) throw updateError

  if (!categoryId) return

  const { data: existing, error: statsError } = await supabase
    .from('category_account_stats')
    .select('confirm_count')
    .eq('category_id', categoryId).is('tag', null).eq('account_id', accountId)
    .maybeSingle()
  if (statsError) throw statsError

  const { error: upsertError } = await supabase.from('category_account_stats').upsert(
    {
      category_id: categoryId, tag: null, account_id: accountId,
      confirm_count: (existing?.confirm_count ?? 0) + 1,
      last_confirmed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,category_id,tag,account_id' }
  )
  if (upsertError) throw upsertError
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}

// Gasto real por cuenta en el mes (solo transacciones negativas, en positivo)
// — para comparar cuánto se ha GASTADO de verdad contra lo asignado, sin
// confundirlo con el saldo (que sube apenas se transfiere/fondea la cuenta,
// no cuando se gasta).
export async function getSpentByAccountForMonth(accountIds, year, month) {
  if (accountIds.length === 0) return {}
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonthStart = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const { data, error } = await supabase
    .from('transactions')
    .select('account_id, amount')
    .gte('occurred_at', monthStart)
    .lt('occurred_at', nextMonthStart)
    .in('account_id', accountIds)
    .lt('amount', 0)
  if (error) throw error

  const spent = {}
  for (const row of data) {
    spent[row.account_id] = (spent[row.account_id] ?? 0) + (-Number(row.amount))
  }
  return spent
}

export async function listTransactionsForMonth(year, month) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const after = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  const nextStart = `${after.year}-${String(after.month).padStart(2, '0')}-01`

  const { data, error } = await supabase
    .from('transactions')
    .select('*, categories(name), accounts(name)')
    .gte('occurred_at', monthStart).lt('occurred_at', nextStart)
    .order('occurred_at', { ascending: false })
  if (error) throw error
  return data
}

// Gastos (amount < 0) de los últimos monthsBack meses (incluyendo el actual),
// para detección de patrones — no incluye ingresos, que no aplican a "gasto
// fijo recurrente".
export async function listRecentExpenses(monthsBack) {
  const now = new Date()
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsBack + 1, 1))
  const startStr = start.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('transactions')
    .select('purpose, amount, occurred_at, account_id')
    .gte('occurred_at', startStr)
    .lt('amount', 0)
  if (error) throw error
  return data
}

// Búsqueda libre de movimientos por texto/categoría/cuenta/tag/rango de
// fechas, sin restringirse al mes activo — a diferencia de
// listTransactionsForMonth, que solo trae el mes que se está gestionando en
// pantalla. `limit` evita traer todo el histórico de una sola vez en una
// tabla que puede crecer sin cota.
export async function searchTransactions({ query, categoryId, accountId, tag, dateFrom, dateTo, limit = 200 } = {}) {
  let q = supabase
    .from('transactions')
    .select('*, categories(name), accounts(name)')
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (query?.trim()) q = q.ilike('purpose', `%${query.trim()}%`)
  if (categoryId) q = q.eq('category_id', categoryId)
  if (accountId === 'pending') q = q.is('account_id', null)
  else if (accountId) q = q.eq('account_id', accountId)
  if (tag?.trim()) q = q.contains('tags', [tag.trim().toLowerCase()])
  if (dateFrom) q = q.gte('occurred_at', dateFrom)
  if (dateTo) q = q.lte('occurred_at', dateTo)

  const { data, error } = await q
  if (error) throw error
  return data
}

// Agrupa gastos por descripción (purpose, normalizado) y sugiere como
// candidato a gasto fijo cualquier grupo que aparezca en al menos
// minMonths meses distintos y que no coincida ya con un gasto fijo activo.
export function detectRecurringCandidates(expenses, existingFixedNames, minMonths = 3) {
  const groups = {}
  for (const t of expenses) {
    const key = t.purpose.trim().toLowerCase()
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }

  const candidates = []
  for (const txs of Object.values(groups)) {
    const key = txs[0].purpose.trim().toLowerCase()
    if (existingFixedNames.has(key)) continue
    const monthsSeen = new Set(txs.map((t) => t.occurred_at.slice(0, 7))).size
    if (monthsSeen < minMonths) continue

    const avgAmount = txs.reduce((sum, t) => sum - Number(t.amount), 0) / txs.length
    const avgDay = Math.round(txs.reduce((sum, t) => sum + new Date(t.occurred_at).getUTCDate(), 0) / txs.length)

    const accountCounts = {}
    for (const t of txs) if (t.account_id) accountCounts[t.account_id] = (accountCounts[t.account_id] ?? 0) + 1
    const mostCommonAccountId = Object.entries(accountCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    candidates.push({ purpose: txs[0].purpose, avgAmount, avgDay, monthsSeen, mostCommonAccountId })
  }

  return candidates.sort((a, b) => b.monthsSeen - a.monthsSeen)
}

// Movimientos de la categoría "Préstamo" (dinero prestado saliente, monto
// negativo) que todavía no fueron revisados — ni vinculados a un registro en
// `debts` (direction = 'me_deben') ni descartados explícitamente. Se filtra
// por category_id ya resuelto (no por nombre en cada fila) para no depender
// del join; si la categoría "Préstamo" no existe en el catálogo del usuario
// todavía, categoryId es null y no hay nada que detectar.
export async function listUnreviewedLoanTransactions(categoryId) {
  if (!categoryId) return []
  const { data, error } = await supabase
    .from('transactions')
    .select('id, purpose, amount, occurred_at')
    .eq('category_id', categoryId)
    .eq('loan_reviewed', false)
    .lt('amount', 0)
    .order('occurred_at', { ascending: false })
  if (error) throw error
  return data
}

// Marca un movimiento de categoría "Préstamo" como revisado, ya sea porque
// se creó un préstamo (debts.source_transaction_id) a partir de él o porque
// el usuario decidió ignorarlo — en ambos casos deja de sugerirse en
// próximas importaciones.
export async function markLoanTransactionReviewed(id) {
  const { error } = await supabase.from('transactions').update({ loan_reviewed: true }).eq('id', id)
  if (error) throw error
}
