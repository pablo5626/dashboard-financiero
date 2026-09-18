import { useEffect, useState } from 'react'
import { IconSettings, IconClose, IconChevronRight, IconTag, IconAccounts, IconDebts, IconGoals, IconExchange } from './icons.jsx'
import ColorSwatchPicker from './ui/ColorSwatchPicker.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { listCategories, createCategory, updateCategory, archiveCategory } from '../lib/categoriesApi.js'
import { backfillPurposeCategoryStats, markLoanTransactionReviewed } from '../lib/transactionsApi.js'
import { listAccounts, createAccount, saveMonthlyInitialBalances } from '../lib/accountsApi.js'
import { createDebt } from '../lib/debtsApi.js'
import { createSavingsGoal } from '../lib/savingsApi.js'
import { getRates, setRate, fetchLiveRate } from '../lib/exchangeRatesApi.js'
import { formatByCurrency, CURRENCIES } from '../lib/format.js'
import styles from './SettingsPanel.module.css'

// Los únicos 3 pares posibles ya que CURRENCIES tiene solo 3 monedas — a
// diferencia de Cuentas.jsx (que solo muestra el par de una moneda si hay
// una cuenta activa en ella), acá se listan los 3 siempre: es la pantalla
// de configurar tasas, no una vista atada a qué cuentas existen hoy.
const RATE_PAIRS = [['COP', 'USD'], ['COP', 'EUR'], ['USD', 'EUR']]

const emptyNewCategory = { name: '', emoji: '', color: '', isAmbiguous: true }
const emptyEditDraft = { name: '', emoji: '', color: '', isAmbiguous: true, monthlyBudget: '' }
const MULTI = 'MULTI' // valor del <select> de tipo de cuenta para "multi-moneda"
const emptyNewAccount = { name: '', type: 'COP', pockets: [], draftCurrency: '', draftAmount: '' }

const RELATIONSHIP_OPTIONS = [
  { value: 'amigo', label: 'Amigo' },
  { value: 'familiar', label: 'Familiar' },
  { value: 'companero', label: 'Compañero' },
  { value: 'pareja', label: 'Pareja' },
  { value: 'conocido', label: 'Conocido' },
  { value: 'otro', label: 'Otro' },
]

const emptyNewDebt = {
  direction: 'debo', creditorName: '', totalAmount: '', remainingAmount: '', currency: 'COP',
  interestRate: '', monthlyPayment: '', termMonths: '', startDate: '',
  counterpartyRelationship: '', contactInfo: '', expectedPaymentDate: '', notes: '',
  sourceTransactionId: null,
}

const emptyNewGoal = { kind: 'puntual', name: '', accountId: '', targetAmount: '', targetDate: '' }

// Menú raíz de "Ajustes" — una fila por sección, patrón lista de Ajustes de
// iOS (glifo + título + subtítulo + chevron). Agregar una sección nueva es
// agregar una entrada acá con su propio `key` y un bloque de contenido en
// SETTINGS_SECTIONS más abajo — no se agrega nada a esta lista salvo que el
// usuario pida una sección concreta.
const SETTINGS_SECTIONS = [
  { key: 'categorias', label: 'Categorías', subtitle: 'Crear, renombrar, colores, presupuestos', Icon: IconTag },
  { key: 'cuentas', label: 'Cuentas', subtitle: 'Agregar una cuenta hija, incluida multi-moneda', Icon: IconAccounts },
  { key: 'deudas', label: 'Deudas', subtitle: 'Agregar una deuda o un préstamo dado', Icon: IconDebts },
  { key: 'metas', label: 'Metas de ahorro', subtitle: 'Agregar una meta puntual o con propósito', Icon: IconGoals },
  { key: 'tasas', label: 'Tasas de cambio', subtitle: 'COP/USD/EUR, a mano o buscadas automáticamente', Icon: IconExchange },
]

// Botón + panel de ajustes, montado una sola vez en AppShell y siempre
// visible arriba a la izquierda en cualquier página — pensado para
// configuración que no se necesita todo el tiempo (hoy: categorías, más
// secciones después) y por eso no debe ocupar espacio fijo en ninguna
// página en particular. El panel es una mini-navegación de dos niveles
// (menú de secciones → detalle de una sección con botón "volver"), no un
// único formulario largo, precisamente para que agregar secciones futuras
// no vuelva la pantalla raíz más pesada. Cada página que lista/usa
// categorías (GastosDiarios.jsx, Diario.jsx, QuickCaptureFAB.jsx) sigue
// trayendo su propia copia vía listCategories() al montar/abrir — sin store
// global, mismo patrón que el resto de la app — así que un cambio hecho acá
// se refleja la próxima vez que esa pantalla cargue, no en vivo mientras
// este panel está abierto sobre otra.
export default function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState(null) // null = menú raíz, si no la key de SETTINGS_SECTIONS
  const [categories, setCategories] = useState([])
  const [error, setError] = useState(null)

  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState(emptyEditDraft)
  const [savingEdit, setSavingEdit] = useState(false)

  const [newCategory, setNewCategory] = useState(emptyNewCategory)
  const [creating, setCreating] = useState(false)

  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null

  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)

  const [accounts, setAccounts] = useState([])
  const [newAccount, setNewAccount] = useState(emptyNewAccount)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [accountCreated, setAccountCreated] = useState(null) // nombre de la última cuenta creada, o null

  const [newDebt, setNewDebt] = useState(emptyNewDebt)
  const [creatingDebt, setCreatingDebt] = useState(false)
  const [debtCreated, setDebtCreated] = useState(null)

  const [newGoal, setNewGoal] = useState(emptyNewGoal)
  const [creatingGoal, setCreatingGoal] = useState(false)
  const [goalCreated, setGoalCreated] = useState(null)

  const [rates, setRates] = useState([])
  const [rateInputs, setRateInputs] = useState({}) // "base_quote" -> string
  const [savingRatePair, setSavingRatePair] = useState(null) // "base_quote" | null
  const [fetchingRatePair, setFetchingRatePair] = useState(null) // "base_quote" | null
  const [rateFetchError, setRateFetchError] = useState({}) // "base_quote" -> string | undefined

  useEffect(() => {
    if (!open) return
    listCategories().then(setCategories).catch((err) => setError(err.message))
    listAccounts().then(setAccounts).catch((err) => setError(err.message))
    getRates().then(setRates).catch((err) => setError(err.message))
  }, [open])

  // Puente entre páginas hermanas bajo AppShell y este panel (que vive
  // aparte, montado una sola vez): "Préstamos detectados sin registrar" en
  // Deudas.jsx quiere precargar el formulario de acá con los datos reales de
  // un movimiento ya importado — mismo criterio "sin store global" que
  // `dashboard:transactions-changed`, solo que este evento además abre el
  // panel en la sección correcta y le manda un draft.
  useEffect(() => {
    function handleOpenSettings(e) {
      const { section: targetSection, prefill } = e.detail ?? {}
      if (!targetSection) return
      setOpen(true)
      setSection(targetSection)
      if (targetSection === 'deudas' && prefill) {
        setNewDebt({ ...emptyNewDebt, ...prefill })
      }
    }
    window.addEventListener('dashboard:open-settings', handleOpenSettings)
    return () => window.removeEventListener('dashboard:open-settings', handleOpenSettings)
  }, [])

  async function reload() {
    try {
      setCategories(await listCategories())
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(id) {
    setEditingId(id)
    const cat = categories.find((c) => c.id === id)
    setEditDraft({
      name: cat?.name ?? '', emoji: cat?.emoji ?? '', color: cat?.color ?? '',
      isAmbiguous: cat?.is_ambiguous ?? true,
      monthlyBudget: cat?.monthly_budget != null ? String(cat.monthly_budget) : '',
    })
  }

  async function handleSaveEdit() {
    if (!editingId || !editDraft.name.trim()) return
    setSavingEdit(true)
    try {
      await updateCategory(editingId, {
        name: editDraft.name.trim(),
        emoji: editDraft.emoji.trim() || null,
        color: editDraft.color || null,
        is_ambiguous: editDraft.isAmbiguous,
        monthly_budget: editDraft.monthlyBudget === '' ? null : Number(editDraft.monthlyBudget),
      })
      setEditingId('')
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingEdit(false)
    }
  }

  // Emoji obligatorio para categorías nuevas (no retroactivo sobre las que
  // ya existían sin uno) — mismo criterio que tenía GastosDiarios.jsx antes
  // de que esta sección se mudara acá.
  async function handleCreate(e) {
    e.preventDefault()
    if (!newCategory.name.trim() || !newCategory.emoji.trim()) return
    setCreating(true)
    try {
      await createCategory({
        name: newCategory.name.trim(), emoji: newCategory.emoji.trim(),
        color: newCategory.color, isAmbiguous: newCategory.isAmbiguous,
      })
      setNewCategory(emptyNewCategory)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function doArchive() {
    const target = confirmArchive
    setConfirmArchive(null)
    try {
      await archiveCategory(target.id)
      if (editingId === target.id) setEditingId('')
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleBackfill() {
    setBackfilling(true)
    setBackfillResult(null)
    try {
      setBackfillResult(await backfillPurposeCategoryStats())
    } catch (err) {
      setError(err.message)
    } finally {
      setBackfilling(false)
    }
  }

  // "Bolsillos" en construcción para una cuenta nueva multi-moneda: se
  // agregan de a uno con un <select> (mismo patrón dropdown que "¿Es otra
  // moneda de...?" al editar una cuenta ya existente en Cuentas.jsx), no
  // como una fila de checkboxes siempre visible — más cómodo en celular,
  // donde una fila de checkbox + input por cada moneda se apretaba. El
  // primer bolsillo agregado es la moneda PRIMARIA de la cuenta.
  function addPocketToNewAccount() {
    if (!newAccount.draftCurrency) return
    if (newAccount.pockets.some((p) => p.currency === newAccount.draftCurrency)) return
    setNewAccount((prev) => ({
      ...prev,
      pockets: [...prev.pockets, { currency: prev.draftCurrency, amount: prev.draftAmount }],
      draftCurrency: '', draftAmount: '',
    }))
  }

  function removePocketFromNewAccount(currency) {
    setNewAccount((prev) => ({ ...prev, pockets: prev.pockets.filter((p) => p.currency !== currency) }))
  }

  async function handleCreateAccount(e) {
    e.preventDefault()
    if (!newAccount.name.trim()) return
    if (newAccount.type === MULTI && newAccount.pockets.length < 2) return
    const madreId = accounts.find((a) => a.kind === 'madre')?.id ?? null
    setCreatingAccount(true)
    setError(null)
    setAccountCreated(null)
    try {
      if (newAccount.type === MULTI) {
        const [primary, ...rest] = newAccount.pockets
        const created = await createAccount({
          name: newAccount.name.trim(), kind: 'hija', parentAccountId: madreId,
          currency: primary.currency, isMultiCurrency: true,
          extraCurrencies: rest.map((p) => ({ currency: p.currency, initialBalance: p.amount })),
        })
        // El bolsillo primario también puede traer saldo inicial de arranque
        // — createAccount ya sembró los extras, pero el primario se carga
        // aparte porque su moneda es accounts.currency, no una fila de
        // account_currencies.
        if (primary.amount) {
          const now = new Date()
          await saveMonthlyInitialBalances(
            [{ accountId: created.id, amount: Number(primary.amount) || 0, currency: primary.currency }],
            now.getFullYear(), now.getMonth() + 1
          )
        }
      } else {
        await createAccount({ name: newAccount.name.trim(), kind: 'hija', parentAccountId: madreId, currency: newAccount.type })
      }
      setAccountCreated(newAccount.name.trim())
      setNewAccount(emptyNewAccount)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingAccount(false)
    }
  }

  // Si el draft vino de "Precargar" en Deudas.jsx (ver el evento
  // `dashboard:open-settings` más arriba), sourceTransactionId ya trae el id
  // del movimiento real que originó el préstamo — al guardar se marca ese
  // movimiento como revisado para que salga de "Préstamos detectados sin
  // registrar", igual que hacía Deudas.jsx cuando el formulario vivía ahí.
  async function handleCreateDebt(e) {
    e.preventDefault()
    if (!newDebt.creditorName.trim() || !newDebt.totalAmount || !newDebt.remainingAmount) return
    setCreatingDebt(true)
    setError(null)
    setDebtCreated(null)
    try {
      await createDebt({
        creditorName: newDebt.creditorName.trim(),
        totalAmount: Number(newDebt.totalAmount),
        remainingAmount: Number(newDebt.remainingAmount),
        interestRate: newDebt.interestRate ? Number(newDebt.interestRate) : null,
        monthlyPayment: newDebt.monthlyPayment ? Number(newDebt.monthlyPayment) : null,
        termMonths: newDebt.termMonths ? Number(newDebt.termMonths) : null,
        startDate: newDebt.startDate,
        direction: newDebt.direction,
        counterpartyRelationship: newDebt.counterpartyRelationship || null,
        contactInfo: newDebt.contactInfo || null,
        expectedPaymentDate: newDebt.expectedPaymentDate || null,
        notes: newDebt.notes || null,
        sourceTransactionId: newDebt.sourceTransactionId,
        currency: newDebt.currency,
      })
      if (newDebt.sourceTransactionId) await markLoanTransactionReviewed(newDebt.sourceTransactionId)
      setDebtCreated(newDebt.creditorName.trim())
      setNewDebt(emptyNewDebt)
      window.dispatchEvent(new Event('dashboard:debts-changed'))
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingDebt(false)
    }
  }

  async function handleCreateGoal(e) {
    e.preventDefault()
    if (!newGoal.name.trim()) return
    setCreatingGoal(true)
    setError(null)
    setGoalCreated(null)
    try {
      await createSavingsGoal({
        kind: newGoal.kind,
        name: newGoal.name.trim(),
        accountId: newGoal.accountId || null,
        targetAmount: newGoal.targetAmount ? Number(newGoal.targetAmount) : null,
        targetDate: newGoal.targetDate,
      })
      setGoalCreated(newGoal.name.trim())
      setNewGoal(emptyNewGoal)
      window.dispatchEvent(new Event('dashboard:goals-changed'))
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingGoal(false)
    }
  }

  // Misma regla de siempre para un par (base, quote, rate): "1 quote = rate
  // base" — ver la nota extensa en CLAUDE.md sobre esto ("This bit us once
  // already"), acá se conserva sin tocar, solo se centralizó dónde se edita.
  async function handleSaveRate(e, base, quote) {
    e.preventDefault()
    const pairKey = `${base}_${quote}`
    const input = rateInputs[pairKey]
    if (!input) return
    setSavingRatePair(pairKey)
    try {
      await setRate(base, quote, Number(input))
      setRateInputs({ ...rateInputs, [pairKey]: '' })
      setRates(await getRates())
      // Cuentas.jsx también edita/muestra tasas inline en cada cuenta y sigue
      // montado debajo de este panel mientras se guarda acá — mismo patrón de
      // evento global que dashboard:debts-changed/goals-changed.
      window.dispatchEvent(new Event('dashboard:rates-changed'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingRatePair(null)
    }
  }

  // Trae la tasa del día de una API de datos (no de un modelo de lenguaje —
  // ver la nota en exchangeRatesApi.js) y solo PRELLENA el input manual, el
  // mismo que ya existe para tipear a mano: el usuario sigue revisando y
  // tocando "Guardar" para confirmarla, igual que cualquier otro prefill de
  // esta app (voz, recibo).
  async function handleFetchLiveRate(base, quote) {
    const pairKey = `${base}_${quote}`
    setFetchingRatePair(pairKey)
    setRateFetchError((prev) => ({ ...prev, [pairKey]: undefined }))
    try {
      const rate = await fetchLiveRate(base, quote)
      setRateInputs((prev) => ({ ...prev, [pairKey]: String(rate) }))
    } catch (err) {
      setRateFetchError((prev) => ({ ...prev, [pairKey]: err.message }))
    } finally {
      setFetchingRatePair(null)
    }
  }

  function close() {
    setOpen(false)
    setSection(null)
    setEditingId('')
    setError(null)
  }

  const activeSection = SETTINGS_SECTIONS.find((s) => s.key === section)

  return (
    <>
      <button type="button" className={styles.trigger} aria-label="Ajustes" onClick={() => setOpen(true)}>
        <IconSettings width={22} height={22} />
      </button>

      {open && (
        <div className={styles.backdrop} onClick={close}>
          <div
            className={styles.panel} role="dialog" aria-modal="true"
            aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              {activeSection ? (
                <button type="button" className={styles.backButton} onClick={() => setSection(null)} aria-label="Volver">
                  <IconChevronRight width={20} height={20} style={{ transform: 'rotate(180deg)' }} />
                  <span>Ajustes</span>
                </button>
              ) : (
                <h2 id="settings-title" className={styles.title}>Ajustes</h2>
              )}
              <button type="button" className={styles.closeButton} onClick={close} aria-label="Cerrar">
                <IconClose width={20} height={20} />
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            {!activeSection && (
              <div className={styles.menuList}>
                {SETTINGS_SECTIONS.map(({ key, label, subtitle, Icon }) => (
                  <button key={key} type="button" className={styles.menuRow} onClick={() => setSection(key)}>
                    <span className={styles.menuGlyph}><Icon width={20} height={20} /></span>
                    <span className={styles.menuText}>
                      <span className={styles.menuLabel}>{label}</span>
                      <span className={styles.menuSubtitle}>{subtitle}</span>
                    </span>
                    <IconChevronRight width={18} height={18} className={styles.menuChevron} />
                  </button>
                ))}
              </div>
            )}

            {activeSection?.key === 'categorias' && (
            <>
            <h3 className={styles.sectionTitle}>Categorías</h3>
            <p className={styles.hint}>
              Creá, renombrá o archivá categorías, y editá su emoji, color y presupuesto mensual.
            </p>

            <div className={styles.list}>
              {categories.map((c) => (
                <div key={c.id} className={styles.row}>
                  {editingId === c.id ? (
                    <div className={styles.editForm}>
                      <input
                        value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        className={styles.textInput} placeholder="Nombre"
                      />
                      <div className={styles.editFormRow}>
                        <input
                          value={editDraft.emoji} maxLength={4}
                          onChange={(e) => setEditDraft({ ...editDraft, emoji: e.target.value })}
                          className={styles.emojiInput} placeholder="Emoji"
                        />
                        <ColorSwatchPicker value={editDraft.color} onChange={(color) => setEditDraft({ ...editDraft, color })} />
                      </div>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox" checked={editDraft.isAmbiguous}
                          onChange={(e) => setEditDraft({ ...editDraft, isAmbiguous: e.target.checked })}
                        />
                        Ambigua
                      </label>
                      <input
                        type="number" value={editDraft.monthlyBudget}
                        onChange={(e) => setEditDraft({ ...editDraft, monthlyBudget: e.target.value })}
                        className={styles.textInput} placeholder="Presupuesto mensual (opcional)"
                      />
                      {c.name.trim().toLowerCase() === 'préstamo' && (
                        <p className={styles.warning}>
                          Esta categoría alimenta la detección de préstamos en Deudas — cambiarle el nombre o archivarla desactiva esa función.
                        </p>
                      )}
                      <div className={styles.rowActions}>
                        <button type="button" onClick={handleSaveEdit} disabled={savingEdit} className={styles.saveButton}>Guardar</button>
                        <button type="button" onClick={() => setEditingId('')} className={styles.cancelButton}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span
                        className={styles.rowGlyph}
                        style={c.color ? { background: c.color } : undefined}
                      >
                        {c.emoji || c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className={styles.rowName}>{c.name}</span>
                      <button type="button" onClick={() => startEdit(c.id)} className={styles.editLink}>Editar</button>
                      <button type="button" onClick={() => setConfirmArchive({ id: c.id, name: c.name })} className={styles.archiveLink}>Archivar</button>
                    </>
                  )}
                </div>
              ))}
              {categories.length === 0 && <p className={styles.hint}>No hay categorías todavía.</p>}
            </div>

            <form onSubmit={handleCreate} className={styles.createForm}>
              <span className={styles.hint}>+ Nueva categoría</span>
              <input
                placeholder="Nombre" value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                className={styles.textInput}
              />
              <div className={styles.editFormRow}>
                <input
                  placeholder="Emoji (obligatorio)" value={newCategory.emoji} maxLength={4}
                  onChange={(e) => setNewCategory({ ...newCategory, emoji: e.target.value })}
                  className={styles.emojiInput}
                />
                <ColorSwatchPicker value={newCategory.color} onChange={(color) => setNewCategory({ ...newCategory, color })} />
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox" checked={newCategory.isAmbiguous}
                  onChange={(e) => setNewCategory({ ...newCategory, isAmbiguous: e.target.checked })}
                />
                Ambigua
              </label>
              <button
                type="submit" disabled={creating || !newCategory.name.trim() || !newCategory.emoji.trim()}
                className={styles.saveButton}
              >
                Crear
              </button>
            </form>

            <button type="button" onClick={handleBackfill} disabled={backfilling} className={styles.learnButton}>
              {backfilling ? 'Aprendiendo…' : 'Aprender categoría/tag de tu historial'}
            </button>
            {backfillResult != null && (
              <p className={styles.hint}>
                Se analizaron {backfillResult} movimientos con categoría — las sugerencias en "Agregar movimiento manual" y el "+" ya lo reflejan.
              </p>
            )}
            </>
            )}

            {activeSection?.key === 'cuentas' && (
            <>
            <h3 className={styles.sectionTitle}>Cuentas</h3>
            <p className={styles.hint}>
              Creá una cuenta hija nueva — para renombrar, archivar o editar saldos de una ya existente, andá a la
              página "Cuentas".
            </p>

            <form onSubmit={handleCreateAccount} className={styles.createForm} style={{ borderTop: 'none', paddingTop: 0 }}>
              <input
                placeholder="Nombre (ej. Pibank)" value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                className={styles.textInput}
              />
              <select
                value={newAccount.type}
                onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value, pockets: [], draftCurrency: '', draftAmount: '' })}
                className={styles.textInput}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={MULTI}>Multi-moneda</option>
              </select>

              {newAccount.type === MULTI && (
                <div className={styles.editForm} style={{ border: '1px solid var(--border-hairline)', borderRadius: 8, padding: 8 }}>
                  <p className={styles.hint} style={{ margin: 0 }}>
                    Agregá cada moneda que tiene esta cuenta (mínimo 2) y cuánto tiene hoy — opcional, se carga como saldo inicial de este mes.
                  </p>
                  {newAccount.pockets.map((p) => (
                    <div key={p.currency} className={styles.editFormRow}>
                      <span style={{ flex: 1, font: 'var(--font-body)' }}>{p.currency}{p.amount ? ` — ${p.amount}` : ''}</span>
                      <button type="button" onClick={() => removePocketFromNewAccount(p.currency)} className={styles.archiveLink}>Quitar</button>
                    </div>
                  ))}
                  <div className={styles.editFormRow} style={{ flexWrap: 'wrap' }}>
                    <select
                      value={newAccount.draftCurrency}
                      onChange={(e) => setNewAccount({ ...newAccount, draftCurrency: e.target.value })}
                      className={styles.textInput}
                      style={{ flex: '1 1 100px', minWidth: 0 }}
                    >
                      <option value="">+ moneda…</option>
                      {CURRENCIES.filter((c) => !newAccount.pockets.some((p) => p.currency === c)).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      type="number" placeholder="Cuánto tiene (opcional)" value={newAccount.draftAmount}
                      onChange={(e) => setNewAccount({ ...newAccount, draftAmount: e.target.value })}
                      className={styles.textInput}
                      style={{ flex: '1 1 120px', minWidth: 0 }}
                    />
                    <button type="button" onClick={addPocketToNewAccount} disabled={!newAccount.draftCurrency} className={styles.saveButton} style={{ flexShrink: 0 }}>
                      Agregar
                    </button>
                  </div>
                  {newAccount.pockets.length < 2 && (
                    <p className={styles.warning}>Agregá al menos 2 monedas.</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingAccount || !newAccount.name.trim() || (newAccount.type === MULTI && newAccount.pockets.length < 2)}
                className={styles.saveButton}
              >
                {creatingAccount ? 'Creando…' : 'Crear cuenta'}
              </button>
            </form>

            {accountCreated && (
              <p className={styles.hint}>Cuenta "{accountCreated}" creada — ya aparece en la página "Cuentas".</p>
            )}
            </>
            )}

            {activeSection?.key === 'deudas' && (
            <>
            <h3 className={styles.sectionTitle}>Deudas</h3>
            <p className={styles.hint}>
              Registrá una deuda propia o un préstamo que diste — para cuotas, abonos, editar o eliminar una ya
              existente, andá a la página "Deudas".
            </p>

            {newDebt.sourceTransactionId && (
              <p className={styles.hint} style={{ color: 'var(--series-1)' }}>
                Precargado desde un movimiento importado — revisá los datos y confirmá.{' '}
                <button type="button" onClick={() => setNewDebt(emptyNewDebt)} className={styles.archiveLink} style={{ color: 'var(--text-muted)' }}>
                  Cancelar precarga
                </button>
              </p>
            )}

            <form onSubmit={handleCreateDebt} className={styles.createForm} style={{ borderTop: 'none', paddingTop: 0 }}>
              <div className={styles.segmentRow}>
                <button
                  type="button"
                  className={newDebt.direction === 'debo' ? styles.segmentButtonActive : styles.segmentButton}
                  onClick={() => setNewDebt({ ...emptyNewDebt, direction: 'debo' })}
                >
                  Debo
                </button>
                <button
                  type="button"
                  className={newDebt.direction === 'me_deben' ? styles.segmentButtonActive : styles.segmentButton}
                  onClick={() => setNewDebt({ ...emptyNewDebt, direction: 'me_deben' })}
                >
                  Me deben
                </button>
              </div>

              <input
                placeholder={newDebt.direction === 'me_deben' ? 'Nombre de la persona' : 'Acreedor'}
                value={newDebt.creditorName}
                onChange={(e) => setNewDebt({ ...newDebt, creditorName: e.target.value })}
                className={styles.textInput}
              />

              <div className={styles.editFormRow}>
                <input
                  type="number" placeholder={newDebt.direction === 'me_deben' ? 'Monto prestado' : 'Monto total'}
                  value={newDebt.totalAmount} onChange={(e) => setNewDebt({ ...newDebt, totalAmount: e.target.value })}
                  className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                />
                <input
                  type="number" placeholder="Restante" value={newDebt.remainingAmount}
                  onChange={(e) => setNewDebt({ ...newDebt, remainingAmount: e.target.value })}
                  className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                />
                <select
                  value={newDebt.currency} onChange={(e) => setNewDebt({ ...newDebt, currency: e.target.value })}
                  className={styles.textInput} style={{ flex: '0 0 80px' }}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {newDebt.direction === 'me_deben' ? (
                <>
                  <select
                    value={newDebt.counterpartyRelationship}
                    onChange={(e) => setNewDebt({ ...newDebt, counterpartyRelationship: e.target.value })}
                    className={styles.textInput}
                  >
                    <option value="">Relación (opcional)</option>
                    {RELATIONSHIP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input
                    placeholder="Contacto (opcional)" value={newDebt.contactInfo}
                    onChange={(e) => setNewDebt({ ...newDebt, contactInfo: e.target.value })}
                    className={styles.textInput}
                  />
                  <div className={styles.editFormRow}>
                    <input
                      type="date" value={newDebt.startDate}
                      onChange={(e) => setNewDebt({ ...newDebt, startDate: e.target.value })}
                      className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="date" placeholder="Fecha esperada de pago" value={newDebt.expectedPaymentDate}
                      onChange={(e) => setNewDebt({ ...newDebt, expectedPaymentDate: e.target.value })}
                      className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                    />
                  </div>
                  <input
                    placeholder="Motivo / notas (opcional)" value={newDebt.notes}
                    onChange={(e) => setNewDebt({ ...newDebt, notes: e.target.value })}
                    className={styles.textInput}
                  />
                </>
              ) : (
                <>
                  <div className={styles.editFormRow}>
                    <input
                      type="number" placeholder="Cuota mensual (opcional)" value={newDebt.monthlyPayment}
                      onChange={(e) => setNewDebt({ ...newDebt, monthlyPayment: e.target.value })}
                      className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="number" placeholder="Tasa % mensual (opcional)" value={newDebt.interestRate}
                      onChange={(e) => setNewDebt({ ...newDebt, interestRate: e.target.value })}
                      className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                    />
                  </div>
                  <div className={styles.editFormRow}>
                    <input
                      type="number" placeholder="Plazo (# cuotas, opcional)" value={newDebt.termMonths}
                      onChange={(e) => setNewDebt({ ...newDebt, termMonths: e.target.value })}
                      className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="date" value={newDebt.startDate}
                      onChange={(e) => setNewDebt({ ...newDebt, startDate: e.target.value })}
                      className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={creatingDebt || !newDebt.creditorName.trim() || !newDebt.totalAmount || !newDebt.remainingAmount}
                className={styles.saveButton}
              >
                {creatingDebt ? 'Guardando…' : newDebt.direction === 'me_deben' ? 'Registrar préstamo' : 'Agregar deuda'}
              </button>
            </form>

            {debtCreated && (
              <p className={styles.hint}>"{debtCreated}" registrada — ya aparece en la página "Deudas".</p>
            )}
            </>
            )}

            {activeSection?.key === 'metas' && (
            <>
            <h3 className={styles.sectionTitle}>Metas de ahorro</h3>
            <p className={styles.hint}>
              Creá una meta nueva — para aportes, editar o eliminar una ya existente, andá a la página "Metas".
            </p>

            <form onSubmit={handleCreateGoal} className={styles.createForm} style={{ borderTop: 'none', paddingTop: 0 }}>
              <div className={styles.segmentRow}>
                <button
                  type="button"
                  className={newGoal.kind === 'puntual' ? styles.segmentButtonActive : styles.segmentButton}
                  onClick={() => setNewGoal({ ...emptyNewGoal, kind: 'puntual' })}
                >
                  Meta puntual
                </button>
                <button
                  type="button"
                  className={newGoal.kind === 'proposito' ? styles.segmentButtonActive : styles.segmentButton}
                  onClick={() => setNewGoal({ ...emptyNewGoal, kind: 'proposito' })}
                >
                  Ahorro con propósito
                </button>
              </div>

              <input
                placeholder="Nombre" value={newGoal.name}
                onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })}
                className={styles.textInput}
              />

              {newGoal.kind === 'proposito' && (
                <select
                  value={newGoal.accountId} onChange={(e) => setNewGoal({ ...newGoal, accountId: e.target.value })}
                  className={styles.textInput}
                >
                  <option value="">Cuenta vinculada…</option>
                  {accounts.filter((a) => a.kind === 'hija').map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              )}

              <div className={styles.editFormRow}>
                <input
                  type="number" placeholder="Meta $ (opcional)" value={newGoal.targetAmount}
                  onChange={(e) => setNewGoal({ ...newGoal, targetAmount: e.target.value })}
                  className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                />
                <input
                  type="date" value={newGoal.targetDate}
                  onChange={(e) => setNewGoal({ ...newGoal, targetDate: e.target.value })}
                  className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                />
              </div>

              <button type="submit" disabled={creatingGoal || !newGoal.name.trim()} className={styles.saveButton}>
                {creatingGoal ? 'Creando…' : 'Agregar meta'}
              </button>
            </form>

            {goalCreated && (
              <p className={styles.hint}>Meta "{goalCreated}" creada — ya aparece en la página "Metas".</p>
            )}
            </>
            )}

            {activeSection?.key === 'tasas' && (
            <>
            <h3 className={styles.sectionTitle}>Tasas de cambio</h3>
            <p className={styles.hint}>
              1 USD/EUR equivale a cuántos COP (y USD↔EUR) — "Buscar" trae la tasa del día desde una API de tipos de
              cambio real, no de una IA (una tasa de cambio es un dato vivo, no algo que un modelo "sepa" de forma
              confiable). Siempre editable a mano antes de guardar.
            </p>

            {RATE_PAIRS.map(([base, quote]) => {
              const pairKey = `${base}_${quote}`
              const existingRate = rates.find((r) => r.base_currency === base && r.quote_currency === quote)
              return (
                <div key={pairKey} className={styles.editForm} style={{ borderBottom: '1px solid var(--border-hairline)', paddingBottom: 10 }}>
                  <div className={styles.hint} style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>
                    {existingRate ? `1 ${quote} = ${formatByCurrency(existingRate.rate, base)}` : `1 ${quote} = ? ${base} (sin configurar)`}
                  </div>
                  <form onSubmit={(e) => handleSaveRate(e, base, quote)} className={styles.editFormRow}>
                    <input
                      type="number" placeholder={`Ej. ${base === 'COP' ? '4000' : '1.1'}`}
                      value={rateInputs[pairKey] ?? ''}
                      onChange={(e) => setRateInputs({ ...rateInputs, [pairKey]: e.target.value })}
                      className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button" onClick={() => handleFetchLiveRate(base, quote)} disabled={fetchingRatePair === pairKey}
                      className={styles.cancelButton} style={{ border: '1px solid var(--border-hairline)', borderRadius: 10, padding: '0 10px' }}
                    >
                      {fetchingRatePair === pairKey ? 'Buscando…' : 'Buscar'}
                    </button>
                    <button type="submit" disabled={savingRatePair === pairKey || !rateInputs[pairKey]} className={styles.saveButton}>
                      Guardar
                    </button>
                  </form>
                  {rateFetchError[pairKey] && <p className={styles.warning}>{rateFetchError[pairKey]}</p>}
                </div>
              )
            })}
            </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmArchive}
        title={`¿Archivar la categoría "${confirmArchive?.name}"?`}
        message="Se archiva, no se pierde el historial."
        confirmLabel="Archivar"
        destructive
        onConfirm={doArchive}
        onCancel={() => setConfirmArchive(null)}
      />
    </>
  )
}
