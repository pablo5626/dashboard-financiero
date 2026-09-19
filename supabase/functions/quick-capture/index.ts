// Endpoint único para los Shortcuts de iOS "Gasto rápido" y "Transferencia
// rápida" (ver .claude/rules/shortcuts-ios.md). Reemplaza el flujo de armar el
// JSON completo y resolver UUIDs a mano por una sola llamada: el Shortcut solo
// manda nombres de cuenta y un monto, y esta función resuelve el resto.
//
// Multiusuario: cada persona usa el JWT de su propia sesión (el Shortcut hace
// primero el login con su correo y contraseña y manda `Authorization: Bearer
// <access_token>`). El cliente que arma requireUser usa ese JWT, así que RLS
// decide qué cuentas ve y solo puede escribir filas propias -- ya no hay
// service role key, secreto compartido ni user_id fijo.

import { json, requireUser } from '../_shared/auth.ts'

// Misma normalización que parseMonIACSV en transactionsApi.js: MonIA (y por
// consistencia, el Shortcut) no puede escribir espacios en un tag, así que
// "arq_eur" debe seguir resolviendo a la cuenta "arq eur".
function normalizeName(name: string) {
  return name.toLowerCase().trim().replace(/_/g, ' ')
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

  const auth = await requireUser(req)
  if ('error' in auth) return auth.error
  const { client, userId } = auth

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

  async function findAccount(name: string) {
    const target = normalizeName(name)
    const { data, error } = await client
      .from('accounts')
      .select('id, name, currency')
      .eq('is_active', true)
    if (error) throw error
    return (data ?? []).find((a: { name: string }) => normalizeName(a.name) === target) ?? null
  }

  try {
    if (body.action === 'expense') {
      const cuentaNombre = String(body.cuenta ?? '')
      const account = await findAccount(cuentaNombre)
      if (!account) {
        return json({ ok: false, error: `cuenta "${cuentaNombre}" no encontrada` }, 404)
      }

      const now = new Date()
      const { error } = await client.from('transactions').insert({
        user_id: userId,
        monia_id: `shortcut-${now.getTime()}-${randomDigits(4)}`,
        occurred_at: now.toISOString(),
        purpose: 'Gasto rápido',
        amount: -Math.abs(monto),
        // La moneda sale de la cuenta: fetchBalancesForMonth solo suma filas
        // cuya moneda coincide con la de la cuenta, así que un gasto en COP
        // contra una cuenta USD/EUR se descartaría en silencio del saldo.
        currency: account.currency || 'COP',
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

      // El Shortcut puede mandar la fecha local del teléfono (`fecha`,
      // yyyy-MM-dd). Si no la manda, se calcula la de Bogotá (UTC-5 fijo, sin
      // horario de verano): current_date en Postgres sería UTC y desde las
      // 7pm en Bogotá ya marcaría el día siguiente (ver shortcuts-ios.md).
      const fecha = typeof body.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : null
      const transferDate =
        fecha ??
        new Intl.DateTimeFormat('en-CA', {
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

      const { error } = await client.from('account_transfers').upsert(
        {
          user_id: userId,
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
