import { supabase } from './supabaseClient.js'

// Tasa manual COP->USD (1 USD = rate COP), un único valor vigente por
// usuario. No hay historial: se sobreescribe in-place cada vez que el
// usuario la actualiza.
export async function getRate() {
  const { data, error } = await supabase.from('exchange_rates').select('*').maybeSingle()
  if (error) throw error
  return data // null si el usuario todavía no la ha configurado
}

export async function setRate(rate) {
  const current = await getRate()
  if (current) {
    const { error } = await supabase.from('exchange_rates').update({ rate, updated_at: new Date().toISOString() }).eq('id', current.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('exchange_rates').insert({ rate })
    if (error) throw error
  }
}

// Convierte a COP usando la tasa vigente. Si currency ya es COP (o falsy),
// no hace nada. Si es USD y no hay tasa configurada, devuelve 0 en vez de
// inventar una conversión — los saldos en USD quedan excluidos de los
// totales consolidados hasta que el usuario defina la tasa en Cuentas.
export function toCOP(amount, currency, rate) {
  if (currency === 'USD') {
    if (rate == null) return 0
    return amount * rate
  }
  return amount
}
