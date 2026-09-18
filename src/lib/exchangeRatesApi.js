import { supabase } from './supabaseClient.js'

// Tasas manuales por par de monedas (COP<->USD, COP<->EUR, USD<->EUR...),
// una fila vigente por par y por usuario. Sin historial: se sobreescribe
// in-place cada vez que el usuario la actualiza.
export async function getRates() {
  const { data, error } = await supabase.from('exchange_rates').select('*')
  if (error) throw error
  return data // [] si el usuario todavía no ha configurado ninguna
}

export async function setRate(baseCurrency, quoteCurrency, rate) {
  const { error } = await supabase.from('exchange_rates').upsert(
    { base_currency: baseCurrency, quote_currency: quoteCurrency, rate, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,base_currency,quote_currency' }
  )
  if (error) throw error
}

// Busca la tasa del día para un par vía una API pública de tipos de cambio
// (open.er-api.com — gratis, sin API key, sin CORS) en vez de pedírsela a un
// modelo de lenguaje: una tasa de cambio es un dato vivo, no algo que una IA
// "sepa" de forma confiable (entrenada hasta cierta fecha, sin acceso a
// internet real) — usar un endpoint de datos es lo que evita inventar un
// número, mismo principio de "nunca adivinar" que rige toda la app. Nunca
// escribe en la base — solo devuelve el valor para PRELLENAR el input
// manual de la fila de tasa correspondiente; el usuario sigue tocando
// "Guardar" para confirmarlo, igual que voice-parse/receipt-parse.
// `quote`/`base` usan la misma convención que setRate/renderRateRow: el
// resultado es "1 quote = rate base".
export async function fetchLiveRate(base, quote) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${quote}`)
  if (!res.ok) throw new Error('No se pudo consultar la tasa de cambio')
  const data = await res.json()
  const rate = data?.rates?.[base]
  if (typeof rate !== 'number') throw new Error(`Sin dato de ${base} para ${quote}`)
  return rate
}

// Convierte un monto de una moneda a otra usando la fila que coincida con
// el par (directa: base=to/quote=from, o inversa: base=from/quote=to).
// Devuelve null si no hay ninguna tasa configurada para ese par.
export function convertAmount(amount, from, to, rates) {
  if (from === to) return amount
  const direct = rates.find((r) => r.base_currency === to && r.quote_currency === from)
  if (direct) return amount * direct.rate
  const inverse = rates.find((r) => r.base_currency === from && r.quote_currency === to)
  if (inverse) return amount / inverse.rate
  return null
}

// Convierte a COP usando las tasas vigentes. Si currency ya es COP (o
// falsy), no hace nada. Si no hay tasa configurada hacia COP para esa
// moneda, devuelve 0 en vez de inventar una conversión — los saldos en esa
// moneda quedan excluidos de los totales consolidados hasta que el usuario
// defina la tasa en Cuentas.
export function toCOP(amount, currency, rates) {
  if (!currency || currency === 'COP') return amount
  return convertAmount(amount, currency, 'COP', rates) ?? 0
}
