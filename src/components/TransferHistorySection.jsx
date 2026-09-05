import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { formatByCurrency } from '../lib/format.js'
import { getTransfersForMonth, createTransfers, deleteTransfer } from '../lib/transfersApi.js'

const emptyForm = { fromAccountId: '', toAccountId: '', amount: '', toAmount: '', note: '' }

export default function TransferHistorySection({ accounts, year, month, onSaved }) {
  const [transfers, setTransfers] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // { id } | null

  async function reload() {
    try {
      const rows = await getTransfersForMonth(accounts.map((a) => a.id), year, month)
      setTransfers(rows)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [accounts, year, month])

  function accountName(id) {
    return accounts.find((a) => a.id === id)?.name ?? '—'
  }

  function currencyOf(id) {
    return accounts.find((a) => a.id === id)?.currency || 'COP'
  }

  const toOptions = form.fromAccountId
    ? accounts.filter((a) => a.id !== form.fromAccountId)
    : accounts

  const crossCurrency = !!(form.fromAccountId && form.toAccountId && currencyOf(form.toAccountId) !== currencyOf(form.fromAccountId))

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.fromAccountId || !form.toAccountId || !form.amount) return
    if (crossCurrency && !form.toAmount) return
    setSaving(true)
    try {
      await createTransfers([{
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amount: Number(form.amount),
        currency: currencyOf(form.fromAccountId),
        ...(crossCurrency ? { toAmount: Number(form.toAmount), toCurrency: currencyOf(form.toAccountId) } : {}),
        transferDate: new Date().toISOString().slice(0, 10),
        note: form.note.trim() || null,
      }])
      setForm(emptyForm)
      await reload()
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    const target = confirmDelete
    setConfirmDelete(null)
    try {
      await deleteTransfer(target.id)
      await reload()
      onSaved?.()
    } catch (err) {
      setError(err.message)
    }
  }

  if (error) return <Card title="Historial de transferencias" className="span-3"><p style={{ color: 'var(--status-critical)' }}>{error}</p></Card>
  if (!transfers) return <Card title="Historial de transferencias" className="span-3"><p style={{ color: 'var(--text-muted)' }}>Cargando…</p></Card>

  return (
    <>
    <Card title={`Transferencias — ${month}/${year}`} className="span-3">
      <div className="table-scroll" style={{ marginBottom: 'var(--space-2)' }}>
        <table className="simple-table">
          <thead><tr><th>Fecha</th><th>Origen</th><th>Destino</th><th>Monto</th><th>Nota</th><th></th></tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.transfer_date}</td>
                <td>{accountName(t.from_account_id)}</td>
                <td>{accountName(t.to_account_id)}</td>
                <td>
                  {t.to_amount != null
                    ? `${formatByCurrency(t.amount, t.currency)} → ${formatByCurrency(t.to_amount, t.to_currency)}`
                    : formatByCurrency(t.amount, t.currency)}
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{t.note ?? '—'}</td>
                <td>
                  <button onClick={() => setConfirmDelete({ id: t.id })} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                </td>
              </tr>
            ))}
            {transfers.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>Sin transferencias registradas este mes.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <select
          value={form.fromAccountId}
          onChange={(e) => setForm({ ...form, fromAccountId: e.target.value, toAccountId: '' })}
          style={formInput}
        >
          <option value="">Cuenta origen</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select
          value={form.toAccountId}
          onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}
          disabled={!form.fromAccountId}
          style={formInput}
        >
          <option value="">Cuenta destino</option>
          {toOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input
          type="number"
          placeholder={crossCurrency ? `Monto enviado (${currencyOf(form.fromAccountId)})` : 'Monto'}
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          style={{ ...formInput, width: crossCurrency ? 170 : 120 }}
        />
        {crossCurrency && (
          <input
            type="number"
            placeholder={`Monto recibido (${currencyOf(form.toAccountId)})`}
            value={form.toAmount}
            onChange={(e) => setForm({ ...form, toAmount: e.target.value })}
            style={{ ...formInput, width: 170 }}
          />
        )}
        <input
          placeholder="Nota (opcional)" value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          style={{ ...formInput, flex: '1 1 140px' }}
        />
        <button
          type="submit" disabled={saving}
          style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}
        >
          Agregar
        </button>
      </form>
    </Card>

    <ConfirmDialog
      open={!!confirmDelete}
      title="¿Eliminar esta transferencia?"
      message="El saldo de ambas cuentas se recalcula al instante."
      confirmLabel="Eliminar"
      destructive
      onConfirm={doDelete}
      onCancel={() => setConfirmDelete(null)}
    />
    </>
  )
}

const formInput = { minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }
