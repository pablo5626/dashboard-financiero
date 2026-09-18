import { useState } from 'react'
import { IconClose, IconChat } from './icons.jsx'
import { askMoney } from '../lib/moneyAskApi.js'
import styles from './MoneyAskPanel.module.css'

const EXAMPLES = ['¿Cuánto gasté en Mercado este mes?', '¿Cómo voy con el presupuesto de Rappi?', '¿Cuál es mi patrimonio neto?']

// Panel global de "Preguntale a tu dinero" — mismo esqueleto que
// SearchPanel.jsx (backdrop + pantalla completa en móvil / tarjeta flotante
// en desktop), montado una sola vez en AppShell.jsx y disparado desde la
// burbuja satélite junto a la lupa de QuickCaptureFAB. Sin persistencia: el
// historial de preguntas de esta apertura se pierde al cerrar, mismo
// criterio stateless que el resto de las capturas rápidas de la app.
export default function MoneyAskPanel({ open, onClose }) {
  const [question, setQuestion] = useState('')
  const [thread, setThread] = useState([]) // [{ question, answer }]
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState(null)

  function close() {
    onClose()
    setQuestion('')
    setThread([])
    setError(null)
  }

  async function handleAsk(e) {
    e.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setError(null)
    try {
      const answer = await askMoney(q)
      setThread((prev) => [...prev, { question: q, answer }])
      setQuestion('')
    } catch (err) {
      setError(err.message)
    } finally {
      setAsking(false)
    }
  }

  if (!open) return null

  return (
    <div className={styles.backdrop} onClick={close}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="money-ask-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.titleBadge}><IconChat width={16} height={16} /></span>
            <h2 id="money-ask-title" className={styles.title}>Preguntale a tu dinero</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={close} aria-label="Cerrar">
            <IconClose width={20} height={20} />
          </button>
        </div>

        <div className={styles.thread}>
          {thread.length === 0 && !asking && (
            <div className={styles.examples}>
              <p className={styles.hint}>Probá preguntando:</p>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className={styles.exampleChip} onClick={() => setQuestion(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          )}

          {thread.map((item, i) => (
            <div key={i} className={styles.entry}>
              <p className={styles.entryQuestion}>{item.question}</p>
              <p className={styles.entryAnswer}>{item.answer}</p>
            </div>
          ))}

          {asking && <p className={styles.thinking}>Pensando…</p>}
          {error && <p className={styles.error}>{error}</p>}
        </div>

        <form className={styles.askRow} onSubmit={handleAsk}>
          <input
            className={styles.bigInput}
            placeholder="Escribí tu pregunta…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            autoFocus
          />
          <button type="submit" className={styles.askButton} disabled={!question.trim() || asking}>
            Preguntar
          </button>
        </form>
      </div>
    </div>
  )
}
