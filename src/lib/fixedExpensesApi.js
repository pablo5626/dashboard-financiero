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

export async function createFixedExpense({ name, amount, dueDay, frequency, accountId, currency }) {
  const { error } = await supabase.from('fixed_expenses').insert({
    name, amount, due_day: dueDay, frequency, account_id: accountId ?? null, currency: currency || 'COP',
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

// Vencimientos próximos/atrasados del mes en curso, ya filtrados y con el id
// real del gasto fijo — a diferencia de panelApi.fetchAlerts (que arma un id
// compuesto `fx-${id}` solo para su propio href de alerta), esto es lo que
// necesita la tarjeta "Próximos pagos" de PanelGeneral.jsx para poder llamar
// setPaidStatus directo sin parsear un string.
export async function listUpcomingFixedExpenses(year, month, dueSoonDays) {
  const { data: fixedExpenses, error: e1 } = await supabase
    .from('fixed_expenses').select('id, name, amount, due_day, currency').eq('is_active', true)
  if (e1) throw e1

  const fixedIds = fixedExpenses.map((f) => f.id)
  const { data: statuses, error: e2 } = fixedIds.length
    ? await supabase.from('fixed_expense_month_status').select('fixed_expense_id, paid').eq('year', year).eq('month', month).in('fixed_expense_id', fixedIds)
    : { data: [], error: null }
  if (e2) throw e2
  const paidMap = Object.fromEntries(statuses.map((s) => [s.fixed_expense_id, s.paid]))

  const dayOfMonth = new Date().getDate()
  return fixedExpenses
    .filter((f) => !paidMap[f.id] && f.due_day - dayOfMonth <= dueSoonDays)
    .map((f) => ({ ...f, daysUntil: f.due_day - dayOfMonth }))
    .sort((a, b) => a.daysUntil - b.daysUntil)
}
