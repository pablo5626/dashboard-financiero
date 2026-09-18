import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import MonthYearPicker, { MONTH_NAMES } from '../components/ui/MonthYearPicker.jsx'
import { formatCOP, formatByCurrency } from '../lib/format.js'
import { listAccounts } from '../lib/accountsApi.js'
import { getRates, toCOP } from '../lib/exchangeRatesApi.js'
import { buildPocketIndex, resolvePocketKey, flattenAccountPockets } from '../lib/currencyPockets.js'
import { listCategories } from '../lib/categoriesApi.js'
import { getAllocationsForMonth } from '../lib/allocationsApi.js'
import { getTransfersForMonth, sumOutgoingByAccount } from '../lib/transfersApi.js'
import { listFixedExpenses, createFixedExpense } from '../lib/fixedExpensesApi.js'
import {
  parseMonIACSV, filterRowsByMonth, importTransactions,
  listPendingTransactions, fetchSuggestionsForCategories, confirmAssignment,
  listTransactionsForMonth, listRecentExpenses, detectRecurringCandidates,
  deleteTransaction, isIgnoredRow,
  listPendingCurrencyTransactions, confirmCurrencyAmount, updateTransactionTags,
} from '../lib/transactionsApi.js'

const now = new Date()

const PATTERN_MONTHS_BACK = 6
const CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)']

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

export default function GastosDiarios() {
  const [searchParams] = useSearchParams()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  // Filtro de la tabla "Movimientos — mes", client-side (monthTransactions
  // ya trae todo con joins) para no duplicar una consulta a Supabase — el
  // resto de la página (gráficos, "% usado") sigue viendo el mes completo
  // sin filtrar. Se puede precargar de un deep-link desde la lupa
  // (SearchPanel.jsx → "Ver en Gastos"), leído una sola vez al montar para
  // no pelear con que el usuario edite los filtros a mano después.
  const [txFilters, setTxFilters] = useState(() => ({
    categoryId: searchParams.get('categoryId') || '',
    accountId: searchParams.get('accountId') || '',
    tag: searchParams.get('tag') || '',
  }))

  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [pending, setPending] = useState(null)
  const [pendingCurrency, setPendingCurrency] = useState(null)
  const [suggestions, setSuggestions] = useState({})
  const [monthTransactions, setMonthTransactions] = useState(null)
  const [rates, setRates] = useState([])
  const [error, setError] = useState(null)

  const [csvRows, setCsvRows] = useState(null)
  const [csvFileName, setCsvFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [selectedAccountByTx, setSelectedAccountByTx] = useState({})
  const [amountByTx, setAmountByTx] = useState({})
  const [tagsDraftByTx, setTagsDraftByTx] = useState({})
  const [savingTagsId, setSavingTagsId] = useState(null)
  const [allocations, setAllocations] = useState({})
  const [transferredOut, setTransferredOut] = useState({})
  const [fixedExpenses, setFixedExpenses] = useState([])
  const [recentExpenses, setRecentExpenses] = useState([])
  const [addingCandidate, setAddingCandidate] = useState(null)

  const [confirmDeleteTx, setConfirmDeleteTx] = useState(null) // { id, purpose } | null

  async function reload() {
    try {
      const [accs, cats, pendingRows, currencyRows, monthRows, fixedRows, recent, currentRates] = await Promise.all([
        listAccounts(),
        listCategories(),
        listPendingTransactions(),
        listPendingCurrencyTransactions(),
        listTransactionsForMonth(year, month),
        listFixedExpenses(),
        listRecentExpenses(PATTERN_MONTHS_BACK),
        getRates(),
      ])
      setRates(currentRates)
      setAccounts(accs)
      setCategories(cats)
      setPending(pendingRows)
      setPendingCurrency(currencyRows)
      setMonthTransactions(monthRows)
      setFixedExpenses(fixedRows)
      setRecentExpenses(recent)
      setSuggestions(await fetchSuggestionsForCategories(pendingRows.map((t) => t.category_id)))
      setAllocations(await getAllocationsForMonth(accs.filter((a) => a.kind === 'hija').map((a) => a.id), year, month))
      setTransferredOut(sumOutgoingByAccount(await getTransfersForMonth(accs.map((a) => a.id), year, month), accs))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [year, month])

  const hijas = accounts.filter((a) => a.kind === 'hija')

  const filteredMonthTransactions = (monthTransactions ?? []).filter((t) => {
    if (txFilters.categoryId && t.category_id !== txFilters.categoryId) return false
    if (txFilters.accountId) {
      if (txFilters.accountId === 'pending' ? t.account_id : t.account_id !== txFilters.accountId) return false
    }
    if (txFilters.tag && !(t.tags ?? []).includes(txFilters.tag)) return false
    return true
  })
  const hasTxFilters = !!(txFilters.categoryId || txFilters.accountId || txFilters.tag)

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportResult(null)
    setCsvFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setCsvRows(parseMonIACSV(reader.result))
      } catch (err) {
        setError(err.message)
      }
    }
    reader.readAsText(file)
  }

  const matchingCount = csvRows ? filterRowsByMonth(csvRows, year, month).length : 0

  async function handleImport() {
    if (!csvRows) return
    setImporting(true)
    try {
      const result = await importTransactions(csvRows, year, month)
      setImportResult(result)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  async function handleConfirm(tx) {
    const accountId = selectedAccountByTx[tx.id]
    if (!accountId) return
    setConfirmingId(tx.id)
    try {
      await confirmAssignment(tx.id, accountId, tx.category_id)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirmingId(null)
    }
  }

  // El monto se teclea en la moneda de la cuenta (el que MonIA no exportó
  // porque convierte todo a COP al guardar). Se respeta el signo original de
  // la fila: un gasto sigue siendo negativo aunque el usuario escriba 51.31.
  async function handleConfirmCurrency(tx) {
    const raw = amountByTx[tx.id] ?? Math.abs(tx.amount)
    const value = Math.abs(Number(raw))
    if (!Number.isFinite(value) || value === 0) return
    setConfirmingId(tx.id)
    try {
      await confirmCurrencyAmount(tx.id, Number(tx.source_amount) < 0 ? -value : value)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirmingId(null)
    }
  }

  async function handleSaveTags(txId) {
    const raw = tagsDraftByTx[txId] ?? ''
    setSavingTagsId(txId)
    try {
      await updateTransactionTags(txId, raw.split(',').map((t) => t.trim()).filter(Boolean))
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingTagsId(null)
    }
  }

  async function handleAddCandidate(candidate) {
    setAddingCandidate(candidate.purpose)
    try {
      await createFixedExpense({
        name: candidate.purpose,
        amount: Math.round(candidate.avgAmount),
        dueDay: Math.min(31, Math.max(1, candidate.avgDay)),
        frequency: 'mensual',
        accountId: candidate.mostCommonAccountId,
      })
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingCandidate(null)
    }
  }

  function handleDeleteTx(tx) {
    setConfirmDeleteTx({ id: tx.id, purpose: tx.purpose })
  }

  async function doDeleteTx() {
    const target = confirmDeleteTx
    setConfirmDeleteTx(null)
    try {
      await deleteTransaction(target.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  if (error) {
    return <p style={{ color: 'var(--status-critical)' }}>Error cargando gastos diarios: {error}</p>
  }

  // Los tags que nombran una cuenta (o un bolsillo de una cuenta multi-moneda,
  // ej. "arq eur") ya están representados en el desglose por cuenta; contarlos
  // acá duplicaría el monto de la misma compra, que suele traer además un tag
  // descriptivo.
  const accountNameTags = new Set([
    ...hijas.map((h) => h.name.toLowerCase()),
    ...hijas.flatMap((h) => (h.extraCurrencies ?? []).map((c) => c.tag.toLowerCase())),
  ])

  // Vistas por cuenta (spentByAccount/incomeByAccount) van en la moneda propia
  // de cada bolsillo, igual que los saldos; las consolidadas (categoría y tag,
  // que cruzan cuentas de distinta moneda) convierten a COP con la tasa
  // vigente, igual que el Panel general.
  const pocketIndex = buildPocketIndex(accounts)
  const spentByCategory = {}
  const spentByTag = {}
  const spentByAccount = {}
  const incomeByAccount = {}
  // Cuenta cuántos de los movimientos sumados en spentByAccount todavía
  // tienen monto estimado (currency_pending) — para avisar en la tabla de
  // "Gasto real vs. presupuesto" que ese número puede afinarse confirmando
  // la cola de arriba, en vez de dejarlo pasar por un total ya exacto.
  const pendingByAccount = {}
  for (const t of monthTransactions ?? []) {
    if (isIgnoredRow(t.tags)) continue
    const currency = t.currency || 'COP'
    const pocketKey = t.account_id ? resolvePocketKey(pocketIndex, t.account_id, currency) : null
    if (Number(t.amount) >= 0) {
      if (pocketKey) incomeByAccount[pocketKey] = (incomeByAccount[pocketKey] ?? 0) + Number(t.amount)
      continue
    }
    const amount = -Number(t.amount)
    const amountCOP = toCOP(amount, currency, rates)
    spentByCategory[t.category_id] = (spentByCategory[t.category_id] ?? 0) + amountCOP
    if (pocketKey) {
      spentByAccount[pocketKey] = (spentByAccount[pocketKey] ?? 0) + amount
      if (t.currency_pending) pendingByAccount[pocketKey] = (pendingByAccount[pocketKey] ?? 0) + 1
    }
    for (const tag of t.tags ?? []) {
      if (accountNameTags.has(tag)) continue
      spentByTag[tag] = (spentByTag[tag] ?? 0) + amountCOP
    }
  }

  const categoryChartData = categories
    .map((c) => ({ name: c.name, value: spentByCategory[c.id] ?? 0 }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)

  const tagChartData = Object.entries(spentByTag)
    .map(([tag, value]) => ({ name: tag, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  // Ambas comparten la misma altura (la del más alto de los dos) — antes
  // cada una calculaba su alto según su propia cantidad de filas, así que
  // la más corta quedaba con espacio vacío al compartir fila en el grid con
  // la más alta (CSS Grid estira ambas tarjetas a la misma altura por
  // default, pero el gráfico adentro se quedaba con su alto fijo chico).
  const twoColChartHeight = Math.max(120, categoryChartData.length * 28, tagChartData.length * 28)

  const existingFixedNames = new Set(fixedExpenses.map((f) => f.name.trim().toLowerCase()))
  const recurringCandidates = detectRecurringCandidates(recentExpenses, existingFixedNames)

  return (
    <div>
      <h1 className="page-title">Gastos diarios</h1>

      <div className="grid-auto">
        {pending === null ? (
          <Card title="Pendientes de banco" className="span-3"><p style={{ color: 'var(--text-muted)' }}>Cargando…</p></Card>
        ) : pending.length > 0 && (
          <Card title={`Pendientes de banco (${pending.length})`} className="span-3">
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
              Sin tag de banco reconocido ni categoría inequívoca con histórico — confirma manualmente a qué cuenta corresponde cada uno.
            </p>
            <div className="table-scroll">
            <table className="simple-table">
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th>Monto</th><th>Categoría</th><th>Cuenta</th><th></th></tr>
              </thead>
              <tbody>
                {pending.map((t) => {
                  const suggested = suggestions[t.category_id] ?? []
                  const selected = selectedAccountByTx[t.id] ?? suggested[0]?.accountId ?? ''
                  // Un ingreso puede confirmarse contra la madre (le puede llegar plata
                  // directo a ella); un gasto se queda restringido a hijas — el dinero
                  // nunca sale de la madre directamente en este modelo.
                  const pickableAccounts = Number(t.amount) > 0 ? accounts : hijas
                  return (
                    <tr key={t.id}>
                      <td>{formatDate(t.occurred_at)}</td>
                      <td>{t.purpose}</td>
                      <td className="amount-cell">{formatByCurrency(t.amount, t.currency)}</td>
                      <td>{t.categories?.name ?? '—'}</td>
                      <td>
                        <select
                          value={selected}
                          onChange={(e) => setSelectedAccountByTx({ ...selectedAccountByTx, [t.id]: e.target.value })}
                          style={cellInput}
                        >
                          <option value="">Elegir cuenta…</option>
                          {suggested.map((s) => (
                            <option key={s.accountId} value={s.accountId}>
                              {pickableAccounts.find((a) => a.id === s.accountId)?.name ?? '?'} ({s.count}×)
                            </option>
                          ))}
                          {pickableAccounts.filter((a) => !suggested.some((s) => s.accountId === a.id)).map((a) => (
                            <option key={a.id} value={a.id}>{a.kind === 'madre' ? `${a.name} (madre)` : a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => handleConfirm(t)}
                          disabled={!selected || confirmingId === t.id}
                          style={{ color: 'var(--series-1)', fontWeight: 600, marginRight: 8 }}
                        >
                          Confirmar
                        </button>
                        <button onClick={() => handleDeleteTx(t)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </Card>
        )}

        {pendingCurrency !== null && pendingCurrency.length > 0 && (
          <Card title={`Compras en divisa por confirmar (${pendingCurrency.length})`} className="span-3">
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
              MonIA convierte a COP al guardar, así que el CSV no trae el monto original. Estos movimientos ya quedaron
              asignados a su cuenta con un monto <strong>estimado</strong> con la tasa guardada en Cuentas — escribe el
              monto real de la compra y confirma. Apenas lo escribas verás la tasa implícita que usó MonIA ese día,
              para contrastarla con la tuya.
            </p>
            <div className="table-scroll">
            <table className="simple-table">
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th>Cuenta</th><th>Monto en MonIA</th><th>Monto real</th><th>Tasa implícita</th><th></th></tr>
              </thead>
              <tbody>
                {pendingCurrency.map((t) => {
                  const currency = t.accounts?.currency || t.currency
                  // Mientras el usuario no haya tocado el campo, `draft` ES el
                  // estimado que ya se calculó dividiendo por la tasa guardada
                  // — mostrar "monto MonIA ÷ draft" ahí solo repetiría esa
                  // misma tasa disfrazada de "lo que usó MonIA". La tasa
                  // implícita real solo existe una vez que el usuario escribió
                  // el monto verdadero de la compra.
                  const touched = Object.prototype.hasOwnProperty.call(amountByTx, t.id)
                  const draft = amountByTx[t.id] ?? String(Math.abs(t.amount))
                  const value = Math.abs(Number(draft))
                  const sourceAmount = Math.abs(Number(t.source_amount))
                  const impliedRate = touched && Number.isFinite(value) && value > 0 ? sourceAmount / value : null
                  return (
                    <tr key={t.id}>
                      <td>{formatDate(t.occurred_at)}</td>
                      <td>{t.purpose}</td>
                      <td>{t.accounts?.name ?? '—'}</td>
                      <td className="amount-cell">{formatByCurrency(Number(t.source_amount), t.source_currency)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft}
                          onChange={(e) => setAmountByTx({ ...amountByTx, [t.id]: e.target.value })}
                          style={{ ...cellInput, width: 100, display: 'inline-block' }}
                        />
                        <span style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginLeft: 6 }}>{currency}</span>
                      </td>
                      <td style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {impliedRate
                          ? `${Math.round(impliedRate).toLocaleString('es-CO')} ${t.source_currency}/${currency}`
                          : (touched ? '—' : 'escribe el monto real →')}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => handleConfirmCurrency(t)}
                          disabled={!(value > 0) || confirmingId === t.id}
                          style={{ color: 'var(--series-1)', fontWeight: 600, marginRight: 8 }}
                        >
                          Confirmar
                        </button>
                        <button onClick={() => handleDeleteTx(t)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
            {pendingCurrency.some((t) => Number(t.amount) === 0) && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--status-warning)', marginTop: 'var(--space-1)' }}>
                Alguna fila quedó en 0: no hay tasa configurada para ese par de monedas. Puedes escribir el monto igual, o
                definir la tasa en Cuentas para que las próximas importaciones lleguen estimadas.
              </p>
            )}
          </Card>
        )}

        <Card title="Gasto por categoría">
          {categoryChartData.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Sin gastos categorizados este mes.</p>
          ) : (
            <ResponsiveContainer width="100%" height={twoColChartHeight}>
              <BarChart data={categoryChartData} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid horizontal={false} stroke="var(--gridline)" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--gridline)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {categoryChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Gasto por tag (top 10)">
          {tagChartData.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Sin tags registrados este mes.</p>
          ) : (
            <ResponsiveContainer width="100%" height={twoColChartHeight}>
              <BarChart data={tagChartData} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid horizontal={false} stroke="var(--gridline)" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={90} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => formatCOP(v)} contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--gridline)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {tagChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Gasto real vs. presupuesto por cuenta" className="span-3">
          <div className="table-scroll">
          <table className="simple-table">
            <thead><tr><th>Cuenta</th><th>Gastado este mes</th><th>Movido a otras cuentas</th><th>Asignado este mes</th><th>Ingresos este mes</th><th>% usado</th></tr></thead>
            <tbody>
              {flattenAccountPockets(hijas).map((p) => {
                const currency = p.currency
                const spent = spentByAccount[p.key] ?? 0
                const pendingCount = pendingByAccount[p.key] ?? 0
                const movido = transferredOut[p.key] ?? 0
                const allocated = allocations[p.key]
                const income = incomeByAccount[p.key] ?? 0
                const disponible = (allocated ?? 0) + income
                const pct = disponible > 0 ? Math.round(((spent + movido) / disponible) * 100) : null
                return (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td className="amount-cell">
                      {pendingCount > 0 && (
                        <span
                          title={`Incluye ${pendingCount} monto(s) estimado(s) — confírmalos en "Compras en divisa por confirmar"`}
                          style={{ color: 'var(--status-warning)', marginRight: 4 }}
                        >
                          ≈
                        </span>
                      )}
                      {formatByCurrency(spent, currency)}
                    </td>
                    <td className="amount-cell">{movido > 0 ? formatByCurrency(movido, currency) : '—'}</td>
                    <td className="amount-cell">{allocated != null ? formatByCurrency(allocated, currency) : 'sin definir'}</td>
                    <td className="amount-cell">{income > 0 ? formatByCurrency(income, currency) : '—'}</td>
                    <td style={{ color: pct != null && pct > 100 ? 'var(--status-critical)' : 'inherit' }}>{pct != null ? `${pct}%` : '—'}</td>
                  </tr>
                )
              })}
              {hijas.length === 0 && (
                <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>No hay cuentas hijas todavía.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>

        {recurringCandidates.length > 0 && (
          <Card title={`Candidatos a gasto fijo (${recurringCandidates.length})`} className="span-3">
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
              Mismo nombre de movimiento repetido en al menos 3 de los últimos {PATTERN_MONTHS_BACK} meses — puedes agregarlo como gasto fijo recurrente o ignorarlo.
            </p>
            <div className="table-scroll">
            <table className="simple-table">
              <thead><tr><th>Descripción</th><th>Monto promedio</th><th>Meses vistos</th><th></th></tr></thead>
              <tbody>
                {recurringCandidates.map((c) => (
                  <tr key={c.purpose}>
                    <td>{c.purpose}</td>
                    <td>{formatCOP(c.avgAmount)}</td>
                    <td>{c.monthsSeen}</td>
                    <td>
                      <button
                        onClick={() => handleAddCandidate(c)}
                        disabled={addingCandidate === c.purpose}
                        style={{ font: 'var(--font-caption)', color: 'var(--series-1)', fontWeight: 600 }}
                      >
                        Agregar como gasto fijo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        )}

        <Card title={`Movimientos — ${MONTH_NAMES[month - 1]} ${year}`} className="span-3">
          {monthTransactions === null ? (
            <p style={{ color: 'var(--text-muted)' }}>Cargando…</p>
          ) : (
            <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 'var(--space-1)' }}>
              <select value={txFilters.categoryId} onChange={(e) => setTxFilters({ ...txFilters, categoryId: e.target.value })} style={formInput}>
                <option value="">Todas las categorías</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={txFilters.accountId} onChange={(e) => setTxFilters({ ...txFilters, accountId: e.target.value })} style={formInput}>
                <option value="">Todas las cuentas</option>
                <option value="pending">Pendiente de banco</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.kind === 'madre' ? `${a.name} (madre)` : a.name}</option>)}
              </select>
              <input
                placeholder="Tag (ej. rappi)" value={txFilters.tag}
                onChange={(e) => setTxFilters({ ...txFilters, tag: e.target.value })}
                style={{ ...formInput, width: 140 }}
              />
              {hasTxFilters && (
                <button type="button" onClick={() => setTxFilters({ categoryId: '', accountId: '', tag: '' })} style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>
                  Limpiar filtros
                </button>
              )}
            </div>
            <div className="table-scroll">
            <table className="simple-table">
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th>Monto</th><th>Categoría</th><th>Cuenta</th><th>Tags</th><th></th></tr>
              </thead>
              <tbody>
                {filteredMonthTransactions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.occurred_at)}</td>
                    <td>{t.purpose}</td>
                    <td className="amount-cell">
                      {t.currency_pending && (
                        <span
                          title="Monto estimado con la tasa guardada — todavía no confirmado en Compras en divisa por confirmar"
                          style={{ color: 'var(--status-warning)', marginRight: 4 }}
                        >
                          ≈
                        </span>
                      )}
                      {formatByCurrency(t.amount, t.currency)}
                    </td>
                    <td>{t.categories?.name ?? '—'}</td>
                    <td>{t.accounts?.name ?? (t.assignment_confirmed ? '— ignorado (sin cuenta) —' : '— pendiente —')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          style={{ ...cellInput, width: 130 }}
                          placeholder="tag1, tag2…"
                          value={tagsDraftByTx[t.id] ?? (t.tags ?? []).join(', ')}
                          onChange={(e) => setTagsDraftByTx({ ...tagsDraftByTx, [t.id]: e.target.value })}
                        />
                        <button
                          onClick={() => handleSaveTags(t.id)} disabled={savingTagsId === t.id}
                          style={{ font: 'var(--font-caption)', whiteSpace: 'nowrap' }}
                        >
                          {savingTagsId === t.id ? '…' : 'Guardar'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <button onClick={() => handleDeleteTx(t)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {filteredMonthTransactions.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                      {hasTxFilters ? 'Ningún movimiento coincide con esos filtros.' : 'No hay movimientos importados para este mes todavía.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            </>
          )}
        </Card>

        <Card title="Importar CSV de MonIA" className="span-3">
          <p style={{ font: 'var(--font-subheadline)', color: 'var(--text-secondary)', margin: '0 0 var(--space-2)' }}>
            Sube el CSV exportado de MonIA y elige el mes/año a importar. Los movimientos ya guardados
            (por su `id` de MonIA) se detectan y se omiten automáticamente.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <MonthYearPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
            <label style={{
              minHeight: 'var(--touch-target)', display: 'inline-flex', alignItems: 'center', padding: '0 var(--space-2)',
              borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, cursor: 'pointer',
            }}>
              Elegir archivo CSV
              <input type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
            </label>
            {csvFileName && <span style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>{csvFileName}</span>}
          </div>

          {csvRows && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <p style={{ font: 'var(--font-subheadline)', margin: 0 }}>
                {matchingCount} movimiento(s) encontrados para {MONTH_NAMES[month - 1]} {year} en el archivo.
              </p>
              <button
                onClick={handleImport} disabled={importing || matchingCount === 0}
                style={{
                  minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10,
                  background: 'var(--series-3)', color: '#fff', fontWeight: 600, opacity: importing ? 0.6 : 1,
                }}
              >
                {importing ? 'Importando…' : 'Importar'}
              </button>
            </div>
          )}

          {importResult && (
            <p style={{ font: 'var(--font-subheadline)', color: 'var(--status-good)', marginTop: 'var(--space-1)' }}>
              {importResult.imported} movimiento(s) nuevo(s) importado(s), {importResult.skipped} ya existían y se omitieron.
            </p>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteTx}
        title={`¿Eliminar el movimiento "${confirmDeleteTx?.purpose}"?`}
        message="No se puede deshacer. Si vuelves a importar el mismo CSV, se detecta como nuevo y se vuelve a agregar."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doDeleteTx}
        onCancel={() => setConfirmDeleteTx(null)}
      />
    </div>
  )
}

const cellInput = { width: '100%', minHeight: 32, borderRadius: 6, border: '1px solid var(--border-hairline)', padding: '0 6px' }
const formInput = { minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }
