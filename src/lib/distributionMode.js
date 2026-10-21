// Preferencia general de la app: ¿el reparto mensual de la madre le sale de
// la cuenta madre?
//
//   Activado  → cada hija recibe su monto como una TRANSFERENCIA madre→hija.
//                Bold (la madre) baja el total repartido.
//   Desactivado → cada hija arranca el mes con ese monto como SALDO INICIAL
//                de ella (ancla en monthly_initial_balances) y la madre no se
//                toca: esa plata no salió de ella.
//
// Se guarda en localStorage (mismo patrón que el switch viejo de "Restar de
// la cuenta madre al confirmar"), así que no hace falta tocar el schema ni
// correr un snippet en la base viva. Ojo: es una preferencia DEL NAVEGADOR —
// si se quiere sincronizada entre el celular y la compu, el lugar natural
// sería la tabla user_settings (como budget_alerts_enabled), pero eso exige
// una columna nueva + el snippet de SQL de .claude/rules/esquema-datos.md.
const KEY = 'monthlyDistributionFromMother'

export function isDistributionFromMother() {
  try {
    const v = localStorage.getItem(KEY)
    return v === null ? true : v === 'true'
  } catch {
    return true
  }
}

export function setDistributionFromMother(value) {
  try {
    localStorage.setItem(KEY, String(!!value))
  } catch {
    // Sin localStorage (modo privado) la preferencia no se recuerda: se
    // sigue usando el default (activado) mientras la app esté abierta.
  }
}
