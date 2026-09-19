// Revisa si una contraseña aparece en filtraciones públicas de datos, con la API
// de "Have I Been Pwned" (Pwned Passwords) por k-anonimato: solo se envían los
// primeros 5 caracteres del hash SHA-1, nunca la contraseña ni el hash completo;
// la comparación del resto se hace acá. Si el navegador no puede calcular el
// hash (contexto no seguro) o el servicio no responde, no se bloquea el registro.
export async function isPasswordPwned(password) {
  try {
    if (!globalThis.crypto?.subtle) return false
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const prefix = hex.slice(0, 5)
    const suffix = hex.slice(5)

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' }, // mezcla resultados falsos (conteo 0) para no filtrar el tamaño real
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return false

    const body = await res.text()
    return body.split('\n').some((line) => {
      const [lineSuffix, count] = line.trim().split(':')
      return lineSuffix === suffix && Number(count) > 0
    })
  } catch {
    return false
  }
}
