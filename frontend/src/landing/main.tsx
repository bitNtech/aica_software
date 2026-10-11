import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
/* Base first: component styles must be able to override it, not the reverse —
   the other order let `.btn` pull the fixed phone CTA back into the page flow. */
import './index.css'
import App from './App'

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

/* The build prerenders the page into #root (scripts/prerender.mjs), so the
   hero paints before any JS runs; in dev it arrives empty. */
if (root.firstElementChild) hydrateRoot(root, app)
else createRoot(root).render(app)
