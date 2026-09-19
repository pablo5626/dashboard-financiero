// Tope diario de llamadas de IA por usuario. Las tres funciones de IA
// comparten una sola GEMINI_API_KEY (la del dueño de la instancia), así que
// sin este límite cualquiera que se registre podría gastarla. El contador vive
// en la tabla ai_usage y lo incrementa la función SQL consume_ai_quota (ver
// schema.sql) con la RLS del propio usuario.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { json } from './auth.ts'

export const DAILY_AI_LIMIT = 60

// Devuelve una Response de error si no se puede seguir, o null si hay cupo.
export async function consumeAiQuota(client: SupabaseClient): Promise<Response | null> {
  const { data, error } = await client.rpc('consume_ai_quota', { p_limit: DAILY_AI_LIMIT })
  if (error) {
    return json({ ok: false, error: `no se pudo verificar el límite de uso de IA: ${error.message}` }, 500)
  }
  if (data === false) {
    return json(
      { ok: false, error: `Llegaste al límite de ${DAILY_AI_LIMIT} usos de IA de hoy. Vuelve a intentarlo mañana.` },
      429
    )
  }
  return null
}
