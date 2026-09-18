import { useEffect, useRef, useState } from 'react'
import { IconPlus, IconClose, IconMic, IconSearch, IconCamera } from './icons.jsx'
import CategoryEmojiGrid from './CategoryEmojiGrid.jsx'
import { listAccounts, fetchBalancesForMonth } from '../lib/accountsApi.js'
import { listCategories } from '../lib/categoriesApi.js'
import { createManualTransaction, suggestCategoryForPurpose, listRecentPurposes } from '../lib/transactionsApi.js'
import { createTransfers } from '../lib/transfersApi.js'
import { getRates, convertAmount } from '../lib/exchangeRatesApi.js'
import { flattenAccountPockets } from '../lib/currencyPockets.js'
import { resizeImageFileToBase64 } from '../lib/imageUtils.js'
import { formatByCurrency, formatCOP } from '../lib/format.js'
import { supabase } from '../lib/supabaseClient.js'
import styles from './QuickCaptureFAB.module.css'

// Mismo ciclo fijo de colores categóricos que usa PanelGeneral.jsx para
// "Distribución por cuenta" — acá identifica cada cuenta con un avatar de
// color en el selector, no un gráfico, pero es la misma paleta validada
// (dataviz), nunca un hex inventado aparte.
const ACCOUNT_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)']

// No-criptográfico a propósito: crypto.randomUUID() no existe fuera de
// contextos seguros (http://<lan-ip> al probar desde el celular) — mismo
// motivo que generateLocalId en transactionsApi.js. Protege solo contra un
// doble-toque de "Guardar" en la propia hoja, no hace falta unicidad fuerte.
function generateIdempotencyKey() {
  return `fab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// undefined en navegadores sin soporte (ej. Firefox de escritorio) -- el
// botón de micrófono directamente no se renderiza en ese caso.
const SpeechRecognitionCtor =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined

// Matchea categoryName/accountName devueltos por Claude contra los arrays
// categories/accounts ya cargados, tolerando diferencias de acento/mayúscula.
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

const today = () => new Date().toISOString().slice(0, 10)

// Ejemplos ilustrativos, solo texto (no son tocables: no hay forma de
// "simular" que el usuario los dijo) — para que alguien que nunca usó la
// entrada por voz sepa qué tipo de frase decir antes de tocar el micrófono.
const VOICE_EXAMPLES = [
  'Gasté 25.000 en Rappi',
  'Almuerzo 18.000 pagado con Nequi',
  'Ingreso de 300.000 en Dale',
]

const emptyForm = {
  mode: 'gasto', // 'gasto' | 'ingreso' | 'transferencia'
  amount: '',
  accountId: '',
  fromKey: '', // pocket key ({accountId} o `${accountId}:${currency}`) — ver currencyPockets.js
  toKey: '',
  toAmount: '',
  categoryId: '',
  tag: '',
  purpose: '',
  note: '',
  consumesBudget: true,
  date: today(),
}

// Botón de acceso global montado en AppShell (visible en las 5 páginas, no
// un 6° destino de navegación) para registrar un gasto/ingreso/traslado sin
// tener que llegar hasta el fondo de GastosDiarios.jsx o Cuentas.jsx. No
// dispara el reload() completo de la página que esté montada debajo — solo
// refresca el badge de pendientes de AppShell via onSaved; cada página
// recoge el dato nuevo la próxima vez que monte, sin store global.
export default function QuickCaptureFAB({ onSaved, onOpenSearch }) {
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [balances, setBalances] = useState({})
  const [rates, setRates] = useState([])
  // true = el usuario ya tocó a mano el "Monto recibido" de un traslado
  // entre monedas distintas — mientras sea false, ese campo se sigue
  // recalculando solo a partir de la tasa guardada en exchange_rates cada
  // vez que cambia el monto o las cuentas.
  const [toAmountTouchedByUser, setToAmountTouchedByUser] = useState(false)
  const [categories, setCategories] = useState([])
  const [recentPurposes, setRecentPurposes] = useState([])
  // true = el tile "+" de categorías mandó al usuario a Ajustes → Categorías
  // a crear una — la hoja se oculta (sin resetear form) mientras tanto, y
  // vuelve a abrirse sola con el mismo movimiento a medio llenar apenas
  // Ajustes se cierra (ver el listener de "dashboard:settings-closed" más
  // abajo). Un mini-form inline (versión anterior de esto) se descartó: el
  // usuario prefirió que la fila de categorías no sume más elementos y usar
  // el formulario completo de Ajustes en su lugar.
  const [pendingResumeAfterSettings, setPendingResumeAfterSettings] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [showMore, setShowMore] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('idle') // 'idle' | 'listening' | 'processing'
  // true = la hoja muestra SOLO la pantalla de voz (onda + transcripción +
  // las dos píldoras), nunca el formulario debajo — mismo patrón que
  // receiptMode. Se sale de acá recién cuando voice-parse devuelve algo:
  // si el micrófono falla o todavía no arrancó, se queda en la onda.
  const [voiceMode, setVoiceMode] = useState(false)
  const [voiceError, setVoiceError] = useState(null)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceResult, setVoiceResult] = useState(null) // { mode, amount, categoryName, accountName } | null — lo que devolvió voice-parse, para las píldoras de "entidades reconocidas"
  // Amplitud real del micrófono (Web Audio API), no una animación de
  // relleno — mismo criterio que la transcripción: si no se puede leer
  // audio de verdad, las barras se quedan quietas en vez de fingir.
  const [audioLevels, setAudioLevels] = useState(new Array(24).fill(3))
  const [purposeSuggestion, setPurposeSuggestion] = useState(false)
  const [receiptStatus, setReceiptStatus] = useState('idle') // 'idle' | 'processing'
  const [receiptError, setReceiptError] = useState(null)
  // true = la hoja muestra la pantalla dedicada de "Escanear recibo" en vez
  // del formulario de gasto/ingreso/traslado — el botón de cámara del
  // clúster abre ESTO, nunca dispara el selector de archivo por sí solo.
  const [receiptMode, setReceiptMode] = useState(false)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState(null)
  const [receiptResult, setReceiptResult] = useState(null) // { amount, categoryName, purpose } | null
  // true = el "+" está desplegado: muestra la burbuja satélite de cámara
  // arriba en vez de abrir la hoja directo — referencia del usuario
  // (other recursos/referencia boton.mp4): un primer toque en "+" agrupa la
  // cámara como opción satélite, un segundo toque en "+" ya desplegado abre
  // la carga manual normal. Tocar la burbuja de cámara abre el escaneo y
  // colapsa esto mismo.
  const [plusExpanded, setPlusExpanded] = useState(false)
  const recognitionRef = useRef(null)
  const audioContextRef = useRef(null)
  const audioStreamRef = useRef(null)
  const audioRafRef = useRef(null)
  const receiptCameraInputRef = useRef(null)
  const receiptGalleryInputRef = useRef(null)
  const plusWrapRef = useRef(null)

  // Tocar en cualquier otro lugar de la pantalla mientras la burbuja de
  // cámara está desplegada la retrae, sin abrir nada — mismo criterio que un
  // menú/popover estándar que se cierra al tocar afuera. Solo escucha
  // mientras plusExpanded es true, para no pagar un listener global todo el
  // tiempo que el "+" está colapsado (su estado normal).
  useEffect(() => {
    if (!plusExpanded) return
    function handlePointerDown(e) {
      if (!plusWrapRef.current?.contains(e.target)) setPlusExpanded(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [plusExpanded])

  function handleCameraButtonClick() {
    setPlusExpanded(false)
    reset('gasto')
    setReceiptMode(true)
    setReceiptPreviewUrl(null)
    setReceiptResult(null)
    setReceiptError(null)
    setOpen(true)
  }

  // Primer toque en "+" (colapsado): solo despliega la burbuja de cámara
  // arriba, no abre nada todavía. Segundo toque (ya desplegado): colapsa y
  // recién ahí abre la hoja de carga manual — así "+" sigue siendo el
  // camino directo a registrar un movimiento, la cámara es la opción extra
  // que aparece antes de confirmar esa acción principal.
  function handlePlusButtonClick() {
    if (plusExpanded) {
      setPlusExpanded(false)
      setOpen(true)
    } else {
      setPlusExpanded(true)
    }
  }

  // Tile "+" de CategoryEmojiGrid: oculta esta hoja (setOpen(false), NO
  // close()/reset() — el form sigue vivo en memoria) y abre Ajustes en la
  // sección Categorías vía el mismo evento que ya usa "Precargar" en
  // Deudas.jsx (SettingsPanel.jsx escucha dashboard:open-settings). Es
  // SettingsPanel el que "sabe" cuándo el usuario terminó ahí — ver el
  // listener de dashboard:settings-closed más abajo.
  function handleCreateCategoryClick() {
    setPendingResumeAfterSettings(true)
    setOpen(false)
    window.dispatchEvent(new CustomEvent('dashboard:open-settings', { detail: { section: 'categorias' } }))
  }

  // SettingsPanel dispatchea esto en su propio close() (cualquier motivo:
  // creó la categoría, se arrepintió, tocó afuera) — reabre esta hoja con el
  // mismo form intacto y refresca categories para que la nueva ya aparezca,
  // sin depender de que el usuario vuelva a tocar "+" a mano.
  useEffect(() => {
    function handleSettingsClosed() {
      if (!pendingResumeAfterSettings) return
      setPendingResumeAfterSettings(false)
      listCategories().then(setCategories).catch(() => {})
      setOpen(true)
    }
    window.addEventListener('dashboard:settings-closed', handleSettingsClosed)
    return () => window.removeEventListener('dashboard:settings-closed', handleSettingsClosed)
  }, [pendingResumeAfterSettings])

  useEffect(() => {
    if (!open || accounts.length > 0) return
    listAccounts().then((accs) => {
      setAccounts(accs)
      const now = new Date()
      fetchBalancesForMonth(accs, now.getFullYear(), now.getMonth() + 1)
        .then(({ balances: b }) => setBalances(b))
        .catch(() => {}) // el saldo en el autocomplete es un extra, no bloquea la carga manual si falla
    }).catch((err) => setError(err.message))
    listCategories().then(setCategories).catch(() => {})
    listRecentPurposes().then(setRecentPurposes).catch(() => {})
    getRates().then(setRates).catch(() => {}) // sin tasa guardada, el "Monto recibido" cruzado queda vacío para completar a mano, no bloquea el traslado
  }, [open, accounts.length])

  // Sugiere "Monto recibido" en un traslado entre monedas distintas a partir
  // de la tasa guardada para ese par en exchange_rates — el usuario sigue
  // pudiendo ajustarlo a mano si la tasa real de ese traslado puntual fue
  // otra; una vez que lo toca, deja de auto-completarse hasta que cambien
  // monto o cuentas de nuevo.
  useEffect(() => {
    if (form.mode !== 'transferencia' || !crossCurrency || !form.amount || toAmountTouchedByUser) return
    const suggested = convertAmount(Number(form.amount), fromPocket?.currency, toPocket?.currency, rates)
    if (suggested != null) setForm((f) => ({ ...f, toAmount: String(Math.round(suggested * 100) / 100) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount, form.fromKey, form.toKey, form.mode])

  function reset(mode) {
    setForm({ ...emptyForm, mode: mode ?? form.mode })
    setShowMore(false)
    setTagOpen(false)
    setToAmountTouchedByUser(false)
    setError(null)
    setPurposeSuggestion(false)
    setReceiptError(null)
    setReceiptMode(false)
    setReceiptPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setReceiptResult(null)
    setVoiceResult(null)
    setVoiceMode(false)
  }

  function close() {
    recognitionRef.current?.abort()
    stopAudioVisualizer()
    setVoiceStatus('idle')
    setVoiceError(null)
    setVoiceTranscript('')
    setOpen(false)
    setSuccess(false)
    setPlusExpanded(false)
    setPendingResumeAfterSettings(false)
    reset('gasto')
  }

  function handleRetakeReceipt() {
    setReceiptPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setReceiptResult(null)
    setReceiptError(null)
  }

  // "Confirmar y continuar" no guarda directo — mismo principio que voz y
  // que el resto de la app ("nunca adivinar y guardar solo"): precarga el
  // formulario normal de gasto y lo muestra para que el usuario revise
  // monto/categoría/cuenta antes de tocar "Guardar" de verdad.
  function handleConfirmReceipt() {
    if (!receiptResult) return
    const category = categories.find((c) => normalizeName(c.name) === normalizeName(receiptResult.categoryName))
    setForm((prev) => ({
      ...prev,
      mode: 'gasto',
      amount: String(receiptResult.amount),
      categoryId: category?.id || prev.categoryId,
      purpose: receiptResult.purpose || prev.purpose,
    }))
    setReceiptMode(false)
  }

  // Sugiere categoría+tag aprendidos de purpose_category_stats al salir del
  // campo Descripción — nunca pisa una elección que el usuario ya hizo, y no
  // compite con el prefill de voz (handleVoiceResult tiene su propio flujo).
  async function handlePurposeBlur() {
    if (!form.purpose.trim() || form.categoryId || form.tag) return
    try {
      const suggestion = await suggestCategoryForPurpose(form.purpose)
      if (!suggestion) return
      setForm((prev) => ({ ...prev, categoryId: suggestion.categoryId, tag: suggestion.tag ?? prev.tag }))
      setPurposeSuggestion(true)
    } catch {
      // Silencioso: es solo una sugerencia, no debe bloquear la carga manual.
    }
  }

  function currencyOf(id) {
    return accounts.find((a) => a.id === id)?.currency || 'COP'
  }

  const hijas = accounts.filter((a) => a.kind === 'hija')
  const madreId = accounts.find((a) => a.kind === 'madre')?.id
  const accountOptions = form.mode === 'ingreso' ? accounts : hijas

  // Un "bolsillo" por moneda de cada cuenta — mismo mecanismo que
  // TransferHistorySection.jsx, para poder elegir como destino de un
  // traslado específicamente el bolsillo EUR de una cuenta multi-moneda
  // como arq, no solo su moneda primaria.
  const pockets = flattenAccountPockets(accounts)
  function pocketOf(key) {
    return pockets.find((p) => p.key === key)
  }
  const fromPocket = pocketOf(form.fromKey)
  const toPocket = pocketOf(form.toKey)
  const toOptions = form.fromKey ? pockets.filter((p) => p.key !== form.fromKey) : pockets
  const crossCurrency = !!(form.mode === 'transferencia' && fromPocket && toPocket
    && toPocket.currency !== fromPocket.currency)
  const askConsumesBudget = !!(form.mode === 'transferencia'
    && fromPocket && fromPocket.accountId !== madreId
    && toPocket && toPocket.accountId !== madreId)

  // La categoría es obligatoria para gasto/ingreso (a diferencia de la
  // cuenta, que puede quedar "pendiente de banco") — decisión explícita del
  // usuario tras ver que MonIA nunca deja guardar sin categoría.
  const canSubmit = form.mode === 'transferencia'
    ? !!(fromPocket && toPocket && form.amount && (!crossCurrency || form.toAmount))
    : !!(form.amount && form.categoryId)

  // Reordena el catálogo completo de categorías (nunca lo recorta) para que
  // las que calzan con lo tipeado en Descripción queden primero en la fila
  // deslizable — mismo dato que Diario.jsx (recentPurposes), pero acá
  // reordena en vez de armar una lista corta de chips aparte: es una sola
  // fila de CategoryEmojiGrid, siempre completa, nunca hace falta un botón
  // "+" para ver el resto. Sigue siendo una sugerencia tocable, nunca se
  // auto-selecciona sola — el usuario siempre confirma.
  const purposeQuery = form.purpose.trim().toLowerCase()
  const matchingPurposes = purposeQuery
    ? recentPurposes.filter((p) => p.purpose.toLowerCase().includes(purposeQuery))
    : recentPurposes
  const priorityCategoryIds = []
  for (const p of matchingPurposes) {
    if (p.categoryId && !priorityCategoryIds.includes(p.categoryId)) priorityCategoryIds.push(p.categoryId)
  }
  const sortedCategories = [...categories].sort((a, b) => {
    const ai = priorityCategoryIds.indexOf(a.id)
    const bi = priorityCategoryIds.indexOf(b.id)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit || saving) return
    setSaving(true)
    setError(null)
    try {
      if (form.mode === 'transferencia') {
        await createTransfers([{
          fromAccountId: fromPocket.accountId,
          toAccountId: toPocket.accountId,
          amount: Number(form.amount),
          currency: fromPocket.currency,
          ...(crossCurrency ? { toAmount: Number(form.toAmount), toCurrency: toPocket.currency } : {}),
          consumesBudget: askConsumesBudget ? form.consumesBudget : true,
          transferDate: form.date,
          note: form.note.trim() || null,
          idempotencyKey: generateIdempotencyKey(),
        }])
      } else {
        const currency = currencyOf(form.accountId)
        const signedAmount = form.mode === 'ingreso' ? Math.abs(Number(form.amount)) : -Math.abs(Number(form.amount))
        await createManualTransaction({
          purpose: form.purpose.trim() || (form.mode === 'ingreso' ? 'Ingreso rápido' : 'Gasto rápido'),
          amount: signedAmount,
          // Hora real cuando se carga "hoy" (para que listas como
          // Diario.jsx's "Movimientos de hoy" muestren la hora real de
          // carga) — mediodía UTC solo como marca neutra cuando se
          // registra en una fecha pasada, de la que no se conoce la hora.
          occurredAt: form.date === today() ? new Date().toISOString() : `${form.date}T12:00:00Z`,
          categoryId: form.categoryId || null,
          accountId: form.accountId || null,
          currency,
          tags: form.tag.trim() ? [form.tag.trim().toLowerCase()] : [],
        })
      }
      setSuccess(true)
      onSaved?.()
      setTimeout(close, 900)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleVoiceResult(transcript) {
    if (!transcript.trim()) {
      setVoiceStatus('idle')
      setVoiceError('No se entendió nada, intenta de nuevo')
      return
    }
    setVoiceStatus('processing')
    setVoiceError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('voice-parse', {
        body: { text: transcript },
      })
      if (invokeError) throw invokeError
      if (!data?.ok) throw new Error(data?.error || 'no se pudo interpretar')

      const result = data.result
      const account = accounts.find((a) => normalizeName(a.name) === normalizeName(result.accountName))
      const category = categories.find((c) => normalizeName(c.name) === normalizeName(result.categoryName))
      setVoiceResult(result)

      setForm({
        ...emptyForm,
        mode: result.mode,
        amount: String(result.amount),
        accountId: account?.id || '',
        categoryId: category?.id || '',
        purpose: result.purpose || '',
        tag: result.tag || '',
      })
      if (result.tag) setTagOpen(true)
      // Recién acá se pasa al formulario: si voice-parse falló (o el
      // micrófono nunca arrancó), la hoja se queda en la pantalla de la onda
      // con el error a la vista, en vez de caer al form vacío.
      setVoiceMode(false)
    } catch (err) {
      setVoiceError(err.message)
    } finally {
      setVoiceStatus((s) => (s === 'processing' ? 'idle' : s))
    }
  }

  // Foto de recibo → receipt-parse (misma arquitectura y filosofía que
  // voice-parse: Gemini 2.5 Flash con visión, nunca escribe en la base,
  // solo devuelve datos para PREFILL — el usuario igual revisa y confirma
  // antes de "Guardar"). Ya está desplegada y con GEMINI_API_KEY
  // configurada (ver CLAUDE.md, "Known deferred scope").
  async function handleReceiptFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir la misma foto otra vez
    if (!file) return
    setReceiptPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    setReceiptResult(null)
    setReceiptStatus('processing')
    setReceiptError(null)
    try {
      const { base64, mediaType } = await resizeImageFileToBase64(file)
      const { data, error: invokeError } = await supabase.functions.invoke('receipt-parse', {
        body: { mediaType, imageBase64: base64 },
      })
      if (invokeError) throw invokeError
      if (!data?.ok) throw new Error(data?.error || 'no se pudo leer el recibo')
      setReceiptResult(data.result)
    } catch (err) {
      setReceiptError(err.message)
    } finally {
      setReceiptStatus('idle')
    }
  }

  // Barras con la amplitud real del micrófono (Web Audio API), aparte del
  // stream que usa SpeechRecognition para transcribir — ninguna de las dos
  // APIs comparte datos crudos de audio con la otra, así que hace falta
  // pedir getUserMedia una segunda vez solo para poder dibujar esto. Si el
  // navegador no da permiso o no soporta AnalyserNode, las barras se quedan
  // quietas (ver audioLevels inicial) en vez de fingir una animación.
  async function startAudioVisualizer() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      const audioContext = new AudioContextCtor()
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      function tick() {
        analyser.getByteFrequencyData(data)
        setAudioLevels([...data].slice(0, 24).map((v) => Math.max(3, Math.round((v / 255) * 28))))
        audioRafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // Sin permiso o sin soporte: la tarjeta de "Escuchando" sigue
      // funcionando igual (transcripción real), solo sin barras animadas.
    }
  }

  function stopAudioVisualizer() {
    cancelAnimationFrame(audioRafRef.current)
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current = null
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    setAudioLevels(new Array(24).fill(3))
  }

  function startVoiceCapture() {
    if (!SpeechRecognitionCtor) {
      setVoiceError('Este navegador no soporta entrada por voz')
      return
    }
    if (voiceStatus === 'listening') {
      recognitionRef.current?.stop()
      return
    }
    setVoiceError(null)
    setVoiceTranscript('')
    setVoiceResult(null)
    startAudioVisualizer()
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'es-CO'
    recognition.interimResults = true
    // continuous=true: ya no se procesa solo apenas el navegador detecta una
    // pausa (eso cortaba a mitad de frase si el usuario dudaba un segundo) —
    // ahora sigue escuchando y acumulando hasta que el usuario mismo toca
    // "Aceptar" o "Detener".
    recognition.continuous = true
    recognition.onstart = () => setVoiceStatus('listening')
    recognition.onerror = (e) => {
      setVoiceStatus('idle')
      stopAudioVisualizer()
      // 'aborted' lo dispara nuestro propio abort() al tocar Aceptar/Detener,
      // y 'no-speech' es simplemente silencio — ninguno de los dos es un
      // error que mostrarle al usuario.
      if (e.error === 'aborted' || e.error === 'no-speech') return
      const messages = {
        'not-allowed': 'Permiso de micrófono denegado',
        'service-not-allowed': 'El navegador bloqueó el servicio de voz',
        'audio-capture': 'No se encontró micrófono',
        network: 'Sin conexión con el servicio de voz',
      }
      setVoiceError(messages[e.error] || `Error al escuchar (${e.error})`)
    }
    recognition.onend = () => {
      setVoiceStatus((s) => (s === 'listening' ? 'idle' : s))
      stopAudioVisualizer()
    }
    // Reconstruye la transcripción completa acumulada en cada evento (no solo
    // el delta) — en modo continuous, e.results tiene todo lo dicho hasta
    // ahora, interino y final mezclado.
    recognition.onresult = (e) => {
      let combined = ''
      for (let i = 0; i < e.results.length; i++) combined += e.results[i][0].transcript
      setVoiceTranscript(combined)
    }
    recognitionRef.current = recognition
    recognition.start()
  }

  // Los dos botones de la pantalla de escucha: "Aceptar" corta el
  // micrófono y manda lo transcrito hasta ahora a interpretar; "Detener"
  // corta sin procesar nada (el usuario se arrepintió o se equivocó).
  function handleVoiceAccept() {
    recognitionRef.current?.abort()
    stopAudioVisualizer()
    handleVoiceResult(voiceTranscript)
  }

  function handleVoiceStop() {
    recognitionRef.current?.abort()
    stopAudioVisualizer()
    setVoiceStatus('idle')
    setVoiceTranscript('')
    setVoiceError(null)
  }

  // Botón de micrófono propio y siempre visible (no solo dentro de la hoja
  // de "+"), como en la referencia de MonIA — abre la hoja ya en la pantalla
  // de voz (solo onda + transcripción + las dos píldoras), en vez de forzar
  // abrir "+" primero y recién ahí tocar el micrófono.
  function handleMicButtonClick() {
    setPlusExpanded(false)
    if (voiceStatus !== 'listening') {
      reset('gasto')
      setVoiceMode(true)
      setOpen(true)
    }
    startVoiceCapture()
  }

  return (
    <>
      <div className={styles.fabCluster}>
        <button
          type="button"
          className={styles.fabSecondary}
          aria-label="Buscar movimientos"
          onClick={() => { setPlusExpanded(false); onOpenSearch?.() }}
        >
          <IconSearch width={20} height={20} />
        </button>

        <div className={styles.fabPlusWrap} ref={plusWrapRef}>
          {plusExpanded && (
            <button
              type="button"
              className={styles.fabSatellite}
              aria-label="Escanear recibo"
              onClick={handleCameraButtonClick}
            >
              <IconCamera width={20} height={20} />
            </button>
          )}
          <button
            type="button"
            className={plusExpanded ? `${styles.fabSecondary} ${styles.fabPlusActive}` : styles.fabSecondary}
            aria-label={plusExpanded ? 'Registrar movimiento rápido' : 'Más opciones'}
            onClick={handlePlusButtonClick}
          >
            <IconPlus width={22} height={22} />
          </button>
        </div>
      </div>

      {SpeechRecognitionCtor && (
        <button
          type="button"
          className={voiceStatus === 'listening' ? `${styles.fabMic} ${styles.micListening}` : styles.fabMic}
          disabled={voiceStatus === 'processing'}
          aria-label="Registrar por voz"
          onClick={handleMicButtonClick}
        >
          <IconMic width={26} height={26} />
        </button>
      )}

      {open && (
        <div className={styles.backdrop} onClick={close}>
          <div
            className={`${styles.sheet} ${(receiptMode || voiceMode) ? styles.sheetFullBleed : ''}`}
            role="dialog" aria-modal="true"
            aria-labelledby="quick-capture-title" onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              {receiptMode ? (
                <div className={styles.titleRow}>
                  <span className={styles.receiptIconBadge}><IconCamera width={16} height={16} /></span>
                  <div>
                    <div className={styles.titleRowInline}>
                      <h2 id="quick-capture-title" className={styles.title}>Escanear recibo</h2>
                      <span className={styles.receiptBadgePill}>IA</span>
                    </div>
                    <p className={styles.subtitle}>Capturá o subí un ticket para leerlo con IA</p>
                  </div>
                </div>
              ) : voiceMode ? (
                <div className={styles.titleRow}>
                  <span className={styles.receiptIconBadge}><IconMic width={16} height={16} /></span>
                  <div>
                    <div className={styles.titleRowInline}>
                      <h2 id="quick-capture-title" className={styles.title}>
                        {voiceStatus === 'listening' ? 'Escuchando…' : 'Movimiento por voz'}
                      </h2>
                      {voiceStatus === 'listening' && <span className={styles.voiceLiveBadge}>EN VIVO</span>}
                    </div>
                    <p className={styles.subtitle}>Hablá con libertad, la IA detecta los campos</p>
                  </div>
                </div>
              ) : (
                <div>
                  <div className={styles.titleRow}>
                    <span className={styles.titleDot} />
                    <h2 id="quick-capture-title" className={styles.title}>Movimiento rápido</h2>
                  </div>
                  <p className={styles.subtitle}>Registrá tus transacciones al instante</p>
                </div>
              )}
              <button type="button" className={styles.closeButton} onClick={close} aria-label="Cerrar">
                <IconClose width={20} height={20} />
              </button>
            </div>

            {receiptMode ? (
              <div className={styles.receiptView}>
                <div className={styles.receiptPreviewCard}>
                  {receiptPreviewUrl ? (
                    <img src={receiptPreviewUrl} alt="Recibo capturado" className={styles.receiptPreviewImg} />
                  ) : (
                    <div className={styles.receiptPreviewEmpty}>
                      <IconCamera width={26} height={26} />
                      <p>Elegí una opción abajo para escanear un recibo</p>
                    </div>
                  )}
                  {receiptStatus === 'processing' && (
                    <div className={styles.receiptProcessingOverlay}>
                      <span className={styles.voiceLiveDot} />
                      Leyendo recibo…
                    </div>
                  )}
                </div>

                {receiptError && <p className={styles.error}>{receiptError}</p>}

                {!receiptResult && (
                  <div className={styles.receiptSourceRow}>
                    <button
                      type="button" className={styles.receiptSourceButton}
                      onClick={() => receiptCameraInputRef.current?.click()}
                      disabled={receiptStatus === 'processing'}
                    >
                      <span className={styles.receiptSourceIcon}><IconCamera width={18} height={18} /></span>
                      <span className={styles.receiptSourceText}>
                        <span className={styles.receiptSourceLabel}>Tomar foto</span>
                        <span className={styles.receiptSourceSub}>Captura instantánea</span>
                      </span>
                    </button>
                    <button
                      type="button" className={styles.receiptSourceButton}
                      onClick={() => receiptGalleryInputRef.current?.click()}
                      disabled={receiptStatus === 'processing'}
                    >
                      <span className={styles.receiptSourceIcon}><IconSearch width={18} height={18} /></span>
                      <span className={styles.receiptSourceText}>
                        <span className={styles.receiptSourceLabel}>Subir recibo</span>
                        <span className={styles.receiptSourceSub}>Desde la galería</span>
                      </span>
                    </button>
                  </div>
                )}

                {receiptResult && (
                  <div className={styles.receiptResultCard}>
                    <div className={styles.receiptResultHeader}>Datos detectados por IA</div>
                    <div className={styles.receiptResultAmountRow}>
                      <div>
                        <span className={styles.receiptResultLabel}>Monto reconocido</span>
                        <div className={styles.receiptResultAmount}>{formatCOP(receiptResult.amount)}</div>
                      </div>
                      {receiptResult.categoryName && (
                        <span className={styles.receiptResultCategory}>{receiptResult.categoryName}</span>
                      )}
                    </div>
                    {receiptResult.purpose && <p className={styles.receiptResultPurpose}>{receiptResult.purpose}</p>}
                  </div>
                )}

                <input
                  ref={receiptCameraInputRef} type="file" accept="image/*" capture="environment"
                  onChange={handleReceiptFile} style={{ display: 'none' }}
                />
                <input
                  ref={receiptGalleryInputRef} type="file" accept="image/*"
                  onChange={handleReceiptFile} style={{ display: 'none' }}
                />

                <div className={styles.receiptFooter}>
                  <button
                    type="button" className={styles.receiptRetake}
                    onClick={handleRetakeReceipt} disabled={!receiptPreviewUrl}
                  >
                    Reintentar
                  </button>
                  <button
                    type="button" className={styles.receiptConfirm}
                    onClick={handleConfirmReceipt} disabled={!receiptResult}
                  >
                    Confirmar y continuar
                  </button>
                </div>
              </div>
            ) : voiceMode ? (
              <div className={styles.voiceListeningPlain}>
                <div className={styles.voiceWaveRow}>
                  {audioLevels.map((h, i) => (
                    <span key={i} className={styles.voiceWaveBar} style={{ height: `${h}px` }} />
                  ))}
                </div>

                {voiceTranscript ? (
                  <p className={styles.voiceTranscript}>"{voiceTranscript}"</p>
                ) : (
                  <div className={styles.voiceExamples}>
                    <p className={styles.voiceExamplesHint}>
                      {voiceStatus === 'listening' ? 'Probá diciendo:' : 'Tocá "Reintentar" para volver a escuchar.'}
                    </p>
                    {voiceStatus === 'listening' && (
                      <div className={styles.voiceExampleRow}>
                        {VOICE_EXAMPLES.map((ex) => (
                          <span key={ex} className={styles.voiceExampleChip}>{ex}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {voiceError && <p className={styles.error}>{voiceError}</p>}

                <div className={styles.voicePillRow}>
                  <button
                    type="button" className={styles.voicePillStop}
                    onClick={voiceStatus === 'listening' ? handleVoiceStop : startVoiceCapture}
                    disabled={voiceStatus === 'processing'}
                  >
                    {voiceStatus === 'listening' ? 'Detener' : 'Reintentar'}
                  </button>
                  <button
                    type="button" className={styles.voicePillAccept}
                    onClick={handleVoiceAccept}
                    disabled={!voiceTranscript.trim() || voiceStatus === 'processing'}
                  >
                    {voiceStatus === 'processing' ? 'Interpretando…' : 'Aceptar'}
                  </button>
                </div>
              </div>
            ) : success ? (
              <p className={styles.success}>Guardado ✓</p>
            ) : (
              <form onSubmit={handleSubmit} className={styles.form}>
                <div className={styles.segmented}>
                  {[['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['transferencia', 'Traslado']].map(([value, label]) => (
                    <button
                      key={value} type="button"
                      className={form.mode === value ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
                      onClick={() => reset(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {voiceResult && (
                  <div className={styles.voiceResultCard}>
                    <div className={styles.voiceResultHeader}>Entidades reconocidas</div>
                    <div className={styles.voiceResultPills}>
                      <span className={styles.voiceResultPill} data-tone="amount">
                        <span className={styles.voiceResultPillLabel}>Monto</span>{formatCOP(voiceResult.amount)}
                      </span>
                      {voiceResult.categoryName && (
                        <span className={styles.voiceResultPill} data-tone="category">
                          <span className={styles.voiceResultPillLabel}>Categoría</span>{voiceResult.categoryName}
                        </span>
                      )}
                      {voiceResult.accountName && (
                        <span className={styles.voiceResultPill} data-tone="account">
                          <span className={styles.voiceResultPillLabel}>Cuenta</span>{voiceResult.accountName}
                        </span>
                      )}
                      <span className={styles.voiceResultPill} data-tone="type">
                        <span className={styles.voiceResultPillLabel}>Tipo</span>
                        {voiceResult.mode === 'ingreso' ? 'Ingreso' : voiceResult.mode === 'transferencia' ? 'Traslado' : 'Gasto'}
                      </span>
                    </div>
                  </div>
                )}

                {form.mode === 'transferencia' ? (
                  <>
                    <div className={styles.amountCard}>
                      <div className={styles.amountCardLabel}>
                        <span>Monto</span>
                        <span className={styles.amountCardCurrency}>{fromPocket?.currency || 'COP'}</span>
                      </div>
                      <div className={styles.amountCardRow}>
                        <span className={styles.amountCardSign}>$</span>
                        <input
                          type="number" inputMode="decimal" autoFocus placeholder="0"
                          value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                          className={styles.amountCardInput}
                        />
                      </div>
                    </div>
                    <div className={styles.chipRow}>
                      <span className={styles.chipLabel}>Desde</span>
                      {pockets.map((p) => (
                        <button
                          key={p.key} type="button"
                          className={form.fromKey === p.key ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                          onClick={() => {
                            setForm({
                              ...form,
                              fromKey: p.key,
                              toKey: form.toKey === p.key ? '' : form.toKey,
                            })
                            setToAmountTouchedByUser(false)
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className={styles.chipRow}>
                      <span className={styles.chipLabel}>Hacia</span>
                      {toOptions.map((p) => (
                        <button
                          key={p.key} type="button" disabled={!form.fromKey}
                          className={form.toKey === p.key ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                          onClick={() => { setForm({ ...form, toKey: p.key }); setToAmountTouchedByUser(false) }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    {/* Monto recibido: se completa solo apenas hay monto y las dos
                        cuentas elegidas, a partir de la tasa guardada — sigue
                        editable a mano para el caso puntual de una tasa real
                        distinta a la guardada. */}
                    {crossCurrency && (
                      <div className={styles.amountCard}>
                        <div className={styles.amountCardLabel}>
                          <span>Monto recibido</span>
                          <span className={styles.amountCardCurrency}>{toPocket?.currency}</span>
                        </div>
                        <div className={styles.amountCardRow}>
                          <span className={styles.amountCardSign}>$</span>
                          <input
                            type="number" inputMode="decimal" placeholder="0"
                            value={form.toAmount}
                            onChange={(e) => { setForm({ ...form, toAmount: e.target.value }); setToAmountTouchedByUser(true) }}
                            className={styles.amountCardInput}
                          />
                        </div>
                      </div>
                    )}
                    {crossCurrency && form.amount && form.toAmount && (
                      <p className={styles.voiceHint}>
                        {formatByCurrency(Number(form.amount), fromPocket?.currency)} → {formatByCurrency(Number(form.toAmount), toPocket?.currency)}
                        {!toAmountTouchedByUser && ' (sugerido por la tasa guardada, editable)'}
                      </p>
                    )}
                    {askConsumesBudget && (
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox" checked={form.consumesBudget}
                          onChange={(e) => setForm({ ...form, consumesBudget: e.target.checked })}
                        />
                        Descuenta del presupuesto de origen
                      </label>
                    )}

                    <button type="button" className={styles.moreToggle} onClick={() => setShowMore((v) => !v)}>
                      {showMore ? 'Menos opciones' : 'Más opciones'}
                    </button>
                    {showMore && (
                      <div className={styles.moreFields}>
                        <input
                          placeholder="Nota (opcional)" value={form.note}
                          onChange={(e) => setForm({ ...form, note: e.target.value })}
                          className={styles.textInput}
                        />
                        <input
                          type="date" value={form.date}
                          onChange={(e) => setForm({ ...form, date: e.target.value })}
                          className={styles.textInput}
                        />
                      </div>
                    )}

                    {error && <p className={styles.error}>{error}</p>}
                    <button type="submit" disabled={!canSubmit || saving} className={styles.submit}>
                      {saving ? 'Guardando…' : 'Guardar'}
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="date" value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                      className={styles.topDatePill}
                    />
                    <input
                      placeholder="Descripción" value={form.purpose} autoFocus
                      onChange={(e) => { setForm({ ...form, purpose: e.target.value }); setPurposeSuggestion(false) }}
                      onBlur={handlePurposeBlur}
                      className={styles.bigInput}
                    />
                    <div className={styles.amountCard}>
                      <div className={styles.amountCardLabel}>
                        <span>Monto</span>
                        <span className={styles.amountCardCurrency}>{currencyOf(form.accountId) || 'COP'}</span>
                      </div>
                      <div className={styles.amountCardRow}>
                        <span className={styles.amountCardSign}>$</span>
                        <input
                          type="number" inputMode="decimal" placeholder="0"
                          value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                          className={styles.amountCardInput}
                        />
                      </div>
                    </div>

                    <div className={styles.accountSection}>
                      <div className={styles.accountSectionHeader}>
                        <span className={styles.chipLabel}>Cuenta</span>
                      </div>
                      <div className={styles.accountChipRow}>
                        {accountOptions.map((a, i) => (
                          <button
                            key={a.id} type="button"
                            className={form.accountId === a.id ? `${styles.accountChip} ${styles.accountChipActive}` : styles.accountChip}
                            onClick={() => setForm({ ...form, accountId: a.id === form.accountId ? '' : a.id })}
                          >
                            <span className={styles.accountAvatar} style={{ background: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }}>
                              {a.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span className={styles.accountChipText}>
                              <span className={styles.accountChipName}>{a.name}</span>
                              <span className={styles.accountChipBalance}>{formatByCurrency(balances[a.id] ?? 0, a.currency || 'COP')}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <CategoryEmojiGrid
                      categories={sortedCategories}
                      selectedId={form.categoryId}
                      onSelect={(id) => { setForm({ ...form, categoryId: id === form.categoryId ? '' : id }); setPurposeSuggestion(false) }}
                      onCreateClick={handleCreateCategoryClick}
                    />
                    {purposeSuggestion && (
                      <p className={styles.voiceHint}>Sugerido de tu historial — podés cambiarlo antes de guardar.</p>
                    )}

                    {error && <p className={styles.error}>{error}</p>}
                    {form.amount && !form.categoryId && (
                      <p className={styles.hintCaption}>Elegí una categoría para poder guardar.</p>
                    )}

                    <div className={styles.bottomRow}>
                      <button
                        type="button"
                        className={tagOpen ? `${styles.tagToggle} ${styles.tagToggleActive}` : styles.tagToggle}
                        onClick={() => setTagOpen((v) => !v)}
                        aria-label="Agregar tag"
                      >
                        #
                      </button>
                      {tagOpen && (
                        <input
                          placeholder="Tag" value={form.tag} autoFocus
                          onChange={(e) => setForm({ ...form, tag: e.target.value })}
                          className={styles.tagInlineInput}
                        />
                      )}
                      <button type="submit" disabled={!canSubmit || saving} className={`${styles.submit} ${styles.submitInline}`}>
                        {saving ? 'Guardando…' : 'Guardar'}
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
