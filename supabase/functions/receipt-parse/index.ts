// Interpreta una foto de un recibo/factura (capturada o subida desde
// Diario.jsx) y extrae comercio, categoría sugerida y monto vía Claude
// Haiku 4.5 (vision). Nunca escribe en la base de datos ni usa la service
// role key -- mismo patrón que voice-parse/index.ts: la invoca el navegador
// con el JWT real del usuario logueado, así que se despliega con
// verify_jwt = true (default) y no aparece en config.toml.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// Mismas categorías que voice-parse/index.ts (ver .claude/rules/nomenclatura.md)
// -- nunca las variantes del CSV de MonIA. Sin lista de cuentas: una foto de
// recibo no trae ninguna señal de qué cuenta se usó.
const CATEGORIES = [
  'Anita de mi corazón', 'Aportes', 'Compras', 'Cuidado personal',
  'Deuda o cuadre', 'Donativo', 'Educación', 'Medicina', 'Mekato', 'Mercado',
  'Ocio', 'Préstamo', 'Regalo - festividades', 'Ropa', 'Salida a comer',
  'Servicios', 'Suscripciones', 'Tarjeta', 'Transporte', 'Viaje',
]

const SYSTEM_PROMPT = `Te muestro la foto de un recibo o factura de una compra en Colombia. Devolvés SOLO un JSON estricto (sin texto extra, sin markdown) con esta forma exacta:

{"purpose":"<string o null>","amount":<number>,"categoryName":"<string o null>"}

Reglas:
- "amount": el TOTAL FINAL pagado (no un subtotal, no un impuesto ni una línea suelta), número entero positivo en pesos colombianos.
- "purpose": un nombre corto del comercio/establecimiento tal como aparece en el recibo, o null si no se alcanza a leer.
- "categoryName": la que mejor calce de esta lista exacta según el tipo de comercio, o null si no es clara: ${CATEGORIES.join(', ')}.
- Nunca inventes una categoría que no esté en la lista exacta de arriba.
- Si la imagen no es un recibo legible, poné amount en null.
- Devolvé JSON válido y nada más.`

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BASE64_LENGTH = 8_000_000 // ~6MB de imagen antes de base64, generoso para una foto ya redimensionada en el cliente

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405)
  }

  if (!ANTHROPIC_API_KEY) {
    return json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada todavía en los secrets de Supabase' }, 500)
  }

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

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Leé este recibo y devolvé el JSON pedido.' },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return json({ ok: false, error: `Anthropic API error: ${errText}` }, 502)
    }

    const data = await response.json()
    const rawText = data?.content?.[0]?.text ?? ''
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
