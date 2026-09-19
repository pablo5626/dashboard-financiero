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

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
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
