import { supabase } from './supabaseClient.js'
import { buildPocketIndex, resolvePocketKey } from './currencyPockets.js'

// Plata que salió de cada cuenta por transferencia en el set de filas dado.
// Una transferencia no es un gasto a nivel consolidado (mover plata no la
// consume, el Panel la ignora), pero desde el presupuesto de la cuenta de
// origen sí es plata que se fue: si Dale le pasa $333.500 a arq y ahí se
// ejecuta la compra, el presupuesto de Dale está usado aunque el gasto figure
// en arq. Por eso alimenta el "% usado", no el gasto.
//
// Excluye las que vuelven a la cuenta madre (devolver plata sobrante no es
// usar el presupuesto) y las que el usuario marcó como `consumes_budget =
// false` al crearlas, o sea puro reacomodo entre bolsillos. Resuelve la
// misma clave "plana vs. accountId:currency" que fetchBalancesForMonth (ver
// currencyPockets.js), para que la plata que sale del bolsillo EUR de una
// cuenta multi-moneda consuma el "% usado" de ESE bolsillo, no del primario.
export function sumOutgoingByAccount(transfers, accounts) {
  const madreId = accounts.find((a) => a.kind === 'madre')?.id
  const pocketIndex = buildPocketIndex(accounts)

  const outgoing = {}
  for (const row of transfers) {
    if (!row.from_account_id || row.to_account_id === madreId) continue
    if (row.consumes_budget === false) continue
    const key = resolvePocketKey(pocketIndex, row.from_account_id, row.currency)
    if (!key) continue
    outgoing[key] = (outgoing[key] ?? 0) + Number(row.amount)
  }
  return outgoing
}

function toTransferRow({ fromAccountId, toAccountId, amount, currency, toAmount, toCurrency, transferDate, note, consumesBudget, idempotencyKey }) {
  return {
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount,
    currency: currency || 'COP',
    to_amount: toAmount ?? null,
    to_currency: toCurrency ?? null,
    consumes_budget: consumesBudget ?? true,
    transfer_date: transferDate,
    note: note ?? null,
    idempotency_key: idempotencyKey ?? null,
  }
}

export async function createTransfers(rows) {
  const payload = rows.map(toTransferRow)
  const { error } = await supabase.from('account_transfers').insert(payload)
  if (error) throw error
}

// Clave determinística madre+hija+año+mes — reintentar "Confirmar
// transferencia real" (doble click, red lenta, dos pestañas) siempre
// construye la misma clave, así que el unique(user_id, idempotency_key) de
// la base absorbe el duplicado en silencio en vez de crear una segunda fila
// real, igual que el Shortcut de "Transferencia rápida".
export function buildMonthlyAllocationKey(madreId, hijaId, year, month) {
  return `monthly_allocation:${madreId}:${hijaId}:${year}-${String(month).padStart(2, '0')}`
}

export async function createTransfersIgnoringDuplicates(rows) {
  const payload = rows.map(toTransferRow)
  const { error } = await supabase.from('account_transfers')
    .upsert(payload, { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true })
  if (error) throw error
}

export async function getTransfersForMonth(accountIds, year, month) {
  if (accountIds.length === 0) return []
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonthStart = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const ids = accountIds.join(',')
  const { data, error } = await supabase
    .from('account_transfers')
    .select('id, from_account_id, to_account_id, amount, currency, to_amount, to_currency, consumes_budget, transfer_date, note, idempotency_key')
    .gte('transfer_date', monthStart)
    .lt('transfer_date', nextMonthStart)
    .or(`from_account_id.in.(${ids}),to_account_id.in.(${ids})`)
    .order('transfer_date', { ascending: false })
  if (error) throw error
  return data
}

export async function deleteTransfer(id) {
  const { error } = await supabase.from('account_transfers').delete().eq('id', id)
  if (error) throw error
}

// Actualiza el monto de una transferencia existente. Se usa el sync del
// reparto mensual (ver syncMonthlyDistributionTransfers): cambiar el monto
// del plan tiene que ACTUALIZAR la transferencia real, no crear una segunda
// fila (por eso este camino no usa upsert con ignoreDuplicates, que
// ignoraría silenciosamente el cambio de monto).
export async function updateTransferAmount(id, amount) {
  const { error } = await supabase.from('account_transfers').update({ amount }).eq('id', id)
  if (error) throw error
}

// Igual que updateTransferAmount, pero además adopta la fila como
// "transferencia del reparto" de ese mes (le pone la idempotency_key
// determinista). Sirve para las filas que creó el Shortcut de iPhone — que
// no traen key — así la app no crea una segunda fila para el mismo reparto
// y todas las consultas que filtran por la key las ven igual.
export async function adoptTransfer(id, amount, idempotencyKey) {
  const { error } = await supabase
    .from('account_transfers')
    .update({ amount, idempotency_key: idempotencyKey })
    .eq('id', id)
  if (error) throw error
}

// Fecha dentro del mes que se está repartiendo: hoy si ese mes es el mes
// actual, si no el primer día del mes elegido. Antes se usaba siempre
// `new Date()`, así que confirmar el reparto de un mes pasado dejaba el
// movimiento en el mes equivocado (y ni siquiera aparecía en el mes que el
// usuario estaba mirando).
function transferDateForMonth(year, month) {
  const now = new Date()
  if (now.getFullYear() === year && now.getMonth() + 1 === month) {
    return now.toISOString().slice(0, 10)
  }
  return `${year}-${String(month).padStart(2, '0')}-01`
}

// Quita las transferencias REALES del reparto de un mes (las que llevan la
// idempotency_key del ritual). Se usa cuando el switch "el reparto sale de la
// cuenta madre" pasa a estar apagado y el usuario decide que esa plata no
// salió de la madre: sin esto, las hijas que ya recibieron la transferencia
// seguirían con esa plata Y con el saldo inicial que pone el reparto
// apagado — la misma plata dos veces.
//
// Solo toca filas del ritual: una transferencia a mano entre la madre y una
// hija NO se toca.
export async function removeMonthlyDistributionTransfers({ madre, accountIds, year, month }) {
  if (!madre) return 0
  const ids = [madre.id, ...(accountIds ?? [])]
  const existing = await getTransfersForMonth(ids, year, month)
  const ritual = existing.filter((t) =>
    t.from_account_id === madre.id &&
    (t.idempotency_key ?? '').startsWith('monthly_allocation:')
  )
  for (const t of ritual) await deleteTransfer(t.id)
  return ritual.length
}

// Sincroniza las transferencias REALES madre→hija con el plan de
// distribución mensual (`rows` = [{ accountId, amount }]).
//
// Es el paso 2 del ritual: el paso 1 ("Guardar distribución") solo guarda el
// plan (account_allocations); este paso convierte ese plan en movimientos
// reales (account_transfers), que son los que entran en la matemática de
// saldos (ver fetchBalancesForMonth en accountsApi.js).
//
// - Si la transferencia del reparto ya existe (por su idempotency_key), se
//   ACTUALIZA su monto: re-guardar la distribución con otro número no puede
//   crear una segunda fila.
// - Si no existe pero hay una transferencia madre→hija de ese mes creada por
//   el Shortcut de iPhone (sin key), se la ADOPTA: es el mismo movimiento y
//   duplicarla restaría el doble.
// - Si la hija quedó en 0 en el plan, su transferencia del reparto se borra
//   (la plata vuelve a la madre).
//
// Devuelve un resumen para poder contarlo en la UI.
export async function syncMonthlyDistributionTransfers({ madre, rows, year, month }) {
  const summary = { created: 0, updated: 0, adopted: 0, removed: 0, errors: [] }
  if (!madre || !rows || rows.length === 0) return summary

  const ids = [madre.id, ...rows.map((r) => r.accountId)]
  const existing = await getTransfersForMonth(ids, year, month)

  const ritualByHija = {}
  const foreignByHija = {}
  for (const t of existing) {
    if (t.from_account_id !== madre.id || !t.to_account_id) continue
    const key = t.idempotency_key ?? ''
    if (key.startsWith('monthly_allocation:')) ritualByHija[t.to_account_id] = t
    else if (!foreignByHija[t.to_account_id]) foreignByHija[t.to_account_id] = t
  }

  const toInsert = []
  for (const row of rows) {
    const amount = Number(row.amount) || 0
    const key = buildMonthlyAllocationKey(madre.id, row.accountId, year, month)
    const ritual = ritualByHija[row.accountId]

    if (amount <= 0) {
      if (ritual) {
        await deleteTransfer(ritual.id)
        summary.removed += 1
      }
      continue
    }

    if (ritual) {
      if (Number(ritual.amount) !== amount) {
        await updateTransferAmount(ritual.id, amount)
        summary.updated += 1
      }
      continue
    }

    const foreign = foreignByHija[row.accountId]
    if (foreign) {
      // Mismo movimiento (madre→hija, este mes) pero creado por el Shortcut:
      // se adopta en vez de duplicar, para no restar la plata dos veces.
      await adoptTransfer(foreign.id, amount, key)
      summary.adopted += 1
      continue
    }

    toInsert.push({
      fromAccountId: madre.id,
      toAccountId: row.accountId,
      amount,
      currency: 'COP',
      transferDate: transferDateForMonth(year, month),
      note: 'Distribución mensual',
      // El reparto NO es "plata que salió de la madre para gastarla desde
      // otro bolsillo": es el presupuesto del mes de la hija. Con
      // consumes_budget = false no cuenta como "movido a otras cuentas" de
      // la madre (sumOutgoingByAccount), que es el número que alimenta el
      // "% usado".
      consumesBudget: false,
      idempotencyKey: key,
    })
  }

  if (toInsert.length > 0) {
    // ignoreDuplicates: un doble clic o dos pestañas abiertas absorben el
    // duplicado en la base (unique(user_id, idempotency_key)) en vez de crear
    // dos transferencias reales.
    await createTransfersIgnoringDuplicates(toInsert)
    summary.created += toInsert.length
  }

  return summary
}

export async function updateConsumesBudget(id, consumesBudget) {
  const { error } = await supabase.from('account_transfers').update({ consumes_budget: consumesBudget }).eq('id', id)
  if (error) throw error
}
