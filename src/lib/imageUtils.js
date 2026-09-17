// Redimensiona una foto de recibo antes de mandarla a la Edge Function —
// una foto de celular sin comprimir puede pesar varios MB, más de lo que
// hace falta para que un modelo de visión lea un recibo, y hace la subida
// lenta en datos móviles. Devuelve { base64, mediaType } listo para el body
// JSON de receipt-parse (el prefijo "data:image/...;base64," se descarta,
// Claude espera el base64 puro).
export async function resizeImageFileToBase64(file, maxDimension = 1600, quality = 0.8) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.readAsDataURL(file)
  })

  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('No se pudo procesar la imagen'))
    el.src = dataUrl
  })

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const resizedDataUrl = canvas.toDataURL('image/jpeg', quality)
  const base64 = resizedDataUrl.slice(resizedDataUrl.indexOf(',') + 1)
  return { base64, mediaType: 'image/jpeg' }
}
