// Helpers compartidos por las Edge Functions que actúan en nombre de un
// usuario logueado (voice-parse, receipt-parse, money-ask, quick-capture).
//
// El cliente que devuelve requireUser usa la anon key + el JWT del propio
// usuario, así que RLS sigue aplicando: ninguna de estas funciones necesita
// (ni usa) la service role key. Ojo: con verify_jwt = true el gateway de
// Supabase también acepta la anon key pública, que no identifica a nadie —
// por eso además se llama a auth.getUser() acá y se rechaza si no hay un
// usuario real detrás del token.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

// Orígenes que pueden llamar a estas funciones desde un navegador. La app
// publicada (y el APK, que la abre en Chrome) vive en el primero; los demás
// son desarrollo local, incluida la red local para probar desde el teléfono.
// Se pueden agregar más con el secret ALLOWED_ORIGINS (separados por comas).
const DEFAULT_ALLOWED_ORIGINS = ['https://pablo5626.github.io']
const EXTRA_ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS])
const DEV_ORIGIN =
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/

function isAllowedOrigin(origin: string | null): origin is string {
  return !!origin && (ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin))
}

function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Envuelve un handler para las funciones que llama el navegador: responde el
// preflight y agrega los headers CORS solo si el origen está permitido. Un
// origen ajeno no recibe Access-Control-Allow-Origin, así que el navegador
// bloquea la lectura de la respuesta.
export function withCors(handler: (req: Request) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin')
    const cors = corsHeadersFor(origin)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: cors })
    }

    const res = await handler(req)
    const headers = new Headers(res.headers)
    for (const [key, value] of Object.entries(cors)) headers.set(key, value)
    return new Response(res.body, { status: res.status, headers })
  }
}

// Igual que a === b pero sin cortocircuitar en el primer carácter distinto,
// para que el tiempo de respuesta no filtre qué tan cerca estuvo un secreto.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ba.length ^ bb.length
  for (let i = 0; i < Math.max(ba.length, bb.length); i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

export async function requireUser(
  req: Request
): Promise<{ client: SupabaseClient; userId: string } | { error: Response }> {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return { error: json({ ok: false, error: 'no autenticado' }, 401) }
  }
  const token = authHeader.slice('Bearer '.length).trim()

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) {
    return { error: json({ ok: false, error: 'sesión inválida o vencida' }, 401) }
  }
  return { client, userId: data.user.id }
}
