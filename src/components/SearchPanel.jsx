import { useEffect, useState } from 'react'
import { IconClose } from './icons.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { formatByCurrency } from '../lib/format.js'
import { listAccounts } from '../lib/accountsApi.js'
import { listCategories } from '../lib/categoriesApi.js'
import { searchTransactions, deleteTransaction, updateTransactionTags } from '../lib/transactionsApi.js'
import styles from './SearchPanel.module.css'

const emptyFilters = { query: '', categoryId: '', accountId: '', tag: '', dateFrom: '', dateTo: '' }

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

// Menú desplegable de búsqueda, disparado por la lupa de QuickCaptureFAB
// (controlado desde AppShell, mismo motivo que SettingsPanel: son hermanos,
// no padre/hijo). Reemplaza el flujo anterior de navegar a /gastos y
// scrollear hasta la card "Buscar movimientos" — ahora la búsqueda ocurre
// acá mismo, sin salir de la página en la que está el usuario. La card
// "Buscar movimientos" se sacó de GastosDiarios.jsx: esta es la única copia
// de la función, no una duplicada.
export default function SearchPanel({ open, onClose }) {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [filters, setFilters] = useState(emptyFilters)
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  const [tagsDraftByTx, setTagsDraftByTx] = useState({})
  const [savingTagsId, setSavingTagsId] = useState(null)
  const [confirmDeleteTx, setConfirmDeleteTx] = useState(null) // { id, purpose } | null

  useEffect(() => {
    if (!open) return
    Promise.all([listAccounts(), listCategories()])
      .then(([a, c]) => { setAccounts(a); setCategories(c) })
      .catch((err) => setError(err.message))
  }, [open])

  async function handleSearch(e) {
    e.preventDefault()
    setSearching(true)
    setError(null)
    try {
      setResults(await searchTransactions({
        query: filters.query,
        categoryId: filters.categoryId || null,
        accountId: filters.accountId || null,
        tag: filters.tag,
        dateFrom: filters.dateFrom || null,
        dateTo: filters.dateTo || null,
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  function handleClear() {
    setFilters(emptyFilters)
    setResults(null)
  }

  async function handleSaveTags(txId) {
    const raw = tagsDraftByTx[txId] ?? ''
    setSavingTagsId(txId)
    try {
      await updateTransactionTags(txId, raw.split(',').map((t) => t.trim()).filter(Boolean))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingTagsId(null)
    }
  }

  async function doDelete() {
    const target = confirmDeleteTx
    setConfirmDeleteTx(null)
    try {
      await deleteTransaction(target.id)
      setResults((prev) => prev?.filter((t) => t.id !== target.id) ?? prev)
    } catch (err) {
      setError(err.message)
    }
  }

  function close() {
    onClose()
    setFilters(emptyFilters)
    setResults(null)
    setError(null)
  }

  if (!open) return null

  return (
    <>
      <div className={styles.backdrop} onClick={close}>
        <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="search-title" onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 id="search-title" className={styles.title}>Buscar movimientos</h2>
            <button type="button" className={styles.closeButton} onClick={close} aria-label="Cerrar">
              <IconClose width={20} height={20} />
            </button>
          </div>

          <p className={styles.hint}>Busca en todo el histórico, no solo en el mes activo de Gastos — ej. "todos los Rappi de este año".</p>
          {error && <p className={styles.error}>{error}</p>}

          <form onSubmit={handleSearch} className={styles.form}>
            <input
              placeholder="Descripción contiene…" value={filters.query} autoFocus
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              className={styles.input}
            />
            <select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })} className={styles.input}>
              <option value="">Todas las categorías</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })} className={styles.input}>
              <option value="">Todas las cuentas</option>
              <option value="pending">Pendiente de banco</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.kind === 'madre' ? `${a.name} (madre)` : a.name}</option>)}
            </select>
            <input
              placeholder="Tag (ej. rappi)" value={filters.tag}
              onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
              className={styles.input}
            />
            <div className={styles.dateRow}>
              <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className={styles.input} />
              <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className={styles.input} />
            </div>
            <div className={styles.formActions}>
              <button type="submit" disabled={searching} className={styles.searchButton}>{searching ? 'Buscando…' : 'Buscar'}</button>
              {results !== null && (
                <button type="button" onClick={handleClear} className={styles.clearButton}>Limpiar</button>
              )}
            </div>
          </form>

          {results !== null && (
            <>
              <p className={styles.hint}>
                {results.length} resultado(s){results.length === 200 ? ' — mostrando los 200 más recientes, refina la búsqueda para ver más' : ''}.
              </p>
              <div className={styles.results}>
                {results.map((t) => (
                  <div key={t.id} className={styles.resultRow}>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultPurpose}>{t.purpose}</span>
                      <span className={styles.resultMeta}>
                        {formatDate(t.occurred_at)} · {t.categories?.name ?? '—'} · {t.accounts?.name ?? (t.assignment_confirmed ? 'ignorado' : 'pendiente')}
                      </span>
                      <div className={styles.tagsRow}>
                        <input
                          className={styles.tagsInput} placeholder="tag1, tag2…"
                          value={tagsDraftByTx[t.id] ?? (t.tags ?? []).join(', ')}
                          onChange={(e) => setTagsDraftByTx({ ...tagsDraftByTx, [t.id]: e.target.value })}
                        />
                        <button type="button" onClick={() => handleSaveTags(t.id)} disabled={savingTagsId === t.id} className={styles.tagsSave}>
                          {savingTagsId === t.id ? '…' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                    <div className={styles.resultRight}>
                      <span className={styles.resultAmount}>{formatByCurrency(t.amount, t.currency)}</span>
                      <button onClick={() => setConfirmDeleteTx({ id: t.id, purpose: t.purpose })} className={styles.deleteButton} aria-label="Eliminar movimiento">×</button>
                    </div>
                  </div>
                ))}
                {results.length === 0 && <p className={styles.hint}>Sin resultados para esos filtros.</p>}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteTx}
        title={`¿Eliminar el movimiento "${confirmDeleteTx?.purpose}"?`}
        message="No se puede deshacer. Si vuelves a importar el mismo CSV, se detecta como nuevo y se vuelve a agregar."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doDelete}
        onCancel={() => setConfirmDeleteTx(null)}
      />
    </>
  )
}
