import { useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { IconPanel, IconAccounts, IconExpenses, IconDebts, IconGoals, IconDiary } from '../icons.jsx'
import { useAuth } from '../../lib/AuthContext.jsx'
import { countPendingTransactions, countPendingCurrencyTransactions } from '../../lib/transactionsApi.js'
import QuickCaptureFAB from '../QuickCaptureFAB.jsx'
import SettingsPanel from '../SettingsPanel.jsx'
import SearchPanel from '../SearchPanel.jsx'
import styles from './AppShell.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Panel', Icon: IconPanel, end: true },
  { to: '/diario', label: 'Diario', Icon: IconDiary },
  { to: '/cuentas', label: 'Cuentas', Icon: IconAccounts },
  { to: '/gastos', label: 'Gastos', Icon: IconExpenses },
  { to: '/deudas', label: 'Deudas', Icon: IconDebts },
  { to: '/metas', label: 'Metas', Icon: IconGoals },
]

export default function AppShell({ children }) {
  const { signOut } = useAuth()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)

  // Recuerda que hay movimientos por atender en Gastos sin importar por dónde
  // se entre a la app (no solo desde Panel general) — se refresca al volver
  // de Gastos diarios, donde se resuelven. Suma las dos colas que se drenan
  // ahí: sin cuenta asignada y compras en divisa con monto todavía estimado.
  // También la usa QuickCaptureFAB tras guardar, en vez de recargar la
  // página completa que esté montada debajo. Además emite un evento global
  // (`dashboard:transactions-changed`) — QuickCaptureFAB vive fuera del
  // árbol de la página ruteada (son hermanos bajo AppShell, no padre/hijo),
  // así que no hay forma de pasarle un reload() de Diario.jsx por props;
  // esto le avisa a cualquier página montada que escuche que algo cambió,
  // sin introducir un store global (ver Diario.jsx's "Movimientos de hoy").
  const refreshPendingCount = useCallback(() => {
    Promise.all([countPendingTransactions(), countPendingCurrencyTransactions()])
      .then(([bank, currency]) => setPendingCount(bank + currency))
      .catch(() => {})
    window.dispatchEvent(new Event('dashboard:transactions-changed'))
  }, [])

  useEffect(() => { refreshPendingCount() }, [location.pathname, refreshPendingCount])

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

      <QuickCaptureFAB onSaved={refreshPendingCount} onOpenSearch={() => setSearchOpen(true)} />
      <SettingsPanel />
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
