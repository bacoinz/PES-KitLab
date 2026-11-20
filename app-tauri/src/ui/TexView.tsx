/**
 * 2D texture view: zoom (wheel, around the cursor), pan (drag with the hand tool, middle button or Space),
 * eyedropper (click copies the colour and applies it to the last colour field used).
 * Tools: M = hand, V = select / transform (handled by the editor overlay), I = eyedropper.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { REGIONS, pathOf } from '../compositor/uv'
import { rgbToHex } from '../model/design'
import type { RefOverlay } from './reference'

export type Tool2D = 'hand' | 'select' | 'picker' | 'brush'

export interface TexViewProps {
  tex: HTMLCanvasElement | OffscreenCanvas | null
  version: number
  bg: string
  showBg: boolean
  /** UV islands of the current 3D models (white = used); the background is painted everywhere else */
  islands?: OffscreenCanvas | null
  /** contours of the kit template's parts, drawn over the texture */
  outline?: OffscreenCanvas | null
  tool: Tool2D
  setTool: (t: Tool2D) => void
  onPick: (hex: string) => void
  /** select tool: pointer events in texture px (0..2048) */
  onSelect?: (e: { type: 'down' | 'move' | 'up'; x: number; y: number; shift: boolean; tol: number }) => void
  /** brush tool: pointer strokes in texture px */
  onBrush?: (e: { type: 'down' | 'move' | 'up'; x: number; y: number }) => void
  overlay?: (g: CanvasRenderingContext2D, px: number) => void // draws selection boxes (in texture px, scale = px)
  /** reference image shown over / under the kit (editor only; never part of the texture) */
  reference?: { img: HTMLImageElement; o: RefOverlay } | null
}

/** The reference picture in texture px: fitted into the 2048 square, then scaled, moved and turned. */
function paintRef(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, r: { img: HTMLImageElement; o: RefOverlay }): void {
  const { img, o } = r
  const k = Math.min(2048 / img.naturalWidth, 2048 / img.naturalHeight) * (o.scale / 100)
  const w = img.naturalWidth * k, h = img.naturalHeight * k
  g.save()
  g.globalAlpha = o.opacity / 100
  g.translate(1024 + o.dx, 1024 + o.dy)
  g.rotate((o.rot * Math.PI) / 180)
  g.drawImage(img, -w / 2, -h / 2, w, h)
  g.restore()
}

export function TexView({ tex, version, bg, showBg, islands, outline, tool, setTool, onPick, onSelect, onBrush, overlay, reference }: TexViewProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ z: 0, x: 0, y: 0 }) // z = 0 → fit
  const [size, setSize] = useState({ w: 800, h: 600 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; pan: boolean } | null>(null)
  const space = useRef(false)
  const [hover, setHover] = useState<string | null>(null)
  const bgLayer = useMemo(() => {
    if (!islands) return null
    const c = new OffscreenCanvas(2048, 2048), g = c.getContext('2d')!
    g.fillStyle = bg; g.fillRect(0, 0, 2048, 2048)
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(islands, 0, 0)
    return c
  }, [islands, bg])

  useEffect(() => {
    const el = host.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // fit scale and effective transform
  const fit = Math.min(size.w, size.h) / 2048 * 0.96
  const scale = view.z || fit
  const ox = view.z ? view.x : (size.w - 2048 * fit) / 2
  const oy = view.z ? view.y : (size.h - 2048 * fit) / 2

  useEffect(() => {
    const c = cv.current
    if (!c || !tex) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size.w, size.h)
    g.imageSmoothingEnabled = scale < 2
    g.save()
    g.translate(ox, oy)
    g.scale(scale, scale)
    const ref = reference?.o.on ? reference : null
    if (ref && !ref.o.above) paintRef(g, ref)
    g.drawImage(tex as CanvasImageSource, 0, 0, 2048, 2048)
    if (showBg && bgLayer) g.drawImage(bgLayer, 0, 0)
    else if (showBg) {
      // the parts of the texture the game never uses, so the kit pieces stand out
      g.save()
      g.fillStyle = bg
      const outside = new Path2D()
      outside.rect(0, 0, 2048, 2048)
      outside.rect(704, 40, 640, 1826)
      outside.addPath(pathOf(Object.values(REGIONS).flat()))
      g.fill(outside, 'evenodd')
      g.restore()
    }
    if (ref?.o.above) paintRef(g, ref)
    if (outline) { g.save(); g.globalAlpha = 0.55; g.drawImage(outline, 0, 0); g.restore() }
    g.strokeStyle = 'rgba(255,255,255,0.25)'
    g.lineWidth = 1 / scale
    g.strokeRect(0, 0, 2048, 2048)
    overlay?.(g, scale)
    g.restore()
  }, [tex, version, size, scale, ox, oy, bg, showBg, bgLayer, outline, overlay, reference])

  const toTex = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = cv.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }
  }

  const sample = (x: number, y: number): string | null => {
    if (!tex || x < 0 || y < 0 || x >= 2048 || y >= 2048) return null
    const c = new OffscreenCanvas(1, 1), g = c.getContext('2d', { willReadFrequently: true })!
    const k = tex.width / 2048
    if (reference?.o.on) {
      // what is on screen: the kit with the reference over (or under) it
      g.translate(-Math.floor(x), -Math.floor(y))
      if (!reference.o.above) paintRef(g, reference)
      g.drawImage(tex as CanvasImageSource, 0, 0, 2048, 2048)
      if (reference.o.above) paintRef(g, reference)
    } else g.drawImage(tex as CanvasImageSource, Math.floor(x * k), Math.floor(y * k), 1, 1, 0, 0, 1, 1)
    const d = g.getImageData(0, 0, 1, 1).data
    return rgbToHex(d[0], d[1], d[2])
  }

  useEffect(() => {
    const kd = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') { space.current = true; e.preventDefault() }
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'v' || e.key === 'V') setTool('select')
      else if (e.key === 'm' || e.key === 'M' || e.key === 'h' || e.key === 'H') setTool('hand')
      else if (e.key === 'i' || e.key === 'I') setTool('picker')
      else if (e.key === '0') setView({ z: 0, x: 0, y: 0 })
    }
    const ku = (e: KeyboardEvent): void => { if (e.code === 'Space') space.current = false }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [setTool])

  const zoomAt = (cx: number, cy: number, factor: number): void => {
    const nz = Math.max(0.1, Math.min(16, scale * factor))
    const tx = (cx - ox) / scale, ty = (cy - oy) / scale
    setView({ z: nz, x: cx - tx * nz, y: cy - ty * nz })
  }

  return (
    <div ref={host} className={'texview tool-' + tool} onWheel={(e) => {
      const r = cv.current!.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }}>
      <canvas ref={cv} style={{ width: size.w, height: size.h }}
        onPointerDown={(e) => {
          try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
          const pan = tool === 'hand' || e.button === 1 || space.current
          drag.current = { x: e.clientX, y: e.clientY, vx: ox, vy: oy, pan }
          if (pan) return
          const p = toTex(e)
          // the exact texture colour; the screen pixel when the texture can't be read
          if (tool === 'picker') { const c = sample(p.x, p.y); if (c) onPick(c); else window.kc.screenPixel().then(onPick).catch(() => undefined) }
          else if (tool === 'select') onSelect?.({ type: 'down', ...p, shift: e.shiftKey, tol: 10 / scale })
          else if (tool === 'brush') onBrush?.({ type: 'down', ...p })
        }}
        onPointerMove={(e) => {
          const p = toTex(e)
          if (tool === 'picker') setHover(sample(p.x, p.y))
          const d = drag.current
          if (!d) return
          if (d.pan) setView({ z: scale, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })
          else if (tool === 'select') onSelect?.({ type: 'move', ...p, shift: e.shiftKey, tol: 10 / scale })
          else if (tool === 'brush') onBrush?.({ type: 'move', ...p })
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (d && !d.pan && tool === 'select') onSelect?.({ type: 'up', ...toTex(e), shift: e.shiftKey, tol: 10 / scale })
          if (d && !d.pan && tool === 'brush') onBrush?.({ type: 'up', ...toTex(e) })
        }} />
      <div className="tex-tools">
        <button className={tool === 'hand' ? 'active' : ''} title="Mão / navegar (M) — roda = zoom, arrastar = mover" onClick={() => setTool('hand')}>✋</button>
        <button className={tool === 'select' ? 'active' : ''} title="Selecionar / transformar camadas (V)" onClick={() => setTool('select')}>⬚</button>
        <button className={tool === 'picker' ? 'active' : ''} title="Conta-gotas (I): copia a cor para o último campo de cor usado" onClick={() => setTool('picker')}>💧</button>
        <span className="sep" />
        <button title="Afastar" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.25)}>−</button>
        <span className="zoom">{Math.round((scale / fit) * 100)}%</span>
        <button title="Aproximar" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)}>+</button>
        <button title="Ajustar à janela (0)" onClick={() => setView({ z: 0, x: 0, y: 0 })}>⤢</button>
        {tool === 'picker' && hover && <span className="swatch" style={{ background: hover }} title={hover} />}
      </div>
    </div>
  )
}
