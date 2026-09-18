// Recharts asigna el YAxis de categoría (nombre de cuenta/categoría/tag en
// los BarChart horizontales) un ancho fijo en píxeles y ancla el texto al
// borde derecho de esa franja (pegado a las barras) — cualquier ancho mayor
// al que el texto realmente necesita queda como espacio vacío a la
// izquierda del gráfico entero, no entre el texto y las barras. Esta
// función calcula el ancho real necesario a partir de las etiquetas de
// cada gráfico en particular, en vez de un número fijo adivinado que le
// queda grande a la mayoría de los nombres.
export function estimateCategoryAxisWidth(labels, { min = 34, max = 140, charWidth = 6, padding = 8 } = {}) {
  const longest = (labels || []).reduce((m, l) => Math.max(m, String(l ?? '').length), 0)
  return Math.min(max, Math.max(min, Math.round(longest * charWidth + padding)))
}
