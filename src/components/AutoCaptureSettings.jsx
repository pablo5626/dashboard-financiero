import { useEffect, useState } from 'react'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { Field, InfoCard } from './ui/FormKit.jsx'
import { listCaptureTokens, createCaptureToken, deleteCaptureToken, autoCaptureEndpoint } from '../lib/autoCaptureApi.js'
import styles from './SettingsPanel.module.css'
import guide from './AutoCaptureSettings.module.css'

// Cuerpos JSON por plataforma (ver .claude/rules/captura-automatica.md). Los
// [corchetes] son variables de MacroDroid; los <ángulos>, variables de Atajos.
const GUIDE_EXAMPLES = [
  { label: 'Android · notificación del banco (MacroDroid)', body: '{"source": "android_notification", "text": "[notification_title] [notification]", "app": "[app_package]", "cuenta": "nubank"}' },
  { label: 'iPhone · pago con Apple Pay (Atajos → Transacción)', body: '{"source": "apple_pay", "amount": <Cantidad>, "merchant": <Comercio>, "cuenta": "nubank"}' },
  { label: 'iPhone · SMS del banco (Atajos → Mensaje)', body: '{"source": "sms", "text": <Contenido del mensaje>, "cuenta": "bancolombia"}' },
  { label: 'iPhone · correo del banco (Atajos → Correo)', body: '{"source": "email", "text": <Asunto> <Contenido>, "cuenta": "nubank"}' },
]

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'nunca'
}

// Ajustes → Captura automática: tokens personales que el teléfono (Atajos /
// MacroDroid) manda al endpoint auto-capture en vez de la contraseña. El token
// en claro se muestra una sola vez; la base solo guarda su sha256. Borrar un
// token lo revoca al instante. Guía completa: .claude/rules/captura-automatica.md.
export default function AutoCaptureSettings() {
  const [tokens, setTokens] = useState(null)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState(null) // { label, value }
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function reload() {
    try {
      setTokens(await listCaptureTokens())
    } catch (err) {
      setError(err.message)
      setTokens([])
    }
  }

  useEffect(() => { reload() }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setCopied(false)
    try {
      const value = await createCaptureToken(label.trim())
      setNewToken({ label: label.trim() || 'Teléfono', value })
      setLabel('')
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(newToken.value)
      setCopied(true)
    } catch {
      // Sin portapapeles (http:// en LAN): el token queda seleccionable a mano.
    }
  }

  async function doDelete() {
    const token = confirmDelete
    setConfirmDelete(null)
    try {
      await deleteCaptureToken(token.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <h3 className={styles.sectionTitle}>Captura automática</h3>
      <p className={styles.hint}>
        Tu teléfono registra solo cada compra con Apple Pay (Atajos) o cada notificación del banco (MacroDroid en Android).
        Llegan a Gastos → "Capturas por revisar" y no cuentan como gasto hasta que las confirmes.
      </p>
      {error && <p className={styles.error}>{error}</p>}

      {newToken && (
        <InfoCard tone="warning">
          <strong>Token "{newToken.label}"</strong>. Cópialo ahora, no se vuelve a mostrar:
          <code style={{ display: 'block', margin: '6px 0', overflowWrap: 'anywhere', userSelect: 'all' }}>{newToken.value}</code>
          <button type="button" className={styles.saveButton} onClick={handleCopy}>
            {copied ? 'Copiado' : 'Copiar token'}
          </button>
        </InfoCard>
      )}

      <div className={styles.list}>
        {tokens === null && <p className={styles.hint}>Cargando…</p>}
        {tokens?.length === 0 && <p className={styles.hint}>Todavía no creaste ningún token.</p>}
        {tokens?.map((t) => (
          <div key={t.id} className={styles.row}>
            <span className={styles.rowName}>
              {t.label}
              <span className={styles.hint} style={{ display: 'block', margin: 0 }}>Último uso: {formatDate(t.last_used_at)}</span>
            </span>
            <button type="button" className={styles.archiveLink} onClick={() => setConfirmDelete(t)}>
              Revocar
            </button>
          </div>
        ))}
      </div>

      <form className={styles.createForm} onSubmit={handleCreate}>
        <Field label="Nuevo token">
          <input
            className={styles.textInput}
            placeholder="Nombre del teléfono (ej. iPhone)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <button type="submit" disabled={creating} className={styles.saveButton}>
          {creating ? 'Creando…' : 'Crear token'}
        </button>
      </form>

      <div className={guide.guide}>
        <h4 className={guide.title}>Cómo configurarlo</h4>
        <p className={guide.text}>Todas las opciones hacen un POST a esta dirección, con el header de abajo:</p>
        <code className={guide.code}>{autoCaptureEndpoint()}</code>
        <code className={guide.code}>Authorization: Bearer &lt;tu token&gt;</code>
        <p className={guide.text}>
          <strong>"cuenta"</strong> es el nombre de la cuenta a la que va la compra (como la llamaste en la app).
          Haz una automatización por tarjeta o banco.
        </p>

        {GUIDE_EXAMPLES.map(({ label, body }) => (
          <details key={label} className={guide.example}>
            <summary>{label}</summary>
            <code className={guide.code}>{body}</code>
          </details>
        ))}

        <p className={guide.text}>
          La respuesta trae <strong>notification.title</strong> y <strong>notification.body</strong>: muéstralos con
          "Mostrar notificación" para saber que la compra se registró.
        </p>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={`¿Revocar "${confirmDelete?.label}"?`}
        message="El teléfono que lo usa deja de poder enviar capturas. Las compras ya capturadas no se borran."
        confirmLabel="Revocar"
        destructive
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )
}
