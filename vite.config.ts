import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localExport } from './server/vite-export.mjs'

export default defineConfig({
  base: './',
  plugins: [react(), localExport()],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: {
    host: '127.0.0.1', port: 4173,
    headers: {
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
      'Referrer-Policy': 'no-referrer',
    },
  },
})
