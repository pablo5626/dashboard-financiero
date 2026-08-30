import { supabase } from './supabaseClient.js'

export async function createTransfers(rows) {
  const payload = rows.map(({ fromAccountId, toAccountId, amount, currency, transferDate, note }) => ({
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount,
    currency: currency || 'COP',
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
    .select('id, from_account_id, to_account_id, amount, currency, transfer_date, note')
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
