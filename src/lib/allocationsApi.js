import { supabase } from './supabaseClient.js'

export async function getAllocationsForMonth(accountIds, year, month) {
  if (accountIds.length === 0) return {}
  const { data, error } = await supabase
    .from('account_allocations')
    .select('account_id, allocated_amount')
    .eq('year', year)
    .eq('month', month)
    .in('account_id', accountIds)
  if (error) throw error
  return Object.fromEntries(data.map((r) => [r.account_id, Number(r.allocated_amount)]))
}

export async function saveAllocations(rows, year, month) {
  const payload = rows.map(({ accountId, amount }) => ({
    account_id: accountId, year, month, allocated_amount: amount,
  }))
  const { error } = await supabase
    .from('account_allocations')
    .upsert(payload, { onConflict: 'user_id,account_id,year,month' })
  if (error) throw error
}

export function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}
