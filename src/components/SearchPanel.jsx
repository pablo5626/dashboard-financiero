import { useEffect, useRef, useState } from 'react'
import { IconClose, IconMic, IconSearch, IconTag, IconAccounts, IconChevronRight } from './icons.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { formatByCurrency } from '../lib/format.js'
import { listAccounts } from '../lib/accountsApi.js'
import { listCategories } from '../lib/categoriesApi.js'
import { searchTransactions, deleteTransaction, updateTransactionTags, listTopTags } from '../lib/transactionsApi.js'
import styles from './SearchPanel.module.css'

const emptyFilters = { query: '', categoryId: '', accountId: '', tag: '', dateFrom: '', dateTo: '' }
const SEARCH_DEBOUNCE_MS = 350

// undefined en navegadores sin soporte — mismo criterio que QuickCaptureFAB:
// el botón de mic directamente no se renderiza en ese caso.
const SpeechRecognitionCtor =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

// Acento/mayúscula-insensible, mismo criterio que normalizeName en
// QuickCaptureFAB.jsx — para que "cuidado" matchee "Cuidado personal" sin
// pedirle al usuario que tipee tilde a tilde.
function normalize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Menú desplegable de búsqueda, disparado por la lupa de QuickCaptureFAB
// (controlado desde AppShell, mismo motivo que SettingsPanel: son hermanos,
// no padre/hijo). Reemplaza el flujo anterior de navegar a /gastos y
// scrollear hasta la card "Buscar movimientos" — ahora la búsqueda ocurre
// acá mismo, sin salir de la página en la que está el usuario. La card
// "Buscar movimientos" se sacó de GastosDiarios.jsx: esta es la única copia
// de la función, no una duplicada.
//
// Rediseñada para que la búsqueda sea el único gesto necesario: un solo
// campo grande dispara la búsqueda solo (debounce, sin botón "Buscar"), y
// categoría/cuenta/tag/fechas quedan escondidos detrás de un toggle
// "Filtros" — mismo criterio que el tag "#" de QuickCaptureFAB: el campo
// que se usa siempre queda a la vista, el resto no compite por atención.
export default function SearchPanel({ open, onClose }) {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [topTags, setTopTags] = useState([])
  const [filters, setFilters] = useState(emptyFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  const [tagsDraftByTx, setTagsDraftByTx] = useState({})
  const [savingTagsId, setSavingTagsId] = useState(null)
  const [confirmDeleteTx, setConfirmDeleteTx] = useState(null) // { id, purpose } | null

  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)

  const activeFilterCount = ['categoryId', 'accountId', 'tag', 'dateFrom', 'dateTo'].filter((k) => filters[k]).length
  const hasAnyFilter = filters.query.trim() || activeFilterCount > 0

  useEffect(() => {
    if (!open) return
    Promise.all([listAccounts(), listCategories(), listTopTags()])
      .then(([a, c, t]) => {
        setAccounts(a)
        setCategories(c)
        // Los tags que nombran una cuenta ya tienen su propio filtro de
        // "Cuenta" — ofrecerlos también acá sería redundante.
        const accountNames = new Set(a.map((acc) => acc.name.toLowerCase()))
        setTopTags(t.filter((tag) => !accountNames.has(tag)))
      })
      .catch((err) => setError(err.message))
  }, [open])

  // Búsqueda en vivo: cualquier cambio de filtro dispara la consulta sola,
  // con debounce para no golpear Supabase en cada tecla. Sin filtros no hay
  // consulta — evita traer los 200 movimientos más recientes al abrir.
  useEffect(() => {
    if (!open) return
    if (!hasAnyFilter) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    setError(null)
    // El cuadro único busca por descripción, categoría y tag a la vez — las
    // categorías cuyo nombre matchea el texto se resuelven acá (ya están en
    // memoria) y se pasan como IDs, porque PostgREST no puede hacer un OR
    // entre una columna propia y el nombre de una tabla relacionada en una
    // sola consulta (ver transactionsApi.searchTransactions).
    const needle = normalize(filters.query.trim())
    const matchCategoryIds = needle
      ? categories.filter((c) => normalize(c.name).includes(needle)).map((c) => c.id)
      : []
    const timer = setTimeout(async () => {
      try {
        setResults(await searchTransactions({
          query: filters.query,
          categoryId: filters.categoryId || null,
          accountId: filters.accountId || null,
          tag: filters.tag,
          dateFrom: filters.dateFrom || null,
          dateTo: filters.dateTo || null,
          matchCategoryIds,
        }))
      } catch (err) {
        setError(err.message)
      } finally {
        setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filters])

  function handleClear() {
    setFilters(emptyFilters)
    setResults(null)
    setShowFilters(false)
  }

  // Dicta la descripción a buscar — mismo motor (Web Speech API) que
  // QuickCaptureFAB, pero acá el resultado va directo al campo de texto
  // (dispara la búsqueda en vivo sola), sin pasar por el parseo de
  // voice-parse: no hay campos que extraer, es solo texto libre.
  function startVoiceSearch() {
    if (!SpeechRecognitionCtor) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'es-CO'
    recognition.interimResults = true
    recognition.onstart = () => setListening(true)
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognition.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript
      setFilters((f) => ({ ...f, query: text }))
    }
    recognitionRef.current = recognition
    recognition.start()
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
    recognitionRef.current?.abort()
    onClose()
    setFilters(emptyFilters)
    setShowFilters(false)
    setResults(null)
    setError(null)
  }

  if (!open) return null

  return (
    <>
      <div className={styles.backdrop} onClick={close}>
        <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="search-title" onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <div className={styles.titleRow}>
              <span className={styles.titleBadge}><IconSearch width={16} height={16} /></span>
              <h2 id="search-title" className={styles.title}>Buscar movimientos</h2>
            </div>
            <button type="button" className={styles.closeButton} onClick={close} aria-label="Cerrar">
              <IconClose width={20} height={20} />
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.searchRow}>
            <IconSearch width={16} height={16} className={styles.searchRowIcon} />
            <input
              placeholder="Busca por descripción, categoría o tag… ej. Rappi" value={filters.query} autoFocus
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              className={styles.bigInput}
            />
            {SpeechRecognitionCtor && (
              <button
                type="button"
                className={listening ? `${styles.micButton} ${styles.micButtonActive}` : styles.micButton}
                onClick={startVoiceSearch}
                aria-label="Buscar por voz"
              >
                <IconMic width={16} height={16} />
              </button>
            )}
            <button
              type="button"
              className={activeFilterCount > 0 ? `${styles.filterToggle} ${styles.filterToggleActive}` : styles.filterToggle}
              onClick={() => setShowFilters((v) => !v)}
              aria-label="Más filtros"
            >
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>

          {showFilters && (
            <div className={styles.filtersPanel}>
              <div className={styles.filterPickerRow}>
                <span className={styles.filterPickerIcon} data-tone="category"><IconTag width={14} height={14} /></span>
                <select
                  value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
                  className={styles.filterPickerSelect}
                >
                  <option value="">Todas las categorías</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <IconChevronRight width={14} height={14} className={styles.filterPickerChevron} />
              </div>

              <div className={styles.filterPickerRow}>
                <span className={styles.filterPickerIcon} data-tone="account"><IconAccounts width={14} height={14} /></span>
                <select
                  value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}
                  className={styles.filterPickerSelect}
                >
                  <option value="">Todas las cuentas</option>
                  <option value="pending">Pendiente de banco</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.kind === 'madre' ? `${a.name} (madre)` : a.name}</option>)}
                </select>
                <IconChevronRight width={14} height={14} className={styles.filterPickerChevron} />
              </div>

              <input
                placeholder="Tag (ej. rappi)" value={filters.tag}
                onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
                className={styles.input}
              />
              {topTags.length > 0 && (
                <div className={styles.tagSuggestionRow}>
                  {topTags.map((t) => (
                    <button
                      key={t} type="button"
                      className={filters.tag === t ? `${styles.tagSuggestionChip} ${styles.tagSuggestionChipActive}` : styles.tagSuggestionChip}
                      onClick={() => setFilters({ ...filters, tag: filters.tag === t ? '' : t })}
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              )}

              <div className={styles.dateRow}>
                <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className={styles.input} />
                <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className={styles.input} />
              </div>
            </div>
          )}

          {hasAnyFilter && (
            <div className={styles.statusRow}>
              <p className={styles.hint}>
                {searching
                  ? 'Buscando…'
                  : `${results?.length ?? 0} resultado(s)${results?.length === 200 ? ' — mostrando los 200 más recientes, refina la búsqueda para ver más' : ''}.`}
              </p>
              <button type="button" onClick={handleClear} className={styles.clearButton}>Limpiar</button>
            </div>
          )}

          {results !== null && !searching && (
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
