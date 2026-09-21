// Interpreta el texto transcripto por la Web Speech API del navegador
// (botón de micrófono en QuickCaptureFAB) y lo convierte en los campos del
// formulario de captura rápida vía Gemini (modelo en _shared/gemini.ts). Nunca escribe en la
// base de datos ni usa la service role key -- a diferencia de
// quick-capture/index.ts (llamado por Shortcuts sin sesión), a esta función
// la invoca el navegador con el JWT real del usuario logueado, así que se
// despliega con verify_jwt = true (default) y no aparece en config.toml.
//
// Las categorías y cuentas que puede devolver NO están fijas acá: cada
// usuario tiene las suyas, así que el cliente las manda en el body
// (`categories` y `accounts`, solo nombres) y se inyectan en el prompt. Sin
// ninguna (usuario recién registrado), el modelo devuelve null en esos campos.
//
// Proveedor cambiado de Anthropic a Gemini a pedido del usuario (por ahora
// usa la key de Gemini que ya tiene, con posibilidad de volver a cambiar
// más adelante) -- mismo patrón de "un solo fetch directo a la API REST del
// proveedor", sin capa de abstracción multi-proveedor, para no anticipar
// una necesidad que todavía no existe.
import { json, requireUser, withCors } from '../_shared/auth.ts'
import { consumeAiQuota } from '../_shared/quota.ts'
import { sanitizeNameList } from '../_shared/input.ts'
import { GEMINI_MODEL, buildGenerationConfig, geminiErrorResponse } from '../_shared/gemini.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const MAX_TEXT_LENGTH = 1000

function listForPrompt(names: string[]) {
  return names.length > 0 ? names.join(', ') : '(ninguna todavía)'
}

function buildSystemPrompt(categories: string[], accounts: string[]) {
  return `Interpretás frases habladas en español colombiano que describen un movimiento de dinero personal, y devolvés SOLO un JSON estricto (sin texto extra, sin markdown) con esta forma exacta:

{"mode":"gasto|ingreso","amount":<number>,"categoryName":"<string o null>","accountName":"<string o null>","purpose":"<string o null>","tag":"<string o null>"}

Reglas:
- "mode": "gasto" salvo que la frase indique claramente un ingreso (recibí, me pagaron, me depositaron...).
- "amount": siempre en pesos colombianos, número entero positivo. Jerga: "mil"/"lucas" = x1.000 (ej. "15 mil" = 15000, "20 lucas" = 20000); "palo"/"palos" = x1.000.000 (ej. "1 palo" = 1000000, "2 palos y medio" = 2500000).
- "categoryName": la que mejor calce de esta lista exacta, o null si no es clara o la lista está vacía: ${listForPrompt(categories)}.
- "accountName": la cuenta mencionada, solo si calza con esta lista exacta, o null si no se menciona ninguna o la lista está vacía: ${listForPrompt(accounts)}.
- "purpose": una descripción corta de qué fue el movimiento (ej. "salchipapa"), o null si no hay nada claro más allá de monto/cuenta/categoría.
- "tag": un tag descriptivo corto en minúscula si la frase lo sugiere, o null.
- Nunca inventes una cuenta o categoría que no esté en las listas exactas de arriba.
- Devolvé JSON válido y nada más.`
}

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

  const text = String(body.text ?? '').trim()
  if (!text) {
    return json({ ok: false, error: 'texto vacío' }, 400)
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return json({ ok: false, error: 'texto demasiado largo' }, 400)
  }

  const systemPrompt = buildSystemPrompt(sanitizeNameList(body.categories), sanitizeNameList(body.accounts))

  const quotaError = await consumeAiQuota(auth.client)
  if (quotaError) return quotaError

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: buildGenerationConfig(512, { temperature: 0, responseMimeType: 'application/json' }),
      }),
    })

    if (!response.ok) {
      // El detalle del proveedor queda solo en el log del servidor: no se le
      // devuelve al cliente (puede incluir datos de la solicitud o la cuenta).
      console.error('Gemini error', response.status, await response.text())
      return geminiErrorResponse(response.status)
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const cleaned = rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return json({ ok: false, error: 'la IA devolvió una respuesta que no se pudo interpretar' }, 502)
    }

    const amount = Number(parsed.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ ok: false, error: 'no se pudo interpretar un monto válido' }, 422)
    }

    return json({
      ok: true,
      result: {
        mode: parsed.mode === 'ingreso' ? 'ingreso' : 'gasto',
        amount,
        categoryName: parsed.categoryName || null,
        accountName: parsed.accountName || null,
        purpose: parsed.purpose || null,
        tag: parsed.tag || null,
      },
    })
  } catch (err) {
    console.error('voice-parse', err)
    return json({ ok: false, error: 'error interno' }, 500)
  }
}))
