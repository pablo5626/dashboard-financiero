import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, Cell,
} from 'recharts'
import Card from '../components/ui/Card.jsx'
import StatTile from '../components/ui/StatTile.jsx'
import MonthYearPicker from '../components/ui/MonthYearPicker.jsx'
import { formatCOP, formatCompact, formatByCurrency } from '../lib/format.js'
import { estimateCategoryAxisWidth } from '../lib/chartUtils.js'
import { listAccounts, fetchBalancesForMonth, totalBalanceInCOP } from '../lib/accountsApi.js'
import { lastNMonths, fetchMonthlyTrend, fetchTotalDebt, fetchAlerts, findFirstDataMonth } from '../lib/panelApi.js'
import { listUpcomingFixedExpenses, setPaidStatus } from '../lib/fixedExpensesApi.js'
import { getRates, toCOP } from '../lib/exchangeRatesApi.js'

const STATUS_DOT = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
}

const ACCOUNT_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)']

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const now = new Date()
const REAL_YEAR = now.getFullYear()
const REAL_MONTH = now.getMonth() + 1
const TREND_MONTHS = 6
const FIXED_EXPENSE_DUE_SOON_DAYS = 5 // mismo umbral que panelApi.fetchAlerts

function alertText(a) {
  switch (a.kind) {
    case 'gasto_fijo':
      return a.daysUntil < 0
        ? `${a.name} venció hace ${-a.daysUntil} día(s) — ${formatByCurrency(a.amount, a.currency)}`
        : `${a.name} vence en ${a.daysUntil} día(s) — ${formatByCurrency(a.amount, a.currency)}`
    case 'deuda':
      return a.daysUntil < 0
        ? `Cuota de "${a.name}" venció hace ${-a.daysUntil} día(s) — ${formatByCurrency(a.amount, a.currency)}`
        : `Cuota de "${a.name}" vence en ${a.daysUntil} día(s) — ${formatByCurrency(a.amount, a.currency)}`
    case 'meta':
      return a.daysUntil < 0
        ? `Meta "${a.name}" venció sin completarse`
        : `Meta "${a.name}" vence en ${a.daysUntil} día(s)`
    case 'pendiente_banco':
      return a.count === 1
        ? '1 movimiento sin cuenta asignada — confírmalo en Gastos diarios'
        : `${a.count} movimientos sin cuenta asignada — confírmalos en Gastos diarios`
    case 'divisa_pendiente':
      return a.count === 1
        ? '1 compra en divisa con monto estimado — confírmalo en Gastos diarios'
        : `${a.count} compras en divisa con monto estimado — confírmalos en Gastos diarios`
    case 'presupuesto_categoria':
      return a.amount >= a.budget
        ? `"${a.name}" superó su presupuesto — ${formatCOP(a.amount)} de ${formatCOP(a.budget)}`
        : `"${a.name}" ya lleva ${formatCOP(a.amount)} de ${formatCOP(a.budget)} (${a.thresholdPct}% del presupuesto)`
    case 'anomalia_categoria':
      return `"${a.name}" se disparó este mes — ${formatCOP(a.amount)} vs. promedio histórico de ${formatCOP(a.average)} (últimos ${a.monthsBack} meses)`
    default:
      return ''
  }
}

export default function PanelGeneral() {
  const [year, setYear] = useState(REAL_YEAR)
  const [month, setMonth] = useState(REAL_MONTH)
  const [accounts, setAccounts] = useState(null)
  const [balances, setBalances] = useState({})
  const [rates, setRates] = useState([])
  const [trend, setTrend] = useState(null)
  const [totalDebt, setTotalDebt] = useState(0)
  const [alerts, setAlerts] = useState([])
  const [yoyCurrent, setYoyCurrent] = useState(null)
  const [yoyPrevious, setYoyPrevious] = useState(null)
  const [yoyStartMonth, setYoyStartMonth] = useState(1)
  const [upcomingFixedExpenses, setUpcomingFixedExpenses] = useState([])
  const [markingPaidId, setMarkingPaidId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const accs = await listAccounts()
        setAccounts(accs)

        // No graficar meses anteriores al primer registro real (saldo inicial,
        // transacción o transferencia) como si fueran "0 gastado" — eso se ve
        // idéntico a un mes real sin movimientos y confunde.
        const firstData = await findFirstDataMonth()
        const firstDataKey = firstData ? firstData.year * 12 + firstData.month : null
        const startMonth = firstData && firstData.year === year ? firstData.month : 1
        setYoyStartMonth(startMonth)

        const currentYearMonths = Array.from({ length: month - startMonth + 1 }, (_, i) => ({ year, month: startMonth + i }))
        const previousYearMonths = currentYearMonths.map((m) => ({ year: year - 1, month: m.month }))
        let trendMonths = lastNMonths(year, month, TREND_MONTHS)
        if (firstDataKey != null) {
          trendMonths = trendMonths.filter((m) => m.year * 12 + m.month >= firstDataKey)
        }

        // Alertas y "Próximos pagos" siempre miran "hoy real" (REAL_YEAR/
        // REAL_MONTH), sin importar qué mes esté navegando el resto del
        // Panel con el selector — "qué necesita mi atención ahora" no
        // depende de qué período estás mirando en los gráficos.
        const [{ balances: b }, currentRates, trendRows, debt, alertRows, yoyCurrentRows, yoyPreviousRows, upcomingFixed] = await Promise.all([
          fetchBalancesForMonth(accs, year, month),
          getRates(),
          fetchMonthlyTrend(accs, trendMonths),
          fetchTotalDebt(),
          fetchAlerts(),
          fetchMonthlyTrend(accs, currentYearMonths),
          fetchMonthlyTrend(accs, previousYearMonths),
          listUpcomingFixedExpenses(REAL_YEAR, REAL_MONTH, FIXED_EXPENSE_DUE_SOON_DAYS),
        ])
        setBalances(b)
        setRates(currentRates)
        setTrend(trendRows)
        setTotalDebt(debt)
        setAlerts(alertRows)
        setYoyCurrent(yoyCurrentRows)
        setYoyPrevious(yoyPreviousRows)
        setUpcomingFixedExpenses(upcomingFixed)
      } catch (err) {
        setError(err.message)
      }
    }
    load()
  }, [year, month])

  async function handleMarkFixedExpensePaid(id) {
    setMarkingPaidId(id)
    try {
      await setPaidStatus(id, REAL_YEAR, REAL_MONTH, true)
      setUpcomingFixedExpenses((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      setError(err.message)
    } finally {
      setMarkingPaidId(null)
    }
  }

  if (error) {
    return <p style={{ color: 'var(--status-critical)' }}>Error cargando panel general: {error}</p>
  }

  if (!accounts || !trend) {
    return <p style={{ color: 'var(--text-muted)' }}>Cargando panel general…</p>
  }

  const hijas = accounts.filter((a) => a.kind === 'hija')
  const balanceTotal = accounts.reduce((sum, a) => sum + totalBalanceInCOP(a, balances, rates, toCOP), 0)

  const netWorthTrend = trend.map((t) => ({
    month: MONTH_LABELS[t.month - 1],
    patrimonio: t.balanceTotal - totalDebt,
  }))
  const monthlyTrend = trend.map((t) => ({
    month: MONTH_LABELS[t.month - 1],
    ingresos: t.ingresos,
    gastos: t.gastos,
    ahorro: t.ahorro,
    patrimonio: t.balanceTotal - totalDebt,
  }))

  const lastMonth = trend[trend.length - 1]
  const prevMonth = trend[trend.length - 2]
  const gastoDelta = prevMonth ? lastMonth.gastos - prevMonth.gastos : 0

  const yoyChartData = MONTH_LABELS.slice(yoyStartMonth - 1, month).map((label, i) => ({
    month: label,
    gastosActual: yoyCurrent?.[i]?.gastos ?? 0,
    gastosAnterior: yoyPrevious?.[i]?.gastos ?? 0,
    ingresosActual: yoyCurrent?.[i]?.ingresos ?? 0,
    ingresosAnterior: yoyPrevious?.[i]?.ingresos ?? 0,
  }))
  const ytdIngresosActual = (yoyCurrent ?? []).reduce((sum, m) => sum + m.ingresos, 0)
  const ytdIngresosAnterior = (yoyPrevious ?? []).reduce((sum, m) => sum + m.ingresos, 0)
  const ytdGastosActual = (yoyCurrent ?? []).reduce((sum, m) => sum + m.gastos, 0)
  const ytdGastosAnterior = (yoyPrevious ?? []).reduce((sum, m) => sum + m.gastos, 0)
  const ingresosDeltaPct = ytdIngresosAnterior > 0 ? Math.round(((ytdIngresosActual - ytdIngresosAnterior) / ytdIngresosAnterior) * 100) : null
  const gastosDeltaPct = ytdGastosAnterior > 0 ? Math.round(((ytdGastosActual - ytdGastosAnterior) / ytdGastosAnterior) * 100) : null

  return (
    <div>
      {/* A diferencia de las demás páginas (h1.page-title como hijo directo,
          con su propio margin-bottom), acá el título comparte fila con el
          selector de mes/año — el margin-bottom de page-title no se traduce
          de forma confiable en espacio real dentro de un flex row, así que
          el margen inferior se pone explícito en el contenedor para no
          terminar tocando el kpi-row de abajo. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Panel general</h1>
        <MonthYearPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
      </div>

      <div className="kpi-row" style={{ marginBottom: 'var(--space-2)' }}>
        <Card><StatTile label="Balance total" value={formatCOP(balanceTotal)} /></Card>
        <Card><StatTile label="Patrimonio neto" value={formatCOP(balanceTotal - totalDebt)} /></Card>
        <Card><StatTile label="Ingresos del mes" value={formatCOP(lastMonth.ingresos)} /></Card>
        <Card>
          <StatTile
            label="Gastos del mes"
            value={formatCOP(lastMonth.gastos)}
            delta={prevMonth ? `${gastoDelta > 0 ? '+' : ''}${formatCOP(gastoDelta)} vs mes anterior` : undefined}
            deltaGood={gastoDelta <= 0}
          />
        </Card>
      </div>

      <div className="grid-auto">
        <Card title="Alertas" className="span-2">
          {alerts.length === 0 ? (
            <p style={{ font: 'var(--font-subheadline)', color: 'var(--text-muted)', margin: 0 }}>Sin alertas activas.</p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {alerts.map((a) => (
                <li key={a.id} style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center', font: 'var(--font-subheadline)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[a.level], flexShrink: 0 }} />
                  {a.href ? (
                    <Link to={a.href} style={{ color: 'inherit', textDecoration: 'underline' }}>{alertText(a)}</Link>
                  ) : (
                    alertText(a)
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Próximos pagos">
          {upcomingFixedExpenses.length === 0 ? (
            <p style={{ font: 'var(--font-subheadline)', color: 'var(--text-muted)', margin: 0 }}>Sin gastos fijos por vencer.</p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', margin: 0, padding: 0, listStyle: 'none' }}>
              {upcomingFixedExpenses.map((f) => (
                <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--font-subheadline)' }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: f.daysUntil < 0 ? 'var(--status-critical)' : 'var(--status-warning)',
                  }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {f.name} — {formatByCurrency(f.amount, f.currency)}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>
                      ({f.daysUntil < 0 ? `venció hace ${-f.daysUntil} día(s)` : `vence en ${f.daysUntil} día(s)`})
                    </span>
                  </span>
                  <button
                    type="button" onClick={() => handleMarkFixedExpensePaid(f.id)} disabled={markingPaidId === f.id}
                    style={{ font: 'var(--font-caption)', color: 'var(--series-1)', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}
                  >
                    {markingPaidId === f.id ? '…' : 'Marcar pagado'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Distribución por cuenta">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hijas.map((a) => ({ name: a.name, balance: totalBalanceInCOP(a, balances, rates, toCOP) }))} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={estimateCategoryAxisWidth(hijas.map((a) => a.name))} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--gridline)' }} />
              <Bar dataKey="balance" radius={[0, 4, 4, 0]}>
                {hijas.map((_, i) => (
                  <Cell key={i} fill={ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Patrimonio neto" className="span-2">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={netWorthTrend}>
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={46} tickFormatter={formatCompact} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
              <Line type="monotone" dataKey="patrimonio" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} name="Patrimonio neto" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Tendencia ${TREND_MONTHS} meses`} className="span-3">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthlyTrend}>
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={46} tickFormatter={formatCompact} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
              <Legend />
              <Line type="monotone" dataKey="ingresos" stroke="var(--series-1)" strokeWidth={2} name="Ingresos" dot={false} />
              <Line type="monotone" dataKey="gastos" stroke="var(--series-2)" strokeWidth={2} name="Gastos" dot={false} />
              <Line type="monotone" dataKey="ahorro" stroke="var(--series-3)" strokeWidth={2} name="Ahorro neto" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Comparativa año a año (${MONTH_LABELS[yoyStartMonth - 1]}–${MONTH_LABELS[month - 1]})`} className="span-3">
          <div className="kpi-row" style={{ marginBottom: 'var(--space-2)' }}>
            <StatTile
              label={`Ingresos ${year}`}
              value={formatCOP(ytdIngresosActual)}
              delta={ingresosDeltaPct != null ? `${ingresosDeltaPct > 0 ? '+' : ''}${ingresosDeltaPct}% vs ${year - 1}` : undefined}
              deltaGood={ingresosDeltaPct >= 0}
            />
            <StatTile
              label={`Gastos ${year}`}
              value={formatCOP(ytdGastosActual)}
              delta={gastosDeltaPct != null ? `${gastosDeltaPct > 0 ? '+' : ''}${gastosDeltaPct}% vs ${year - 1}` : undefined}
              deltaGood={gastosDeltaPct <= 0}
            />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={yoyChartData}>
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={46} tickFormatter={formatCompact} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--gridline)' }} />
              <Legend />
              <Line type="monotone" dataKey="ingresosActual" stroke="var(--series-1)" strokeWidth={2} name={`Ingresos ${year}`} dot={false} />
              <Line type="monotone" dataKey="ingresosAnterior" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" name={`Ingresos ${year - 1}`} dot={false} />
              <Line type="monotone" dataKey="gastosActual" stroke="var(--series-2)" strokeWidth={2} name={`Gastos ${year}`} dot={false} />
              <Line type="monotone" dataKey="gastosAnterior" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" name={`Gastos ${year - 1}`} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Comparativa mes a mes" className="span-3">
          <div style={{ overflowX: 'auto' }}>
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ahorro neto</th><th>Patrimonio neto</th>
                </tr>
              </thead>
              <tbody>
                {monthlyTrend.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{formatCOP(m.ingresos)}</td>
                    <td>{formatCOP(m.gastos)}</td>
                    <td>{formatCOP(m.ahorro)}</td>
                    <td>{formatCOP(m.patrimonio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
