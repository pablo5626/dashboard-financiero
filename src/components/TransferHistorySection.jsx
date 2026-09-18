import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { formatByCurrency } from '../lib/format.js'
import { getTransfersForMonth, deleteTransfer, updateConsumesBudget } from '../lib/transfersApi.js'
import styles from './TransferHistorySection.module.css'

// Mismo formato compacto que GastosDiarios.jsx usa para sus fechas de fila,
// en vez de la fecha ISO cruda ("2026-09-01") que mostraba la tabla vieja.
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

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

  // Al menos una fila con ambas puntas ≠ madre — solo esas muestran la
  // insignia de "Descuenta presupuesto", así que la leyenda que la explica
  // (una sola vez, no repetida por fila) solo hace falta si hay alguna.
  const hasToggleableRow = transfers.some((t) => t.from_account_id !== madreId && t.to_account_id !== madreId)

  return (
    <>
    <Card title={`Transferencias — ${month}/${year}`} className="span-3">
      {hasToggleableRow && (
        <p className={styles.hint}>
          "Descuenta presupuesto" cuenta la plata movida como gasto del presupuesto de la cuenta de
          origen — tocalo para cambiarlo en cualquier momento (ej. si era solo reacomodar plata entre
          bolsillos propios, no fondear una compra).
        </p>
      )}
      <div className={styles.list}>
        {transfers.map((t) => {
          const toggleable = t.from_account_id !== madreId && t.to_account_id !== madreId
          const consumes = t.consumes_budget !== false
          return (
            <div key={t.id} className={styles.transferRow}>
              <div className={styles.transferInfo}>
                <span className={styles.transferRoute}>
                  {accountName(t.from_account_id)} → {accountName(t.to_account_id)}
                </span>
                <span className={styles.transferMeta}>
                  {formatDate(t.transfer_date)}{!toggleable && t.note ? ` · ${t.note}` : ''}
                </span>
              </div>
              <div className={styles.transferRight}>
                <span className={styles.transferAmount}>
                  {t.to_amount != null
                    ? `${formatByCurrency(t.amount, t.currency)} → ${formatByCurrency(t.to_amount, t.to_currency)}`
                    : formatByCurrency(t.amount, t.currency)}
                </span>
                {toggleable && (
                  <button
                    type="button"
                    onClick={() => handleToggleConsumesBudget(t)}
                    disabled={savingConsumesId === t.id}
                    className={consumes ? `${styles.transferBadge} ${styles.transferBadgeActive}` : styles.transferBadge}
                  >
                    {consumes ? 'Descuenta presupuesto' : 'No descuenta'}
                  </button>
                )}
                {toggleable && t.note && <span className={styles.transferMeta}>{t.note}</span>}
              </div>
              <button
                type="button" onClick={() => setConfirmDelete({ id: t.id })}
                className={styles.transferDelete} aria-label="Eliminar transferencia"
              >
                ×
              </button>
            </div>
          )
        })}
        {transfers.length === 0 && (
          <p className={styles.hint}>Sin transferencias registradas este mes.</p>
        )}
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
