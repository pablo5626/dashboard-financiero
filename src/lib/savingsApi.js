import { supabase } from './supabaseClient.js'

export async function listSavingsGoals() {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*, accounts(name)')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createSavingsGoal({ kind, name, accountId, targetAmount, targetDate }) {
  const { data, error } = await supabase.from('savings_goals').insert({
    kind,
    name,
    account_id: kind === 'proposito' ? (accountId ?? null) : null,
    target_amount: targetAmount ?? null,
    target_date: targetDate || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateSavingsGoal(id, fields) {
  const { error } = await supabase.from('savings_goals').update(fields).eq('id', id)
  if (error) throw error
}

export async function archiveSavingsGoal(id) {
  const { error } = await supabase.from('savings_goals').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function listContributions(goalIds) {
  if (goalIds.length === 0) return []
  const { data, error } = await supabase
    .from('savings_contributions')
    .select('*')
    .in('savings_goal_id', goalIds)
    .order('contributed_at', { ascending: true })
  if (error) throw error
  return data
}

// Registra un aporte en el historial de la meta. Para metas 'puntual',
// current_amount ES la suma de sus aportes (fuente de verdad del avance),
// así que se incrementa aquí. Para metas 'proposito' el avance real viene
// del saldo de la cuenta vinculada (ver fetchMonthlyTrend en panelApi.js) —
// el aporte solo queda como anotación en el historial, sin tocar
// current_amount, para no crear una segunda fuente de verdad del saldo.
export async function addContribution(goal, { amount, contributedAt, note }) {
  const { error: e1 } = await supabase.from('savings_contributions').insert({
    savings_goal_id: goal.id,
    amount,
    contributed_at: contributedAt || undefined,
    note: note || null,
  })
  if (e1) throw e1

  if (goal.kind === 'puntual') {
    const { error: e2 } = await supabase
      .from('savings_goals')
      .update({ current_amount: Number(goal.current_amount) + Number(amount) })
      .eq('id', goal.id)
    if (e2) throw e2
  }
}
