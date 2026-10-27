import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind on all interfaces so the sandboxed preview proxy can reach the dev server.
    host: true,
    port: 5173,
    strictPort: false,
    // Preview hosts look like <port>-<sandbox>.e2b.app; .e2b.app allows subdomains.
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
})
