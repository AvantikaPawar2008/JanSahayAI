import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/index.css'

// Register offline-first PWA service worker in production; clean up in local dev
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        console.log('[PWA] Service worker registered:', registration.scope)

        // Request background sync permission for offline queue replay
        if ('sync' in registration) {
          await registration.sync.register('sync-offline-queue')
        }

        // Listen for sync completion messages from SW
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SYNC_COMPLETE') {
            const { replayed, failed } = event.data
            if (replayed > 0) {
              console.log(`[PWA] Background sync complete: ${replayed} offline requests replayed`)
              window.dispatchEvent(new CustomEvent('offlineSyncComplete', { detail: { replayed, failed } }))
            }
          }
        })
      } catch (err) {
        console.warn('[PWA] Service worker registration failed:', err)
      }
    })
  } else {
    // In local development, unregister lingering service workers to prevent module cache corruption
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.unregister()
      }
    }).catch(() => {})
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
