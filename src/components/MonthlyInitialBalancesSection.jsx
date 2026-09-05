import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import { getMonthlyInitialBalances, saveMonthlyInitialBalances } from '../lib/accountsApi.js'

export default function MonthlyInitialBalancesSection({ accounts, year, month, onSaved }) {
  const [existing, setExisting] = useState({})
  const [values, setValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const ids = accounts.map((a) => a.id)
        const current = await getMonthlyInitialBalances(ids, year, month)
        if (!cancelled) {
          setExisting(current)
          setValues(Object.fromEntries(
            Object.entries(current).map(([id, row]) => [id, row.initial_balance])
          ))
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [accounts, year, month])

  function handleChange(accountId, raw) {
    setValues((prev) => ({ ...prev, [accountId]: raw === '' ? '' : Number(raw) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // Campo vacío + nunca tuvo valor guardado = no tocar esa cuenta.
      // Campo vacío pero SÍ tenía un valor guardado = se borró a propósito,
      // hay que guardar el 0 para que el cambio se refleje de verdad.
      const isBlank = (v) => v === '' || v === undefined
      const rows = accounts
        .filter((a) => !isBlank(values[a.id]) || existing[a.id] !== undefined)
        .map((a) => ({
          accountId: a.id,
          amount: isBlank(values[a.id]) ? 0 : Number(values[a.id]) || 0,
          currency: a.currency || 'COP',
        }))
      if (rows.length === 0) return
      await saveMonthlyInitialBalances(rows, year, month)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Card title="Saldos iniciales del mes" className="span-3"><p style={{ color: 'var(--text-muted)' }}>Cargando…</p></Card>
  }

  return (
    <Card title={`Saldos iniciales — ${month}/${year}`} className="span-3">
      <p style={{ font: 'var(--font-footnote)', color: 'var(--text-muted)', margin: '0 0 var(--space-2)' }}>
        Con cuánto arrancó cada cuenta este mes. Se puede cargar aquí a mano o desde un Shortcut de iPhone
        que le pegue directo a Supabase — lo que llegue por Shortcut también aparece reflejado abajo.
      </p>
      {error && <p style={{ color: 'var(--status-critical)', font: 'var(--font-footnote)' }}>{error}</p>}

      <form onSubmit={handleSave}>
        <div className="table-scroll" style={{ marginBottom: 'var(--space-2)' }}>
        <table className="simple-table">
          <thead><tr><th>Cuenta</th><th>Saldo inicial</th><th>Origen</th></tr></thead>
          <tbody>
            {accounts.map((a) => {
              const currency = a.currency || 'COP'
              const row = existing[a.id]
              return (
                <tr key={a.id}>
                  <td>{a.name}{currency !== 'COP' && <span style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginLeft: 6 }}>{currency}</span>}</td>
                  <td>
                    <input
                      type="number" value={values[a.id] ?? ''}
                      onChange={(e) => handleChange(a.id, e.target.value)}
                      placeholder="0"
                      style={{ width: 140, minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }}
                    />
                  </td>
                  <td style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>
                    {row ? (row.source === 'shortcut' ? 'Shortcut' : 'Manual') : '— sin cargar —'}
                  </td>
                </tr>
              )
            })}
            {accounts.length === 0 && (
              <tr><td colSpan={3} style={{ color: 'var(--text-muted)' }}>No hay cuentas todavía.</td></tr>
            )}
          </tbody>
        </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit" disabled={saving || accounts.length === 0}
            style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Guardando…' : 'Guardar saldos'}
          </button>
        </div>
      </form>
    </Card>
  )
}
