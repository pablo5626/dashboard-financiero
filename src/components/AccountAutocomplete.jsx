import { useState } from 'react'
import { formatByCurrency } from '../lib/format.js'
import styles from './AccountAutocomplete.module.css'

// Cuadro de texto con sugerencias, mismo patrón de interacción que la
// descripción (escribir filtra, tocar confirma) en vez de una fila de chips
// — pensado para cuando hay muchas cuentas y la fila de chips no entra
// cómoda en pantalla. `onMouseDown` con preventDefault en cada opción evita
// que el input pierda el foco (y cierre la lista) antes de que el click
// llegue a registrarse.
//
// `balances` es opcional: { [accountId]: number }, en la moneda PRIMARIA de
// cada cuenta (mismo shape que devuelve accountsApi.fetchBalancesForMonth,
// leído con su clave "plana" — ver currencyPockets.js). Cuando viene, cada
// opción muestra el saldo del mes a la derecha, para elegir la cuenta a
// simple vista igual que la referencia de MonIA, en vez de tener que abrir
// Cuentas para recordar cuánto tiene cada una.
export default function AccountAutocomplete({ accounts, value, onChange, placeholder = 'Cuenta', balances }) {
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
              <span>{a.name}</span>
              {balances && a.id in balances && (
                <span className={styles.optionBalance}>{formatByCurrency(balances[a.id], a.currency || 'COP')}</span>
              )}
            </button>
          ))}
          {filtered.length === 0 && <p className={styles.empty}>Sin coincidencias.</p>}
        </div>
      )}
    </div>
  )
}
