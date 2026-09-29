import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev server proxies the API instead of calling http://localhost:8000
// directly, so the browser only ever sees one origin. That keeps CORS out of
// the picture in development, and matches production, where the built bundle
// is served next to the API.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/detect': { target: 'http://localhost:8000', changeOrigin: true },
      '/analyze': { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
      '/static': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
