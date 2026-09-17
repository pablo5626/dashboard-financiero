import { useCallback, useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import Card from '../components/ui/Card.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'
import CategoryEmojiGrid, { seriesForName } from '../components/CategoryEmojiGrid.jsx'
import AccountAutocomplete from '../components/AccountAutocomplete.jsx'
import { formatByCurrency, formatCompact } from '../lib/format.js'
import { listAccounts } from '../lib/accountsApi.js'
import { listCategories } from '../lib/categoriesApi.js'
import { getRates, toCOP, convertAmount } from '../lib/exchangeRatesApi.js'
import {
  listTransactionsForDay, listTransactionsForRange,
  deleteTransaction, updateTransaction, isIgnoredRow,
} from '../lib/transactionsApi.js'
import styles from './Diario.module.css'

const CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)']
const TREND_DAYS = 7
const chartTooltipStyle = { contentStyle: { background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 8 }, labelStyle: { color: 'var(--text-primary)' }, itemStyle: { color: 'var(--text-primary)' } }

// Fecha calendario en UTC (no Bogotá local) — mismo criterio que
// QuickCaptureFAB.jsx, así "movimientos de hoy" siempre coincide con el
// día que QuickCaptureFAB usó al guardar.
const today = () => new Date().toISOString().slice(0, 10)

function hasCOPRate(currency, rates) {
  if (!currency || currency === 'COP') return true
  return convertAmount(1, currency, 'COP', rates) != null
}

// Arma los TREND_DAYS días (incluyendo hoy) con el gasto de cada uno, en COP,
// para el gráfico de tendencia — días sin movimientos quedan en 0 en vez de
// faltar del eje, para que el ritmo de gasto se vea completo.
function buildTrendData(rows, startStr, rates) {
  const totals = {}
  for (const row of rows) {
    if (isIgnoredRow(row.tags)) continue
    if (Number(row.amount) >= 0) continue
    const day = row.occurred_at.slice(0, 10)
    totals[day] = (totals[day] ?? 0) + toCOP(-Number(row.amount), row.currency, rates)
  }
  const days = []
  const cursor = new Date(`${startStr}T00:00:00Z`)
  for (let i = 0; i < TREND_DAYS; i++) {
    const dateStr = cursor.toISOString().slice(0, 10)
    days.push({
      date: dateStr,
      label: cursor.toLocaleDateString('es-CO', { weekday: 'short', timeZone: 'UTC' }),
      gasto: totals[dateStr] ?? 0,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export default function Diario() {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [rates, setRates] = useState([])
  const [todayTransactions, setTodayTransactions] = useState(null)
  const [trendData, setTrendData] = useState([])
  const [error, setError] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null) // transacción | null

  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState(null) // { purpose, amount, categoryId, accountId, tag }
  const [savingEdit, setSavingEdit] = useState(false)

  const loadAll = useCallback(() => {
    const end = new Date(`${today()}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    const start = new Date(`${today()}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - (TREND_DAYS - 1))
    const startStr = start.toISOString().slice(0, 10)
    const endStr = end.toISOString().slice(0, 10)

    return Promise.all([
      listAccounts(),
      listCategories(),
      getRates(),
      listTransactionsForDay(today()),
      listTransactionsForRange(startStr, endStr),
    ]).then(([accountsList, categoriesList, ratesList, todayList, rangeRows]) => {
      setAccounts(accountsList)
      setCategories(categoriesList)
      setRates(ratesList)
      setTodayTransactions(todayList)
      setTrendData(buildTrendData(rangeRows, startStr, ratesList))
    }).catch((err) => setError(err.message))
  }, [])

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

  function startEdit(t) {
    setEditingId(t.id)
    setEditDraft({
      purpose: t.purpose || '',
      amount: String(Math.abs(Number(t.amount))),
      categoryId: t.category_id || '',
      accountId: t.account_id || '',
      tag: t.tags?.[0] || '',
    })
  }

  function cancelEdit() {
    setEditingId('')
    setEditDraft(null)
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
        tags: editDraft.tag.trim() ? [editDraft.tag.trim()] : [],
      })
      setTodayTransactions((prev) => prev.map((t) => (t.id === original.id ? updated : t)))

      // Ajusta el bucket de "hoy" en la tendencia por la diferencia entre el
      // gasto viejo y el nuevo (esta edición nunca cambia la fecha, así que
      // el día del bucket es siempre el mismo) — misma idea que doDelete,
      // restando lo viejo y sumando lo nuevo en vez de recalcular todo.
      const day = original.occurred_at.slice(0, 10)
      const oldGastoCOP = wasGasto && !isIgnoredRow(original.tags) ? toCOP(-Number(original.amount), original.currency, rates) : 0
      const newGastoCOP = Number(updated.amount) < 0 && !isIgnoredRow(updated.tags) ? toCOP(-Number(updated.amount), updated.currency, rates) : 0
      if (oldGastoCOP !== newGastoCOP) {
        setTrendData((prev) => prev.map((d) => (d.date === day ? { ...d, gasto: Math.max(0, d.gasto - oldGastoCOP + newGastoCOP) } : d)))
      }
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
      setTodayTransactions((prev) => prev.filter((t) => t.id !== target.id))
      const day = target.occurred_at.slice(0, 10)
      if (Number(target.amount) < 0 && !isIgnoredRow(target.tags)) {
        const amountCOP = toCOP(-Number(target.amount), target.currency, rates)
        setTrendData((prev) => prev.map((d) => (d.date === day ? { ...d, gasto: Math.max(0, d.gasto - amountCOP) } : d)))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const visibleToday = (todayTransactions ?? []).filter((t) => !isIgnoredRow(t.tags))
  let gastoHoy = 0
  let ingresoHoy = 0
  for (const t of visibleToday) {
    const converted = toCOP(Number(t.amount), t.currency, rates)
    if (Number(t.amount) < 0) gastoHoy += -converted
    else ingresoHoy += converted
  }
  const missingRateCount = visibleToday.filter((t) => !hasCOPRate(t.currency, rates)).length
  const netHoy = ingresoHoy - gastoHoy

  const categorySpendToday = {}
  for (const t of visibleToday) {
    if (Number(t.amount) >= 0 || !t.category_id) continue
    categorySpendToday[t.category_id] = (categorySpendToday[t.category_id] ?? 0) + toCOP(-Number(t.amount), t.currency, rates)
  }
  const categoryChartData = categories
    .map((c) => ({ id: c.id, name: c.name, value: categorySpendToday[c.id] ?? 0, color: c.color, emoji: c.emoji }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
  // Alto de cada barra proporcional a su valor, con un piso en píxeles
  // (52px) para que emoji+monto siempre entren adentro, aun en la
  // categoría más chica del día.
  const maxCategorySpend = Math.max(1, ...categoryChartData.map((c) => c.value))

  function accountName(id) {
    return accounts.find((a) => a.id === id)?.name ?? '—'
  }

  return (
    <div className={styles.page}>
      <h1 className="page-title">Diario</h1>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.hero}>
        <span className={styles.heroLabel}>Total de hoy</span>
        <div className={styles.heroTotal}>
          <span className={netHoy < 0 ? `${styles.heroIcon} ${styles.heroIconNegative}` : `${styles.heroIcon} ${styles.heroIconPositive}`}>
            {netHoy < 0 ? '−' : '+'}
          </span>
          <span className={styles.heroAmount}>{formatByCurrency(Math.abs(netHoy), 'COP')}</span>
        </div>
        <div className={styles.heroPills}>
          <span className={`${styles.heroPill} ${styles.heroPillGasto}`}>− {formatByCurrency(gastoHoy, 'COP')}</span>
          <span className={`${styles.heroPill} ${styles.heroPillIngreso}`}>+ {formatByCurrency(ingresoHoy, 'COP')}</span>
        </div>
        {missingRateCount > 0 && (
          <p className={styles.warning}>
            {missingRateCount} movimiento{missingRateCount === 1 ? '' : 's'} en moneda sin tasa configurada, no incluido{missingRateCount === 1 ? '' : 's'} en el total.
          </p>
        )}
      </div>

      {categoryChartData.length === 0 ? (
        <p className={styles.hint}>Todavía no hay gastos categorizados hoy.</p>
      ) : (
        <div className={styles.categoryBarsRow}>
          {categoryChartData.map((c, i) => {
            const heightPx = Math.max(52, Math.round((c.value / maxCategorySpend) * 140))
            return (
              <div key={c.id} className={styles.categoryBar} title={`${c.name}: ${formatByCurrency(c.value, 'COP')}`}>
                <div className={styles.categoryBarTrack}>
                  <div
                    className={styles.categoryBarFill}
                    style={{ height: `${heightPx}px`, background: c.color || CHART_COLORS[i % CHART_COLORS.length] }}
                  >
                    <span className={styles.categoryBarEmoji}>{c.emoji || c.name.charAt(0).toUpperCase()}</span>
                    <span className={styles.categoryBarAmount}>{formatCompact(c.value)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Card title="Movimientos de hoy" className="span-3">
        {todayTransactions === null ? (
          <p className={styles.hint}>Cargando…</p>
        ) : todayTransactions.length === 0 ? (
          <p className={styles.hint}>Todavía no hay movimientos hoy.</p>
        ) : (
          <div className={styles.txList}>
            {todayTransactions.map((t) => {
              const cat = categories.find((c) => c.id === t.category_id)
              const ignored = isIgnoredRow(t.tags)
              const isGasto = Number(t.amount) < 0

              if (editingId === t.id) {
                return (
                  <div key={t.id} className={styles.txEditRow}>
                    <input
                      value={editDraft.purpose} onChange={(e) => setEditDraft({ ...editDraft, purpose: e.target.value })}
                      className={styles.txEditInput} placeholder="Descripción"
                    />
                    <input
                      type="number" inputMode="decimal" value={editDraft.amount}
                      onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
                      className={styles.txEditInput} placeholder="Monto"
                    />
                    <AccountAutocomplete
                      accounts={accounts}
                      value={editDraft.accountId}
                      onChange={(id) => setEditDraft({ ...editDraft, accountId: id })}
                      placeholder="Cuenta"
                    />
                    <CategoryEmojiGrid
                      categories={categories}
                      selectedId={editDraft.categoryId}
                      onSelect={(id) => setEditDraft((prev) => ({ ...prev, categoryId: prev.categoryId === id ? '' : id }))}
                    />
                    <input
                      value={editDraft.tag} onChange={(e) => setEditDraft({ ...editDraft, tag: e.target.value })}
                      className={styles.txEditInput} placeholder="Tag (opcional)"
                    />
                    <div className={styles.txEditActions}>
                      <button type="button" onClick={() => handleSaveEdit(t)} disabled={savingEdit || !editDraft.amount} className={styles.txEditSave}>Guardar</button>
                      <button type="button" onClick={cancelEdit} className={styles.txEditCancel}>Cancelar</button>
                    </div>
                  </div>
                )
              }

              return (
                <div key={t.id} className={styles.txRow} style={ignored ? { opacity: 0.5 } : undefined}>
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
                    <button onClick={() => startEdit(t)} className={styles.txEdit} aria-label="Editar movimiento">✎</button>
                    <button onClick={() => setDeleteTarget(t)} className={styles.txDelete} aria-label="Eliminar movimiento">×</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card title={`Tendencia (últimos ${TREND_DAYS} días)`} className="span-3">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--gridline)' }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={50} />
            <Tooltip formatter={(v) => formatByCurrency(v, 'COP')} cursor={{ fill: 'var(--gridline)' }} {...chartTooltipStyle} />
            <Bar dataKey="gasto" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
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
