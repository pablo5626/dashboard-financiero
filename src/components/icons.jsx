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
