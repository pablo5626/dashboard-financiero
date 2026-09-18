// Iconos monocromo trazo simple (equivalente ligero a SF Symbols para web)
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }

export function IconPanel(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 13h4v7H3zM10 8h4v12h-4zM17 4h4v16h-4z" />
    </svg>
  )
}

export function IconAccounts(props) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" />
      <path d="M2.5 9.5h19" />
    </svg>
  )
}

export function IconExpenses(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  )
}

export function IconDebts(props) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="7" width="19" height="10" rx="2" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  )
}

export function IconGoals(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  )
}

export function IconPlus(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v16M4 12h16" />
    </svg>
  )
}

export function IconClose(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  )
}

export function IconMic(props) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6" />
    </svg>
  )
}

export function IconDiary(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v18M5 8h5M5 12h5M14 8h5M14 12h5M14 16h5M5 16h5" />
      <rect x="3" y="4" width="18" height="16" rx="2" />
    </svg>
  )
}

export function IconSearch(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </svg>
  )
}

export function IconSettings(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.02 5.98l-1.7 1.7M7.68 16.32l-1.7 1.7M18.02 18.02l-1.7-1.7M7.68 7.68l-1.7-1.7" />
    </svg>
  )
}

export function IconCamera(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  )
}

export function IconChevronRight(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function IconTag(props) {
  return (
    <svg {...base} {...props}>
      <path d="M11.5 3H4a1 1 0 00-1 1v7.5a1 1 0 00.3.7l9 9a1 1 0 001.4 0l7.5-7.5a1 1 0 000-1.4l-9-9a1 1 0 00-.7-.3z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Distinta de IconTag (usada por "Categorías") para que el menú de Ajustes
// no repita el mismo glifo en dos filas — "#" es también el mismo símbolo
// que el botón de tag en QuickCaptureFAB/SearchPanel.
export function IconHash(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 4l-2 16M17 4l-2 16M4 9h16M3 15h16" />
    </svg>
  )
}

export function IconExchange(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8h14M14 4l4 4-4 4" />
      <path d="M20 16H6M10 20l-4-4 4-4" />
    </svg>
  )
}
