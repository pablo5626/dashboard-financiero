export const CURRENCIES = ['COP', 'USD', 'EUR']

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })

export function formatCOP(value) {
  return cop.format(value)
}

export function formatUSD(value) {
  return usd.format(value)
}

export function formatEUR(value) {
  return eur.format(value)
}

const formattersByCurrency = { USD: formatUSD, EUR: formatEUR }

export function formatByCurrency(value, currency) {
  return (formattersByCurrency[currency] ?? formatCOP)(value)
}

// Etiqueta compacta para ejes de gráficos (nunca para valores mostrados al
// usuario como cifra principal) — sin símbolo de moneda, sirve igual para
// series en COP, USD o EUR. Usa K por debajo de 1M para no perder precisión
// y terminar con ticks duplicados (ej. -220K y -240K ambos redondeando a
// "-0.2M" si se forzara siempre a millones).
export function formatCompact(value) {
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`
  return `${value}`
}
