import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'
import { estimateCategoryAxisWidth } from '../lib/chartUtils.js'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import StatTile from '../components/ui/StatTile.jsx'
import { Field, FieldRow, InfoCard, ChipPicker, EditHeader, EditActions, EditSheet, MeterPreview, inputClass } from '../components/ui/FormKit.jsx'
import { formatCOP, formatByCurrency } from '../lib/format.js'
import { listAccounts, fetchBalancesForMonth, totalBalanceInCOP } from '../lib/accountsApi.js'
import { getRates, toCOP } from '../lib/exchangeRatesApi.js'
import { listCategories } from '../lib/categoriesApi.js'
import { createManualTransaction, listUnreviewedLoanTransactions, markLoanTransactionReviewed } from '../lib/transactionsApi.js'
import {
  listDebts, updateDebt, archiveDebt,
  listInstallments, createInstallment, deleteInstallment, toggleInstallmentPaid,
  createInstallmentsBulk, generateAmortizationSchedule, deleteUnpaidInstallments,
  addAbono, deleteAbono,
} from '../lib/debtsApi.js'
import styles from './Deudas.module.css'

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1

const RELATIONSHIP_OPTIONS = [
  { value: 'amigo', label: 'Amigo' },
  { value: 'familiar', label: 'Familiar' },
  { value: 'companero', label: 'Compañero' },
  { value: 'pareja', label: 'Pareja' },
  { value: 'conocido', label: 'Conocido' },
  { value: 'otro', label: 'Otro' },
]

function relationshipLabel(value) {
  return RELATIONSHIP_OPTIONS.find((o) => o.value === value)?.label ?? null
}

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

// Badge "vence en N días" / "venció hace N días" para préstamos dados con
// fecha esperada de pago — solo se muestra dentro de los próximos 7 días o
// ya vencido, igual umbral que el borrador de referencia (posible/index.html).
function diasVence(iso) {
  const d = Math.round((new Date(iso) - new Date()) / 86400000)
  if (d < 0) return { text: `Venció hace ${Math.abs(d)} día${Math.abs(d) === 1 ? '' : 's'}`, level: 'critical' }
  if (d === 0) return { text: 'Vence hoy', level: 'warning' }
  if (d <= 7) return { text: `Vence en ${d} día${d === 1 ? '' : 's'}`, level: 'warning' }
  return null
}

function tabButtonStyle(active) {
  return {
    minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10,
    background: active ? 'var(--series-1)' : 'transparent',
    border: active ? 'none' : '1px solid var(--border-hairline)',
    color: active ? '#fff' : 'var(--text-secondary)', fontWeight: 600,
  }
}

export default function Deudas() {
  const [debts, setDebts] = useState(null)
  const [installments, setInstallments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [patrimonio, setPatrimonio] = useState(0)
  const [rates, setRates] = useState([])
  const [error, setError] = useState(null)

  const [activeDirection, setActiveDirection] = useState('debo')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [installmentForm, setInstallmentForm] = useState({}) // debtId -> { dueDate, amount, accountId }
  const [savingAbono, setSavingAbono] = useState(null) // debtId | null
  const [accountByInstallment, setAccountByInstallment] = useState({}) // installmentId -> accountId ('' = dinero externo), solo cuotas 'debo' aún no pagadas
  const [togglingInstallmentId, setTogglingInstallmentId] = useState(null)
  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name, direction } | null
  const [confirmRegenerate, setConfirmRegenerate] = useState(null) // { debt, debtInstallments, unpaidCount } | null
  const [confirmComplete, setConfirmComplete] = useState(null) // { debt } | null

  const [prestamoCategoryId, setPrestamoCategoryId] = useState(null)
  const [loanCandidates, setLoanCandidates] = useState([])

  async function reload() {
    try {
      const rows = await listDebts()
      setDebts(rows)
      setInstallments(await listInstallments(rows.map((d) => d.id)))

      const [accountsList, categories] = await Promise.all([listAccounts(), listCategories()])
      setAccounts(accountsList)
      const prestamoCategory = categories.find((c) => c.name.trim().toLowerCase() === 'préstamo')
      setPrestamoCategoryId(prestamoCategory?.id ?? null)
      setLoanCandidates(await listUnreviewedLoanTransactions(prestamoCategory?.id ?? null))

      const [{ balances }, currentRates] = await Promise.all([
        fetchBalancesForMonth(accountsList, YEAR, MONTH),
        getRates(),
      ])
      setRates(currentRates)
      setPatrimonio(accountsList.reduce((sum, a) => sum + totalBalanceInCOP(a, balances, currentRates, toCOP), 0))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [])

  // "Agregar deuda"/"Registrar préstamo" vive en Ajustes → Deudas desde acá
  // (mismo criterio que "Cuentas" — ver CLAUDE.md), así que esta página, que
  // sigue montada debajo del panel de Ajustes mientras se crea, necesita
  // enterarse cuando eso pasa para refrescar la lista sin recargar toda la
  // página — mismo patrón de evento global que `dashboard:transactions-changed`.
  useEffect(() => {
    window.addEventListener('dashboard:debts-changed', reload)
    return () => window.removeEventListener('dashboard:debts-changed', reload)
  }, [])

  // "Precargar" ya no llena un formulario en esta misma página — el
  // formulario de creación se mudó a Ajustes → Deudas (ver SettingsPanel.jsx)
  // — así que esto abre ese panel en la sección correcta con los datos reales
  // del movimiento ya listos para confirmar, vía el mismo tipo de evento
  // global que usa `onOpenSearch`/`dashboard:transactions-changed` para que
  // dos componentes hermanos bajo AppShell se hablen sin un store global.
  function handlePrefillFromCandidate(tx) {
    window.dispatchEvent(new CustomEvent('dashboard:open-settings', {
      detail: {
        section: 'deudas',
        prefill: {
          direction: 'me_deben',
          creditorName: tx.purpose,
          totalAmount: String(Math.abs(Number(tx.amount))),
          remainingAmount: String(Math.abs(Number(tx.amount))),
          startDate: tx.occurred_at.slice(0, 10),
          currency: tx.currency || 'COP',
          sourceTransactionId: tx.id,
        },
      },
    }))
  }

  async function handleDismissCandidate(id) {
    try {
      await markLoanTransactionReviewed(id)
      setLoanCandidates((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(d) {
    setEditingId(d.id)
    setEditForm({
      creditorName: d.creditor_name, totalAmount: d.total_amount, remainingAmount: d.remaining_amount,
      interestRate: d.interest_rate ?? '', monthlyPayment: d.monthly_payment ?? '',
      termMonths: d.term_months ?? '', startDate: d.start_date ?? '',
      counterpartyRelationship: d.counterparty_relationship ?? '', contactInfo: d.contact_info ?? '',
      expectedPaymentDate: d.expected_payment_date ?? '', notes: d.notes ?? '',
    })
  }

  async function handleEditSave(id) {
    try {
      const original = debts.find((d) => d.id === id)
      const fields = {
        creditor_name: editForm.creditorName.trim(),
        total_amount: Number(editForm.totalAmount),
        remaining_amount: Number(editForm.remainingAmount),
        interest_rate: editForm.interestRate ? Number(editForm.interestRate) : null,
        monthly_payment: editForm.monthlyPayment ? Number(editForm.monthlyPayment) : null,
        term_months: editForm.termMonths ? Number(editForm.termMonths) : null,
        start_date: editForm.startDate || null,
        counterparty_relationship: editForm.counterpartyRelationship || null,
        contact_info: editForm.contactInfo || null,
        expected_payment_date: editForm.expectedPaymentDate || null,
        notes: editForm.notes || null,
      }
      await updateDebt(id, fields)
      setEditingId(null)
      await reload()

      // Reconciliación automática: si esta edición desincronizó el saldo (o
      // cambió el monto total, que hoy no deja ninguna señal de drift
      // persistida) contra el cronograma ya generado, dispara el mismo flujo
      // de "Regenerar cuotas pendientes" — con su mismo ConfirmDialog si hay
      // cuotas pendientes de por medio, en vez de exigir un click aparte.
      const merged = { ...original, ...fields }
      const synced = merged.schedule_synced_remaining_amount
      const remainingDrifted = synced != null && Math.abs(Number(merged.remaining_amount) - Number(synced)) > 1
      const totalChanged = Number(original.total_amount) !== Number(fields.total_amount)
      if (synced != null && (remainingDrifted || totalChanged) && merged.interest_rate != null && merged.term_months) {
        const debtInstallments = installments.filter((i) => i.debt_id === id)
        handleRegenerateSchedule(merged, debtInstallments)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  function handleArchive(id, name, direction) {
    setConfirmArchive({ id, name, direction })
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

  // Un abono de 'me_deben' es plata que YA llegó, así que se registra en un
  // solo paso (fecha + monto + cuenta destino opcional) en vez del ida y
  // vuelta agregar/marcar-pagada que usa 'debo' — ver addAbono en debtsApi.js.
  // Si el usuario indicó cuenta destino, primero crea el movimiento real ahí
  // (categoría "Préstamo", monto positivo) y enlaza su id al abono para poder
  // revertirlo si se borra; si no, el abono queda registrado sin afectar
  // ninguna cuenta, igual que un movimiento "pendiente de banco".
  async function handleAddAbono(debt) {
    const draft = installmentForm[debt.id]
    if (!draft?.dueDate || !draft?.amount) return
    setSavingAbono(debt.id)
    try {
      let linkedTransactionId = null
      if (draft.accountId) {
        const tx = await createManualTransaction({
          purpose: `Abono de ${debt.creditor_name}`,
          amount: Number(draft.amount),
          occurredAt: `${draft.dueDate}T12:00:00Z`,
          categoryId: prestamoCategoryId,
          accountId: draft.accountId,
        })
        linkedTransactionId = tx.id
      }
      const { remainingAmount } = await addAbono(debt, {
        date: draft.dueDate, amount: Number(draft.amount), linkedTransactionId, accountId: draft.accountId || null,
      })
      setInstallmentForm({ ...installmentForm, [debt.id]: { dueDate: '', amount: '', accountId: '' } })
      await reload()
      if (remainingAmount <= 0) setConfirmComplete({ debt })
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingAbono(null)
    }
  }

  async function handleConfirmCompleteArchive() {
    const target = confirmComplete
    setConfirmComplete(null)
    try {
      await archiveDebt(target.debt.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // Si se marca pagada y se eligió una cuenta de origen, primero crea la
  // transacción real (mismo patrón que handleAddAbono) y pasa su id a
  // toggleInstallmentPaid para poder revertirla si se desmarca — si se
  // desmarca, toggleInstallmentPaid resuelve sola el revert a partir de
  // installment.linked_transaction_id, sin que este handler necesite saber
  // cuál era.
  async function handleToggleInstallment(inst, debt) {
    setTogglingInstallmentId(inst.id)
    try {
      const nowPaid = !inst.paid
      let linkedTransactionId = null
      let accountId = null
      if (nowPaid) {
        accountId = accountByInstallment[inst.id] || null
        if (accountId) {
          const tx = await createManualTransaction({
            purpose: `Cuota de ${debt.creditor_name}`,
            amount: -Number(inst.amount),
            occurredAt: `${inst.due_date}T12:00:00Z`,
            categoryId: prestamoCategoryId,
            accountId,
            currency: debt.currency,
          })
          linkedTransactionId = tx.id
        }
      }
      const { remainingAmount, scheduleSyncedRemainingAmount } = await toggleInstallmentPaid(inst, debt, { accountId, linkedTransactionId })
      // Actualiza estado local en vez de recargar deudas/cuotas/cuentas/saldos
      // completos — marcar una cuota no cambia nada de eso salvo el restante
      // de esta deuda, y un reload() completo se sentía lento en móvil.
      setInstallments((prev) => prev.map((i) => (i.id === inst.id
        ? {
          ...i, paid: nowPaid, paid_at: nowPaid ? new Date().toISOString() : null,
          account_id: nowPaid ? accountId : null, linked_transaction_id: nowPaid ? linkedTransactionId : null,
        }
        : i)))
      setDebts((prev) => prev.map((d) => (d.id === debt.id
        ? { ...d, remaining_amount: remainingAmount, schedule_synced_remaining_amount: scheduleSyncedRemainingAmount }
        : d)))
      if (accountByInstallment[inst.id] !== undefined) {
        setAccountByInstallment((prev) => { const next = { ...prev }; delete next[inst.id]; return next })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingInstallmentId(null)
    }
  }

  // Un abono ya recibido (direction = 'me_deben') se borra con deleteAbono,
  // que repone remaining_amount y revierte la transacción vinculada si tenía
  // cuenta destino — a diferencia de una cuota 'debo' sin pagar, que solo se
  // quita del cronograma sin tocar ningún saldo.
  async function handleDeleteInstallment(inst, debt) {
    try {
      if (debt.direction === 'me_deben') {
        await deleteAbono(inst, debt)
      } else {
        await deleteInstallment(inst.id)
      }
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

  const deudaDebo = debts.filter((d) => (d.direction || 'debo') === 'debo')
  const deudaTotal = deudaDebo.reduce((sum, d) => sum + toCOP(Number(d.remaining_amount), d.currency, rates), 0)
  const totalMeDeben = debts.filter((d) => d.direction === 'me_deben')
    .reduce((sum, d) => sum + toCOP(Number(d.remaining_amount), d.currency, rates), 0)
  const saldoNeto = totalMeDeben - deudaTotal
  const visibleDebts = debts.filter((d) => (d.direction || 'debo') === activeDirection)
  const editingDebt = editingId ? debts.find((d) => d.id === editingId) : null
  const editTotal = Number(editForm.totalAmount) || 0
  const editRemaining = Number(editForm.remainingAmount) || 0
  const editPctPaid = editTotal > 0 ? Math.round(((editTotal - editRemaining) / editTotal) * 100) : 0
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

      <Card title="Debo vs. me deben (informativo)" style={{ marginBottom: 'var(--space-2)' }}>
        <div className="kpi-row">
          <StatTile label="Debo" value={formatCOP(deudaTotal)} />
          <StatTile label="Me deben" value={formatCOP(totalMeDeben)} />
          <StatTile label="Saldo neto" value={formatCOP(saldoNeto)} />
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-2)' }}>
        <button onClick={() => setActiveDirection('debo')} style={tabButtonStyle(activeDirection === 'debo')}>Debo</button>
        <button onClick={() => setActiveDirection('me_deben')} style={tabButtonStyle(activeDirection === 'me_deben')}>Me deben</button>
      </div>

      {activeDirection === 'me_deben' && loanCandidates.length > 0 && (
        <Card title={`Préstamos detectados sin registrar (${loanCandidates.length})`} style={{ marginBottom: 'var(--space-2)' }}>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
            Movimientos importados de MonIA en la categoría "Préstamo" (dinero prestado que salió de una cuenta) que todavía no tienen un préstamo registrado acá — "Precargar" pone el nombre, el monto y la fecha en el formulario de abajo para que confirmes antes de guardar.
          </p>
          <div className="table-scroll">
            <table className="simple-table">
              <thead><tr><th>Fecha</th><th>Nombre</th><th>Monto</th><th></th></tr></thead>
              <tbody>
                {loanCandidates.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.occurred_at.slice(0, 10)}</td>
                    <td>{tx.purpose}</td>
                    <td className="amount-cell">{formatByCurrency(-Number(tx.amount), tx.currency)}</td>
                    <td style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handlePrefillFromCandidate(tx)} style={{ font: 'var(--font-caption)', color: 'var(--series-1)', fontWeight: 600 }}>Precargar</button>
                      <button onClick={() => handleDismissCandidate(tx.id)} style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>Ignorar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid-auto">
        <Card title="Salud financiera general" className="span-3">
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={healthData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={estimateCategoryAxisWidth(healthData.map((d) => d.name))} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--gridline)' }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                <Cell fill="var(--series-1)" />
                <Cell fill="var(--status-critical)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {visibleDebts.map((d) => {
          const pctPaid = d.total_amount > 0 ? Math.round(((d.total_amount - d.remaining_amount) / d.total_amount) * 100) : 0
          const debtInstallments = installments.filter((i) => i.debt_id === d.id)
          const upcoming = debtInstallments.filter((i) => !i.paid)
          const draft = installmentForm[d.id] ?? { dueDate: '', amount: '' }
          const payoff = projectedPayoffDate(d.remaining_amount, d.monthly_payment)
          const scheduleDrift = d.schedule_synced_remaining_amount != null
            ? Number(d.remaining_amount) - Number(d.schedule_synced_remaining_amount)
            : 0
          const isScheduleStale = d.schedule_synced_remaining_amount != null && Math.abs(scheduleDrift) > 1
          const cuotaLabel = d.direction === 'me_deben' ? 'Abonos' : 'Cuotas'
          const addCuotaLabel = d.direction === 'me_deben' ? 'Agregar abono' : 'Agregar cuota'
          const counterpartyLine = [relationshipLabel(d.counterparty_relationship), d.contact_info, d.notes].filter(Boolean).join(' — ')
          const dueBadge = d.direction === 'me_deben' && d.expected_payment_date && Number(d.remaining_amount) > 0
            ? diasVence(d.expected_payment_date)
            : null

          return (
            <Card key={d.id} className="span-3">
              <div
                className={styles.cardHeader} role="button" tabIndex={0}
                onClick={() => startEdit(d)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(d) } }}
              >
                <span className={`${styles.avatar} ${d.direction === 'me_deben' ? styles.avatarMeDeben : styles.avatarDebo}`}>
                  {d.creditor_name.charAt(0).toUpperCase()}
                </span>
                <div className={styles.cardHeaderText}>
                  <h2 className={styles.cardName}>{d.creditor_name}</h2>
                  <span className={styles.cardSubtitle}>
                    {d.direction === 'me_deben' ? 'Préstamo dado' : 'Deuda'} · {d.currency || 'COP'}
                  </span>
                </div>
                <button
                  type="button" className={styles.deleteLink}
                  onClick={(e) => { e.stopPropagation(); handleArchive(d.id, d.creditor_name, d.direction) }}
                >
                  Eliminar
                </button>
              </div>

              <div style={{ font: 'var(--font-title)', marginBottom: 4 }}>{formatByCurrency(d.remaining_amount, d.currency)} restantes</div>
              <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginBottom: 8 }}>
                de {formatByCurrency(d.total_amount, d.currency)}
                {d.monthly_payment ? ` — cuota mensual ${formatByCurrency(d.monthly_payment, d.currency)}` : ''}
                {d.interest_rate ? ` — tasa ${d.interest_rate}% mensual` : ''}
                {d.term_months ? ` — plazo ${d.term_months} cuotas` : ''}
                {payoff ? ` — proyección de pago: ${payoff}` : ''}
              </div>
              <div style={{ height: 6, background: 'var(--gridline)', borderRadius: 3, overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
                <div style={{ width: `${Math.min(Math.max(pctPaid, 0), 100)}%`, height: '100%', background: 'var(--series-3)' }} />
              </div>

              {counterpartyLine && (
                <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginBottom: 8 }}>{counterpartyLine}</div>
              )}

              {dueBadge && (
                <p style={{ font: 'var(--font-caption)', color: dueBadge.level === 'critical' ? 'var(--status-critical)' : 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
                  {dueBadge.text}
                </p>
              )}

              {isScheduleStale && (
                <p style={{ font: 'var(--font-caption)', color: 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
                  El saldo restante cambió por fuera del registro de cuotas ({formatByCurrency(scheduleDrift, d.currency)}) — el cronograma puede estar desactualizado. Usa "Regenerar cuotas pendientes" si quieres que lo refleje.
                </p>
              )}

              {d.direction === 'me_deben' ? (
                <>
                  <h3 style={{ font: 'var(--font-subheadline)', fontWeight: 600, margin: '0 0 8px' }}>{cuotaLabel} ({debtInstallments.length} recibidos)</h3>
                  <div className="table-scroll" style={{ marginBottom: 'var(--space-1)' }}>
                  <table className="simple-table">
                    <thead><tr><th>Fecha</th><th>Monto</th><th>Cuenta</th><th></th></tr></thead>
                    <tbody>
                      {debtInstallments.map((i) => (
                        <tr key={i.id}>
                          <td>{i.due_date}</td>
                          <td className="amount-cell">{formatByCurrency(i.amount, d.currency)}</td>
                          <td>{i.account_id ? (accounts.find((a) => a.id === i.account_id)?.name ?? '—') : 'Pendiente de banco'}</td>
                          <td><button onClick={() => handleDeleteInstallment(i, d)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button></td>
                        </tr>
                      ))}
                      {debtInstallments.length === 0 && (
                        <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>Sin abonos registrados todavía.</td></tr>
                      )}
                    </tbody>
                  </table>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
                    <select
                      value={draft.accountId ?? ''}
                      onChange={(e) => setInstallmentForm({ ...installmentForm, [d.id]: { ...draft, accountId: e.target.value } })}
                      style={{ ...formInput, flex: '1 1 150px', minWidth: 0 }}
                    >
                      <option value="">Pendiente de banco</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.kind === 'madre' ? `${a.name} (madre)` : a.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleAddAbono(d)}
                      disabled={savingAbono === d.id}
                      style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: savingAbono === d.id ? 0.6 : 1 }}
                    >
                      {addCuotaLabel}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 8px' }}>
                    <h3 style={{ font: 'var(--font-subheadline)', fontWeight: 600, margin: 0 }}>{cuotaLabel} ({upcoming.length} pendientes)</h3>
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
                    <thead><tr><th>Vence</th><th>Monto</th><th>Cuenta</th><th>Estado</th><th></th></tr></thead>
                    <tbody>
                      {debtInstallments.map((i) => (
                        <tr key={i.id}>
                          <td>{i.due_date}</td>
                          <td className="amount-cell">{formatByCurrency(i.amount, d.currency)}</td>
                          <td>
                            {i.paid ? (
                              i.account_id ? (accounts.find((a) => a.id === i.account_id)?.name ?? '—') : 'Dinero externo'
                            ) : (
                              <select
                                value={accountByInstallment[i.id] ?? ''}
                                onChange={(e) => setAccountByInstallment({ ...accountByInstallment, [i.id]: e.target.value })}
                                style={{ ...formInput, width: 150, minHeight: 32 }}
                              >
                                <option value="">Dinero externo</option>
                                {accounts.filter((a) => a.kind === 'hija').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td>
                            <button
                              onClick={() => handleToggleInstallment(i, d)} disabled={togglingInstallmentId === i.id}
                              style={{ color: i.paid ? 'var(--status-good)' : 'var(--status-warning)', fontWeight: 600 }}
                            >
                              {togglingInstallmentId === i.id ? '…' : i.paid ? 'Pagada' : 'Pendiente'}
                            </button>
                          </td>
                          <td><button onClick={() => handleDeleteInstallment(i, d)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button></td>
                        </tr>
                      ))}
                      {debtInstallments.length === 0 && (
                        <tr><td colSpan={5} style={{ color: 'var(--text-muted)' }}>Sin cuotas registradas todavía.</td></tr>
                      )}
                    </tbody>
                  </table>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <input
                      type="date" value={draft.dueDate}
                      onChange={(e) => setInstallmentForm({ ...installmentForm, [d.id]: { ...draft, dueDate: e.target.value } })}
                      style={{ ...formInput, minWidth: 0 }}
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
                      {addCuotaLabel}
                    </button>
                  </div>
                </>
              )}
            </Card>
          )
        })}

        {visibleDebts.length === 0 && (
          <Card className="span-3"><p style={{ color: 'var(--text-muted)' }}>
            {activeDirection === 'me_deben' ? 'Aún no hay préstamos registrados.' : 'Aún no hay deudas registradas.'}
          </p></Card>
        )}
      </div>

      <EditSheet open={!!editingDebt} onClose={() => setEditingId(null)} title="Editar deuda">
        {editingDebt && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleEditSave(editingDebt.id) }}
            className={styles.sheetForm}
          >
            <EditHeader
              avatar={editForm.creditorName?.trim() ? editForm.creditorName.trim().charAt(0).toUpperCase() : '?'}
              tone={editingDebt.direction === 'me_deben' ? 'good' : 'critical'}
              caption={editingDebt.direction === 'me_deben' ? 'Editando préstamo' : 'Editando deuda'}
              badge={editingDebt.direction === 'me_deben' ? 'Me deben' : 'Debo'}
              badgeTone={editingDebt.direction === 'me_deben' ? 'good' : 'critical'}
            >
              <Field label={editingDebt.direction === 'me_deben' ? 'Nombre de la persona' : 'Acreedor'}>
                <input
                  autoFocus value={editForm.creditorName} className={inputClass}
                  onChange={(e) => setEditForm({ ...editForm, creditorName: e.target.value })}
                />
              </Field>
            </EditHeader>

            <FieldRow>
              <Field label={editingDebt.direction === 'me_deben' ? 'Monto prestado' : 'Monto total'}>
                <input
                  type="number" step="any" value={editForm.totalAmount} className={inputClass}
                  onChange={(e) => setEditForm({ ...editForm, totalAmount: e.target.value })}
                />
              </Field>
              <Field label="Restante">
                <input
                  type="number" step="any" value={editForm.remainingAmount} className={inputClass}
                  onChange={(e) => setEditForm({ ...editForm, remainingAmount: e.target.value })}
                />
              </Field>
            </FieldRow>

            <MeterPreview pct={editPctPaid} color="var(--series-3)">
              {editPctPaid}% {editingDebt.direction === 'me_deben' ? 'recuperado' : 'pagado'} — restan{' '}
              {formatByCurrency(editRemaining, editingDebt.currency)} de {formatByCurrency(editTotal, editingDebt.currency)}
            </MeterPreview>
            {editRemaining > editTotal && (
              <InfoCard tone="warning">El restante es mayor que el monto total — revisá los dos números.</InfoCard>
            )}

            <Field label="Moneda" hint="No se puede cambiar">
              <span className={styles.lockedPill}>{editingDebt.currency || 'COP'}</span>
            </Field>
            <InfoCard>
              Los montos no se convierten solos al cambiar de moneda. Si hace falta otra, borrá la deuda y
              volvé a crearla.
            </InfoCard>

            {editingDebt.direction === 'me_deben' ? (
              <>
                <span className={styles.sectionLabel}>Contacto y fechas</span>
                <Field label="Relación">
                  <ChipPicker
                    options={RELATIONSHIP_OPTIONS} value={editForm.counterpartyRelationship} allowClear
                    onChange={(counterpartyRelationship) => setEditForm({ ...editForm, counterpartyRelationship })}
                  />
                </Field>
                <Field label="Contacto">
                  <input
                    placeholder="Teléfono, correo…" value={editForm.contactInfo} className={inputClass}
                    onChange={(e) => setEditForm({ ...editForm, contactInfo: e.target.value })}
                  />
                </Field>
                <Field label="Pago esperado">
                  <input
                    type="date" value={editForm.expectedPaymentDate} className={inputClass}
                    onChange={(e) => setEditForm({ ...editForm, expectedPaymentDate: e.target.value })}
                  />
                </Field>
                <Field label="Motivo o notas">
                  <input
                    placeholder="Para qué fue" value={editForm.notes} className={inputClass}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <span className={styles.sectionLabel}>Cuotas e intereses</span>
                <FieldRow>
                  <Field label="Cuota mensual">
                    <input
                      type="number" step="any" value={editForm.monthlyPayment} className={inputClass}
                      onChange={(e) => setEditForm({ ...editForm, monthlyPayment: e.target.value })}
                    />
                  </Field>
                  <Field label="Tasa % mensual">
                    <input
                      type="number" step="any" value={editForm.interestRate} className={inputClass}
                      onChange={(e) => setEditForm({ ...editForm, interestRate: e.target.value })}
                    />
                  </Field>
                </FieldRow>
                <Field label="Plazo (# cuotas)">
                  <input
                    type="number" step="1" value={editForm.termMonths} className={inputClass}
                    onChange={(e) => setEditForm({ ...editForm, termMonths: e.target.value })}
                  />
                </Field>
                <InfoCard>
                  Si cambiás el monto total o el restante y la deuda tiene tasa y plazo, el cronograma de cuotas
                  pendientes se regenera — te pido confirmar antes de reemplazarlas.
                </InfoCard>
              </>
            )}

            <EditActions
              disabled={!editForm.creditorName?.trim() || !editForm.totalAmount || !editForm.remainingAmount}
              onCancel={() => setEditingId(null)}
              onDelete={() => { setEditingId(null); handleArchive(editingDebt.id, editingDebt.creditor_name, editingDebt.direction) }}
              deleteLabel={editingDebt.direction === 'me_deben' ? 'Eliminar préstamo' : 'Eliminar deuda'}
            />
          </form>
        )}
      </EditSheet>

      <ConfirmDialog
        open={!!confirmArchive}
        title={`¿Eliminar ${confirmArchive?.direction === 'me_deben' ? 'el préstamo a' : 'la deuda con'} "${confirmArchive?.name}"?`}
        message="Se archiva, no se pierde el historial."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doArchive}
        onCancel={() => setConfirmArchive(null)}
      />

      <ConfirmDialog
        open={!!confirmComplete}
        title={`¡${confirmComplete?.debt.creditor_name} ya te pagó todo!`}
        message="¿Quieres eliminar este préstamo ahora o dejarlo registrado para eliminarlo más tarde?"
        confirmLabel="Eliminar ahora"
        cancelLabel="Dejar para después"
        destructive
        onConfirm={handleConfirmCompleteArchive}
        onCancel={() => setConfirmComplete(null)}
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
