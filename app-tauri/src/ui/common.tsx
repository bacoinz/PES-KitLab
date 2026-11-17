import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Asset, LogoPlacement, LogoTint } from '../model/design'
import { useApp, assetFromFile, assetFromUrl, libraryAsset } from '../state'
import { Swatch, armColorTarget } from './ColorPicker'

// ---------------------------------------------------------------- accordion state (one open section per group, remembered)
const ACC_KEY = 'kc.accordion'
let acc: Record<string, string | null> = (() => { try { return JSON.parse(localStorage.getItem(ACC_KEY) ?? '{}') } catch { return {} } })()
const accSubs = new Set<() => void>()
function setAcc(group: string, id: string | null): void {
  acc = { ...acc, [group]: id }
  try { localStorage.setItem(ACC_KEY, JSON.stringify(acc)) } catch { /* ignore */ }
  accSubs.forEach((f) => f())
}
function useAcc(group?: string): string | null | undefined {
  const [, force] = useState(0)
  useEffect(() => { if (!group) return; const f = (): void => force((n) => n + 1); accSubs.add(f); return () => { accSubs.delete(f) } }, [group])
  return group ? acc[group] ?? null : undefined
}

/** Collapsible section. With `group` it behaves as an accordion: opening one closes the others, and the choice is remembered. */
export function Section({ title, children, open = true, right, onActivate, group }: { title: string; children: ReactNode; open?: boolean; right?: ReactNode; onActivate?: () => void; group?: string }): JSX.Element {
  const [local, setLocal] = useState(open)
  const current = useAcc(group)
  // the settings tab shows everything at once (no accordion)
  if (group === 'origin') {
    return (
      <div className="section open flat" onPointerDown={onActivate}>
        <div className="section-head flat"><span className="section-title">{title}</span><span className="section-right">{right}</span></div>
        <div className="section-body">{children}</div>
      </div>
    )
  }
  const o = group ? current === title : local
  const toggle = (): void => (group ? setAcc(group, o ? null : title) : setLocal(!local))
  return (
    <div className={'section' + (o ? ' open' : '')} onPointerDown={onActivate}>
      <div className="section-head" onClick={toggle}>
        <span className="chev">{o ? '▾' : '▸'}</span>
        <span className="section-title">{title}</span>
        <span className="section-right" onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {o && <div className="section-body">{children}</div>}
    </div>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="row">
      <span className="row-label">{label}</span>
      <span className="row-ctl">{children}</span>
    </label>
  )
}

// ---------------------------------------------------------------- colour fields: team swatches + eyedropper target
export { pickColorTarget } from './ColorPicker'

/** Swatches offered by every colour field: all colours already used in the team's kits. */
export function TeamColors({ colors }: { colors: string[] }): JSX.Element {
  return <datalist id="kc-team-colors">{colors.map((c) => <option key={c} value={c} />)}</datalist>
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const [txt, setTxt] = useState(value)
  useEffect(() => setTxt(value), [value])
  const arm = (): void => armColorTarget(onChange)
  return (
    <span className="color-input" onPointerDown={arm} onFocus={arm}>
      <Swatch value={/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : '#000000'} onChange={onChange} className="swatch-btn color-sw" />
      <input
        className="hex" value={txt} spellCheck={false}
        onChange={(e) => { setTxt(e.target.value); if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()) }}
      />
    </span>
  )
}

/** `invert`: the slider runs the other way (used for "up/down": left = down, right = up). */
export function Slider({ value: raw, min, max, step = 1, onChange: emit, invert, snaps }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; invert?: boolean; snaps?: number[] }): JSX.Element {
  const value = invert ? min + max - raw : raw
  // soft lock: dragging close to a snap value (within 2 % of the range) sticks to it
  const tol = (max - min) * 0.02
  const onChange = (v: number): void => { const t = invert ? min + max - v : v; emit(snaps?.find((s) => Math.abs(s - t) <= tol) ?? t) }
  // the − / + buttons move exactly one step (no snapping: near a snap value it used to jump back and "do nothing");
  // held down they repeat, faster after a while
  const exact = (v: number): void => emit(invert ? min + max - v : v)
  const clamp = (v: number): number => Math.max(min, Math.min(max, Math.round(v / step) * step))
  const cur = useRef(value)
  cur.current = value
  const timer = useRef<number | null>(null)
  const stop = (): void => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => stop, [])
  const press = (dir: number) => (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    stop()
    let n = 0
    const tick = (): void => {
      const v = clamp(cur.current + dir * step * (n > 25 ? 5 : 1))
      if (v !== cur.current) { cur.current = v; exact(v) }
      n++
      timer.current = window.setTimeout(tick, n === 1 ? 380 : 55)
    }
    tick()
    const up = (): void => { stop(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  return (
    <span className="slider" onWheel={(e) => { if (document.activeElement === e.currentTarget.querySelector('input[type=range]')) { e.preventDefault(); exact(clamp(value + (e.deltaY < 0 ? step : -step))) } }}>
      <button type="button" className="nudge" onPointerDown={press(-1)} onPointerLeave={stop}>−</button>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      <button type="button" className="nudge" onPointerDown={press(1)} onPointerLeave={stop}>+</button>
      <NumBox value={value} min={min} max={max} step={step} onCommit={(v) => { const c = clamp(v); emit(invert ? min + max - c : c) }} />
    </span>
  )
}

/**
 * Number box that lets you type: the text is kept while editing (a lone "-" or a value still below the minimum does
 * not snap back), valid values inside the range apply as you type, and Enter / leaving the box commits (clamped).
 */
export function NumBox({ value, min, max, step = 1, onCommit }: { value: number; min: number; max: number; step?: number; onCommit: (v: number) => void }): JSX.Element {
  const [txt, setTxt] = useState<string | null>(null)
  const commit = (): void => {
    if (txt === null) return
    const v = Number(txt.replace(',', '.'))
    setTxt(null)
    if (txt.trim() !== '' && Number.isFinite(v)) onCommit(v)
  }
  return (
    <input type="text" inputMode="decimal" className="num-box" value={txt ?? String(value)} spellCheck={false}
      onFocus={(e) => { setTxt(String(value)); e.currentTarget.select() }}
      onChange={(e) => {
        const t = e.target.value
        setTxt(t)
        const v = Number(t.replace(',', '.'))
        if (t.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onCommit(v)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
        else if (e.key === 'Escape') { setTxt(null); (e.target as HTMLInputElement).blur() }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = Math.max(min, Math.min(max, value + (e.key === 'ArrowUp' ? step : -step))); setTxt(String(v)); onCommit(v) }
      }} />
  )
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }): JSX.Element {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

/** Choose an image: from the library, a file on disk or a URL. Returns a normalised Asset. */
export function AssetPicker({ onPick, label = 'Escolher imagem', folderHint, autoOpen }: { onPick: (a: Asset) => void; label?: string; folderHint?: string; autoOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(!!autoOpen)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState(folderHint ?? '')
  const lib = useApp((s) => s.library)
  const notify = useApp((s) => s.notify)
  const folders = useMemo(() => [...new Set(lib.map((l) => l.folder))], [lib])
  // the hint ("MARCAS", "LOGOS"…) matches the library folder whatever its case; an unknown one shows everything
  const cur = folders.find((f) => f.toLowerCase() === folder.toLowerCase()) ?? ''
  const items = lib.filter((l) => (!cur || l.folder === cur) && l.name.toLowerCase().includes(q.toLowerCase()))
  const [crop, setCrop] = useState<Asset | null>(null)
  const run = async (fn: () => Promise<Asset>): Promise<void> => {
    setBusy(true)
    try { setCrop(await fn()); setOpen(false) } catch (e) { notify('err', String((e as Error).message ?? e)) } finally { setBusy(false) }
  }
  return (
    <>
      <button className="btn small" onClick={(e) => { e.preventDefault(); setOpen(true) }}>{label}</button>
      {crop && <CropModal asset={crop} onDone={(a) => { setCrop(null); onPick(a) }} onCancel={() => setCrop(null)} />}
      {/* rendered in a portal: inside a <label> row, clicks in the modal would otherwise be re-targeted to the row's input */}
      {open && createPortal(
        <div className="side-fly-bg" onClick={() => setOpen(false)}>
          <div className="side-fly" onClick={(e) => e.stopPropagation()}>
            <div className="flyout-head"><b>{label}</b><div className="grow" /><button className="btn ghost" onClick={() => setOpen(false)}>✕</button></div>
            <div className="picker-top">
              <button className="btn" disabled={busy} onClick={() => run(async () => {
                const f = await window.kc.pickFiles([{ name: 'Imagens', extensions: ['png', 'webp', 'jpg', 'jpeg', 'svg', 'gif', 'bmp', 'dds', 'ftex'] }])
                if (!f[0]) throw new Error('Nenhum ficheiro escolhido')
                return assetFromFile(f[0])
              })}>📁 Ficheiro…</button>
              <input className="grow" placeholder="https://…/logo.png" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="btn primary" disabled={busy || !url} onClick={() => run(() => assetFromUrl(url.trim()))}>Descarregar</button>
            </div>
            <div className="tp-chips">
              <button className={!cur ? 'on' : ''} onClick={() => setFolder('')}>Todas</button>
              {folders.map((f) => <button key={f} className={cur === f ? 'on' : ''} onClick={() => setFolder(f)}>{f} <span>{lib.filter((l) => l.folder === f).length}</span></button>)}
            </div>
            <div className="picker-top">
              <input className="grow" placeholder="Pesquisar na biblioteca…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="lib-grid">
              {items.map((it) => (
                <button key={it.path} className="lib-item" title={it.name} disabled={busy} onClick={() => run(() => libraryAsset(it))}>
                  <LocalImg path={it.path} />
                  <span>{it.name}</span>
                </button>
              ))}
              {!items.length && <div className="muted pad">Biblioteca vazia. Adiciona pastas em Biblioteca.</div>}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

const imgCache = new Map<string, string>()
export function LocalImg({ path, className }: { path: string; className?: string }): JSX.Element {
  const [src, setSrc] = useState(imgCache.get(path) ?? '')
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (src) return
    let alive = true
    const io = new IntersectionObserver(async (ents) => {
      if (!ents[0].isIntersecting) return
      io.disconnect()
      const b = await window.kc.readFile(path)
      const ext = path.split('.').pop()!.toLowerCase()
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      const u = URL.createObjectURL(new Blob([b], { type: mime }))
      imgCache.set(path, u)
      if (alive) setSrc(u)
    })
    if (ref.current) io.observe(ref.current)
    return () => { alive = false; io.disconnect() }
  }, [path, src])
  return <img ref={ref} className={className} src={src || undefined} alt="" />
}

export const TINTS: [LogoTint, string][] = [['original', 'Cores originais'], ['auto', 'Automático (contraste)'], ['mono', 'Uma cor'], ['white', 'Branco'], ['black', 'Preto']]

export function LogoControls({ title, lp, assets, onChange, onAsset, folderHint }: {
  title: string; lp: LogoPlacement; assets: Record<string, Asset>; onChange: (lp: LogoPlacement) => void; onAsset: (a: Asset) => void; folderHint?: string
}): JSX.Element {
  const a = lp.assetId ? assets[lp.assetId] : undefined
  return (
    <div className="logo-ctl">
      <div className="logo-head">
        <input type="checkbox" checked={lp.enabled} onChange={(e) => onChange({ ...lp, enabled: e.target.checked })} />
        <b>{title}</b>
        {a && <img className="logo-thumb" src={a.dataUrl} alt="" />}
        <span className="grow" />
        <AssetPicker label={a ? 'Trocar' : 'Escolher'} onPick={(x) => { onAsset(x); onChange({ ...lp, assetId: x.id, enabled: true }) }} folderHint={folderHint} />
      </div>
      {lp.enabled && a && (
        <>
          <Row label="Cor"><Select value={lp.tint} options={TINTS} onChange={(tint) => onChange({ ...lp, tint })} /></Row>
          {lp.tint === 'mono' && <Row label="Cor do logo"><ColorInput value={lp.color ?? '#ffffff'} onChange={(color) => onChange({ ...lp, color })} /></Row>}
          <Row label="Tamanho"><Slider value={lp.size} min={30} max={700} onChange={(size) => onChange({ ...lp, size })} /></Row>
          <Row label="Posição X"><Slider value={lp.dx} min={-300} max={300} onChange={(dx) => onChange({ ...lp, dx })} /></Row>
          <Row label="Posição Y"><Slider value={lp.dy} min={-300} max={300} onChange={(dy) => onChange({ ...lp, dy })} /></Row>
        </>
      )}
    </div>
  )
}

export function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}


/** Crop an image before using it (drag a rectangle; "Imagem inteira" keeps it as is). */
/**
 * Crop an image, and/or remove its background: in "Remover fundo" each click on a colour makes it transparent (the
 * area of that colour touching the click, or that colour everywhere), with a tolerance; clicks add up and "Anular"
 * steps back. Pointer positions are converted from the displayed size to canvas pixels (the canvas is shown scaled
 * by CSS, which put the selection off the mouse).
 */
export function CropModal({ asset, onDone, onCancel, initialMode = 'crop' }: { asset: Asset; onDone: (a: Asset) => void; onCancel: () => void; initialMode?: 'crop' | 'bg' }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [work, setWork] = useState<HTMLCanvasElement | null>(null) // the image with the removed colours
  const [history, setHistory] = useState<HTMLCanvasElement[]>([])
  const [mode, setMode] = useState<'crop' | 'bg'>(initialMode)
  const [tol, setTol] = useState(40)
  const [contig, setContig] = useState(true)
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const i = new Image()
    i.onload = () => { setImg(i); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d')!.drawImage(i, 0, 0); setWork(c) }
    i.src = asset.dataUrl
  }, [asset.dataUrl])
  const scale = img ? Math.min(560 / img.naturalWidth, 420 / img.naturalHeight, 4) : 1
  useEffect(() => {
    const c = ref.current
    if (!c || !work) return
    c.width = Math.round(work.width * scale); c.height = Math.round(work.height * scale)
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(work, 0, 0, c.width, c.height)
    if (sel) {
      g.fillStyle = 'rgba(0,0,0,0.55)'
      const x = Math.min(sel.x0, sel.x1), y = Math.min(sel.y0, sel.y1), w = Math.abs(sel.x1 - sel.x0), h = Math.abs(sel.y1 - sel.y0)
      g.fillRect(0, 0, c.width, y); g.fillRect(0, y + h, c.width, c.height - y - h); g.fillRect(0, y, x, h); g.fillRect(x + w, y, c.width - x - w, h)
      g.strokeStyle = '#2fbf71'; g.lineWidth = 2; g.strokeRect(x, y, w, h)
    }
  }, [work, sel, scale])
  /** pointer → canvas pixels */
  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const c = ref.current!, r = c.getBoundingClientRect()
    const kx = c.width / Math.max(1, r.width), ky = c.height / Math.max(1, r.height)
    return { x: Math.max(0, Math.min(c.width, (e.clientX - r.left) * kx)), y: Math.max(0, Math.min(c.height, (e.clientY - r.top) * ky)) }
  }
  const removeAt = (px: number, py: number): void => {
    if (!work) return
    const w = work.width, h = work.height
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(px / scale))), y0 = Math.max(0, Math.min(h - 1, Math.floor(py / scale)))
    const next = document.createElement('canvas'); next.width = w; next.height = h
    const g = next.getContext('2d', { willReadFrequently: true })!
    g.drawImage(work, 0, 0)
    const id = g.getImageData(0, 0, w, h), d = id.data
    const o = (y0 * w + x0) * 4, r0 = d[o], g0 = d[o + 1], b0 = d[o + 2]
    if (d[o + 3] === 0) return
    const near = (i: number): boolean => d[i + 3] > 0 && Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) <= tol * 3
    if (contig) {
      const seen = new Uint8Array(w * h), stack = [y0 * w + x0]
      while (stack.length) {
        const p = stack.pop()!
        if (seen[p]) continue
        seen[p] = 1
        if (!near(p * 4)) continue
        d[p * 4 + 3] = 0
        const x = p % w, y = (p / w) | 0
        if (x > 0) stack.push(p - 1)
        if (x < w - 1) stack.push(p + 1)
        if (y > 0) stack.push(p - w)
        if (y < h - 1) stack.push(p + w)
      }
    } else for (let i = 0; i < d.length; i += 4) if (near(i)) d[i + 3] = 0
    g.putImageData(id, 0, 0)
    setHistory((hs) => [...hs, work])
    setWork(next)
  }
  const changed = history.length > 0
  const apply = (): void => {
    if (!work) return onDone(asset)
    let x = 0, y = 0, w = work.width, h = work.height
    if (sel) {
      const sx = Math.min(sel.x0, sel.x1) / scale, sy = Math.min(sel.y0, sel.y1) / scale, sw = Math.abs(sel.x1 - sel.x0) / scale, sh = Math.abs(sel.y1 - sel.y0) / scale
      if (sw >= 4 && sh >= 4) { x = sx; y = sy; w = sw; h = sh }
    }
    if (!changed && x === 0 && y === 0 && w === work.width && h === work.height) return onDone(asset)
    const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h)
    c.getContext('2d')!.drawImage(work, x, y, w, h, 0, 0, c.width, c.height)
    onDone({ ...asset, id: asset.id + '_c' + Math.round(x) + Math.round(y) + (changed ? 'b' + history.length + '_' + tol : ''), dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height })
  }
  return createPortal(
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>{mode === 'crop' ? 'Recortar imagem' : 'Remover fundo'}</b><span className="muted small">{mode === 'crop' ? 'arrasta para escolher a área' : 'clica na cor que queres tirar'}</span><div className="grow" /><button className="btn ghost" onClick={onCancel}>✕</button></div>
        <div className="crop-tools">
          <div className="seg">
            <button className={mode === 'crop' ? 'active' : ''} onClick={() => setMode('crop')}>Recortar</button>
            <button className={mode === 'bg' ? 'active' : ''} onClick={() => setMode('bg')}>Remover fundo</button>
          </div>
          {mode === 'bg' && (
            <>
              <span className="muted small">Tolerância</span>
              <input type="range" min={0} max={120} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
              <label className="check"><input type="checkbox" checked={contig} onChange={(e) => setContig(e.target.checked)} /> Só a zona ligada ao clique</label>
              <button className="btn small" disabled={!history.length} onClick={() => { setWork(history[history.length - 1]); setHistory((hs) => hs.slice(0, -1)) }}>Anular</button>
            </>
          )}
        </div>
        <div className="crop-area checker-bg">
          <canvas ref={ref} className="crop-canvas" style={{ cursor: mode === 'bg' ? 'crosshair' : 'default' }}
            onPointerDown={(e) => {
              const p = pos(e)
              if (mode === 'bg') { removeAt(p.x, p.y); return }
              (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = p; setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
            }}
            onPointerMove={(e) => { if (!drag.current) return; const p = pos(e); setSel((s) => (s ? { ...s, x1: p.x, y1: p.y } : s)) }}
            onPointerUp={() => { drag.current = null }} />
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => onDone(asset)}>Imagem original</button>
          <button className="btn" disabled={!sel} onClick={() => setSel(null)}>Limpar seleção</button>
          <div className="grow" />
          <button className="btn primary" onClick={apply}>Usar</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
