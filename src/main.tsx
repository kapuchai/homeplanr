import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initTheming } from './theme/themeStore'
import App from './App.tsx'

// Stamp data-theme + accent vars before the first frame renders.
initTheming()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
