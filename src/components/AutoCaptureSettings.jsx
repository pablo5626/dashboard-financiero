import { useEffect, useState } from 'react'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { Field, InfoCard, ChipPicker } from './ui/FormKit.jsx'
import { listAccounts } from '../lib/accountsApi.js'
import { listCaptureTokens, createCaptureToken, deleteCaptureToken, autoCaptureEndpoint } from '../lib/autoCaptureApi.js'
import styles from './SettingsPanel.module.css'
import guide from './AutoCaptureSettings.module.css'

// Cuerpos JSON por plataforma (ver .claude/rules/captura-automatica.md). Los
// [corchetes] son variables de MacroDroid; los <ángulos>, variables de Atajos.
// `cuenta` sale de la cuenta que el usuario elige arriba: cada persona tiene
// sus propias cuentas, no hay un nombre fijo. El servidor compara sin
// mayúsculas y con "_" como espacio, así que el nombre tal cual sirve.
const GUIDE_EXAMPLES = [
  { label: 'Android · notificación del banco (MacroDroid)', body: (c) => `{"source": "android_notification", "text": "[notification_title] [notification]", "app": "[app_package]", "cuenta": ${JSON.stringify(c)}}` },
  { label: 'iPhone · pago con Apple Pay (Atajos → Transacción)', body: (c) => `{"source": "apple_pay", "amount": <Cantidad>, "merchant": <Comercio>, "cuenta": ${JSON.stringify(c)}}` },
  { label: 'iPhone · SMS del banco (Atajos → Mensaje)', body: (c) => `{"source": "sms", "text": <Contenido del mensaje>, "cuenta": ${JSON.stringify(c)}}` },
  { label: 'iPhone · correo del banco (Atajos → Correo)', body: (c) => `{"source": "email", "text": <Asunto> <Contenido>, "cuenta": ${JSON.stringify(c)}}` },
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
  const [accounts, setAccounts] = useState([])
  const [guideAccount, setGuideAccount] = useState('')
  const [copiedLabel, setCopiedLabel] = useState(null)

  async function reload() {
    try {
      setTokens(await listCaptureTokens())
    } catch (err) {
      setError(err.message)
      setTokens([])
    }
  }

  useEffect(() => {
    listAccounts()
      .then((rows) => {
        setAccounts(rows)
        setGuideAccount((prev) => prev || rows.find((a) => a.kind === 'hija')?.name || rows[0]?.name || '')
      })
      .catch(() => {})
  }, [])

  async function copyText(label, text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedLabel(label)
      setTimeout(() => setCopiedLabel(null), 2000)
    } catch {
      // Sin portapapeles (http:// en LAN): el bloque es seleccionable a mano.
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
          Haz <strong>una automatización por banco o tarjeta</strong>. Elige a qué cuenta tuya van sus compras y
          copia el cuerpo ya armado:
        </p>
        {accounts.length > 0 ? (
          <ChipPicker
            options={accounts.map((a) => ({ value: a.name, label: a.name }))}
            value={guideAccount}
            onChange={setGuideAccount}
          />
        ) : (
          <p className={guide.text}>Todavía no tienes cuentas: créalas en Ajustes → Cuentas.</p>
        )}
        <p className={guide.text}>
          Si el nombre de "cuenta" no coincide con ninguna, la compra igual se guarda, pero sin cuenta: te la
          pregunta en Gastos → "Pendientes de banco".
        </p>

        {GUIDE_EXAMPLES.map(({ label, body }) => {
          const text = body(guideAccount || 'NOMBRE_DE_TU_CUENTA')
          return (
            <details key={label} className={guide.example}>
              <summary>{label}</summary>
              <code className={guide.code}>{text}</code>
              <button type="button" className={guide.copy} onClick={() => copyText(label, text)}>
                {copiedLabel === label ? 'Copiado' : 'Copiar'}
              </button>
            </details>
          )
        })}

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
