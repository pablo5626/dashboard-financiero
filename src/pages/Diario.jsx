import { useCallback, useEffect, useState } from 'react'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import CategoryEmojiGrid, { seriesForName } from '../components/CategoryEmojiGrid.jsx'
import AccountAutocomplete from '../components/AccountAutocomplete.jsx'
import { formatByCurrency, formatCompact } from '../lib/format.js'
import { listAccounts } from '../lib/accountsApi.js'
import { listCategories } from '../lib/categoriesApi.js'
import { getRates, toCOP, convertAmount } from '../lib/exchangeRatesApi.js'
import {
  listTransactionsForDay, listTransactionsForDateRange, listTransactionsForMonth,
  deleteTransaction, updateTransaction, isIgnoredRow,
} from '../lib/transactionsApi.js'
import styles from './Diario.module.css'

const CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)']
const WEEK_DAYS = 7
const PERIODS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
]

// Fecha calendario en UTC (no Bogotá local) — mismo criterio que
// QuickCaptureFAB.jsx, así "movimientos de hoy" siempre coincide con el
// día que QuickCaptureFAB usó al guardar.
const today = () => new Date().toISOString().slice(0, 10)

function hasCOPRate(currency, rates) {
  if (!currency || currency === 'COP') return true
  return convertAmount(1, currency, 'COP', rates) != null
}

// Agrupa por día calendario (más reciente primero) para el header tipo
// "lun, 11 sept" entre grupos — con período "hoy" siempre da un solo grupo,
// que el render trata como "sin header" en vez de un caso aparte.
function groupTransactionsByDate(rows) {
  const groups = new Map()
  for (const t of rows) {
    const day = t.occurred_at.slice(0, 10)
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day).push(t)
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

function formatDateHeader(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export default function Diario() {
  const [period, setPeriod] = useState('hoy')
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [rates, setRates] = useState([])
  const [periodTransactions, setPeriodTransactions] = useState(null)
  const [error, setError] = useState(null)

  const [selectedCategoryId, setSelectedCategoryId] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null) // transacción | null

  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState(null) // { purpose, amount, categoryId, accountId, tags }
  const [savingEdit, setSavingEdit] = useState(false)
  const [newTagDraft, setNewTagDraft] = useState('')
  // Colapsada por default: mostrar la categoría elegida en una fila
  // compacta y solo desplegar la grilla completa al tocar "Cambiar" — antes
  // la grilla entera quedaba siempre abierta ocupando toda la tarjeta de
  // edición, aunque lo único que se quisiera tocar fuera el monto o un tag.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)

  const loadAll = useCallback(() => {
    let fetchTransactions
    if (period === 'semana') {
      const end = new Date(`${today()}T00:00:00Z`)
      end.setUTCDate(end.getUTCDate() + 1)
      const start = new Date(`${today()}T00:00:00Z`)
      start.setUTCDate(start.getUTCDate() - (WEEK_DAYS - 1))
      fetchTransactions = listTransactionsForDateRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
    } else if (period === 'mes') {
      const now = new Date()
      fetchTransactions = listTransactionsForMonth(now.getFullYear(), now.getMonth() + 1)
    } else {
      fetchTransactions = listTransactionsForDay(today())
    }

    return Promise.all([
      listAccounts(),
      listCategories(),
      getRates(),
      fetchTransactions,
    ]).then(([accountsList, categoriesList, ratesList, txList]) => {
      setAccounts(accountsList)
      setCategories(categoriesList)
      setRates(ratesList)
      setPeriodTransactions(txList)
    }).catch((err) => setError(err.message))
  }, [period])

  useEffect(() => {
    loadAll()
    // QuickCaptureFAB vive fuera del árbol de esta página (son hermanos bajo
    // AppShell, no padre/hijo), así que no hay forma de pasarle un reload()
    // de acá por props — escucha este evento global (emitido por
    // AppShell.refreshPendingCount tras cada guardado del FAB) para no
    // quedar desactualizada hasta que alguien recargue la página a mano.
    window.addEventListener('dashboard:transactions-changed', loadAll)
    return () => window.removeEventListener('dashboard:transactions-changed', loadAll)
  }, [loadAll])

  function changePeriod(next) {
    setPeriod(next)
    setSelectedCategoryId(null)
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditDraft({
      purpose: t.purpose || '',
      amount: String(Math.abs(Number(t.amount))),
      categoryId: t.category_id || '',
      accountId: t.account_id || '',
      tags: t.tags ?? [],
    })
    setNewTagDraft('')
    setCategoryPickerOpen(false)
  }

  function cancelEdit() {
    setEditingId('')
    setEditDraft(null)
    setNewTagDraft('')
  }

  // Mismo editor de tags-como-píldoras que GastosDiarios.jsx (editDraft.tags
  // como array) — reemplaza el único input de texto que tenía esta página
  // antes, que silenciosamente perdía cualquier tag adicional que un
  // movimiento ya trajera (común en filas importadas del CSV, ej.
  // "#efectivo #cerveza").
  function handleDraftAddTag() {
    const tag = newTagDraft.trim()
    setNewTagDraft('')
    if (!tag) return
    setEditDraft((prev) => ({ ...prev, tags: [...new Set([...prev.tags, tag])] }))
  }

  function handleDraftRemoveTag(tag) {
    setEditDraft((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== tag) }))
  }

  function addAmountPreset(delta) {
    setEditDraft((prev) => ({ ...prev, amount: String((Number(prev.amount) || 0) + delta) }))
  }

  async function handleSaveEdit(original) {
    if (!editDraft.amount) return
    setSavingEdit(true)
    try {
      const wasGasto = Number(original.amount) < 0
      const signedAmount = wasGasto ? -Math.abs(Number(editDraft.amount)) : Math.abs(Number(editDraft.amount))
      const newCurrency = accounts.find((a) => a.id === editDraft.accountId)?.currency || original.currency
      const updated = await updateTransaction(original.id, {
        purpose: editDraft.purpose.trim() || original.purpose,
        amount: signedAmount,
        categoryId: editDraft.categoryId || null,
        accountId: editDraft.accountId || null,
        currency: newCurrency,
        tags: editDraft.tags,
      })
      setPeriodTransactions((prev) => prev.map((t) => (t.id === original.id ? updated : t)))
      cancelEdit()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingEdit(false)
    }
  }

  async function doDelete() {
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await deleteTransaction(target.id)
      setPeriodTransactions((prev) => prev.filter((t) => t.id !== target.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const visiblePeriod = (periodTransactions ?? []).filter((t) => !isIgnoredRow(t.tags))
  let gastoPeriodo = 0
  let ingresoPeriodo = 0
  for (const t of visiblePeriod) {
    const converted = toCOP(Number(t.amount), t.currency, rates)
    if (Number(t.amount) < 0) gastoPeriodo += -converted
    else ingresoPeriodo += converted
  }
  const missingRateCount = visiblePeriod.filter((t) => !hasCOPRate(t.currency, rates)).length
  const netPeriodo = ingresoPeriodo - gastoPeriodo

  const categorySpendPeriod = {}
  for (const t of visiblePeriod) {
    if (Number(t.amount) >= 0 || !t.category_id) continue
    categorySpendPeriod[t.category_id] = (categorySpendPeriod[t.category_id] ?? 0) + toCOP(-Number(t.amount), t.currency, rates)
  }
  const categoryChartData = categories
    .map((c) => ({
      id: c.id, name: c.name, value: categorySpendPeriod[c.id] ?? 0, color: c.color, emoji: c.emoji,
      budget: c.monthly_budget != null ? Number(c.monthly_budget) : null,
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)

  // "Presupuesto restante" del período elegido: solo suma categorías que
  // tienen monthly_budget configurado, contra lo gastado en esas mismas
  // categorías en ese mismo período — las que no tienen presupuesto quedan
  // fuera de la cuenta (no se tratan como si su presupuesto fuera $0).
  const budgetedCategories = categories.filter((c) => c.monthly_budget != null)
  const totalBudget = budgetedCategories.reduce((sum, c) => sum + Number(c.monthly_budget), 0)
  const spentInBudgetedCategories = budgetedCategories.reduce((sum, c) => sum + (categorySpendPeriod[c.id] ?? 0), 0)
  const presupuestoRestante = totalBudget - spentInBudgetedCategories
  const hasAnyBudget = budgetedCategories.length > 0

  const selectedCategory = categoryChartData.find((c) => c.id === selectedCategoryId)

  const dateGroups = groupTransactionsByDate(periodTransactions ?? [])

  function accountName(id) {
    return accounts.find((a) => a.id === id)?.name ?? '—'
  }

  function budgetPct(c) {
    return c.budget ? (c.value / c.budget) * 100 : null
  }

  function budgetToneColor(pct) {
    if (pct == null) return 'var(--border-hairline)'
    if (pct < 70) return 'var(--status-good)'
    if (pct < 100) return 'var(--status-warning)'
    if (pct < 120) return 'var(--status-serious)'
    return 'var(--status-critical)'
  }

  function renderTxRow(t) {
    const cat = categories.find((c) => c.id === t.category_id)
    const ignored = isIgnoredRow(t.tags)
    const isGasto = Number(t.amount) < 0

    if (editingId === t.id) {
      const draftCategory = categories.find((c) => c.id === editDraft.categoryId)
      return (
        <div key={t.id} className={styles.txEditRow}>
          <div className={styles.txEditHeader}>
            <span
              className={styles.txEditGlyph}
              style={{ background: cat ? (cat.color || seriesForName(cat.name)) : 'var(--text-muted)' }}
            >
              {cat?.emoji || cat?.name?.charAt(0).toUpperCase() || '?'}
            </span>
            <span className={styles.txEditLabel}>Editando movimiento</span>
            <span className={isGasto ? `${styles.txEditTypeBadge} ${styles.txEditTypeBadgeGasto}` : `${styles.txEditTypeBadge} ${styles.txEditTypeBadgeIngreso}`}>
              {isGasto ? 'Gasto' : 'Ingreso'}
            </span>
          </div>

          <div className={styles.txEditField}>
            <div className={styles.txEditFieldLabelRow}>
              <span className={styles.txEditFieldLabel}>Categoría</span>
              <button type="button" onClick={() => setCategoryPickerOpen((v) => !v)} className={styles.txEditFieldAction}>
                {categoryPickerOpen ? 'Listo' : 'Cambiar'}
              </button>
            </div>
            {categoryPickerOpen ? (
              <CategoryEmojiGrid
                categories={categories}
                selectedId={editDraft.categoryId}
                onSelect={(id) => {
                  setEditDraft((prev) => ({ ...prev, categoryId: prev.categoryId === id ? '' : id }))
                  setCategoryPickerOpen(false)
                }}
              />
            ) : (
              <button type="button" onClick={() => setCategoryPickerOpen(true)} className={styles.txEditCurrentValue}>
                <span
                  className={styles.txEditGlyphSmall}
                  style={{ background: draftCategory ? (draftCategory.color || seriesForName(draftCategory.name)) : 'var(--text-muted)' }}
                >
                  {draftCategory?.emoji || draftCategory?.name?.charAt(0).toUpperCase() || '?'}
                </span>
                <span>{draftCategory?.name || 'Sin categoría'}</span>
              </button>
            )}
          </div>

          <div className={styles.txEditField}>
            <span className={styles.txEditFieldLabel}>Monto</span>
            <input
              type="number" inputMode="decimal" value={editDraft.amount}
              onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
              className={styles.txEditInput} placeholder="0"
            />
            <div className={styles.txEditPresets}>
              <button type="button" onClick={() => addAmountPreset(5000)} className={styles.txEditPresetButton}>+5.000</button>
              <button type="button" onClick={() => addAmountPreset(10000)} className={styles.txEditPresetButton}>+10.000</button>
            </div>
          </div>

          <div className={styles.txEditField}>
            <span className={styles.txEditFieldLabel}>Cuenta / origen de fondos</span>
            <AccountAutocomplete
              accounts={accounts}
              value={editDraft.accountId}
              onChange={(id) => setEditDraft({ ...editDraft, accountId: id })}
              placeholder="Cuenta"
            />
          </div>

          <div className={styles.txEditField}>
            <span className={styles.txEditFieldLabel}>Etiquetas</span>
            <div className={styles.txTagsEditor}>
              {editDraft.tags.map((tag) => (
                <span key={tag} className={styles.txTagEditable}>
                  #{tag}
                  <button
                    type="button" onClick={() => handleDraftRemoveTag(tag)}
                    className={styles.txTagRemove} aria-label={`Quitar tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className={styles.txTagAddInput}
                placeholder="+ tag"
                value={newTagDraft}
                onChange={(e) => setNewTagDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleDraftAddTag() } }}
                onBlur={() => { if (newTagDraft.trim()) handleDraftAddTag() }}
              />
            </div>
          </div>

          <div className={styles.txEditField}>
            <span className={styles.txEditFieldLabel}>Nota o detalle</span>
            <input
              value={editDraft.purpose} onChange={(e) => setEditDraft({ ...editDraft, purpose: e.target.value })}
              className={styles.txEditInput} placeholder="Descripción"
            />
          </div>

          <div className={styles.txEditActions}>
            <button type="button" onClick={() => handleSaveEdit(t)} disabled={savingEdit || !editDraft.amount} className={styles.txEditSave}>Guardar</button>
            <button type="button" onClick={cancelEdit} className={styles.txEditCancel}>Cancelar</button>
          </div>
        </div>
      )
    }

    return (
      <div
        key={t.id}
        className={`${styles.txRow} ${styles.txRowClickable}`}
        style={ignored ? { opacity: 0.5 } : undefined}
        onClick={() => startEdit(t)}
      >
        <span
          className={styles.txGlyph}
          style={{ background: cat ? (cat.color || seriesForName(cat.name)) : 'var(--text-muted)' }}
        >
          {cat?.emoji || cat?.name?.charAt(0).toUpperCase() || '?'}
        </span>
        <div className={styles.txInfo}>
          {cat && <span className={styles.txCategory}>{cat.name}</span>}
          <span className={styles.txPurpose}>{t.purpose}</span>
          {t.tags?.length > 0 && (
            <div className={styles.txTags}>
              {t.tags.map((tag) => <span key={tag} className={styles.txTag}>#{tag}</span>)}
            </div>
          )}
          <span className={styles.txMeta}>
            {new Date(t.occurred_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
            {' · '}{accountName(t.account_id) === '—' ? 'Pendiente' : accountName(t.account_id)}
          </span>
        </div>
        <div className={styles.txRight}>
          <span className={isGasto ? `${styles.txAmount} ${styles.txAmountGasto}` : `${styles.txAmount} ${styles.txAmountIngreso}`}>
            {formatByCurrency(Math.abs(t.amount), t.currency)}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(t) }}
            className={styles.txDelete} aria-label="Eliminar movimiento"
          >
            ×
          </button>
        </div>
      </div>
    )
  }

  const periodLabel = period === 'hoy' ? 'hoy' : period === 'semana' ? 'la semana' : 'el mes'

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className="page-title">Diario</h1>
        <div className={styles.periodControl}>
          {PERIODS.map((p) => (
            <button
              key={p.key} type="button"
              className={period === p.key ? `${styles.periodButton} ${styles.periodButtonActive}` : styles.periodButton}
              onClick={() => changePeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.hero}>
        {hasAnyBudget && (
          <span className={styles.heroBudgetCaption}>
            {presupuestoRestante >= 0
              ? `${formatByCurrency(presupuestoRestante, 'COP')} presupuesto restante`
              : `${formatByCurrency(-presupuestoRestante, 'COP')} de presupuesto excedido`}
          </span>
        )}
        <span className={styles.heroLabel}>Total de {periodLabel}</span>
        <div className={styles.heroTotal}>
          <span className={netPeriodo < 0 ? `${styles.heroIcon} ${styles.heroIconNegative}` : `${styles.heroIcon} ${styles.heroIconPositive}`}>
            {netPeriodo < 0 ? '−' : '+'}
          </span>
          <span className={styles.heroAmount}>{formatByCurrency(Math.abs(netPeriodo), 'COP')}</span>
        </div>
        <div className={styles.heroPills}>
          <span className={`${styles.heroPill} ${styles.heroPillGasto}`}>− {formatByCurrency(gastoPeriodo, 'COP')}</span>
          <span className={`${styles.heroPill} ${styles.heroPillIngreso}`}>+ {formatByCurrency(ingresoPeriodo, 'COP')}</span>
        </div>
        {missingRateCount > 0 && (
          <p className={styles.warning}>
            {missingRateCount} movimiento{missingRateCount === 1 ? '' : 's'} en moneda sin tasa configurada, no incluido{missingRateCount === 1 ? '' : 's'} en el total.
          </p>
        )}
      </div>

      {categoryChartData.length === 0 ? (
        <p className={styles.hint}>Todavía no hay gastos categorizados en {periodLabel}.</p>
      ) : (
        <>
        <div className={styles.categoryChipsRow}>
          {categoryChartData.map((c, i) => {
            const pct = budgetPct(c)
            return (
              <button
                key={c.id} type="button"
                className={selectedCategoryId === c.id ? `${styles.categoryChip} ${styles.categoryChipActive}` : styles.categoryChip}
                style={{ borderColor: budgetToneColor(pct) }}
                onClick={() => setSelectedCategoryId((prev) => (prev === c.id ? null : c.id))}
              >
                <span className={styles.categoryChipEmoji} style={{ background: c.color || CHART_COLORS[i % CHART_COLORS.length] }}>
                  {c.emoji || c.name.charAt(0).toUpperCase()}
                </span>
                <span className={styles.categoryChipAmount}>{formatCompact(c.value)}</span>
              </button>
            )
          })}
        </div>
        {selectedCategory && (
          <p className={styles.categorySelectedCaption}>
            {selectedCategory.budget != null ? (
              selectedCategory.value <= selectedCategory.budget
                ? `${selectedCategory.name}: quedan ${formatByCurrency(selectedCategory.budget - selectedCategory.value, 'COP')} de ${formatByCurrency(selectedCategory.budget, 'COP')}`
                : `${selectedCategory.name}: excedido por ${formatByCurrency(selectedCategory.value - selectedCategory.budget, 'COP')}`
            ) : (
              `${selectedCategory.name}: ${formatByCurrency(selectedCategory.value, 'COP')} — sin presupuesto configurado`
            )}
          </p>
        )}
        </>
      )}

      <Card title={`Movimientos — ${period === 'hoy' ? 'hoy' : period === 'semana' ? 'esta semana' : 'este mes'}`} className="span-3">
        {periodTransactions === null ? (
          <p className={styles.hint}>Cargando…</p>
        ) : periodTransactions.length === 0 ? (
          <p className={styles.hint}>Todavía no hay movimientos en {periodLabel}.</p>
        ) : (
          <div className={styles.txList}>
            {period === 'hoy' ? (
              periodTransactions.map(renderTxRow)
            ) : (
              dateGroups.map(([day, rows]) => (
                <div key={day}>
                  <p className={styles.txDateHeader}>{formatDateHeader(day)}</p>
                  {rows.map(renderTxRow)}
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        title="¿Eliminar este movimiento?"
        message={deleteTarget ? `${deleteTarget.purpose} — ${formatByCurrency(deleteTarget.amount, deleteTarget.currency)}` : ''}
        confirmLabel="Eliminar"
        destructive
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
