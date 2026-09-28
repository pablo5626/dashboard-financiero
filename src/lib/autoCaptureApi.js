import { supabase } from './supabaseClient.js'
import { ensureTags } from './tagsApi.js'

// Captura automática de pagos (Apple Pay vía Atajos, notificaciones del banco
// vía MacroDroid) — ver .claude/rules/captura-automatica.md. Cuando se pudo
// leer el monto, ingest_auto_capture ya guardó la transacción (con la
// categoría aprendida del historial) y la captura queda 'pending' con
// transaction_id = "guardada, falta que el usuario la revise". Sin
// transaction_id, la captura todavía no cuenta como gasto y hay que
// completarla (confirmCapture).

export async function listPendingCaptures() {
  const { data, error } = await supabase
    .from('auto_captures')
    .select('*, accounts(name, currency), transactions(purpose, amount, currency, category_id, account_id, tags)')
    .eq('status', 'pending')
    .order('occurred_at', { ascending: false })
  if (error) throw error
  return data
}

export async function countPendingCaptures() {
  const { count, error } = await supabase
    .from('auto_captures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

// Crea la transacción real a partir de la captura. `monia_id` es estable
// (`auto-<id de la captura>`), así que un doble toque choca contra el unique
// (user_id, monia_id) en vez de duplicar el gasto; en ese caso se reutiliza la
// fila que ya existe. La conciliación con el CSV de MonIA (importTransactions)
// busca justamente las filas con origin 'auto_capture' y monia_id 'auto-…'.
export async function confirmCapture(capture, { purpose, amount, accountId, categoryId, currency, tags }) {
  const moniaId = `auto-${capture.id}`
  const { data: inserted, error } = await supabase.from('transactions').insert({
    monia_id: moniaId,
    occurred_at: capture.occurred_at,
    purpose,
    amount: -Math.abs(amount),
    currency: currency || 'COP',
    category_id: categoryId || null,
    account_id: accountId || null,
    tags: tags ?? [],
    assignment_level: accountId ? 3 : null,
    assignment_confirmed: !!accountId,
    origin: 'auto_capture',
  }).select('id').maybeSingle()

  let transactionId = inserted?.id
  if (error) {
    if (error.code !== '23505') throw error
    const { data: existing, error: findError } = await supabase
      .from('transactions').select('id').eq('monia_id', moniaId).single()
    if (findError) throw findError
    transactionId = existing.id
  }

  const { error: updateError } = await supabase
    .from('auto_captures')
    .update({ status: 'confirmed', transaction_id: transactionId })
    .eq('id', capture.id)
  if (updateError) throw updateError

  if (tags?.length) {
    try { await ensureTags(tags) } catch { /* catálogo secundario, ver createManualTransaction */ }
  }
  return transactionId
}

// Revisión de una captura ya guardada: aplica lo que el usuario corrigió a la
// transacción y la saca del recordatorio. Corregir la categoría acá también
// "enseña" al sistema: la próxima compra en ese comercio sale con ella
// (la sugerencia se calcula del historial de transactions).
export async function reviewCapture(capture, { purpose, amount, accountId, categoryId, currency, tags }) {
  const { error } = await supabase.from('transactions').update({
    purpose,
    amount: -Math.abs(amount),
    currency: currency || 'COP',
    category_id: categoryId || null,
    account_id: accountId || null,
    tags: tags ?? [],
    assignment_confirmed: !!accountId,
    assignment_level: accountId ? 3 : null,
  }).eq('id', capture.transaction_id)
  if (error) throw error

  const { error: updateError } = await supabase
    .from('auto_captures').update({ status: 'confirmed' }).eq('id', capture.id)
  if (updateError) throw updateError
}

// "No fue una compra real": borra la transacción que se guardó sola y descarta
// la captura (el FK transaction_id es on delete set null).
export async function deleteCapturedTransaction(capture) {
  if (capture.transaction_id) {
    const { error } = await supabase.from('transactions').delete().eq('id', capture.transaction_id)
    if (error) throw error
  }
  await discardCapture(capture.id)
}

export async function discardCapture(id) {
  const { error } = await supabase.from('auto_captures').update({ status: 'discarded' }).eq('id', id)
  if (error) throw error
}

export async function listCaptureTokens() {
  const { data, error } = await supabase
    .from('capture_tokens')
    .select('id, label, created_at, last_used_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// Devuelve el token en claro: es la única vez que existe fuera del teléfono,
// la base solo guarda su sha256 (create_capture_token en schema.sql).
export async function createCaptureToken(label) {
  const { data, error } = await supabase.rpc('create_capture_token', { p_label: label })
  if (error) throw error
  return data
}

export async function deleteCaptureToken(id) {
  const { error } = await supabase.from('capture_tokens').delete().eq('id', id)
  if (error) throw error
}

export function autoCaptureEndpoint() {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-capture`
}
