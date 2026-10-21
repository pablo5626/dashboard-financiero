import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { SwitchRow } from './ui/FormKit.jsx'
import { formatCOP } from '../lib/format.js'
import { getAllocationsForMonth, saveAllocations, deleteAllocation, previousMonth } from '../lib/allocationsApi.js'
import { getMonthlyInitialBalances, saveMonthlyInitialBalances, deleteMonthlyInitialBalance } from '../lib/accountsApi.js'
import { getTransfersForMonth, syncMonthlyDistributionTransfers, removeMonthlyDistributionTransfers } from '../lib/transfersApi.js'

// El reparto mensual es un ritual de DOS pasos, a propósito:
//
//   Paso 1 — "Guardar distribución": guarda el PLAN. Para cada hija,
//     cuánto le corresponde este mes (account_allocations). Para la madre,
//     su saldo inicial del mes (monthly_initial_balances). Un plan no mueve
//     plata: los saldos de las hijas NO cambian todavía.
//
//   Paso 2 — "Confirmar transferencia real": convierte el plan en
//     movimientos reales (account_transfers madre→hija). Acá es donde los
//     números se alinean: cada hija arranca el mes en el monto asignado y de
//     ahí se le resta lo que gasta, y la madre baja el total repartido.
//
// Y tiene DOS MODOS, según el interruptor "El reparto sale de la cuenta
// madre" (general de la app, activado por defecto — ver
// src/lib/distributionMode.js):
//
//   ACTIVADO → la plata sale de la madre: cada hija recibe su monto como una
//     TRANSFERENCIA madre→hija y la madre baja el total repartido.
//
//   DESACTIVADO → esa plata no salió de la madre: cada hija arranca el mes
//     con su monto como SALDO INICIAL (ancla en monthly_initial_balances con
//     source 'distribution') y la madre no se toca. En este modo no hay
//     transferencias que confirmar: guardar la distribución ya aplica el
//     saldo inicial de cada hija.
//
// Antes estos dos pasos compartían un botón y el plan se sumaba al saldo de
// la madre con un parche (accountsApi.js), así que el número que escribías
// en la distribución nunca era el mismo que entraba en la matemática de
// saldos. Ahora el plan y el movimiento son la misma decisión, en dos
// momentos distintos y visibles.
export default function MonthlyAllocationSection({ hijas, madre, year, month, onSaved, madreBalance = 0, fromMother = true, onFromMotherChange }) {
  const [values, setValues] = useState({})
  const [madreStart, setMadreStart] = useState('')
  const [hadStart, setHadStart] = useState(false)
  const [startPrefilled, setStartPrefilled] = useState(false)
  const [isTemplate, setIsTemplate] = useState(false)
  const [ritualTransfers, setRitualTransfers] = useState([])
  const [hijaAnchors, setHijaAnchorsState] = useState({})
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  // Identidad estable de las hijas: el padre crea el array en cada render,
  // así que un useEffect que dependiera de `hijas` se recargaría en cada
  // render y "movería" lo que el usuario estaba escribiendo (el bug que
  // unsubscribe el último tiempo). Depender del string de ids es estable.
  const hijaKey = hijas.map((h) => h.id).join(',')
  const madreId = madre?.id ?? null

  async function loadTransfers(accountIds) {
    if (!accountIds.length) return []
    const all = await getTransfersForMonth(accountIds, year, month)
    return all.filter((t) => (t.idempotency_key ?? '').startsWith('monthly_allocation:'))
  }

  async function loadHijaAnchors() {
    if (!hijas.length) return {}
    return getMonthlyInitialBalances(hijas, year, month)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const hijaIds = hijaKey ? hijaKey.split(',') : []
        const allIds = [madreId, ...hijaIds].filter(Boolean)

        // 1. Plan de este mes; si no hay, se precarga como plantilla el del
        //    mes anterior (el ritual histórico de la app).
        const current = hijaIds.length ? await getAllocationsForMonth(hijaIds, year, month) : {}
        let loaded = current
        let template = false
        if (Object.keys(current).length === 0 && hijaIds.length) {
          const prev = previousMonth(year, month)
          const prevValues = await getAllocationsForMonth(hijaIds, prev.year, prev.month)
          if (Object.keys(prevValues).length > 0) {
            loaded = prevValues
            template = true
          }
        }

        // 2. Saldo inicial de la madre para este mes (su ancla). Si todavía
        //    no hay ancla pero sí quedó una fila vieja de distribución para
        //    la madre (el modelo anterior usaba esa fila como su saldo), se
        //    precarga ese número para no perder lo que ya estaba escrito.
        let start = ''
        let had = false
        let prefilled = false
        if (madreId) {
          const rows = await getMonthlyInitialBalances([madre], year, month)
          const row = rows[madreId]
          if (row) {
            start = String(row.initial_balance)
            had = true
          } else {
            const old = await getAllocationsForMonth([madreId], year, month)
            if (old[madreId] != null && Number(old[madreId]) !== 0) {
              start = String(old[madreId])
              prefilled = true
            }
          }
        }

        // 3. Transferencias reales del reparto ya registradas este mes (para
        //    saber si el plan está confirmado o hay algo pendiente) y las
        //    anclas que ya tienen las hijas (para no pisar un saldo real).
        const ritual = await loadTransfers(allIds)
        const anchors = hijaIds.length ? await loadHijaAnchors() : {}

        if (cancelled) return
        const nextValues = {}
        for (const id of hijaIds) nextValues[id] = loaded[id] ?? 0
        setValues(nextValues)
        setMadreStart(start)
        setHadStart(had)
        setStartPrefilled(prefilled)
        setIsTemplate(template)
        setRitualTransfers(ritual)
        setHijaAnchorsState(anchors)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [year, month, hijaKey, madreId])

  function handleChange(accountId, raw) {
    const num = raw === '' ? '' : Number(raw)
    setValues((prev) => ({ ...prev, [accountId]: num }))
  }

  // Paso 1 + el saldo inicial de la madre. Se usa en ambos botones: el
  // "Confirmar" primero guarda el plan y después crea las transferencias,
  // así nunca quedan plan y movimiento con números distintos.
  //
  // `mode` permite forzar el modo en una acción puntual (usado por
  // "quitar las transferencias del reparto", que deja el mes en el modo
  // desligado de la madre).
  async function persistPlan(mode = fromMother) {
    const rows = hijas.map((h) => ({ accountId: h.id, amount: Number(values[h.id]) || 0 }))
    await saveAllocations(rows, year, month)

    // La madre: su saldo inicial del mes (siempre una declaración, en los
    // dos modos).
    if (madreId) {
      const raw = String(madreStart).trim()
      if (raw !== '') {
        await saveMonthlyInitialBalances([{ accountId: madreId, amount: Number(raw) || 0, currency: 'COP' }], year, month)
        setHadStart(true)
      } else if (hadStart) {
        // Campo vacío pero SÍ había un saldo inicial guardado = se borró a
        // propósito: hay que guardar el 0 para que el cambio se refleje.
        await saveMonthlyInitialBalances([{ accountId: madreId, amount: 0, currency: 'COP' }], year, month)
      }
      // La madre ya no tiene fila en la distribución (su número es el saldo
      // inicial de arriba): se borra la fila vieja para que no ensucie los
      // agregados.
      await deleteAllocation(madreId, year, month)
      setStartPrefilled(false)
    }

    // De dónde sale la plata de cada hija depende del modo.
    const found = []
    const anchors = await loadHijaAnchors()
    const transfers = await loadTransfers([madreId, ...rows.map((r) => r.accountId)].filter(Boolean))
    const currencyOf = (id) => hijas.find((h) => h.id === id)?.currency || 'COP'

    for (const row of rows) {
      const name = hijas.find((h) => h.id === row.accountId)?.name ?? ''
      const anchor = anchors[row.accountId] ?? null
      const hasTransfer = transfers.some((t) => t.to_account_id === row.accountId)
      const isOwnAnchor = anchor?.source === 'distribution'

      if (mode) {
        // Modo activado: la plata llega por transferencia. El ancla del
        // reparto (si quedó de un mes en modo desligado) se borra DESPUÉS
        // de crear la transferencia — ver clearDistributionAnchors, para no
        // dejar a las hijas sin plata si la transferencia falla.
        continue
      }

      // Modo desligado de la madre: el monto es el saldo inicial de la hija.
      if (row.amount <= 0) {
        if (isOwnAnchor) {
          await deleteMonthlyInitialBalance(row.accountId, year, month, currencyOf(row.accountId))
        }
        continue
      }
      if (hasTransfer) {
        found.push(`${name} ya recibió el reparto por transferencia: no le puse saldo inicial`)
        continue
      }
      if (anchor && !isOwnAnchor) {
        const de = anchor.source === 'shortcut' ? 'del Shortcut' : 'a mano'
        found.push(`${name} ya tenía un saldo inicial cargado ${de}: no lo toqué`)
        continue
      }
      await saveMonthlyInitialBalances(
        [{ accountId: row.accountId, amount: row.amount, currency: 'COP', source: 'distribution' }],
        year, month
      )
    }

    setNotes(found)
    setHijaAnchorsState(await loadHijaAnchors())
    return { rows, notes: found }
  }

  // Borra el saldo inicial que dejó el reparto (source 'distribution') de las
  // hijas de este mes. Se llama DESPUÉS de crear las transferencias reales:
  // con las dos cosas cargadas, la misma plata se contaría dos veces.
  async function clearDistributionAnchors() {
    const anchors = await loadHijaAnchors()
    for (const h of hijas) {
      const anchor = anchors[h.id]
      if (anchor && anchor.source === 'distribution') {
        await deleteMonthlyInitialBalance(h.id, year, month, h.currency || 'COP')
      }
    }
    setHijaAnchorsState(await loadHijaAnchors())
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setDone(null)
    try {
      if (!madreId) {
        setError('No hay cuenta madre configurada')
        return
      }
      await persistPlan()
      setDone(fromMother
        ? 'Plan guardado — los saldos de las hijas todavía no cambian hasta que confirmes la transferencia real.'
        : 'Plan guardado — cada hija quedó con su monto como saldo inicial del mes y la madre no se toca.')
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirm() {
    if (!madreId) {
      setError('No hay cuenta madre configurada')
      return
    }
    setConfirming(true)
    setError(null)
    setDone(null)
    try {
      const { rows } = await persistPlan(true)
      const summary = await syncMonthlyDistributionTransfers({ madre, rows, year, month })
      // Las transferencias ya traen la plata: el ancla del reparto (si quedó
      // de un mes en modo desligado) contaría la misma plata dos veces.
      await clearDistributionAnchors()
      setRitualTransfers(await loadTransfers([madreId, ...rows.map((r) => r.accountId)]))
      const parts = []
      if (summary.created) parts.push(`${summary.created} nueva(s)`)
      if (summary.updated) parts.push(`${summary.updated} actualizada(s)`)
      if (summary.adopted) parts.push(`${summary.adopted} de tu Shortcut, ya adoptada(s)`)
      if (summary.removed) parts.push(`${summary.removed} borrada(s)`)
      setDone(parts.length
        ? `Transferencias reales al día — ${parts.join(', ')}.`
        : 'Las transferencias reales ya estaban al día.')
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirming(false)
    }
  }

  // "Pasar este mes al modo desligado de la madre": se van las
  // transferencias del reparto (esa plata no salió de la madre) y en su lugar
  // cada hija queda con su monto como saldo inicial del mes.
  async function handleRemoveTransfers() {
    setConfirmRemove(false)
    setSaving(true)
    setError(null)
    setDone(null)
    try {
      const removed = await removeMonthlyDistributionTransfers({
        madre, accountIds: hijas.map((h) => h.id), year, month,
      })
      await persistPlan(false)
      setRitualTransfers([])
      setDone(`Se quitaron ${removed} transferencia(s) del reparto de este mes y cada hija quedó con su monto como saldo inicial.`)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Lo que falta confirmar (solo en el modo en que la plata sale de la
  // madre): cada hija con plan > 0 cuya transferencia real no existe
  // todavía, o existe con otro monto (el plan cambió).
  const ritualByHija = {}
  for (const t of ritualTransfers) {
    if (t.from_account_id !== madreId || !t.to_account_id) continue
    ritualByHija[t.to_account_id] = t
  }
  const pending = hijas.filter((h) => {
    const plan = Number(values[h.id]) || 0
    const t = ritualByHija[h.id]
    if (plan <= 0) return !!t
    return !t || Number(t.amount) !== plan
  })

  // Hijas que ya tienen su saldo inicial cargado aparte (a mano o del
  // Shortcut): el reparto no las pisa, así que conviene avisarlo.
  const conSaldoPropio = hijas.filter((h) => {
    const a = hijaAnchors[h.id]
    return a && a.source !== 'distribution' && Number(a.initial_balance) !== 0
  })

  const total = hijas.reduce((sum, h) => sum + (Number(values[h.id]) || 0), 0)

  if (loading) {
    return <Card title="Distribución mensual" className="span-3"><p style={{ color: 'var(--text-muted)' }}>Cargando…</p></Card>
  }

  const primaryBtn = {
    minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, border: 'none',
    background: 'var(--series-1)', color: '#fff', fontWeight: 600,
    opacity: saving || confirming ? 0.6 : 1,
  }
  const secondaryBtn = {
    minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10,
    border: '1px solid var(--series-1)', background: 'transparent', color: 'var(--series-1)', fontWeight: 600,
    opacity: saving || confirming || total === 0 ? 0.6 : 1,
  }

  return (
    <Card title={`Distribución mensual — ${month}/${year}`} className="span-3">
      {isTemplate && (
        <p style={{ font: 'var(--font-footnote)', color: 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
          Aún no has definido la distribución de este mes — se precargó como plantilla la del mes anterior.
          Ajustala y guardala.
        </p>
      )}
      {error && <p style={{ font: 'var(--font-footnote)', color: 'var(--status-critical)', margin: '0 0 var(--space-2)' }}>{error}</p>}
      {done && <p style={{ font: 'var(--font-footnote)', color: 'var(--status-good)', margin: '0 0 var(--space-2)' }}>{done}</p>}

      {madre && (
        <div style={{ marginBottom: 'var(--space-2)' }}>
          <SwitchRow
            title="El reparto sale de la cuenta madre"
            helper={fromMother
              ? 'Cada hija recibe su monto como una transferencia de la madre, y la madre baja el total repartido.'
              : 'Esa plata no salió de la madre: cada hija arranca el mes con su monto como saldo inicial, y la madre no se toca.'}
            checked={fromMother}
            onChange={(v) => onFromMotherChange?.(v)}
          />
        </div>
      )}

      <form onSubmit={handleSave}>
        {madre && (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <span style={{ display: 'block', font: 'var(--font-subheadline)', fontWeight: 600, marginBottom: 6 }}>
              Saldo inicial de {madre.name} ({month}/{year})
            </span>
            <input
              type="number" step="any" value={madreStart} placeholder="0"
              onChange={(e) => setMadreStart(e.target.value)}
              style={{ width: 180, minHeight: 40, borderRadius: 8, border: '1px solid var(--border-hairline)', padding: '0 8px' }}
            />
            <p style={{ font: 'var(--font-footnote)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Es el punto de partida de la cuenta madre este mes: de acá se descuenta lo que repartís y lo que gastás.
              No es un movimiento, por eso cuenta desde que lo guardás.
              {startPrefilled && ' Este número venía de tu distribución anterior — guardá para que pase a ser el saldo inicial.'}
            </p>
          </div>
        )}

        <div className="table-scroll" style={{ marginBottom: 'var(--space-2)' }}>
          <table className="simple-table">
            <thead><tr><th>Cuenta</th><th>Monto asignado</th></tr></thead>
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
                <tr><td colSpan={2} style={{ color: 'var(--text-muted)' }}>No hay cuentas hijas para repartir.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {notes.length > 0 && (
          <p style={{ font: 'var(--font-footnote)', color: 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
            {notes.join(' · ')}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-2)' }}>
          <span style={{ font: 'var(--font-subheadline)', color: 'var(--text-secondary)' }}>
            Total a distribuir: <strong style={{ color: 'var(--text-primary)' }}>{formatCOP(total)}</strong>
            {madre && ` · de ${formatCOP(madreBalance)}`}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" disabled={saving || confirming} style={primaryBtn}>
              {saving ? 'Guardando…' : 'Guardar distribución'}
            </button>
            {fromMother && (
              <button type="button" onClick={handleConfirm} disabled={saving || confirming || total === 0} style={secondaryBtn}>
                {confirming ? 'Confirmando…' : pending.length ? 'Confirmar transferencia real' : 'Transferencias al día'}
              </button>
            )}
          </div>
        </div>

        {fromMother ? (
          <p style={{ font: 'var(--font-footnote)', color: 'var(--text-muted)', margin: 0 }}>
            Paso 1 guarda el plan. Paso 2 convierte ese plan en transferencias reales: recién ahí cada hija arranca el
            mes en el monto asignado (y de ahí se le resta lo que gasta) y la madre baja el total repartido.
            {pending.length > 0
              ? ` Falta confirmar: ${pending.map((p) => p.name).join(', ')}.`
              : ' Todas las transferencias están al día.'}
          </p>
        ) : (
          <p style={{ font: 'var(--font-footnote)', color: 'var(--text-muted)', margin: 0 }}>
            Con el reparto desligado de la madre no hay transferencias que confirmar: al guardar la distribución, cada
            hija queda con su monto como saldo inicial del mes y la madre no se toca.
            {conSaldoPropio.length > 0 && ` ${conSaldoPropio.map((c) => c.name).join(', ')} ya ${conSaldoPropio.length === 1 ? 'tiene' : 'tienen'} su saldo inicial cargado aparte: el reparto no ${conSaldoPropio.length === 1 ? 'lo' : 'los'} pisa.`}
          </p>
        )}

        {!fromMother && ritualTransfers.length > 0 && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <p style={{ font: 'var(--font-footnote)', color: 'var(--status-warning)', margin: '0 0 6px' }}>
              Este mes ya tiene {ritualTransfers.length} transferencia(s) del reparto: esas hijas recibieron la plata de
              la madre, así que no les puse saldo inicial. Si esa plata no salió de la madre, quítalas.
            </p>
            <button
              type="button" onClick={() => setConfirmRemove(true)} disabled={saving}
              style={{
                minHeight: 36, padding: '0 var(--space-2)', borderRadius: 10,
                border: '1px solid var(--status-warning)', background: 'transparent', color: 'var(--status-warning)', fontWeight: 600,
                opacity: saving ? 0.6 : 1,
              }}
            >
              Quitar las transferencias del reparto
            </button>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={!!confirmRemove}
        title="¿Quitar las transferencias del reparto de este mes?"
        message="Se borran y cada hija queda con su monto como saldo inicial del mes. Solo se van las transferencias del reparto, no las que hayas cargado a mano."
        confirmLabel="Quitar"
        destructive
        onConfirm={handleRemoveTransfers}
        onCancel={() => setConfirmRemove(false)}
      />
    </Card>
  )
}
