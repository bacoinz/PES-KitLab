/**
 * Floating reference window over the viewer (3D and 2D): move it by the title bar, resize it by the top-left corner
 * (Shift keeps the shape), zoom with the wheel around the cursor, drag the image to move it, double click to fit.
 * It starts in the bottom-right corner of the viewer, above the camera buttons.
 */
import { useEffect, useRef, useState } from 'react'
import { rgbToHex } from '../model/design'
import { useRef2 } from './reference'

const MIN_W = 170, MIN_H = 130, BAR = 28
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(Math.max(a, b), v))

export function ReferenceWindow({ picking, onPick }: { picking: boolean; onPick: (hex: string) => void }): JSX.Element | null {
  const { url, img, name, win, setWin } = useRef2()
  const root = useRef<HTMLElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 }) // the viewer
  const [view, setView] = useState({ z: 0, x: 0, y: 0 }) // z = 0 → fit
  const [armed, setArmed] = useState(false) // eyedropper armed from this window
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const sampler = useRef<{ url: string; c: HTMLCanvasElement } | null>(null)

  useEffect(() => {
    const el = root.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [url, win.open])
  // a new picture, or a different window size: start fitted
  useEffect(() => { setView({ z: 0, x: 0, y: 0 }) }, [url])

  if (!url || !img || !win.open) return null
  const w = clamp(win.w, MIN_W, box.w - 8), h = clamp(win.h, MIN_H, box.h - 8)
  const dr = clamp(win.dr, 0, box.w - w), db = clamp(win.db, 0, box.h - (win.min ? BAR : h))
  const bw = w - 2, bh = h - BAR - 2
  const iw = img.naturalWidth, ih = img.naturalHeight
  const fit = Math.min(bw / iw, bh / ih)
  const scale = view.z || fit
  const ox = view.z ? view.x : (bw - iw * fit) / 2
  const oy = view.z ? view.y : (bh - ih * fit) / 2

  const zoomAt = (cx: number, cy: number, f: number): void => {
    const nz = clamp(scale * f, fit * 0.2, 40)
    const tx = (cx - ox) / scale, ty = (cy - oy) / scale
    setView({ z: nz, x: cx - tx * nz, y: cy - ty * nz })
  }
  const sample = (px: number, py: number): void => {
    if (px < 0 || py < 0 || px >= iw || py >= ih) return
    if (sampler.current?.url !== url) {
      const c = document.createElement('canvas'); c.width = iw; c.height = ih
      c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0)
      sampler.current = { url, c }
    }
    const d = sampler.current.c.getContext('2d')!.getImageData(Math.floor(px), Math.floor(py), 1, 1).data
    onPick(rgbToHex(d[0], d[1], d[2]))
  }
  const dropper = picking || armed
  const body = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = root.current!.querySelector('.ref-body')!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // move by the title bar (the window is anchored to the right / bottom edges)
  const startMove = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
    const x0 = e.clientX, y0 = e.clientY, dr0 = dr, db0 = db
    const move = (ev: PointerEvent): void => setWin({ dr: clamp(dr0 - (ev.clientX - x0), 0, box.w - w), db: clamp(db0 - (ev.clientY - y0), 0, box.h - (win.min ? BAR : h)) })
    const up = (): void => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up)
  }
  // resize by the top-left corner (the right / bottom edges stay)
  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
    const x0 = e.clientX, y0 = e.clientY, w0 = w, h0 = h, ratio = w0 / h0
    const move = (ev: PointerEvent): void => {
      let nw = clamp(w0 - (ev.clientX - x0), MIN_W, box.w - dr), nh = clamp(h0 - (ev.clientY - y0), MIN_H, box.h - db)
      if (ev.shiftKey) { if (nw / nh > ratio) nw = nh * ratio; else nh = nw / ratio; nw = Math.max(MIN_W, nw); nh = Math.max(MIN_H, nh) }
      setWin({ w: Math.round(nw), h: Math.round(nh) })
    }
    const up = (): void => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up)
  }

  return (
    <aside ref={root} className={'ref-window' + (win.min ? ' min' : '')} style={{ right: dr, bottom: db, width: w, height: win.min ? BAR + 2 : h }}
      onWheel={(e) => { if (!win.min) { const p = body(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2) } }}>
      <div className="ref-bar" onPointerDown={startMove} onDoubleClick={() => setWin({ min: !win.min })} title="Arrasta para mudar de sítio">
        <span className="ref-title" title={name}>{name || 'Referência'}</span>
        <button className={armed ? 'on' : ''} title="Conta-gotas: clica na imagem para copiar a cor" onClick={() => setArmed(!armed)}>💧</button>
        <button title="Ajustar a imagem à janela (duplo clique na imagem)" onClick={() => setView({ z: 0, x: 0, y: 0 })}>⤢</button>
        <button title={win.min ? 'Mostrar' : 'Minimizar'} onClick={() => setWin({ min: !win.min })}>{win.min ? '▢' : '–'}</button>
        <button title="Fechar (a imagem continua carregada)" onClick={() => setWin({ open: false })}>✕</button>
      </div>
      {!win.min && (
        <>
          <div className={'ref-body' + (dropper ? ' pick' : '')}
            onDoubleClick={() => setView({ z: 0, x: 0, y: 0 })}
            onPointerDown={(e) => {
              const p = body(e)
              if (dropper) { sample((p.x - ox) / scale, (p.y - oy) / scale); setArmed(false); return }
              ;try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
              drag.current = { x: e.clientX, y: e.clientY, vx: ox, vy: oy }
            }}
            onPointerMove={(e) => { const d = drag.current; if (d) setView({ z: scale, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }) }}
            onPointerUp={() => { drag.current = null }}>
            <img src={url} alt="" draggable={false} width={iw} height={ih} style={{ transform: `translate(${ox}px, ${oy}px) scale(${scale})` }} />
          </div>
          <div className="ref-grip" onPointerDown={startResize} title="Arrasta para mudar o tamanho (Shift mantém a forma)" />
        </>
      )}
    </aside>
  )
}
