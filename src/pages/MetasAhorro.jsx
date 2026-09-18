import { useEffect, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import { Field, FieldRow, InfoCard, ChipPicker, EditHeader, EditActions, MeterPreview, inputClass } from '../components/ui/FormKit.jsx'
import { formatCOP, formatByCurrency, formatCompact } from '../lib/format.js'
import { listAccounts, fetchBalancesForMonth } from '../lib/accountsApi.js'
import { lastNMonths, fetchMonthlyTrend } from '../lib/panelApi.js'
import {
  listSavingsGoals, updateSavingsGoal, archiveSavingsGoal,
  listContributions, addContribution, deleteContribution,
} from '../lib/savingsApi.js'
import { createManualTransaction } from '../lib/transactionsApi.js'
import styles from './MetasAhorro.module.css'

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1
const TREND_MONTHS = 6
const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const emptyContribForm = { amount: '', date: new Date().toISOString().slice(0, 10), note: '', accountId: '' }

function monthsUntil(dateStr) {
  if (!dateStr) return null
  const target = new Date(dateStr)
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  return Math.max(1, months)
}

// "A este ritmo, la cumplirás en X meses" — basado en el ritmo real de
// crecimiento (aportes para 'puntual', saldo de cuenta para 'proposito'),
// no en el monto objetivo.
function monthsToGoalAtCurrentPace(current, target, series) {
  if (target == null || series.length < 2) return null
  const first = series[0]
  const last = series[series.length - 1]
  const spanMonths = series.length - 1
  const avgGrowth = (last - first) / spanMonths
  if (avgGrowth <= 0) return null
  return Math.max(1, Math.ceil((target - current) / avgGrowth))
}

// Ritmo plano necesario para llegar a la meta: monto objetivo repartido en
// partes iguales entre la creación de la meta y su fecha límite. Es la
// referencia "planeado" para comparar contra lo realmente aportado mes a mes.
function plannedMonthlyAmount(goal) {
  if (goal.target_amount == null || !goal.target_date) return null
  const created = new Date(goal.created_at)
  const target = new Date(goal.target_date)
  const totalMonths = Math.max(1, (target.getFullYear() - created.getFullYear()) * 12 + (target.getMonth() - created.getMonth()))
  return Number(goal.target_amount) / totalMonths
}

// Fila por mes (últimos TREND_MONTHS): lo planeado (constante) vs. lo
// realmente aportado ese mes — suma de aportes para 'puntual', o la
// variación real de saldo de la cuenta vinculada para 'proposito'.
function buildPlanVsActualRows(goal, months, contributions, propositoTrend, plannedMonthly) {
  return months.map(({ year, month }, idx) => {
    let aportado = null
    if (goal.kind === 'puntual') {
      aportado = contributions
        .filter((c) => {
          const d = new Date(c.contributed_at)
          return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month
        })
        .reduce((sum, c) => sum + Number(c.amount), 0)
    } else if (propositoTrend && idx > 0) {
      aportado = propositoTrend[idx].balanceTotal - propositoTrend[idx - 1].balanceTotal
    }
    return { label: `${MONTH_LABELS[month - 1]} ${year}`, planeado: plannedMonthly, aportado }
  })
}

export default function MetasAhorro() {
  const [goals, setGoals] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [balances, setBalances] = useState({})
  const [propositoTrends, setPropositoTrends] = useState({})
  const [contributions, setContributions] = useState([])
  const [error, setError] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [contribForm, setContribForm] = useState({})
  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null
  const [confirmDeleteContribution, setConfirmDeleteContribution] = useState(null) // { goal, contribution } | null

  async function reload() {
    try {
      const rows = await listSavingsGoals()
      setGoals(rows)

      const accs = await listAccounts()
      setAccounts(accs)
      const { balances: b } = await fetchBalancesForMonth(accs, YEAR, MONTH)
      setBalances(b)

      setContributions(await listContributions(rows.map((r) => r.id)))

      const trends = {}
      for (const g of rows.filter((r) => r.kind === 'proposito' && r.account_id)) {
        trends[g.id] = await fetchMonthlyTrend(accs.filter((a) => a.id === g.account_id), lastNMonths(YEAR, MONTH, TREND_MONTHS), { convertToCOP: false })
      }
      setPropositoTrends(trends)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [])

  // "Agregar meta de ahorro" vive en Ajustes → Metas de ahorro desde acá
  // (mismo criterio que "Cuentas"/"Deudas" — ver CLAUDE.md), así que esta
  // página necesita refrescar cuando eso pasa mientras sigue montada debajo
  // del panel de Ajustes — mismo patrón de evento global usado en Deudas.jsx.
  useEffect(() => {
    window.addEventListener('dashboard:goals-changed', reload)
    return () => window.removeEventListener('dashboard:goals-changed', reload)
  }, [])

  const hijas = accounts.filter((a) => a.kind === 'hija')

  function startEdit(g) {
    setEditingId(g.id)
    setEditForm({
      kind: g.kind, name: g.name, accountId: g.account_id ?? '',
      targetAmount: g.target_amount ?? '', targetDate: g.target_date ?? '',
    })
  }

  async function handleEditSave(id) {
    try {
      await updateSavingsGoal(id, {
        name: editForm.name.trim(),
        account_id: editForm.kind === 'proposito' ? (editForm.accountId || null) : null,
        target_amount: editForm.targetAmount ? Number(editForm.targetAmount) : null,
        target_date: editForm.targetDate || null,
      })
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  function handleArchive(id, name) {
    setConfirmArchive({ id, name })
  }

  async function doArchive() {
    const target = confirmArchive
    setConfirmArchive(null)
    try {
      await archiveSavingsGoal(target.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // El selector de cuenta de origen (y la transacción real que descuenta de
  // ahí) solo aplica a metas 'puntual' — una 'proposito' ya mide su avance
  // por el saldo real de la cuenta vinculada, así que crear una transacción
  // ahí contaría la misma plata dos veces (ver savingsApi.addContribution).
  async function handleAddContribution(goal) {
    const draft = contribForm[goal.id] ?? emptyContribForm
    if (!draft.amount) return
    try {
      let linkedTransactionId = null
      if (goal.kind === 'puntual' && draft.accountId) {
        const tx = await createManualTransaction({
          purpose: `Aporte a ${goal.name}`,
          amount: -Number(draft.amount),
          occurredAt: `${draft.date}T12:00:00Z`,
          accountId: draft.accountId,
          currency: accounts.find((a) => a.id === draft.accountId)?.currency || 'COP',
        })
        linkedTransactionId = tx.id
      }
      await addContribution(goal, {
        amount: Number(draft.amount), contributedAt: draft.date, note: draft.note,
        accountId: goal.kind === 'puntual' ? (draft.accountId || null) : null,
        linkedTransactionId,
      })
      setContribForm({ ...contribForm, [goal.id]: emptyContribForm })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  function handleDeleteContribution(goal, contribution) {
    setConfirmDeleteContribution({ goal, contribution })
  }

  async function doDeleteContribution() {
    const target = confirmDeleteContribution
    setConfirmDeleteContribution(null)
    try {
      await deleteContribution(target.goal, target.contribution)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  if (error) return <p style={{ color: 'var(--status-critical)' }}>Error cargando metas de ahorro: {error}</p>
  if (!goals) return <p style={{ color: 'var(--text-muted)' }}>Cargando metas de ahorro…</p>

  return (
    <div>
      <h1 className="page-title">Metas de ahorro</h1>

      <div className="grid-auto">
        {goals.map((g) => {
          const isEditing = editingId === g.id
          const goalContributions = contributions.filter((c) => c.savings_goal_id === g.id)
          const draft = contribForm[g.id] ?? emptyContribForm

          const linkedAccount = g.kind === 'proposito' ? accounts.find((a) => a.id === g.account_id) : null
          const goalCurrency = linkedAccount?.currency ?? 'COP'

          const current = g.kind === 'proposito' ? (balances[g.account_id] ?? 0) : Number(g.current_amount)
          const target = g.target_amount != null ? Number(g.target_amount) : null
          const pct = target ? Math.round((current / target) * 100) : null

          const remainingMonths = monthsUntil(g.target_date)
          const suggestedNext = target != null && remainingMonths
            ? Math.max(0, (target - current) / remainingMonths)
            : null

          const growthSeries = g.kind === 'proposito'
            ? (propositoTrends[g.id] ?? []).map((t) => t.balanceTotal)
            : (() => {
              let running = 0
              return [...goalContributions].sort((a, b) => a.contributed_at.localeCompare(b.contributed_at))
                .map((c) => { running += Number(c.amount); return running })
            })()
          const growthChartData = g.kind === 'proposito'
            ? (propositoTrends[g.id] ?? []).map((t) => ({ label: MONTH_LABELS[t.month - 1], value: t.balanceTotal }))
            : [...goalContributions].sort((a, b) => a.contributed_at.localeCompare(b.contributed_at))
              .reduce((acc, c) => {
                const running = (acc.at(-1)?.value ?? 0) + Number(c.amount)
                acc.push({ label: c.contributed_at, value: running })
                return acc
              }, [])

          const monthsAtPace = monthsToGoalAtCurrentPace(current, target, growthSeries)

          const editTarget = editForm.targetAmount ? Number(editForm.targetAmount) : null
          const editMonths = monthsUntil(editForm.targetDate)
          const editSuggested = isEditing && editTarget != null && editMonths
            ? Math.max(0, (editTarget - current) / editMonths)
            : null

          const plannedMonthly = plannedMonthlyAmount(g)
          const planVsActualRows = plannedMonthly != null
            ? buildPlanVsActualRows(g, lastNMonths(YEAR, MONTH, TREND_MONTHS), goalContributions, propositoTrends[g.id], plannedMonthly)
            : null

          return (
            <Card key={g.id} className="span-3">
              {isEditing ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleEditSave(g.id) }}
                  className={styles.editForm}
                >
                  <EditHeader
                    avatar={editForm.name?.trim() ? editForm.name.trim().charAt(0).toUpperCase() : '?'}
                    caption="Editando meta"
                    badge={g.kind === 'proposito' ? 'Con propósito' : 'Puntual'} badgeTone="accent"
                  >
                    <Field label="Nombre de la meta">
                      <input
                        autoFocus value={editForm.name} className={inputClass}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        placeholder="Ej. Viaje, fondo de emergencia"
                      />
                    </Field>
                  </EditHeader>

                  {g.kind === 'proposito' && (
                    <Field label="Cuenta vinculada" hint="Su saldo es el avance de la meta">
                      <ChipPicker
                        options={hijas.map((h) => ({ value: h.id, label: h.name }))}
                        value={editForm.accountId} allowClear
                        onChange={(accountId) => setEditForm({ ...editForm, accountId })}
                      />
                    </Field>
                  )}

                  <FieldRow>
                    <Field label="Meta (opcional)" hint={`En ${goalCurrency}`}>
                      <input
                        type="number" step="any" placeholder="0" value={editForm.targetAmount} className={inputClass}
                        onChange={(e) => setEditForm({ ...editForm, targetAmount: e.target.value })}
                      />
                    </Field>
                    <Field label="Fecha objetivo">
                      <input
                        type="date" value={editForm.targetDate} className={inputClass}
                        onChange={(e) => setEditForm({ ...editForm, targetDate: e.target.value })}
                      />
                    </Field>
                  </FieldRow>

                  {editTarget != null && editTarget > 0 && (
                    <MeterPreview pct={Math.round((current / editTarget) * 100)} color="var(--series-5)">
                      {Math.round((current / editTarget) * 100)}% completado — llevás {formatByCurrency(current, goalCurrency)}{' '}
                      de {formatByCurrency(editTarget, goalCurrency)}
                    </MeterPreview>
                  )}
                  <InfoCard>
                    {editSuggested != null
                      ? `Para llegar antes de ${editForm.targetDate} necesitás aportar ~${formatByCurrency(editSuggested, goalCurrency)}/mes.`
                      : 'Con un monto y una fecha objetivo te calculo cuánto aportar por mes.'}
                  </InfoCard>

                  <EditActions
                    disabled={!editForm.name?.trim()} onCancel={() => setEditingId(null)}
                    onDelete={() => handleArchive(g.id, g.name)} deleteLabel="Eliminar meta"
                  />
                </form>
              ) : (
                <div
                  className={styles.cardHeader} role="button" tabIndex={0}
                  onClick={() => startEdit(g)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(g) } }}
                >
                  <span className={styles.avatar}>{g.name.charAt(0).toUpperCase()}</span>
                  <div className={styles.cardHeaderText}>
                    <h2 className={styles.cardName}>{g.name}</h2>
                    <span className={styles.cardSubtitle}>
                      {g.kind === 'proposito' ? `Ahorro con propósito — cuenta ${g.accounts?.name ?? '—'}` : 'Meta puntual'}
                    </span>
                  </div>
                  <button
                    type="button" className={styles.deleteLink}
                    onClick={(e) => { e.stopPropagation(); handleArchive(g.id, g.name) }}
                  >
                    Eliminar
                  </button>
                </div>
              )}

              {!isEditing && (
              <>

              <div style={{ font: 'var(--font-title)', marginBottom: 4 }}>{formatByCurrency(current, goalCurrency)}</div>
              <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginBottom: 8 }}>
                {target != null ? `de ${formatByCurrency(target, goalCurrency)}` : 'sin monto objetivo definido'}
                {g.target_date ? ` · antes de ${g.target_date}` : ''}
              </div>

              {pct != null && (
                <>
                  <div style={{ height: 6, background: 'var(--gridline)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, height: '100%', background: 'var(--series-5)' }} />
                  </div>
                  <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '4px 0 var(--space-1)' }}>{pct}% completado</div>
                </>
              )}

              {suggestedNext != null && (
                <div style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                  Aporte sugerido: ~{formatByCurrency(suggestedNext, goalCurrency)}/mes para llegar antes de {g.target_date}
                </div>
              )}
              {monthsAtPace != null && (
                <div style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
                  A este ritmo, la cumplirías en ~{monthsAtPace} mes(es)
                </div>
              )}

              {growthChartData.length > 1 && (
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={growthChartData}>
                    <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={42} tickFormatter={formatCompact} />
                    <Tooltip formatter={(v) => formatByCurrency(v, goalCurrency)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                    <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} name="Acumulado" />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {planVsActualRows && (
                <>
                  <h3 style={{ font: 'var(--font-subheadline)', fontWeight: 600, margin: 'var(--space-1) 0 8px' }}>
                    Planeado vs. aportado (últimos {TREND_MONTHS} meses)
                  </h3>
                  <div className="table-scroll" style={{ marginBottom: 'var(--space-1)' }}>
                  <table className="simple-table">
                    <thead><tr><th>Mes</th><th>Planeado</th><th>Aportado real</th></tr></thead>
                    <tbody>
                      {planVsActualRows.map((r) => (
                        <tr key={r.label}>
                          <td>{r.label}</td>
                          <td className="amount-cell">{formatByCurrency(r.planeado, goalCurrency)}</td>
                          <td className="amount-cell" style={{ color: r.aportado != null && r.aportado < r.planeado ? 'var(--status-warning)' : 'inherit' }}>
                            {r.aportado != null ? formatByCurrency(r.aportado, goalCurrency) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </>
              )}

              <h3 style={{ font: 'var(--font-subheadline)', fontWeight: 600, margin: 'var(--space-1) 0 8px' }}>
                Historial de aportes {g.kind === 'proposito' && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(anotación — no afecta el saldo, que viene de la cuenta)</span>}
              </h3>
              <div className="table-scroll" style={{ marginBottom: 'var(--space-1)' }}>
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Fecha</th><th>Monto</th>
                    {g.kind === 'puntual' && <th>Cuenta</th>}
                    <th>Nota</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {goalContributions.map((c) => (
                    <tr key={c.id}>
                      <td>{c.contributed_at}</td>
                      <td className="amount-cell">{formatCOP(c.amount)}</td>
                      {g.kind === 'puntual' && (
                        <td>{c.account_id ? (accounts.find((a) => a.id === c.account_id)?.name ?? '—') : 'Dinero externo'}</td>
                      )}
                      <td>{c.note ?? '—'}</td>
                      <td>
                        <button onClick={() => handleDeleteContribution(g, c)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                  {goalContributions.length === 0 && (
                    <tr><td colSpan={g.kind === 'puntual' ? 5 : 4} style={{ color: 'var(--text-muted)' }}>Sin aportes registrados todavía.</td></tr>
                  )}
                </tbody>
              </table>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <input type="date" value={draft.date} onChange={(e) => setContribForm({ ...contribForm, [g.id]: { ...draft, date: e.target.value } })} style={formInput} />
                <input type="number" placeholder="Monto" value={draft.amount} onChange={(e) => setContribForm({ ...contribForm, [g.id]: { ...draft, amount: e.target.value } })} style={{ ...formInput, width: 120 }} />
                {g.kind === 'puntual' && (
                  <select
                    value={draft.accountId} onChange={(e) => setContribForm({ ...contribForm, [g.id]: { ...draft, accountId: e.target.value } })}
                    style={{ ...formInput, flex: '1 1 150px', minWidth: 0 }}
                  >
                    <option value="">Dinero externo (no descuenta de ninguna cuenta)</option>
                    {hijas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
                <input placeholder="Nota (opcional)" value={draft.note} onChange={(e) => setContribForm({ ...contribForm, [g.id]: { ...draft, note: e.target.value } })} style={{ ...formInput, flex: '1 1 140px' }} />
                <button
                  onClick={() => handleAddContribution(g)}
                  style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600 }}
                >
                  Agregar aporte
                </button>
              </div>
              </>
              )}
            </Card>
          )
        })}

        {goals.length === 0 && (
          <Card className="span-3"><p style={{ color: 'var(--text-muted)' }}>Aún no hay metas de ahorro registradas.</p></Card>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmArchive}
        title={`¿Eliminar la meta "${confirmArchive?.name}"?`}
        message="Se archiva, no se pierde el historial."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doArchive}
        onCancel={() => setConfirmArchive(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteContribution}
        title="¿Eliminar este aporte?"
        message="Si la meta es puntual, el monto acumulado se ajusta automáticamente."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doDeleteContribution}
        onCancel={() => setConfirmDeleteContribution(null)}
      />
    </div>
  )
}

const formInput = { minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }
