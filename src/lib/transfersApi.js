import { supabase } from './supabaseClient.js'
import { buildPocketIndex, resolvePocketKey } from './currencyPockets.js'

// Plata que salió de cada cuenta por transferencia en el set de filas dado.
// Una transferencia no es un gasto a nivel consolidado (mover plata no la
// consume, el Panel la ignora), pero desde el presupuesto de la cuenta de
// origen sí es plata que se fue: si Dale le pasa $333.500 a arq y ahí se
// ejecuta la compra, el presupuesto de Dale está usado aunque el gasto figure
// en arq. Por eso alimenta el "% usado", no el gasto.
//
// Excluye las que vuelven a la cuenta madre (devolver plata sobrante no es
// usar el presupuesto) y las que el usuario marcó como `consumes_budget =
// false` al crearlas, o sea puro reacomodo entre bolsillos. Resuelve la
// misma clave "plana vs. accountId:currency" que fetchBalancesForMonth (ver
// currencyPockets.js), para que la plata que sale del bolsillo EUR de una
// cuenta multi-moneda consuma el "% usado" de ESE bolsillo, no del primario.
export function sumOutgoingByAccount(transfers, accounts) {
  const madreId = accounts.find((a) => a.kind === 'madre')?.id
  const pocketIndex = buildPocketIndex(accounts)

  const outgoing = {}
  for (const row of transfers) {
    if (!row.from_account_id || row.to_account_id === madreId) continue
    if (row.consumes_budget === false) continue
    const key = resolvePocketKey(pocketIndex, row.from_account_id, row.currency)
    if (!key) continue
    outgoing[key] = (outgoing[key] ?? 0) + Number(row.amount)
  }
  return outgoing
}

function toTransferRow({ fromAccountId, toAccountId, amount, currency, toAmount, toCurrency, transferDate, note, consumesBudget, idempotencyKey }) {
  return {
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount,
    currency: currency || 'COP',
    to_amount: toAmount ?? null,
    to_currency: toCurrency ?? null,
    consumes_budget: consumesBudget ?? true,
    transfer_date: transferDate,
    note: note ?? null,
    idempotency_key: idempotencyKey ?? null,
  }
}

export async function createTransfers(rows) {
  const payload = rows.map(toTransferRow)
  const { error } = await supabase.from('account_transfers').insert(payload)
  if (error) throw error
}

// Clave determinística madre+hija+año+mes — reintentar "Confirmar
// transferencia real" (doble click, red lenta, dos pestañas) siempre
// construye la misma clave, así que el unique(user_id, idempotency_key) de
// la base absorbe el duplicado en silencio en vez de crear una segunda fila
// real, igual que el Shortcut de "Transferencia rápida".
export function buildMonthlyAllocationKey(madreId, hijaId, year, month) {
  return `monthly_allocation:${madreId}:${hijaId}:${year}-${String(month).padStart(2, '0')}`
}

export async function createTransfersIgnoringDuplicates(rows) {
  const payload = rows.map(toTransferRow)
  const { error } = await supabase.from('account_transfers')
    .upsert(payload, { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true })
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
    .select('id, from_account_id, to_account_id, amount, currency, to_amount, to_currency, consumes_budget, transfer_date, note, idempotency_key')
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

export async function updateConsumesBudget(id, consumesBudget) {
  const { error } = await supabase.from('account_transfers').update({ consumes_budget: consumesBudget }).eq('id', id)
  if (error) throw error
}
