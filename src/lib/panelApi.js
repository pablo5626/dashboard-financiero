import { supabase } from './supabaseClient.js'
import { countPendingTransactions, countPendingCurrencyTransactions, isIgnoredRow } from './transactionsApi.js'
import { getRates, toCOP } from './exchangeRatesApi.js'
import { buildPocketIndex, resolvePocketKey } from './currencyPockets.js'
import { fetchAllInitialBalanceRows, resolveAnchorsFromRows, earliestAnchorMonth, monthStartStr } from './balanceAnchors.js'
import { getUserSettings } from './userSettingsApi.js'

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

// Para cada mes del rango: saldo total acumulado (misma resolución de ancla
// que fetchBalancesForMonth — ver balanceAnchors.js: la fila explícita más
// reciente <= el mes, o 0 en accounts.created_at, más todo lo ocurrido desde
// ahí), sumado entre los bolsillos de `accounts`; ingresos y gastos del mes.
// Ingresos/gastos se calculan sobre TODAS las transacciones del usuario en
// ese rango de fechas (estén o no asignadas a una cuenta todavía) porque
// reflejan flujo de dinero real, no el estado de asignación del motor de
// cuentas — el saldo, en cambio, solo acumula transacciones/transferencias
// cuya cuenta Y moneda coinciden con un bolsillo real de `accounts` (mismo
// criterio que fetchBalancesForMonth).
//
// `months` debe venir contigua y ascendente (así la arman los 3 llamadores:
// lastNMonths, o un rango de meses de un mismo año) — la función camina mes
// a mes desde el ancla más vieja detectada hasta el último mes pedido,
// acumulando en `running`, y solo devuelve las filas de `months`: los meses
// "puente" entre el ancla y el primer mes pedido se calculan pero no se
// exponen (si no se hiciera esto, un ancla anterior al rango visible dejaría
// el arrastre incompleto para el primer mes mostrado).
//
// convertToCOP (default true) convierte cada monto no-COP a COP con la tasa
// vigente antes de sumarlo, para que balanceTotal/ingresos/gastos sean un
// solo número consolidado — usado por Panel General. Pasar `false` cuando
// el llamador quiere el trend en la moneda nativa de la cuenta (ej. una
// meta de ahorro ligada a una cuenta en USD no debe convertirse a COP).
export async function fetchMonthlyTrend(accounts, months, { convertToCOP = true } = {}) {
  if (months.length === 0) return []

  const accountIds = accounts.map((a) => a.id)
  const pocketIndex = buildPocketIndex(accounts)
  const keyFor = (id, currency) => resolvePocketKey(pocketIndex, id, currency)

  const first = months[0]
  const last = months[months.length - 1]
  const afterLast = last.month === 12 ? { year: last.year + 1, month: 1 } : { year: last.year, month: last.month + 1 }
  const rangeEnd = monthStartStr(afterLast.year, afterLast.month)

  const allBalanceRows = await fetchAllInitialBalanceRows(accountIds)
  const anchors = resolveAnchorsFromRows(allBalanceRows, accounts, first.year, first.month)
  // Sin ningún bolsillo (accounts vacío) no hay ancla que resolver — cae al
  // propio primer mes pedido, para no romper con accounts=[].
  const earliest = earliestAnchorMonth(anchors) ?? { year: first.year, month: first.month }
  const rangeStart = monthStartStr(earliest.year, earliest.month)

  const [{ data: transfers, error: e2 }, { data: transactions, error: e3 }, rates] =
    await Promise.all([
      supabase.from('account_transfers').select('from_account_id, to_account_id, amount, transfer_date, currency, to_amount, to_currency')
        .gte('transfer_date', rangeStart).lt('transfer_date', rangeEnd),
      supabase.from('transactions').select('account_id, amount, occurred_at, currency, tags')
        .gte('occurred_at', rangeStart).lt('occurred_at', rangeEnd),
      convertToCOP ? getRates() : Promise.resolve([]),
    ])
  if (e2) throw e2
  if (e3) throw e3

  const convert = (amount, currency) => (convertToCOP ? toCOP(amount, currency, rates) : amount)

  // Bucketeado por mes una sola vez (en vez de recorrer todas las filas en
  // cada iteración del mes) — el rango puede abarcar bastantes meses más que
  // los pedidos si el ancla más vieja queda lejos.
  const txByMonth = {}
  for (const row of transactions) (txByMonth[row.occurred_at.slice(0, 7)] ??= []).push(row)
  const trByMonth = {}
  for (const row of transfers) (trByMonth[row.transfer_date.slice(0, 7)] ??= []).push(row)
  const explicitByPocketMonth = {}
  for (const row of allBalanceRows) {
    const key = keyFor(row.account_id, row.currency)
    if (key) explicitByPocketMonth[`${key}|${row.year}-${String(row.month).padStart(2, '0')}`] = Number(row.initial_balance)
  }

  const running = Object.fromEntries(Object.entries(anchors).map(([k, a]) => [k, a.balance]))
  const wantedMonths = new Set(months.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`))
  const result = []

  let y = earliest.year
  let m = earliest.month
  while (y * 12 + m <= last.year * 12 + last.month) {
    const monthKey = `${y}-${String(m).padStart(2, '0')}`

    // Un ajuste explícito cargado este mes resetea el arrastre acumulado —
    // mismo comportamiento que ya tenía cualquier fila explícita.
    for (const key of Object.keys(running)) {
      const explicit = explicitByPocketMonth[`${key}|${monthKey}`]
      if (explicit !== undefined) running[key] = explicit
    }

    let ingresos = 0
    let gastos = 0
    for (const row of txByMonth[monthKey] ?? []) {
      const key = keyFor(row.account_id, row.currency)
      if (key && key in running) running[key] += Number(row.amount)
      // Filas cuyo movimiento real ya está registrado en otro lado (traslado
      // entre cuentas propias, o compra ya cargada a mano): contarlas acá sería
      // contar el mismo movimiento dos veces.
      if (isIgnoredRow(row.tags)) continue
      const amount = convert(Number(row.amount), row.currency)
      if (amount > 0) ingresos += amount
      else gastos += -amount
    }
    for (const row of trByMonth[monthKey] ?? []) {
      const toKey = row.to_account_id ? keyFor(row.to_account_id, row.to_currency ?? row.currency) : null
      if (toKey && toKey in running) running[toKey] += Number(row.to_amount ?? row.amount)
      const fromKey = row.from_account_id ? keyFor(row.from_account_id, row.currency) : null
      if (fromKey && fromKey in running) running[fromKey] -= Number(row.amount)
    }

    if (wantedMonths.has(monthKey)) {
      const balanceTotal = Object.entries(running).reduce((sum, [key, bal]) => {
        const currency = key.includes(':') ? key.split(':')[1] : (accounts.find((a) => a.id === key)?.currency || 'COP')
        return sum + convert(bal, currency)
      }, 0)
      result.push({ year: y, month: m, balanceTotal, ingresos, gastos, ahorro: ingresos - gastos })
    }

    m += 1
    if (m === 13) { m = 1; y += 1 }
  }

  return result
}

// Primer mes con algún registro financiero real (saldo inicial, transacción
// o transferencia) — usado para no graficar como "0" meses anteriores a que
// el usuario empezara a usar el dashboard, que de otro modo se ven idénticos
// a un mes real sin gasto ni ingreso. Devuelve null si no hay ningún dato aún.
export async function findFirstDataMonth() {
  const [{ data: balances, error: e1 }, { data: transactions, error: e2 }, { data: transfers, error: e3 }] =
    await Promise.all([
      supabase.from('monthly_initial_balances').select('year, month').order('year', { ascending: true }).order('month', { ascending: true }).limit(1),
      supabase.from('transactions').select('occurred_at').order('occurred_at', { ascending: true }).limit(1),
      supabase.from('account_transfers').select('transfer_date').order('transfer_date', { ascending: true }).limit(1),
    ])
  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3

  const candidates = []
  if (balances.length) candidates.push({ year: balances[0].year, month: balances[0].month })
  if (transactions.length) {
    const d = new Date(transactions[0].occurred_at)
    candidates.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }
  if (transfers.length) {
    const d = new Date(transfers[0].transfer_date)
    candidates.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }
  if (candidates.length === 0) return null

  return candidates.reduce((earliest, c) =>
    c.year * 12 + c.month < earliest.year * 12 + earliest.month ? c : earliest
  )
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
    pendingCurrencyCount, budgetSettings,
  ] = await Promise.all([
    supabase.from('fixed_expenses').select('id, name, amount, due_day, currency').eq('is_active', true),
    supabase.from('debt_installments').select('id, due_date, amount, debts(creditor_name, is_active, direction, currency)').eq('paid', false).lte('due_date', dueSoonCutoff),
    supabase.from('savings_goals').select('id, name, current_amount, target_amount, target_date').eq('is_active', true).eq('kind', 'puntual').not('target_date', 'is', null),
    countPendingTransactions(),
    supabase.from('categories').select('id, name, monthly_budget').eq('is_active', true),
    supabase.from('transactions').select('category_id, amount, occurred_at, tags').gte('occurred_at', historyStart).lt('occurred_at', nextMonthStart).lt('amount', 0),
    countPendingCurrencyTransactions(),
    getUserSettings(),
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
    if (isIgnoredRow(row.tags)) continue
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
      currency: f.currency || 'COP',
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
      currency: inst.debts.currency || 'COP',
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

  // Compras en divisa importadas con monto estimado: mientras no se confirmen,
  // el saldo de la cuenta en USD/EUR está aproximado con la tasa manual.
  if (pendingCurrencyCount > 0) {
    alerts.push({
      id: 'pending-currency',
      kind: 'divisa_pendiente',
      level: 'warning',
      name: null,
      amount: null,
      daysUntil: null,
      count: pendingCurrencyCount,
      href: '/gastos',
    })
  }

  // El umbral es configurable desde Ajustes → Presupuestos
  // (userSettingsApi.getUserSettings, default 100% si el usuario nunca lo
  // tocó — mismo comportamiento que esta alerta tenía antes de que el
  // ajuste existiera). Por debajo del 100% ya no significa "te pasaste":
  // 'critical' se reserva para spent >= budget, 'warning' para el rango
  // umbral..100%.
  if (budgetSettings.budgetAlertsEnabled) {
    const thresholdRatio = budgetSettings.budgetAlertThresholdPct / 100
    for (const c of allCategories) {
      if (c.monthly_budget == null) continue
      const spent = spentByCategory[c.id] ?? 0
      const budget = Number(c.monthly_budget)
      if (spent < budget * thresholdRatio) continue
      alerts.push({
        id: `budget-${c.id}`,
        kind: 'presupuesto_categoria',
        level: spent >= budget ? 'critical' : 'warning',
        name: c.name,
        amount: spent,
        budget,
        thresholdPct: budgetSettings.budgetAlertThresholdPct,
        href: '/gastos',
      })
    }
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
