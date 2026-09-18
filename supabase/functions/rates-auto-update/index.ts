// Actualiza automáticamente exchange_rates una vez al día (disparado por
// .github/workflows/update-rates.yml) para que el usuario no tenga que
// entrar a Ajustes → Tasas de cambio y tocar "Buscar"/"Guardar" a mano.
// Mismo patrón de auth que quick-capture/index.ts: no hay JWT de usuario
// real (un cron no tiene sesión), así que se usa la service role key
// (bypassa RLS a propósito) + un secreto propio validado por header
// (x-rates-cron-secret) en vez de JWT -- por eso se despliega con
// verify_jwt = false (supabase/config.toml).
//
// Siempre sobreescribe la tasa guardada, sin importar si el usuario la
// había editado a mano -- pedido explícito del usuario ("que se actualice
// siempre a la tasa diaria sin importar la que yo ponga").

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RATES_CRON_SECRET = Deno.env.get('RATES_CRON_SECRET')!
const QUICK_CAPTURE_USER_ID = Deno.env.get('QUICK_CAPTURE_USER_ID')!

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Mismo criterio que CATEGORIES en voice-parse/receipt-parse: una Edge
// Function no puede importar src/lib/format.js (otro runtime), así que la
// lista de monedas no-COP se duplica acá a mano -- mantenerla en sync con
// CURRENCIES si se agrega una moneda nueva ahí.
const COP_PAIR_CURRENCIES = ['USD', 'EUR', 'DOP', 'PEN', 'ARS', 'MXN', 'BRL', 'CLP', 'GBP']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function fetchRates(quote: string): Promise<Record<string, number>> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${quote}`)
  if (!res.ok) throw new Error(`No se pudo consultar open.er-api.com para ${quote}`)
  const data = await res.json()
  if (!data?.rates) throw new Error(`Respuesta sin "rates" para ${quote}`)
  return data.rates
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405)
  }

  if (req.headers.get('x-rates-cron-secret') !== RATES_CRON_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  try {
    // Una sola consulta cubre TODAS las monedas COP-X, sin importar cuántas
    // haya: open.er-api.com devuelve la tasa de todas las monedas relativas
    // a la base pedida en la misma respuesta. La convención de la app es
    // "1 quote = rate base" (ver exchangeRatesApi.js), así que para el par
    // (COP, X) hace falta el recíproco de "X por 1 COP".
    const copRates = await fetchRates('COP')
    const updates: Array<{ user_id: string; base_currency: string; quote_currency: string; rate: number; updated_at: string }> = []
    const now = new Date().toISOString()

    for (const currency of COP_PAIR_CURRENCIES) {
      const xPerCop = copRates[currency]
      if (typeof xPerCop !== 'number' || xPerCop <= 0) continue
      updates.push({
        user_id: QUICK_CAPTURE_USER_ID,
        base_currency: 'COP',
        quote_currency: currency,
        rate: 1 / xPerCop,
        updated_at: now,
      })
    }

    // Par especial USD-EUR (por las dos pockets de arq) -- no se deriva de
    // pivotear por COP, se consulta directo (ver CLAUDE.md, "Multi-currency").
    const eurRates = await fetchRates('EUR')
    if (typeof eurRates.USD === 'number' && eurRates.USD > 0) {
      updates.push({
        user_id: QUICK_CAPTURE_USER_ID,
        base_currency: 'USD',
        quote_currency: 'EUR',
        rate: eurRates.USD,
        updated_at: now,
      })
    }

    const { error } = await supabase
      .from('exchange_rates')
      .upsert(updates, { onConflict: 'user_id,base_currency,quote_currency' })
    if (error) return json({ ok: false, error: error.message }, 500)

    return json({ ok: true, updated: updates.length })
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500)
  }
})
