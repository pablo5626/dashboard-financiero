import { supabase } from './supabaseClient.js'

// Mismo criterio que normalizeTag en transactionsApi.js (guion bajo -> espacio
// + minúsculas) pero duplicado acá en vez de importado — transactionsApi.js
// importa ensureTags de este módulo para el alta automática, así que
// importar en sentido contrario crearía un ciclo (mismo motivo por el que
// currencyPockets.js existe como módulo sin dependencias, ver CLAUDE.md).
function normalize(tag) {
  return tag.trim().toLowerCase().replace(/_/g, ' ')
}

export async function listTags() {
  const { data, error } = await supabase.from('tags').select('*').order('name')
  if (error) throw error
  return data
}

// Alta manual desde Ajustes — devuelve la fila (nueva o ya existente, ver
// ensureTags) para que el llamador pueda reflejarla en su lista local sin
// tener que recargar todo el catálogo.
export async function createTag(name) {
  const cleaned = normalize(name)
  if (!cleaned) return null
  const { data, error } = await supabase
    .from('tags')
    .upsert({ name: cleaned }, { onConflict: 'user_id,name', ignoreDuplicates: true })
    .select()
  if (error) throw error
  if (data?.length) return data[0]
  // ignoreDuplicates no devuelve fila si ya existía — se busca aparte solo
  // en ese caso, para que "crear" un tag repetido igual devuelva algo usable.
  const { data: existing, error: fetchError } = await supabase.from('tags').select().eq('name', cleaned).single()
  if (fetchError) throw fetchError
  return existing
}

// Alta automática en lote — se llama cada vez que se guarda un movimiento
// con tags nuevos (QuickCaptureFAB, edición de tags, import de MonIA), para
// que el catálogo de Ajustes → Tags crezca solo con el uso real sin obligar
// al usuario a "registrar" un tag antes de poder escribirlo. Los llamadores
// la tratan como best-effort (no bloquea el guardado real de la transacción
// si falla) — ver createManualTransaction/updateTransactionTags en
// transactionsApi.js.
export async function ensureTags(names) {
  const cleaned = [...new Set((names ?? []).map(normalize).filter(Boolean))]
  if (cleaned.length === 0) return
  const { error } = await supabase
    .from('tags')
    .upsert(cleaned.map((name) => ({ name })), { onConflict: 'user_id,name', ignoreDuplicates: true })
  if (error) throw error
}

export async function deleteTag(id) {
  const { error } = await supabase.from('tags').delete().eq('id', id)
  if (error) throw error
}
