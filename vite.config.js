import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// On Replit the dev server is reached through an HTTPS proxy iframe at
// REPLIT_DEV_DOMAIN, so Vite's default HMR client (which tries
// ws://localhost:5000) handshake-fails with a 400. Point the HMR client
// at the public domain over WSS when we detect a Replit environment.
const replitDomain = process.env.REPLIT_DEV_DOMAIN
const hmr = replitDomain
  ? { protocol: 'wss', host: replitDomain, clientPort: 443 }
  : true

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    hmr,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true
  }
})
