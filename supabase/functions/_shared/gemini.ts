// Configuración común de las llamadas a Gemini (voice-parse, receipt-parse,
// money-ask). El modelo sale del secret opcional GEMINI_MODEL para poder
// cambiarlo sin tocar código: `gemini-2.5-flash` dejó de estar disponible para
// API keys nuevas (responde 404 "no longer available to new users") mucho antes
// de su cierre oficial, así que el modelo por defecto es su reemplazo estable.
import { json } from './auth.ts'

export const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash'

// En la familia 3.x el "pensamiento" viene activo por defecto y cuenta contra
// maxOutputTokens: con un tope bajo el JSON puede salir cortado. Estas tareas
// son extracción/redacción simples, así que se baja al mínimo. `thinkingLevel`
// solo existe en los modelos 3.x (los 2.5 usan otro parámetro), por eso es
// condicional al nombre del modelo.
export function buildGenerationConfig(maxOutputTokens: number, extra: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = { maxOutputTokens, ...extra }
  if (GEMINI_MODEL.startsWith('gemini-3')) {
    config.thinkingConfig = { thinkingLevel: 'minimal' }
  }
  return config
}

// Respuesta al cliente cuando Gemini contestó con error. El detalle del
// proveedor queda solo en el log del servidor (lo escribe quien llama).
export function geminiErrorResponse(status: number) {
  if (status === 404) {
    return json({
      ok: false,
      error: `El modelo de IA configurado (${GEMINI_MODEL}) ya no está disponible. Hay que actualizar el secret GEMINI_MODEL.`,
    }, 502)
  }
  return json({ ok: false, error: `El servicio de IA no respondió bien (código ${status})` }, 502)
}
