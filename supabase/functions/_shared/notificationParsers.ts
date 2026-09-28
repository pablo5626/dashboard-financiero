// Parseo de notificaciones bancarias y montos para auto-capture. Vive en el
// servidor a propósito: corregir un formato es un deploy, sin tocar las macros
// de MacroDroid ni los Atajos de cada teléfono.
//
// Cada parser recibe el texto completo (título + cuerpo) y devuelve
// { merchant, amount } si reconoce una compra, { rejected: true } si es una
// compra rechazada (no se guarda), o null si no la reconoce (se guarda con
// amount = null y el texto crudo, para completarla a mano en la bandeja).

export type ParsedNotification =
  | { rejected: true }
  | { rejected?: false; merchant: string | null; amount: number | null; currency: string }

// Montos en formato colombiano ("$50.000", "50.000,00") o en-US
// ("$50,000.00", el que a veces entrega Wallet). El último separador que
// aparece con 1–2 dígitos después es el decimal; el resto son miles.
export function parseCopAmount(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null
  if (typeof input !== 'string') return null
  const cleaned = input.replace(/[^\d.,]/g, '')
  if (!/\d/.test(cleaned)) return null

  let normalized: string
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? '.' : ','
    const thousandsSep = decimalSep === '.' ? ',' : '.'
    normalized = cleaned.split(thousandsSep).join('').replace(decimalSep, '.')
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ','
    const parts = cleaned.split(sep)
    const isThousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3)
    normalized = isThousands ? parts.join('') : parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
  } else {
    normalized = cleaned
  }

  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

function cleanMerchant(raw: string | undefined): string | null {
  if (!raw) return null
  const m = raw.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '')
  return m ? m.slice(0, 200) : null
}

const REJECTED = /rechazad|declinad|no (fue|pudo ser) (aprobad|procesad)|fondos insuficientes/i

// Formatos conocidos, del más específico al más genérico. Para agregar un
// banco: una regex con grupos nombrados `merchant` y `amount`.
const PATTERNS: RegExp[] = [
  // Nu Colombia: "Tu compra en ANIMAL BUENA MESA por $50.000,00 ... ha sido APROBADA"
  /compra (?:en|a) (?<merchant>.+?) por (?:COP\s*)?(?<amount>\$?\s*[\d.,]+)/i,
  // "Compraste $50.000 en ANIMAL BUENA MESA" / "Pagaste $50.000 en X"
  /(?:compraste|pagaste|realizaste un pago de|pago de) (?:COP\s*)?(?<amount>\$?\s*[\d.,]+) (?:en|a) (?<merchant>.+?)(?:[.,;]|\s+con\s|$)/i,
  // "Compra por $50.000 en X"
  /compra (?:aprobada )?por (?:COP\s*)?(?<amount>\$?\s*[\d.,]+) (?:en|a) (?<merchant>.+?)(?:[.,;]|\s+con\s|$)/i,
]

export function parseNotification(text: string): ParsedNotification | null {
  if (REJECTED.test(text)) return { rejected: true }
  for (const pattern of PATTERNS) {
    const match = text.match(pattern)
    const amount = parseCopAmount(match?.groups?.amount)
    if (match && amount) {
      return { merchant: cleanMerchant(match.groups?.merchant), amount, currency: 'COP' }
    }
  }
  return null
}
