import { useEffect, useState } from 'react'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import FixedExpensesSection from '../components/FixedExpensesSection.jsx'
import MonthlyAllocationSection from '../components/MonthlyAllocationSection.jsx'
import MonthlyInitialBalancesSection from '../components/MonthlyInitialBalancesSection.jsx'
import TransferHistorySection from '../components/TransferHistorySection.jsx'
import CurrencyExchangeSection from '../components/CurrencyExchangeSection.jsx'
import { formatCOP, formatByCurrency, CURRENCIES } from '../lib/format.js'
import { listAccounts, createAccount, updateAccount, archiveAccount, fetchBalancesForMonth, setCurrencyGroup } from '../lib/accountsApi.js'
import { getRates, setRate } from '../lib/exchangeRatesApi.js'
import { getAccountFlowsForMonth } from '../lib/transactionsApi.js'

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1

export default function Cuentas() {
  const [accounts, setAccounts] = useState(null)
  const [balances, setBalances] = useState({})
  const [allocated, setAllocated] = useState({})
  const [spent, setSpent] = useState({})
  const [income, setIncome] = useState({})
  const [transferredOut, setTransferredOut] = useState({})
  const [rates, setRates] = useState([])
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editCurrency, setEditCurrency] = useState('COP')
  const [editGroupWith, setEditGroupWith] = useState('')
  const [activePocket, setActivePocket] = useState({}) // groupKey -> accountId
  const [newName, setNewName] = useState('')
  const [newCurrency, setNewCurrency] = useState('COP')
  const [creating, setCreating] = useState(false)
  const [rateInputs, setRateInputs] = useState({}) // "base_quote" -> string
  const [savingRatePair, setSavingRatePair] = useState(null) // "base_quote" | null
  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null

  async function reload() {
    try {
      const rows = await listAccounts()
      setAccounts(rows)
      const [{ balances: b, allocated: a, transferredOut: out }, currentRates, flows] = await Promise.all([
        fetchBalancesForMonth(rows, YEAR, MONTH),
        getRates(),
        getAccountFlowsForMonth(rows, YEAR, MONTH),
      ])
      setBalances(b)
      setAllocated(a)
      setTransferredOut(out)
      setRates(currentRates)
      setSpent(flows.spent)
      setIncome(flows.income)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [])

  const madre = accounts?.find((a) => a.kind === 'madre')
  const hijas = accounts?.filter((a) => a.kind === 'hija') ?? []
  const hijasCop = hijas.filter((h) => (h.currency || 'COP') === 'COP')

  // Agrupa cuentas ligadas por currency_group_id (ej. Arq EUR -> Arq) para
  // mostrarlas como una sola tarjeta con selector de moneda, en vez de una
  // tarjeta por fila — son cuentas separadas de verdad, esto es solo
  // agrupación visual (ver setCurrencyGroup en accountsApi.js).
  const groupsByKey = {}
  const groupOrder = []
  for (const h of hijas) {
    const key = h.currency_group_id ?? h.id
    if (!groupsByKey[key]) { groupsByKey[key] = []; groupOrder.push(key) }
    groupsByKey[key].push(h)
  }
  const accountGroups = groupOrder.map((key) => groupsByKey[key])

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createAccount({ name: newName.trim(), kind: 'hija', parentAccountId: madre?.id, currency: newCurrency })
      setNewName('')
      setNewCurrency('COP')
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleRenameSave(id) {
    if (!editName.trim()) return
    try {
      await updateAccount(id, { name: editName.trim(), currency: editCurrency })
      await setCurrencyGroup(id, editGroupWith || null)
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
      await archiveAccount(target.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // Una fila (base, quote, rate) siempre significa "1 quote = rate base"
  // (ej. base='COP', quote='USD' -> "1 USD = rate COP"). Para el par
  // USD/EUR eso significa "1 EUR = rate USD" — si el usuario da una tasa
  // "de dólar a euro" (cuántos euros salen de 1 dólar), hay que guardar su
  // recíproco (1 / tasa), no el valor tal cual. Esto ya mordió una vez.
  async function handleSaveRate(e, base, quote) {
    e.preventDefault()
    const pairKey = `${base}_${quote}`
    const input = rateInputs[pairKey]
    if (!input) return
    setSavingRatePair(pairKey)
    try {
      await setRate(base, quote, Number(input))
      setRateInputs({ ...rateInputs, [pairKey]: '' })
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingRatePair(null)
    }
  }

  // Fila compacta de tasa de cambio, para renderizar contextualmente dentro
  // de la tarjeta de la cuenta que usa esa moneda, en vez de una tarjeta
  // "Tasa de cambio" aparte y desconectada.
  function renderRateRow(base, quote) {
    const pairKey = `${base}_${quote}`
    const existing = rates.find((r) => r.base_currency === base && r.quote_currency === quote)
    return (
      <div key={pairKey} style={{ marginTop: 8 }}>
        <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginBottom: 4 }}>
          {existing ? `1 ${quote} = ${formatByCurrency(existing.rate, base)}` : `1 ${quote} = ? ${base} (sin configurar)`}
        </div>
        <form onSubmit={(e) => handleSaveRate(e, base, quote)} style={{ display: 'flex', gap: 6 }}>
          <input
            type="number" placeholder={`Ej. ${base === 'COP' ? '4000' : '1.1'}`}
            value={rateInputs[pairKey] ?? ''}
            onChange={(e) => setRateInputs({ ...rateInputs, [pairKey]: e.target.value })}
            style={{ flex: 1, minWidth: 0, minHeight: 32, borderRadius: 8, border: '1px solid var(--border-hairline)', padding: '0 8px', font: 'var(--font-caption)' }}
          />
          <button
            type="submit" disabled={savingRatePair === pairKey}
            style={{ minHeight: 32, padding: '0 10px', borderRadius: 8, background: 'var(--series-1)', color: '#fff', fontWeight: 600, font: 'var(--font-caption)', opacity: savingRatePair === pairKey ? 0.6 : 1 }}
          >
            Guardar
          </button>
        </form>
      </div>
    )
  }

  if (error) {
    return <p style={{ color: 'var(--status-critical)' }}>Error cargando cuentas: {error}</p>
  }

  if (!accounts) {
    return <p style={{ color: 'var(--text-muted)' }}>Cargando cuentas…</p>
  }

  return (
    <div>
      <h1 className="page-title">Cuentas</h1>

      {madre ? (
        <Card title={`Cuenta madre — ${madre.name}`} className="span-3" style={{ marginBottom: 'var(--space-2)' }}>
          <div style={{ font: 'var(--font-title)' }}>{formatCOP(balances[madre.id] ?? 0)}</div>
        </Card>
      ) : (
        <Card className="span-3" style={{ marginBottom: 'var(--space-2)' }}>
          <p style={{ font: 'var(--font-subheadline)', color: 'var(--text-muted)', margin: 0 }}>
            Todavía no hay una cuenta madre creada en Supabase. Insértala en el SQL Editor (ver `schema.sql`)
            antes de agregar cuentas hijas.
          </p>
        </Card>
      )}

      {hijas.some((a) => (a.currency || 'COP') !== 'COP' && !rates.some((r) => r.base_currency === 'COP' && r.quote_currency === (a.currency || 'COP'))) && (
        <p style={{ font: 'var(--font-caption)', color: 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
          Hay cuentas cuyos saldos no se están sumando en Panel General ni Deudas hasta que definas su tasa hacia COP (editá la cuenta correspondiente más abajo).
        </p>
      )}

      <div className="grid-auto">
        {accountGroups.map((group) => {
          const groupKey = group[0].currency_group_id ?? group[0].id
          const activeId = activePocket[groupKey] ?? group[0].id
          const active = group.find((a) => a.id === activeId) ?? group[0]
          const currency = active.currency || 'COP'
          const bal = balances[active.id] ?? 0
          const alloc = allocated[active.id]
          const spentAmt = spent[active.id] ?? 0
          // La plata que entra a la cuenta fuera del reparto mensual de la
          // madre amplía lo disponible: gastarla no es sobregirar el
          // presupuesto. account_allocations queda intacta, siempre significa
          // "lo que la madre repartió".
          const incomeAmt = income[active.id] ?? 0
          const disponible = (alloc ?? 0) + incomeAmt
          // Lo transferido a otra cuenta también consume el presupuesto: si la
          // plata salió de acá para gastarse desde arq, no sigue disponible.
          const movidoAmt = transferredOut[active.id] ?? 0
          const usado = spentAmt + movidoAmt
          const pct = disponible > 0 ? Math.round((usado / disponible) * 100) : null
          const isEditing = editingId === active.id
          const nonCopCurrencies = [...new Set(group.map((m) => m.currency || 'COP').filter((c) => c !== 'COP'))]

          return (
            <Card key={groupKey}>
              {isEditing ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 'var(--space-1)' }}>
                  <input
                    autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                    style={{ flex: 1, minWidth: 100, minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }}
                  />
                  <select
                    value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)}
                    style={{ minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)' }}
                  >
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    value={editGroupWith} onChange={(e) => setEditGroupWith(e.target.value)}
                    title="Mostrarla junto a otra cuenta como si fueran distintas monedas de lo mismo (ej. Arq EUR con Arq)"
                    style={{ minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', flexBasis: '100%' }}
                  >
                    <option value="">Cuenta independiente</option>
                    {hijas.filter((h) => h.id !== active.id && (h.currency_group_id ?? h.id) !== groupKey).map((h) => (
                      <option key={h.id} value={h.id}>Es otra moneda de {h.name}</option>
                    ))}
                  </select>
                  <button onClick={() => handleRenameSave(active.id)} style={{ color: 'var(--series-1)', fontWeight: 600 }}>Guardar</button>
                  <button onClick={() => setEditingId(null)} style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                  <h2 style={{ font: 'var(--font-headline)', margin: 0 }}>
                    {group.length > 1 ? group[0].name : active.name}
                    {group.length === 1 && currency !== 'COP' && <span style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>{currency}</span>}
                  </h2>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEditingId(active.id); setEditName(active.name); setEditCurrency(currency); setEditGroupWith(active.currency_group_id ?? '') }} style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>Editar</button>
                    <button onClick={() => handleArchive(active.id, active.name)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                  </div>
                </div>
              )}

              {group.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {group.map((m) => (
                    <button
                      key={m.id} type="button"
                      onClick={() => setActivePocket({ ...activePocket, [groupKey]: m.id })}
                      style={{
                        minHeight: 28, padding: '0 10px', borderRadius: 14, font: 'var(--font-caption)', fontWeight: 600,
                        border: m.id === active.id ? 'none' : '1px solid var(--border-hairline)',
                        background: m.id === active.id ? 'var(--series-1)' : 'transparent',
                        color: m.id === active.id ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      {m.currency || 'COP'}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ font: 'var(--font-title)', marginBottom: 4, color: bal < 0 ? 'var(--status-critical)' : 'var(--text-primary)' }}>
                {formatByCurrency(bal, currency)}
              </div>
              <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginBottom: 8 }}>
                {incomeAmt > 0
                  ? `de ${formatByCurrency(disponible, currency)} disponibles (${alloc != null ? formatByCurrency(alloc, currency) : formatByCurrency(0, currency)} asignados + ${formatByCurrency(incomeAmt, currency)} de ingresos)`
                  : alloc != null ? `de ${formatByCurrency(alloc, currency)} asignados este mes` : 'sin distribución definida este mes'}
              </div>
              {pct != null && (
                <>
                  <div style={{ height: 6, background: 'var(--gridline)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct > 100 ? 'var(--status-critical)' : 'var(--series-1)' }} />
                  </div>
                  <div style={{ font: 'var(--font-caption)', color: pct > 100 ? 'var(--status-critical)' : 'var(--text-muted)', marginTop: 4 }}>
                    {pct > 100
                      ? `Sobregirada — ${pct - 100}% por encima de lo ${incomeAmt > 0 ? 'disponible' : 'asignado'}`
                      : `${pct}% usado`}
                    {movidoAmt > 0 && ` — ${formatByCurrency(movidoAmt, currency)} movidos a otras cuentas`}
                  </div>
                </>
              )}

              {nonCopCurrencies.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-hairline)' }}>
                  {nonCopCurrencies.map((c) => renderRateRow('COP', c))}
                  {nonCopCurrencies.includes('USD') && nonCopCurrencies.includes('EUR') && renderRateRow('USD', 'EUR')}
                </div>
              )}
            </Card>
          )
        })}

        <Card title="Agregar cuenta hija">
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="Nombre (ej. Pibank)" value={newName} onChange={(e) => setNewName(e.target.value)}
                style={{ flex: 1, minWidth: 0, minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }}
              />
              <select
                value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)}
                style={{ minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)' }}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button
              type="submit" disabled={creating}
              style={{ alignSelf: 'flex-start', minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: creating ? 0.6 : 1 }}
            >
              Agregar
            </button>
          </form>
        </Card>

        <MonthlyAllocationSection hijas={hijasCop} madre={madre} year={YEAR} month={MONTH} onSaved={reload} />

        <MonthlyInitialBalancesSection accounts={accounts} year={YEAR} month={MONTH} onSaved={reload} />

        <CurrencyExchangeSection accounts={accounts} rates={rates} onSaved={reload} />

        <TransferHistorySection accounts={accounts} year={YEAR} month={MONTH} onSaved={reload} />

        <FixedExpensesSection accounts={accounts ?? []} />
      </div>

      <ConfirmDialog
        open={!!confirmArchive}
        title={`¿Eliminar la cuenta "${confirmArchive?.name}"?`}
        message="Se archiva y deja de mostrarse (el historial no se pierde)."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doArchive}
        onCancel={() => setConfirmArchive(null)}
      />
    </div>
  )
}
