export const CURRENCIES = ['COP', 'USD', 'EUR', 'DOP', 'PEN', 'ARS', 'MXN', 'BRL', 'CLP', 'GBP']

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const dop = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 2 })
const pen = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 2 })
const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })
const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 })
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
// CLP no usa decimales en la práctica (igual que COP) — Intl ya lo sabe por
// la moneda, pero se lo forzamos explícito para que no dependa del default.
const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 })

export function formatCOP(value) {
  return cop.format(value)
}

export function formatUSD(value) {
  return usd.format(value)
}

export function formatEUR(value) {
  return eur.format(value)
}

export function formatDOP(value) {
  return dop.format(value)
}

export function formatPEN(value) {
  return pen.format(value)
}

export function formatARS(value) {
  return ars.format(value)
}

export function formatMXN(value) {
  return mxn.format(value)
}

export function formatBRL(value) {
  return brl.format(value)
}

export function formatCLP(value) {
  return clp.format(value)
}

export function formatGBP(value) {
  return gbp.format(value)
}

const formattersByCurrency = {
  USD: formatUSD, EUR: formatEUR, DOP: formatDOP, PEN: formatPEN, ARS: formatARS,
  MXN: formatMXN, BRL: formatBRL, CLP: formatCLP, GBP: formatGBP,
}

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
