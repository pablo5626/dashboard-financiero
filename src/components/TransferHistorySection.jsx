import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { formatByCurrency } from '../lib/format.js'
import { getTransfersForMonth, deleteTransfer, updateConsumesBudget } from '../lib/transfersApi.js'

export default function TransferHistorySection({ accounts, year, month, onSaved }) {
  const [transfers, setTransfers] = useState(null)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // { id } | null
  const [savingConsumesId, setSavingConsumesId] = useState(null)

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

  // Registrar una transferencia nueva ya no vive acá — el "+" flotante lo
  // cubre (y desde que soporta elegir el bolsillo de una cuenta multi-moneda
  // como destino, cubre exactamente lo mismo que este formulario cubría).
  const madreId = accounts.find((a) => a.kind === 'madre')?.id

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
                <td className="amount-cell">
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
