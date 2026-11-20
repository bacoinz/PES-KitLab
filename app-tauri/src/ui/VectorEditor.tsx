/**
 * Compact vector editor for "Desenho livre" layers (Illustrator-style pen): paths live in a unit box
 * (−0.5 … 0.5). Pen: click adds a corner point, click-drag pulls Bézier handles, click the first point closes the
 * shape (Enter / Esc finish an open line). Select: drag points, handles or a whole shape. Ready shapes, curve /
 * corner toggle, delete point, mirror, grid + snap, zoom, undo / redo, reset. "Aplicar" writes it to the layer.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VPath, VPt } from '../model/design'

type Tool = 'select' | 'pen'
type Sel = { path: number; pt: number | null } | null
type Drag = { kind: 'pt' | 'in' | 'out' | 'path' | 'new'; path: number; pt: number; x0: number; y0: number; orig: VPath[] }

const SIZE = 520, GRID = 0.05
const clone = (p: VPath[]): VPath[] => JSON.parse(JSON.stringify(p))

function regular(n: number, r: number, inner = 0, rot = -Math.PI / 2): VPath {
  const pts: VPt[] = []
  const k = inner ? n * 2 : n
  for (let i = 0; i < k; i++) { const a = rot + (i * Math.PI * 2) / k, rr = inner && i % 2 ? inner : r; pts.push({ x: +(Math.cos(a) * rr).toFixed(4), y: +(Math.sin(a) * rr).toFixed(4) }) }
  return { pts, closed: true }
}
const SHAPES: [string, () => VPath][] = [
  ['Retângulo', () => ({ pts: [{ x: -0.3, y: -0.2 }, { x: 0.3, y: -0.2 }, { x: 0.3, y: 0.2 }, { x: -0.3, y: 0.2 }], closed: true })],
  ['Círculo', () => {
    const k = 0.5523 * 0.3, r = 0.3
    return { pts: [{ x: 0, y: -r, ix: -k, iy: -r, ox: k, oy: -r }, { x: r, y: 0, ix: r, iy: -k, ox: r, oy: k }, { x: 0, y: r, ix: k, iy: r, ox: -k, oy: r }, { x: -r, y: 0, ix: -r, iy: k, ox: -r, oy: -k }], closed: true }
  }],
  ['Triângulo', () => regular(3, 0.32)],
  ['Losango', () => ({ pts: [{ x: 0, y: -0.35 }, { x: 0.25, y: 0 }, { x: 0, y: 0.35 }, { x: -0.25, y: 0 }], closed: true })],
  ['Hexágono', () => regular(6, 0.3, 0, 0)],
  ['Estrela', () => regular(5, 0.35, 0.15)],
  ['Seta', () => ({ pts: [{ x: -0.35, y: -0.08 }, { x: 0.05, y: -0.08 }, { x: 0.05, y: -0.2 }, { x: 0.35, y: 0 }, { x: 0.05, y: 0.2 }, { x: 0.05, y: 0.08 }, { x: -0.35, y: 0.08 }], closed: true })],
  ['Chevron', () => ({ pts: [{ x: -0.35, y: -0.2 }, { x: 0, y: 0.1 }, { x: 0.35, y: -0.2 }, { x: 0.35, y: 0.05 }, { x: 0, y: 0.35 }, { x: -0.35, y: 0.05 }], closed: true })]
]

function pathD(p: VPath): string {
  if (!p.pts.length) return ''
  let d = `M${p.pts[0].x} ${p.pts[0].y}`
  const seg = (a: VPt, b: VPt): string => (a.ox !== undefined || b.ix !== undefined ? ` C${a.ox ?? a.x} ${a.oy ?? a.y} ${b.ix ?? b.x} ${b.iy ?? b.y} ${b.x} ${b.y}` : ` L${b.x} ${b.y}`)
  for (let i = 1; i < p.pts.length; i++) d += seg(p.pts[i - 1], p.pts[i])
  if (p.closed && p.pts.length > 2) d += seg(p.pts[p.pts.length - 1], p.pts[0]) + ' Z'
  return d
}

export function VectorEditor({ value, color, onApply, onClose }: { value: VPath[]; color: string; onApply: (p: VPath[]) => void; onClose: () => void }): JSX.Element {
  const [paths, setPaths] = useState<VPath[]>(() => clone(value))
  const [past, setPast] = useState<VPath[][]>([])
  const [future, setFuture] = useState<VPath[][]>([])
  const [tool, setTool] = useState<Tool>(value.length ? 'select' : 'pen')
  const [sel, setSel] = useState<Sel>(null)
  const [active, setActive] = useState<number | null>(null) // path being drawn with the pen
  const [grid, setGrid] = useState(true)
  const [snap, setSnap] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [shapesOpen, setShapesOpen] = useState(false)
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const S = (SIZE - 40) * zoom // px per unit
  const toUnit = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    let x = (e.clientX - r.left - SIZE / 2) / S, y = (e.clientY - r.top - SIZE / 2) / S
    if (snap) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID }
    return [+x.toFixed(4), +y.toFixed(4)]
  }
  const commit = (next: VPath[], before: VPath[] = paths): void => { setPast((h) => [...h.slice(-60), clone(before)]); setFuture([]); setPaths(next) }
  const undo = (): void => { const prev = past[past.length - 1]; if (!prev) return; setFuture((f) => [clone(paths), ...f]); setPast((h) => h.slice(0, -1)); setPaths(prev); setActive(null); setSel(null) }
  const redo = (): void => { const nxt = future[0]; if (!nxt) return; setPast((h) => [...h, clone(paths)]); setFuture((f) => f.slice(1)); setPaths(nxt); setActive(null); setSel(null) }
  const finish = (): void => { setActive(null) }

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && t.tagName === 'INPUT') return
      if (e.key === 'Escape' || e.key === 'Enter') { if (active !== null) finish(); else if (e.key === 'Escape') onClose() }
      else if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel()
      else if (e.key === 'p' || e.key === 'P') setTool('pen')
      else if (e.key === 'v' || e.key === 'V') { finish(); setTool('select') }
      e.stopPropagation()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSel = (): void => {
    if (!sel) return
    const n = clone(paths)
    if (sel.pt === null || n[sel.path].pts.length <= 2) n.splice(sel.path, 1)
    else n[sel.path].pts.splice(sel.pt, 1)
    commit(n); setSel(null); setActive(null)
  }
  const toggleCurve = (): void => {
    if (!sel || sel.pt === null) return
    const n = clone(paths), p = n[sel.path], a = p.pts[sel.pt]
    if (a.ix !== undefined || a.ox !== undefined) { delete a.ix; delete a.iy; delete a.ox; delete a.oy }
    else {
      // smooth: handles along the line between the neighbours
      const prev = p.pts[(sel.pt - 1 + p.pts.length) % p.pts.length], next = p.pts[(sel.pt + 1) % p.pts.length]
      const dx = (next.x - prev.x) / 4, dy = (next.y - prev.y) / 4
      Object.assign(a, { ix: a.x - dx, iy: a.y - dy, ox: a.x + dx, oy: a.y + dy })
    }
    commit(n)
  }
  /** Join: all the points become one closed shape (old layers with several shapes are merged in order). */
  const join = (): void => {
    const pts = paths.flatMap((p) => p.pts)
    if (pts.length < 3) return
    commit([{ pts: clone([{ pts, closed: true }])[0].pts, closed: true }]); setActive(null); setSel({ path: 0, pt: null })
  }
  const mirror = (): void => {
    const idx = sel ? [sel.path] : paths.map((_, i) => i)
    const n = clone(paths)
    for (const i of idx) for (const a of n[i].pts) { a.x = -a.x; if (a.ix !== undefined) a.ix = -a.ix; if (a.ox !== undefined) a.ox = -a.ox }
    commit(n)
  }

  const down = (e: React.PointerEvent, kind: Drag['kind'] | 'bg', path = -1, pt = -1): void => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const [x, y] = toUnit(e)
    if (tool === 'pen') {
      // one shape per layer: every point belongs to the same shape (old layers with several: the last one), so
      // stopping and coming back later continues it instead of starting a new, unconnected shape
      const n = clone(paths)
      if (!n.length) n.push({ pts: [], closed: false })
      const pi = n.length - 1, p = n[pi]
      if (kind === 'pt' && path === pi) {
        // the first point closes an open shape; any other point is where the next points go (after it)
        if (!p.closed && pt === 0 && p.pts.length > 2) { p.closed = true; commit(n); setActive(null); setSel({ path: pi, pt: null }); return }
        setActive(pi); setSel({ path: pi, pt }); return
      }
      const at = sel && sel.path === pi && sel.pt !== null && (p.closed || sel.pt < p.pts.length - 1) ? sel.pt + 1 : p.pts.length
      p.pts.splice(at, 0, { x, y })
      commit(n); setActive(pi)
      drag.current = { kind: 'new', path: pi, pt: at, x0: x, y0: y, orig: n }
      setSel({ path: pi, pt: at })
      return
    }
    if (kind === 'bg') { setSel(null); return }
    setSel({ path, pt: kind === 'path' ? null : pt })
    drag.current = { kind: kind as Drag['kind'], path, pt, x0: x, y0: y, orig: clone(paths) }
  }
  const move = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const [x, y] = toUnit(e), dx = x - d.x0, dy = y - d.y0
    const n = clone(d.orig), p = n[d.path]
    if (!p) return
    if (d.kind === 'path') for (const a of p.pts) { a.x += dx; a.y += dy; if (a.ix !== undefined) { a.ix += dx; a.iy! += dy } if (a.ox !== undefined) { a.ox += dx; a.oy! += dy } }
    else if (d.kind === 'pt') { const a = p.pts[d.pt]; a.x += dx; a.y += dy; if (a.ix !== undefined) { a.ix += dx; a.iy! += dy } if (a.ox !== undefined) { a.ox += dx; a.oy! += dy } }
    else if (d.kind === 'in' || d.kind === 'out') {
      const a = p.pts[d.pt]
      if (d.kind === 'out') { a.ox = x; a.oy = y; if (!e.altKey) { a.ix = 2 * a.x - x; a.iy = 2 * a.y - y } } else { a.ix = x; a.iy = y; if (!e.altKey) { a.ox = 2 * a.x - x; a.oy = 2 * a.y - y } }
    } else if (d.kind === 'new') {
      // pen drag: pull symmetric handles out of the new point
      if (Math.hypot(dx, dy) < 0.01) return
      const a = p.pts[d.pt]; a.ox = x; a.oy = y; a.ix = 2 * a.x - x; a.iy = 2 * a.y - y
    }
    setPaths(n)
  }
  const up = (): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind !== 'new' && JSON.stringify(d.orig) !== JSON.stringify(paths)) { setPast((h) => [...h.slice(-60), d.orig]); setFuture([]) }
  }

  const ticks = Array.from({ length: Math.round(2 / GRID) + 1 }, (_, i) => -1 + i * GRID)
  const btn = (label: string, title: string, on: boolean, fn: () => void, disabled = false): JSX.Element => (
    <button type="button" className={'ve-btn' + (on ? ' on' : '')} title={title} disabled={disabled} onClick={fn}>{label}</button>
  )
  const sp = sel && sel.pt !== null ? paths[sel.path]?.pts[sel.pt] : undefined
  return createPortal(
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal ve" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Caneta</b><button className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="ve-body">
          <div className="ve-tools">
            {btn('↖', 'Selecionar (V): arrasta pontos, pegas ou formas', tool === 'select', () => { finish(); setTool('select') })}
            {btn('✒', 'Caneta (P): clica para pontos, arrasta para curvas, clica no 1.º ponto para fechar', tool === 'pen', () => setTool('pen'))}
            {btn('↶', 'Anular (Ctrl+Z)', false, undo, !past.length)}
            {btn('↷', 'Refazer (Ctrl+Y)', false, redo, !future.length)}
            <span className="ve-shapes">
              {btn('◇', 'Formas prontas (substituem a forma: uma forma por camada)', shapesOpen, () => setShapesOpen(!shapesOpen))}
              {shapesOpen && <div className="ve-menu">{SHAPES.map(([n, f]) => <button key={n} onClick={() => { commit([f()]); setShapesOpen(false); setTool('select'); setSel({ path: 0, pt: null }) }}>{n}</button>)}</div>}
            </span>
            {btn('⌒', 'Curva / canto no ponto selecionado', !!sp && (sp.ix !== undefined || sp.ox !== undefined), toggleCurve, !sp)}
            {btn('⌫', 'Apagar o ponto (ou a forma) selecionado(a) — Delete', false, deleteSel, !sel)}
            {btn('⊃', 'Unir: liga o último ponto ao primeiro e fecha a forma (com preenchimento)', false, join, paths.flatMap((p) => p.pts).length < 3 || (paths.length === 1 && paths[0].closed))}
            {btn('⇋', 'Espelhar (forma selecionada ou tudo)', false, mirror, !paths.length)}
            {btn('#', 'Grelha', grid, () => setGrid(!grid))}
            {btn('Íman', 'Íman: encaixar na grelha', snap, () => setSnap(!snap))}
            {btn('−', 'Afastar', false, () => setZoom((z) => Math.max(0.4, z / 1.25)))}
            {btn('+', 'Aproximar', false, () => setZoom((z) => Math.min(4, z * 1.25)))}
            {btn('⤢', 'Ajustar', false, () => setZoom(1))}
            {btn('⟲', 'Repor (apagar tudo)', false, () => { if (confirm('Apagar todas as formas?')) { commit([]); setSel(null); setActive(null) } }, !paths.length)}
          </div>
          <svg ref={svg} width={SIZE} height={SIZE} className={'ve-canvas tool-' + tool} onPointerDown={(e) => down(e, 'bg')} onPointerMove={move} onPointerUp={up}>
            <g transform={`translate(${SIZE / 2} ${SIZE / 2}) scale(${S})`}>
              <rect x={-0.5} y={-0.5} width={1} height={1} fill="#e8e8ea" />
              {grid && ticks.map((t) => (
                <g key={t} stroke={Math.abs(t) < 1e-6 ? '#9a9aa6' : '#d0d0d6'} strokeWidth={1 / S}>
                  <line x1={t} y1={-1} x2={t} y2={1} /><line x1={-1} y1={t} x2={1} y2={t} />
                </g>
              ))}
              <rect x={-0.5} y={-0.5} width={1} height={1} fill="none" stroke="#666" strokeDasharray={`${4 / S} ${4 / S}`} strokeWidth={1 / S} />
              {/* all closed shapes in one even-odd fill, so holes show */}
              <path d={paths.filter((p) => p.closed).map(pathD).join(" ")} fill={color} fillOpacity={0.55} fillRule="evenodd" pointerEvents="none" />
              {paths.map((p, i) => (
                <path key={i} d={pathD(p)} fill={p.closed ? "transparent" : "none"} stroke={sel?.path === i ? '#14d16b' : color} strokeWidth={(p.closed ? 2 : 6) / S}
                  onPointerDown={(e) => down(e, 'path', i)} style={{ cursor: tool === 'select' ? 'move' : 'crosshair' }} />
              ))}
              {paths.map((p, i) => p.pts.map((a, j) => {
                const selected = sel?.path === i && sel.pt === j, r = 6 / S
                return (
                  <g key={i + ':' + j}>
                    {(selected || active === i) && a.ix !== undefined && <><line x1={a.x} y1={a.y} x2={a.ix} y2={a.iy} stroke="#14d16b" strokeWidth={1 / S} /><circle cx={a.ix} cy={a.iy} r={r * 0.7} fill="#14d16b" onPointerDown={(e) => down(e, 'in', i, j)} /></>}
                    {(selected || active === i) && a.ox !== undefined && <><line x1={a.x} y1={a.y} x2={a.ox} y2={a.oy} stroke="#14d16b" strokeWidth={1 / S} /><circle cx={a.ox} cy={a.oy} r={r * 0.7} fill="#14d16b" onPointerDown={(e) => down(e, 'out', i, j)} /></>}
                    <circle cx={a.x} cy={a.y} r={r} fill={selected ? '#14d16b' : '#fff'} stroke="#333" strokeWidth={1.5 / S} onPointerDown={(e) => down(e, 'pt', i, j)} style={{ cursor: 'pointer' }} />
                  </g>
                )
              }))}
            </g>
          </svg>
          <div className="ve-foot">
            <span className="muted small">{tool === 'pen' ? (paths.some((p) => p.pts.length) ? 'Clica para acrescentar pontos à forma · clica num ponto para continuar a partir dele · no 1.º ponto fecha' : 'Clica para começar a forma (arrasta para curvas)') : 'Arrasta pontos, pegas (Alt = pegas soltas) ou a forma inteira'}</span>
            <span className="grow" />
            <button className="btn small ghost" onClick={onClose}>Cancelar</button>
            <button className="btn small primary" onClick={() => onApply(paths.filter((p) => p.pts.length > 1))}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
