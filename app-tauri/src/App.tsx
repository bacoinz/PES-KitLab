import { useEffect, useState } from 'react'
import { useApp, type View } from './state'
import { Teams } from './ui/Teams'
import { Editor } from './ui/Editor'
import { Bulk } from './ui/Bulk'
import { Library } from './ui/Library'
import { Settings } from './ui/Settings'
import { Footer } from './ui/Footer'
import { setLang } from './i18n'

const NAV: [View, string][] = [['teams', 'Equipas'], ['editor', 'Editor'], ['bulk', 'Gerador em massa'], ['library', 'Biblioteca'], ['settings', 'Definições']]

function Brand({ version }: { version: string }): JSX.Element {
  return (
    <div className="splash-brand">
      <img src="/logo.png" alt="" />
      <h1>PES KitLab{version && <small>v{version}</small>}</h1>
    </div>
  )
}

/** Start screen. First run (no game folder saved): folder picker. Later runs: a spinner with the loading step. */
function Splash({ version, booting }: { version: string; booting: boolean }): JSX.Element {
  const openGame = useApp((s) => s.openGame)
  const notify = useApp((s) => s.notify)
  const progress = useApp((s) => s.progress)
  const gameRoot = useApp((s) => s.settings?.gameRoot)
  const [busy, setBusy] = useState(false)
  const loading = booting || busy
  const pick = async (): Promise<void> => {
    const d = await window.kc.pickFolder('Pasta do jogo (onde está o FL_2027.exe)')
    if (!d) return
    setBusy(true)
    try { await openGame(d) } catch (e) { notify('err', String((e as Error).message ?? e)) } finally { setBusy(false) }
  }
  return (
    <div className="splash">
      <div className="splash-main">
        <Brand version={version} />
        {loading ? (
          <div className="splash-load">
            <span className="spinner big" />
            <div className="splash-step">{progress || 'A abrir o jogo…'}</div>
          </div>
        ) : (
          <div className="splash-pick">
            <button className="btn primary big" onClick={pick}>Escolher pasta do jogo…</button>
            <input readOnly value={gameRoot ?? ''} placeholder="Pasta do jogo (onde está o FL_2027.exe)" title={gameRoot ?? ''} />
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}

export function App(): JSX.Element {
  const { status, view, setView, toast, progress, init, project, undo, redo } = useApp()
  const lang = useApp((s) => s.settings?.lang)
  useEffect(() => { setLang(lang) }, [lang])
  useEffect(() => {
    const h = (e: MouseEvent): void => { const t = e.target as HTMLElement; if (!t.closest('input, textarea, [contenteditable]')) e.preventDefault() }
    window.addEventListener('contextmenu', h)
    return () => window.removeEventListener('contextmenu', h)
  }, [])
  // auto-save (Definições → Gravação automática): the open team, only when it has unsaved changes (not the
  // sandbox projects of the template editors)
  const autoSave = useApp((s) => s.settings?.autoSave ?? 0)
  useEffect(() => {
    if (!autoSave) return
    const t = setInterval(() => {
      const s = useApp.getState()
      if (!s.project || s.project.teamId < 0 || s.project === s.savedProject) return
      s.saveProject().then(() => s.notify('ok', 'Guardado automaticamente')).catch(() => undefined)
    }, autoSave * 60000)
    return () => clearInterval(t)
  }, [autoSave])
  const [version, setVersion] = useState('')
  const [booting, setBooting] = useState(true)
  useEffect(() => { init().finally(() => setBooting(false)); window.kc.getVersion().then(setVersion) }, [init])
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'z') { e.preventDefault(); undo() }
      if (e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo])

  return (
    <div className="app">
      {status && <header className="topbar">
        <div className="brand"><img className="brand-logo" src="/logo.png" alt="" /> PES KitLab <span className="version">v{version}</span></div>
        {status && (
          <nav>
            {NAV.map(([v, l]) => (
              <button key={v} className={'nav' + (view === v ? ' active' : '')} onClick={() => setView(v)} disabled={v === 'editor' && !project}>{l}</button>
            ))}
          </nav>
        )}
        <div className="grow" />
        {status && progress && <div className="progress"><span className="spinner" />{progress}</div>}
        <div className="game-chip" title={status.root}>{status.teamCount} equipas · {status.kitsRoot ? 'Sider kit-server ✓' : 'sem kit-server'}</div>
      </header>}
      <main className="content">
        {!status ? <Splash version={version} booting={booting} /> : view === 'teams' ? <Teams /> : view === 'editor' && project ? <Editor /> : view === 'bulk' ? <Bulk /> : view === 'library' ? <Library /> : view === 'settings' ? <Settings /> : <Teams />}
      </main>
      {toast && <div className={'toast ' + toast.kind} onClick={() => useApp.setState({ toast: null })}>{toast.text}</div>}
    </div>
  )
}
