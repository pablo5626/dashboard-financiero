// Convención compartida de "bolsillos" de una cuenta multi-moneda (ej. arq
// en USD además de EUR, todo bajo la MISMA fila de `accounts`/el mismo id).
// La moneda primaria (accounts.currency) sigue leyéndose con la clave "plana"
// de siempre — accountId — para que todo el código anterior a esto (que
// asume "una cuenta = una moneda") siga funcionando sin cambios para
// cualquier cuenta no multi-moneda. Cada moneda adicional (accounts con
// is_multi_currency = true, filas hijas en account_currencies, ya adjuntadas
// por accountsApi.listAccounts() como account.extraCurrencies) se lee con la
// clave compuesta "accountId:currency". Es un solo módulo sin dependencias
// para que accountsApi.js, transfersApi.js y transactionsApi.js puedan
// importarlo sin crear un ciclo entre ellos (accountsApi ya importa de
// transfersApi).
//
// Reemplaza el viejo currency_group_id (dos filas de `accounts` separadas
// enlazadas solo para agrupar visualmente) — acá es una sola cuenta real con
// varios saldos, no una agrupación de UI.

export function pocketKeyFor(accountId, currency) {
  return `${accountId}:${currency}`
}

// Índice { accountId: { currency: key } } para resolver en O(1) qué clave de
// saldo/flujo le corresponde a una fila (account_id, currency) dada.
export function buildPocketIndex(accounts) {
  const index = {}
  for (const a of accounts) {
    const primary = a.currency || 'COP'
    index[a.id] = { [primary]: a.id }
    for (const extra of a.extraCurrencies ?? []) {
      index[a.id][extra.currency] = pocketKeyFor(a.id, extra.currency)
    }
  }
  return index
}

export function resolvePocketKey(index, accountId, currency) {
  return index[accountId]?.[currency || 'COP'] ?? null
}

// Lista plana de bolsillos para renderizar (selects, tablas por-cuenta): uno
// por cuenta normal, uno por cada moneda de una cuenta multi-moneda.
export function flattenAccountPockets(accounts) {
  const rows = []
  for (const a of accounts) {
    const primary = a.currency || 'COP'
    rows.push({ key: a.id, accountId: a.id, currency: primary, account: a, label: a.name })
    for (const extra of a.extraCurrencies ?? []) {
      rows.push({ key: pocketKeyFor(a.id, extra.currency), accountId: a.id, currency: extra.currency, account: a, label: `${a.name} (${extra.currency})` })
    }
  }
  return rows
}
