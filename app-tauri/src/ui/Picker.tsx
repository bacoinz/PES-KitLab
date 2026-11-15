import { useEffect, useRef, useState, type ReactNode } from 'react'

const GRID_KEY = 'kc.gridSize'
let listeners: ((n: number) => void)[] = []

function readGrid(): number {
  try { return Number(localStorage.getItem(GRID_KEY)) || 170 } catch { return 170 }
}

/** Preview size shared by every picker grid (remembered between sessions). */
export function useGridSize(): [number, (n: number) => void] {
  const [n, setN] = useState(readGrid)
  useEffect(() => {
    listeners.push(setN)
    return () => { listeners = listeners.filter((l) => l !== setN) }
  }, [])
  const set = (v: number): void => {
    try { localStorage.setItem(GRID_KEY, String(v)) } catch { /* ignore */ }
    listeners.forEach((l) => l(v))
  }
  return [n, set]
}

function readFlyWidth(): number { try { return Number(localStorage.getItem('kc.flyout')) || 560 } catch { return 560 } }

/** Panel that opens between the editor sidebar and the 3D view (resizable, width remembered). */
export function Flyout({ title, onClose, children, extra }: { title: string; onClose: () => void; children: ReactNode; extra?: ReactNode }): JSX.Element {
  const [size, setSize] = useGridSize()
  const [width, setWidth] = useState(readFlyWidth)
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const x0 = e.clientX, w0 = width
    let last = w0
    const move = (ev: MouseEvent): void => { last = Math.max(260, Math.min(1400, w0 + ev.clientX - x0)); setWidth(last) }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      try { localStorage.setItem('kc.flyout', String(last)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="flyout" style={{ width }}>
      <div className="flyout-head">
        <b>{title}</b>
        {extra}
        <div className="grow" />
        <span className="muted small">Tamanho</span>
        <input type="range" min={90} max={340} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        <button className="btn ghost" onClick={onClose} title="Fechar (Esc)">✕</button>
      </div>
      <div className="flyout-body">{children}</div>
      <div className="resize-handle" onMouseDown={startDrag} title="Arrastar para redimensionar" />
    </div>
  )
}

export interface PreviewItem { id: string; label: string; load: () => Promise<string>; starred?: boolean; onStar?: () => void; onDelete?: () => void }

function Cell({ item, active, size, onPick }: { item: PreviewItem; active: boolean; size: number; onPick: () => void }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const [src, setSrc] = useState('')
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { setVis(true); io.disconnect() } }, { rootMargin: '300px' })
    if (ref.current) io.observe(ref.current)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!vis) return
    let alive = true
    item.load().then((u) => { if (alive) setSrc(u) })
    return () => { alive = false }
  }, [vis, item])
  return (
    <button ref={ref} className={'pv-cell' + (active ? ' active' : '')} style={{ width: size }} onClick={onPick} title={item.label}>
      <div className="pv-img" style={{ height: size }}>{src ? <img src={src} alt="" /> : <span className="spinner" />}</div>
      <span className="pv-label">
        {item.onDelete && <span className="pv-star pv-del" title="Apagar" onClick={(e) => { e.stopPropagation(); item.onDelete!() }}>✕</span>}
        {item.onStar && <span className={'pv-star' + (item.starred ? ' on' : '')} title="Favorito" onClick={(e) => { e.stopPropagation(); item.onStar!() }}>{item.starred ? '★' : '☆'}</span>}
        {item.label}
      </span>
    </button>
  )
}

export function PreviewGrid({ items, value, onPick }: { items: PreviewItem[]; value?: string; onPick: (id: string) => void }): JSX.Element {
  const [size] = useGridSize()
  return (
    <div className="pv-grid">
      {items.map((it) => <Cell key={it.id} item={it} size={size} active={it.id === value} onPick={() => onPick(it.id)} />)}
    </div>
  )
}

/** Small clickable thumbnail used in the sidebar to open a picker. */
export function ThumbButton({ load, label, onClick, deps }: { load: () => Promise<string>; label: string; onClick: () => void; deps: unknown[] }): JSX.Element {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    load().then((u) => { if (alive) setSrc(u) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return (
    <button className="thumb-btn" onClick={onClick} title="Escolher…">
      <div className="thumb-img">{src ? <img src={src} alt="" /> : <span className="spinner" />}</div>
      <span>{label}</span>
      <span className="muted small">Escolher ▸</span>
    </button>
  )
}

export type CatItem = PreviewItem & { category: string }

/** Grid with category chips on top and a search box (used by every picker in the side panel). */
export function CatGrid({ items, value, onPick, initialCategory, tools, empty }: { items: CatItem[]; value?: string; onPick: (id: string) => void; initialCategory?: string; tools?: ReactNode; empty?: (cat: string) => ReactNode }): JSX.Element {
  const [cat, setCat] = useState(initialCategory ?? '')
  const [q, setQ] = useState('')
  useEffect(() => { setCat(initialCategory ?? '') }, [initialCategory])
  const cats: string[] = []
  for (const it of items) if (!cats.includes(it.category)) cats.push(it.category)
  const t = q.trim().toLowerCase()
  const shown = items.filter((it) => (!cat || it.category === cat) && (!t || it.label.toLowerCase().includes(t)))
  return (
    <div className="cat-grid">
      <div className="tp-chips">
        <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>Todos</button>
        {cats.map((c) => { const n = items.filter((i) => i.category === c).length; return <button key={c} className={(cat === c ? 'on' : '') + (n ? '' : ' empty')} onClick={() => setCat(c)}>{c} <span>{n}</span></button> })}
      </div>
      <div className="picker-top">
        <input className="grow" placeholder="Pesquisar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tools}
      </div>
      {shown.length ? <PreviewGrid items={shown} value={value} onPick={onPick} /> : <div className="muted small pad">{empty?.(cat) ?? 'Nada encontrado.'}</div>}
    </div>
  )
}
