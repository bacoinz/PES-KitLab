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
type Drag = { kind: 'pt' | 'in' | 'out' | 'path' | 'new' | 'multi'; path: number; pt: number; x0: number; y0: number; orig: VPath[] }

const GRID = 0.05
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

type Pt2 = [number, number]

/** The path between two point indexes as a dense polyline (Béziers sampled), for simplifying. */
function flatten(p: VPath, from: number, to: number): Pt2[] {
  const out: Pt2[] = [[p.pts[from % p.pts.length].x, p.pts[from % p.pts.length].y]]
  const n = p.pts.length
  for (let i = from; i < to; i++) {
    const a = p.pts[i % n], b = p.pts[(i + 1) % n]
    if (a.ox !== undefined || b.ix !== undefined) {
      const c1: Pt2 = [a.ox ?? a.x, a.oy ?? a.y], c2: Pt2 = [b.ix ?? b.x, b.iy ?? b.y]
      for (let k = 1; k <= 14; k++) {
        const t = k / 14, u = 1 - t
        out.push([u * u * u * a.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b.x, u * u * u * a.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b.y])
      }
    } else out.push([b.x, b.y])
  }
  return out
}
/** Ramer–Douglas–Peucker: indexes of the polyline points that stay. */
function rdp(pts: Pt2[], eps: number): number[] {
  const keep = new Set<number>([0, pts.length - 1])
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let dm = 0, im = -1
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-9
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L
      if (d > dm) { dm = d; im = i }
    }
    if (im >= 0 && dm > eps) { keep.add(im); stack.push([a, im], [im, b]) }
  }
  return [...keep].sort((x, y) => x - y)
}
/**
 * Simplifies the run of points `from … to` (indexes may wrap): fewer points that follow the same outline with smooth
 * curves (real corners stay sharp), not a straight line between the ends. The first and last point of the run stay.
 */
function simplifyRun(p: VPath, from: number, to: number, eps: number): VPt[] {
  const flat = flatten(p, from, to)
  const k = rdp(flat, eps).map((i) => flat[i])
  const res: VPt[] = k.map(([x, y]) => ({ x: +x.toFixed(4), y: +y.toFixed(4) }))
  const m = res.length
  const r4 = (v: number): number => +v.toFixed(4)
  for (let i = 1; i < m - 1; i++) {
    const prev = k[i - 1], next = k[i + 1]
    const v1: Pt2 = [k[i][0] - prev[0], k[i][1] - prev[1]], v2: Pt2 = [next[0] - k[i][0], next[1] - k[i][1]]
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2)
    if (!l1 || !l2) continue
    if ((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2) < 0.2) continue // a real corner (more than ~78°): keep it sharp
    const tx = (next[0] - prev[0]) / (l1 + l2), ty = (next[1] - prev[1]) / (l1 + l2)
    const a = res[i]
    a.ix = r4(a.x - (tx * l1) / 3); a.iy = r4(a.y - (ty * l1) / 3)
    a.ox = r4(a.x + (tx * l2) / 3); a.oy = r4(a.y + (ty * l2) / 3)
  }
  // the ends keep the handle that points into the run (so the first / last segment still curves)
  if (m > 2) {
    const f = res[0], l = res[m - 1]
    f.ox = r4(f.x + (res[1].x - f.x) / 3); f.oy = r4(f.y + (res[1].y - f.y) / 3)
    l.ix = r4(l.x + (res[m - 2].x - l.x) / 3); l.iy = r4(l.y + (res[m - 2].y - l.y) / 3)
  }
  return res
}

function pathD(p: VPath): string {
  if (!p.pts.length) return ''
  let d = `M${p.pts[0].x} ${p.pts[0].y}`
  const seg = (a: VPt, b: VPt): string => (a.ox !== undefined || b.ix !== undefined ? ` C${a.ox ?? a.x} ${a.oy ?? a.y} ${b.ix ?? b.x} ${b.iy ?? b.y} ${b.x} ${b.y}` : ` L${b.x} ${b.y}`)
  for (let i = 1; i < p.pts.length; i++) d += seg(p.pts[i - 1], p.pts[i])
  if (p.closed && p.pts.length > 2) d += seg(p.pts[p.pts.length - 1], p.pts[0]) + ' Z'
  return d
}

const SIZE_MAX = 680
export function VectorEditor({ value, color, onApply, onClose }: { value: VPath[]; color: string; onApply: (p: VPath[]) => void; onClose: () => void }): JSX.Element {
  const SIZE = Math.max(440, Math.min(SIZE_MAX, window.innerHeight - 250))
  const [paths, setPaths] = useState<VPath[]>(() => clone(value))
  const [multi, setMulti] = useState<Set<string>>(new Set()) // selected points "path:point"
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [simp, setSimp] = useState(1) // 0 fine · 1 medium · 2 strong
  const [past, setPast] = useState<VPath[][]>([])
  const [future, setFuture] = useState<VPath[][]>([])
  const [tool, setTool] = useState<Tool>(value.length ? 'select' : 'pen')
  const [sel, setSel] = useState<Sel>(null)
  const [active, setActive] = useState<number | null>(null) // path being drawn with the pen
  const [grid, setGrid] = useState(true)
  const [snap, setSnap] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 }) // px offset of the centre
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const [shapesOpen, setShapesOpen] = useState(false)
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const S = (SIZE - 40) * zoom // px per unit
  const toUnit = (e: { clientX: number; clientY: number }, free = false): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    let x = (e.clientX - r.left - SIZE / 2 - pan.x) / S, y = (e.clientY - r.top - SIZE / 2 - pan.y) / S
    if (snap && !free) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID }
    return [+x.toFixed(4), +y.toFixed(4)]
  }
  const commit = (next: VPath[], before: VPath[] = paths): void => { setPast((h) => [...h.slice(-60), clone(before)]); setFuture([]); setPaths(next) }
  const undo = (): void => { const prev = past[past.length - 1]; if (!prev) return; setFuture((f) => [clone(paths), ...f]); setPast((h) => h.slice(0, -1)); setPaths(prev); setActive(null); setSel(null); setMulti(new Set()) }
  const redo = (): void => { const nxt = future[0]; if (!nxt) return; setPast((h) => [...h, clone(paths)]); setFuture((f) => f.slice(1)); setPaths(nxt); setActive(null); setSel(null); setMulti(new Set()) }
  const finish = (): void => { setActive(null) }
  /** zoom by `f` keeping the point under (cx, cy) (px in the canvas) where it is; the mouse wheel uses it too */
  const zoomAt = (f: number, cx = SIZE / 2, cy = SIZE / 2): void => {
    const z = Math.max(0.4, Math.min(60, zoom * f))
    const k = z / zoom
    setZoom(z)
    setPan({ x: cx - SIZE / 2 - (cx - SIZE / 2 - pan.x) * k, y: cy - SIZE / 2 - (cy - SIZE / 2 - pan.y) * k })
  }
  const onWheel = (e: React.WheelEvent): void => {
    const r = svg.current!.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.25 : 1 / 1.25, e.clientX - r.left, e.clientY - r.top)
  }

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && t.tagName === 'INPUT') return
      if (e.key === 'Escape' || e.key === 'Enter') { if (active !== null) finish(); else if (multi.size) setMulti(new Set()); else if (e.key === 'Escape') onClose() }
      else if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); setMulti(new Set(paths.flatMap((p, i) => p.pts.map((_, j) => i + ':' + j)))); setSel(null) }
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
    if (multi.size) {
      const n = clone(paths)
      const order = [...multi].map((k) => k.split(':').map(Number)).sort((a, b) => b[0] - a[0] || b[1] - a[1])
      for (const [pi, i] of order) n[pi]?.pts.splice(i, 1)
      commit(n.filter((p) => p.pts.length > 1)); setMulti(new Set()); setSel(null); setActive(null)
      return
    }
    if (!sel) return
    const n = clone(paths)
    if (sel.pt === null || n[sel.path].pts.length <= 2) n.splice(sel.path, 1)
    else n[sel.path].pts.splice(sel.pt, 1)
    commit(n); setSel(null); setActive(null)
  }
  /** Simplify: the selected points (a run), the selected shape, or everything: fewer points, smooth curves. */
  const simplify = (): void => {
    const epsAbs = [0.004, 0.01, 0.022][simp]
    const n = clone(paths)
    let before = 0, after = 0
    const idxs = multi.size ? [...new Set([...multi].map((k) => Number(k.split(':')[0])))] : sel ? [sel.path] : n.map((_, i) => i)
    for (const pi of idxs) {
      const p = n[pi]
      if (!p || p.pts.length < 4) continue
      const len = p.pts.length
      before += len
      const xs = p.pts.map((q) => q.x), ys = p.pts.map((q) => q.y)
      const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      const eps = Math.min(epsAbs, diag * [0.015, 0.035, 0.07][simp]) // small shapes are simplified less than big ones
      const orig = p.pts
      const chosen = multi.size ? [...multi].filter((k) => k.startsWith(pi + ':')).map((k) => Number(k.split(':')[1])).sort((a, b) => a - b) : []
      if (chosen.length >= 3) {
        // the run from the first to the last selected point (closed shape: the way that does not cross the biggest gap)
        let a = chosen[0], b = chosen[chosen.length - 1]
        if (p.closed) {
          let gi = 0, gm = -1
          chosen.forEach((c, i) => { const g = (chosen[(i + 1) % chosen.length] - c + len) % len; if (g > gm) { gm = g; gi = i } })
          a = chosen[(gi + 1) % chosen.length]; b = chosen[gi]
          if (b <= a) b += len
        }
        const run = simplifyRun(p, a, b, eps)
        const rest: VPt[] = []
        for (let i = b + 1; i < a + len; i++) rest.push(p.pts[i % len])
        p.pts = [...run, ...rest]
      } else if (p.closed) {
        // two halves, split at the point farthest from the first
        const f = p.pts[0]
        let far = 1, dm = 0
        p.pts.forEach((q, i) => { const d = Math.hypot(q.x - f.x, q.y - f.y); if (d > dm) { dm = d; far = i } })
        p.pts = [...simplifyRun(p, 0, far, eps).slice(0, -1), ...simplifyRun(p, far, len, eps).slice(0, -1)]
      } else p.pts = simplifyRun(p, 0, len - 1, eps)
      if (p.pts.length < (p.closed ? 3 : 2)) p.pts = orig
      after += p.pts.length
    }
    if (after >= before) return
    commit(n); setMulti(new Set()); setSel(null); setActive(null)
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
    if (kind === 'bg') {
      // drag on the empty canvas: a box that selects the points inside (Shift / Ctrl add); a plain click deselects
      const [fx, fy] = toUnit(e, true)
      const keep = e.shiftKey || e.ctrlKey ? new Set(multi) : new Set<string>()
      setSel(null)
      if (!keep.size) setMulti(new Set())
      let moved = false
      const mv = (ev: PointerEvent): void => {
        const [mx, my] = toUnit(ev, true)
        if (Math.hypot(mx - fx, my - fy) * S > 4) moved = true
        setMarquee({ x0: fx, y0: fy, x1: mx, y1: my })
        if (moved) {
          const x0 = Math.min(fx, mx), x1 = Math.max(fx, mx), y0 = Math.min(fy, my), y1 = Math.max(fy, my)
          const nn = new Set(keep)
          paths.forEach((pp, i) => pp.pts.forEach((a, j) => { if (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) nn.add(i + ':' + j) }))
          setMulti(nn)
        }
      }
      const upm = (): void => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upm); setMarquee(null) }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upm)
      return
    }
    if (kind === 'pt' && multi.has(path + ':' + pt)) { drag.current = { kind: 'multi', path, pt, x0: x, y0: y, orig: clone(paths) }; return }
    if (kind !== 'in' && kind !== 'out' && multi.size) setMulti(new Set())
    setSel({ path, pt: kind === 'path' ? null : pt })
    drag.current = { kind: kind as Drag['kind'], path, pt, x0: x, y0: y, orig: clone(paths) }
  }
  const move = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const [x, y] = toUnit(e), dx = x - d.x0, dy = y - d.y0
    const n = clone(d.orig), p = n[d.path]
    if (!p && d.kind !== 'multi') return
    if (d.kind === 'multi') {
      for (const k of multi) { const [pi, i] = k.split(':').map(Number), a = n[pi]?.pts[i]; if (!a) continue; a.x += dx; a.y += dy; if (a.ix !== undefined) { a.ix += dx; a.iy! += dy } if (a.ox !== undefined) { a.ox += dx; a.oy! += dy } }
    } else if (d.kind === 'path') for (const a of p.pts) { a.x += dx; a.y += dy; if (a.ix !== undefined) { a.ix += dx; a.iy! += dy } if (a.ox !== undefined) { a.ox += dx; a.oy! += dy } }
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
            {btn('↖', 'Selecionar (V): arrasta pontos, pegas ou formas; arrasta no vazio para uma caixa de seleção (Shift / Ctrl somam)', tool === 'select', () => { finish(); setTool('select') })}
            {btn('✒', 'Caneta (P): clica para pontos, arrasta para curvas, clica no 1.º ponto para fechar', tool === 'pen', () => setTool('pen'))}
            {btn('↶', 'Anular (Ctrl+Z)', false, undo, !past.length)}
            {btn('↷', 'Refazer (Ctrl+Y)', false, redo, !future.length)}
            <span className="ve-shapes">
              {btn('◇', 'Formas prontas (substituem a forma: uma forma por camada)', shapesOpen, () => setShapesOpen(!shapesOpen))}
              {shapesOpen && <div className="ve-menu">{SHAPES.map(([n, f]) => <button key={n} onClick={() => { commit([f()]); setShapesOpen(false); setTool('select'); setSel({ path: 0, pt: null }) }}>{n}</button>)}</div>}
            </span>
            {btn('⌒', 'Curva / canto no ponto selecionado', !!sp && (sp.ix !== undefined || sp.ox !== undefined), toggleCurve, !sp)}
            {btn('⌫', 'Apagar os pontos (ou a forma) selecionados — Delete', false, deleteSel, !sel && !multi.size)}
            <span className="ve-simp">
              {btn('⤓ Simplificar', 'Simplificar: menos pontos, a mesma forma com curvas suaves. Aplica-se aos pontos selecionados (arrasta uma caixa no canvas; Ctrl+A seleciona todos), à forma selecionada ou a tudo', false, simplify, paths.flatMap((p) => p.pts).length < 4)}
              <select value={simp} onChange={(e) => setSimp(Number(e.target.value))} title="Força da simplificação"><option value={0}>Fina</option><option value={1}>Média</option><option value={2}>Forte</option></select>
            </span>
            {btn('⊃', 'Unir: liga o último ponto ao primeiro e fecha a forma (com preenchimento)', false, join, paths.flatMap((p) => p.pts).length < 3 || (paths.length === 1 && paths[0].closed))}
            {btn('⇋', 'Espelhar (forma selecionada ou tudo)', false, mirror, !paths.length)}
            {btn('#', 'Grelha', grid, () => setGrid(!grid))}
            {btn('Íman', 'Íman: encaixar na grelha', snap, () => setSnap(!snap))}
            {btn('−', 'Afastar (roda do rato)', false, () => zoomAt(1 / 1.25))}
            {btn('+', 'Aproximar (roda do rato)', false, () => zoomAt(1.25))}
            {btn('⤢', 'Ajustar', false, () => { setZoom(1); setPan({ x: 0, y: 0 }) })}
            {btn('⟲', 'Repor (apagar tudo)', false, () => { if (confirm('Apagar todas as formas?')) { commit([]); setSel(null); setActive(null) } }, !paths.length)}
          </div>
          <svg ref={svg} width={SIZE} height={SIZE} className={'ve-canvas tool-' + tool} onWheel={onWheel}
            onPointerDownCapture={(e) => {
              // pan: middle / right button, or Alt + drag
              if (e.button === 1 || e.button === 2 || e.altKey) { e.stopPropagation(); e.preventDefault(); try { svg.current!.setPointerCapture(e.pointerId) } catch { /* synthetic */ } panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y } }
            }}
            onPointerDown={(e) => down(e, 'bg')}
            onPointerMove={(e) => { const d = panDrag.current; if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); else move(e) }}
            onPointerUp={() => { if (panDrag.current) panDrag.current = null; else up() }}
            onContextMenu={(e) => e.preventDefault()}>
            <g transform={`translate(${SIZE / 2 + pan.x} ${SIZE / 2 + pan.y}) scale(${S})`}>
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
              {marquee && <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} fill="#14d16b22" stroke="#14d16b" strokeWidth={1.5 / S} strokeDasharray={`${5 / S} ${4 / S}`} pointerEvents="none" />}
              {paths.map((p, i) => p.pts.map((a, j) => {
                const selected = (sel?.path === i && sel.pt === j) || multi.has(i + ':' + j), r = 6 / S
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
            <span className="muted small">{tool === 'pen' ? (paths.some((p) => p.pts.length) ? 'Clica para acrescentar pontos à forma · clica num ponto para continuar a partir dele · no 1.º ponto fecha' : 'Clica para começar a forma (arrasta para curvas)') : `Arrasta pontos, pegas (Alt = pegas soltas) ou a forma · caixa no vazio: vários pontos${multi.size ? ` (${multi.size} selecionados)` : ''} · roda: zoom · botão direito: mover`}</span>
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
