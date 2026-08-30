import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import StatTile from '../components/ui/StatTile.jsx'
import { formatCOP } from '../lib/format.js'
import { listAccounts, fetchBalancesForMonth } from '../lib/accountsApi.js'
import { getRate, toCOP } from '../lib/exchangeRatesApi.js'
import {
  listDebts, createDebt, updateDebt, archiveDebt,
  listInstallments, createInstallment, deleteInstallment, toggleInstallmentPaid,
  createInstallmentsBulk, generateAmortizationSchedule, deleteUnpaidInstallments,
} from '../lib/debtsApi.js'

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1

const emptyDebtForm = { creditorName: '', totalAmount: '', remainingAmount: '', interestRate: '', monthlyPayment: '', termMonths: '', startDate: '' }

function monthsLeft(remaining, monthlyPayment) {
  if (!monthlyPayment || monthlyPayment <= 0) return null
  return Math.ceil(Number(remaining) / Number(monthlyPayment))
}

function projectedPayoffDate(remaining, monthlyPayment) {
  const n = monthsLeft(remaining, monthlyPayment)
  if (n == null) return null
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
}

export default function Deudas() {
  const [debts, setDebts] = useState(null)
  const [installments, setInstallments] = useState([])
  const [patrimonio, setPatrimonio] = useState(0)
  const [rate, setRate] = useState(null)
  const [error, setError] = useState(null)

  const [form, setForm] = useState(emptyDebtForm)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(emptyDebtForm)
  const [installmentForm, setInstallmentForm] = useState({}) // debtId -> { dueDate, amount }
  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null
  const [confirmRegenerate, setConfirmRegenerate] = useState(null) // { debt, debtInstallments, unpaidCount } | null

  async function reload() {
    try {
      const rows = await listDebts()
      setDebts(rows)
      setInstallments(await listInstallments(rows.map((d) => d.id)))

      const accounts = await listAccounts()
      const [{ balances }, currentRate] = await Promise.all([
        fetchBalancesForMonth(accounts, YEAR, MONTH),
        getRate(),
      ])
      setRate(currentRate)
      setPatrimonio(accounts.reduce((sum, a) => sum + toCOP(balances[a.id] ?? 0, a.currency, currentRate?.rate), 0))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [])

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.creditorName.trim() || !form.totalAmount || !form.remainingAmount) return
    setSaving(true)
    try {
      await createDebt({
        creditorName: form.creditorName.trim(),
        totalAmount: Number(form.totalAmount),
        remainingAmount: Number(form.remainingAmount),
        interestRate: form.interestRate ? Number(form.interestRate) : null,
        monthlyPayment: form.monthlyPayment ? Number(form.monthlyPayment) : null,
        termMonths: form.termMonths ? Number(form.termMonths) : null,
        startDate: form.startDate,
      })
      setForm(emptyDebtForm)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(d) {
    setEditingId(d.id)
    setEditForm({
      creditorName: d.creditor_name, totalAmount: d.total_amount, remainingAmount: d.remaining_amount,
      interestRate: d.interest_rate ?? '', monthlyPayment: d.monthly_payment ?? '',
      termMonths: d.term_months ?? '', startDate: d.start_date ?? '',
    })
  }

  async function handleEditSave(id) {
    try {
      await updateDebt(id, {
        creditor_name: editForm.creditorName.trim(),
        total_amount: Number(editForm.totalAmount),
        remaining_amount: Number(editForm.remainingAmount),
        interest_rate: editForm.interestRate ? Number(editForm.interestRate) : null,
        monthly_payment: editForm.monthlyPayment ? Number(editForm.monthlyPayment) : null,
        term_months: editForm.termMonths ? Number(editForm.termMonths) : null,
        start_date: editForm.startDate || null,
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
      await archiveDebt(target.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddInstallment(debtId) {
    const draft = installmentForm[debtId]
    if (!draft?.dueDate || !draft?.amount) return
    try {
      await createInstallment(debtId, draft.dueDate, Number(draft.amount))
      setInstallmentForm({ ...installmentForm, [debtId]: { dueDate: '', amount: '' } })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleToggleInstallment(inst, debt) {
    try {
      const nowPaid = !inst.paid
      const { remainingAmount, scheduleSyncedRemainingAmount } = await toggleInstallmentPaid(inst, debt)
      // Actualiza estado local en vez de recargar deudas/cuotas/cuentas/saldos
      // completos — marcar una cuota no cambia nada de eso salvo el restante
      // de esta deuda, y un reload() completo se sentía lento en móvil.
      setInstallments((prev) => prev.map((i) => (i.id === inst.id
        ? { ...i, paid: nowPaid, paid_at: nowPaid ? new Date().toISOString() : null }
        : i)))
      setDebts((prev) => prev.map((d) => (d.id === debt.id
        ? { ...d, remaining_amount: remainingAmount, schedule_synced_remaining_amount: scheduleSyncedRemainingAmount }
        : d)))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeleteInstallment(id) {
    try {
      await deleteInstallment(id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleGenerateSchedule(d) {
    try {
      const rows = generateAmortizationSchedule(d.remaining_amount, d.interest_rate, d.term_months, new Date())
      await createInstallmentsBulk(d.id, rows)
      // Guarda el saldo restante en el momento de generar el cronograma —
      // la reconciliación compara este valor contra remaining_amount para
      // detectar si el saldo cambió por fuera del flujo de cuotas.
      await updateDebt(d.id, { schedule_synced_remaining_amount: d.remaining_amount })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // Reemplaza solo las cuotas no pagadas por un cronograma nuevo (ej. cambió
  // la tasa o el plazo) — las cuotas ya pagadas quedan intactas como
  // historial, y el plazo restante se recalcula descontando cuántas cuotas
  // ya se pagaron del term_months original.
  function handleRegenerateSchedule(d, debtInstallments) {
    const unpaidCount = debtInstallments.filter((i) => !i.paid).length
    if (unpaidCount > 0) {
      setConfirmRegenerate({ debt: d, debtInstallments, unpaidCount })
      return
    }
    doRegenerateSchedule(d, debtInstallments)
  }

  async function doRegenerateSchedule(d, debtInstallments) {
    try {
      const paidCount = debtInstallments.length - debtInstallments.filter((i) => !i.paid).length
      await deleteUnpaidInstallments(d.id)
      const remainingTerm = Math.max(1, d.term_months - paidCount)
      const rows = generateAmortizationSchedule(d.remaining_amount, d.interest_rate, remainingTerm, new Date())
      await createInstallmentsBulk(d.id, rows)
      await updateDebt(d.id, { schedule_synced_remaining_amount: d.remaining_amount })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleConfirmRegenerate() {
    const target = confirmRegenerate
    setConfirmRegenerate(null)
    await doRegenerateSchedule(target.debt, target.debtInstallments)
  }

  if (error) return <p style={{ color: 'var(--status-critical)' }}>Error cargando deudas: {error}</p>
  if (!debts) return <p style={{ color: 'var(--text-muted)' }}>Cargando deudas…</p>

  const deudaTotal = debts.reduce((sum, d) => sum + toCOP(Number(d.remaining_amount), d.currency, rate?.rate), 0)
  const healthData = [
    { name: 'Patrimonio', value: patrimonio },
    { name: 'Deuda total', value: deudaTotal },
  ]

  return (
    <div>
      <h1 className="page-title">Deudas / préstamos</h1>

      <div className="kpi-row" style={{ marginBottom: 'var(--space-2)' }}>
        <Card><StatTile label="Deuda total" value={formatCOP(deudaTotal)} /></Card>
        <Card><StatTile label="Patrimonio total" value={formatCOP(patrimonio)} /></Card>
        <Card>
          <StatTile
            label="Deuda / patrimonio"
            value={patrimonio > 0 ? `${Math.round((deudaTotal / patrimonio) * 100)}%` : '—'}
          />
        </Card>
      </div>

      <div className="grid-auto">
        <Card title="Salud financiera general" className="span-3">
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={healthData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--gridline)" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--gridline)' }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                <Cell fill="var(--series-1)" />
                <Cell fill="var(--status-critical)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {debts.map((d) => {
          const pctPaid = d.total_amount > 0 ? Math.round(((d.total_amount - d.remaining_amount) / d.total_amount) * 100) : 0
          const isEditing = editingId === d.id
          const debtInstallments = installments.filter((i) => i.debt_id === d.id)
          const upcoming = debtInstallments.filter((i) => !i.paid)
          const draft = installmentForm[d.id] ?? { dueDate: '', amount: '' }
          const payoff = projectedPayoffDate(d.remaining_amount, d.monthly_payment)
          const scheduleDrift = d.schedule_synced_remaining_amount != null
            ? Number(d.remaining_amount) - Number(d.schedule_synced_remaining_amount)
            : 0
          const isScheduleStale = d.schedule_synced_remaining_amount != null && Math.abs(scheduleDrift) > 1

          return (
            <Card key={d.id} className="span-3">
              {isEditing ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-2)' }}>
                  <input placeholder="Acreedor" value={editForm.creditorName} onChange={(e) => setEditForm({ ...editForm, creditorName: e.target.value })} style={{ ...formInput, flex: '1 1 160px' }} />
                  <input type="number" placeholder="Monto total" value={editForm.totalAmount} onChange={(e) => setEditForm({ ...editForm, totalAmount: e.target.value })} style={{ ...formInput, width: 130 }} />
                  <input type="number" placeholder="Restante" value={editForm.remainingAmount} onChange={(e) => setEditForm({ ...editForm, remainingAmount: e.target.value })} style={{ ...formInput, width: 130 }} />
                  <input type="number" placeholder="Cuota mensual" value={editForm.monthlyPayment} onChange={(e) => setEditForm({ ...editForm, monthlyPayment: e.target.value })} style={{ ...formInput, width: 130 }} />
                  <input type="number" placeholder="Tasa % mensual (opcional)" value={editForm.interestRate} onChange={(e) => setEditForm({ ...editForm, interestRate: e.target.value })} style={{ ...formInput, width: 150 }} />
                  <input type="number" placeholder="Plazo (# cuotas)" value={editForm.termMonths} onChange={(e) => setEditForm({ ...editForm, termMonths: e.target.value })} style={{ ...formInput, width: 130 }} />
                  <button onClick={() => handleEditSave(d.id)} style={{ color: 'var(--series-1)', fontWeight: 600 }}>Guardar</button>
                  <button onClick={() => setEditingId(null)} style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                  <h2 style={{ font: 'var(--font-headline)', margin: 0 }}>{d.creditor_name}</h2>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => startEdit(d)} style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>Editar</button>
                    <button onClick={() => handleArchive(d.id, d.creditor_name)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                  </div>
                </div>
              )}

              <div style={{ font: 'var(--font-title)', marginBottom: 4 }}>{formatCOP(d.remaining_amount)} restantes</div>
              <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginBottom: 8 }}>
                de {formatCOP(d.total_amount)}
                {d.monthly_payment ? ` — cuota mensual ${formatCOP(d.monthly_payment)}` : ''}
                {d.interest_rate ? ` — tasa ${d.interest_rate}% mensual` : ''}
                {d.term_months ? ` — plazo ${d.term_months} cuotas` : ''}
                {payoff ? ` — proyección de pago: ${payoff}` : ''}
              </div>
              <div style={{ height: 6, background: 'var(--gridline)', borderRadius: 3, overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
                <div style={{ width: `${Math.min(Math.max(pctPaid, 0), 100)}%`, height: '100%', background: 'var(--series-3)' }} />
              </div>

              {isScheduleStale && (
                <p style={{ font: 'var(--font-caption)', color: 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
                  El saldo restante cambió por fuera del registro de cuotas ({formatCOP(scheduleDrift)}) — el cronograma puede estar desactualizado. Usa "Regenerar cuotas pendientes" si quieres que lo refleje.
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 8px' }}>
                <h3 style={{ font: 'var(--font-subheadline)', fontWeight: 600, margin: 0 }}>Cuotas ({upcoming.length} pendientes)</h3>
                {d.interest_rate && d.term_months && debtInstallments.length === 0 && (
                  <button
                    onClick={() => handleGenerateSchedule(d)}
                    style={{ font: 'var(--font-caption)', color: 'var(--series-1)', fontWeight: 600 }}
                  >
                    Generar cuotas automáticamente ({d.term_months}, sistema francés)
                  </button>
                )}
                {d.interest_rate && d.term_months && debtInstallments.length > 0 && (
                  <button
                    onClick={() => handleRegenerateSchedule(d, debtInstallments)}
                    style={{ font: 'var(--font-caption)', color: 'var(--series-1)', fontWeight: 600 }}
                  >
                    Regenerar cuotas pendientes
                  </button>
                )}
              </div>
              <div className="table-scroll" style={{ marginBottom: 'var(--space-1)' }}>
              <table className="simple-table">
                <thead><tr><th>Vence</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {debtInstallments.map((i) => (
                    <tr key={i.id}>
                      <td>{i.due_date}</td>
                      <td>{formatCOP(i.amount)}</td>
                      <td>
                        <button onClick={() => handleToggleInstallment(i, d)} style={{ color: i.paid ? 'var(--status-good)' : 'var(--status-warning)', fontWeight: 600 }}>
                          {i.paid ? 'Pagada' : 'Pendiente'}
                        </button>
                      </td>
                      <td><button onClick={() => handleDeleteInstallment(i.id)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button></td>
                    </tr>
                  ))}
                  {debtInstallments.length === 0 && (
                    <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>Sin cuotas registradas todavía.</td></tr>
                  )}
                </tbody>
              </table>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="date" value={draft.dueDate}
                  onChange={(e) => setInstallmentForm({ ...installmentForm, [d.id]: { ...draft, dueDate: e.target.value } })}
                  style={formInput}
                />
                <input
                  type="number" placeholder="Monto" value={draft.amount}
                  onChange={(e) => setInstallmentForm({ ...installmentForm, [d.id]: { ...draft, amount: e.target.value } })}
                  style={{ ...formInput, width: 120 }}
                />
                <button
                  onClick={() => handleAddInstallment(d.id)}
                  style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600 }}
                >
                  Agregar cuota
                </button>
              </div>
            </Card>
          )
        })}

        <Card title="Agregar deuda" className="span-3">
          <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input placeholder="Acreedor" value={form.creditorName} onChange={(e) => setForm({ ...form, creditorName: e.target.value })} style={{ ...formInput, flex: '1 1 160px' }} />
            <input type="number" placeholder="Monto total" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} style={{ ...formInput, width: 130 }} />
            <input type="number" placeholder="Restante" value={form.remainingAmount} onChange={(e) => setForm({ ...form, remainingAmount: e.target.value })} style={{ ...formInput, width: 130 }} />
            <input type="number" placeholder="Cuota mensual" value={form.monthlyPayment} onChange={(e) => setForm({ ...form, monthlyPayment: e.target.value })} style={{ ...formInput, width: 130 }} />
            <input type="number" placeholder="Tasa % mensual (opcional)" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} style={{ ...formInput, width: 150 }} />
            <input type="number" placeholder="Plazo (# cuotas, opcional)" value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: e.target.value })} style={{ ...formInput, width: 150 }} />
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} style={formInput} />
            <button type="submit" disabled={saving} style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              Agregar
            </button>
          </form>
        </Card>

        {debts.length === 0 && (
          <Card className="span-3"><p style={{ color: 'var(--text-muted)' }}>Aún no hay deudas registradas.</p></Card>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmArchive}
        title={`¿Eliminar la deuda "${confirmArchive?.name}"?`}
        message="Se archiva, no se pierde el historial."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doArchive}
        onCancel={() => setConfirmArchive(null)}
      />

      <ConfirmDialog
        open={!!confirmRegenerate}
        title="¿Regenerar cuotas pendientes?"
        message={confirmRegenerate ? `Esto reemplaza las ${confirmRegenerate.unpaidCount} cuota(s) pendientes por un nuevo cronograma. Las cuotas ya pagadas no se tocan.` : ''}
        confirmLabel="Regenerar"
        onConfirm={handleConfirmRegenerate}
        onCancel={() => setConfirmRegenerate(null)}
      />
    </div>
  )
}

const formInput = { minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }
