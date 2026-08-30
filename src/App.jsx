import { Routes, Route } from 'react-router-dom'
import AppShell from './components/layout/AppShell.jsx'
import PanelGeneral from './pages/PanelGeneral.jsx'
import Cuentas from './pages/Cuentas.jsx'
import GastosDiarios from './pages/GastosDiarios.jsx'
import Deudas from './pages/Deudas.jsx'
import MetasAhorro from './pages/MetasAhorro.jsx'
import Login from './pages/Login.jsx'
import { useAuth } from './lib/AuthContext.jsx'

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (!user) return <Login />

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<PanelGeneral />} />
        <Route path="/cuentas" element={<Cuentas />} />
        <Route path="/gastos" element={<GastosDiarios />} />
        <Route path="/deudas" element={<Deudas />} />
        <Route path="/metas" element={<MetasAhorro />} />
      </Routes>
    </AppShell>
  )
}
