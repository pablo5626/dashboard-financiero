import { useEffect, useRef, useState } from 'react'
import { IconPlus, IconClose, IconMic } from './icons.jsx'
import { listAccounts } from '../lib/accountsApi.js'
import { listCategories } from '../lib/categoriesApi.js'
import { createManualTransaction, suggestCategoryForPurpose } from '../lib/transactionsApi.js'
import { createTransfers } from '../lib/transfersApi.js'
import { supabase } from '../lib/supabaseClient.js'
import styles from './QuickCaptureFAB.module.css'

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

const emptyForm = {
  mode: 'gasto', // 'gasto' | 'ingreso' | 'transferencia'
  amount: '',
  accountId: '',
  fromAccountId: '',
  toAccountId: '',
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
export default function QuickCaptureFAB({ onSaved }) {
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [showMore, setShowMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('idle') // 'idle' | 'listening' | 'processing'
  const [voiceError, setVoiceError] = useState(null)
  const [purposeSuggestion, setPurposeSuggestion] = useState(false)
  const recognitionRef = useRef(null)

  useEffect(() => {
    if (!open || accounts.length > 0) return
    listAccounts().then(setAccounts).catch((err) => setError(err.message))
    listCategories().then(setCategories).catch(() => {})
  }, [open, accounts.length])

  function reset(mode) {
    setForm({ ...emptyForm, mode: mode ?? form.mode })
    setShowMore(false)
    setError(null)
    setPurposeSuggestion(false)
  }

  function close() {
    recognitionRef.current?.abort()
    setVoiceStatus('idle')
    setVoiceError(null)
    setOpen(false)
    setSuccess(false)
    reset('gasto')
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
  const toOptions = form.fromAccountId ? accounts.filter((a) => a.id !== form.fromAccountId) : accounts
  const crossCurrency = !!(form.mode === 'transferencia' && form.fromAccountId && form.toAccountId
    && currencyOf(form.toAccountId) !== currencyOf(form.fromAccountId))
  const askConsumesBudget = !!(form.mode === 'transferencia'
    && form.fromAccountId && form.fromAccountId !== madreId
    && form.toAccountId && form.toAccountId !== madreId)

  const canSubmit = form.mode === 'transferencia'
    ? !!(form.fromAccountId && form.toAccountId && form.amount && (!crossCurrency || form.toAmount))
    : !!form.amount

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit || saving) return
    setSaving(true)
    setError(null)
    try {
      if (form.mode === 'transferencia') {
        await createTransfers([{
          fromAccountId: form.fromAccountId,
          toAccountId: form.toAccountId,
          amount: Number(form.amount),
          currency: currencyOf(form.fromAccountId),
          ...(crossCurrency ? { toAmount: Number(form.toAmount), toCurrency: currencyOf(form.toAccountId) } : {}),
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
          occurredAt: `${form.date}T12:00:00Z`,
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

      setForm({
        ...emptyForm,
        mode: result.mode,
        amount: String(result.amount),
        accountId: account?.id || '',
        categoryId: category?.id || '',
        purpose: result.purpose || '',
        tag: result.tag || '',
      })
      setShowMore(true)
    } catch (err) {
      setVoiceError(err.message)
    } finally {
      setVoiceStatus((s) => (s === 'processing' ? 'idle' : s))
    }
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
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'es-CO'
    recognition.interimResults = false
    recognition.onstart = () => setVoiceStatus('listening')
    recognition.onerror = (e) => {
      setVoiceStatus('idle')
      setVoiceError(e.error === 'not-allowed' ? 'Permiso de micrófono denegado' : 'Error al escuchar')
    }
    recognition.onend = () => setVoiceStatus((s) => (s === 'listening' ? 'idle' : s))
    recognition.onresult = (e) => handleVoiceResult(e.results[0][0].transcript)
    recognitionRef.current = recognition
    recognition.start()
  }

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        aria-label="Registrar movimiento rápido"
        onClick={() => setOpen(true)}
      >
        <IconPlus width={26} height={26} />
      </button>

      {open && (
        <div className={styles.backdrop} onClick={close}>
          <div
            className={styles.sheet} role="dialog" aria-modal="true"
            aria-labelledby="quick-capture-title" onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              <h2 id="quick-capture-title" className={styles.title}>Movimiento rápido</h2>
              <button type="button" className={styles.closeButton} onClick={close} aria-label="Cerrar">
                <IconClose width={20} height={20} />
              </button>
            </div>

            {success ? (
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

                <div className={styles.amountRow}>
                  <input
                    type="number" inputMode="decimal" autoFocus placeholder="Monto"
                    value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className={styles.amountInput}
                  />
                  {form.mode !== 'transferencia' && SpeechRecognitionCtor && (
                    <button
                      type="button"
                      className={voiceStatus === 'listening' ? `${styles.micButton} ${styles.micListening}` : styles.micButton}
                      disabled={voiceStatus === 'processing'}
                      onClick={startVoiceCapture}
                      aria-label="Registrar por voz"
                    >
                      <IconMic width={20} height={20} />
                    </button>
                  )}
                </div>
                {voiceStatus === 'processing' && <p className={styles.voiceHint}>Interpretando…</p>}
                {voiceError && <p className={styles.error}>{voiceError}</p>}

                {form.mode === 'transferencia' ? (
                  <>
                    <div className={styles.chipRow}>
                      <span className={styles.chipLabel}>Desde</span>
                      {accounts.map((a) => (
                        <button
                          key={a.id} type="button"
                          className={form.fromAccountId === a.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                          onClick={() => setForm({
                            ...form,
                            fromAccountId: a.id,
                            toAccountId: form.toAccountId === a.id ? '' : form.toAccountId,
                          })}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                    <div className={styles.chipRow}>
                      <span className={styles.chipLabel}>Hacia</span>
                      {toOptions.map((a) => (
                        <button
                          key={a.id} type="button" disabled={!form.fromAccountId}
                          className={form.toAccountId === a.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                          onClick={() => setForm({ ...form, toAccountId: a.id })}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                    {crossCurrency && (
                      <input
                        type="number" inputMode="decimal"
                        placeholder={`Monto recibido (${currencyOf(form.toAccountId)})`}
                        value={form.toAmount} onChange={(e) => setForm({ ...form, toAmount: e.target.value })}
                        className={styles.amountInput}
                      />
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
                  </>
                ) : (
                  <div className={styles.chipRow}>
                    {accountOptions.map((a) => (
                      <button
                        key={a.id} type="button"
                        className={form.accountId === a.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                        onClick={() => setForm({ ...form, accountId: form.accountId === a.id ? '' : a.id })}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}

                <button type="button" className={styles.moreToggle} onClick={() => setShowMore((v) => !v)}>
                  {showMore ? 'Menos opciones' : 'Más opciones'}
                </button>

                {showMore && (
                  <div className={styles.moreFields}>
                    {form.mode !== 'transferencia' && (
                      <>
                        <input
                          placeholder="Descripción (opcional)" value={form.purpose}
                          onChange={(e) => { setForm({ ...form, purpose: e.target.value }); setPurposeSuggestion(false) }}
                          onBlur={handlePurposeBlur}
                          className={styles.textInput}
                        />
                        <select
                          value={form.categoryId}
                          onChange={(e) => { setForm({ ...form, categoryId: e.target.value }); setPurposeSuggestion(false) }}
                          className={styles.textInput}
                        >
                          <option value="">Sin categoría</option>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <input
                          placeholder="Tag (opcional)" value={form.tag}
                          onChange={(e) => setForm({ ...form, tag: e.target.value })}
                          className={styles.textInput}
                        />
                        {purposeSuggestion && (
                          <p className={styles.voiceHint}>Sugerido de tu historial — podés cambiarlo antes de guardar.</p>
                        )}
                      </>
                    )}
                    {form.mode === 'transferencia' && (
                      <input
                        placeholder="Nota (opcional)" value={form.note}
                        onChange={(e) => setForm({ ...form, note: e.target.value })}
                        className={styles.textInput}
                      />
                    )}
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
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
