import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './styles.css'
import { App } from './App'
import { MiniWatch } from './components/Watch'
import { initStore } from './lib/store'

void initStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* The always-on-top window for watched runs loads the same page with #mini. */}
      {location.hash === '#mini' ? <MiniWatch /> : <App />}
    </StrictMode>
  )
})
