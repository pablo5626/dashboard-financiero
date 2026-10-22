import { useState, useEffect, useRef } from 'react'
import Card from './Card.jsx'
import { Field, Segmented } from './FormKit.jsx'
import { exportTransactionsCSV } from '../../lib/transactionsApi.js'

const PERIOD_OPTIONS = [
  { value: 'mes', label: 'Mes' },
  { value: 'trimestre', label: 'Trimestre' },
  { value: 'semestre', label: 'Semestre' },
  { value: 'ano', label: 'Año' },
]

const MES_OPTIONS = [
  { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' }, { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' }, { value: 5, label: 'Mayo' }, { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' }, { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' }, { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
]

const TRIMESTRE_OPTIONS = [
  { value: 1, label: 'Q1 (Ene–Mar)' }, { value: 2, label: 'Q2 (Abr–Jun)' },
  { value: 3, label: 'Q3 (Jul–Sep)' }, { value: 4, label: 'Q4 (Oct–Dic)' },
]

const SEMESTRE_OPTIONS = [
  { value: 1, label: 'S1 (Ene–Jun)' }, { value: 2, label: 'S2 (Jul–Dic)' },
]

const anioActual = new Date().getFullYear()
const ANIO_OPTIONS = Array.from({ length: 11 }, (_, i) => ({ value: anioActual - 5 + i, label: String(anioActual - 5 + i) }))

const buttonStyle = {
  minHeight: 'var(--touch-target)',
  borderRadius: 10,
  border: 'none',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--series-1)',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
  fontSize: 'var(--font-body)',
}

const buttonDisabledStyle = { ...buttonStyle, opacity: 0.6, cursor: 'not-allowed' }

// Dropdown custom que respeta el tema oscuro de la app y no se desborda
// como el <select> nativo (que abre un fondo blanco fuera del panel).
function CustomSelect({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  function handleClickOutside(e) {
    if (ref.current && !ref.current.contains(e.target)) {
      setOpen(false)
    }
  }

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selected = options.find((o) => o.value === value) ?? options[0]

  const triggerStyle = {
    minHeight: 'var(--touch-target)',
    borderRadius: 10,
    border: '1px solid var(--border-hairline)',
    padding: '0 var(--space-1)',
    width: '100%',
    background: 'var(--surface-1)',
    color: 'var(--text-primary)',
    fontSize: 'var(--font-body)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    textAlign: 'left',
  }

  const dropdownStyle = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    width: '100%',
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-hairline)',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    zIndex: 200,
    maxHeight: 260,
    overflowY: 'auto',
  }

  const optionStyle = (isSelected) => ({
    padding: 'var(--space-1) var(--space-2)',
    color: isSelected ? 'var(--series-1)' : 'var(--text-primary)',
    background: isSelected
      ? 'color-mix(in srgb, var(--series-1) 12%, var(--surface-1))'
      : 'transparent',
    cursor: 'pointer',
    fontSize: 'var(--font-body)',
    borderBottom: '1px solid var(--border-hairline)',
    ':hover': { background: 'var(--surface-1)' },
  })

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <Field label={label}>
        <button type="button" onClick={() => setOpen((prev) => !prev)} style={triggerStyle}>
          <span>{selected.label}</span>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>▾</span>
        </button>
      </Field>
      {open && (
        <div style={dropdownStyle}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { setOpen(false); onChange(o.value) }}
              style={optionStyle(o.value === value)}
            >
              {o.label}
              {o.value === value && (
                <span style={{ float: 'right', color: 'var(--series-1)' }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ExportMovimientosCSV() {
  const [tipo, setTipo] = useState('mes')
  const [anio, setAnio] = useState(anioActual)
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [trimestre, setTrimestre] = useState(3)
  const [semestre, setSemestre] = useState(2)
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  async function handleExportar() {
    setCargando(true)
    setError(null)
    setResultado(null)
    try {
      const result = await exportTransactionsCSV({ tipo, anio, mes, trimestre, semestre })

      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.nombreArchivo
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setResultado(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  let selectorPeriodo
  switch (tipo) {
    case 'mes':
      selectorPeriodo = (
        <CustomSelect label="Mes" value={mes} options={MES_OPTIONS} onChange={(v) => setMes(v)} />
      )
      break
    case 'trimestre':
      selectorPeriodo = (
        <Field label="Trimestre">
          <Segmented options={TRIMESTRE_OPTIONS} value={trimestre} onChange={(v) => setTrimestre(v)} />
        </Field>
      )
      break
    case 'semestre':
      selectorPeriodo = (
        <Field label="Semestre">
          <Segmented options={SEMESTRE_OPTIONS} value={semestre} onChange={(v) => setSemestre(v)} />
        </Field>
      )
      break
    case 'ano':
      selectorPeriodo = null
      break
  }

  return (
    <Card title="Exportar movimientos a CSV" style={{ marginBottom: 'var(--space-3)' }}>
      <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', margin: '0 0 var(--space-2) 0' }}>
        Descargá los movimientos de cuentas de un período. Se excluyen los traslados entre cuentas y las filas marcadas para ignorar.
      </p>

      <Field label="Período">
        <Segmented options={PERIOD_OPTIONS} value={tipo} onChange={(v) => { setTipo(v); setResultado(null) }} />
      </Field>

      <CustomSelect label="Año" value={anio} options={ANIO_OPTIONS} onChange={(v) => { setAnio(v); setResultado(null) }} />

      {selectorPeriodo}

      <button
        type="button"
        onClick={handleExportar}
        disabled={cargando}
        style={cargando ? buttonDisabledStyle : buttonStyle}
      >
        {cargando ? 'Exportando…' : `Exportar ${resultado ? `(${resultado.count} movimiento${resultado.count === 1 ? '' : 's'})` : ''}`}
      </button>

      {error && (
        <p style={{ font: 'var(--font-caption)', color: 'var(--status-critical)', margin: 'var(--space-1) 0 0 0' }}>
          Error: {error}
        </p>
      )}

      {resultado && (
        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 'var(--space-1) 0 0 0' }}>
          ✅ Descargado: <strong>{resultado.nombreArchivo}</strong> ({resultado.count} movimiento{resultado.count === 1 ? '' : 's'})
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginLeft: 'var(--space-1)' }}>
            ({resultado.startISO.slice(0, 10)} → {resultado.endISO.slice(0, 10)})
          </span>
        </p>
      )}
    </Card>
  )
}
