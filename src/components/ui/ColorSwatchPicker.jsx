import styles from './ColorSwatchPicker.module.css'

const BASE_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)']

// El doble de opciones que antes (pedido explícito de "ampliar los
// colores"): los 8 tonos categóricos ya validados por la skill de dataviz,
// más una variante clara de cada uno vía color-mix — nunca un hex inventado
// suelto, solo una derivación mecánica de la paleta que ya existe.
const SWATCHES = [...BASE_COLORS, ...BASE_COLORS.map((c) => `color-mix(in srgb, ${c} 55%, white)`)]

// value='' significa "automático" (color por hash del nombre, ver
// seriesForName en CategoryEmojiGrid.jsx) — clickear el swatch ya
// seleccionado lo deselecciona y vuelve a ese automático.
export default function ColorSwatchPicker({ value, onChange }) {
  return (
    <div className={styles.wrap}>
      {SWATCHES.map((c) => (
        <button
          key={c} type="button" title={c}
          onClick={() => onChange(value === c ? '' : c)}
          className={value === c ? `${styles.swatch} ${styles.selected}` : styles.swatch}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}
