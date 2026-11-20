/** Command palette (Ctrl+K: search and run any command) and the sheet with all the current shortcuts (?). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import { GROUPS, availableCommands, keysOf, prettyKeys, runCommand, useShortcutKeys, CATALOG, ctxActive } from './shortcuts'

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function CommandPalette({ onClose }: { onClose: () => void }): JSX.Element {
  useShortcutKeys()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => { box.current?.focus() }, [])
  // computed once: the palette is open for a moment and the screen behind does not change
  const all = useMemo(() => availableCommands().filter((c) => c.id !== 'palette.open'), [])
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean)
    return all.filter((c) => { const hay = norm(c.label + ' ' + t(c.label) + ' ' + c.group); return words.every((w) => hay.includes(w)) })
  }, [all, q])
  useEffect(() => { setI(0) }, [q])
  const run = (id: string): void => { onClose(); setTimeout(() => runCommand(id), 0) }
  return (
    <div className="cmd-bg" onPointerDown={onClose}>
      <div className="cmd" onPointerDown={(e) => e.stopPropagation()}>
        <input ref={box} value={q} placeholder="Escreve um comando…" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(list.length - 1, v + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(0, v - 1)) }
            else if (e.key === 'Enter' && list[i]) { e.preventDefault(); run(list[i].id) }
          }} />
        <div className="cmd-list">
          {list.map((c, k) => (
            <button key={c.id} className={'cmd-item' + (k === i ? ' on' : '')} onMouseEnter={() => setI(k)} onClick={() => run(c.id)}>
              <span>{c.label}</span><kbd>{prettyKeys(keysOf(c.id))}</kbd>
            </button>
          ))}
          {!list.length && <div className="muted small cmd-empty">Nenhum comando encontrado.</div>}
        </div>
      </div>
    </div>
  )
}

export function ShortcutSheet({ onClose }: { onClose: () => void }): JSX.Element {
  useShortcutKeys()
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="cmd-bg" onPointerDown={onClose}>
      <div className="cmd sheet" onPointerDown={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>Atalhos de teclado</b><span className="muted small">Podes mudá-los em Definições.</span></div>
        <div className="sheet-cols">
          {GROUPS.map((g) => {
            const rows = CATALOG.filter((c) => c.group === g && ctxActive(c.ctx))
            return rows.length ? (
              <div key={g}>
                <div className="set-sub">{g}</div>
                {rows.map((c) => <div key={c.id} className="sheet-row"><span>{c.label}</span><kbd>{prettyKeys(keysOf(c.id))}</kbd></div>)}
              </div>
            ) : null
          })}
        </div>
      </div>
    </div>
  )
}
