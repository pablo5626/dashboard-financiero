// Los nombres de categorías y cuentas los manda el cliente (son los del
// propio usuario) y terminan dentro de un prompt de IA, así que se acotan
// en cantidad y largo y se les quitan saltos de línea y comillas invertidas.
const MAX_NAMES = 100
const MAX_NAME_LENGTH = 60

export function sanitizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.replace(/[\r\n`]+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= MAX_NAMES) break
  }
  return names
}
