import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import { formatCOP } from '../lib/format.js'
import { getAllocationsForMonth, saveAllocations, previousMonth } from '../lib/allocationsApi.js'
import { getTransfersForMonth, createTransfers } from '../lib/transfersApi.js'

export default function MonthlyAllocationSection({ hijas, madre, year, month, onSaved }) {
  const [values, setValues] = useState({})
  const [isTemplate, setIsTemplate] = useState(false)
  const [alreadyTransferred, setAlreadyTransferred] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const ids = hijas.map((h) => h.id)
        const current = await getAllocationsForMonth(ids, year, month)
        const hasAny = Object.keys(current).length > 0

        if (hasAny) {
          if (!cancelled) { setValues(current); setIsTemplate(false) }
        } else {
          const prev = previousMonth(year, month)
          const prevValues = await getAllocationsForMonth(ids, prev.year, prev.month)
          if (!cancelled) { setValues(prevValues); setIsTemplate(Object.keys(prevValues).length > 0) }
        }

        if (madre) {
          const transfers = await getTransfersForMonth([madre.id, ...ids], year, month)
          if (!cancelled) setAlreadyTransferred(transfers.some((t) => t.from_account_id === madre.id))
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [hijas, madre, year, month])

  function handleChange(accountId, raw) {
    setValues((prev) => ({ ...prev, [accountId]: raw === '' ? '' : Number(raw) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const rows = hijas.map((h) => ({ accountId: h.id, amount: Number(values[h.id]) || 0 }))
      await saveAllocations(rows, year, month)
      setIsTemplate(false)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmTransfers() {
    setConfirming(true)
    setError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const rows = hijas
        .map((h) => ({ accountId: h.id, amount: Number(values[h.id]) || 0 }))
        .filter((r) => r.amount > 0)
        .map((r) => ({
          fromAccountId: madre.id, toAccountId: r.accountId, amount: r.amount,
          currency: 'COP', transferDate: today, note: 'Distribución mensual',
        }))
      if (rows.length === 0) return
      await createTransfers(rows)
      setAlreadyTransferred(true)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirming(false)
    }
  }

  const total = hijas.reduce((sum, h) => sum + (Number(values[h.id]) || 0), 0)

  if (loading) {
    return <Card title="Distribución mensual" className="span-3"><p style={{ color: 'var(--text-muted)' }}>Cargando…</p></Card>
  }

  return (
    <Card title={`Distribución mensual — ${month}/${year}`} className="span-3">
      {isTemplate && (
        <p style={{ font: 'var(--font-footnote)', color: 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
          Aún no has definido la distribución de este mes — se precargó como plantilla la del mes anterior.
          Ajusta y guarda para confirmarla.
        </p>
      )}
      {error && <p style={{ color: 'var(--status-critical)', font: 'var(--font-footnote)' }}>{error}</p>}

      <form onSubmit={handleSave}>
        <div className="table-scroll" style={{ marginBottom: 'var(--space-2)' }}>
        <table className="simple-table">
          <thead><tr><th>Cuenta hija</th><th>Monto asignado</th></tr></thead>
          <tbody>
            {hijas.map((h) => (
              <tr key={h.id}>
                <td>{h.name}</td>
                <td>
                  <input
                    type="number" min="0" value={values[h.id] ?? ''}
                    onChange={(e) => handleChange(h.id, e.target.value)}
                    style={{ width: 140, minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }}
                  />
                </td>
              </tr>
            ))}
            {hijas.length === 0 && (
              <tr><td colSpan={2} style={{ color: 'var(--text-muted)' }}>No hay cuentas hijas todavía.</td></tr>
            )}
          </tbody>
        </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ font: 'var(--font-subheadline)', color: 'var(--text-secondary)' }}>
            Total a distribuir: <strong style={{ color: 'var(--text-primary)' }}>{formatCOP(total)}</strong>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit" disabled={saving || hijas.length === 0}
              style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Guardando…' : 'Guardar distribución'}
            </button>
            {madre && (
              alreadyTransferred ? (
                <span style={{ font: 'var(--font-caption)', color: 'var(--status-good)', display: 'flex', alignItems: 'center' }}>
                  Transferencia confirmada — el saldo de {madre.name} ya lo refleja
                </span>
              ) : (
                <button
                  type="button" onClick={handleConfirmTransfers} disabled={confirming || total === 0}
                  style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, border: '1px solid var(--series-1)', color: 'var(--series-1)', fontWeight: 600, opacity: confirming ? 0.6 : 1 }}
                >
                  {confirming ? 'Confirmando…' : 'Confirmar transferencia real'}
                </button>
              )
            )}
          </div>
        </div>
      </form>
    </Card>
  )
}
