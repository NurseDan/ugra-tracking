import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import 'leaflet/dist/leaflet.css'
import { ensureServiceWorker, isServiceWorkerSupported } from './lib/notifications'

if (isServiceWorkerSupported()) {
  ensureServiceWorker().catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
