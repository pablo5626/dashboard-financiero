import styles from './ConfirmDialog.module.css'

// Reemplazo con diseño propio de window.confirm() — mismo patrón que un
// alert de iOS (título como pregunta, mensaje breve, botón destructivo +
// cancelar), ver skill ios-hig-design. Controlado con estado local en cada
// página que lo usa, sin store global.
export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', destructive = false, onConfirm, onCancel,
}) {
  if (!open) return null

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog} role="alertdialog" aria-modal="true"
        aria-labelledby="confirm-dialog-title" onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className={styles.title}>{title}</h2>
        {message && <p className={styles.message}>{message}</p>}
        <div className={styles.actions}>
          <button
            type="button" onClick={onConfirm}
            className={`${styles.button} ${destructive ? styles.destructive : styles.primary}`}
          >
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel} className={`${styles.button} ${styles.cancel}`}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
