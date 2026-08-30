---
paths:
  - src/lib/categoriesApi.js
  - src/lib/accountsApi.js
  - schema.sql
---

# Nomenclatura: categorías y cuentas

La única fuente válida de nombres de **categorías** y **cuentas** es la tabla de
mapeo de `prompt-dashboard-financiero.md` (sección "Motor de asignación de
cuenta"), más las cuentas hijas iniciales ahí listadas (Bold como madre; Dale,
Nequi, Rappi, Nubank, Efectivo, y Pibank como hijas). No se agregan variantes
de nombre ni categorías nuevas sin que el usuario lo pida explícitamente.

`MonAi-List-1787939356.csv` (en la raíz del proyecto) es **solo material de
análisis**, nunca una fuente de datos ni de nomenclatura. No se importa como
histórico real ni se usa para derivar categorías — contiene variantes de
escritura que no deben propagarse al sistema (`Suscripciónes` con tilde,
`Regalo- festividades` con espaciado distinto). `Servicios` sí es válida — el
usuario la agregó explícitamente a la tabla oficial de
`prompt-dashboard-financiero.md` (electricidad, agua → Dale/Nequi/Efectivo),
pero solo con ese nombre exacto, no las variantes de escritura del CSV. El
usuario etiquetará sus movimientos en MonIA con tags de banco
(`dale`, `nequi`, `rappi`, `nubank`, `efectivo`, `pibank`) recién a partir del
arranque real del proyecto, así que el histórico del CSV no es representativo
del modelo de datos definitivo.

Tanto `categories` como `accounts` son catálogos editables en Supabase (no
`enum`/`CHECK` rígidos) porque el usuario pidió que todo sea 100%
personalizable — pero el conjunto inicial a precargar es exactamente el de la
tabla del prompt, no el que aparece en el CSV.
