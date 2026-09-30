import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LocationTemplateCreator } from './components/LocationTemplateCreator.tsx'
import { TEMPLATE_EDITOR_VIEW } from './domain/templateEditorWindow.ts'

const search = new URLSearchParams(window.location.search)
if (search.get('fresh') === '1') {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('magnus.')) {
      localStorage.removeItem(key)
    }
  }
  search.delete('fresh')
  const query = search.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}

function closeTemplateEditorWindow() {
  window.close()
  // Direct navigations (not opened via window.open) can't be closed by script; fall back to the main app.
  window.setTimeout(() => {
    if (!window.closed) window.location.replace(window.location.pathname)
  }, 150)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {search.get('view') === TEMPLATE_EDITOR_VIEW
      ? <LocationTemplateCreator onClose={closeTemplateEditorWindow} />
      : <App />}
  </StrictMode>,
)
