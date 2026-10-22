import { useState } from 'react'
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

const selectStyle = {
  minHeight: 'var(--touch-target)',
  borderRadius: 10,
  border: '1px solid var(--border-hairline)',
  padding: '0 var(--space-1)',
  width: '100%',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-body)',
}

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

export default function ExportMovimientosCSV() {
  const [tipo, setTipo] = useState('mes')
  const [anio, setAnio] = useState(anioActual)
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [trimestre, setTrimestre] = useState(3)
  const [semestre, setSemestre] = useState(2)
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState(null) // { nombreArchivo, count, startISO, endISO }
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
        <Field label="Mes">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={selectStyle}>
            {MES_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
      )
      break
    case 'trimestre':
      selectorPeriodo = (
        <Field label="Trimestre">
          <Segmented options={TRIMESTRE_OPTIONS} value={trimestre} onChange={(v) => setTrimestre(Number(v))} />
        </Field>
      )
      break
    case 'semestre':
      selectorPeriodo = (
        <Field label="Semestre">
          <Segmented options={SEMESTRE_OPTIONS} value={semestre} onChange={(v) => setSemestre(Number(v))} />
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

      <Field label="Año">
        <select value={anio} onChange={(e) => { setAnio(Number(e.target.value)); setResultado(null) }} style={selectStyle}>
          {ANIO_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </Field>

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
