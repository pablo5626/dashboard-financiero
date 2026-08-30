import { supabase } from './supabaseClient.js'

export async function listFixedExpenses() {
  const { data, error } = await supabase
    .from('fixed_expenses')
    .select('*, accounts(name)')
    .eq('is_active', true)
    .order('due_day', { ascending: true })
  if (error) throw error
  return data
}

export async function createFixedExpense({ name, amount, dueDay, frequency, accountId }) {
  const { error } = await supabase.from('fixed_expenses').insert({
    name, amount, due_day: dueDay, frequency, account_id: accountId ?? null,
  })
  if (error) throw error
}

export async function updateFixedExpense(id, fields) {
  const { error } = await supabase.from('fixed_expenses').update(fields).eq('id', id)
  if (error) throw error
}

export async function archiveFixedExpense(id) {
  const { error } = await supabase.from('fixed_expenses').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function getMonthStatuses(fixedExpenseIds, year, month) {
  if (fixedExpenseIds.length === 0) return {}
  const { data, error } = await supabase
    .from('fixed_expense_month_status')
    .select('fixed_expense_id, paid, included, amount_override')
    .eq('year', year)
    .eq('month', month)
    .in('fixed_expense_id', fixedExpenseIds)
  if (error) throw error
  return Object.fromEntries(data.map((row) => [row.fixed_expense_id, row]))
}

export async function setPaidStatus(fixedExpenseId, year, month, paid) {
  const { error } = await supabase.from('fixed_expense_month_status').upsert(
    { fixed_expense_id: fixedExpenseId, year, month, paid, paid_at: paid ? new Date().toISOString() : null, included: true },
    { onConflict: 'user_id,fixed_expense_id,year,month' }
  )
  if (error) throw error
}
