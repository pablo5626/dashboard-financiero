---
paths:
  - src/lib/transactionsApi.js
  - src/pages/GastosDiarios.jsx
---

# Motor de asignación de cuenta (3 niveles de confianza)

Al importar movimientos de MonIA, la cuenta hija de cada transacción se asigna
en este orden, priorizando siempre el dato explícito sobre la especulación:

1. **Señales de nivel 1 (dato real, nunca especulación)** — tres fuentes,
   evaluadas en este orden si varias aplican a la misma fila (el tag es más
   específico, así que gana en el caso raro de conflicto):
   a. **Tag con nombre de cuenta**: cualquier tag del CSV que coincida con el
      nombre (en minúsculas) de una cuenta hija activa → asignación
      automática. No hay lista fija de tags válidos: el vocabulario **son**
      los nombres de las cuentas (`dale`, `nequi`, `rappi`, `nubank`,
      `efectivo`, `pibank`, y también `arq` / `arq eur`), así que crear una
      cuenta habilita su tag sola y no hay ninguna constante que se
      desactualice. Ese mismo conjunto de nombres es el que se excluye del
      gráfico "gasto por tag" en `GastosDiarios.jsx`, para no contar dos veces
      la misma compra (que suele traer además un tag descriptivo).

      **MonIA no deja escribir espacios al crear un tag**, así que un nombre
      de cuenta de más de una palabra (`arq eur`) hay que teclearlo en el
      teléfono como `arq_eur`. `parseMonIACSV` normaliza guion bajo → espacio
      al parsear cada tag (antes de guardarlo en `transactions.tags`),
      precisamente para que siga calzando contra `accounts.name.toLowerCase()`
      — sin esa normalización, `arq_eur` no matchea `"arq eur"` y la fila cae
      a pendiente de banco en vez de asignarse. Aplica igual a cualquier tag
      descriptivo de más de una palabra, no solo a nombres de cuenta.
   b. **Tags de fila ignorada** (`IGNORED_TAGS` en `transactionsApi.js`):
      marcan una fila del CSV cuyo movimiento real **ya está registrado en
      otro lado**, así que el dashboard no debe contarla. Dos motivos, mismo
      efecto:
      - `traslado` (y `moneda`, alias histórico): un movimiento **entre
        cuentas propias** del usuario (mover plata de una cuenta a otra,
        comprar divisas); el movimiento vive en `account_transfers`.
      - `ignorar`: la compra **ya se cargó a mano** como transacción, así que
        la fila espejo del CSV no debe contarse otra vez. Sigue siendo válido
        para cualquier movimiento cargado a mano, pero **ya no es el flujo de
        las compras en divisa**: esas se importan normal con el tag de la
        cuenta y se corrigen en la cola (ver "Compras en divisa" abajo).

      A diferencia de un tag de cuenta no asignan ninguna cuenta — resuelven la
      fila a `account_id = null` de forma permanente y ya resuelta
      (`assignment_level = 1`, `assignment_confirmed = true`). Al no ser
      "pendiente" real, no entran a la cola de "Pendientes de banco" ni suman
      al badge/alerta de pendientes. Además **no cuentan como gasto ni como
      ingreso en ninguna vista** (Panel general, alertas por categoría,
      gráficos por categoría/tag, candidatos a gasto fijo): sumarlas sería
      contar el mismo movimiento dos veces e inflar los gastos del mes con
      plata que solo se movió o que ya está contada. Usar el helper exportado
      `isIgnoredRow(tags)` — **toda query nueva que sume gastos o ingresos debe
      filtrarlo**. Gana sobre el
      match por `currency` (punto c) y sobre la categoría inequívoca
      (nivel 2); solo un tag de cuenta (punto a) puede ganarle, si por algún
      motivo raro coexisten en la misma fila.
   c. **Moneda de la fila** (`currency` del CSV, ej. `USD`): si es distinta
      de COP y existe exactamente una cuenta hija activa con esa moneda
      (ej. "arq" en USD, "arq eur" en EUR), se asigna esa cuenta
      automáticamente — la moneda es un dato explícito de la transacción, no
      una inferencia, igual que el tag. El conteo es por moneda individual,
      así que varias cuentas no-COP conviven sin romper la regla; solo se
      rompería con dos cuentas activas de la *misma* moneda. Es el respaldo
      automático para compras desde arq que no lleven tag; una compra de arq
      expresada en COP sí necesita el tag `arq`.
2. **Categoría 100% inequívoca** (`categories.is_ambiguous = false`, ej.
   "Suscripciones" → Nubank) → asignación automática solo si esa categoría
   *siempre* fue a una única cuenta en el histórico.
3. **Categoría ambigua sin tag de cuenta ni moneda distintiva** (la mayoría
   de los casos) → **no se asigna nada automáticamente**. La transacción
   queda con `account_id = null` ("pendiente de banco") y la UI debe
   sugerir cuentas ordenadas por frecuencia histórica
   (`category_account_stats`), pero requiere confirmación manual del
   usuario. Cada confirmación alimenta `category_account_stats` para
   mejorar el orden de sugerencias futuras — nunca se auto-asigna sin tag
   ni moneda distintiva mientras la categoría siga siendo ambigua.

Nunca implementar un cuarto nivel que auto-asigne "por probabilidad" o
"porque es lo más frecuente" sin tag/moneda — eso rompe la regla explícita
del usuario de "nunca especular" en el nivel 3.

## Compras en divisa: conversión posterior a la asignación

MonIA deja capturar el monto en la moneda de la compra (EUR 51.31) pero **al
guardar lo convierte**, así que el CSV siempre llega en COP y el monto original
se pierde. Por eso el punto 1c casi nunca se dispara en la práctica: una compra
desde arq llega como una fila COP con el tag `arq` / `arq eur`.

Una vez resuelta la cuenta (en cualquier nivel), si la moneda de la fila es
distinta a la de la cuenta asignada, la fila **no se guarda tal cual** — sería
peor que inútil, porque `fetchBalancesForMonth` y `getAccountFlowsForMonth`
solo suman filas cuya moneda coincide con la de la cuenta, así que un gasto en
COP contra `arq eur` se descartaría **en silencio**: existiría en la tabla pero
no movería ni el saldo ni el "% usado". En su lugar (`convertToAccountCurrency`
en `transactionsApi.js`):

- `amount`/`currency` pasan a la moneda de la **cuenta**, estimados con la tasa
  manual de `exchange_rates` vía `convertAmount`. Si no hay tasa para ese par
  se guarda `0` en vez de inventar una conversión — misma filosofía que `toCOP`.
- El dato original del CSV se conserva en `source_amount`/`source_currency`
  (auditoría, y de ahí sale la tasa implícita que usó MonIA).
- `currency_pending = true` deja la fila en la cola "Compras en divisa por
  confirmar" de `GastosDiarios.jsx`, donde el usuario teclea el monto exacto.
  Hasta ese momento el monto es una estimación, no un dato real — el flag es lo
  que hace visible esa diferencia en vez de esconderla.

Reimportar el mismo CSV no pisa un monto ya confirmado: la deduplicación por
`monia_id` usa `ignoreDuplicates`, así que la fila ni se toca.
