import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Two pages, one build. index.html is the landing page at "/" (prerendered,
 * indexable — src/landing/); app.html is the console's shell, served for every
 * other route. On Vercel the console service does this with a rewrite (see
 * vercel.json); this does the same for `vite` and `vite preview`.
 */
const consoleFallback: Connect.NextHandleFunction = (req, _res, next) => {
  const path = (req.url ?? '/').split('?')[0]
  const page = (req.method === 'GET' || req.method === 'HEAD') && req.headers.accept?.includes('text/html')
  const ownFile = path === '/' || path === '/index.html' || /\.[a-z0-9]+$/i.test(path) || /^\/(@|api\/|src\/|node_modules\/)/.test(path)
  if (page && !ownFile) req.url = '/app.html'
  next()
}

const twoPages = (): Plugin => ({
  name: 'aica-two-pages',
  configureServer: (server) => { server.middlewares.use(consoleFallback) },
  configurePreviewServer: (server) => { server.middlewares.use(consoleFallback) },
})

export default defineConfig({
  plugins: [react(), twoPages()],
  build: {
    target: 'es2022',
    /* Hashed output goes to /static; public/ owns /assets (the landing page's
       film, poster, orb) at fixed names. The two need opposite cache rules —
       see vercel.json. */
    assetsDir: 'static',
    rollupOptions: { input: { landing: 'index.html', console: 'app.html' } },
  },
  server: {
    // Same-origin API in dev: the session cookie and the backend's origin check
    // both see http://localhost:5173. Start the API with `npm run api` or see backend/README.md.
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
