import { useEffect } from 'react'
import { IconClose } from '../icons.jsx'
import styles from './FormKit.module.css'

// Piezas del lenguaje visual de edición/alta de la app (el de Ajustes →
// Categorías y el de "Editar movimiento" en Diario/Gastos): etiqueta en
// mayúsculas arriba del control, píldoras seleccionables, switch iOS, info
// card, cabecera con avatar en vivo y hoja modal. Cada pantalla arma su propia
// composición con esto — la idea es compartir el lenguaje, no el layout.

export const inputClass = styles.textInput

export function Field({ label, hint, children }) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {hint && <span className={styles.labelHint}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function FieldRow({ children }) {
  return <div className={styles.fieldRow}>{children}</div>
}

export function InfoCard({ tone, children }) {
  return <p className={tone === 'warning' ? `${styles.infoCard} ${styles.infoCardWarning}` : styles.infoCard}>{children}</p>
}

export function SwitchRow({ title, helper, checked, onChange }) {
  return (
    <label className={styles.switchRow}>
      <span className={styles.field}>
        <span className={styles.label}>{title}</span>
        <span className={styles.helper}>{helper}</span>
      </span>
      <span className={styles.switchTrack}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={styles.switchInput} />
        <span className={styles.switchTrackBg} />
        <span className={styles.switchThumb} />
      </span>
    </label>
  )
}

// allowClear: tocar la píldora ya elegida la deselecciona (campos opcionales).
export function ChipPicker({ options, value, onChange, allowClear = false }) {
  return (
    <div className={styles.chipRow}>
      {options.map((o) => (
        <button
          key={o.value} type="button" aria-pressed={value === o.value}
          className={value === o.value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
          onClick={() => onChange(allowClear && value === o.value ? '' : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className={styles.segmentRow}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={value === o.value ? styles.segmentButtonActive : styles.segmentButton}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Contenedor de una edición inline: tarjeta con borde propia, para distinguir
// "estoy editando esto" del resto de la lista/tarjeta que la rodea.
export function EditCard({ as: Tag = 'div', children, ...rest }) {
  return <Tag className={styles.editCard} {...rest}>{children}</Tag>
}

// Cabecera: avatar cuadrado (refleja en vivo lo que se va escribiendo) +
// leyenda "EDITANDO X" con una insignia de tipo + el campo principal debajo.
// tone: 'accent' | 'good' | 'critical' | 'warning'; badgeTone igual, o
// omitido para una insignia neutra.
export function EditHeader({ avatar, tone = 'accent', caption, badge, badgeTone, children }) {
  return (
    <div className={styles.editHeader}>
      <span className={`${styles.avatar} ${styles[`tone_${tone}`]}`}>{avatar}</span>
      <div className={styles.editHeaderBody}>
        <div className={styles.captionRow}>
          <span className={styles.caption}>{caption}</span>
          {badge && (
            <span className={badgeTone ? `${styles.badge} ${styles[`badge_${badgeTone}`]}` : styles.badge}>{badge}</span>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

// onDelete (opcional): acción destructiva a la derecha — el caller es quien
// abre su ConfirmDialog, esto solo la pone a mano donde se está editando.
export function EditActions({ saving = false, disabled = false, onCancel, saveLabel = 'Guardar', onDelete, deleteLabel = 'Eliminar' }) {
  return (
    <div className={styles.actions}>
      <button type="submit" disabled={saving || disabled} className={styles.saveButton}>
        {saving ? 'Guardando…' : saveLabel}
      </button>
      <button type="button" onClick={onCancel} className={styles.cancelButton}>Cancelar</button>
      {onDelete && (
        <button type="button" onClick={onDelete} className={styles.deleteButton}>{deleteLabel}</button>
      )}
    </div>
  )
}

// Barra de avance con su leyenda, para previsualizar en vivo un % mientras
// se edita (deuda pagada, meta cumplida). color: un token, ej. 'var(--series-3)'.
export function MeterPreview({ pct, color, children }) {
  return (
    <div className={styles.meter}>
      <div className={styles.meterTrack}>
        <div className={styles.meterFill} style={{ width: `${Math.min(Math.max(pct ?? 0, 0), 100)}%`, background: color }} />
      </div>
      <span className={styles.meterCaption}>{children}</span>
    </div>
  )
}

// Hoja modal de edición: pantalla completa en móvil, tarjeta centrada en
// tablet/desktop — mismo criterio que la hoja del "+" y "Editar movimiento".
export function EditSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Cerrar">
          <IconClose width={20} height={20} />
        </button>
        {children}
      </div>
    </div>
  )
}
