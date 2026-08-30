import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell,
} from 'recharts'
import Card from '../components/ui/Card.jsx'
import StatTile from '../components/ui/StatTile.jsx'
import { formatCOP, formatCompact } from '../lib/format.js'
import { listAccounts, fetchBalancesForMonth } from '../lib/accountsApi.js'
import { lastNMonths, fetchMonthlyTrend, fetchTotalDebt, fetchAlerts } from '../lib/panelApi.js'
import { getRate, toCOP } from '../lib/exchangeRatesApi.js'

const STATUS_DOT = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
}

const ACCOUNT_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)']

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1
const TREND_MONTHS = 6

function alertText(a) {
  switch (a.kind) {
    case 'gasto_fijo':
      return a.daysUntil < 0
        ? `${a.name} venció hace ${-a.daysUntil} día(s) — ${formatCOP(a.amount)}`
        : `${a.name} vence en ${a.daysUntil} día(s) — ${formatCOP(a.amount)}`
    case 'deuda':
      return a.daysUntil < 0
        ? `Cuota de "${a.name}" venció hace ${-a.daysUntil} día(s) — ${formatCOP(a.amount)}`
        : `Cuota de "${a.name}" vence en ${a.daysUntil} día(s) — ${formatCOP(a.amount)}`
    case 'meta':
      return a.daysUntil < 0
        ? `Meta "${a.name}" venció sin completarse`
        : `Meta "${a.name}" vence en ${a.daysUntil} día(s)`
    case 'pendiente_banco':
      return a.count === 1
        ? '1 movimiento sin cuenta asignada — confírmalo en Gastos diarios'
        : `${a.count} movimientos sin cuenta asignada — confírmalos en Gastos diarios`
    case 'presupuesto_categoria':
      return `"${a.name}" superó su presupuesto — ${formatCOP(a.amount)} de ${formatCOP(a.budget)}`
    case 'anomalia_categoria':
      return `"${a.name}" se disparó este mes — ${formatCOP(a.amount)} vs. promedio histórico de ${formatCOP(a.average)} (últimos ${a.monthsBack} meses)`
    default:
      return ''
  }
}

export default function PanelGeneral() {
  const [accounts, setAccounts] = useState(null)
  const [balances, setBalances] = useState({})
  const [rate, setRate] = useState(null)
  const [trend, setTrend] = useState(null)
  const [totalDebt, setTotalDebt] = useState(0)
  const [alerts, setAlerts] = useState([])
  const [yoyCurrent, setYoyCurrent] = useState(null)
  const [yoyPrevious, setYoyPrevious] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const accs = await listAccounts()
        setAccounts(accs)
        const ids = accs.map((a) => a.id)
        const currentYearMonths = Array.from({ length: MONTH }, (_, i) => ({ year: YEAR, month: i + 1 }))
        const previousYearMonths = Array.from({ length: MONTH }, (_, i) => ({ year: YEAR - 1, month: i + 1 }))
        const [{ balances: b }, currentRate, trendRows, debt, alertRows, yoyCurrentRows, yoyPreviousRows] = await Promise.all([
          fetchBalancesForMonth(accs, YEAR, MONTH),
          getRate(),
          fetchMonthlyTrend(ids, lastNMonths(YEAR, MONTH, TREND_MONTHS)),
          fetchTotalDebt(),
          fetchAlerts(),
          fetchMonthlyTrend(ids, currentYearMonths),
          fetchMonthlyTrend(ids, previousYearMonths),
        ])
        setBalances(b)
        setRate(currentRate)
        setTrend(trendRows)
        setTotalDebt(debt)
        setAlerts(alertRows)
        setYoyCurrent(yoyCurrentRows)
        setYoyPrevious(yoyPreviousRows)
      } catch (err) {
        setError(err.message)
      }
    }
    load()
  }, [])

  if (error) {
    return <p style={{ color: 'var(--status-critical)' }}>Error cargando panel general: {error}</p>
  }

  if (!accounts || !trend) {
    return <p style={{ color: 'var(--text-muted)' }}>Cargando panel general…</p>
  }

  const hijas = accounts.filter((a) => a.kind === 'hija')
  const balanceTotal = accounts.reduce((sum, a) => sum + toCOP(balances[a.id] ?? 0, a.currency, rate?.rate), 0)

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

  const yoyChartData = MONTH_LABELS.slice(0, MONTH).map((label, i) => ({
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
      <h1 className="page-title">Panel general</h1>

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

        <Card title="Distribución por cuenta">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hijas.map((a) => ({ name: a.name, balance: toCOP(balances[a.id] ?? 0, a.currency, rate?.rate) }))} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--gridline)" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={70} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
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
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={70} tickFormatter={formatCompact} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
              <Line type="monotone" dataKey="patrimonio" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} name="Patrimonio neto" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Tendencia ${TREND_MONTHS} meses`} className="span-3">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={70} tickFormatter={formatCompact} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
              <Legend />
              <Line type="monotone" dataKey="ingresos" stroke="var(--series-1)" strokeWidth={2} name="Ingresos" dot={false} />
              <Line type="monotone" dataKey="gastos" stroke="var(--series-2)" strokeWidth={2} name="Gastos" dot={false} />
              <Line type="monotone" dataKey="ahorro" stroke="var(--series-3)" strokeWidth={2} name="Ahorro neto" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Comparativa año a año (ene–${MONTH_LABELS[MONTH - 1]})`} className="span-3">
          <div className="kpi-row" style={{ marginBottom: 'var(--space-2)' }}>
            <StatTile
              label={`Ingresos ${YEAR}`}
              value={formatCOP(ytdIngresosActual)}
              delta={ingresosDeltaPct != null ? `${ingresosDeltaPct > 0 ? '+' : ''}${ingresosDeltaPct}% vs ${YEAR - 1}` : undefined}
              deltaGood={ingresosDeltaPct >= 0}
            />
            <StatTile
              label={`Gastos ${YEAR}`}
              value={formatCOP(ytdGastosActual)}
              delta={gastosDeltaPct != null ? `${gastosDeltaPct > 0 ? '+' : ''}${gastosDeltaPct}% vs ${YEAR - 1}` : undefined}
              deltaGood={gastosDeltaPct <= 0}
            />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={yoyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={70} tickFormatter={formatCompact} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--gridline)' }} />
              <Legend />
              <Line type="monotone" dataKey="ingresosActual" stroke="var(--series-1)" strokeWidth={2} name={`Ingresos ${YEAR}`} dot={false} />
              <Line type="monotone" dataKey="ingresosAnterior" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" name={`Ingresos ${YEAR - 1}`} dot={false} />
              <Line type="monotone" dataKey="gastosActual" stroke="var(--series-2)" strokeWidth={2} name={`Gastos ${YEAR}`} dot={false} />
              <Line type="monotone" dataKey="gastosAnterior" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" name={`Gastos ${YEAR - 1}`} dot={false} />
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
