import Papa from 'papaparse'
import { supabase } from './supabaseClient.js'
import { listAccounts } from './accountsApi.js'
import { listCategories } from './categoriesApi.js'
import { getRates, convertAmount } from './exchangeRatesApi.js'
import { buildPocketIndex, resolvePocketKey } from './currencyPockets.js'

// Tags de nivel 1 que marcan una fila del CSV que el dashboard NO debe contar,
// porque el movimiento real ya está registrado en otro lado — ver
// .claude/rules/motor-asignacion.md. Dos motivos, mismo efecto:
//   - 'traslado' (y 'moneda', su nombre histórico): mover plata entre cuentas
//     propias o comprar divisas; el movimiento vive en account_transfers.
//   - 'ignorar': la compra ya se cargó a mano como transacción, típicamente
//     porque fue en otra moneda y MonIA solo la exporta en COP.
// No asignan cuenta: resuelven la fila a "sin cuenta, a propósito", nunca
// entran a la cola de "pendiente de banco", y no cuentan como gasto/ingreso en
// NINGUNA vista — contarlas sería contar el mismo movimiento dos veces.
export const IGNORED_TAGS = ['traslado', 'moneda', 'ignorar']

// Toda query nueva que sume gastos o ingresos debe filtrar con este helper.
export function isIgnoredRow(tags) {
  return (tags ?? []).some((t) => IGNORED_TAGS.includes(t))
}

// MonIA no deja escribir espacios al crear un tag, así que un nombre de
// cuenta de más de una palabra (ej. "Arq EUR") llega como "arq_eur". Se
// normaliza guion bajo -> espacio para que siga calzando contra
// accounts.name.toLowerCase() — ver .claude/rules/motor-asignacion.md.
// Usado tanto al importar el CSV como al editar tags a mano desde la UI,
// para que un tag tipeado a mano se comporte igual que uno importado.
export function normalizeTag(tag) {
  return tag.trim().toLowerCase().replace(/_/g, ' ')
}

// Un tag que coincide con IGNORED_TAGS o con el nombre de una cuenta hija
// activa no rompe nada técnicamente, pero para una fila cargada a mano con
// cuenta ya explícita ese vocabulario no cumple ningún propósito de
// asignación (eso solo importa para filas de CSV sin cuenta) — silenciosamente
// sacaría la fila del gráfico "gasto por tag" o la marcaría como movimiento
// ya contabilizado en otro lado (isIgnoredRow). Solo se usa para avisar, no
// para bloquear.
export function isReservedTag(tag, accounts) {
  const normalized = normalizeTag(tag)
  if (!normalized) return false
  if (IGNORED_TAGS.includes(normalized)) return true
  return accounts.some((a) => a.kind === 'hija' && (
    a.name.toLowerCase() === normalized || (a.extraCurrencies ?? []).some((c) => c.tag.toLowerCase() === normalized)
  ))
}

// Misma idea que normalizeTag pero para el texto de descripción (purpose),
// usada para matchear una descripción repetida contra sí misma en
// purpose_category_stats y en detectRecurringCandidates.
export function normalizePurpose(purpose) {
  return purpose.trim().toLowerCase()
}

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
      // MonIA no deja escribir espacios al crear un tag, así que un tag de
      // más de una palabra (ej. el nombre de la cuenta "Arq EUR") queda
      // forzosamente como "arq_eur" en el CSV. El motor de asignación
      // compara contra accounts.name.toLowerCase() (que sí tiene el espacio),
      // así que sin normalizar acá "arq_eur" nunca calzaría con "arq eur" y
      // la fila caería a pendiente de banco en vez de asignarse.
      tags: (row.tags || '').split(';').map(normalizeTag).filter(Boolean),
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

// El vocabulario de tags de cuenta son los nombres mismos de las cuentas
// hijas activas (en minúsculas): 'dale', 'nequi', ..., 'arq', 'arq eur'. No
// hay lista fija que mantener — crear una cuenta habilita su tag solo. Cada
// tag resuelve a un "bolsillo" ({accountId, currency}), no solo a un id: el
// nombre de la cuenta (bare) apunta a su moneda primaria, y el tag de cada
// moneda adicional de una cuenta multi-moneda (account.extraCurrencies,
// ej. "arq eur") apunta a esa moneda específica sobre el MISMO accountId.
function tagAssignedPocket(tags, pocketByTag) {
  for (const tag of tags) {
    if (pocketByTag[tag]) return pocketByTag[tag]
  }
  return null
}

// Nivel 1 (variante moneda, ver .claude/rules/motor-asignacion.md): si la
// fila trae una moneda distinta de COP y existe exactamente un bolsillo
// (cuenta o moneda de una cuenta multi-moneda) con esa moneda, se asigna ese
// bolsillo — dato real explícito del CSV (currency), no especulación, igual
// de confiable que un tag de banco.
function currencyAssignedPocket(currency, pocketsByCurrency) {
  if (!currency || currency === 'COP') return null
  const candidates = pocketsByCurrency[currency]
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

// MonIA deja capturar una compra en su moneda original pero al guardar la
// convierte, así que el CSV siempre llega en COP y el monto real (ej. 51.31
// EUR) se pierde. Cuando la cuenta que resolvió el motor tiene otra moneda,
// guardar la fila tal cual sería peor que inútil: fetchBalancesForMonth y
// getAccountFlowsForMonth solo suman filas cuya moneda coincide con la de la
// cuenta, así que un gasto en COP contra "arq eur" se descarta EN SILENCIO.
// Por eso la fila se guarda en la moneda de la CUENTA, con el monto estimado
// a partir de la tasa manual de exchange_rates, y marcada `currency_pending`
// para que el usuario teclee el monto exacto en la cola de Gastos. El COP
// original se conserva en source_amount/source_currency como auditoría (y de
// ahí sale la tasa implícita que usó MonIA).
//
// Si no hay tasa configurada para el par, convertAmount devuelve null y se
// guarda 0 en vez de inventar una conversión — misma filosofía que toCOP; la
// fila igual queda en la cola con el monto en COP visible como ancla.
function convertToAccountCurrency(row, accountCurrency, rates) {
  const converted = convertAmount(row.amount, row.currency, accountCurrency, rates)
  return {
    amount: converted === null ? 0 : Math.round(converted * 100) / 100,
    currency: accountCurrency,
    source_amount: row.amount,
    source_currency: row.currency,
    currency_pending: true,
  }
}

// Importa las filas ya parseadas del CSV que caigan en year/month, aplicando
// el motor de asignación de 3 niveles y deduplicando por monia_id vía el
// unique constraint (user_id, monia_id) en Postgres — nunca solo en cliente.
export async function importTransactions(rows, year, month) {
  const monthRows = filterRowsByMonth(rows, year, month)
  if (monthRows.length === 0) return { imported: 0, skipped: 0, totalInMonth: 0 }

  const [accounts, categories, rates] = await Promise.all([listAccounts(), listCategories(), getRates()])
  const currencyByAccountId = Object.fromEntries(accounts.map((a) => [a.id, a.currency || 'COP']))

  // Índices de bolsillo por tag y por moneda (ver tagAssignedPocket /
  // currencyAssignedPocket arriba): un bolsillo es {accountId, currency}. El
  // nombre bare de la cuenta apunta a su moneda primaria; cada moneda extra
  // de una cuenta multi-moneda aporta su propio tag y su propio bolsillo,
  // aunque comparta accountId con el primario.
  const pocketByTag = {}
  const pocketsByCurrency = {}
  for (const a of accounts.filter((a) => a.kind === 'hija')) {
    const primary = a.currency || 'COP'
    pocketByTag[a.name.toLowerCase()] = { accountId: a.id, currency: primary }
    ;(pocketsByCurrency[primary] ??= []).push({ accountId: a.id, currency: primary })
    for (const extra of a.extraCurrencies ?? []) {
      pocketByTag[extra.tag.toLowerCase()] = { accountId: a.id, currency: extra.currency }
      ;(pocketsByCurrency[extra.currency] ??= []).push({ accountId: a.id, currency: extra.currency })
    }
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
    const tagPocket = tagAssignedPocket(r.tags, pocketByTag)
    const currencyPocket = currencyAssignedPocket(r.currency, pocketsByCurrency)

    let accountId = null
    let resolvedCurrency = null
    let assignmentLevel = 3
    let assignmentConfirmed = false

    if (tagPocket) {
      accountId = tagPocket.accountId
      resolvedCurrency = tagPocket.currency
      assignmentLevel = 1
      assignmentConfirmed = true
    } else if (isIgnoredRow(r.tags)) {
      // Resuelto a propósito sin cuenta — corta acá, nunca cae a nivel 2/3.
      accountId = null
      assignmentLevel = 1
      assignmentConfirmed = true
    } else if (currencyPocket) {
      accountId = currencyPocket.accountId
      resolvedCurrency = currencyPocket.currency
      assignmentLevel = 1
      assignmentConfirmed = true
    } else if (category?.is_ambiguous === false && singleAccountByCategory[category.id]) {
      accountId = singleAccountByCategory[category.id]
      assignmentLevel = 2
      assignmentConfirmed = true
    }

    // Moneda de la fila distinta a la del bolsillo asignado: compra en divisa
    // que MonIA exportó convertida a COP (ver convertToAccountCurrency). Sin
    // señal específica de bolsillo (nivel 2/3, sin tag ni moneda propia) se
    // asume la moneda PRIMARIA de la cuenta. Las filas ignoradas nunca llegan
    // acá — resuelven a account_id = null antes.
    const accountCurrency = accountId ? (resolvedCurrency ?? currencyByAccountId[accountId]) : null
    const currencyFix = accountCurrency && accountCurrency !== r.currency
      ? convertToAccountCurrency(r, accountCurrency, rates)
      : null

    return {
      monia_id: r.moniaId,
      occurred_at: r.occurredAt,
      purpose: r.purpose,
      amount: currencyFix?.amount ?? r.amount,
      currency: currencyFix?.currency ?? r.currency,
      source_amount: currencyFix?.source_amount ?? null,
      source_currency: currencyFix?.source_currency ?? null,
      currency_pending: currencyFix?.currency_pending ?? false,
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
    .select('id, monia_id')
  if (error) throw error

  // Solo aprender de las filas realmente nuevas — reimportar el mismo CSV no
  // debe inflar los contadores de purpose_category_stats.
  const newMoniaIds = new Set(data.map((r) => r.monia_id))
  const newRowsWithCategory = payload.filter((r) => newMoniaIds.has(r.monia_id) && r.category_id)
  await recordPurposeCategoryStats(
    newRowsWithCategory.map((r) => ({ purposeKey: normalizePurpose(r.purpose), categoryId: r.category_id, tag: r.tags?.[0] ?? null }))
  )

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

// `currency` sale de la moneda de la cuenta elegida en el formulario, no de un
// selector aparte: es la única forma de cargar un gasto en EUR/USD contra las
// cuentas de arq, y evita que un monto en euros quede marcado como pesos (en
// cuyo caso fetchBalancesForMonth lo descartaría en silencio por no coincidir
// con la moneda de la cuenta).
// Aprendizaje incremental "descripción -> categoría + tag" (purpose_category_stats),
// alimentado tanto por movimientos manuales como por la importación de CSV.
// Agrupa duplicados dentro del mismo llamado y hace un solo select + un solo
// upsert bulk, para no disparar una query por fila al importar un CSV grande.
async function recordPurposeCategoryStats(observations) {
  const withCategory = observations.filter((o) => o.categoryId)
  if (withCategory.length === 0) return

  const statKey = (purposeKey, categoryId, tag) => [purposeKey, categoryId, tag ?? ''].join('::')

  const grouped = {}
  for (const o of withCategory) {
    const key = statKey(o.purposeKey, o.categoryId, o.tag)
    if (!grouped[key]) grouped[key] = { purposeKey: o.purposeKey, categoryId: o.categoryId, tag: o.tag ?? null, count: 0 }
    grouped[key].count++
  }
  const groups = Object.values(grouped)
  const purposeKeys = [...new Set(groups.map((g) => g.purposeKey))]

  const { data: existing, error: fetchError } = await supabase
    .from('purpose_category_stats')
    .select('purpose_key, category_id, tag, confirm_count')
    .in('purpose_key', purposeKeys)
  if (fetchError) throw fetchError

  const existingCounts = {}
  for (const row of existing) existingCounts[statKey(row.purpose_key, row.category_id, row.tag)] = row.confirm_count

  const upsertRows = groups.map((g) => ({
    purpose_key: g.purposeKey,
    category_id: g.categoryId,
    tag: g.tag,
    confirm_count: (existingCounts[statKey(g.purposeKey, g.categoryId, g.tag)] ?? 0) + g.count,
    last_confirmed_at: new Date().toISOString(),
  }))
  const { error: upsertError } = await supabase
    .from('purpose_category_stats')
    .upsert(upsertRows, { onConflict: 'user_id,purpose_key,category_id,tag' })
  if (upsertError) throw upsertError
}

// Sugerencia de categoría+tag para una descripción, según lo aprendido en
// purpose_category_stats — nunca autoasigna, solo se usa para precargar un
// formulario de carga manual que el usuario revisa antes de guardar.
export async function suggestCategoryForPurpose(purpose) {
  const key = normalizePurpose(purpose)
  if (!key) return null
  const { data, error } = await supabase
    .from('purpose_category_stats')
    .select('category_id, tag, confirm_count')
    .eq('purpose_key', key)
    .order('confirm_count', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? { categoryId: data.category_id, tag: data.tag } : null
}

// Aprendizaje retroactivo, para correr una sola vez (o cuando se quiera
// reforzar): recorre todas las transacciones ya guardadas con categoría
// resuelta — de antes de que existiera este mecanismo — y las usa para
// poblar purpose_category_stats. Sin esto, una descripción repetida muchas
// veces en el historial (ej. "Cívica" -> Transporte/metro) no sugiere nada
// hasta que se vuelva a guardar manualmente o se reimporte su CSV.
export async function backfillPurposeCategoryStats() {
  const { data, error } = await supabase
    .from('transactions')
    .select('purpose, category_id, tags')
    .not('category_id', 'is', null)
  if (error) throw error

  const observations = data
    .filter((r) => !isIgnoredRow(r.tags))
    .map((r) => ({ purposeKey: normalizePurpose(r.purpose), categoryId: r.category_id, tag: r.tags?.[0] ?? null }))
  await recordPurposeCategoryStats(observations)
  return observations.length
}

// Descripciones recientes para mostrar como chips tocables en la carga
// rápida del día (Diario.jsx) — a diferencia de suggestCategoryForPurpose
// (que sugiere en silencio al perder el foco), esto es una lista visible
// para elegir de un toque. Trae las últimas 200 filas y deduplica client-side
// por descripción normalizada, conservando la ocurrencia más reciente (con
// mayúsculas reales, ya que purpose_category_stats solo guarda la versión en
// minúscula). Una sola consulta al montar la página, sin re-consultar por
// cada tecla que el usuario escriba.
export async function listRecentPurposes(limit = 40) {
  const { data, error } = await supabase
    .from('transactions')
    .select('purpose, category_id, tags, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const seen = new Set()
  const result = []
  for (const row of data) {
    if (!row.purpose?.trim()) continue
    const key = normalizePurpose(row.purpose)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ purpose: row.purpose, categoryId: row.category_id, tag: row.tags?.[0] ?? null })
    if (result.length >= limit) break
  }
  return result
}

// Conteo de uso por categoría (últimos 90 días, gastos no ignorados) para
// que Diario.jsx pueda mostrar las categorías más usadas primero en la
// grilla, en vez de forzar solo el orden alfabético fijo.
export async function listCategoryUsageCounts(daysBack = 90) {
  const start = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('transactions')
    .select('category_id, tags')
    .gte('occurred_at', start)
    .not('category_id', 'is', null)
  if (error) throw error

  const counts = {}
  for (const row of data) {
    if (isIgnoredRow(row.tags)) continue
    counts[row.category_id] = (counts[row.category_id] ?? 0) + 1
  }
  return counts
}

export async function createManualTransaction({ purpose, amount, occurredAt, categoryId, accountId, tags, currency }) {
  const { data, error } = await supabase.from('transactions').insert({
    monia_id: `manual-${generateLocalId()}`,
    occurred_at: occurredAt,
    purpose,
    amount,
    currency: currency || 'COP',
    category_id: categoryId || null,
    account_id: accountId || null,
    tags: tags ?? [],
    assignment_level: accountId ? 3 : null,
    assignment_confirmed: !!accountId,
    origin: 'manual',
  }).select().single()
  if (error) throw error
  if (categoryId) {
    await recordPurposeCategoryStats([{ purposeKey: normalizePurpose(purpose), categoryId, tag: tags?.[0] ?? null }])
  }
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

// Cola de "compras en divisa por confirmar": filas ya asignadas a una cuenta
// no-COP cuyo monto todavía es la estimación calculada al importar. No se
// scopea al mes activo (igual que listPendingTransactions): es una cola a
// drenar, no una vista del mes.
export async function listPendingCurrencyTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, categories(name), accounts(name, currency)')
    .eq('currency_pending', true)
    .order('occurred_at', { ascending: false })
  if (error) throw error
  return data
}

export async function countPendingCurrencyTransactions() {
  const { count, error } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('currency_pending', true)
  if (error) throw error
  return count ?? 0
}

// El usuario confirma el monto real en la moneda de la cuenta (el que MonIA no
// exportó). source_amount/source_currency se conservan: son la auditoría de qué
// dijo el CSV y con qué tasa implícita convirtió MonIA.
export async function confirmCurrencyAmount(transactionId, amount) {
  const { error } = await supabase
    .from('transactions')
    .update({ amount, currency_pending: false })
    .eq('id', transactionId)
  if (error) throw error
}

// Edición de tags de una transacción ya guardada (importada o manual) — la
// única forma de corregir/agregar tags hoy era re-importar el CSV con el tag
// ya puesto en MonIA. Aplica la misma normalización que el import para que un
// tag tipeado a mano matchee igual contra nombres de cuenta / IGNORED_TAGS.
export async function updateTransactionTags(id, tags) {
  const cleaned = [...new Set(tags.map(normalizeTag).filter(Boolean))]
  const { error } = await supabase.from('transactions').update({ tags: cleaned }).eq('id', id)
  if (error) throw error
}

// Edición genérica de una transacción ya guardada (usada por la fila
// editable de "Movimientos de hoy" en Diario.jsx) — a diferencia de
// updateTransactionTags, cubre monto/categoría/cuenta/descripción/tags
// juntos en un solo update. Cada campo es opcional: solo se manda al
// update el que venga definido, mismo patrón "passthrough" que
// categoriesApi.updateCategory.
export async function updateTransaction(id, { purpose, amount, categoryId, accountId, currency, tags } = {}) {
  const fields = {}
  if (purpose !== undefined) fields.purpose = purpose
  if (amount !== undefined) fields.amount = amount
  if (categoryId !== undefined) fields.category_id = categoryId || null
  if (accountId !== undefined) fields.account_id = accountId || null
  if (currency !== undefined) fields.currency = currency
  if (tags !== undefined) fields.tags = [...new Set(tags.map(normalizeTag).filter(Boolean))]
  const { data, error } = await supabase.from('transactions').update(fields).eq('id', id).select().single()
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

// Movimiento real por cuenta en el mes: `spent` (transacciones negativas, en
// positivo) e `income` (positivas). El gasto sirve para comparar cuánto se ha
// GASTADO de verdad contra lo asignado, sin confundirlo con el saldo (que sube
// apenas se transfiere/fondea la cuenta, no cuando se gasta); el ingreso sirve
// para ampliar el disponible de la cuenta cuando entra plata fuera del reparto
// mensual de la madre.
//
// Toma los objetos de cuenta (no ids) porque es currency-aware, igual que
// fetchBalancesForMonth: cada cuenta solo suma filas en su propia moneda, para
// no mezclar euros con pesos en un mismo total.
export async function getAccountFlowsForMonth(accounts, year, month) {
  if (accounts.length === 0) return { spent: {}, income: {} }
  const accountIds = accounts.map((a) => a.id)
  const pocketIndex = buildPocketIndex(accounts)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonthStart = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const { data, error } = await supabase
    .from('transactions')
    .select('account_id, amount, currency')
    .gte('occurred_at', monthStart)
    .lt('occurred_at', nextMonthStart)
    .in('account_id', accountIds)
  if (error) throw error

  const spent = {}
  const income = {}
  for (const row of data) {
    const key = resolvePocketKey(pocketIndex, row.account_id, row.currency)
    if (!key) continue
    const amount = Number(row.amount)
    if (amount < 0) spent[key] = (spent[key] ?? 0) + -amount
    else income[key] = (income[key] ?? 0) + amount
  }
  return { spent, income }
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

// Movimientos de un solo día (Diario.jsx, que se abre muchas veces al día
// específicamente para ver "hoy") — un rango de un día en vez de reusar
// listTransactionsForMonth filtrado client-side, para no traer el mes entero
// cada vez que se monta esta página. `dateStr` debe venir en el mismo
// formato/zona horaria que occurredAt al guardar (ver Diario.jsx: today()
// usa la fecha calendario en UTC, igual que QuickCaptureFAB), para que un
// movimiento recién guardado siempre caiga dentro del rango que se consulta.
export async function listTransactionsForDay(dateStr) {
  const start = dateStr
  const next = new Date(`${dateStr}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const end = next.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('transactions')
    .select('*, categories(name), accounts(name)')
    .gte('occurred_at', start).lt('occurred_at', end)
    .order('occurred_at', { ascending: false })
  if (error) throw error
  return data
}

// Rango de fechas liviano (sin joins) para agregados client-side, ej. la
// tendencia de los últimos N días en Diario.jsx — a diferencia de
// listTransactionsForDay/listTransactionsForMonth, que traen la fila
// completa con categories(name)/accounts(name) para listarla en una tabla.
export async function listTransactionsForRange(startDateStr, endDateStrExclusive) {
  const { data, error } = await supabase
    .from('transactions')
    .select('occurred_at, amount, currency, tags')
    .gte('occurred_at', startDateStr).lt('occurred_at', endDateStrExclusive)
    .order('occurred_at', { ascending: true })
  if (error) throw error
  return data
}

// Gastos (amount < 0) de los últimos monthsBack meses (incluyendo el actual),
// para detección de patrones — no incluye ingresos, que no aplican a "gasto
// fijo recurrente". Solo filas en COP: el detector promedia montos y
// FixedExpensesSection no tiene concepto de moneda, así que mezclar euros con
// pesos daría un promedio sin sentido (y una compra internacional un par de
// veces al año tampoco es candidata a gasto fijo mensual).
export async function listRecentExpenses(monthsBack) {
  const now = new Date()
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsBack + 1, 1))
  const startStr = start.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('transactions')
    .select('purpose, amount, occurred_at, account_id, tags, currency')
    .gte('occurred_at', startStr)
    .lt('amount', 0)
  if (error) throw error
  return data.filter((row) => !isIgnoredRow(row.tags) && (row.currency || 'COP') === 'COP')
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

// Tags más usados en el histórico reciente, para ofrecerlos como chips
// tocables en el buscador — a diferencia de un mockup con ejemplos fijos
// (#rappi, #supermercado…), esto sale de datos reales del usuario, nunca
// una lista inventada. Excluye IGNORED_TAGS (traslado/moneda/ignorar, que
// son marcadores del motor de asignación, no tags de verdad); excluir los
// que nombran una cuenta queda del lado del llamador, que ya tiene la lista
// de cuentas cargada (mismo criterio que accountNameTags en GastosDiarios.jsx).
export async function listTopTags(limit = 8) {
  const { data, error } = await supabase
    .from('transactions')
    .select('tags')
    .order('occurred_at', { ascending: false })
    .limit(500)
  if (error) throw error

  const counts = {}
  for (const row of data) {
    for (const tag of row.tags ?? []) {
      if (IGNORED_TAGS.includes(tag)) continue
      counts[tag] = (counts[tag] ?? 0) + 1
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t)
}

// Agrupa gastos por descripción (purpose, normalizado) y sugiere como
// candidato a gasto fijo cualquier grupo que aparezca en al menos
// minMonths meses distintos y que no coincida ya con un gasto fijo activo.
export function detectRecurringCandidates(expenses, existingFixedNames, minMonths = 3) {
  const groups = {}
  for (const t of expenses) {
    const key = normalizePurpose(t.purpose)
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }

  const candidates = []
  for (const txs of Object.values(groups)) {
    const key = normalizePurpose(txs[0].purpose)
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
    .select('id, purpose, amount, occurred_at, currency')
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
