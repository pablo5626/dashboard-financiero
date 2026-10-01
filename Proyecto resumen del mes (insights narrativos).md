# Resumen del mes: insights narrativos en Panel General

Estado: **aprobado e implementado en el working tree, sin commitear todavía** (22-sep-2026). El
código ya existe en `src/lib/panelApi.js` y `src/pages/PanelGeneral.jsx` (`git status` los marca
`M`, modificados pero no en ningún commit) y ya se probó corriendo `npm run build` y en el
navegador (`npm run dev`) — falta solo decidir cuándo commitear.

## Por qué

Surgió del gap #2 de `Proyecto comparacion apps de finanzas.md`: apps como Copilot Money o
Monarch generan frases automáticas tipo "gastaste 20% más en comida este mes", y nuestra app ya
tenía casi todos los datos para hacerlo (`fetchMonthlyTrend`, la consulta de anomalía por
categoría de `fetchAlerts`) pero nunca los redactaba como texto.

Decisiones aprobadas con el usuario:
- Las frases se arman con **plantillas de texto sobre números reales**, sin llamar a Gemini —
  gratis, instantáneo, y consistente con el principio de "nunca inventar" del resto de la app.
- Aparecen en **Panel General**, como tarjeta "Resumen del mes" junto a "Alertas".

## Qué hace

En Panel General, entre "Alertas" y "Próximos pagos", una tarjeta nueva con 2 a 4 frases sobre el
mes que se esté navegando (sigue el `MonthYearPicker`, no "hoy real"):
- Gasto total vs. mes anterior, con el % de variación.
- Ahorro neto del mes (ingresos − gastos) o cuánto se gastó de más de lo que ingresó.
- La categoría con mayor gasto del mes.
- La categoría cuyo gasto más se alejó (≥20%, arriba o abajo) de su propio promedio de los
  últimos 6 meses.

Si no hay mes anterior o historial suficiente (la cuenta recién creada), la tarjeta muestra el
mismo estado vacío "muted" que ya usan Alertas y los gráficos de tendencia, en vez de romperse o
mostrar `NaN`.

## Cómo se implementó

**`src/lib/panelApi.js`** — nueva función exportada `fetchCategoryInsights(year, month)`.
Replica el mismo criterio de "promedio histórico por categoría" que ya usa la alerta
`anomalia_categoria` dentro de `fetchAlerts` (mismas constantes `ANOMALY_MONTHS_BACK`,
`ANOMALY_MIN_HISTORY_MONTHS`, `ANOMALY_MIN_AVERAGE`), pero con dos diferencias a propósito:
- Es **navegable por mes** (recibe `year`/`month`) en vez de asumir siempre "hoy real" como
  `fetchAlerts`.
- **Convierte cada monto a COP** con `toCOP`/`getRates` antes de sumarlo — `fetchAlerts` no lo
  hace (asume todo en COP), pero esta es una vista consolidada que cruza cuentas de distinta
  moneda (arq USD/EUR incluido), y la regla de "Money math" de `CLAUDE.md` exige convertir ahí.
  Es una corrección aplicada solo a la función nueva; `fetchAlerts` queda intacta.

Devuelve `{ topCategory: { name, amount } | null, biggestChange: { name, amount, average,
pctChange } | null }`. Nueva constante `INSIGHT_CHANGE_THRESHOLD = 0.2` (20%) — más sensible que
el `ANOMALY_MULTIPLIER` (1.5x/50%) de la alerta, porque acá es informativo, no una advertencia.

**`src/pages/PanelGeneral.jsx`**:
- Nuevo estado `categoryInsights`, cargado en el mismo `Promise.all` que ya existía (sin
  `useEffect` nuevo) junto a `fetchCategoryInsights(year, month)`.
- El delta de gasto/ingreso total **no pidió ninguna consulta nueva**: se lee directo de `trend`
  (ya cargado para el gráfico de 6 meses) — mes actual es `trend[trend.length - 1]`, anterior es
  `trend[trend.length - 2]`, mismo patrón que ya usaban los KPI de "Ingresos"/"Gastos del mes".
- Nueva función `buildMonthlyInsights({ lastMonth, prevMonth, categoryInsights })` (a la altura de
  `alertText`, mismo patrón "la data se busca en `panelApi.js`, la frase se arma en el
  componente") que arma el array de frases.
- Nuevo `Card title="Resumen del mes"`, mismo `<ul>`/estilo inline que ya usa "Alertas" — sin CSS
  module nuevo, porque `PanelGeneral.jsx` no tiene uno y toda esa página es estilo inline.

No hizo falta cambio de esquema, RLS ni Edge Function — es lectura pura de `transactions`/
`categories` ya accesible por RLS estándar.

## Verificación ya hecha

- `npm run build` sin errores.
- Probado en el navegador (`npm run dev`) con datos reales: la tarjeta muestra frases coherentes
  (ej. "Gastaste $363.530 más de lo que ingresó este mes." / "Tu categoría con mayor gasto fue
  'Compras': $500.000.").
- Confirmado por código (no visualmente, ver nota abajo) que en `< 768px` la tarjeta se comporta
  igual que "Alertas": `.grid-auto` pasa a una sola columna, `Card.jsx` no tiene alto fijo, mismo
  patrón de lista con `font: var(--font-subheadline)` por línea — no debería ocupar más espacio
  que cualquier otra tarjeta de texto corto de la página.

## Pendiente

- **No commitear todavía** — el usuario pidió dejarlo aprobado y documentado, pero sin commit
  hasta nueva indicación.
- Confirmación visual real en móvil: no se pudo forzar un viewport angosto por herramientas (el
  `resize_window` de la extensión de Chrome no afectó la ventana real en este entorno) — pendiente
  probarlo a mano desde el celular (`npm run dev --host`) o achicando la ventana del navegador.
