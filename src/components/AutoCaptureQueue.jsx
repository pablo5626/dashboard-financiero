import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { Field, InfoCard } from './ui/FormKit.jsx'
import CategoryEmojiGrid from './CategoryEmojiGrid.jsx'
import AccountAutocomplete from './AccountAutocomplete.jsx'
import { formatByCurrency } from '../lib/format.js'
import {
  listPendingCaptures, confirmCapture, discardCapture, reviewCapture, deleteCapturedTransaction,
} from '../lib/autoCaptureApi.js'
import { suggestCategoryForPurpose, normalizeTag } from '../lib/transactionsApi.js'
import styles from './AutoCaptureQueue.module.css'

const SOURCE_LABEL = { apple_pay: 'Apple Pay', android_notification: 'Notificación', sms: 'SMS', email: 'Correo' }

function formatWhen(iso) {
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function draftFor(capture, suggestion) {
  const tx = capture.transactions
  if (tx) {
    return {
      purpose: tx.purpose ?? '',
      amount: String(Math.abs(Number(tx.amount))),
      accountId: tx.account_id ?? '',
      categoryId: tx.category_id ?? '',
      tags: tx.tags ?? [],
    }
  }
  return {
    purpose: capture.merchant ?? '',
    amount: capture.amount != null ? String(capture.amount) : '',
    accountId: capture.account_id ?? '',
    categoryId: suggestion?.categoryId ?? '',
    tags: suggestion?.tag ? [suggestion.tag] : [],
  }
}

function isDirty(capture, draft) {
  const original = draftFor(capture)
  return ['purpose', 'amount', 'accountId', 'categoryId', 'tags'].some((k) => String(original[k]) !== String(draft[k]))
}

// Bandeja de Gastos para las compras que llegaron solas desde el teléfono
// (Apple Pay vía Atajos, notificación del banco vía MacroDroid), ver
// .claude/rules/captura-automatica.md. Dos casos:
//   - Ya guardada (transaction_id): cuenta como gasto desde que llegó, con la
//     categoría aprendida del historial. Esto es el recordatorio para
//     rectificarla: "Está bien" / "Guardar cambios" la marca revisada.
//   - Sin guardar (no se leyó el monto, o la cuenta es de otra moneda): no
//     cuenta hasta completarla y tocar "Guardar".
export default function AutoCaptureQueue({ accounts, categories, onConfirmed }) {
  const [captures, setCaptures] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [tagInputs, setTagInputs] = useState({}) // { [captureId]: texto del tag que se está escribiendo }

  async function reload() {
    try {
      const rows = await listPendingCaptures()
      setCaptures(rows)
      const suggestions = await Promise.all(
        rows.map((c) => (!c.transactions && c.merchant ? suggestCategoryForPurpose(c.merchant).catch(() => null) : null))
      )
      setDrafts((prev) => {
        const next = {}
        rows.forEach((c, i) => { next[c.id] = prev[c.id] ?? draftFor(c, suggestions[i]) })
        return next
      })
    } catch {
      // Tabla todavía no creada en la base viva: la cola simplemente no aparece.
      setCaptures([])
    }
  }

  useEffect(() => { reload() }, [])

  if (!captures || captures.length === 0) return null

  const savedCount = captures.filter((c) => c.transaction_id).length

  function patch(id, fields) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } }))
  }

  // Mismo formato de tags que el resto de la app (normalizeTag: minúsculas,
  // guion bajo → espacio), sin repetir.
  function addTag(captureId) {
    const tag = normalizeTag((tagInputs[captureId] ?? '').replace(/^#/, ''))
    if (tag && !drafts[captureId].tags.includes(tag)) patch(captureId, { tags: [...drafts[captureId].tags, tag] })
    setTagInputs((prev) => ({ ...prev, [captureId]: '' }))
  }

  function removeTag(captureId, tag) {
    patch(captureId, { tags: drafts[captureId].tags.filter((t) => t !== tag) })
  }

  async function handleSave(capture) {
    const draft = drafts[capture.id]
    // Un tag escrito pero sin confirmar con Enter también se guarda.
    const pendingTag = normalizeTag((tagInputs[capture.id] ?? '').replace(/^#/, ''))
    const tags = pendingTag && !draft.tags.includes(pendingTag) ? [...draft.tags, pendingTag] : draft.tags
    const account = accounts.find((a) => a.id === draft.accountId)
    const values = {
      purpose: draft.purpose.trim() || 'Compra',
      amount: Number(draft.amount),
      accountId: draft.accountId || null,
      categoryId: draft.categoryId || null,
      currency: account?.currency || capture.transactions?.currency || capture.currency,
      tags,
    }
    setBusyId(capture.id)
    setError(null)
    try {
      if (capture.transaction_id) await reviewCapture(capture, values)
      else await confirmCapture(capture, values)
      setCaptures((prev) => prev.filter((c) => c.id !== capture.id))
      onConfirmed?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function doRemove() {
    const capture = confirmRemove
    setConfirmRemove(null)
    try {
      if (capture.transaction_id) {
        await deleteCapturedTransaction(capture)
        onConfirmed?.()
      } else {
        await discardCapture(capture.id)
      }
      setCaptures((prev) => prev.filter((c) => c.id !== capture.id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Card title={`Capturas automáticas por revisar (${captures.length})`} className="span-3">
      <p className={styles.caption}>
        {savedCount > 0
          ? 'Estas compras llegaron solas desde tu teléfono y ya se guardaron como gasto. Revisa que la categoría y la cuenta sean correctas: lo que corrijas se aprende para la próxima compra en ese comercio.'
          : 'Estas compras llegaron desde tu teléfono pero faltan datos: complétalas para guardarlas.'}
      </p>
      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.list}>
        {captures.map((c) => {
          const draft = drafts[c.id]
          if (!draft) return null
          const saved = !!c.transaction_id
          const account = accounts.find((a) => a.id === draft.accountId)
          const amountCurrency = account ? account.currency || 'COP' : c.currency
          const currencyMismatch = account && (account.currency || 'COP') !== c.currency
          const canSave = Number(draft.amount) > 0 && busyId !== c.id
          const dirty = saved && (isDirty(c, draft) || !!(tagInputs[c.id] ?? '').trim())
          const categoryName = categories.find((cat) => cat.id === draft.categoryId)?.name
          return (
            <li key={c.id} className={styles.item}>
              <div className={styles.header}>
                <div>
                  <div className={styles.merchant}>{c.merchant ?? 'Compra sin comercio reconocido'}</div>
                  <div className={styles.meta}>
                    {formatWhen(c.occurred_at)}
                    {c.amount != null && <> · {formatByCurrency(c.amount, c.currency)}</>}
                  </div>
                </div>
                <div className={styles.badges}>
                  <span className={styles.badge}>{SOURCE_LABEL[c.source] ?? c.source}</span>
                  {saved
                    ? <span className={`${styles.badge} ${styles.badgeSaved}`}>Guardada · revisar</span>
                    : <span className={`${styles.badge} ${styles.badgeMissing}`}>Sin guardar</span>}
                </div>
              </div>

              {saved && !draft.categoryId && (
                <InfoCard tone="warning">
                  Se guardó sin categoría porque es la primera compra en este comercio. Elígela abajo y la próxima vez se pondrá sola.
                </InfoCard>
              )}
              {saved && draft.categoryId && !dirty && (
                <p className={styles.meta}>Categoría puesta automáticamente: <strong>{categoryName ?? '—'}</strong>. ¿Es correcta?</p>
              )}

              {c.raw_text && (c.amount == null || !c.merchant) && (
                <p className={styles.rawText}>“{c.raw_text}”</p>
              )}

              <div className={styles.fields}>
                <Field label="Descripción">
                  <input
                    className={styles.input}
                    value={draft.purpose}
                    onChange={(e) => patch(c.id, { purpose: e.target.value })}
                  />
                </Field>
                <Field label="Monto" hint={amountCurrency}>
                  <input
                    className={styles.input}
                    type="number" inputMode="decimal" step="any"
                    value={draft.amount}
                    placeholder={c.amount == null ? 'Escribe el monto' : ''}
                    onChange={(e) => patch(c.id, { amount: e.target.value })}
                  />
                </Field>
                <Field label="Cuenta">
                  <AccountAutocomplete
                    accounts={accounts}
                    value={draft.accountId}
                    onChange={(id) => patch(c.id, { accountId: id })}
                  />
                </Field>
              </div>

              {currencyMismatch && !saved && (
                <InfoCard tone="warning">
                  La compra llegó en {c.currency} y la cuenta está en {account.currency}: escribe el monto en {account.currency} antes de guardar.
                </InfoCard>
              )}

              <Field label="Categoría">
                <CategoryEmojiGrid
                  categories={categories}
                  selectedId={draft.categoryId}
                  onSelect={(id) => patch(c.id, { categoryId: id ?? '' })}
                />
              </Field>

              <Field label="Tags (opcional)">
                <div className={styles.tagsEditor}>
                  {draft.tags.map((tag) => (
                    <span key={tag} className={styles.tagPill}>
                      #{tag}
                      <button type="button" className={styles.tagRemove} aria-label={`Quitar #${tag}`} onClick={() => removeTag(c.id, tag)}>×</button>
                    </span>
                  ))}
                  <input
                    className={styles.tagInput}
                    placeholder="#agregar tag"
                    value={tagInputs[c.id] ?? ''}
                    onChange={(e) => setTagInputs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(c.id) }
                    }}
                    onBlur={() => addTag(c.id)}
                  />
                </div>
              </Field>

              <div className={styles.actions}>
                <button type="button" className={styles.discard} onClick={() => setConfirmRemove(c)}>
                  {saved ? 'Eliminar' : 'Descartar'}
                </button>
                <button type="button" className={styles.confirm} disabled={!canSave} onClick={() => handleSave(c)}>
                  {busyId === c.id ? 'Guardando…' : saved ? (dirty ? 'Guardar cambios' : 'Está bien') : 'Guardar'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={!!confirmRemove}
        title={confirmRemove?.transaction_id ? '¿Eliminar este gasto?' : '¿Descartar esta captura?'}
        message={confirmRemove?.transaction_id
          ? 'Se borra el gasto que se guardó automáticamente. Úsalo si no fue una compra real o si ya la tenías cargada.'
          : 'No se registrará ningún gasto. Úsalo si no fue una compra real o si ya la cargaste a mano.'}
        confirmLabel={confirmRemove?.transaction_id ? 'Eliminar' : 'Descartar'}
        destructive
        onConfirm={doRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </Card>
  )
}
