# Diseño UI y visualización de datos

## Layout responsive (inspirado en iOS HIG — skill `ios-hig-design`)

- **Móvil (< 768px)**: tab bar inferior con los 5 destinos principales
  (Panel, Cuentas, Gastos, Deudas, Metas), navegación apilada.
- **Tablet/desktop (≥ 768px)**: sidebar fija en vez de tab bar, mayor
  densidad de información por vista.
- Respetar `env(safe-area-inset-*)` (notch, home indicator), touch targets
  mínimos de 44px, escala tipográfica semántica (Large Title / Title /
  Headline / Body / Caption definida como custom properties en
  `src/index.css`), nunca tamaños de fuente sueltos hardcodeados en un
  componente.
- Sin hamburger menu — la navegación siempre es tab bar o sidebar visibles.
- **Formularios modales de captura rápida y overlays de búsqueda son
  pantalla completa en móvil**: la hoja del "+" (`QuickCaptureFAB.jsx`) y el
  buscador global (`SearchPanel.jsx`) usan `100dvh` sin `border-radius`
  bajo 768px — no un bottom-sheet recortado con esquinas redondeadas — y
  vuelven a ser una tarjeta centrada flotante en tablet/desktop (≥768px),
  mismo breakpoint que el resto del layout responsive.
- La skill es para iOS nativo (SwiftUI/UIKit); acá solo se traducen sus
  *principios* de layout, tipografía, color/Dark Mode y navegación a
  CSS/React — sus referencias de widgets, extensions, Siri/Shortcuts o
  app-icons no aplican a esta web app.

## Paleta y forma de los gráficos (skill `dataviz`)

- Los tokens de color están en `src/index.css` (`--series-1`…`--series-8`,
  `--status-good/warning/serious/critical`, tokens de superficie/tinta) y
  siguen la paleta validada por `scripts/validate_palette.js` de la skill —
  **no inventar hex nuevos** para series o estados sin revalidar.
- Colores categóricos siempre en el **orden fijo** de los slots (1=azul,
  2=naranja, 3=aqua...), nunca ciclados ni reordenados por conveniencia.
- **Parte-todo → barra horizontal, nunca dona/pie** (ej. "Distribución por
  cuenta" en el Panel general ya sigue esta regla).
- Tendencia en el tiempo → línea; una sola serie usa el hue secuencial
  (azul); 2–3 series usan slots categóricos consecutivos con leyenda.
- Un eje siempre — nunca un gráfico de doble eje Y.
- Todo color de gráfico se pasa como `var(--series-N)` / `var(--status-*)`,
  nunca como hex literal en un componente de página, para que el modo oscuro
  (`prefers-color-scheme` + `[data-theme]`) siga funcionando automáticamente.
- **Sin `<CartesianGrid>`** — se quitó de todos los gráficos (barras y
  líneas) de la app porque el usuario las vio como ruido visual. No
  reintroducir líneas de guía en un gráfico nuevo salvo que el usuario lo
  pida explícitamente.
- **El `YAxis` de categoría en un `BarChart` horizontal (`layout="vertical"`)
  nunca debe llevar un `width` fijo adivinado** — Recharts ancla la
  etiqueta al borde derecho de esa franja, así que un `width` más grande
  del que el texto necesita dejaba un espacio vacío a la izquierda del
  gráfico entero (no entre la etiqueta y las barras), un bug real que vivió
  varios gráficos con anchos de 70–110px puestos a ojo. Usar
  `estimateCategoryAxisWidth(labels)` de `src/lib/chartUtils.js`, que calcula
  el ancho según el texto real de cada gráfico en particular. Para el
  `YAxis` numérico de un gráfico de línea, un ancho fijo chico (42–46px)
  alcanza porque `formatCompact` ya produce texto corto ("1.2M"/"500K").
- **Un `BarChart` con `Cell` por categoría usa el color real de esa
  categoría** (`categories.color`, con el mismo *fallback* a
  `seriesForName(name)` que ya usan `Diario.jsx` y la lista de Movimientos)
  en vez de una paleta genérica que rota sin relación con el color asignado
  en Ajustes — así una misma categoría se ve del mismo color en todas las
  vistas de la app. Un `Cell` por *tag* (que no tiene color propio) sigue
  rotando la paleta genérica (`CHART_COLORS`).
