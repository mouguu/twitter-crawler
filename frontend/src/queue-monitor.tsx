import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueueMonitor } from './components/QueueMonitor'
import './index.css'

function QueueMonitorApp() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/icon.png" alt="Logo" className="w-8 h-8" />
              <span className="text-xl font-semibold">XRCrawler</span>
            </a>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-medium">Queue Monitor</h1>
          </div>
          <a 
            href="/"
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            ← Back to App
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <QueueMonitor />
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6 text-center text-sm text-muted-foreground">
        <p>XRCrawler Queue Monitor • Powered by BullMQ</p>
      </footer>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueueMonitorApp />
  </React.StrictMode>,
)
