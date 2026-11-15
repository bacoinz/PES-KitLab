/**
 * Monochrome logo maker: turns any logo into a one-colour PNG (for sleeve badges, shorts brands, kit makers…).
 *  - silhouette: every visible pixel takes the colour (transparent logos)
 *  - brightness: dark parts become the colour, light parts transparent (logos on a white / plain background);
 *    "invert" keeps the light parts instead. Softness keeps anti-aliased edges smooth.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Asset } from '../model/design'
import { loadAsset, trim, canvas, ctx2d, type Img } from '../compositor/images'
import { Row, Slider, Select, ColorInput } from './common'
import { useApp } from '../state'

export type MonoMode = 'silhouette' | 'brightness'
export interface MonoOptions { mode: MonoMode; color: string; threshold: number; softness: number; invert: boolean }

/** True when (almost) every pixel is opaque: the logo sits on a background. */
export function isOpaque(img: Img): boolean {
  const w = Math.min(256, (img as ImageBitmap).width), h = Math.min(256, (img as ImageBitmap).height)
  const c = canvas(w, h), g = ctx2d(c)
  g.drawImage(img as CanvasImageSource, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  let clear = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++
  return clear < (w * h) / 100
}

export function monoLogo(img: Img, o: MonoOptions): OffscreenCanvas {
  const w = (img as ImageBitmap).width, h = (img as ImageBitmap).height
  const c = canvas(w, h), g = ctx2d(c)
  g.drawImage(img as CanvasImageSource, 0, 0)
  const id = g.getImageData(0, 0, w, h), d = id.data
  const r = parseInt(o.color.slice(1, 3), 16), gg = parseInt(o.color.slice(3, 5), 16), b = parseInt(o.color.slice(5, 7), 16)
  const lo = o.threshold - o.softness, span = Math.max(1, o.softness * 2)
  for (let i = 0; i < d.length; i += 4) {
    let a = d[i + 3] / 255
    if (o.mode === 'brightness') {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const ink = o.invert ? lum : 255 - lum
      a *= Math.max(0, Math.min(1, (ink - lo) / span))
    }
    d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = Math.round(a * 255)
  }
  g.putImageData(id, 0, 0)
  return trim(c) as OffscreenCanvas
}

export function MonoLogoModal({ asset, onClose }: { asset: Asset; onClose: () => void }): JSX.Element {
  const notify = useApp((s) => s.notify)
  const refreshLibrary = useApp((s) => s.refreshLibrary)
  const [img, setImg] = useState<Img | null>(null)
  const [o, setO] = useState<MonoOptions>({ mode: 'silhouette', color: '#ffffff', threshold: 128, softness: 30, invert: false })
  const [dark, setDark] = useState(true)
  const view = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    loadAsset(asset).then((b) => { setImg(b); if (isOpaque(b)) setO((x) => ({ ...x, mode: 'brightness', color: '#000000' })) }).catch((e) => notify('err', String(e)))
  }, [asset, notify])
  const out = useMemo(() => (img ? monoLogo(img, o) : null), [img, o])
  useEffect(() => {
    const c = view.current
    if (!c || !out) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    const s = Math.min((c.width - 20) / out.width, (c.height - 20) / out.height)
    g.drawImage(out, (c.width - out.width * s) / 2, (c.height - out.height * s) / 2, out.width * s, out.height * s)
  }, [out])
  const ch = (p: Partial<MonoOptions>): void => setO((x) => ({ ...x, ...p }))
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide mono-logo" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Logo monocromático — {asset.name}</b><button className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="mono-body">
          <canvas ref={view} width={420} height={320} className={'mono-view' + (dark ? ' dark' : ' light')} />
          <div className="mono-opts">
            <Row label="Modo"><Select value={o.mode} options={[['silhouette', 'Silhueta (logo com fundo transparente)'], ['brightness', 'Por brilho (logo com fundo)']]} onChange={(mode) => ch({ mode })} /></Row>
            <Row label="Cor"><ColorInput value={o.color} onChange={(color) => ch({ color })} /></Row>
            <div className="btn-row">
              {['#ffffff', '#000000', '#c8a24a', '#c0c0c0'].map((c) => <button key={c} className="btn small" style={{ background: c, width: 28 }} title={c} onClick={() => ch({ color: c })} />)}
            </div>
            {o.mode === 'brightness' && (
              <>
                <Row label="Limiar"><Slider value={o.threshold} min={0} max={255} onChange={(threshold) => ch({ threshold })} /></Row>
                <Row label="Suavidade"><Slider value={o.softness} min={0} max={128} onChange={(softness) => ch({ softness })} /></Row>
                <label className="check"><input type="checkbox" checked={o.invert} onChange={(e) => ch({ invert: e.target.checked })} /> Inverter (ficar com as partes claras)</label>
              </>
            )}
            <label className="check"><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Fundo escuro na pré-visualização</label>
            <div className="btn-row">
              <button className="btn primary" disabled={!out} onClick={async () => {
                if (!out) return
                const b = await out.convertToBlob({ type: 'image/png' })
                const base = asset.name.replace(/\.[a-z0-9]+$/i, '')
                const p = await window.kc.saveFile(`${base}_mono.png`, new Uint8Array(await b.arrayBuffer()))
                if (p) { notify('ok', 'Logo guardado: ' + p); await refreshLibrary() }
              }}>Guardar PNG…</button>
            </div>
            <div className="muted small">Guarda numa das tuas pastas de logos para ficar logo disponível na biblioteca.</div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
