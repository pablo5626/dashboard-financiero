---
paths:
  - src/lib/transactionsApi.js
  - src/pages/GastosDiarios.jsx
---

# Motor de asignación de cuenta (3 niveles de confianza)

Al importar movimientos de MonIA, la cuenta hija de cada transacción se asigna
en este orden, priorizando siempre el dato explícito sobre la especulación:

1. **Señales de nivel 1 (dato real, nunca especulación)** — dos fuentes,
   evaluadas en este orden si ambas aplican a la misma fila (el tag es más
   específico, así que gana en el caso raro de conflicto):
   a. **Tag de banco** (`dale`, `nequi`, `rappi`, `nubank`, `efectivo`,
      `pibank` dentro del campo `tags` del CSV) → asignación automática.
   b. **Moneda de la fila** (`currency` del CSV, ej. `USD`): si es distinta
      de COP y existe exactamente una cuenta hija activa con esa moneda
      (ej. "arq"), se asigna esa cuenta automáticamente — la moneda es un
      dato explícito de la transacción, no una inferencia, igual que el tag.
2. **Categoría 100% inequívoca** (`categories.is_ambiguous = false`, ej.
   "Suscripciones" → Nubank) → asignación automática solo si esa categoría
   *siempre* fue a una única cuenta en el histórico.
3. **Categoría ambigua sin tag de banco ni moneda distintiva** (la mayoría
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
