import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import { getMonthlyInitialBalances, saveMonthlyInitialBalances } from '../lib/accountsApi.js'
import { flattenAccountPockets } from '../lib/currencyPockets.js'

export default function MonthlyInitialBalancesSection({ accounts, year, month, onSaved }) {
  const [existing, setExisting] = useState({})
  const [values, setValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // accountId -> moneda actualmente elegida en el dropdown de esa cuenta
  // multi-moneda — solo importa para cuentas con más de un bolsillo, ver
  // accountRows más abajo.
  const [selectedCurrency, setSelectedCurrency] = useState({})

  // Cada bolsillo (ej. arq USD y arq EUR) tiene su propio saldo inicial del
  // mes (ver la unique(...,currency) de monthly_initial_balances) — pero una
  // cuenta multi-moneda ya no aporta una fila SIEMPRE VISIBLE por bolsillo:
  // aporta una sola fila con un dropdown para elegir qué moneda se está
  // cargando ahora mismo, mismo criterio que el selector de bolsillo en
  // Cuentas.jsx — reduce el ruido de la tabla cuando la mayoría de los
  // meses solo hace falta tocar un bolsillo por vez. `values` sigue
  // indexado por bolsillo (p.key), así que cambiar de moneda y volver no
  // pierde lo ya tipeado en el otro campo.
  const accountRows = accounts.map((a) => ({ account: a, pockets: flattenAccountPockets([a]) }))
  const pockets = flattenAccountPockets(accounts) // lista plana, sin agrupar — la sigue usando la carga/guardado

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const current = await getMonthlyInitialBalances(accounts, year, month)
        if (!cancelled) {
          setExisting(current)
          setValues(Object.fromEntries(
            Object.entries(current).map(([key, row]) => [key, row.initial_balance])
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

  function handleChange(key, raw) {
    setValues((prev) => ({ ...prev, [key]: raw === '' ? '' : Number(raw) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // Campo vacío + nunca tuvo valor guardado = no tocar ese bolsillo.
      // Campo vacío pero SÍ tenía un valor guardado = se borró a propósito,
      // hay que guardar el 0 para que el cambio se refleje de verdad.
      const isBlank = (v) => v === '' || v === undefined
      const rows = pockets
        .filter((p) => !isBlank(values[p.key]) || existing[p.key] !== undefined)
        .map((p) => ({
          accountId: p.accountId,
          amount: isBlank(values[p.key]) ? 0 : Number(values[p.key]) || 0,
          currency: p.currency,
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
            {accountRows.map(({ account, pockets: accPockets }) => {
              // Una sola moneda: fila simple, igual que siempre.
              if (accPockets.length <= 1) {
                const p = accPockets[0]
                const row = existing[p.key]
                return (
                  <tr key={p.key}>
                    <td>{p.label}{p.currency !== 'COP' && !p.label.includes(p.currency) && <span style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginLeft: 6 }}>{p.currency}</span>}</td>
                    <td>
                      <input
                        type="number" value={values[p.key] ?? ''}
                        onChange={(e) => handleChange(p.key, e.target.value)}
                        placeholder="0"
                        style={{ width: 140, minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }}
                      />
                    </td>
                    <td style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>
                      {row ? (row.source === 'shortcut' ? 'Shortcut' : 'Manual') : '— sin cargar —'}
                    </td>
                  </tr>
                )
              }

              // Multi-moneda: una sola fila con un dropdown para elegir qué
              // bolsillo se está cargando — evita mostrar todas las monedas
              // siempre a la vez cuando lo normal es tocar una por mes.
              const activeCurrency = selectedCurrency[account.id] ?? accPockets[0].currency
              const active = accPockets.find((p) => p.currency === activeCurrency) ?? accPockets[0]
              const row = existing[active.key]
              return (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        value={active.currency}
                        onChange={(e) => setSelectedCurrency((prev) => ({ ...prev, [account.id]: e.target.value }))}
                        style={{ minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)' }}
                      >
                        {accPockets.map((p) => <option key={p.currency} value={p.currency}>{p.currency}</option>)}
                      </select>
                      <input
                        type="number" value={values[active.key] ?? ''}
                        onChange={(e) => handleChange(active.key, e.target.value)}
                        placeholder="0"
                        style={{ width: 120, minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }}
                      />
                    </div>
                  </td>
                  <td style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>
                    {row ? (row.source === 'shortcut' ? 'Shortcut' : 'Manual') : '— sin cargar —'}
                  </td>
                </tr>
              )
            })}
            {accountRows.length === 0 && (
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
