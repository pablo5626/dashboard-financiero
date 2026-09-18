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
//
// `accountId`/`linkedTransactionId` son opcionales y solo aplican a metas
// 'puntual' — MetasAhorro.jsx ya creó la transacción real (si el usuario
// eligió cuenta de origen) antes de llamar acá, mismo orden que
// debtsApi.addAbono. Para 'proposito' nunca se pasan, por la razón de arriba
// (evitar el doble conteo).
export async function addContribution(goal, { amount, contributedAt, note, accountId, linkedTransactionId }) {
  const { error: e1 } = await supabase.from('savings_contributions').insert({
    savings_goal_id: goal.id,
    amount,
    contributed_at: contributedAt || undefined,
    note: note || null,
    account_id: accountId || null,
    linked_transaction_id: linkedTransactionId || null,
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

// Borra un aporte del historial. Para metas 'puntual', current_amount es la
// suma de los aportes (ver nota en addContribution) — hay que descontarlo ahí
// también para no dejar el avance desincronizado del historial. Si el aporte
// tenía una cuenta de origen, también borra la transacción real vinculada
// (mismo patrón que deleteAbono en debtsApi.js) para que el saldo de esa
// cuenta no quede inflado por un aporte que ya no existe.
export async function deleteContribution(goal, contribution) {
  const { error: e1 } = await supabase.from('savings_contributions').delete().eq('id', contribution.id)
  if (e1) throw e1

  if (contribution.linked_transaction_id) {
    const { error: e2 } = await supabase.from('transactions').delete().eq('id', contribution.linked_transaction_id)
    if (e2) throw e2
  }

  if (goal.kind === 'puntual') {
    const { error: e3 } = await supabase
      .from('savings_goals')
      .update({ current_amount: Number(goal.current_amount) - Number(contribution.amount) })
      .eq('id', goal.id)
    if (e3) throw e3
  }
}
