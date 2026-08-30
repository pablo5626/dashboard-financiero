import { supabase } from './supabaseClient.js'

export async function listDebts() {
  const { data, error } = await supabase.from('debts').select('*').eq('is_active', true).order('creditor_name')
  if (error) throw error
  return data
}

export async function createDebt({ creditorName, totalAmount, remainingAmount, interestRate, monthlyPayment, termMonths, startDate }) {
  const { data, error } = await supabase.from('debts').insert({
    creditor_name: creditorName,
    total_amount: totalAmount,
    remaining_amount: remainingAmount,
    interest_rate: interestRate ?? null,
    monthly_payment: monthlyPayment ?? null,
    term_months: termMonths ?? null,
    start_date: startDate || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateDebt(id, fields) {
  const { error } = await supabase.from('debts').update(fields).eq('id', id)
  if (error) throw error
}

export async function archiveDebt(id) {
  const { error } = await supabase.from('debts').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function listInstallments(debtIds) {
  if (debtIds.length === 0) return []
  const { data, error } = await supabase
    .from('debt_installments')
    .select('*')
    .in('debt_id', debtIds)
    .order('due_date', { ascending: true })
  if (error) throw error
  return data
}

export async function createInstallment(debtId, dueDate, amount) {
  const { error } = await supabase.from('debt_installments').insert({ debt_id: debtId, due_date: dueDate, amount })
  if (error) throw error
}

export async function createInstallmentsBulk(debtId, rows) {
  const payload = rows.map((r) => ({ debt_id: debtId, due_date: r.dueDate, amount: r.amount }))
  const { error } = await supabase.from('debt_installments').insert(payload)
  if (error) throw error
}

// Cronograma de amortización, sistema francés (cuota fija): cada cuota es
// igual, pero la proporción interés/capital cambia mes a mes según el saldo
// restante. `monthlyRatePercent` es la tasa mensual (ej. 1.5 = 1.5%/mes),
// consistente con interest_rate en el esquema. El redondeo de cada cuota es
// a peso entero; la última cuota absorbe el residuo de redondeo para que la
// suma de capital pagado cuadre exactamente con `principal`.
export function generateAmortizationSchedule(principal, monthlyRatePercent, termMonths, startDate) {
  const r = Number(monthlyRatePercent) / 100
  const n = Number(termMonths)
  const rawPayment = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n))

  const rows = []
  let balance = Number(principal)
  const start = new Date(startDate || new Date())

  for (let i = 1; i <= n; i++) {
    const interestPortion = balance * r
    let principalPortion = rawPayment - interestPortion
    if (i === n) principalPortion = balance // absorbe el residuo de redondeo en la última cuota
    balance -= principalPortion

    const dueDate = new Date(start)
    dueDate.setMonth(dueDate.getMonth() + i)

    rows.push({
      dueDate: dueDate.toISOString().slice(0, 10),
      amount: Math.round(interestPortion + principalPortion),
    })
  }
  return rows
}

export async function deleteInstallment(id) {
  const { error } = await supabase.from('debt_installments').delete().eq('id', id)
  if (error) throw error
}

// Borra solo las cuotas no pagadas de una deuda, para poder regenerar el
// cronograma (ej. cambió la tasa o el plazo) sin tocar el historial de
// cuotas ya pagadas.
export async function deleteUnpaidInstallments(debtId) {
  const { error } = await supabase.from('debt_installments').delete().eq('debt_id', debtId).eq('paid', false)
  if (error) throw error
}

// Marca la cuota pagada/pendiente y ajusta remaining_amount de la deuda en
// consecuencia (resta el monto al marcar pagada, lo repone si se desmarca)
// para no tener que actualizar cuota y saldo restante por separado. También
// aplica el mismo delta a schedule_synced_remaining_amount (si ya hay un
// cronograma generado) para que pagar cuotas por esta vía nunca desincronice
// el cronograma — solo editar remaining_amount a mano (fuera de esta
// función) genera drift, que es la señal que usa la reconciliación.
export async function toggleInstallmentPaid(installment, debt) {
  const nowPaid = !installment.paid
  const { error: e1 } = await supabase.from('debt_installments').update({
    paid: nowPaid, paid_at: nowPaid ? new Date().toISOString() : null,
  }).eq('id', installment.id)
  if (e1) throw e1

  const delta = nowPaid ? -Number(installment.amount) : Number(installment.amount)
  const newRemaining = Math.max(0, Number(debt.remaining_amount) + delta)
  const fields = { remaining_amount: newRemaining }
  const hasSchedule = debt.schedule_synced_remaining_amount != null
  if (hasSchedule) fields.schedule_synced_remaining_amount = Math.max(0, Number(debt.schedule_synced_remaining_amount) + delta)

  const { error: e2 } = await supabase.from('debts').update(fields).eq('id', installment.debt_id)
  if (e2) throw e2
  return {
    remainingAmount: newRemaining,
    scheduleSyncedRemainingAmount: hasSchedule ? fields.schedule_synced_remaining_amount : null,
  }
}
