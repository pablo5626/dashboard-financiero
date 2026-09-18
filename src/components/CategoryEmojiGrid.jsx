import styles from './CategoryEmojiGrid.module.css'

const SERIES_COUNT = 8

// Color determinístico por nombre (no aleatorio, para que la misma
// categoría siempre caiga en el mismo color entre renders) — usa los
// mismos slots categóricos ya validados (--series-1..8), nunca un hex nuevo.
export function seriesForName(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return `var(--series-${(hash % SERIES_COUNT) + 1})`
}

// categories.emoji existe en el esquema pero hasta ahora nunca se
// renderizaba en ningún lado de la app, así que la mayoría de las
// categorías probablemente no lo tengan cargado todavía — el fallback de
// letra hace que la grilla se vea completa desde el día uno, sin forzar al
// usuario a ir a ponerle emoji a cada categoría antes de poder usar esto.
// `onCreateClick` es opcional: solo se pinta el tile "+" al principio de la
// fila cuando el llamador lo pasa (hoy, solo QuickCaptureFAB.jsx, para poder
// crear una categoría sin salir de la hoja de "+") — Diario.jsx sigue usando
// este mismo componente sin ese prop y no ve ningún cambio.
export default function CategoryEmojiGrid({ categories, selectedId, onSelect, onCreateClick }) {
  return (
    <div className={styles.grid}>
      {onCreateClick && (
        <button type="button" className={styles.addTile} onClick={onCreateClick} aria-label="Nueva categoría">
          +
        </button>
      )}
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          className={c.id === selectedId ? `${styles.tile} ${styles.selected}` : styles.tile}
          onClick={() => onSelect(c.id === selectedId ? null : c.id)}
        >
          <span
            className={[
              styles.glyph,
              (c.color || !c.emoji) && styles.circle,
              !c.emoji && styles.letter,
            ].filter(Boolean).join(' ')}
            style={(c.color || !c.emoji) ? { background: c.color || seriesForName(c.name) } : undefined}
          >
            {c.emoji || c.name.charAt(0).toUpperCase()}
          </span>
          <span className={styles.name}>{c.name}</span>
        </button>
      ))}
      {categories.length === 0 && !onCreateClick && (
        <p className={styles.empty}>No hay categorías todavía — crealas en Ajustes.</p>
      )}
    </div>
  )
}
