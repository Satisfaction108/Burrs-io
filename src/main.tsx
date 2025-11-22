import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Global error logging
window.onerror = (message, source, lineno, colno, error) => {
  console.error('❌ Global Error:', {
    message,
    source,
    line: lineno,
    column: colno,
    error: error?.stack || error,
    timestamp: new Date().toISOString(),
  })
  return false // Let default error handling continue
}

// Unhandled promise rejection logging
window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled Promise Rejection:', {
    reason: event.reason,
    promise: event.promise,
    timestamp: new Date().toISOString(),
  })
})

// Log app initialization
console.log('🚀 burrs.io client initializing...', {
  timestamp: new Date().toISOString(),
  userAgent: navigator.userAgent,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

