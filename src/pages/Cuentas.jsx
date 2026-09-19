import { useEffect, useState } from 'react'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import FixedExpensesSection from '../components/FixedExpensesSection.jsx'
import MonthlyAllocationSection from '../components/MonthlyAllocationSection.jsx'
import MonthlyInitialBalancesSection from '../components/MonthlyInitialBalancesSection.jsx'
import TransferHistorySection from '../components/TransferHistorySection.jsx'
import { Field, InfoCard, SwitchRow, ChipPicker, EditHeader, EditActions, inputClass } from '../components/ui/FormKit.jsx'
import { formatCOP, formatByCurrency, CURRENCIES } from '../lib/format.js'
import {
  listAccounts, updateAccount, archiveAccount, fetchBalancesForMonth,
  addAccountCurrency, removeAccountCurrency,
} from '../lib/accountsApi.js'
import { getRates } from '../lib/exchangeRatesApi.js'
import { getAccountFlowsForMonth } from '../lib/transactionsApi.js'
import { flattenAccountPockets } from '../lib/currencyPockets.js'
import styles from './Cuentas.module.css'

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: c }))

const emptyEdit = { name: '', currency: 'COP', isMulti: false, extras: [], newExtraCurrency: '', newExtraTag: '' }

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
  const [edit, setEdit] = useState(emptyEdit)
  const [activePocket, setActivePocket] = useState({}) // accountId -> pocketKey
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

  // Ajustes → Tasas de cambio también puede guardar una tasa mientras esta
  // página sigue montada debajo del panel — mismo patrón de evento global
  // que dashboard:debts-changed/goals-changed, para que el "1 USD = ..." de
  // cada cuenta se actualice sin recargar la página entera.
  useEffect(() => {
    window.addEventListener('dashboard:rates-changed', reload)
    window.addEventListener('dashboard:accounts-changed', reload)
    return () => {
      window.removeEventListener('dashboard:rates-changed', reload)
      window.removeEventListener('dashboard:accounts-changed', reload)
    }
  }, [])

  const madre = accounts?.find((a) => a.kind === 'madre')
  const hijas = accounts?.filter((a) => a.kind === 'hija') ?? []
  // Las cuentas multi-moneda quedan fuera del ritual mensual madre->hijas:
  // ese ritual no tiene concepto de moneda (ver CLAUDE.md, "Known deferred
  // scope"), y una cuenta con varios bolsillos no encaja en "un solo monto en
  // COP a distribuir" aunque su moneda primaria sea COP.
  const hijasCop = hijas.filter((h) => !h.is_multi_currency && (h.currency || 'COP') === 'COP')

  function startEdit(account) {
    setEditingId(account.id)
    setEdit({
      name: account.name,
      currency: account.currency || 'COP',
      isMulti: !!account.is_multi_currency,
      extras: (account.extraCurrencies ?? []).map((c) => ({ ...c })),
      newExtraCurrency: '',
      newExtraTag: '',
    })
  }

  function addExtraToEditDraft() {
    if (!edit.newExtraCurrency) return
    setEdit((prev) => ({
      ...prev,
      extras: [...prev.extras, { currency: prev.newExtraCurrency, tag: prev.newExtraTag.trim() || `${prev.name} ${prev.newExtraCurrency}`.toLowerCase() }],
      newExtraCurrency: '',
      newExtraTag: '',
    }))
  }

  function removeExtraFromEditDraft(currency) {
    setEdit((prev) => ({ ...prev, extras: prev.extras.filter((c) => c.currency !== currency) }))
  }

  async function handleRenameSave(id) {
    if (!edit.name.trim()) return
    try {
      await updateAccount(id, { name: edit.name.trim(), currency: edit.currency, is_multi_currency: edit.isMulti })

      const account = accounts.find((a) => a.id === id)
      const before = new Set((account?.extraCurrencies ?? []).map((c) => c.currency))
      const after = edit.isMulti ? new Set(edit.extras.map((c) => c.currency)) : new Set()

      for (const c of edit.extras) {
        if (edit.isMulti && !before.has(c.currency)) await addAccountCurrency(id, c.currency, c.tag)
      }
      for (const currency of before) {
        if (!after.has(currency)) await removeAccountCurrency(id, currency)
      }

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
            Todavía no hay una cuenta madre creada. Créala primero, antes de agregar cuentas hijas.
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('dashboard:open-settings', { detail: { section: 'cuentas' } }))}
            style={{
              minHeight: 'var(--touch-target)', padding: 0, background: 'none', border: 'none',
              color: 'var(--series-1)', font: 'var(--font-subheadline)', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Crear cuenta madre →
          </button>
        </Card>
      )}

      {hijas.some((a) => (a.currency || 'COP') !== 'COP' && !rates.some((r) => r.base_currency === 'COP' && r.quote_currency === (a.currency || 'COP'))) && (
        <p style={{ font: 'var(--font-caption)', color: 'var(--status-warning)', margin: '0 0 var(--space-2)' }}>
          Hay cuentas cuyos saldos no se están sumando en Panel General ni Deudas hasta que definas su tasa hacia COP (Ajustes → Tasas de cambio).
        </p>
      )}

      <div className="grid-auto">
        {hijas.map((account) => {
          const pockets = flattenAccountPockets([account])
          const activeKey = activePocket[account.id] ?? pockets[0].key
          const active = pockets.find((p) => p.key === activeKey) ?? pockets[0]
          const currency = active.currency
          const bal = balances[active.key] ?? 0
          const alloc = allocated[active.key]
          const spentAmt = spent[active.key] ?? 0
          // La plata que entra a la cuenta fuera del reparto mensual de la
          // madre amplía lo disponible: gastarla no es sobregirar el
          // presupuesto. account_allocations queda intacta, siempre significa
          // "lo que la madre repartió".
          const incomeAmt = income[active.key] ?? 0
          const disponible = (alloc ?? 0) + incomeAmt
          // Lo transferido a otra cuenta también consume el presupuesto: si la
          // plata salió de acá para gastarse desde otro bolsillo, no sigue
          // disponible.
          const movidoAmt = transferredOut[active.key] ?? 0
          const usado = spentAmt + movidoAmt
          const pct = disponible > 0 ? Math.round((usado / disponible) * 100) : null
          const isEditing = editingId === account.id

          return (
            <Card key={account.id} className={isEditing ? 'span-3' : undefined}>
              {isEditing ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleRenameSave(account.id) }}
                  className={styles.editForm}
                >
                  <EditHeader
                    avatar={edit.name.trim() ? edit.name.trim().charAt(0).toUpperCase() : '?'}
                    caption="Editando cuenta"
                    badge={edit.isMulti ? 'Multi-moneda' : edit.currency} badgeTone="accent"
                  >
                    <Field label="Nombre de la cuenta">
                      <input
                        autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        className={inputClass} placeholder="Ej. Nequi, Pibank, Arq"
                      />
                    </Field>
                  </EditHeader>

                  <Field label={edit.isMulti ? 'Moneda principal' : 'Moneda'}>
                    <ChipPicker
                      options={CURRENCY_OPTIONS} value={edit.currency}
                      onChange={(currency) => setEdit({ ...edit, currency, extras: edit.extras.filter((c) => c.currency !== currency) })}
                    />
                  </Field>
                  {edit.currency !== (account.currency || 'COP') && (
                    <InfoCard tone="warning">
                      Al saldo solo se suman los movimientos en la moneda de la cuenta — si la cambiás, los ya
                      registrados en {account.currency || 'COP'} dejan de contar.
                    </InfoCard>
                  )}

                  <SwitchRow
                    title="Cuenta multi-moneda"
                    helper="Guarda un saldo por cada moneda bajo esta misma cuenta (ej. Arq en USD y EUR)."
                    checked={edit.isMulti} onChange={(isMulti) => setEdit({ ...edit, isMulti })}
                  />

                  {edit.isMulti && (
                    <div className={styles.pocketBlock}>
                      <Field label="Otras monedas" hint={`Además de ${edit.currency}`}>
                        {edit.extras.length > 0 && (
                          <div className={styles.pocketList}>
                            {edit.extras.map((c) => (
                              <div key={c.currency} className={styles.pocketRow}>
                                <span className={styles.pocketCode}>{c.currency}</span>
                                <span className={styles.pocketTag}>tag "{c.tag}"</span>
                                <button type="button" onClick={() => removeExtraFromEditDraft(c.currency)} className={styles.removeLink}>Quitar</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <ChipPicker
                          options={CURRENCIES.filter((c) => c !== edit.currency && !edit.extras.some((e2) => e2.currency === c)).map((c) => ({ value: c, label: `+ ${c}` }))}
                          value={edit.newExtraCurrency} allowClear
                          onChange={(newExtraCurrency) => setEdit({ ...edit, newExtraCurrency })}
                        />
                      </Field>
                      {edit.newExtraCurrency && (
                        <div className={styles.addRow}>
                          <input
                            placeholder={`Tag para MonIA (ej. ${edit.name.trim().toLowerCase()} ${edit.newExtraCurrency.toLowerCase()})`}
                            value={edit.newExtraTag} onChange={(e) => setEdit({ ...edit, newExtraTag: e.target.value })}
                            className={inputClass} style={{ flex: 1 }}
                          />
                          <button
                            type="button" onClick={addExtraToEditDraft}
                            style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600 }}
                          >
                            Agregar
                          </button>
                        </div>
                      )}
                      <InfoCard>
                        El tag es lo que escribís en MonIA para que una compra caiga en esa moneda. MonIA no acepta
                        espacios: usá guion bajo (arq_eur).
                      </InfoCard>
                    </div>
                  )}

                  <EditActions
                    disabled={!edit.name.trim()} onCancel={() => setEditingId(null)}
                    onDelete={() => handleArchive(account.id, account.name)} deleteLabel="Eliminar cuenta"
                  />
                </form>
              ) : (
                <div
                  className={styles.cardHeader} role="button" tabIndex={0}
                  onClick={() => startEdit(account)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(account) } }}
                >
                  <span className={styles.avatar}>{account.name.charAt(0).toUpperCase()}</span>
                  <div className={styles.cardHeaderText}>
                    <h2 className={styles.cardName}>{account.name}</h2>
                    <span className={styles.cardSubtitle}>
                      {pockets.length > 1 ? `Multi-moneda · ${pockets.map((p) => p.currency).join(' · ')}` : currency}
                    </span>
                  </div>
                  <button
                    type="button" className={styles.deleteLink}
                    onClick={(e) => { e.stopPropagation(); handleArchive(account.id, account.name) }}
                  >
                    Eliminar
                  </button>
                </div>
              )}

              {isEditing ? null : (
              <>
              {pockets.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {pockets.map((p) => (
                    <button
                      key={p.key} type="button"
                      onClick={() => setActivePocket({ ...activePocket, [account.id]: p.key })}
                      style={{
                        minHeight: 28, padding: '0 10px', borderRadius: 14, font: 'var(--font-caption)', fontWeight: 600,
                        border: p.key === active.key ? 'none' : '1px solid var(--border-hairline)',
                        background: p.key === active.key ? 'var(--series-1)' : 'transparent',
                        color: p.key === active.key ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      {p.currency}
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
              </>
              )}
            </Card>
          )
        })}

        <MonthlyAllocationSection hijas={hijasCop} madre={madre} year={YEAR} month={MONTH} onSaved={reload} />

        <FixedExpensesSection accounts={accounts ?? []} />

        <TransferHistorySection accounts={accounts} year={YEAR} month={MONTH} onSaved={reload} />

        <MonthlyInitialBalancesSection accounts={accounts} year={YEAR} month={MONTH} balances={balances} onSaved={reload} />
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
