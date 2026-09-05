import { useEffect, useState } from 'react'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import FixedExpensesSection from '../components/FixedExpensesSection.jsx'
import MonthlyAllocationSection from '../components/MonthlyAllocationSection.jsx'
import MonthlyInitialBalancesSection from '../components/MonthlyInitialBalancesSection.jsx'
import TransferHistorySection from '../components/TransferHistorySection.jsx'
import { formatCOP, formatByCurrency } from '../lib/format.js'
import { listAccounts, createAccount, updateAccount, archiveAccount, fetchBalancesForMonth } from '../lib/accountsApi.js'
import { getRate, setRate } from '../lib/exchangeRatesApi.js'
import { getSpentByAccountForMonth } from '../lib/transactionsApi.js'

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1

export default function Cuentas() {
  const [accounts, setAccounts] = useState(null)
  const [balances, setBalances] = useState({})
  const [allocated, setAllocated] = useState({})
  const [spent, setSpent] = useState({})
  const [rate, setRateState] = useState(null)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editCurrency, setEditCurrency] = useState('COP')
  const [newName, setNewName] = useState('')
  const [newCurrency, setNewCurrency] = useState('COP')
  const [creating, setCreating] = useState(false)
  const [rateInput, setRateInput] = useState('')
  const [savingRate, setSavingRate] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null

  async function reload() {
    try {
      const rows = await listAccounts()
      setAccounts(rows)
      const [{ balances: b, allocated: a }, currentRate, s] = await Promise.all([
        fetchBalancesForMonth(rows, YEAR, MONTH),
        getRate(),
        getSpentByAccountForMonth(rows.map((r) => r.id), YEAR, MONTH),
      ])
      setBalances(b)
      setAllocated(a)
      setRateState(currentRate)
      setSpent(s)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [])

  const madre = accounts?.find((a) => a.kind === 'madre')
  const hijas = accounts?.filter((a) => a.kind === 'hija') ?? []
  const hijasCop = hijas.filter((h) => (h.currency || 'COP') === 'COP')
  const accountsCop = (accounts ?? []).filter((a) => (a.currency || 'COP') === 'COP')

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

  async function handleSaveRate(e) {
    e.preventDefault()
    if (!rateInput) return
    setSavingRate(true)
    try {
      await setRate(Number(rateInput))
      setRateInput('')
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingRate(false)
    }
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

      <div className="grid-auto">
        {hijas.map((h) => {
          const currency = h.currency || 'COP'
          const bal = balances[h.id] ?? 0
          const alloc = allocated[h.id]
          const spentAmt = spent[h.id] ?? 0
          const pct = alloc ? Math.round((spentAmt / alloc) * 100) : null
          const isEditing = editingId === h.id

          return (
            <Card key={h.id}>
              {isEditing ? (
                <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-1)' }}>
                  <input
                    autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                    style={{ flex: 1, minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }}
                  />
                  <select
                    value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)}
                    style={{ minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)' }}
                  >
                    <option value="COP">COP</option>
                    <option value="USD">USD</option>
                  </select>
                  <button onClick={() => handleRenameSave(h.id)} style={{ color: 'var(--series-1)', fontWeight: 600 }}>Guardar</button>
                  <button onClick={() => setEditingId(null)} style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                  <h2 style={{ font: 'var(--font-headline)', margin: 0 }}>
                    {h.name}
                    {currency === 'USD' && <span style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>USD</span>}
                  </h2>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEditingId(h.id); setEditName(h.name); setEditCurrency(currency) }} style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>Editar</button>
                    <button onClick={() => handleArchive(h.id, h.name)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                  </div>
                </div>
              )}

              <div style={{ font: 'var(--font-title)', marginBottom: 4, color: bal < 0 ? 'var(--status-critical)' : 'var(--text-primary)' }}>
                {formatByCurrency(bal, currency)}
              </div>
              <div style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginBottom: 8 }}>
                {alloc != null ? `de ${formatByCurrency(alloc, currency)} asignados este mes` : 'sin distribución definida este mes'}
              </div>
              {pct != null && (
                <>
                  <div style={{ height: 6, background: 'var(--gridline)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct > 100 ? 'var(--status-critical)' : 'var(--series-1)' }} />
                  </div>
                  <div style={{ font: 'var(--font-caption)', color: pct > 100 ? 'var(--status-critical)' : 'var(--text-muted)', marginTop: 4 }}>
                    {pct > 100 ? `Sobregirada — ${pct - 100}% por encima de lo asignado` : `${pct}% usado`}
                  </div>
                </>
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
                <option value="COP">COP</option>
                <option value="USD">USD</option>
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

        <Card title="Tasa de cambio">
          <div style={{ font: 'var(--font-title)', marginBottom: 4 }}>
            {rate ? `1 USD = ${formatCOP(rate.rate)}` : 'Sin configurar'}
          </div>
          {!rate && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--status-warning)', margin: '0 0 8px' }}>
              Los saldos en cuentas USD no se están sumando en Panel General ni Deudas hasta que definas la tasa.
            </p>
          )}
          <form onSubmit={handleSaveRate} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="number" placeholder="Ej. 4000" value={rateInput} onChange={(e) => setRateInput(e.target.value)}
              style={{ minWidth: 0, minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }}
            />
            <button
              type="submit" disabled={savingRate}
              style={{ alignSelf: 'flex-start', minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: savingRate ? 0.6 : 1 }}
            >
              Guardar
            </button>
          </form>
        </Card>

        <MonthlyAllocationSection hijas={hijasCop} madre={madre} year={YEAR} month={MONTH} onSaved={reload} />

        <MonthlyInitialBalancesSection accounts={accounts} year={YEAR} month={MONTH} onSaved={reload} />

        <TransferHistorySection accounts={accounts} year={YEAR} month={MONTH} onSaved={reload} />

        <FixedExpensesSection accounts={accountsCop} />
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
