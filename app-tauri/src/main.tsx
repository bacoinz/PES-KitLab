import '@fontsource-variable/inter'
import './kc'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { startFontWatcher } from './fonts'

startFontWatcher()

createRoot(document.getElementById('root')!).render(<App />)
