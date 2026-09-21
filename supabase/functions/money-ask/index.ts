// "Preguntale a tu dinero": responde preguntas en lenguaje natural sobre las
// finanzas del usuario vía Gemini (modelo en _shared/gemini.ts). Nunca escribe en la base de
// datos ni usa la service role key -- mismo patrón que voice-parse/
// receipt-parse: la invoca el navegador con el JWT real del usuario
// logueado, así que se despliega con verify_jwt = true (default) y no
// aparece en config.toml.
//
// El modelo nunca calcula nada por su cuenta: el frontend (moneyAskApi.js,
// buildMoneyContext) ya arma el "context" con números reales, salidos de las
// mismas funciones que usan Panel/Cuentas/Gastos -- acá solo se le pide que
// redacte una respuesta en español a partir de esos números, nunca que
// invente uno nuevo (mismo principio de "nunca inventar" que toCOP/
// convertAmount en el resto de la app).
import { json, requireUser, withCors } from '../_shared/auth.ts'
import { consumeAiQuota } from '../_shared/quota.ts'
import { GEMINI_MODEL, buildGenerationConfig, geminiErrorResponse } from '../_shared/gemini.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const MAX_QUESTION_LENGTH = 500
const MAX_CONTEXT_LENGTH = 60_000 // caracteres del JSON ya serializado

const SYSTEM_PROMPT = `Sos el asistente financiero personal de una app de finanzas en Colombia. Te paso un JSON con datos financieros REALES del usuario (cuentas, saldos, gasto del mes por categoría y por tag, alertas, tendencia de los últimos meses, deuda total) y una pregunta en español.

Reglas:
- Respondé SOLO en base a los datos del JSON que te paso. Nunca inventes ni calcules un número que no se pueda derivar directamente de esos datos.
- Si la pregunta necesita un dato que no está en el JSON (ej. un mes muy anterior, o una categoría que no aparece), decilo explícitamente ("no tengo ese dato disponible") en vez de estimar o inventar una cifra.
- Los montos ya vienen en pesos colombianos (COP) salvo que se indique lo contrario -- formateá los montos en la respuesta como "$1.234.567", sin decimales.
- Respuesta corta y directa (1-3 frases), tono natural, sin markdown ni listas salvo que la pregunta pida explícitamente comparar varias cosas.
- Nunca dés consejos financieros genéricos no pedidos -- respondé exactamente lo que se preguntó.`

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405)
  }

  if (!GEMINI_API_KEY) {
    return json({ ok: false, error: 'GEMINI_API_KEY no configurada todavía en los secrets de Supabase' }, 500)
  }

  const auth = await requireUser(req)
  if ('error' in auth) return auth.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400)
  }

  const question = String(body.question ?? '').trim()
  if (!question) {
    return json({ ok: false, error: 'pregunta vacía' }, 400)
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return json({ ok: false, error: 'pregunta demasiado larga' }, 400)
  }
  if (!body.context || typeof body.context !== 'object') {
    return json({ ok: false, error: 'falta el contexto financiero' }, 400)
  }
  const contextJson = JSON.stringify(body.context)
  if (contextJson.length > MAX_CONTEXT_LENGTH) {
    return json({ ok: false, error: 'el contexto financiero es demasiado grande' }, 400)
  }

  const quotaError = await consumeAiQuota(auth.client)
  if (quotaError) return quotaError

  const userMessage = `Datos financieros del usuario:\n${contextJson}\n\nPregunta: ${question}`

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: buildGenerationConfig(600, { temperature: 0.2 }),
      }),
    })

    if (!response.ok) {
      // El detalle del proveedor queda solo en el log del servidor.
      console.error('Gemini error', response.status, await response.text())
      return geminiErrorResponse(response.status)
    }

    const data = await response.json()
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!answer) {
      return json({ ok: false, error: 'el modelo no devolvió una respuesta' }, 502)
    }

    return json({ ok: true, answer })
  } catch (err) {
    console.error('money-ask', err)
    return json({ ok: false, error: 'error interno' }, 500)
  }
}))
