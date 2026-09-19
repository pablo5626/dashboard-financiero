import { useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { isPasswordPwned } from '../lib/passwordCheck.js'

const MIN_PASSWORD_LENGTH = 8

function translateAuthError(message = '') {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.'
  if (m.includes('email not confirmed')) return 'Falta confirmar tu correo. Revisa tu bandeja de entrada.'
  if (m.includes('user already registered')) return 'Ese correo ya tiene una cuenta. Prueba entrar o recuperar la contraseña.'
  if (m.includes('password should be at least')) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (m.includes('same password')) return 'La nueva contraseña debe ser distinta de la anterior.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.'
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'El registro está deshabilitado por ahora.'
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Ese correo no parece válido.'
  return message
}

const TITLES = {
  entrar: 'Entrar',
  registro: 'Crear cuenta',
  olvido: 'Recuperar contraseña',
  nueva: 'Nueva contraseña',
}

const SUBMIT_LABELS = {
  entrar: ['Entrar', 'Entrando…'],
  registro: ['Crear cuenta', 'Creando…'],
  olvido: ['Enviar enlace', 'Enviando…'],
  nueva: ['Guardar contraseña', 'Guardando…'],
}

export default function Login() {
  const { signIn, signUp, resetPassword, updatePassword, recovering } = useAuth()
  const [mode, setMode] = useState('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)

  const activeMode = recovering ? 'nueva' : mode
  const needsEmail = activeMode !== 'nueva'
  const needsPassword = activeMode !== 'olvido'
  const needsConfirm = activeMode === 'registro' || activeMode === 'nueva'

  function switchMode(next) {
    setMode(next)
    setError(null)
    setNotice(null)
    setPassword('')
    setConfirm('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (needsConfirm) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
        return
      }
      if (password !== confirm) {
        setError('Las contraseñas no coinciden.')
        return
      }
    }

    setLoading(true)
    try {
      if (needsConfirm && (await isPasswordPwned(password))) {
        setError('Esa contraseña aparece en filtraciones de datos conocidas. Elige otra distinta.')
        return
      }
      if (activeMode === 'entrar') {
        const { error } = await signIn(email, password)
        if (error) setError(translateAuthError(error.message))
      } else if (activeMode === 'registro') {
        const { data, error } = await signUp(email, password)
        if (error) {
          setError(translateAuthError(error.message))
        } else if (!data.session) {
          // Supabase devuelve una identidad vacía cuando el correo ya existe
          // y la confirmación de email está activa (para no revelar cuentas).
          setNotice('Revisa tu correo para confirmar tu cuenta y luego entra.')
          setMode('entrar')
          setPassword('')
          setConfirm('')
        }
      } else if (activeMode === 'olvido') {
        const { error } = await resetPassword(email)
        if (error) setError(translateAuthError(error.message))
        else setNotice('Si ese correo tiene una cuenta, te enviamos un enlace para cambiar la contraseña.')
      } else if (activeMode === 'nueva') {
        const { error } = await updatePassword(password)
        if (error) setError(translateAuthError(error.message))
      }
    } finally {
      setLoading(false)
    }
  }

  const [submitLabel, loadingLabel] = SUBMIT_LABELS[activeMode]

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
        <p style={{ font: 'var(--font-footnote)', color: 'var(--text-secondary)', margin: 0 }}>
          {TITLES[activeMode]}
        </p>

        {needsEmail && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Correo</span>
            <input
              type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}

        {needsPassword && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              {activeMode === 'nueva' ? 'Nueva contraseña' : 'Contraseña'}
            </span>
            <input
              type="password" required value={password}
              autoComplete={activeMode === 'entrar' ? 'current-password' : 'new-password'}
              minLength={needsConfirm ? MIN_PASSWORD_LENGTH : undefined}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}

        {needsConfirm && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Repite la contraseña</span>
            <input
              type="password" required autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}

        {error && (
          <p style={{ font: 'var(--font-footnote)', color: 'var(--status-critical)', margin: 0 }}>{error}</p>
        )}
        {notice && (
          <p style={{ font: 'var(--font-footnote)', color: 'var(--status-good)', margin: 0 }}>{notice}</p>
        )}

        <button
          type="submit" disabled={loading}
          style={{
            minHeight: 'var(--touch-target)', borderRadius: 10, background: 'var(--series-1)',
            color: '#fff', fontWeight: 600, opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? loadingLabel : submitLabel}
        </button>

        {!recovering && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            {activeMode === 'entrar' && (
              <>
                <button type="button" onClick={() => switchMode('registro')} style={linkStyle}>
                  ¿No tienes cuenta? Crear cuenta
                </button>
                <button type="button" onClick={() => switchMode('olvido')} style={linkStyle}>
                  Olvidé mi contraseña
                </button>
              </>
            )}
            {activeMode !== 'entrar' && (
              <button type="button" onClick={() => switchMode('entrar')} style={linkStyle}>
                Volver a entrar
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  )
}

const inputStyle = {
  minHeight: 'var(--touch-target)', padding: '0 var(--space-1)', borderRadius: 10,
  border: '1px solid var(--border-hairline)', background: 'var(--surface-raised)',
  color: 'var(--text-primary)', font: 'var(--font-body)',
}

const linkStyle = {
  minHeight: 'var(--touch-target)', background: 'none', border: 'none',
  color: 'var(--series-1)', font: 'var(--font-footnote)', cursor: 'pointer',
}
