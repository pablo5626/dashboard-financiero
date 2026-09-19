import { useCallback, useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import { listAccounts } from '../lib/accountsApi.js'
import { listCategories } from '../lib/categoriesApi.js'

function openSettings(section) {
  window.dispatchEvent(new CustomEvent('dashboard:open-settings', { detail: { section } }))
}

export default function OnboardingCard() {
  const [state, setState] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [accounts, categories] = await Promise.all([listAccounts(), listCategories()])
      setState({
        hasMadre: accounts.some((a) => a.kind === 'madre'),
        hasHija: accounts.some((a) => a.kind === 'hija'),
        hasCategory: categories.length > 0,
      })
    } catch {
      setState(null)
    }
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('dashboard:accounts-changed', refresh)
    window.addEventListener('dashboard:settings-closed', refresh)
    return () => {
      window.removeEventListener('dashboard:accounts-changed', refresh)
      window.removeEventListener('dashboard:settings-closed', refresh)
    }
  }, [refresh])

  if (!state) return null
  if (state.hasMadre && state.hasHija && state.hasCategory) return null

  const steps = [
    {
      done: state.hasMadre,
      title: 'Crea tu cuenta madre',
      hint: 'Es la cuenta desde la que repartes tu plata cada mes (por ejemplo, tu banco principal).',
      section: 'cuentas',
      cta: 'Crear cuenta madre',
    },
    {
      done: state.hasHija,
      title: 'Crea al menos una cuenta hija',
      hint: 'Son los bolsillos donde gastas: una billetera digital, efectivo, otra tarjeta…',
      section: 'cuentas',
      cta: 'Crear cuenta hija',
      locked: !state.hasMadre,
    },
    {
      done: state.hasCategory,
      title: 'Crea tus categorías',
      hint: 'Con ellas clasificas cada gasto o ingreso (Mercado, Transporte, Ocio…).',
      section: 'categorias',
      cta: 'Crear categorías',
    },
  ]

  return (
    <Card title="Empieza aquí" style={{ marginBottom: 'var(--space-2)' }}>
      <p style={{ font: 'var(--font-subheadline)', color: 'var(--text-secondary)', margin: '0 0 var(--space-2)' }}>
        Tu cuenta está vacía. Crea estas tres cosas para empezar a registrar movimientos.
      </p>
      <ol style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
        {steps.map((step, i) => (
          <li key={step.title} style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'flex-start', opacity: step.done ? 0.6 : 1 }}>
            <span
              aria-hidden="true"
              style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center', font: 'var(--font-caption)', fontWeight: 600,
                background: step.done ? 'var(--status-good)' : 'var(--surface-raised)',
                color: step.done ? '#fff' : 'var(--text-secondary)',
                border: step.done ? 'none' : '1px solid var(--border-hairline)',
              }}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: 'var(--font-subheadline)', fontWeight: 600 }}>{step.title}</div>
              <div style={{ font: 'var(--font-footnote)', color: 'var(--text-muted)' }}>{step.hint}</div>
              {!step.done && (
                <button
                  type="button"
                  disabled={step.locked}
                  onClick={() => openSettings(step.section)}
                  style={{
                    minHeight: 'var(--touch-target)', marginTop: 4, padding: 0, background: 'none', border: 'none',
                    color: step.locked ? 'var(--text-muted)' : 'var(--series-1)',
                    font: 'var(--font-subheadline)', fontWeight: 600, cursor: step.locked ? 'default' : 'pointer',
                  }}
                >
                  {step.locked ? 'Primero crea la cuenta madre' : `${step.cta} →`}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
