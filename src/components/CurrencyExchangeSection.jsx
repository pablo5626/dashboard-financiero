import { useEffect, useState } from 'react'
import Card from './ui/Card.jsx'
import { formatByCurrency } from '../lib/format.js'
import { convertAmount } from '../lib/exchangeRatesApi.js'
import { createTransfers } from '../lib/transfersApi.js'

const emptyForm = { fromAccountId: '', toAccountId: '', amount: '', toAmount: '' }

// Acceso rápido para registrar un cambio de divisa entre dos cuentas (ej.
// arq-USD <-> arq-EUR, o una hija COP <-> arq) — a diferencia del
// formulario genérico de Historial de transferencias, acá el monto de
// destino se sugiere solo a partir de la tasa guardada para ese par, y el
// usuario solo la ajusta si la tasa real de esa operación puntual fue
// distinta. Las filas creadas quedan en la misma tabla account_transfers,
// así que aparecen igual en el historial de abajo.
export default function CurrencyExchangeSection({ accounts, rates, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [amountTouchedByUser, setAmountTouchedByUser] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function currencyOf(id) {
    return accounts.find((a) => a.id === id)?.currency || 'COP'
  }

  const fromCurrency = form.fromAccountId ? currencyOf(form.fromAccountId) : null
  const toCurrency = form.toAccountId ? currencyOf(form.toAccountId) : null
  const crossCurrency = !!(fromCurrency && toCurrency && fromCurrency !== toCurrency)

  useEffect(() => {
    if (!crossCurrency || !form.amount || amountTouchedByUser) return
    const suggested = convertAmount(Number(form.amount), fromCurrency, toCurrency, rates)
    if (suggested != null) setForm((f) => ({ ...f, toAmount: String(Math.round(suggested * 100) / 100) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount, form.fromAccountId, form.toAccountId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.fromAccountId || !form.toAccountId || !form.amount) return
    if (crossCurrency && !form.toAmount) return
    setSaving(true)
    try {
      await createTransfers([{
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amount: Number(form.amount),
        currency: fromCurrency,
        ...(crossCurrency ? { toAmount: Number(form.toAmount), toCurrency } : {}),
        transferDate: new Date().toISOString().slice(0, 10),
        note: 'Cambio de divisa',
      }])
      setForm(emptyForm)
      setAmountTouchedByUser(false)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Cambio de divisa" className="span-3">
      {error && <p style={{ color: 'var(--status-critical)' }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select
          value={form.fromAccountId}
          onChange={(e) => { setForm({ ...emptyForm, fromAccountId: e.target.value }); setAmountTouchedByUser(false) }}
          style={formInput}
        >
          <option value="">Cuenta origen</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency || 'COP'})</option>)}
        </select>
        <input
          type="number" placeholder={fromCurrency ? `Monto que sale (${fromCurrency})` : 'Monto que sale'}
          value={form.amount}
          onChange={(e) => { setForm({ ...form, amount: e.target.value }); setAmountTouchedByUser(false) }}
          style={{ ...formInput, width: 170 }}
        />
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <select
          value={form.toAccountId}
          onChange={(e) => { setForm({ ...form, toAccountId: e.target.value, toAmount: '' }); setAmountTouchedByUser(false) }}
          style={formInput}
        >
          <option value="">Cuenta destino</option>
          {accounts.filter((a) => a.id !== form.fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency || 'COP'})</option>)}
        </select>
        {crossCurrency && (
          <input
            type="number" placeholder={`Monto que entra (${toCurrency})`}
            value={form.toAmount}
            onChange={(e) => { setForm({ ...form, toAmount: e.target.value }); setAmountTouchedByUser(true) }}
            style={{ ...formInput, width: 170 }}
          />
        )}
        <button
          type="submit" disabled={saving}
          style={{ minHeight: 'var(--touch-target)', padding: '0 var(--space-2)', borderRadius: 10, background: 'var(--series-1)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}
        >
          Registrar cambio
        </button>
      </form>
      {crossCurrency && form.amount && form.toAmount && (
        <p style={{ font: 'var(--font-caption)', color: 'var(--text-muted)', marginTop: 8 }}>
          {formatByCurrency(Number(form.amount), fromCurrency)} → {formatByCurrency(Number(form.toAmount), toCurrency)}
        </p>
      )}
    </Card>
  )
}

const formInput = { minHeight: 'var(--touch-target)', borderRadius: 10, border: '1px solid var(--border-hairline)', padding: '0 var(--space-1)' }
