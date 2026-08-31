import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import { formatCOP } from '../lib/format.js'
import { listAccounts } from '../lib/accountsApi.js'
import { listCategories, updateCategoryBudget } from '../lib/categoriesApi.js'
import { getAllocationsForMonth } from '../lib/allocationsApi.js'
import { listFixedExpenses, createFixedExpense } from '../lib/fixedExpensesApi.js'
import {
  parseMonIACSV, filterRowsByMonth, importTransactions,
  listPendingTransactions, fetchSuggestionsForCategories, confirmAssignment,
  listTransactionsForMonth, listRecentExpenses, detectRecurringCandidates,
  searchTransactions, deleteTransaction, createManualTransaction,
} from '../lib/transactionsApi.js'

const now = new Date()

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const PATTERN_MONTHS_BACK = 6
const CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)']
const emptyManualForm = { date: new Date().toISOString().slice(0, 10), purpose: '', amount: '', categoryId: '', accountId: '', tag: '' }

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

export default function GastosDiarios() {
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [pending, setPending] = useState(null)
  const [suggestions, setSuggestions] = useState({})
  const [monthTransactions, setMonthTransactions] = useState(null)
  const [error, setError] = useState(null)

  const [csvRows, setCsvRows] = useState(null)
  const [csvFileName, setCsvFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [selectedAccountByTx, setSelectedAccountByTx] = useState({})
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [budgetDraft, setBudgetDraft] = useState('')
  const [allocations, setAllocations] = useState({})
  const [fixedExpenses, setFixedExpenses] = useState([])
  const [recentExpenses, setRecentExpenses] = useState([])
  const [addingCandidate, setAddingCandidate] = useState(null)

  const [searchFilters, setSearchFilters] = useState({ query: '', categoryId: '', accountId: '', tag: '', dateFrom: '', dateTo: '' })
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [confirmDeleteTx, setConfirmDeleteTx] = useState(null) // { id, purpose } | null

  const [manualForm, setManualForm] = useState(emptyManualForm)
  const [savingManual, setSavingManual] = useState(false)

  async function reload() {
    try {
      const [accs, cats, pendingRows, monthRows, fixedRows, recent] = await Promise.all([
        listAccounts(),
        listCategories(),
        listPendingTransactions(),
        listTransactionsForMonth(year, month),
        listFixedExpenses(),
        listRecentExpenses(PATTERN_MONTHS_BACK),
      ])
      setAccounts(accs)
      setCategories(cats)
      setPending(pendingRows)
      setMonthTransactions(monthRows)
      setFixedExpenses(fixedRows)
      setRecentExpenses(recent)
      setSuggestions(await fetchSuggestionsForCategories(pendingRows.map((t) => t.category_id)))
      setAllocations(await getAllocationsForMonth(accs.filter((a) => a.kind === 'hija').map((a) => a.id), year, month))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { reload() }, [year, month])

  const hijas = accounts.filter((a) => a.kind === 'hija')

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

  async function handleAddManual(e) {
    e.preventDefault()
    if (!manualForm.purpose.trim() || !manualForm.amount) return
    setSavingManual(true)
    try {
      await createManualTransaction({
        purpose: manualForm.purpose.trim(),
        amount: -Math.abs(Number(manualForm.amount)),
        occurredAt: `${manualForm.date}T12:00:00Z`,
        categoryId: manualForm.categoryId || null,
        accountId: manualForm.accountId || null,
        tags: manualForm.tag.trim() ? [manualForm.tag.trim().toLowerCase()] : [],
      })
      setManualForm({ ...emptyManualForm, date: manualForm.date })
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingManual(false)
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

  async function handleSaveBudget() {
    if (!budgetCategoryId) return
    try {
      await updateCategoryBudget(budgetCategoryId, budgetDraft === '' ? null : Number(budgetDraft))
      await reload()
    } catch (err) {
      setError(err.message)
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

  async function handleSearch(e) {
    e.preventDefault()
    setSearching(true)
    try {
      setSearchResults(await searchTransactions({
        query: searchFilters.query,
        categoryId: searchFilters.categoryId || null,
        accountId: searchFilters.accountId || null,
        tag: searchFilters.tag,
        dateFrom: searchFilters.dateFrom || null,
        dateTo: searchFilters.dateTo || null,
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  function handleClearSearch() {
    setSearchFilters({ query: '', categoryId: '', accountId: '', tag: '', dateFrom: '', dateTo: '' })
    setSearchResults(null)
  }

  function handleDeleteTx(tx) {
    setConfirmDeleteTx({ id: tx.id, purpose: tx.purpose })
  }

  async function doDeleteTx() {
    const target = confirmDeleteTx
    setConfirmDeleteTx(null)
    try {
      await deleteTransaction(target.id)
      setSearchResults((prev) => prev?.filter((t) => t.id !== target.id) ?? prev)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  if (error) {
    return <p style={{ color: 'var(--status-critical)' }}>Error cargando gastos diarios: {error}</p>
  }

  const spentByCategory = {}
  const spentByTag = {}
  const spentByAccount = {}
  for (const t of monthTransactions ?? []) {
    if (Number(t.amount) >= 0) continue
    const amount = -Number(t.amount)
    spentByCategory[t.category_id] = (spentByCategory[t.category_id] ?? 0) + amount
    if (t.account_id) spentByAccount[t.account_id] = (spentByAccount[t.account_id] ?? 0) + amount
    for (const tag of t.tags ?? []) spentByTag[tag] = (spentByTag[tag] ?? 0) + amount
  }

  const categoryChartData = categories
    .map((c) => ({ name: c.name, value: spentByCategory[c.id] ?? 0 }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)

  const tagChartData = Object.entries(spentByTag)
    .map(([tag, value]) => ({ name: tag, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const existingFixedNames = new Set(fixedExpenses.map((f) => f.name.trim().toLowerCase()))
  const recurringCandidates = detectRecurringCandidates(recentExpenses, existingFixedNames)

  return (
    <div>
      <h1 className="page-title">Gastos diarios</h1>

      <div className="grid-auto">
        <Card title="Importar CSV de MonIA" className="span-3">
          <p style={{ font: 'var(--font-subheadline)', color: 'var(--text-secondary)', margin: '0 0 var(--space-2)' }}>
            Sube el CSV exportado de MonIA y elige el mes/año a importar. Los movimientos ya guardados
            (por su `id` de MonIA) se detectan y se omiten automáticamente.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={formInput}>
              {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
            </select>
            <input
              type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
              style={{ ...formInput, width: 90 }}
            />
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
                  return (
                    <tr key={t.id}>
                      <td>{formatDate(t.occurred_at)}</td>
                      <td>{t.purpose}</td>
                      <td>{formatCOP(t.amount)}</td>
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
                              {hijas.find((h) => h.id === s.accountId)?.name ?? '?'} ({s.count}×)
                            </option>
                          ))}
                          {hijas.filter((h) => !suggested.some((s) => s.accountId === h.id)).map((h) => (
                            <option key={h.id} value={h.id}>{h.name}</option>
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

        <Card title="Presupuesto por categoría" className="span-3">
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
            Tope mensual editable por categoría (mismo monto todos los meses hasta que lo cambies). Vacío = sin presupuesto definido, no genera alerta.
            Gasto del mes mostrado es el de {MONTH_NAMES[month - 1]} {year}.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <select
              value={budgetCategoryId}
              onChange={(e) => {
                const id = e.target.value
                setBudgetCategoryId(id)
                const cat = categories.find((c) => c.id === id)
                setBudgetDraft(cat?.monthly_budget != null ? String(cat.monthly_budget) : '')
              }}
              style={{ ...formInput, flex: '1 1 200px', minWidth: 0 }}
            >
              <option value="">Selecciona una categoría…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {budgetCategoryId && (() => {
              const spent = spentByCategory[budgetCategoryId] ?? 0
              const currentCat = categories.find((c) => c.id === budgetCategoryId)
              const budget = currentCat?.monthly_budget != null ? Number(currentCat.monthly_budget) : null
              const over = budget != null && spent > budget
              return (
                <>
                  <span style={{ font: 'var(--font-subheadline)', color: over ? 'var(--status-critical)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    Gastado este mes: {formatCOP(spent)}
                  </span>
                  <input
                    type="number" placeholder="Sin definir" value={budgetDraft}
                    onChange={(e) => setBudgetDraft(e.target.value)}
                    style={{ ...formInput, width: 130 }}
                  />
                  <button
                    onClick={handleSaveBudget}
                    style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600 }}
                  >
                    Guardar
                  </button>
                </>
              )
            })()}

            {categories.length === 0 && (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>No hay categorías en el catálogo todavía.</p>
            )}
          </div>
        </Card>

        <Card title="Gasto por categoría">
          {categoryChartData.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Sin gastos categorizados este mes.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, categoryChartData.length * 28)}>
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
            <ResponsiveContainer width="100%" height={Math.max(120, tagChartData.length * 28)}>
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
            <thead><tr><th>Cuenta</th><th>Gastado este mes</th><th>Asignado este mes</th><th>% usado</th></tr></thead>
            <tbody>
              {hijas.map((h) => {
                const spent = spentByAccount[h.id] ?? 0
                const allocated = allocations[h.id]
                const pct = allocated ? Math.round((spent / allocated) * 100) : null
                return (
                  <tr key={h.id}>
                    <td>{h.name}</td>
                    <td>{formatCOP(spent)}</td>
                    <td>{allocated != null ? formatCOP(allocated) : 'sin definir'}</td>
                    <td style={{ color: pct != null && pct > 100 ? 'var(--status-critical)' : 'inherit' }}>{pct != null ? `${pct}%` : '—'}</td>
                  </tr>
                )
              })}
              {hijas.length === 0 && (
                <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>No hay cuentas hijas todavía.</td></tr>
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

        <Card title="Buscar movimientos" className="span-3">
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
            Busca en todo el histórico, no solo en el mes activo arriba — ej. "todos los Rappi de este año".
          </p>
          <form onSubmit={handleSearch} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-2)' }}>
            <input
              placeholder="Descripción contiene…" value={searchFilters.query}
              onChange={(e) => setSearchFilters({ ...searchFilters, query: e.target.value })}
              style={{ ...formInput, flex: '2 1 180px', minWidth: 0 }}
            />
            <select
              value={searchFilters.categoryId}
              onChange={(e) => setSearchFilters({ ...searchFilters, categoryId: e.target.value })}
              style={{ ...formInput, flex: '1 1 150px', minWidth: 0 }}
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={searchFilters.accountId}
              onChange={(e) => setSearchFilters({ ...searchFilters, accountId: e.target.value })}
              style={{ ...formInput, flex: '1 1 150px', minWidth: 0 }}
            >
              <option value="">Todas las cuentas</option>
              <option value="pending">Pendiente de banco</option>
              {hijas.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <input
              placeholder="Tag (ej. rappi)" value={searchFilters.tag}
              onChange={(e) => setSearchFilters({ ...searchFilters, tag: e.target.value })}
              style={{ ...formInput, flex: '1 1 120px', minWidth: 0 }}
            />
            <input
              type="date" value={searchFilters.dateFrom}
              onChange={(e) => setSearchFilters({ ...searchFilters, dateFrom: e.target.value })}
              style={{ ...formInput, flex: '1 1 140px', minWidth: 0 }}
            />
            <input
              type="date" value={searchFilters.dateTo}
              onChange={(e) => setSearchFilters({ ...searchFilters, dateTo: e.target.value })}
              style={{ ...formInput, flex: '1 1 140px', minWidth: 0 }}
            />
            <button
              type="submit" disabled={searching}
              style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: searching ? 0.6 : 1 }}
            >
              {searching ? 'Buscando…' : 'Buscar'}
            </button>
            {searchResults !== null && (
              <button type="button" onClick={handleClearSearch} style={{ font: 'var(--font-caption)', color: 'var(--text-muted)' }}>
                Limpiar
              </button>
            )}
          </form>

          {searchResults !== null && (
            <>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
                {searchResults.length} resultado(s){searchResults.length === 200 ? ' — mostrando los 200 más recientes, refina la búsqueda para ver más' : ''}.
              </p>
              <div className="table-scroll">
                <table className="simple-table">
                  <thead>
                    <tr><th>Fecha</th><th>Descripción</th><th>Monto</th><th>Categoría</th><th>Cuenta</th><th>Tags</th><th></th></tr>
                  </thead>
                  <tbody>
                    {searchResults.map((t) => (
                      <tr key={t.id}>
                        <td>{formatDate(t.occurred_at)}</td>
                        <td>{t.purpose}</td>
                        <td>{formatCOP(t.amount)}</td>
                        <td>{t.categories?.name ?? '—'}</td>
                        <td>{t.accounts?.name ?? '— pendiente —'}</td>
                        <td>{(t.tags ?? []).join(', ') || '—'}</td>
                        <td>
                          <button onClick={() => handleDeleteTx(t)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                    {searchResults.length === 0 && (
                      <tr><td colSpan={7} style={{ color: 'var(--text-muted)' }}>Sin resultados para esos filtros.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <Card title={`Movimientos — ${MONTH_NAMES[month - 1]} ${year}`} className="span-3">
          {monthTransactions === null ? (
            <p style={{ color: 'var(--text-muted)' }}>Cargando…</p>
          ) : (
            <div className="table-scroll">
            <table className="simple-table">
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th>Monto</th><th>Categoría</th><th>Cuenta</th><th></th></tr>
              </thead>
              <tbody>
                {monthTransactions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.occurred_at)}</td>
                    <td>{t.purpose}</td>
                    <td>{formatCOP(t.amount)}</td>
                    <td>{t.categories?.name ?? '—'}</td>
                    <td>{t.accounts?.name ?? '— pendiente —'}</td>
                    <td>
                      <button onClick={() => handleDeleteTx(t)} style={{ font: 'var(--font-caption)', color: 'var(--status-critical)' }}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {monthTransactions.length === 0 && (
                  <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>No hay movimientos importados para este mes todavía.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          )}
        </Card>

        <Card title="Agregar gasto manual" className="span-3">
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>
            Para pruebas o gastos que no vienen del CSV de MonIA — se guarda igual que uno importado, con origen "manual".
          </p>
          <form onSubmit={handleAddManual} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input
              type="date" value={manualForm.date}
              onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
              style={formInput}
            />
            <input
              placeholder="Descripción" value={manualForm.purpose}
              onChange={(e) => setManualForm({ ...manualForm, purpose: e.target.value })}
              style={{ ...formInput, flex: '1 1 160px', minWidth: 0 }}
            />
            <input
              type="number" placeholder="Monto" value={manualForm.amount}
              onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
              style={{ ...formInput, width: 120 }}
            />
            <select
              value={manualForm.categoryId}
              onChange={(e) => setManualForm({ ...manualForm, categoryId: e.target.value })}
              style={{ ...formInput, flex: '1 1 150px', minWidth: 0 }}
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={manualForm.accountId}
              onChange={(e) => setManualForm({ ...manualForm, accountId: e.target.value })}
              style={{ ...formInput, flex: '1 1 150px', minWidth: 0 }}
            >
              <option value="">Pendiente de banco</option>
              {hijas.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <input
              placeholder="Tag (opcional)" value={manualForm.tag}
              onChange={(e) => setManualForm({ ...manualForm, tag: e.target.value })}
              style={{ ...formInput, width: 130 }}
            />
            <button
              type="submit" disabled={savingManual}
              style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: savingManual ? 0.6 : 1 }}
            >
              {savingManual ? 'Guardando…' : 'Agregar gasto'}
            </button>
          </form>
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
