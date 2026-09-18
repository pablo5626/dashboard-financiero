import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { formatByCurrency } from '../lib/format.js'
import { getTransfersForMonth, createTransfers, deleteTransfer, updateConsumesBudget } from '../lib/transfersApi.js'
import { flattenAccountPockets } from '../lib/currencyPockets.js'

const emptyForm = { fromKey: '', toKey: '', amount: '', toAmount: '', note: '', consumesBudget: true }

export default function TransferHistorySection({ accounts, year, month, onSaved }) {
  const [transfers, setTransfers] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // { id } | null
  const [savingConsumesId, setSavingConsumesId] = useState(null)

  // Un "bolsillo" por moneda de cada cuenta (una cuenta normal aporta uno,
  // una multi-moneda uno por cada moneda que soporta) — así se puede elegir
  // como origen/destino específicamente el bolsillo EUR de una cuenta como
  // arq, no solo la cuenta en su moneda primaria.
  const pockets = flattenAccountPockets(accounts)

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

  function pocketOf(key) {
    return pockets.find((p) => p.key === key)
  }

  const toOptions = form.fromKey
    ? pockets.filter((p) => p.key !== form.fromKey)
    : pockets

  const fromPocket = pocketOf(form.fromKey)
  const toPocket = pocketOf(form.toKey)
  const crossCurrency = !!(fromPocket && toPocket && toPocket.currency !== fromPocket.currency)

  // Devolver plata a la madre nunca consume presupuesto, así que ahí ni se
  // pregunta; entre hijas sí, porque puede ser plata que se va a gastar desde
  // la otra cuenta o puro reacomodo entre bolsillos.
  const madreId = accounts.find((a) => a.kind === 'madre')?.id
  const askConsumesBudget = !!(fromPocket && fromPocket.accountId !== madreId && toPocket && toPocket.accountId !== madreId)

  async function handleCreate(e) {
    e.preventDefault()
    if (!fromPocket || !toPocket || !form.amount) return
    if (crossCurrency && !form.toAmount) return
    setSaving(true)
    try {
      await createTransfers([{
        fromAccountId: fromPocket.accountId,
        toAccountId: toPocket.accountId,
        amount: Number(form.amount),
        currency: fromPocket.currency,
        ...(crossCurrency ? { toAmount: Number(form.toAmount), toCurrency: toPocket.currency } : {}),
        consumesBudget: askConsumesBudget ? form.consumesBudget : true,
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

  async function handleToggleConsumesBudget(t) {
    setSavingConsumesId(t.id)
    try {
      await updateConsumesBudget(t.id, !(t.consumes_budget !== false))
      await reload()
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingConsumesId(null)
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
                <td style={{ color: 'var(--text-muted)' }}>
                  {t.from_account_id !== madreId && t.to_account_id !== madreId ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={t.consumes_budget !== false}
                        disabled={savingConsumesId === t.id}
                        onChange={() => handleToggleConsumesBudget(t)}
                        style={{ width: 16, height: 16 }}
                      />
                      {t.note ? `${t.note} · ` : ''}Descuenta presupuesto
                    </label>
                  ) : (t.note || '—')}
                </td>
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
          value={form.fromKey}
          onChange={(e) => setForm({ ...form, fromKey: e.target.value, toKey: '' })}
          style={formInput}
        >
          <option value="">Cuenta origen</option>
          {pockets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select
          value={form.toKey}
          onChange={(e) => setForm({ ...form, toKey: e.target.value })}
          disabled={!form.fromKey}
          style={formInput}
        >
          <option value="">Cuenta destino</option>
          {toOptions.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <input
          type="number"
          placeholder={crossCurrency ? `Monto enviado (${fromPocket?.currency})` : 'Monto'}
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          style={{ ...formInput, width: crossCurrency ? 170 : 120 }}
        />
        {crossCurrency && (
          <input
            type="number"
            placeholder={`Monto recibido (${toPocket?.currency})`}
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
        {askConsumesBudget && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--font-caption)', color: 'var(--text-muted)', flex: '1 1 100%', minHeight: 'var(--touch-target)' }}>
            <input
              type="checkbox" checked={form.consumesBudget}
              onChange={(e) => setForm({ ...form, consumesBudget: e.target.checked })}
              style={{ width: 20, height: 20 }}
            />
            Descontar del presupuesto de {fromPocket?.label ?? accountName(fromPocket?.accountId)} — desmarcá si es solo mover plata entre cuentas, sin gastarla
          </label>
        )}
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
