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
   b. **Tags de fila ignorada** (`IGNORED_TAGS` en `transactionsApi.js`):
      marcan una fila del CSV cuyo movimiento real **ya está registrado en
      otro lado**, así que el dashboard no debe contarla. Dos motivos, mismo
      efecto:
      - `traslado` (y `moneda`, alias histórico): un movimiento **entre
        cuentas propias** del usuario (mover plata de una cuenta a otra,
        comprar divisas); el movimiento vive en `account_transfers`.
      - `ignorar`: la compra **ya se cargó a mano** como transacción,
        típicamente porque fue en otra moneda — MonIA todavía no maneja
        divisas y exporta esas compras en COP, así que el gasto real se carga
        a mano en EUR/USD contra la cuenta de arq correspondiente y la fila
        espejo del CSV se marca con este tag.

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
