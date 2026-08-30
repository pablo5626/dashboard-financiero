import { useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'var(--space-2)',
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          background: 'var(--surface-1)', border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-card)', padding: 'var(--space-3)',
        }}
      >
        <h1 style={{ font: 'var(--font-title)', margin: 0 }}>Dashboard Financiero</h1>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Correo</span>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Contraseña</span>
          <input
            type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {error && (
          <p style={{ font: 'var(--font-footnote)', color: 'var(--status-critical)', margin: 0 }}>{error}</p>
        )}

        <button
          type="submit" disabled={loading}
          style={{
            minHeight: 'var(--touch-target)', borderRadius: 10, background: 'var(--series-1)',
            color: '#fff', fontWeight: 600, opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

const inputStyle = {
  minHeight: 'var(--touch-target)', padding: '0 var(--space-1)', borderRadius: 10,
  border: '1px solid var(--border-hairline)', background: 'var(--surface-raised)',
  color: 'var(--text-primary)', font: 'var(--font-body)',
}
