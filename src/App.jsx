import { Routes, Route } from 'react-router-dom'
import AppShell from './components/layout/AppShell.jsx'
import PanelGeneral from './pages/PanelGeneral.jsx'
import Diario from './pages/Diario.jsx'
import Cuentas from './pages/Cuentas.jsx'
import GastosDiarios from './pages/GastosDiarios.jsx'
import Deudas from './pages/Deudas.jsx'
import MetasAhorro from './pages/MetasAhorro.jsx'
import Login from './pages/Login.jsx'
import { useAuth } from './lib/AuthContext.jsx'

export default function App() {
  const { user, loading, recovering } = useAuth()

  if (loading) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        font: 'var(--font-body)', color: 'var(--text-secondary)',
      }}>
        Cargando…
      </div>
    )
  }
  if (!user || recovering) return <Login />

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<PanelGeneral />} />
        <Route path="/diario" element={<Diario />} />
        <Route path="/cuentas" element={<Cuentas />} />
        <Route path="/gastos" element={<GastosDiarios />} />
        <Route path="/deudas" element={<Deudas />} />
        <Route path="/metas" element={<MetasAhorro />} />
      </Routes>
    </AppShell>
  )
}
