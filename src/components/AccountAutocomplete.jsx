import { useState } from 'react'
import styles from './AccountAutocomplete.module.css'

// Cuadro de texto con sugerencias, mismo patrón de interacción que la
// descripción (escribir filtra, tocar confirma) en vez de una fila de chips
// — pensado para cuando hay muchas cuentas y la fila de chips no entra
// cómoda en pantalla. `onMouseDown` con preventDefault en cada opción evita
// que el input pierda el foco (y cierre la lista) antes de que el click
// llegue a registrarse.
export default function AccountAutocomplete({ accounts, value, onChange, placeholder = 'Cuenta' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = accounts.find((a) => a.id === value)
  const displayValue = open ? query : (selected?.name ?? '')
  const filtered = query.trim()
    ? accounts.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : accounts

  function handleFocus() {
    setQuery('')
    setOpen(true)
  }

  function handleChange(e) {
    setQuery(e.target.value)
    if (value) onChange('')
  }

  function handlePick(a) {
    onChange(a.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={styles.wrap}>
      <input
        className={styles.input}
        placeholder={placeholder}
        value={displayValue}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <div className={styles.dropdown}>
          {filtered.map((a) => (
            <button
              key={a.id} type="button" className={styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handlePick(a)}
            >
              {a.name}
            </button>
          ))}
          {filtered.length === 0 && <p className={styles.empty}>Sin coincidencias.</p>}
        </div>
      )}
    </div>
  )
}
