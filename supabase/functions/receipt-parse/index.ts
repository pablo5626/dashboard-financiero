// Interpreta una foto de un recibo/factura (capturada o subida desde
// Diario.jsx) y extrae comercio, categoría sugerida y monto vía Gemini 2.5
// Flash (vision). Nunca escribe en la base de datos ni usa la service role
// key -- mismo patrón que voice-parse/index.ts: la invoca el navegador con
// el JWT real del usuario logueado, así que se despliega con
// verify_jwt = true (default) y no aparece en config.toml.
//
// Mismo cambio de proveedor que voice-parse/index.ts (Anthropic -> Gemini,
// misma GEMINI_API_KEY/GEMINI_MODEL) -- ver esa nota para el motivo.
//
// Las categorías posibles no están fijas acá: cada usuario tiene las suyas,
// así que el cliente las manda en el body (`categories`, solo nombres) y se
// inyectan en el prompt; sin ninguna, el modelo devuelve null en ese campo.
// Sin lista de cuentas: una foto de recibo no trae ninguna señal de qué
// cuenta se usó.
import { CORS_HEADERS, json, requireUser } from '../_shared/auth.ts'
import { consumeAiQuota } from '../_shared/quota.ts'
import { sanitizeNameList } from '../_shared/input.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_MODEL = 'gemini-2.5-flash'

function buildSystemPrompt(categories: string[]) {
  const categoryList = categories.length > 0 ? categories.join(', ') : '(ninguna todavía)'
  return `Te muestro la foto o el PDF de un recibo o factura (incluida una factura electrónica DIAN, que puede traer varias líneas de detalle) de una compra en Colombia. Devolvés SOLO un JSON estricto (sin texto extra, sin markdown) con esta forma exacta:

{"purpose":"<string o null>","amount":<number>,"categoryName":"<string o null>"}

Reglas:
- "amount": el TOTAL FINAL pagado (no un subtotal, no un impuesto ni una línea suelta), número entero positivo en pesos colombianos.
- "purpose": un nombre corto del comercio/establecimiento tal como aparece en el recibo, o null si no se alcanza a leer.
- "categoryName": la que mejor calce de esta lista exacta según el tipo de comercio, o null si no es clara o la lista está vacía: ${categoryList}.
- Nunca inventes una categoría que no esté en la lista exacta de arriba.
- Si la imagen no es un recibo legible, poné amount en null.
- Devolvé JSON válido y nada más.`
}

// 'application/pdf' cubre una factura electrónica emitida directamente en
// PDF (muy común en Colombia/DIAN) -- Gemini la lee igual que una imagen en
// el mismo campo inline_data, sin costo extra real: cobra 258 tokens por
// página (tarifa de imagen), así que una factura de 1-3 páginas cuesta
// fracciones de centavo, prácticamente lo mismo que una foto.
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_BASE64_LENGTH = 8_000_000 // ~6MB antes de base64, generoso para una foto ya redimensionada en el cliente o un PDF de pocas páginas

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

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

  const mediaType = String(body.mediaType ?? '')
  const imageBase64 = String(body.imageBase64 ?? '')
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return json({ ok: false, error: 'tipo de imagen no soportado' }, 400)
  }
  if (!imageBase64 || imageBase64.length > MAX_BASE64_LENGTH) {
    return json({ ok: false, error: 'imagen vacía o demasiado grande' }, 400)
  }

  const systemPrompt = buildSystemPrompt(sanitizeNameList(body.categories))

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
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mediaType, data: imageBase64 } },
            { text: 'Leé este recibo y devolvé el JSON pedido.' },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 300, responseMimeType: 'application/json' },
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return json({ ok: false, error: `Gemini API error: ${errText}` }, 502)
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const cleaned = rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return json({ ok: false, error: `respuesta no interpretable: ${rawText}` }, 502)
    }

    const amount = Number(parsed.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ ok: false, error: 'no se pudo leer un monto válido en la foto' }, 422)
    }

    return json({
      ok: true,
      result: {
        mode: 'gasto',
        amount,
        categoryName: parsed.categoryName || null,
        purpose: parsed.purpose || null,
      },
    })
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500)
  }
})
