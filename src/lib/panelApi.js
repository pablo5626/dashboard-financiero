import { supabase } from './supabaseClient.js'
import { countPendingTransactions } from './transactionsApi.js'
import { getRates, toCOP } from './exchangeRatesApi.js'

// Devuelve los últimos n meses (incluyendo year/month) ordenados de más
// antiguo a más reciente, como [{ year, month }, ...].
export function lastNMonths(year, month, n) {
  const months = []
  let y = year
  let m = month
  for (let i = 0; i < n; i++) {
    months.unshift({ year: y, month: m })
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return months
}

// Para cada mes del rango: saldo total (misma fórmula que fetchBalancesForMonth,
// sumada entre accountIds), ingresos y gastos del mes. Ingresos/gastos se
// calculan sobre TODAS las transacciones del usuario en ese rango de fechas
// (estén o no asignadas a una cuenta todavía) porque reflejan flujo de dinero
// real, no el estado de asignación del motor de cuentas.
//
// convertToCOP (default true) convierte cada monto no-COP a COP con la tasa
// vigente antes de sumarlo, para que balanceTotal/ingresos/gastos sean un
// solo número consolidado — usado por Panel General. Pasar `false` cuando
// el llamador quiere el trend en la moneda nativa de la cuenta (ej. una
// meta de ahorro ligada a una cuenta en USD no debe convertirse a COP).
export async function fetchMonthlyTrend(accountIds, months, { convertToCOP = true } = {}) {
  if (months.length === 0) return []

  const first = months[0]
  const last = months[months.length - 1]
  const rangeStart = `${first.year}-${String(first.month).padStart(2, '0')}-01`
  const afterLast = last.month === 12 ? { year: last.year + 1, month: 1 } : { year: last.year, month: last.month + 1 }
  const rangeEnd = `${afterLast.year}-${String(afterLast.month).padStart(2, '0')}-01`

  const [{ data: initialBalances, error: e1 }, { data: transfers, error: e2 }, { data: transactions, error: e3 }, rates] =
    await Promise.all([
      supabase.from('monthly_initial_balances').select('account_id, year, month, initial_balance, currency')
        .gte('year', first.year).lte('year', last.year).in('account_id', accountIds),
      supabase.from('account_transfers').select('from_account_id, to_account_id, amount, transfer_date, currency')
        .gte('transfer_date', rangeStart).lt('transfer_date', rangeEnd),
      supabase.from('transactions').select('account_id, amount, occurred_at, currency')
        .gte('occurred_at', rangeStart).lt('occurred_at', rangeEnd),
      convertToCOP ? getRates() : Promise.resolve([]),
    ])
  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3

  const accountIdSet = new Set(accountIds)
  const convert = (amount, currency) => (convertToCOP ? toCOP(amount, currency, rates) : amount)

  return months.map(({ year, month }) => {
    const monthStart = new Date(Date.UTC(year, month - 1, 1))
    const nextStart = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1))

    let balanceTotal = 0
    for (const row of initialBalances) {
      if (row.year === year && row.month === month) balanceTotal += convert(Number(row.initial_balance), row.currency)
    }
    for (const row of transfers) {
      const d = new Date(row.transfer_date)
      if (d < monthStart || d >= nextStart) continue
      const amount = convert(Number(row.amount), row.currency)
      if (accountIdSet.has(row.to_account_id)) balanceTotal += amount
      if (accountIdSet.has(row.from_account_id)) balanceTotal -= amount
    }

    let ingresos = 0
    let gastos = 0
    for (const row of transactions) {
      const d = new Date(row.occurred_at)
      if (d < monthStart || d >= nextStart) continue
      const amount = convert(Number(row.amount), row.currency)
      if (accountIdSet.has(row.account_id)) balanceTotal += amount
      if (amount > 0) ingresos += amount
      else gastos += -amount
    }

    return { year, month, balanceTotal, ingresos, gastos, ahorro: ingresos - gastos }
  })
}

export async function fetchTotalDebt() {
  const [{ data, error }, rates] = await Promise.all([
    supabase.from('debts').select('remaining_amount, currency').eq('is_active', true).eq('direction', 'debo'),
    getRates(),
  ])
  if (error) throw error
  return data.reduce((sum, d) => sum + toCOP(Number(d.remaining_amount), d.currency, rates), 0)
}

const MS_PER_DAY = 86400000
const DUE_SOON_DAYS = 5
const GOAL_DUE_SOON_DAYS = 30

// Detección de anomalías por categoría (distinta del presupuesto fijo de
// arriba: no requiere que el usuario defina ningún número, compara el mes
// en curso contra el propio historial de la categoría).
const ANOMALY_MONTHS_BACK = 6      // ventana de historial, mismo horizonte que PATTERN_MONTHS_BACK en GastosDiarios.jsx
const ANOMALY_MIN_HISTORY_MONTHS = 3 // mínimo de meses con gasto para considerar el promedio confiable
const ANOMALY_MULTIPLIER = 1.5     // dispara si el mes actual supera 1.5x el promedio histórico
const ANOMALY_MIN_AVERAGE = 20000  // piso en COP para no disparar por variaciones ínfimas en categorías de gasto muy bajo

// Alertas rápidas: gastos fijos próximos a vencer/vencidos, cuotas de deuda
// próximas a vencer/vencidas, metas puntuales cerca de su fecha objetivo sin
// completar, movimientos sin cuenta asignada, categorías que superaron su
// presupuesto mensual (categories.monthly_budget) en el mes en curso, y
// categorías cuyo gasto del mes se disparó vs. su propio promedio histórico.
export async function fetchAlerts() {
  const todayDate = new Date()
  const today = new Date(Date.UTC(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate()))
  const dayOfMonth = todayDate.getDate()
  const year = todayDate.getFullYear()
  const month = todayDate.getMonth() + 1
  const dueSoonCutoff = new Date(today.getTime() + DUE_SOON_DAYS * MS_PER_DAY).toISOString().slice(0, 10)

  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`
  const nextMonthStart = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  const historyMonths = lastNMonths(year, month, ANOMALY_MONTHS_BACK + 1) // incluye el mes actual
  const historyStart = `${historyMonths[0].year}-${String(historyMonths[0].month).padStart(2, '0')}-01`

  const [
    { data: fixedExpenses, error: e1 }, { data: debtInstallments, error: e2 }, { data: savingsGoals, error: e3 },
    pendingCount, { data: allCategories, error: e5 }, { data: expenseRows, error: e6 },
  ] = await Promise.all([
    supabase.from('fixed_expenses').select('id, name, amount, due_day').eq('is_active', true),
    supabase.from('debt_installments').select('id, due_date, amount, debts(creditor_name, is_active, direction)').eq('paid', false).lte('due_date', dueSoonCutoff),
    supabase.from('savings_goals').select('id, name, current_amount, target_amount, target_date').eq('is_active', true).eq('kind', 'puntual').not('target_date', 'is', null),
    countPendingTransactions(),
    supabase.from('categories').select('id, name, monthly_budget'),
    supabase.from('transactions').select('category_id, amount, occurred_at').gte('occurred_at', historyStart).lt('occurred_at', nextMonthStart).lt('amount', 0),
  ])
  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3
  if (e5) throw e5
  if (e6) throw e6

  // spentByCategory: solo el mes en curso (para el presupuesto fijo, igual
  // que antes). historyByCategory: gasto de meses anteriores agrupado por
  // mes, para calcular el promedio histórico de la anomalía.
  const spentByCategory = {}
  const historyByCategory = {}
  for (const row of expenseRows) {
    const amount = -Number(row.amount)
    const rowMonthKey = row.occurred_at.slice(0, 7)
    if (rowMonthKey === currentMonthKey) {
      spentByCategory[row.category_id] = (spentByCategory[row.category_id] ?? 0) + amount
    } else {
      const byMonth = (historyByCategory[row.category_id] ??= {})
      byMonth[rowMonthKey] = (byMonth[rowMonthKey] ?? 0) + amount
    }
  }

  const fixedIds = fixedExpenses.map((f) => f.id)
  const { data: statuses, error: e4 } = fixedIds.length
    ? await supabase.from('fixed_expense_month_status').select('fixed_expense_id, paid').eq('year', year).eq('month', month).in('fixed_expense_id', fixedIds)
    : { data: [], error: null }
  if (e4) throw e4
  const paidMap = Object.fromEntries(statuses.map((s) => [s.fixed_expense_id, s.paid]))

  const alerts = []

  for (const f of fixedExpenses) {
    if (paidMap[f.id]) continue
    const daysUntil = f.due_day - dayOfMonth
    if (daysUntil > DUE_SOON_DAYS) continue
    alerts.push({
      id: `fx-${f.id}`,
      kind: 'gasto_fijo',
      level: daysUntil < 0 ? 'critical' : 'warning',
      name: f.name,
      amount: Number(f.amount),
      daysUntil,
      href: '/cuentas',
    })
  }

  for (const inst of debtInstallments) {
    if (!inst.debts?.is_active || inst.debts?.direction === 'me_deben') continue
    const daysUntil = Math.round((new Date(inst.due_date) - today) / MS_PER_DAY)
    alerts.push({
      id: `debt-${inst.id}`,
      kind: 'deuda',
      level: daysUntil < 0 ? 'critical' : 'warning',
      name: inst.debts.creditor_name,
      amount: Number(inst.amount),
      daysUntil,
      href: '/deudas',
    })
  }

  for (const g of savingsGoals) {
    if (g.target_amount != null && Number(g.current_amount) >= Number(g.target_amount)) continue
    const daysUntil = Math.round((new Date(g.target_date) - today) / MS_PER_DAY)
    if (daysUntil > GOAL_DUE_SOON_DAYS) continue
    alerts.push({
      id: `goal-${g.id}`,
      kind: 'meta',
      level: daysUntil < 0 ? 'critical' : 'warning',
      name: g.name,
      amount: null,
      daysUntil,
      href: '/metas',
    })
  }

  if (pendingCount > 0) {
    alerts.push({
      id: 'pending-transactions',
      kind: 'pendiente_banco',
      level: 'warning',
      name: null,
      amount: null,
      daysUntil: null,
      count: pendingCount,
      href: '/gastos',
    })
  }

  for (const c of allCategories) {
    if (c.monthly_budget == null) continue
    const spent = spentByCategory[c.id] ?? 0
    const budget = Number(c.monthly_budget)
    if (spent <= budget) continue
    alerts.push({
      id: `budget-${c.id}`,
      kind: 'presupuesto_categoria',
      level: 'critical',
      name: c.name,
      amount: spent,
      budget,
      href: '/gastos',
    })
  }

  for (const c of allCategories) {
    const monthTotals = historyByCategory[c.id]
    if (!monthTotals) continue
    const monthsWithData = Object.keys(monthTotals)
    if (monthsWithData.length < ANOMALY_MIN_HISTORY_MONTHS) continue
    const average = monthsWithData.reduce((sum, k) => sum + monthTotals[k], 0) / monthsWithData.length
    if (average < ANOMALY_MIN_AVERAGE) continue
    const current = spentByCategory[c.id] ?? 0
    if (current <= average * ANOMALY_MULTIPLIER) continue
    alerts.push({
      id: `anomalia-${c.id}`,
      kind: 'anomalia_categoria',
      level: 'warning',
      name: c.name,
      amount: current,
      average,
      monthsBack: ANOMALY_MONTHS_BACK,
      href: '/gastos',
    })
  }

  return alerts
}
