import { supabase } from './supabaseClient.js'

// Una sola fila por usuario (user_settings.user_id es la propia primary key)
// para ajustes globales que no son de una cuenta ni categoría específica —
// hoy solo el umbral de la alerta de presupuesto por categoría. Sin fila
// todavía (usuario nuevo, o nunca tocó Ajustes → Presupuestos), estos son
// los valores por default: alertas activadas, umbral 100% (el mismo
// comportamiento que tenía la alerta antes de que este ajuste existiera).
const DEFAULTS = { budgetAlertsEnabled: true, budgetAlertThresholdPct: 100 }

export async function getUserSettings() {
  const { data, error } = await supabase.from('user_settings').select('*').maybeSingle()
  if (error) throw error
  if (!data) return DEFAULTS
  return {
    budgetAlertsEnabled: data.budget_alerts_enabled,
    budgetAlertThresholdPct: data.budget_alert_threshold_pct,
  }
}

export async function saveUserSettings({ budgetAlertsEnabled, budgetAlertThresholdPct }) {
  const { error } = await supabase.from('user_settings').upsert(
    { budget_alerts_enabled: budgetAlertsEnabled, budget_alert_threshold_pct: budgetAlertThresholdPct },
    { onConflict: 'user_id' }
  )
  if (error) throw error
}
