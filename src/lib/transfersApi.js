import { supabase } from './supabaseClient.js'

// Plata que salió de cada cuenta por transferencia en el set de filas dado.
// Una transferencia no es un gasto a nivel consolidado (mover plata no la
// consume, el Panel la ignora), pero desde el presupuesto de la cuenta de
// origen sí es plata que se fue: si Dale le pasa $333.500 a arq y ahí se
// ejecuta la compra, el presupuesto de Dale está usado aunque el gasto figure
// en arq. Por eso alimenta el "% usado", no el gasto.
//
// Excluye las que vuelven a la cuenta madre (devolver plata sobrante no es
// usar el presupuesto) y las que el usuario marcó como `consumes_budget =
// false` al crearlas, o sea puro reacomodo entre bolsillos. Y solo cuenta la
// fila si su moneda coincide con la de la cuenta de origen, igual que el resto
// de las vistas por cuenta.
export function sumOutgoingByAccount(transfers, accounts) {
  const madreId = accounts.find((a) => a.kind === 'madre')?.id
  const currencyByAccountId = Object.fromEntries(accounts.map((a) => [a.id, a.currency || 'COP']))

  const outgoing = {}
  for (const row of transfers) {
    if (!row.from_account_id || row.to_account_id === madreId) continue
    if (row.consumes_budget === false) continue
    if ((row.currency || 'COP') !== currencyByAccountId[row.from_account_id]) continue
    outgoing[row.from_account_id] = (outgoing[row.from_account_id] ?? 0) + Number(row.amount)
  }
  return outgoing
}

export async function createTransfers(rows) {
  const payload = rows.map(({ fromAccountId, toAccountId, amount, currency, toAmount, toCurrency, transferDate, note, consumesBudget }) => ({
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount,
    currency: currency || 'COP',
    to_amount: toAmount ?? null,
    to_currency: toCurrency ?? null,
    consumes_budget: consumesBudget ?? true,
    transfer_date: transferDate,
    note: note ?? null,
  }))
  const { error } = await supabase.from('account_transfers').insert(payload)
  if (error) throw error
}

export async function getTransfersForMonth(accountIds, year, month) {
  if (accountIds.length === 0) return []
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonthStart = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const ids = accountIds.join(',')
  const { data, error } = await supabase
    .from('account_transfers')
    .select('id, from_account_id, to_account_id, amount, currency, to_amount, to_currency, consumes_budget, transfer_date, note')
    .gte('transfer_date', monthStart)
    .lt('transfer_date', nextMonthStart)
    .or(`from_account_id.in.(${ids}),to_account_id.in.(${ids})`)
    .order('transfer_date', { ascending: false })
  if (error) throw error
  return data
}

export async function deleteTransfer(id) {
  const { error } = await supabase.from('account_transfers').delete().eq('id', id)
  if (error) throw error
}
