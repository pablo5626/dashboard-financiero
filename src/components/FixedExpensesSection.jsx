import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { Field, FieldRow, Segmented, ChipPicker, EditCard, EditHeader, EditActions, inputClass } from './ui/FormKit.jsx'
import { formatByCurrency } from '../lib/format.js'
import {
  listFixedExpenses, updateFixedExpense, archiveFixedExpense,
  getMonthStatuses, setPaidStatus,
} from '../lib/fixedExpensesApi.js'
import styles from './FixedExpensesSection.module.css'

const YEAR = new Date().getFullYear()
const MONTH = new Date().getMonth() + 1

const emptyForm = { name: '', amount: '', dueDay: '', frequency: 'mensual', accountId: '' }

export default function FixedExpensesSection({ accounts }) {
  const [items, setItems] = useState(null)
  const [statuses, setStatuses] = useState({})
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null

  function currencyOf(accountId) {
    return accounts.find((a) => a.id === accountId)?.currency || 'COP'
  }

  async function reload() {
    try {
      const rows = await listFixedExpenses()
      setItems(rows)
      setStatuses(await getMonthStatuses(rows.map((r) => r.id), YEAR, MONTH))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [])

  // El alta se mudó a Ajustes → Gastos fijos — esta sección sigue mostrando
  // la lista, edición inline, toggle "pagado" y archivar, y se refresca sola
  // cuando se crea uno nuevo desde ahí (mismo patrón que
  // dashboard:debts-changed/dashboard:goals-changed).
  useEffect(() => {
    window.addEventListener('dashboard:fixed-expenses-changed', reload)
    return () => window.removeEventListener('dashboard:fixed-expenses-changed', reload)
  }, [])

  function startEdit(item) {
    setEditingId(item.id)
    setEditForm({
      name: item.name, amount: item.amount, dueDay: item.due_day,
      frequency: item.frequency, accountId: item.account_id ?? '',
    })
  }

  async function handleEditSave(id) {
    try {
      await updateFixedExpense(id, {
        name: editForm.name.trim(), amount: Number(editForm.amount), due_day: Number(editForm.dueDay),
        frequency: editForm.frequency, account_id: editForm.accountId || null, currency: currencyOf(editForm.accountId),
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
      await archiveFixedExpense(target.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function togglePaid(id, currentlyPaid) {
    try {
      await setPaidStatus(id, YEAR, MONTH, !currentlyPaid)
      setStatuses(await getMonthStatuses(items.map((r) => r.id), YEAR, MONTH))
    } catch (err) {
      setError(err.message)
    }
  }

  if (error) return <Card title="Gastos fijos recurrentes"><p style={{ color: 'var(--status-critical)' }}>{error}</p></Card>
  if (!items) return <Card title="Gastos fijos recurrentes"><p style={{ color: 'var(--text-muted)' }}>Cargando…</p></Card>

  const byDay = (a, b) => a.due_day - b.due_day
  const pending = items.filter((f) => !(statuses[f.id]?.paid ?? false)).sort(byDay)
  const paidItems = items.filter((f) => statuses[f.id]?.paid ?? false).sort(byDay)
  const groups = [
    { key: 'pending', title: 'Pendientes este mes', rows: pending },
    { key: 'paid', title: 'Pagados este mes', rows: paidItems },
  ].filter((g) => g.rows.length > 0)

  function renderRow(f) {
    const paid = statuses[f.id]?.paid ?? false
    const editing = editingId === f.id

    if (editing) {
      return (
        <div key={f.id} className={styles.editWrap}>
          <EditCard
            as="form"
            onSubmit={(e) => { e.preventDefault(); handleEditSave(f.id) }}
          >
            <EditHeader
              avatar={editForm.dueDay || '–'} tone={paid ? 'good' : 'warning'}
              caption="Editando gasto fijo" badge={paid ? 'Pagado' : 'Pendiente'} badgeTone={paid ? 'good' : 'warning'}
            >
              <Field label="Nombre del gasto">
                <input
                  autoFocus value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className={inputClass} placeholder="Ej. Netflix, arriendo"
                />
              </Field>
            </EditHeader>

            <FieldRow>
              <Field label="Monto" hint={`En ${currencyOf(editForm.accountId)}`}>
                <input
                  type="number" step="any" value={editForm.amount}
                  onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} className={inputClass}
                />
              </Field>
              <Field label="Día del mes">
                <input
                  type="number" min="1" max="31" step="1" value={editForm.dueDay}
                  onChange={(e) => setEditForm({ ...editForm, dueDay: e.target.value })} className={inputClass}
                />
              </Field>
            </FieldRow>

            <Field label="Frecuencia">
              <Segmented
                options={[{ value: 'mensual', label: 'Mensual' }, { value: 'anual', label: 'Anual' }]}
                value={editForm.frequency} onChange={(frequency) => setEditForm({ ...editForm, frequency })}
              />
            </Field>

            <Field label="Cuenta" hint="Opcional — define la moneda">
              <ChipPicker
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                value={editForm.accountId} allowClear
                onChange={(accountId) => setEditForm({ ...editForm, accountId })}
              />
            </Field>

            <EditActions
              disabled={!editForm.name.trim() || !editForm.amount || !editForm.dueDay}
              onCancel={() => setEditingId(null)}
              onDelete={() => handleArchive(f.id, f.name)} deleteLabel="Eliminar gasto"
            />
          </EditCard>
        </div>
      )
    }

    return (
      <div
        key={f.id} className={styles.row} role="button" tabIndex={0}
        onClick={() => startEdit(f)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(f) } }}
      >
        <span className={`${styles.dayTile} ${paid ? styles.dayTilePaid : styles.dayTilePending}`}>
          <span className={styles.dayNumber}>{f.due_day}</span>
          <span className={styles.dayLabel}>DÍA</span>
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowName}>{f.name}</span>
          <span className={styles.rowMeta}>{f.frequency === 'anual' ? 'Anual' : 'Mensual'} · {f.accounts?.name ?? 'Sin cuenta'}</span>
        </span>
        <span className={styles.rowRight}>
          <span className={styles.rowAmount}>{formatByCurrency(f.amount, f.currency)}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePaid(f.id, paid) }}
            className={`${styles.statusPill} ${paid ? styles.statusPaid : styles.statusPending}`}
          >
            {paid ? 'Pagado' : 'Pendiente'}
          </button>
        </span>
        <button
          type="button" className={styles.rowDelete} aria-label={`Eliminar ${f.name}`}
          onClick={(e) => { e.stopPropagation(); handleArchive(f.id, f.name) }}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <>
    <Card title="Gastos fijos recurrentes" className="span-3">
      {groups.map((g) => (
        <div key={g.key} className={styles.group}>
          <div className={styles.groupHeader}>
            <span className={styles.groupTitle}>{g.title}</span>
            <span className={styles.groupCount}>{g.rows.length}</span>
          </div>
          {g.rows.map(renderRow)}
        </div>
      ))}
      {items.length === 0 && <p className={styles.empty}>Aún no hay gastos fijos definidos.</p>}
    </Card>

    <ConfirmDialog
      open={!!confirmArchive}
      title={`¿Eliminar "${confirmArchive?.name}"?`}
      message="Se archiva, no se pierde el historial."
      confirmLabel="Eliminar"
      destructive
      onConfirm={doArchive}
      onCancel={() => setConfirmArchive(null)}
    />
    </>
  )
}
