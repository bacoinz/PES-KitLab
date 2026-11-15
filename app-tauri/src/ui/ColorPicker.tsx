/**
 * Colour picker (popover): a grid of ready colours, named presets (kit / team / saved / common football colours,
 * searchable), a saturation-brightness square with a hue bar, hex, eyedropper, old vs new, and
 * Cancel · Apply to all (every place this colour is used in the kit) · Apply.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface NamedColor { name: string; color: string }

/** The last colour field the user touched: where the 2D eyedropper's colour goes. */
let colorTarget: ((c: string) => void) | null = null
export function armColorTarget(f: (c: string) => void): void { colorTarget = f }
/** Apply a colour (e.g. from the 2D eyedropper) to the last colour field the user touched. */
export function pickColorTarget(c: string): boolean {
  if (!colorTarget) return false
  colorTarget(c)
  return true
}
/** Provided by the editor: where "apply to all" goes and the kit / team colours offered as presets. */
export const ColorCtx = createContext<{ applyAll?: (from: string, to: string) => void; presets?: NamedColor[] }>({})

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
/** Swatch background that shows transparency (a checkerboard under the colour). */
export const swatchBg = (c: string): string => (/^#[0-9a-f]{8}$/i.test(c) ? `linear-gradient(${c},${c}), repeating-conic-gradient(#8a8a8a 0 25%, #d8d8d8 0 50%) 0 0/8px 8px` : c)
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v))
function hexToHsv(h: string): [number, number, number] {
  const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let hue = 0
  if (d) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((hue * 60) + 360) % 360, mx ? d / mx : 0, mx]
}
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number): number => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}
const hsl = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l), f = (n: number): number => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

/** Ready colours: a grey ramp and 6 shades of 9 hues. */
const GREYS = Array.from({ length: 9 }, (_, i) => hsl(0, 0, i / 8))
const HUES = [0, 28, 48, 75, 130, 172, 200, 230, 320]
const GRID = [0.82, 0.68, 0.55, 0.45, 0.34, 0.22].map((l) => HUES.map((h) => hsl(h, 0.75, l)))

/** Common football colours (generic names). */
const COMMON: NamedColor[] = [
  ['Branco', '#ffffff'], ['Branco sujo', '#f1efe6'], ['Preto', '#111111'], ['Antracite', '#2e3138'], ['Cinzento', '#8a8d93'], ['Prateado', '#c0c4c8'],
  ['Vermelho', '#d0102a'], ['Vermelho vivo', '#ff1f2d'], ['Grená', '#7a1a2c'], ['Bordô', '#5c0f24'], ['Rosa', '#f06aa6'], ['Magenta', '#d6157a'],
  ['Laranja', '#f26a10'], ['Laranja néon', '#ff7a00'], ['Amarelo', '#ffd400'], ['Dourado', '#c8a24a'], ['Âmbar', '#f5b018'], ['Creme', '#efe2b8'],
  ['Verde', '#0f8a3c'], ['Verde-escuro', '#0b4d2a'], ['Verde-esmeralda', '#009b77'], ['Verde-lima', '#9fe01a'], ['Verde-água', '#1fb5a6'], ['Caqui', '#8c8a5a'],
  ['Azul royal', '#1f4fb4'], ['Azul', '#1565c0'], ['Azul-marinho', '#0d1f45'], ['Azul celeste', '#6cabdd'], ['Azul-claro', '#9fd3f2'], ['Ciano', '#1ec8e6'],
  ['Roxo', '#5b2a86'], ['Violeta', '#7a2fd0'], ['Lilás', '#b79ad8'], ['Castanho', '#6b4423'], ['Bege', '#d8c39a'], ['Néon amarelo', '#e8ff2a']
].map(([name, color]) => ({ name, color }))

const SAVED_KEY = 'kc.savedColors'
const loadSaved = (): NamedColor[] => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') } catch { return [] } }

export function ColorPicker({ value, anchor, title, onApply, onClose }: { value: string; anchor: DOMRect; title?: string; onApply: (c: string, all?: boolean) => void; onClose: () => void }): JSX.Element {
  const ctx = useContext(ColorCtx)
  const start = HEX.test(value) ? value.toLowerCase() : '#000000'
  const [hsv, setHsv] = useState(() => hexToHsv(start.slice(0, 7)))
  // transparency 0 … 100 % (100 = opaque); kept in the colour itself as #rrggbbaa
  const [alpha, setAlpha] = useState(() => (start.length === 9 ? Math.round((parseInt(start.slice(7, 9), 16) / 255) * 100) : 100))
  const [hex, setHex] = useState(start)
  const [tab, setTab] = useState<'grid' | 'presets'>('grid')
  const [q, setQ] = useState('')
  const [saved, setSaved] = useState(loadSaved)
  const rgbCur = hsvToHex(...hsv)
  const cur = alpha >= 100 ? rgbCur : rgbCur + Math.round((alpha / 100) * 255).toString(16).padStart(2, '0')
  useEffect(() => setHex(cur), [cur])
  const setColor = (c: string): void => {
    if (!HEX.test(c)) return
    setHsv(hexToHsv(c.toLowerCase().slice(0, 7)))
    if (c.length === 9) setAlpha(Math.round((parseInt(c.slice(7, 9), 16) / 255) * 100))
  }
  const sv = useRef<HTMLDivElement>(null), hue = useRef<HTMLDivElement>(null)
  const drag = (ref: React.RefObject<HTMLDivElement>, f: (x: number, y: number) => void) => (e: React.PointerEvent): void => {
    const el = ref.current
    if (!el) return
    const move = (ev: PointerEvent): void => { const r = el.getBoundingClientRect(); f(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height)) }
    move(e.nativeEvent)
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const presets = useMemo(() => {
    const all = [...(ctx.presets ?? []), ...saved.map((s) => ({ ...s, name: s.name || s.color })), ...COMMON]
    const t = q.trim().toLowerCase()
    return t ? all.filter((p) => p.name.toLowerCase().includes(t) || p.color.includes(t)) : all
  }, [ctx.presets, saved, q])
  // eyedropper: the picker steps aside and a transparent overlay takes the next click anywhere in the window; the
  // colour is read from the screen itself (the WebView has no working EyeDropper), so the 3D view works too
  const [dropping, setDropping] = useState(false)
  const [dropHover, setDropHover] = useState<string | null>(null)
  const eyedrop = (): void => setDropping(true)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') { if (dropping) { setDropping(false); return } onClose() } if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') onApply(cur) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [cur, onApply, onClose, dropping])
  // place next to the swatch, kept inside the window
  const W = 470, H = 320
  const left = clamp(anchor.right + 8, 8, window.innerWidth - W - 8), top = clamp(anchor.top - 40, 8, window.innerHeight - H - 8)
  return createPortal(
    dropping ? (
      <div className="eyedrop-overlay"
        onPointerMove={() => { window.kc.screenPixel().then(setDropHover).catch(() => undefined) }}
        onPointerDown={async (e) => { e.stopPropagation(); e.preventDefault(); try { setColor(await window.kc.screenPixel()) } catch { /* ignore */ } setDropping(false); setDropHover(null) }}
        onContextMenu={(e) => { e.preventDefault(); setDropping(false) }}>
        <div className="eyedrop-tip">{dropHover && <span className="swatch" style={{ background: dropHover }} />} Clica na cor que queres (botão direito ou Esc = cancelar)</div>
      </div>
    ) :
    <div className="cp-bg" onPointerDown={onClose}>
      <div className="cp" style={{ left, top, width: W }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="cp-head">
          <b>{title ?? 'Cor'}</b>
          <button className="btn tiny ghost" title="Conta-gotas (clica em qualquer sítio da janela)" onClick={eyedrop}>💧</button>
        </div>
        <div className="cp-main">
          <div className="cp-left">
            <div className="cp-tabs">
              <button className={tab === 'grid' ? 'active' : ''} onClick={() => setTab('grid')}>Predefinido</button>
              <button className={tab === 'presets' ? 'active' : ''} onClick={() => setTab('presets')}>Predefinições</button>
            </div>
            {tab === 'grid' ? (
              <div className="cp-grid">
                {[GREYS, ...GRID].map((row, i) => <div key={i} className="cp-row">{row.map((c) => <button key={c} className={'cp-sw' + (c === cur ? ' on' : '')} style={{ background: c }} title={c} onClick={() => setColor(c)} />)}</div>)}
              </div>
            ) : (
              <div className="cp-presets">
                <input placeholder="Pesquisar cores…" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="cp-plist">
                  {presets.map((p, i) => (
                    <button key={p.name + p.color + i} className="cp-pre" style={{ background: p.color, color: lum(p.color) > 150 ? '#111' : '#fff' }} title={p.color} onClick={() => setColor(p.color)}>{p.name}</button>
                  ))}
                </div>
                <button className="btn tiny" onClick={() => { const name = prompt('Nome para esta cor', cur) ?? ''; const n = [{ name: name || cur, color: cur }, ...saved.filter((s) => s.color !== cur)].slice(0, 40); setSaved(n); try { localStorage.setItem(SAVED_KEY, JSON.stringify(n)) } catch { /* ignore */ } }}>+ Guardar esta cor</button>
              </div>
            )}
          </div>
          <div className="cp-right">
            <div ref={sv} className="cp-sv" style={{ background: hsvToHex(hsv[0], 1, 1) }} onPointerDown={drag(sv, (x, y) => setHsv(([h]) => [h, x, 1 - y]))}>
              <div className="cp-sv-w" /><div className="cp-sv-b" />
              <div className="cp-dot" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
            </div>
            <div ref={hue} className="cp-hue" onPointerDown={drag(hue, (_x, y) => setHsv(([, s, v]) => [y * 359.9, s, v]))}>
              <div className="cp-hue-k" style={{ top: `${(hsv[0] / 360) * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="cp-alpha" title="Opacidade da cor (menos = mais transparente)">
          <span>Opacidade</span>
          <input type="range" min={0} max={100} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))}
            style={{ background: `linear-gradient(to right, transparent, ${rgbCur}), repeating-conic-gradient(#8a8a8a 0 25%, #d8d8d8 0 50%) 0 0/8px 8px` }} />
          <b>{alpha}%</b>
        </div>
        <div className="cp-foot">
          <span className="cp-cmp" title="Antes / depois"><span style={{ background: swatchBg(start) }} /><span style={{ background: swatchBg(cur) }} /></span>
          <input className="cp-hex" value={hex} spellCheck={false} onChange={(e) => { setHex(e.target.value); setColor(e.target.value) }} />
          <span className="grow" />
          <button className="btn small ghost" onClick={onClose}>Cancelar</button>
          {ctx.applyAll && <button className="btn small" title="Troca esta cor em todo o equipamento (camadas, gola, punhos, números…)" onClick={() => onApply(cur, true)}>Aplicar a todos</button>}
          <button className="btn small primary" onClick={() => onApply(cur)}>Aplicar</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function lum(h: string): number { return 0.299 * parseInt(h.slice(1, 3), 16) + 0.587 * parseInt(h.slice(3, 5), 16) + 0.114 * parseInt(h.slice(5, 7), 16) }

/** A colour swatch that opens the picker. `onChange` gets the new colour; "apply to all" goes through ColorCtx. */
export function Swatch({ value, onChange, title, className, style }: { value: string; onChange: (c: string) => void; title?: string; className?: string; style?: React.CSSProperties }): JSX.Element {
  const ctx = useContext(ColorCtx)
  const [at, setAt] = useState<DOMRect | null>(null)
  return (
    <>
      <button type="button" className={className ?? 'swatch-btn'} style={{ background: swatchBg(value), ...style }} title={title ?? value}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); armColorTarget(onChange); setAt((e.currentTarget as HTMLElement).getBoundingClientRect()) }} />
      {at && <ColorPicker value={value} anchor={at} title={title} onClose={() => setAt(null)}
        onApply={(c, all) => { setAt(null); if (all && ctx.applyAll) ctx.applyAll(value, c); else onChange(c) }} />}
    </>
  )
}
