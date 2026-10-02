import { useEffect, useRef, useState } from 'react'
import Card from './ui/Card.jsx'
import { SwitchRow } from './ui/FormKit.jsx'
import { formatCOP } from '../lib/format.js'
import { getAllocationsForMonth, saveAllocations, previousMonth } from '../lib/allocationsApi.js'
import { getTransfersForMonth, createTransfersIgnoringDuplicates, buildMonthlyAllocationKey } from '../lib/transfersApi.js'

export default function MonthlyAllocationSection({ hijas, madre, year, month, onSaved }) {
  const STORAGE_KEY = 'monthlyAllocationCreateTransfers'
  const [values, setValues] = useState({})
  const [isTemplate, setIsTemplate] = useState(false)
  const [alreadyTransferred, setAlreadyTransferred] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(null)
  const [createTransfers, setCreateTransfers] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      return v === null ? true : v === 'true'
    } catch { return true }
  })
  const [subtractFromMother, setSubtractFromMother] = useState(true)

  // Key para forzar recarga de allocations tras guardar
  const [reloadKey, setReloadKey] = useState(0)

  // Ref para leer values siempre actualizado en handleSave (evita race condition)
  const valuesRef = useRef(values)
  valuesRef.current = values

  // Array combinado: madre primero, luego hijas
  const allAccounts = madre ? [madre, ...hijas] : hijas

  function handleCreateTransfersChange(checked) {
    setCreateTransfers(checked)
    try { localStorage.setItem(STORAGE_KEY, String(checked)) } catch {}
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const ids = allAccounts.map((a) => a.id)
        const current = await getAllocationsForMonth(ids, year, month)
        console.log('[MonthlyAllocation] Loaded allocations:', current)
        const hasAny = Object.keys(current).length > 0

        let loadedValues = current
        if (hasAny) {
          if (!cancelled) { setValues(current); setIsTemplate(false) }
        } else {
          const prev = previousMonth(year, month)
          const prevValues = await getAllocationsForMonth(ids, prev.year, prev.month)
          console.log('[MonthlyAllocation] Loaded prev month allocations:', prevValues)
          loadedValues = prevValues
          if (!cancelled) { setValues(prevValues); setIsTemplate(Object.keys(prevValues).length > 0) }
        }

        // Inicializar valores a 0 para cuentas sin allocation existente,
        // de modo que la cuenta madre y hijas siempre tengan un valor definido.
        if (madre) {
          const initialized = {}
          allAccounts.forEach((a) => {
            initialized[a.id] = loadedValues[a.id] !== undefined ? loadedValues[a.id] : 0
          })
          if (!cancelled) { setValues(initialized) }
        }

        if (madre) {
          const transfers = await getTransfersForMonth([madre.id, ...hijas.map((h) => h.id)], year, month)
          // Una hija cuenta como "ya confirmada" este mes si ya recibió, en
          // transferencias madre→esa hija este mes (sin importar el origen:
          // el botón de la app, el Shortcut de iPhone, o una carga manual),
          // al menos el monto planeado — no solo las que llevan la
          // idempotency_key de este flujo. Chequear solo la clave exacta
          // deja pasar un segundo "Confirmar" real cuando el reparto de este
          // mes ya se hizo por otro canal, duplicando plata de verdad (bug
          // real detectado probando esto). Comparar solo "existe alguna
          // transferencia" sin sumar el monto tiene el problema inverso: una
          // transferencia chica y no relacionada (un ajuste manual cualquiera)
          // marcaría la hija como "financiada" aunque el reparto real nunca
          // haya llegado — por eso se suma el monto real recibido. La
          // idempotency_key sigue protegiendo el insert en sí
          // (createTransfersIgnoringDuplicates) contra un doble click o una
          // carrera dentro de la misma sesión.
          const transferredByHijaId = {}
          for (const t of transfers) {
            if (t.from_account_id !== madre.id) continue
            transferredByHijaId[t.to_account_id] = (transferredByHijaId[t.to_account_id] ?? 0) + Number(t.amount)
          }
          const allFunded = hijas.length > 0 && hijas.every((hija) => {
            const amount = Number(loadedValues[hija.id]) || 0
            return amount === 0 || (transferredByHijaId[hija.id] ?? 0) >= amount
          })
          if (!cancelled) setAlreadyTransferred(allFunded)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [hijas, madre, year, month, reloadKey])

  function handleChange(accountId, raw) {
    const num = raw === '' ? '' : Number(raw)
    console.log('[MonthlyAllocation] handleChange:', { accountId, raw, num, currentRef: valuesRef.current[accountId] })
    setValues((prev) => ({ ...prev, [accountId]: num }))
    // Actualizar ref inmediatamente para handleSave
    valuesRef.current = { ...valuesRef.current, [accountId]: num }
    console.log('[MonthlyAllocation] handleChange - valuesRef after:', valuesRef.current)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (!madre) {
        setError('No hay cuenta madre configurada')
        return
      }
      console.log('[MonthlyAllocation] === SAVE DEBUG ===')
      console.log('[MonthlyAllocation] madre prop:', madre ? {id: madre.id, name: madre.name, kind: madre.kind} : null)
      console.log('[MonthlyAllocation] hijas prop:', hijas.map(h => ({id: h.id, name: h.name, kind: h.kind})))
      console.log('[MonthlyAllocation] allAccounts:', allAccounts.map(a => ({id: a.id, name: a.name, kind: a.kind})))
      console.log('[MonthlyAllocation] valuesRef.current:', valuesRef.current)
      console.log('[MonthlyAllocation] subtractFromMother:', subtractFromMother)
      
      const rows = allAccounts.map((a) => {
        const amount = Number(valuesRef.current[a.id]) || 0
        console.log(`[MonthlyAllocation] Cuenta ${a.name} (${a.kind}, id: ${a.id}): amount=${amount}`)
        return { accountId: a.id, amount }
      })
      console.log('[MonthlyAllocation] Guardando allocations:', rows)
      await saveAllocations(rows, year, month)
      console.log('[MonthlyAllocation] Allocations guardadas OK')
      setIsTemplate(false)
      setReloadKey((k) => k + 1) // Forzar recarga de allocations
      onSaved?.()
      
      // Si subtractFromMother está activo, también crear transfers reales
      // que resten del balance de la madre. Si no, solo guardar el plan
      // presupuestario sin restar saldo.
      if (subtractFromMother && createTransfers) {
        await handleConfirmTransfers()
      }
    } catch (err) {
      console.error('[MonthlyAllocation] Error guardando:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmTransfers() {
    if (!createTransfers) {
      setAlreadyTransferred(true)
      setReloadKey((k) => k + 1) // Forzar recarga de allocations
      onSaved?.()
      return
    }
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
          idempotencyKey: buildMonthlyAllocationKey(madre.id, r.accountId, year, month),
        }))
      if (rows.length === 0) return
      await createTransfersIgnoringDuplicates(rows)
      setAlreadyTransferred(true)
      setReloadKey((k) => k + 1) // Forzar recarga de allocations
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirming(false)
    }
  }

const total = allAccounts.reduce((sum, a) => sum + (Number(values[a.id]) || 0), 0)

  // Debug render
  console.log('[MonthlyAllocation] RENDER values:', values, 'allAccounts:', allAccounts.map(a => ({id: a.id, name: a.name, val: values[a.id]})))

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
          <thead><tr><th>Cuenta</th><th>Monto asignado</th></tr></thead>
          <tbody>
            {allAccounts.map((a, idx) => (
              <tr key={a.id} style={idx === 0 && madre ? { fontWeight: 600 } : {}}>
                <td>
                  {a.name}
                  {a.kind === 'madre' && <span style={{ marginLeft: 6, fontSize: '0.75em', color: 'var(--series-1)' }}>(madre)</span>}
                </td>
                <td>
                  {console.log('[MonthlyAllocation] Input render:', a.name, 'prop value:', values[a.id] ?? '')}
                  <input
                    type="number" min="0" value={values[a.id] ?? ''}
                    onChange={(e) => handleChange(a.id, e.target.value)}
                    style={{ width: 140, minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }}
                    onFocus={() => console.log('[MonthlyAllocation] Input focus:', a.name, 'value:', values[a.id])}
                    data-debug-value={values[a.id] ?? ''}
                  />
                  <span style={{ marginLeft: 8, fontSize: '0.75em', color: 'var(--series-1)', fontFamily: 'monospace' }}>
                    {values[a.id] != null ? values[a.id] : '—'}
                  </span>
                </td>
              </tr>
            ))}
            {allAccounts.length === 0 && (
              <tr><td colSpan={2} style={{ color: 'var(--text-muted)' }}>No hay cuentas todavía.</td></tr>
            )}
          </tbody>
        </table>
        </div>

        {madre && (
          <SwitchRow
            title="Restar de la cuenta madre al confirmar"
            helper="Si está activo, los valores de la distribución restan del saldo de la cuenta madre y crean transferencias reales. Si está desactivado, solo guarda el plan presupuestario sin restar saldo ni crear transferencias."
            checked={subtractFromMother}
            onChange={(checked) => {
              setSubtractFromMother(checked)
              setCreateTransfers(checked)
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ font: 'var(--font-subheadline)', color: 'var(--text-secondary)' }}>
            Total a distribuir: <strong style={{ color: 'var(--text-primary)' }}>{formatCOP(total)}</strong>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit" disabled={saving || allAccounts.length === 0}
              style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Guardando…' : 'Guardar distribución'}
            </button>
            {madre && createTransfers && (
              alreadyTransferred ? (
                <span style={{ font: 'var(--font-caption)', color: 'var(--status-good)', display: 'flex', alignItems: 'center' }}>
                  Distribución confirmada — el saldo de {madre.name} ya lo refleja
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
            {madre && !createTransfers && alreadyTransferred && (
              <span style={{ font: 'var(--font-caption)', color: 'var(--status-good)', display: 'flex', alignItems: 'center' }}>
                Plan confirmado — sin transferencias reales
              </span>
            )}
          </div>
        </div>
      </form>
    </Card>
  )
}
