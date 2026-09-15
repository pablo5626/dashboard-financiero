// Endpoint único para los Shortcuts de iOS "Gasto rápido" y "Transferencia
// rápida" (ver .claude/rules/shortcuts-ios.md). Reemplaza el flujo
// login -> resolver UUIDs a mano -> armar el JSON completo por una sola
// llamada: el Shortcut solo manda nombres de cuenta y un monto, y esta
// función hace el resto usando la service role key (bypassa RLS a
// propósito, porque no hay JWT de usuario real en un Shortcut).
//
// Auth: no se usa el JWT de Supabase — se valida un secreto propio
// (header `x-quick-capture-secret`) contra el secret QUICK_CAPTURE_SECRET,
// y todas las filas se escriben con QUICK_CAPTURE_USER_ID (single-user app).
// Por eso el función se despliega con verify_jwt = false (supabase/config.toml).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const QUICK_CAPTURE_SECRET = Deno.env.get('QUICK_CAPTURE_SECRET')!
const QUICK_CAPTURE_USER_ID = Deno.env.get('QUICK_CAPTURE_USER_ID')!

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Misma normalización que parseMonIACSV en transactionsApi.js: MonIA (y por
// consistencia, el Shortcut) no puede escribir espacios en un tag, así que
// "arq_eur" debe seguir resolviendo a la cuenta "arq eur".
function normalizeName(name: string) {
  return name.toLowerCase().trim().replace(/_/g, ' ')
}

async function findAccount(name: string) {
  const target = normalizeName(name)
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, currency')
    .eq('user_id', QUICK_CAPTURE_USER_ID)
    .eq('is_active', true)

  if (error) throw error
  return (data ?? []).find((a: { name: string }) => normalizeName(a.name) === target) ?? null
}

function randomDigits(n: number) {
  return Math.floor(Math.random() * 10 ** n)
    .toString()
    .padStart(n, '0')
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405)
  }

  if (req.headers.get('x-quick-capture-secret') !== QUICK_CAPTURE_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400)
  }

  const monto = Number(body.monto)
  if (!Number.isFinite(monto) || monto <= 0) {
    return json({ ok: false, error: 'monto invalido' }, 400)
  }

  try {
    if (body.action === 'expense') {
      const cuentaNombre = String(body.cuenta ?? '')
      const account = await findAccount(cuentaNombre)
      if (!account) {
        return json({ ok: false, error: `cuenta "${cuentaNombre}" no encontrada` }, 404)
      }

      const now = new Date()
      const { error } = await supabase.from('transactions').insert({
        user_id: QUICK_CAPTURE_USER_ID,
        monia_id: `shortcut-${now.getTime()}-${randomDigits(4)}`,
        occurred_at: now.toISOString(),
        purpose: 'Gasto rápido',
        amount: -Math.abs(monto),
        currency: 'COP',
        account_id: account.id,
        assignment_level: 3,
        assignment_confirmed: true,
        origin: 'manual',
      })
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true })
    }

    if (body.action === 'transfer') {
      const origenNombre = String(body.origen ?? '')
      const destinoNombre = String(body.destino ?? '')
      const [origen, destino] = await Promise.all([
        findAccount(origenNombre),
        findAccount(destinoNombre),
      ])
      if (!origen) return json({ ok: false, error: `cuenta origen "${origenNombre}" no encontrada` }, 404)
      if (!destino) return json({ ok: false, error: `cuenta destino "${destinoNombre}" no encontrada` }, 404)
      if (origen.id === destino.id) {
        return json({ ok: false, error: 'origen y destino son la misma cuenta' }, 400)
      }
      if (origen.currency !== destino.currency) {
        return json(
          { ok: false, error: 'monedas distintas: usa el botón + de la app (necesita monto en ambas monedas)' },
          400
        )
      }

      // Fecha local de Bogotá (UTC-5 fijo, sin horario de verano) calculada en
      // el servidor -- current_date en Postgres sería UTC y desde las 7pm en
      // Bogotá ya marcaría el día siguiente (ver shortcuts-ios.md).
      const transferDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())

      // Idempotencia sin pedirle nada al Shortcut: un reintento de red real
      // de la MISMA llamada cae en la misma ventana de 3s y coincide en la
      // key; dos transferencias humanas genuinas entre los mismos montos y
      // cuentas casi nunca caen en la misma ventana de 3 segundos.
      const bucket = Math.floor(Date.now() / 3000)
      const idempotencyKey = `shortcut-${origen.id}-${destino.id}-${monto}-${bucket}`

      const { error } = await supabase.from('account_transfers').upsert(
        {
          user_id: QUICK_CAPTURE_USER_ID,
          from_account_id: origen.id,
          to_account_id: destino.id,
          amount: monto,
          currency: origen.currency,
          consumes_budget: true,
          transfer_date: transferDate,
          idempotency_key: idempotencyKey,
        },
        { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true }
      )
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ ok: false, error: 'action invalida (usa "expense" o "transfer")' }, 400)
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500)
  }
})
