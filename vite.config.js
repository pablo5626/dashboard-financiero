import { createHash } from 'node:crypto'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Content-Security-Policy inyectada solo en el build (en desarrollo Vite mete
// scripts en línea para el hot reload y la política los rompería). GitHub
// Pages no permite configurar headers, así que va como <meta>. La sesión de
// Supabase vive en localStorage; esta política limita a qué servidores puede
// hablar la app y bloquea scripts que no sean los propios, para que una
// eventual inyección de código no pueda mandar el token a un tercero. Los
// scripts en línea (hoy solo el de redirección de rutas de GitHub Pages) se
// permiten por hash, calculado acá, así que editarlos no rompe la política.
// Nota: `frame-ancestors` no funciona en un <meta>, por lo que no se puede
// impedir desde acá que otro sitio embeba la app en un iframe.
function contentSecurityPolicy(env) {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inlineScriptHashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`
        )
        const supabaseOrigin = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : 'https://*.supabase.co'
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${inlineScriptHashes.join(' ')}`.trim(),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          `connect-src 'self' ${supabaseOrigin} https://open.er-api.com https://api.pwnedpasswords.com`,
          "media-src 'self' blob:",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ')
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: '/dashboard-financiero/',
    plugins: [react(), contentSecurityPolicy(env)],
  }
})
