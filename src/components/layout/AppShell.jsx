import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { IconPanel, IconAccounts, IconExpenses, IconDebts, IconGoals } from '../icons.jsx'
import { useAuth } from '../../lib/AuthContext.jsx'
import { countPendingTransactions } from '../../lib/transactionsApi.js'
import styles from './AppShell.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Panel', Icon: IconPanel, end: true },
  { to: '/cuentas', label: 'Cuentas', Icon: IconAccounts },
  { to: '/gastos', label: 'Gastos', Icon: IconExpenses },
  { to: '/deudas', label: 'Deudas', Icon: IconDebts },
  { to: '/metas', label: 'Metas', Icon: IconGoals },
]

export default function AppShell({ children }) {
  const { signOut } = useAuth()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)

  // Recuerda que hay movimientos sin cuenta asignada sin importar por dónde
  // se entre a la app (no solo desde Panel general) — se refresca al volver
  // de Gastos diarios, donde se confirman.
  useEffect(() => {
    countPendingTransactions().then(setPendingCount).catch(() => {})
  }, [location.pathname])

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Navegación principal">
        <div className={styles.brand}>Finanzas</div>
        <ul className={styles.sidebarList}>
          {NAV_ITEMS.map(({ to, label, Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => (isActive ? `${styles.sidebarLink} ${styles.active}` : styles.sidebarLink)}
              >
                <Icon />
                <span>{label}</span>
                {to === '/gastos' && pendingCount > 0 && <span className={styles.badge}>{pendingCount}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
        <button className={styles.signOut} onClick={() => signOut()}>Cerrar sesión</button>
      </nav>

      <main className={styles.content}>
        <button className={styles.signOutMobile} onClick={() => signOut()}>Cerrar sesión</button>
        {children}
      </main>

      <nav className={styles.tabBar} aria-label="Navegación principal">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => (isActive ? `${styles.tabItem} ${styles.active}` : styles.tabItem)}
          >
            <span className={styles.iconWrap}>
              <Icon width={24} height={24} />
              {to === '/gastos' && pendingCount > 0 && <span className={styles.badge}>{pendingCount}</span>}
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
