import { supabase } from './supabaseClient.js'
import { edgeFunctionErrorMessage } from './functionErrors.js'
import { listAccounts, fetchBalancesForMonth } from './accountsApi.js'
import { listTransactionsForMonth, isIgnoredRow } from './transactionsApi.js'
import { fetchAlerts, fetchMonthlyTrend, fetchTotalDebt, lastNMonths } from './panelApi.js'

const TREND_MONTHS_BACK = 6

// Arma el contexto real que "Preguntale a tu dinero" manda al modelo — nunca
// deja que el modelo invente un número: todo lo que ve acá ya salió de las
// mismas funciones que usan Panel/Cuentas/Gastos, nunca se recalcula aparte.
// Los montos siempre se mandan en COP (ya convertidos donde hace falta) para
// que el modelo no tenga que mezclar monedas al razonar sobre la respuesta.
export async function buildMoneyContext() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const accounts = await listAccounts()
  const months = lastNMonths(year, month, TREND_MONTHS_BACK)

  const [{ balances, allocated }, monthTransactions, alerts, trend, totalDebt] = await Promise.all([
    fetchBalancesForMonth(accounts, year, month),
    listTransactionsForMonth(year, month),
    fetchAlerts(),
    fetchMonthlyTrend(accounts, months, { convertToCOP: true }),
    fetchTotalDebt(),
  ])

  const cuentas = accounts
    .filter((a) => a.is_active !== false)
    .map((a) => ({
      nombre: a.name,
      tipo: a.kind,
      moneda: a.currency || 'COP',
      saldo: Math.round(balances[a.id] ?? 0),
      asignado_este_mes: allocated[a.id] != null ? Math.round(allocated[a.id]) : null,
    }))

  const gastoPorCategoria = {}
  const gastoPorTag = {}
  let gastoDelMes = 0
  let ingresoDelMes = 0
  for (const t of monthTransactions) {
    if (isIgnoredRow(t.tags)) continue
    const amount = Number(t.amount)
    if (amount < 0) {
      const categoria = t.categories?.name ?? 'Sin categoría'
      gastoPorCategoria[categoria] = (gastoPorCategoria[categoria] ?? 0) + -amount
      gastoDelMes += -amount
      for (const tag of t.tags ?? []) {
        gastoPorTag[tag] = (gastoPorTag[tag] ?? 0) + -amount
      }
    } else {
      ingresoDelMes += amount
    }
  }

  return {
    hoy: now.toISOString().slice(0, 10),
    mes_actual: { year, month },
    cuentas,
    gasto_del_mes_cop: Math.round(gastoDelMes),
    ingreso_del_mes_cop: Math.round(ingresoDelMes),
    gasto_por_categoria_cop: gastoPorCategoria,
    gasto_por_tag_cop: gastoPorTag,
    deuda_total_cop: Math.round(totalDebt),
    alertas: alerts.map((a) => ({ tipo: a.kind, nombre: a.name, monto: a.amount, dias: a.daysUntil })),
    tendencia_ultimos_meses: trend.map((m) => ({
      year: m.year,
      month: m.month,
      ingresos_cop: Math.round(m.ingresos),
      gastos_cop: Math.round(m.gastos),
      ahorro_cop: Math.round(m.ahorro),
    })),
  }
}

export async function askMoney(question) {
  const context = await buildMoneyContext()
  const { data, error } = await supabase.functions.invoke('money-ask', {
    body: { question, context },
  })
  if (error) throw new Error(await edgeFunctionErrorMessage(error))
  if (!data?.ok) throw new Error(data?.error || 'no se pudo responder la pregunta')
  return data.answer
}
