// Interpreta el texto transcripto por la Web Speech API del navegador
// (botón de micrófono en QuickCaptureFAB) y lo convierte en los campos del
// formulario de captura rápida vía Gemini 2.5 Flash. Nunca escribe en la
// base de datos ni usa la service role key -- a diferencia de
// quick-capture/index.ts (llamado por Shortcuts sin sesión), a esta función
// la invoca el navegador con el JWT real del usuario logueado, así que se
// despliega con verify_jwt = true (default) y no aparece en config.toml.
//
// Proveedor cambiado de Anthropic a Gemini a pedido del usuario (por ahora
// usa la key de Gemini que ya tiene, con posibilidad de volver a cambiar
// más adelante) -- mismo patrón de "un solo fetch directo a la API REST del
// proveedor", sin capa de abstracción multi-proveedor, para no anticipar
// una necesidad que todavía no existe.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_MODEL = 'gemini-2.5-flash'

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

// Mismas categorías/cuentas que prompt-dashboard-financiero.md (ver
// .claude/rules/nomenclatura.md) -- nunca las variantes del CSV de MonIA.
const CATEGORIES = [
  'Anita de mi corazón', 'Aportes', 'Compras', 'Cuidado personal',
  'Deuda o cuadre', 'Donativo', 'Educación', 'Medicina', 'Mekato', 'Mercado',
  'Ocio', 'Préstamo', 'Regalo - festividades', 'Ropa', 'Salida a comer',
  'Servicios', 'Suscripciones', 'Tarjeta', 'Transporte', 'Viaje',
]

const ACCOUNTS = ['Dale', 'Nequi', 'Rappi', 'Nubank', 'Efectivo', 'Pibank', 'arq', 'arq eur']

const SYSTEM_PROMPT = `Interpretás frases habladas en español colombiano que describen un movimiento de dinero personal, y devolvés SOLO un JSON estricto (sin texto extra, sin markdown) con esta forma exacta:

{"mode":"gasto|ingreso","amount":<number>,"categoryName":"<string o null>","accountName":"<string o null>","purpose":"<string o null>","tag":"<string o null>"}

Reglas:
- "mode": "gasto" salvo que la frase indique claramente un ingreso (recibí, me pagaron, me depositaron...).
- "amount": siempre en pesos colombianos, número entero positivo. Jerga: "mil"/"lucas" = x1.000 (ej. "15 mil" = 15000, "20 lucas" = 20000); "palo"/"palos" = x1.000.000 (ej. "1 palo" = 1000000, "2 palos y medio" = 2500000).
- "categoryName": la que mejor calce de esta lista exacta, o null si no es clara: ${CATEGORIES.join(', ')}.
- "accountName": la cuenta mencionada, solo si calza con esta lista exacta, o null si no se menciona ninguna: ${ACCOUNTS.join(', ')}.
- "purpose": una descripción corta de qué fue el movimiento (ej. "salchipapa"), o null si no hay nada claro más allá de monto/cuenta/categoría.
- "tag": un tag descriptivo corto en minúscula si la frase lo sugiere, o null.
- Nunca inventes una cuenta o categoría que no esté en las listas exactas de arriba.
- Devolvé JSON válido y nada más.`

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

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
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
    return json({ ok: false, error: String(err) }, 500)
  }
})
