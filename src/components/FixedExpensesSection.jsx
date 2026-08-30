import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { formatCOP } from '../lib/format.js'
import {
  listFixedExpenses, createFixedExpense, updateFixedExpense, archiveFixedExpense,
  getMonthStatuses, setPaidStatus,
} from '../lib/fixedExpensesApi.js'

const YEAR = new Date().getFullYear()
const MONTH = new Date().getMonth() + 1

const emptyForm = { name: '', amount: '', dueDay: '', frequency: 'mensual', accountId: '' }

export default function FixedExpensesSection({ accounts }) {
  const [items, setItems] = useState(null)
  const [statuses, setStatuses] = useState({})
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null

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

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.amount || !form.dueDay) return
    setSaving(true)
    try {
      await createFixedExpense({
        name: form.name.trim(), amount: Number(form.amount), dueDay: Number(form.dueDay),
        frequency: form.frequency, accountId: form.accountId || null,
      })
      setForm(emptyForm)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

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
        frequency: editForm.frequency, account_id: editForm.accountId || null,
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

  return (
    <>
    <Card title="Gastos fijos recurrentes" className="span-3">
      <div className="table-scroll" style={{ marginBottom: 'var(--space-2)' }}>
      <table className="simple-table">
        <thead>
          <tr><th>Nombre</th><th>Monto</th><th>Vence</th><th>Frecuencia</th><th>Cuenta</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((f) => {
            const status = statuses[f.id]
            const paid = status?.paid ?? false
            const isEditing = editingId === f.id

            if (isEditing) {
              return (
                <tr key={f.id}>
                  <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} style={cellInput} /></td>
                  <td><input type="number" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} style={cellInput} /></td>
                  <td><input type="number" min="1" max="31" value={editForm.dueDay} onChange={(e) => setEditForm({ ...editForm, dueDay: e.target.value })} style={{ ...cellInput, width: 50 }} /></td>
                  <td>
                    <select value={editForm.frequency} onChange={(e) => setEditForm({ ...editForm, frequency: e.target.value })} style={cellInput}>
                      <option value="mensual">Mensual</option>
                      <option value="anual">Anual</option>
                    </select>
                  </td>
                  <td>
                    <select value={editForm.accountId} onChange={(e) => setEditForm({ ...editForm, accountId: e.target.value })} style={cellInput}>
                      <option value="">—</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td colSpan={2} style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => handleEditSave(f.id)} style={{ color: 'var(--series-1)', fontWeight: 600, marginRight: 8 }}>Guardar</button>
                    <button onClick={() => setEditingId(null)} style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                  </td>
                </tr>
              )
            }

            return (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{formatCOP(f.amount)}</td>
                <td>Día {f.due_day}</td>
                <td>{f.frequency === 'anual' ? 'Anual' : 'Mensual'}</td>
                <td>{f.accounts?.name ?? '—'}</td>
                <td>
                  <button
                    onClick={() => togglePaid(f.id, paid)}
                    style={{ color: paid ? 'var(--status-good)' : 'var(--status-warning)', fontWeight: 600 }}
                  >
                    {paid ? 'Pagado' : 'Pendiente'}
                  </button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => startEdit(f)} style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginRight: 8 }}>Editar</button>
                  <button onClick={() => handleArchive(f.id, f.name)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                </td>
              </tr>
            )
          })}
          {items.length === 0 && (
            <tr><td colSpan={7} style={{ color: 'var(--text-muted)' }}>Aún no hay gastos fijos definidos.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...formInput, flex: '1 1 140px' }} />
        <input type="number" placeholder="Monto" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ ...formInput, width: 120 }} />
        <input type="number" min="1" max="31" placeholder="Día" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} style={{ ...formInput, width: 70 }} />
        <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} style={formInput}>
          <option value="mensual">Mensual</option>
          <option value="anual">Anual</option>
        </select>
        <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={formInput}>
          <option value="">Sin cuenta específica</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button type="submit" disabled={saving} style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          Agregar
        </button>
      </form>
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

const cellInput = { width: '100%', minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }
const formInput = { minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }
