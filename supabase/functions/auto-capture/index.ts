// Endpoint de captura automática de pagos (ver .claude/rules/captura-automatica.md).
// Lo llaman, sin intervención del usuario:
//   - iOS: una automatización de Atajos "Transacción" (Wallet / Apple Pay),
//     con { source: "apple_pay", amount, merchant, cuenta }.
//   - Android: una macro de MacroDroid que escucha la notificación del banco,
//     con { source: "android_notification", text, app, cuenta }.
//
// Autenticación: `Authorization: Bearer <token de captura>` (Ajustes → Captura
// automática). No es un JWT de Supabase — por eso verify_jwt = false en
// config.toml — y esta función no lo valida: se lo pasa a la RPC
// ingest_auto_capture (security definer), que busca su hash y escribe solo en
// ese usuario. Nada de lo que llega acá cuenta como gasto: entra a la bandeja
// "Capturas por revisar" hasta que el usuario lo confirma en la app.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, withCors } from '../_shared/auth.ts'
import { parseCopAmount, parseNotification } from '../_shared/notificationParsers.ts'

const MAX_TEXT = 1000

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

// withCors solo importa para el simulador (tools/simulador-captura.html,
// servido por `npm run dev` en localhost): el teléfono real no manda Origin ni
// preflight, así que para él no cambia nada.
Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
  if (!token.startsWith('cap_')) {
    return json({ ok: false, error: 'token de captura faltante' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400)
  }

  // apple_pay trae monto y comercio ya separados; el resto trae un texto que
  // se parsea acá: la notificación del banco en Android, o en iPhone el SMS
  // / correo del banco (iOS no deja leer notificaciones de otras apps, pero
  // Atajos sí se dispara al recibir un mensaje o un correo).
  const source = body.source
  const TEXT_SOURCES = ['android_notification', 'sms', 'email']
  if (source !== 'apple_pay' && !TEXT_SOURCES.includes(source as string)) {
    return json({ ok: false, error: 'source invalido (usa "apple_pay", "android_notification", "sms" o "email")' }, 400)
  }

  const cuenta = str(body.cuenta, 100)
  const app = str(body.app, 200)
  let rawText: string | null = null
  let merchant: string | null = null
  let amount: number | null = null
  let currency = 'COP'

  if (source === 'apple_pay') {
    merchant = str(body.merchant, 200)
    amount = parseCopAmount(body.amount)
    rawText = [merchant, typeof body.amount === 'number' ? String(body.amount) : str(body.amount, 50)]
      .filter(Boolean)
      .join(' · ') || null
  } else {
    rawText = str(body.text, MAX_TEXT)
    if (!rawText) return json({ ok: false, error: 'text vacio' }, 400)
    const parsed = parseNotification(rawText)
    if (parsed?.rejected) return json({ ok: true, status: 'ignored_rejected' })
    if (parsed) {
      merchant = parsed.merchant
      amount = parsed.amount
      currency = parsed.currency
    }
  }

  const fecha = str(body.fecha, 40)
  const occurredAt = fecha && !Number.isNaN(Date.parse(fecha)) ? new Date(fecha).toISOString() : new Date().toISOString()

  // Misma notificación republicada o reintento de red en el mismo minuto →
  // misma clave → la RPC la descarta (on conflict do nothing).
  const minute = Math.floor(Date.now() / 60000)
  const dedupKey = await sha256Hex(`${source}|${rawText ?? `${merchant}|${amount}`}|${minute}`)

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await client.rpc('ingest_auto_capture', {
    p_token: token,
    p_source: source,
    p_source_app: app,
    p_raw_text: rawText,
    p_merchant: merchant,
    p_amount: amount,
    p_currency: currency,
    p_occurred_at: occurredAt,
    p_account_hint: cuenta,
    p_dedup_key: dedupKey,
  })

  if (error) {
    console.error('auto-capture', error)
    return json({ ok: false, error: 'error interno' }, 500)
  }
  if (data === 'invalid_token') return json({ ok: false, error: 'token de captura invalido o revocado' }, 401)
  if (data === 'rate_limited') return json({ ok: false, error: 'demasiadas capturas hoy' }, 429)

  // Texto listo para que el atajo / la macro lo muestre como notificación del
  // celular ("Mostrar notificación" en Atajos, "Mostrar notificación" en
  // MacroDroid con la respuesta HTTP), así el usuario sabe que la lectura
  // funcionó y que tiene algo por revisar.
  const monto = amount !== null ? `$${amount.toLocaleString('es-CO')}` : null
  const lugar = merchant ? ` en ${merchant}` : ''
  const notification =
    data === 'saved'
      ? { title: 'Gasto registrado', body: `${monto}${lugar}. Revisa la categoría en Finanzas → Gastos.` }
      : data === 'inserted'
        ? { title: 'Compra por completar', body: `${monto ? monto + lugar : 'No se pudo leer el monto' + lugar}. Complétala en Finanzas → Gastos.` }
        : null

  return json({ ok: true, status: data, parsed: amount !== null, notification })
}))
