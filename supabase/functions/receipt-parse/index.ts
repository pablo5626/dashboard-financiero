// Interpreta una foto de un recibo/factura, o un pantallazo de notificaciones
// de pago de una app bancaria (capturada o subida desde QuickCaptureFAB), y
// extrae las compras que ve -- comercio, categoría sugerida, monto y cuenta
// detectada -- vía Gemini (vision; modelo en _shared/gemini.ts). Un recibo es
// una sola compra; un pantallazo de notificaciones puede traer varias. Nunca
// escribe en la base de datos ni usa la service role key -- mismo patrón que
// voice-parse/index.ts: la invoca el navegador con el JWT real del usuario
// logueado, así que se despliega con verify_jwt = true (default) y no aparece
// en config.toml.
//
// Las categorías y cuentas posibles no están fijas acá: cada usuario tiene las
// suyas, así que el cliente las manda en el body (`categories` y `accounts`,
// solo nombres; las cuentas son solo las de COP porque una notificación
// bancaria trae pesos) y se inyectan en el prompt; sin ninguna, el modelo
// devuelve null en ese campo. La cuenta solo se propone cuando la imagen la
// nombra (el banco de la notificación); un recibo de papel no dice cuál se usó.
import { json, requireUser, withCors } from '../_shared/auth.ts'
import { consumeAiQuota } from '../_shared/quota.ts'
import { sanitizeNameList } from '../_shared/input.ts'
import { GEMINI_MODEL, buildGenerationConfig, geminiErrorResponse } from '../_shared/gemini.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const MAX_PURCHASES = 20

function listForPrompt(names: string[]) {
  return names.length > 0 ? names.join(', ') : '(ninguna todavía)'
}

function buildSystemPrompt(categories: string[], accounts: string[]) {
  return `Te muestro una imagen o un PDF de una de estas dos cosas, de compras hechas en Colombia: (a) un recibo o factura (incluida una factura electrónica DIAN, que puede traer varias líneas de detalle), o (b) una captura de pantalla de notificaciones de pago o de movimientos de una app bancaria, que puede mostrar una o varias compras. Devolvés SOLO un JSON estricto (sin texto extra, sin markdown) con esta forma exacta:

{"purchases":[{"purpose":"<string o null>","amount":<number>,"categoryName":"<string o null>","accountName":"<string o null>"}]}

Reglas:
- Una entrada en "purchases" por cada compra distinta. Un recibo o una factura es UNA sola compra. En una captura de notificaciones, una entrada por cada compra o pago visible; no repitas la misma compra si aparece dos veces e ignorá lo que no sea una compra (transferencias recibidas, publicidad, etc.).
- "amount": en un recibo, el TOTAL FINAL pagado (no un subtotal, no un impuesto ni una línea suelta); en una notificación, el monto de esa compra. Número entero positivo en pesos colombianos.
- "purpose": un nombre corto del comercio/establecimiento tal como aparece, o null si no se alcanza a leer.
- "categoryName": la que mejor calce de esta lista exacta según el tipo de comercio, o null si no es clara o la lista está vacía: ${listForPrompt(categories)}.
- "accountName": la cuenta con la que se pagó, solo si la imagen nombra el banco o la app (por ejemplo el nombre de la app que muestra la notificación) y calza con esta lista exacta; null si la imagen no lo dice (un recibo de papel casi nunca lo dice) o la lista está vacía: ${listForPrompt(accounts)}.
- Nunca inventes una categoría o cuenta que no esté en las listas exactas de arriba.
- Si la imagen no muestra ninguna compra legible, devolvé "purchases" como lista vacía.
- Devolvé JSON válido y nada más.`
}

// Normaliza una compra que devolvió el modelo; null si no tiene un monto válido.
function cleanPurchase(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const amount = Math.round(Number(p.amount))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  return {
    purpose: text(p.purpose, 80),
    amount,
    categoryName: text(p.categoryName, 60),
    accountName: text(p.accountName, 60),
  }
}

// 'application/pdf' cubre una factura electrónica emitida directamente en
// PDF (muy común en Colombia/DIAN) -- Gemini la lee igual que una imagen en
// el mismo campo inline_data, sin costo extra real: cobra 258 tokens por
// página (tarifa de imagen), así que una factura de 1-3 páginas cuesta
// fracciones de centavo, prácticamente lo mismo que una foto.
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_BASE64_LENGTH = 8_000_000 // ~6MB antes de base64, generoso para una foto ya redimensionada en el cliente o un PDF de pocas páginas

// El mediaType lo declara el cliente, así que no se le cree: se lee la firma
// (los primeros bytes) del archivo y debe coincidir con lo declarado. El
// archivo no se guarda ni se ejecuta en ningún lado (solo se le pasa a Gemini),
// pero así un archivo cualquiera disfrazado de imagen no llega ni a la IA.
function detectMediaType(base64: string): string | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null
  let head: string
  try {
    head = atob(base64.slice(0, 16))
  } catch {
    return null
  }
  const bytes = [...head].map((c) => c.charCodeAt(0))
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return null
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

  const mediaType = String(body.mediaType ?? '')
  const imageBase64 = String(body.imageBase64 ?? '')
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return json({ ok: false, error: 'tipo de imagen no soportado' }, 400)
  }
  if (!imageBase64 || imageBase64.length > MAX_BASE64_LENGTH) {
    return json({ ok: false, error: 'imagen vacía o demasiado grande' }, 400)
  }
  if (detectMediaType(imageBase64) !== mediaType) {
    return json({ ok: false, error: 'el archivo no coincide con el tipo declarado' }, 400)
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
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mediaType, data: imageBase64 } },
            { text: 'Leé esta imagen y devolvé el JSON pedido.' },
          ],
        }],
        generationConfig: buildGenerationConfig(1500, { temperature: 0, responseMimeType: 'application/json' }),
      }),
    })

    if (!response.ok) {
      // El detalle del proveedor queda solo en el log del servidor.
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

    // Tolera la forma vieja (una sola compra plana) por si el modelo la usa.
    const rawPurchases = Array.isArray(parsed.purchases) ? parsed.purchases : [parsed]
    const purchases = rawPurchases.slice(0, MAX_PURCHASES).map(cleanPurchase).filter((p) => p !== null)
    if (purchases.length === 0) {
      return json({ ok: false, error: 'no se pudo leer un monto válido en la foto' }, 422)
    }

    // `result` (la primera compra) se mantiene por compatibilidad con un
    // cliente que todavía no conozca `purchases`.
    return json({ ok: true, purchases, result: { mode: 'gasto', ...purchases[0] } })
  } catch (err) {
    console.error('receipt-parse', err)
    return json({ ok: false, error: 'error interno' }, 500)
  }
}))
