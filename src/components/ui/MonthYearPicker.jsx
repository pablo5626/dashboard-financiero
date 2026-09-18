export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// Selector de mes/año compartido — extraído del picker que ya usaba la
// importación de CSV de MonIA en GastosDiarios.jsx, para no duplicarlo en
// cada página que necesita navegar un mes calendario (ver PanelGeneral.jsx).
export default function MonthYearPicker({ year, month, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <select value={month} onChange={(e) => onChange(year, Number(e.target.value))} style={formInput}>
        {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
      </select>
      <input
        type="number" value={year} onChange={(e) => onChange(Number(e.target.value), month)}
        style={{ ...formInput, width: 90 }}
      />
    </div>
  )
}

const formInput = { minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }
