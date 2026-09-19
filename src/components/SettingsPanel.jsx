import { useEffect, useState } from 'react'
import { IconSettings, IconClose, IconChevronRight, IconTag, IconHash, IconAccounts, IconDebts, IconGoals, IconExchange, IconExpenses, IconBudget } from './icons.jsx'
import ColorSwatchPicker from './ui/ColorSwatchPicker.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { Field, InfoCard, ChipPicker, Segmented } from './ui/FormKit.jsx'
import { listCategories, createCategory, updateCategory, archiveCategory } from '../lib/categoriesApi.js'
import { backfillPurposeCategoryStats, markLoanTransactionReviewed, isReservedTag } from '../lib/transactionsApi.js'
import { listTags, createTag, deleteTag } from '../lib/tagsApi.js'
import { listAccounts, createAccount, saveMonthlyInitialBalances } from '../lib/accountsApi.js'
import { createDebt } from '../lib/debtsApi.js'
import { createSavingsGoal } from '../lib/savingsApi.js'
import { createFixedExpense } from '../lib/fixedExpensesApi.js'
import { getRates, setRate, fetchLiveRate } from '../lib/exchangeRatesApi.js'
import { getUserSettings, saveUserSettings } from '../lib/userSettingsApi.js'
import { formatByCurrency, CURRENCIES } from '../lib/format.js'
import styles from './SettingsPanel.module.css'

// Un par COP-X por cada moneda no-COP de CURRENCIES (se expande solo si se
// agrega una moneda nueva ahí, ej. DOP/PEN/ARS) más el par especial USD-EUR
// (por arq, que tiene pockets en ambas) — no se deriva de ninguna regla
// general, ya que un USD→EUR real no necesariamente coincide con pivotear
// por COP (ver CLAUDE.md, "Multi-currency"). A diferencia de Cuentas.jsx
// (que solo muestra el par de una moneda si hay una cuenta activa en ella),
// acá se listan todos siempre: es la pantalla de configurar tasas, no una
// vista atada a qué cuentas existen hoy.
const RATE_PAIRS = [...CURRENCIES.filter((c) => c !== 'COP').map((c) => ['COP', c]), ['USD', 'EUR']]

const emptyNewCategory = { name: '', emoji: '', color: '', isAmbiguous: true, monthlyBudget: '' }
const emptyEditDraft = { name: '', emoji: '', color: '', isAmbiguous: true, monthlyBudget: '' }
const MULTI = 'MULTI' // valor del <select> de tipo de cuenta para "multi-moneda"
const emptyNewAccount = { name: '', type: 'COP', pockets: [], draftCurrency: '', draftAmount: '', initialBalance: '' }

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

const emptyNewFixedExpense = { name: '', amount: '', dueDay: '', frequency: 'mensual', accountId: '' }

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: c }))
const ACCOUNT_TYPE_OPTIONS = [...CURRENCY_OPTIONS, { value: MULTI, label: 'Multi-moneda' }]

// Menú raíz de "Ajustes" — una fila por sección, patrón lista de Ajustes de
// iOS (glifo + título + subtítulo + chevron). Agregar una sección nueva es
// agregar una entrada acá con su propio `key` y un bloque de contenido en
// SETTINGS_SECTIONS más abajo — no se agrega nada a esta lista salvo que el
// usuario pida una sección concreta.
const SETTINGS_SECTIONS = [
  { key: 'categorias', label: 'Categorías', subtitle: 'Crear, renombrar, colores, presupuestos', Icon: IconTag },
  { key: 'presupuestos', label: 'Presupuestos', subtitle: 'Alerta de presupuesto por categoría', Icon: IconBudget },
  { key: 'tags', label: 'Tags', subtitle: 'Catálogo de tags para el "+" y el buscador', Icon: IconHash },
  { key: 'cuentas', label: 'Cuentas', subtitle: 'Agregar una cuenta hija, incluida multi-moneda', Icon: IconAccounts },
  { key: 'deudas', label: 'Deudas', subtitle: 'Agregar una deuda o un préstamo dado', Icon: IconDebts },
  { key: 'metas', label: 'Metas de ahorro', subtitle: 'Agregar una meta puntual o con propósito', Icon: IconGoals },
  { key: 'gastos-fijos', label: 'Gastos fijos', subtitle: 'Agregar un gasto fijo recurrente', Icon: IconExpenses },
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

  const [tags, setTags] = useState([])
  const [newTagName, setNewTagName] = useState('')
  const [creatingTag, setCreatingTag] = useState(false)
  const [confirmDeleteTag, setConfirmDeleteTag] = useState(null) // { id, name } | null

  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)

  const [accounts, setAccounts] = useState([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [newAccount, setNewAccount] = useState(emptyNewAccount)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [accountCreated, setAccountCreated] = useState(null) // nombre de la última cuenta creada, o null

  const [newDebt, setNewDebt] = useState(emptyNewDebt)
  const [creatingDebt, setCreatingDebt] = useState(false)
  const [debtCreated, setDebtCreated] = useState(null)

  const [newGoal, setNewGoal] = useState(emptyNewGoal)
  const [creatingGoal, setCreatingGoal] = useState(false)
  const [goalCreated, setGoalCreated] = useState(null)

  const [newFixedExpense, setNewFixedExpense] = useState(emptyNewFixedExpense)
  const [creatingFixedExpense, setCreatingFixedExpense] = useState(false)
  const [fixedExpenseCreated, setFixedExpenseCreated] = useState(null)

  const [rates, setRates] = useState([])
  const [rateInputs, setRateInputs] = useState({}) // "base_quote" -> string
  const [savingRatePair, setSavingRatePair] = useState(null) // "base_quote" | null
  const [fetchingRatePair, setFetchingRatePair] = useState(null) // "base_quote" | null
  const [rateFetchError, setRateFetchError] = useState({}) // "base_quote" -> string | undefined
  const [editingRatePair, setEditingRatePair] = useState('') // "base_quote" en edición, o ''

  const [budgetSettings, setBudgetSettings] = useState({ budgetAlertsEnabled: true, budgetAlertThresholdPct: 100 })
  const [savingBudgetSettings, setSavingBudgetSettings] = useState(false)

  useEffect(() => {
    if (!open) return
    listCategories().then(setCategories).catch((err) => setError(err.message))
    listAccounts().then((accs) => { setAccounts(accs); setAccountsLoaded(true) }).catch((err) => setError(err.message))
    getRates().then(setRates).catch((err) => setError(err.message))
    listTags().then(setTags).catch((err) => setError(err.message))
    getUserSettings().then(setBudgetSettings).catch((err) => setError(err.message))
  }, [open])

  // El toggle persiste al instante (como cualquier otro checkbox de esta
  // app); el slider actualiza el estado local en cada tick (para que el %
  // se vea moverse en vivo) pero solo persiste al soltar (onMouseUp/
  // onTouchEnd) — guardar en cada pixel de arrastre sería una escritura por
  // tick, sin ningún beneficio ya que solo el valor final importa.
  async function persistBudgetSettings(next) {
    setSavingBudgetSettings(true)
    try {
      await saveUserSettings(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingBudgetSettings(false)
    }
  }

  function handleToggleBudgetAlerts(enabled) {
    const next = { ...budgetSettings, budgetAlertsEnabled: enabled }
    setBudgetSettings(next)
    persistBudgetSettings(next)
  }

  function handleThresholdChange(pct) {
    setBudgetSettings((prev) => ({ ...prev, budgetAlertThresholdPct: pct }))
  }

  function handleThresholdCommit(pct) {
    persistBudgetSettings({ ...budgetSettings, budgetAlertThresholdPct: pct })
  }

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
      window.dispatchEvent(new Event('dashboard:accounts-changed'))
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
        monthlyBudget: newCategory.monthlyBudget,
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

  // Alta manual desde Ajustes — el catálogo también crece solo con el uso
  // real (ver tagsApi.ensureTags, llamada desde createManualTransaction /
  // updateTransactionTags), así que esto es un atajo para pre-cargar un tag
  // antes de usarlo, no el único camino para que exista. Bloquea nombres
  // reservados (isReservedTag: IGNORED_TAGS o el nombre de una cuenta hija)
  // porque esos ya tienen un significado especial para el motor de
  // asignación — crearlos como tag "normal" acá sería confuso, no un error
  // técnico real.
  async function handleCreateTag(e) {
    e.preventDefault()
    const trimmed = newTagName.trim()
    if (!trimmed) return
    if (isReservedTag(trimmed, accounts)) {
      setError(`"${trimmed}" ya tiene un significado especial (nombre de cuenta o traslado/ignorar) — elegí otro nombre.`)
      return
    }
    setCreatingTag(true)
    setError(null)
    try {
      const created = await createTag(trimmed)
      setTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created].sort((a, b) => a.name.localeCompare(b.name))))
      setNewTagName('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingTag(false)
    }
  }

  async function doDeleteTag() {
    const target = confirmDeleteTag
    setConfirmDeleteTag(null)
    try {
      await deleteTag(target.id)
      setTags((prev) => prev.filter((t) => t.id !== target.id))
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
    if (!newAccount.name.trim() || !accountsLoaded) return
    if (!isMadreForm && newAccount.type === MULTI && newAccount.pockets.length < 2) return
    const madreId = accounts.find((a) => a.kind === 'madre')?.id ?? null
    setCreatingAccount(true)
    setError(null)
    setAccountCreated(null)
    try {
      if (isMadreForm) {
        // La madre es siempre una sola cuenta COP (el ritual mensual
        // madre→hijas la asume así) — sin multi-moneda ni cuenta padre.
        await createAccount({
          name: newAccount.name.trim(), kind: 'madre', parentAccountId: null, currency: 'COP',
          initialBalance: newAccount.initialBalance,
        })
      } else if (newAccount.type === MULTI) {
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
        await createAccount({
          name: newAccount.name.trim(), kind: 'hija', parentAccountId: madreId, currency: newAccount.type,
          initialBalance: newAccount.initialBalance,
        })
      }
      setAccountCreated(newAccount.name.trim())
      setNewAccount(emptyNewAccount)
      // Sin esto hasMadre sigue en false hasta reabrir el panel y se podría
      // crear una segunda madre; además avisa a Panel/Cuentas/"+" del cambio.
      setAccounts(await listAccounts())
      window.dispatchEvent(new Event('dashboard:accounts-changed'))
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

  async function handleCreateFixedExpense(e) {
    e.preventDefault()
    if (!newFixedExpense.name.trim() || !newFixedExpense.amount || !newFixedExpense.dueDay) return
    setCreatingFixedExpense(true)
    setError(null)
    setFixedExpenseCreated(null)
    try {
      const currency = accounts.find((a) => a.id === newFixedExpense.accountId)?.currency || 'COP'
      await createFixedExpense({
        name: newFixedExpense.name.trim(), amount: Number(newFixedExpense.amount), dueDay: Number(newFixedExpense.dueDay),
        frequency: newFixedExpense.frequency, accountId: newFixedExpense.accountId || null, currency,
      })
      setFixedExpenseCreated(newFixedExpense.name.trim())
      setNewFixedExpense(emptyNewFixedExpense)
      window.dispatchEvent(new Event('dashboard:fixed-expenses-changed'))
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingFixedExpense(false)
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
      setEditingRatePair('')
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

  // Dispatchea siempre, no solo cuando vino de QuickCaptureFAB — es un
  // evento genérico "Ajustes se cerró"; QuickCaptureFAB es hoy el único
  // listener (para retomar el movimiento a medio llenar si el "+" mandó acá
  // a crear una categoría, ver handleCreateCategoryClick), pero cualquier
  // otro consumidor futuro puede escucharlo igual.
  function close() {
    setOpen(false)
    setSection(null)
    setEditingId('')
    setEditingRatePair('')
    setError(null)
    window.dispatchEvent(new Event('dashboard:settings-closed'))
  }

  const activeSection = SETTINGS_SECTIONS.find((s) => s.key === section)
  const hasMadre = accounts.some((a) => a.kind === 'madre')
  // Sin madre solo se puede crear la madre: una hija sin madre no tendría de
  // dónde recibir su distribución mensual.
  const isMadreForm = accountsLoaded && !hasMadre
  const fixedExpenseCurrency = accounts.find((a) => a.id === newFixedExpense.accountId)?.currency || 'COP'

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
                <div
                  key={c.id}
                  className={editingId === c.id ? styles.row : `${styles.row} ${styles.rowClickable}`}
                  onClick={editingId === c.id ? undefined : () => startEdit(c.id)}
                >
                  {editingId === c.id ? (
                    <div className={`${styles.editForm} ${styles.categoryEditCard}`}>
                      <div className={styles.categoryEditHeader}>
                        <span
                          className={styles.categoryEditAvatar}
                          style={editDraft.color ? { background: editDraft.color } : undefined}
                        >
                          {editDraft.emoji || editDraft.name.charAt(0).toUpperCase() || '?'}
                        </span>
                        <div className={styles.categoryFieldGroup}>
                          <span className={styles.categoryLabel}>Nombre de la categoría</span>
                          <input
                            value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            className={styles.textInput} placeholder="Ej. Ocio, Mercado, Transporte"
                          />
                        </div>
                      </div>

                      <div className={styles.categoryFieldGroup}>
                        <span className={styles.categoryLabel}>Emoji y color</span>
                        <div className={styles.editFormRow}>
                          <input
                            value={editDraft.emoji} maxLength={4}
                            onChange={(e) => setEditDraft({ ...editDraft, emoji: e.target.value })}
                            className={styles.emojiInput} placeholder="Emoji"
                          />
                          <ColorSwatchPicker value={editDraft.color} onChange={(color) => setEditDraft({ ...editDraft, color })} />
                        </div>
                      </div>

                      <div className={`${styles.categoryFieldGroup} ${styles.categoryEditBudgetGroup}`}>
                        <div className={styles.categoryLabelRow}>
                          <span className={styles.categoryLabel}>Presupuesto mensual (opcional)</span>
                          <span className={styles.categoryLabelHint}>En pesos (COP)</span>
                        </div>
                        <input
                          type="number" min="0" value={editDraft.monthlyBudget}
                          onChange={(e) => setEditDraft({ ...editDraft, monthlyBudget: e.target.value })}
                          className={styles.textInput} placeholder="0"
                        />
                        <div className={styles.categoryBudgetPresets}>
                          {[50000, 100000, 200000].map((amount) => (
                            <button
                              key={amount} type="button"
                              onClick={() => setEditDraft({ ...editDraft, monthlyBudget: String((Number(editDraft.monthlyBudget) || 0) + amount) })}
                              className={styles.categoryBudgetPresetButton}
                            >
                              +{formatByCurrency(amount, 'COP')}
                            </button>
                          ))}
                          {editDraft.monthlyBudget !== '' && (
                            <button
                              type="button" onClick={() => setEditDraft({ ...editDraft, monthlyBudget: '' })}
                              className={styles.categoryBudgetClear}
                            >
                              Limpiar
                            </button>
                          )}
                        </div>
                        <p className={styles.categoryInfoCard}>
                          Se compara contra el gasto real del mes en "Presupuesto por categoría" (Gastos)
                          y en los chips de Diario, y avisa en Panel si te pasás.
                        </p>
                      </div>

                      <label className={styles.categoryAmbiguousRow}>
                        <span className={styles.categoryFieldGroup}>
                          <span className={styles.categoryLabel}>Categoría ambigua</span>
                          <span className={styles.categoryHelperText}>
                            Dejala marcada si puede pagarse desde distintas cuentas. Desmarcala solo si
                            sabés que siempre sale de la misma (ej. Suscripciones).
                          </span>
                        </span>
                        <span className={styles.switchTrack}>
                          <input
                            type="checkbox" checked={editDraft.isAmbiguous}
                            onChange={(e) => setEditDraft({ ...editDraft, isAmbiguous: e.target.checked })}
                            className={styles.switchInput}
                          />
                          <span className={styles.switchTrackBg} />
                          <span className={styles.switchThumb} />
                        </span>
                      </label>

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
                        className={styles.categoryGlyph}
                        style={c.color ? { background: c.color } : undefined}
                      >
                        {c.emoji || c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className={styles.categoryRowText}>
                        <span className={styles.categoryRowName}>{c.name}</span>
                        {c.monthly_budget != null && (
                          <span className={styles.categoryRowSubtitle}>{formatByCurrency(Number(c.monthly_budget), 'COP')}/mes</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirmArchive({ id: c.id, name: c.name }) }}
                        className={styles.archiveLink}
                      >
                        Archivar
                      </button>
                    </>
                  )}
                </div>
              ))}
              {categories.length === 0 && <p className={styles.hint}>No hay categorías todavía.</p>}
            </div>

            <form onSubmit={handleCreate} className={`${styles.createForm} ${styles.categoryEditCard}`}>
              <span className={styles.hint} style={{ margin: 0 }}>+ Nueva categoría</span>
              <div className={styles.categoryFieldGroup}>
                <span className={styles.categoryLabel}>Nombre de la categoría</span>
                <input
                  placeholder="Ej. Ocio, Mercado, Transporte" value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  className={styles.textInput}
                />
              </div>
              <div className={styles.categoryFieldGroup}>
                <span className={styles.categoryLabel}>Emoji (obligatorio) y color</span>
                <div className={styles.editFormRow}>
                  <input
                    placeholder="Emoji" value={newCategory.emoji} maxLength={4}
                    onChange={(e) => setNewCategory({ ...newCategory, emoji: e.target.value })}
                    className={styles.emojiInput}
                  />
                  <ColorSwatchPicker value={newCategory.color} onChange={(color) => setNewCategory({ ...newCategory, color })} />
                </div>
              </div>
              <div className={`${styles.categoryFieldGroup} ${styles.categoryEditBudgetGroup}`}>
                <div className={styles.categoryLabelRow}>
                  <span className={styles.categoryLabel}>Presupuesto mensual (opcional)</span>
                  <span className={styles.categoryLabelHint}>En pesos (COP)</span>
                </div>
                <input
                  type="number" min="0" placeholder="0" value={newCategory.monthlyBudget}
                  onChange={(e) => setNewCategory({ ...newCategory, monthlyBudget: e.target.value })}
                  className={styles.textInput}
                />
                <div className={styles.categoryBudgetPresets}>
                  {[50000, 100000, 200000].map((amount) => (
                    <button
                      key={amount} type="button"
                      onClick={() => setNewCategory({ ...newCategory, monthlyBudget: String((Number(newCategory.monthlyBudget) || 0) + amount) })}
                      className={styles.categoryBudgetPresetButton}
                    >
                      +{formatByCurrency(amount, 'COP')}
                    </button>
                  ))}
                  {newCategory.monthlyBudget !== '' && (
                    <button
                      type="button" onClick={() => setNewCategory({ ...newCategory, monthlyBudget: '' })}
                      className={styles.categoryBudgetClear}
                    >
                      Limpiar
                    </button>
                  )}
                </div>
                <p className={styles.categoryInfoCard}>
                  Se compara contra el gasto real del mes en "Presupuesto por categoría" (Gastos) y en
                  los chips de Diario, y avisa en Panel si te pasás — se puede dejar en blanco y
                  definirlo después tocando la categoría.
                </p>
              </div>
              <label className={styles.categoryAmbiguousRow}>
                <span className={styles.categoryFieldGroup}>
                  <span className={styles.categoryLabel}>Categoría ambigua</span>
                  <span className={styles.categoryHelperText}>
                    Dejala marcada si puede pagarse desde distintas cuentas. Desmarcala solo si sabés que
                    siempre sale de la misma (ej. Suscripciones).
                  </span>
                </span>
                <span className={styles.switchTrack}>
                  <input
                    type="checkbox" checked={newCategory.isAmbiguous}
                    onChange={(e) => setNewCategory({ ...newCategory, isAmbiguous: e.target.checked })}
                    className={styles.switchInput}
                  />
                  <span className={styles.switchTrackBg} />
                  <span className={styles.switchThumb} />
                </span>
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

            {activeSection?.key === 'presupuestos' && (
            <>
            <h3 className={styles.sectionTitle}>Presupuestos</h3>
            <p className={styles.hint}>
              Configurá cuándo avisarte que una categoría se está acercando a su presupuesto mensual, y
              revisá de un vistazo cuáles ya tienen uno.
            </p>

            <div className={styles.categoryAmbiguousRow} style={{ marginBottom: 'var(--space-2)' }}>
              <span className={styles.categoryFieldGroup}>
                <span className={styles.categoryRowName}>Alertas de presupuesto</span>
                <span className={styles.categoryHelperText}>
                  Avisa en el Panel general cuando una categoría llegue al umbral de abajo.
                </span>
              </span>
              <span className={styles.switchTrack}>
                <input
                  type="checkbox" checked={budgetSettings.budgetAlertsEnabled}
                  onChange={(e) => handleToggleBudgetAlerts(e.target.checked)}
                  className={styles.switchInput}
                />
                <span className={styles.switchTrackBg} />
                <span className={styles.switchThumb} />
              </span>
            </div>

            {budgetSettings.budgetAlertsEnabled && (
              <div className={styles.categoryFieldGroup} style={{ marginBottom: 'var(--space-2)' }}>
                <div className={styles.categoryLabelRow}>
                  <span className={styles.categoryLabel}>Umbral de alerta</span>
                  <span className={styles.categoryLabelHint}>{budgetSettings.budgetAlertThresholdPct}%</span>
                </div>
                <input
                  type="range" min="50" max="100" step="5"
                  value={budgetSettings.budgetAlertThresholdPct}
                  onChange={(e) => handleThresholdChange(Number(e.target.value))}
                  onMouseUp={(e) => handleThresholdCommit(Number(e.target.value))}
                  onTouchEnd={(e) => handleThresholdCommit(Number(e.target.value))}
                  className={styles.rangeInput}
                />
                <p className={styles.categoryInfoCard}>
                  Avisa cuando el gasto real de una categoría llegue al {budgetSettings.budgetAlertThresholdPct}%
                  de su presupuesto — no hace falta esperar a pasarte del 100% para enterarte.
                  {savingBudgetSettings ? ' Guardando…' : ''}
                </p>
              </div>
            )}

            <span className={styles.categoryLabel} style={{ display: 'block', margin: '0 0 4px' }}>Categorías</span>
            <div className={styles.list}>
              {categories.map((c) => (
                <div
                  key={c.id}
                  className={`${styles.row} ${styles.rowClickable}`}
                  onClick={() => { setSection('categorias'); startEdit(c.id) }}
                >
                  <span className={styles.categoryGlyph} style={c.color ? { background: c.color } : undefined}>
                    {c.emoji || c.name.charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.categoryRowText}>
                    <span className={styles.categoryRowName}>{c.name}</span>
                    <span className={styles.categoryRowSubtitle}>
                      {c.monthly_budget != null ? `${formatByCurrency(Number(c.monthly_budget), 'COP')}/mes` : 'Sin presupuesto establecido'}
                    </span>
                  </span>
                  <IconChevronRight width={18} height={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </div>
              ))}
              {categories.length === 0 && <p className={styles.hint}>No hay categorías todavía.</p>}
            </div>
            </>
            )}

            {activeSection?.key === 'tags' && (
            <>
            <h3 className={styles.sectionTitle}>Tags</h3>
            <p className={styles.hint}>
              El catálogo se completa solo con lo que vayas usando en el "+" o al importar el CSV de MonIA — esto es
              solo un atajo para precargar uno antes de usarlo, o para sacar uno que ya no hace falta.
            </p>

            <div className={styles.tagCloud}>
              {tags.map((t) => (
                <button
                  key={t.id} type="button"
                  onClick={() => setConfirmDeleteTag({ id: t.id, name: t.name })}
                  className={styles.tagPill}
                  title="Tocar para eliminar"
                >
                  #{t.name}
                </button>
              ))}
              {tags.length === 0 && <p className={styles.hint}>No hay tags todavía.</p>}
            </div>

            <form onSubmit={handleCreateTag} className={styles.createForm}>
              <span className={styles.hint}>+ Nuevo tag</span>
              <input
                placeholder="#Nueva etiqueta" value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className={styles.textInput}
              />
              <button type="submit" disabled={creatingTag || !newTagName.trim()} className={styles.saveButton}>
                Crear
              </button>
            </form>
            </>
            )}

            {activeSection?.key === 'cuentas' && (
            <>
            <h3 className={styles.sectionTitle}>Cuentas</h3>
            <p className={styles.hint}>
              {isMadreForm
                ? 'Empieza creando tu cuenta madre: es la cuenta desde la que repartes tu plata cada mes hacia las hijas. Solo hay una y siempre es en COP.'
                : 'Crea una cuenta hija nueva — para renombrar, archivar o editar saldos de una ya existente, ve a la página "Cuentas".'}
            </p>

            <form onSubmit={handleCreateAccount} className={`${styles.editForm} ${styles.categoryEditCard}`}>
              <div className={styles.categoryEditHeader}>
                <span className={`${styles.categoryEditAvatar} ${styles.avatarAccent}`}>
                  {newAccount.name.trim() ? newAccount.name.trim().charAt(0).toUpperCase() : <IconAccounts width={26} height={26} />}
                </span>
                <Field label={isMadreForm ? 'Nombre de la cuenta madre' : 'Nombre de la cuenta'}>
                  <input
                    placeholder={isMadreForm ? 'Ej. Mi banco principal' : 'Ej. Billetera, Efectivo, Ahorros'} value={newAccount.name}
                    onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
              </div>

              {!isMadreForm && (
                <Field label="Moneda">
                  <ChipPicker
                    options={ACCOUNT_TYPE_OPTIONS} value={newAccount.type}
                    onChange={(type) => setNewAccount({ ...newAccount, type, pockets: [], draftCurrency: '', draftAmount: '' })}
                  />
                </Field>
              )}

              {(isMadreForm || newAccount.type !== MULTI) && (
                <div className={`${styles.categoryFieldGroup} ${styles.categoryEditBudgetGroup}`}>
                  <Field label="Saldo inicial (opcional)" hint={`En ${isMadreForm ? 'COP' : newAccount.type}`}>
                    <input
                      type="number" step="any" placeholder="0" value={newAccount.initialBalance}
                      onChange={(e) => setNewAccount({ ...newAccount, initialBalance: e.target.value })}
                      className={styles.textInput}
                    />
                  </Field>
                  <InfoCard>
                    Se carga una sola vez, al crear la cuenta — después el saldo se calcula solo con tus movimientos
                    y transferencias.
                  </InfoCard>
                </div>
              )}

              {!isMadreForm && newAccount.type === MULTI && (
                <div className={`${styles.categoryFieldGroup} ${styles.categoryEditBudgetGroup}`}>
                  <div className={styles.categoryLabelRow}>
                    <span className={styles.categoryLabel}>Monedas de la cuenta</span>
                    <span className={styles.categoryLabelHint}>Mínimo 2</span>
                  </div>

                  {newAccount.pockets.length > 0 && (
                    <div className={styles.pocketList}>
                      {newAccount.pockets.map((p, i) => (
                        <div key={p.currency} className={styles.pocketRow}>
                          <span className={styles.pocketCode}>{p.currency}</span>
                          {i === 0 && <span className={styles.pocketBadge}>Principal</span>}
                          <span className={styles.pocketAmount}>
                            {p.amount ? formatByCurrency(Number(p.amount), p.currency) : 'Sin saldo inicial'}
                          </span>
                          <button type="button" onClick={() => removePocketFromNewAccount(p.currency)} className={styles.archiveLink}>
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <span className={styles.categoryHelperText}>Tocá una moneda para agregarla.</span>
                  <ChipPicker
                    options={CURRENCIES.filter((c) => !newAccount.pockets.some((p) => p.currency === c)).map((c) => ({ value: c, label: c }))}
                    value={newAccount.draftCurrency} allowClear
                    onChange={(draftCurrency) => setNewAccount({ ...newAccount, draftCurrency })}
                  />

                  {newAccount.draftCurrency && (
                    <div className={styles.editFormRow}>
                      <input
                        type="number" step="any" placeholder={`Cuánto tiene en ${newAccount.draftCurrency} (opcional)`}
                        value={newAccount.draftAmount}
                        onChange={(e) => setNewAccount({ ...newAccount, draftAmount: e.target.value })}
                        className={styles.textInput} style={{ flex: 1, minWidth: 0 }}
                      />
                      <button type="button" onClick={addPocketToNewAccount} className={styles.saveButton} style={{ flexShrink: 0 }}>
                        Agregar
                      </button>
                    </div>
                  )}

                  <InfoCard>
                    La primera moneda que agregues es la principal de la cuenta. Lo que escribas como "cuánto tiene"
                    se carga como saldo inicial de este mes.
                  </InfoCard>
                  {newAccount.pockets.length < 2 && (
                    <p className={styles.warning}>Agregá al menos 2 monedas.</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingAccount || !accountsLoaded || !newAccount.name.trim() || (!isMadreForm && newAccount.type === MULTI && newAccount.pockets.length < 2)}
                className={styles.saveButton}
              >
                {creatingAccount ? 'Creando…' : isMadreForm ? 'Crear cuenta madre' : 'Crear cuenta'}
              </button>
            </form>

            {accountCreated && (
              <p className={styles.successCard}>Cuenta "{accountCreated}" creada — ya la puedes ver en la página "Cuentas".</p>
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

            <form onSubmit={handleCreateDebt} className={`${styles.editForm} ${styles.categoryEditCard}`}>
              {newDebt.sourceTransactionId && (
                <InfoCard>
                  Precargado desde un movimiento importado — revisá los datos y confirmá.{' '}
                  <button type="button" onClick={() => setNewDebt(emptyNewDebt)} className={styles.archiveLink}>
                    Cancelar precarga
                  </button>
                </InfoCard>
              )}

              <Segmented
                options={[{ value: 'debo', label: 'Debo' }, { value: 'me_deben', label: 'Me deben' }]}
                value={newDebt.direction}
                onChange={(direction) => setNewDebt({ ...emptyNewDebt, direction })}
              />

              <div className={styles.categoryEditHeader}>
                <span className={`${styles.categoryEditAvatar} ${newDebt.direction === 'me_deben' ? styles.avatarGood : styles.avatarCritical}`}>
                  {newDebt.creditorName.trim() ? newDebt.creditorName.trim().charAt(0).toUpperCase() : <IconDebts width={26} height={26} />}
                </span>
                <Field label={newDebt.direction === 'me_deben' ? 'Nombre de la persona' : 'Acreedor'}>
                  <input
                    placeholder={newDebt.direction === 'me_deben' ? 'Ej. Juan' : 'Ej. Banco, tarjeta, familiar'}
                    value={newDebt.creditorName}
                    onChange={(e) => setNewDebt({ ...newDebt, creditorName: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
              </div>

              <div className={styles.fieldRow}>
                <Field label={newDebt.direction === 'me_deben' ? 'Monto prestado' : 'Monto total'}>
                  <input
                    type="number" step="any" placeholder="0" value={newDebt.totalAmount}
                    onChange={(e) => setNewDebt({ ...newDebt, totalAmount: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
                <Field label="Restante">
                  <input
                    type="number" step="any" placeholder="0" value={newDebt.remainingAmount}
                    onChange={(e) => setNewDebt({ ...newDebt, remainingAmount: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
              </div>

              <Field label="Moneda" hint="No se puede cambiar después">
                <ChipPicker
                  options={CURRENCY_OPTIONS} value={newDebt.currency}
                  onChange={(currency) => setNewDebt({ ...newDebt, currency })}
                />
              </Field>

              <details
                key={`${newDebt.direction}-${newDebt.sourceTransactionId ?? ''}`}
                className={styles.optionalBlock} open={newDebt.sourceTransactionId ? true : undefined}
              >
                <summary className={styles.optionalSummary}>
                  <span className={styles.categoryLabel}>
                    {newDebt.direction === 'me_deben' ? 'Contacto y fechas (opcional)' : 'Cuotas e intereses (opcional)'}
                  </span>
                  <IconChevronRight width={16} height={16} className={styles.optionalChevron} />
                </summary>

                <div className={styles.optionalBody}>
                  {newDebt.direction === 'me_deben' ? (
                    <>
                      <Field label="Relación">
                        <ChipPicker
                          options={RELATIONSHIP_OPTIONS} value={newDebt.counterpartyRelationship} allowClear
                          onChange={(counterpartyRelationship) => setNewDebt({ ...newDebt, counterpartyRelationship })}
                        />
                      </Field>
                      <Field label="Contacto">
                        <input
                          placeholder="Teléfono, correo…" value={newDebt.contactInfo}
                          onChange={(e) => setNewDebt({ ...newDebt, contactInfo: e.target.value })}
                          className={styles.textInput}
                        />
                      </Field>
                      <div className={styles.fieldRow}>
                        <Field label="Fecha del préstamo">
                          <input
                            type="date" value={newDebt.startDate}
                            onChange={(e) => setNewDebt({ ...newDebt, startDate: e.target.value })}
                            className={styles.textInput}
                          />
                        </Field>
                        <Field label="Pago esperado">
                          <input
                            type="date" value={newDebt.expectedPaymentDate}
                            onChange={(e) => setNewDebt({ ...newDebt, expectedPaymentDate: e.target.value })}
                            className={styles.textInput}
                          />
                        </Field>
                      </div>
                      <Field label="Motivo o notas">
                        <input
                          placeholder="Para qué fue" value={newDebt.notes}
                          onChange={(e) => setNewDebt({ ...newDebt, notes: e.target.value })}
                          className={styles.textInput}
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <div className={styles.fieldRow}>
                        <Field label="Cuota mensual">
                          <input
                            type="number" step="any" placeholder="0" value={newDebt.monthlyPayment}
                            onChange={(e) => setNewDebt({ ...newDebt, monthlyPayment: e.target.value })}
                            className={styles.textInput}
                          />
                        </Field>
                        <Field label="Tasa % mensual">
                          <input
                            type="number" step="any" placeholder="0" value={newDebt.interestRate}
                            onChange={(e) => setNewDebt({ ...newDebt, interestRate: e.target.value })}
                            className={styles.textInput}
                          />
                        </Field>
                      </div>
                      <div className={styles.fieldRow}>
                        <Field label="Plazo (# cuotas)">
                          <input
                            type="number" step="1" placeholder="0" value={newDebt.termMonths}
                            onChange={(e) => setNewDebt({ ...newDebt, termMonths: e.target.value })}
                            className={styles.textInput}
                          />
                        </Field>
                        <Field label="Fecha de inicio">
                          <input
                            type="date" value={newDebt.startDate}
                            onChange={(e) => setNewDebt({ ...newDebt, startDate: e.target.value })}
                            className={styles.textInput}
                          />
                        </Field>
                      </div>
                      <InfoCard>
                        Con tasa y plazo, la página "Deudas" genera sola el calendario de cuotas.
                      </InfoCard>
                    </>
                  )}
                </div>
              </details>

              <button
                type="submit"
                disabled={creatingDebt || !newDebt.creditorName.trim() || !newDebt.totalAmount || !newDebt.remainingAmount}
                className={styles.saveButton}
              >
                {creatingDebt ? 'Guardando…' : newDebt.direction === 'me_deben' ? 'Registrar préstamo' : 'Agregar deuda'}
              </button>
            </form>

            {debtCreated && (
              <p className={styles.successCard}>"{debtCreated}" registrada — ya aparece en la página "Deudas".</p>
            )}
            </>
            )}

            {activeSection?.key === 'metas' && (
            <>
            <h3 className={styles.sectionTitle}>Metas de ahorro</h3>
            <p className={styles.hint}>
              Creá una meta nueva — para aportes, editar o eliminar una ya existente, andá a la página "Metas".
            </p>

            <form onSubmit={handleCreateGoal} className={`${styles.editForm} ${styles.categoryEditCard}`}>
              <Segmented
                options={[{ value: 'puntual', label: 'Meta puntual' }, { value: 'proposito', label: 'Ahorro con propósito' }]}
                value={newGoal.kind}
                onChange={(kind) => setNewGoal({ ...emptyNewGoal, kind })}
              />
              <InfoCard>
                {newGoal.kind === 'puntual'
                  ? 'El progreso es la suma de los aportes que vayas registrando en la página "Metas".'
                  : 'El progreso es el saldo real de la cuenta vinculada — no hace falta registrar aportes.'}
              </InfoCard>

              <div className={styles.categoryEditHeader}>
                <span className={`${styles.categoryEditAvatar} ${styles.avatarAccent}`}>
                  {newGoal.name.trim() ? newGoal.name.trim().charAt(0).toUpperCase() : <IconGoals width={26} height={26} />}
                </span>
                <Field label="Nombre de la meta">
                  <input
                    placeholder="Ej. Viaje, fondo de emergencia" value={newGoal.name}
                    onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
              </div>

              {newGoal.kind === 'proposito' && (
                <Field label="Cuenta vinculada">
                  <ChipPicker
                    options={accounts.filter((a) => a.kind === 'hija').map((h) => ({ value: h.id, label: h.name }))}
                    value={newGoal.accountId} allowClear
                    onChange={(accountId) => setNewGoal({ ...newGoal, accountId })}
                  />
                </Field>
              )}

              <div className={styles.fieldRow}>
                <Field label="Meta (opcional)">
                  <input
                    type="number" step="any" placeholder="0" value={newGoal.targetAmount}
                    onChange={(e) => setNewGoal({ ...newGoal, targetAmount: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
                <Field label="Fecha objetivo">
                  <input
                    type="date" value={newGoal.targetDate}
                    onChange={(e) => setNewGoal({ ...newGoal, targetDate: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
              </div>
              <InfoCard>
                Con monto y fecha, en "Metas" ves el ritmo planeado contra lo aportado.
              </InfoCard>

              <button type="submit" disabled={creatingGoal || !newGoal.name.trim()} className={styles.saveButton}>
                {creatingGoal ? 'Creando…' : 'Agregar meta'}
              </button>
            </form>

            {goalCreated && (
              <p className={styles.successCard}>Meta "{goalCreated}" creada — ya aparece en la página "Metas".</p>
            )}
            </>
            )}

            {activeSection?.key === 'gastos-fijos' && (
            <>
            <h3 className={styles.sectionTitle}>Gastos fijos</h3>
            <p className={styles.hint}>
              Creá un gasto fijo recurrente nuevo — para editar, marcar pagado o archivar uno ya existente, andá a la
              página "Cuentas".
            </p>

            <form onSubmit={handleCreateFixedExpense} className={`${styles.editForm} ${styles.categoryEditCard}`}>
              <div className={styles.categoryEditHeader}>
                <span className={`${styles.categoryEditAvatar} ${styles.avatarAccent}`}>
                  {newFixedExpense.name.trim() ? newFixedExpense.name.trim().charAt(0).toUpperCase() : <IconExpenses width={26} height={26} />}
                </span>
                <Field label="Nombre del gasto">
                  <input
                    placeholder="Ej. Netflix, arriendo, internet" value={newFixedExpense.name}
                    onChange={(e) => setNewFixedExpense({ ...newFixedExpense, name: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
              </div>

              <div className={styles.fieldRow}>
                <Field label="Monto" hint={`En ${fixedExpenseCurrency}`}>
                  <input
                    type="number" step="any" placeholder="0" value={newFixedExpense.amount}
                    onChange={(e) => setNewFixedExpense({ ...newFixedExpense, amount: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
                <Field label="Día del mes">
                  <input
                    type="number" min="1" max="31" step="1" placeholder="1–31" value={newFixedExpense.dueDay}
                    onChange={(e) => setNewFixedExpense({ ...newFixedExpense, dueDay: e.target.value })}
                    className={styles.textInput}
                  />
                </Field>
              </div>

              <Field label="Frecuencia">
                <Segmented
                  options={[{ value: 'mensual', label: 'Mensual' }, { value: 'anual', label: 'Anual' }]}
                  value={newFixedExpense.frequency}
                  onChange={(frequency) => setNewFixedExpense({ ...newFixedExpense, frequency })}
                />
              </Field>

              <Field label="Cuenta" hint="Opcional">
                <ChipPicker
                  options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                  value={newFixedExpense.accountId} allowClear
                  onChange={(accountId) => setNewFixedExpense({ ...newFixedExpense, accountId })}
                />
              </Field>
              <InfoCard>
                Aparece en "Próximos pagos" del Panel y avisa cuando falten pocos días para su vencimiento. La
                moneda sale de la cuenta que elijas.
              </InfoCard>

              <button
                type="submit"
                disabled={creatingFixedExpense || !newFixedExpense.name.trim() || !newFixedExpense.amount || !newFixedExpense.dueDay}
                className={styles.saveButton}
              >
                {creatingFixedExpense ? 'Creando…' : 'Agregar gasto fijo'}
              </button>
            </form>

            {fixedExpenseCreated && (
              <p className={styles.successCard}>"{fixedExpenseCreated}" creado — ya aparece en la página "Cuentas".</p>
            )}
            </>
            )}

            {activeSection?.key === 'tasas' && (
            <>
            <h3 className={styles.sectionTitle}>Tasas de cambio</h3>
            <p className={styles.hint}>
              Cuántos COP vale 1 USD/EUR (y USD↔EUR). Tocá una tasa para editarla.
            </p>

            <div className={styles.list}>
              {RATE_PAIRS.map(([base, quote]) => {
                const pairKey = `${base}_${quote}`
                const existingRate = rates.find((r) => r.base_currency === base && r.quote_currency === quote)
                const isEditing = editingRatePair === pairKey
                return (
                  <div
                    key={pairKey}
                    className={isEditing ? styles.row : `${styles.row} ${styles.rowClickable}`}
                    onClick={isEditing ? undefined : () => setEditingRatePair(pairKey)}
                  >
                    {isEditing ? (
                      <form onSubmit={(e) => handleSaveRate(e, base, quote)} className={`${styles.editForm} ${styles.categoryEditCard}`}>
                        <div className={styles.categoryEditHeader}>
                          <span className={`${styles.categoryEditAvatar} ${styles.avatarAccent} ${styles.glyphCode}`}>{quote}</span>
                          <div className={styles.categoryFieldGroup}>
                            <span className={styles.categoryRowName}>1 {quote}</span>
                            <span className={existingRate ? styles.categoryRowSubtitle : styles.rateUnset}>
                              {existingRate ? `= ${formatByCurrency(existingRate.rate, base)}` : 'Sin configurar'}
                            </span>
                          </div>
                        </div>

                        <Field label="Nueva tasa" hint={`${base} por 1 ${quote}`}>
                          <input
                            type="number" step="any" placeholder={`Ej. ${base === 'COP' ? '4000' : '1.1'}`}
                            value={rateInputs[pairKey] ?? ''} autoFocus
                            onChange={(e) => setRateInputs({ ...rateInputs, [pairKey]: e.target.value })}
                            className={styles.textInput}
                          />
                          <div className={styles.categoryBudgetPresets}>
                            <button
                              type="button" onClick={() => handleFetchLiveRate(base, quote)} disabled={fetchingRatePair === pairKey}
                              className={styles.categoryBudgetPresetButton}
                            >
                              {fetchingRatePair === pairKey ? 'Buscando…' : 'Buscar tasa de hoy'}
                            </button>
                          </div>
                          {rateFetchError[pairKey] && <p className={styles.warning}>{rateFetchError[pairKey]}</p>}
                        </Field>

                        <InfoCard>
                          "Buscar" trae la tasa del día desde una API de tipos de cambio (no de una IA) y solo rellena
                          el campo — revisala y tocá Guardar.
                        </InfoCard>

                        <div className={styles.rowActions}>
                          <button type="submit" disabled={savingRatePair === pairKey || !rateInputs[pairKey]} className={styles.saveButton}>
                            Guardar
                          </button>
                          <button
                            type="button" className={styles.cancelButton}
                            onClick={() => { setEditingRatePair(''); setRateInputs({ ...rateInputs, [pairKey]: '' }) }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <span className={`${styles.categoryGlyph} ${styles.avatarAccent} ${styles.glyphCode}`}>{quote}</span>
                        <span className={styles.categoryRowText}>
                          <span className={styles.categoryRowName}>1 {quote}</span>
                          <span className={existingRate ? styles.categoryRowSubtitle : styles.rateUnset}>
                            {existingRate ? `= ${formatByCurrency(existingRate.rate, base)}` : 'Sin configurar'}
                          </span>
                        </span>
                        <IconChevronRight width={18} height={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      </>
                    )}
                  </div>
                )
              })}
            </div>
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

      <ConfirmDialog
        open={!!confirmDeleteTag}
        title={`¿Eliminar el tag "#${confirmDeleteTag?.name}"?`}
        message="Solo sale del catálogo de autocompletado — los movimientos que ya lo tienen no cambian, y se vuelve a crear solo si lo volvés a usar."
        confirmLabel="Eliminar"
        destructive
        onConfirm={doDeleteTag}
        onCancel={() => setConfirmDeleteTag(null)}
      />
    </>
  )
}
