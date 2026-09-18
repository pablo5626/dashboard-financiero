import { supabase } from './supabaseClient.js'
import { sumOutgoingByAccount } from './transfersApi.js'
import { buildPocketIndex, resolvePocketKey, pocketKeyFor } from './currencyPockets.js'

export async function listAccounts() {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('is_active', true)
    .order('kind', { ascending: false }) // 'madre' antes que 'hija'
    .order('sort_order', { ascending: true })
    // Todas las cuentas comparten sort_order = 0 (no hay UI para reordenarlas
    // todavía), así que sin un desempate determinista Postgres no garantiza
    // el mismo orden entre consultas — la lista podía reordenarse solo al
    // recargar, haciendo parecer que un valor editado en una fila terminó
    // afectando la fila de abajo cuando en realidad cada guardado sí fue a
    // la cuenta correcta, solo que su posición visual había cambiado.
    .order('created_at', { ascending: true })
  if (error) throw error

  // Cuentas multi-moneda traen además sus bolsillos adicionales (ver
  // currencyPockets.js) como account.extraCurrencies = [{ currency, tag }].
  const multiIds = data.filter((a) => a.is_multi_currency).map((a) => a.id)
  if (multiIds.length === 0) return data.map((a) => ({ ...a, extraCurrencies: [] }))

  const { data: extras, error: e2 } = await supabase
    .from('account_currencies')
    .select('account_id, currency, tag')
    .in('account_id', multiIds)
  if (e2) throw e2
  const extrasByAccount = {}
  for (const row of extras) (extrasByAccount[row.account_id] ??= []).push({ currency: row.currency, tag: row.tag })
  return data.map((a) => ({ ...a, extraCurrencies: extrasByAccount[a.id] ?? [] }))
}

// `extraCurrencies`: [{ currency, tag?, initialBalance? }] — solo se usa
// cuando isMultiCurrency es true. `tag` por defecto es "<nombre> <moneda>" en
// minúsculas (ej. "arq eur"), el mismo formato que MonIA necesita normalizar
// desde "arq_eur" — ver normalizeTag en transactionsApi.js. Si viene
// initialBalance, se siembra de una vez el saldo inicial del mes en curso
// para ese bolsillo, para que crear la cuenta ya dé de alta "cuánto tiene
// cada moneda" sin un paso aparte en Saldos iniciales.
export async function createAccount({ name, kind, parentAccountId, currency = 'COP', isMultiCurrency = false, extraCurrencies = [] }) {
  const { data, error } = await supabase
    .from('accounts')
    .insert({ name, kind, parent_account_id: parentAccountId ?? null, currency, is_multi_currency: isMultiCurrency })
    .select()
    .single()
  if (error) throw error

  if (isMultiCurrency && extraCurrencies.length > 0) {
    const rows = extraCurrencies.map((c) => ({
      account_id: data.id,
      currency: c.currency,
      tag: (c.tag || `${name} ${c.currency}`).trim().toLowerCase(),
    }))
    const { error: e2 } = await supabase.from('account_currencies').insert(rows)
    if (e2) throw e2

    const now = new Date()
    const balanceRows = extraCurrencies
      .filter((c) => c.initialBalance != null && c.initialBalance !== '')
      .map((c) => ({
        account_id: data.id, year: now.getFullYear(), month: now.getMonth() + 1,
        initial_balance: Number(c.initialBalance) || 0, currency: c.currency, source: 'manual',
      }))
    if (balanceRows.length > 0) {
      const { error: e3 } = await supabase.from('monthly_initial_balances').upsert(balanceRows, { onConflict: 'user_id,account_id,year,month,currency' })
      if (e3) throw e3
    }
  }
  return data
}

export async function updateAccount(id, fields) {
  const { error } = await supabase.from('accounts').update(fields).eq('id', id)
  if (error) throw error
}

export async function archiveAccount(id) {
  const { error } = await supabase.from('accounts').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

// Agrega un bolsillo de moneda nuevo a una cuenta ya marcada is_multi_currency
// (o la marca como tal si todavía no lo estaba).
export async function addAccountCurrency(accountId, currency, tag) {
  const { error: e1 } = await supabase.from('accounts').update({ is_multi_currency: true }).eq('id', accountId)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('account_currencies').insert({ account_id: accountId, currency, tag: tag.trim().toLowerCase() })
  if (e2) throw e2
}

export async function updateAccountCurrencyTag(accountId, currency, tag) {
  const { error } = await supabase.from('account_currencies').update({ tag: tag.trim().toLowerCase() }).eq('account_id', accountId).eq('currency', currency)
  if (error) throw error
}

// Quita un bolsillo — no borra el historial de transacciones/transferencias
// ya guardado en esa moneda contra esta cuenta, solo deja de ofrecerse como
// destino nuevo y de reconocerse su tag en el motor de asignación.
export async function removeAccountCurrency(accountId, currency) {
  const { error } = await supabase.from('account_currencies').delete().eq('account_id', accountId).eq('currency', currency)
  if (error) throw error
}

// Recibe cuentas completas (con extraCurrencies) porque una fila de
// monthly_initial_balances de una cuenta multi-moneda solo se identifica de
// verdad por (account_id, currency) — ver buildPocketIndex.
export async function getMonthlyInitialBalances(accounts, year, month) {
  const accountIds = accounts.map((a) => a.id)
  if (accountIds.length === 0) return {}
  const { data, error } = await supabase
    .from('monthly_initial_balances')
    .select('account_id, initial_balance, currency, source')
    .eq('year', year)
    .eq('month', month)
    .in('account_id', accountIds)
  if (error) throw error
  const index = buildPocketIndex(accounts)
  const byPocket = {}
  for (const r of data) {
    const key = resolvePocketKey(index, r.account_id, r.currency)
    if (key) byPocket[key] = r
  }
  return byPocket
}

export async function saveMonthlyInitialBalances(rows, year, month) {
  const payload = rows.map(({ accountId, amount, currency }) => ({
    account_id: accountId, year, month, initial_balance: amount, currency, source: 'manual',
  }))
  const { error } = await supabase
    .from('monthly_initial_balances')
    .upsert(payload, { onConflict: 'user_id,account_id,year,month,currency' })
  if (error) throw error
}

// Saldo del mes = saldo inicial del mes + transferencias netas + suma de
// transacciones del mes — cada BOLSILLO (cuenta normal, o cada moneda de una
// cuenta multi-moneda) solo suma filas en su propia moneda, para no mezclar
// unidades cuando existan cuentas en distinta moneda (ej. una cuenta USD) o
// varios bolsillos bajo la misma cuenta (ej. arq USD + arq EUR). La moneda
// primaria de cada cuenta se sigue devolviendo con la clave "plana"
// (balances[accountId]), compatible con todo el código anterior a esto; cada
// moneda adicional se devuelve además con la clave compuesta
// "accountId:currency" — ver currencyPockets.js.
export async function fetchBalancesForMonth(accounts, year, month) {
  if (accounts.length === 0) return { balances: {}, allocated: {}, transferredOut: {} }

  const accountIds = accounts.map((a) => a.id)
  const pocketIndex = buildPocketIndex(accounts)
  const pocketKeys = accounts.flatMap((a) => [a.id, ...(a.extraCurrencies ?? []).map((c) => pocketKeyFor(a.id, c.currency))])

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonthStart = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const [{ data: initialBalances, error: e1 }, { data: transfers, error: e2 }, { data: transactions, error: e3 }, { data: allocations, error: e4 }] =
    await Promise.all([
      supabase.from('monthly_initial_balances').select('account_id, initial_balance, currency').eq('year', year).eq('month', month).in('account_id', accountIds),
      supabase.from('account_transfers').select('from_account_id, to_account_id, amount, currency, to_amount, to_currency, consumes_budget').gte('transfer_date', monthStart).lt('transfer_date', nextMonthStart),
      supabase.from('transactions').select('account_id, amount, currency').gte('occurred_at', monthStart).lt('occurred_at', nextMonthStart).in('account_id', accountIds),
      supabase.from('account_allocations').select('account_id, allocated_amount, currency').eq('year', year).eq('month', month).in('account_id', accountIds),
    ])
  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3
  if (e4) throw e4

  const balances = Object.fromEntries(pocketKeys.map((k) => [k, 0]))
  const allocated = Object.fromEntries(pocketKeys.map((k) => [k, null]))

  const keyFor = (accountId, currency) => resolvePocketKey(pocketIndex, accountId, currency)

  for (const row of initialBalances) {
    const key = keyFor(row.account_id, row.currency)
    if (key) balances[key] += Number(row.initial_balance)
  }
  for (const row of transactions) {
    const key = keyFor(row.account_id, row.currency)
    if (key) balances[key] += Number(row.amount)
  }
  for (const row of transfers) {
    // to_amount/to_currency solo existen en transferencias que cruzan de
    // moneda (ej. hija COP -> arq USD, o arq USD -> arq EUR entre sus propios
    // bolsillos); en el resto caen al mismo amount/currency de siempre.
    const toCurrency = row.to_currency ?? row.currency
    const toAmount = row.to_amount ?? row.amount
    const toKey = row.to_account_id ? keyFor(row.to_account_id, toCurrency) : null
    if (toKey) balances[toKey] += Number(toAmount)
    const fromKey = row.from_account_id ? keyFor(row.from_account_id, row.currency) : null
    if (fromKey) balances[fromKey] -= Number(row.amount)
  }
  for (const row of allocations) {
    const key = keyFor(row.account_id, row.currency)
    if (key) allocated[key] = Number(row.allocated_amount)
  }

  // Reusa las mismas filas de transferencias ya traídas arriba: la plata que
  // salió de cada cuenta alimenta su "% usado" (ver sumOutgoingByAccount).
  return { balances, allocated, transferredOut: sumOutgoingByAccount(transfers, accounts) }
}

// Saldo total de una cuenta convertido a COP — para una cuenta multi-moneda
// suma TODOS sus bolsillos (primario + extraCurrencies), cada uno convertido
// con su propia tasa, en vez de solo el primario. Usado por los totales
// consolidados (Panel General, Deudas) que antes solo leían balances[a.id].
export function totalBalanceInCOP(account, balances, rates, toCOP) {
  let total = toCOP(balances[account.id] ?? 0, account.currency || 'COP', rates)
  for (const extra of account.extraCurrencies ?? []) {
    total += toCOP(balances[pocketKeyFor(account.id, extra.currency)] ?? 0, extra.currency, rates)
  }
  return total
}
