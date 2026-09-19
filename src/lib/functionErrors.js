// supabase.functions.invoke() devuelve, ante un status no-2xx, un error
// genérico ("Edge Function returned a non-2xx status code") y deja el cuerpo
// real en error.context (una Response). Este helper lo lee para poder mostrar
// el mensaje de la función (ej. "Llegaste al límite de usos de IA de hoy").
export async function edgeFunctionErrorMessage(error) {
  try {
    const body = await error?.context?.json?.()
    if (body?.error) return String(body.error)
  } catch {
    // el cuerpo no era JSON: se usa el mensaje genérico
  }
  return error?.message || 'Error al llamar a la función'
}
