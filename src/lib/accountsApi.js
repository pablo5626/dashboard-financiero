import { supabase } from './supabaseClient.js'

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
  return data
}

export async function createAccount({ name, kind, parentAccountId, currency = 'COP' }) {
  const { data, error } = await supabase
    .from('accounts')
    .insert({ name, kind, parent_account_id: parentAccountId ?? null, currency })
    .select()
    .single()
  if (error) throw error
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

export async function getMonthlyInitialBalances(accountIds, year, month) {
  if (accountIds.length === 0) return {}
  const { data, error } = await supabase
    .from('monthly_initial_balances')
    .select('account_id, initial_balance, currency, source')
    .eq('year', year)
    .eq('month', month)
    .in('account_id', accountIds)
  if (error) throw error
  return Object.fromEntries(data.map((r) => [r.account_id, r]))
}

export async function saveMonthlyInitialBalances(rows, year, month) {
  const payload = rows.map(({ accountId, amount, currency }) => ({
    account_id: accountId, year, month, initial_balance: amount, currency, source: 'manual',
  }))
  const { error } = await supabase
    .from('monthly_initial_balances')
    .upsert(payload, { onConflict: 'user_id,account_id,year,month' })
  if (error) throw error
}

// Saldo del mes = saldo inicial del mes + transferencias netas + suma de
// transacciones del mes — cada cuenta solo suma filas en su propia moneda
// (currency de la cuenta, default 'COP'), para no mezclar unidades cuando
// existan cuentas en distinta moneda (ej. una cuenta USD).
export async function fetchBalancesForMonth(accounts, year, month) {
  if (accounts.length === 0) return {}

  const accountIds = accounts.map((a) => a.id)
  const currencyByAccountId = Object.fromEntries(accounts.map((a) => [a.id, a.currency || 'COP']))

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonthStart = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const [{ data: initialBalances, error: e1 }, { data: transfers, error: e2 }, { data: transactions, error: e3 }, { data: allocations, error: e4 }] =
    await Promise.all([
      supabase.from('monthly_initial_balances').select('account_id, initial_balance, currency').eq('year', year).eq('month', month).in('account_id', accountIds),
      supabase.from('account_transfers').select('from_account_id, to_account_id, amount, currency, to_amount, to_currency').gte('transfer_date', monthStart).lt('transfer_date', nextMonthStart),
      supabase.from('transactions').select('account_id, amount, currency').gte('occurred_at', monthStart).lt('occurred_at', nextMonthStart).in('account_id', accountIds),
      supabase.from('account_allocations').select('account_id, allocated_amount, currency').eq('year', year).eq('month', month).in('account_id', accountIds),
    ])
  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3
  if (e4) throw e4

  const balances = Object.fromEntries(accountIds.map((id) => [id, 0]))
  const allocated = Object.fromEntries(accountIds.map((id) => [id, null]))

  const matches = (accountId, currency) => (currency || 'COP') === currencyByAccountId[accountId]

  for (const row of initialBalances) {
    if (matches(row.account_id, row.currency)) balances[row.account_id] += Number(row.initial_balance)
  }
  for (const row of transactions) {
    if (matches(row.account_id, row.currency)) balances[row.account_id] += Number(row.amount)
  }
  for (const row of transfers) {
    // to_amount/to_currency solo existen en transferencias que cruzan de
    // moneda (ej. hija COP -> arq USD); en el resto caen al mismo
    // amount/currency de siempre.
    const toCurrency = row.to_currency ?? row.currency
    const toAmount = row.to_amount ?? row.amount
    if (row.to_account_id && row.to_account_id in balances && matches(row.to_account_id, toCurrency)) {
      balances[row.to_account_id] += Number(toAmount)
    }
    if (row.from_account_id && row.from_account_id in balances && matches(row.from_account_id, row.currency)) {
      balances[row.from_account_id] -= Number(row.amount)
    }
  }
  for (const row of allocations) {
    if (matches(row.account_id, row.currency)) allocated[row.account_id] = Number(row.allocated_amount)
  }

  return { balances, allocated }
}
