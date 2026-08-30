const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export function formatCOP(value) {
  return cop.format(value)
}

export function formatUSD(value) {
  return usd.format(value)
}

export function formatByCurrency(value, currency) {
  return currency === 'USD' ? formatUSD(value) : formatCOP(value)
}

// Etiqueta compacta para ejes de gráficos (nunca para valores mostrados al
// usuario como cifra principal) — sin símbolo de moneda, sirve igual para
// series en COP o USD. Usa K por debajo de 1M para no perder precisión y
// terminar con ticks duplicados (ej. -220K y -240K ambos redondeando a
// "-0.2M" si se forzara siempre a millones).
export function formatCompact(value) {
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`
  return `${value}`
}
