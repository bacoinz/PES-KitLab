/** Settings card "Atalhos de teclado": every command, its key, and a way to change, remove or reset it. */
import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { CATALOG, GROUPS, RESERVED, comboOf, conflictOf, keysOf, prettyKeys, setCapturing, setUserKeys, useShortcutKeys, userKeys } from './shortcuts'

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function ShortcutSettings(): JSX.Element {
  useShortcutKeys()
  const notify = useApp((s) => s.notify)
  const [q, setQ] = useState('')
  const [rec, setRec] = useState<string | null>(null) // command being re-keyed
  const persist = async (next: Record<string, string | null>): Promise<void> => {
    setUserKeys(next)
    const s = await window.kc.saveSettings({ shortcuts: next })
    useApp.setState({ settings: s })
  }
  const assign = async (id: string, combo: string | null): Promise<void> => {
    const def = CATALOG.find((c) => c.id === id)!.keys
    const next = { ...userKeys() }
    if (combo === def) delete next[id]; else next[id] = combo
    await persist(next)
  }
  useEffect(() => {
    if (!rec) return
    setCapturing(true)
    const k = (e: KeyboardEvent): void => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRec(null); return }
      if (e.key === 'Backspace') { void assign(rec, null); setRec(null); return }
      const combo = comboOf(e)
      if (!combo) return // only a modifier so far
      if (RESERVED.includes(combo)) { notify('err', 'Essa combinação é do próprio programa (recarregar, imprimir, procurar) e não pode ser usada.'); return }
      const other = conflictOf(rec, combo)
      if (other) {
        if (!confirm(`${prettyKeys(combo)} já é usado em "${other.label}". Trocar? (O outro fica sem atalho.)`)) return
        const next = { ...userKeys() }
        next[other.id] = null
        const def = CATALOG.find((c) => c.id === rec)!.keys
        if (combo === def) delete next[rec]; else next[rec] = combo
        void persist(next)
      } else void assign(rec, combo)
      setRec(null)
    }
    window.addEventListener('keydown', k, true)
    return () => { window.removeEventListener('keydown', k, true); setCapturing(false) }
  }, [rec]) // eslint-disable-line react-hooks/exhaustive-deps
  const words = norm(q).split(/\s+/).filter(Boolean)
  const changed = Object.keys(userKeys()).length
  return (
    <section className="set-card">
      <h3>Atalhos de teclado</h3>
      <div className="muted small">Carrega num atalho e prime a nova combinação (Esc cancela, Backspace tira o atalho). Ctrl+K abre o painel de comandos e ? mostra a folha de atalhos.</div>
      <div className="set-row">
        <input className="grow" value={q} placeholder="Procurar um comando…" onChange={(e) => setQ(e.target.value)} />
        <button className="btn small ghost" disabled={!changed} onClick={() => { if (confirm('Repor todos os atalhos para os predefinidos?')) void persist({}) }}>Repor todos</button>
      </div>
      <div className="keys-list">
        {GROUPS.map((g) => {
          const rows = CATALOG.filter((c) => c.group === g && words.every((w) => norm(c.label + ' ' + c.group).includes(w)))
          return rows.length ? (
            <div key={g}>
              <div className="set-sub">{g}</div>
              {rows.map((c) => {
                const own = c.id in userKeys()
                return (
                  <div key={c.id} className="key-row">
                    <span className="grow">{c.label}</span>
                    <button className={'key-btn' + (rec === c.id ? ' rec' : '') + (own ? ' own' : '')} onClick={() => setRec(rec === c.id ? null : c.id)}>
                      {rec === c.id ? 'Prime a nova combinação…' : prettyKeys(keysOf(c.id))}
                    </button>
                    <button className="btn tiny ghost" disabled={!own} title="Repor o atalho predefinido" onClick={() => void assign(c.id, c.keys)}>Repor</button>
                  </div>
                )
              })}
            </div>
          ) : null
        })}
      </div>
    </section>
  )
}
