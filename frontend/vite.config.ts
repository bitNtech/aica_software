import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
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
