// Interpreta el texto transcripto por la Web Speech API del navegador
// (botón de micrófono en QuickCaptureFAB) y lo convierte en los campos del
// formulario de captura rápida vía Claude Haiku 4.5. Nunca escribe en la
// base de datos ni usa la service role key -- a diferencia de
// quick-capture/index.ts (llamado por Shortcuts sin sesión), a esta función
// la invoca el navegador con el JWT real del usuario logueado, así que se
// despliega con verify_jwt = true (default) y no aparece en config.toml.

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

  if (!ANTHROPIC_API_KEY) {
    return json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada todavía en los secrets de Supabase' }, 500)
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
        messages: [{ role: 'user', content: text }],
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
