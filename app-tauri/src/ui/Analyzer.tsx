/**
 * "Analisador" tab: splits a kit texture (a PNG / FTEX file, a kit of the game) into colour masks and detail cut-outs,
 * shows the texture large with a before / after slider, lets the user pick with tools (click a colour, rectangle, lasso)
 * what stays and what leaves the texture, then applies the result to a kit of the open team or saves the layers in the
 * user library (Biblioteca → Camadas guardadas) to use in other kits.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, assetFromFile, type UserLayerSet } from '../state'
import { ALL_SLOTS, SLOT_LABEL, slotOrder, uid, type Asset } from '../model/design'
import { canvasToDataUrl, rgbaToCanvas } from '../compositor/images'
import { applyPlan, effColor, noEdits, planLayers, repOf, type AnalysisEdits, type AnalysisResult, type Plan, type Region } from '../analyze'
import { buildLabels, buildRows, composeAfter, highlightCanvas, layersThumb, rowKeyAt, NONE_PART, type Labels, type Row } from '../analyzeView'

const MAX_COLOR_LAYERS = 24
type Tool = 'pick' | 'rect' | 'lasso' | 'pan'
type Pt = [number, number]

/** The Analyzer's undo / redo, for the app-wide Ctrl+Z / Ctrl+Y (the app calls these while this tab is open). */
export const azHooks: { undo: () => void; redo: () => void } = { undo: () => undefined, redo: () => undefined }

export function Analyzer(): JSX.Element {
  const { project, teams, activeSlot, setProject, setActiveSlot, setView, notify } = useApp()
  const [src, setSrc] = useState<{ label: string; url: string } | null>(null)
  const [colors, setColors] = useState(0) // 0 = automatic
  const [sens, setSens] = useState(50)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AnalysisResult | null>(null)
  const [labels, setLabels] = useState<Labels | null>(null)
  const [ed, setEd] = useState<AnalysisEdits>(noEdits())
  const edRef = useRef(ed)
  edRef.current = ed
  const [past, setPast] = useState<AnalysisEdits[]>([])
  const [future, setFuture] = useState<AnalysisEdits[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set()) // highlighted rows of the layer list
  const anchor = useRef<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [cut, setCut] = useState(50)
  const [showDiff, setShowDiff] = useState(false)
  const [recognize, setRecognize] = useState(true)
  const [vector, setVector] = useState(false)
  const [tol, setTol] = useState(2)
  // source: a kit of the game
  const [gTeam, setGTeam] = useState<number>(project && project.teamId >= 0 ? project.teamId : -1)
  const [gSlot, setGSlot] = useState<string>(activeSlot || 'p1')
  // tools
  const [tool, setTool] = useState<Tool>('pick')
  const [mode, setMode] = useState<Region['mode']>('keep')
  const [draft, setDraft] = useState<Pt[] | null>(null)
  const [hover, setHover] = useState<string>('')
  const [view, setViewBox] = useState({ z: 1, x: 0, y: 0 })
  // saving / applying
  const [setName, setSetName] = useState('')
  const [target, setTarget] = useState('')

  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const hlRef = useRef<HTMLCanvasElement>(null)
  const [side, setSide] = useState(640)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSide(Math.max(280, Math.floor(Math.min(el.clientWidth, el.clientHeight)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn() } catch (e) { notify('err', String((e as Error).message ?? e)) }
  }
  const resetHist = (): void => { setPast([]); setFuture([]); setSel(new Set()); anchor.current = null }
  const reset = (): void => { setRes(null); setLabels(null); setEd(noEdits()); resetHist(); setPlan(null); setViewBox({ z: 1, x: 0, y: 0 }); setDraft(null) }
  const take = (label: string, url: string): void => { setSrc({ label, url }); reset(); if (!setName) setSetName(label.replace(/\.[a-z0-9]+$/i, '')) }

  const pickFile = (): Promise<void> => guard(async () => {
    const [p] = await window.kc.pickFiles([{ name: 'Texturas', extensions: ['png', 'ftex', 'dds', 'jpg', 'jpeg', 'webp'] }])
    if (!p) return
    const a = await assetFromFile(p)
    take(a.name, a.dataUrl)
  })
  const fromGame = (): Promise<void> => guard(async () => {
    if (gTeam < 0) throw new Error('Escolhe uma equipa.')
    const tex = await window.kc.readKitTexture(gTeam, gSlot, 'kit', 0)
    if (!tex) throw new Error('Este equipamento não tem textura no jogo.')
    const t = teams.find((x) => x.id === gTeam)
    take(`${t?.name ?? gTeam} ${SLOT_LABEL[gSlot] ?? gSlot}`, await canvasToDataUrl(rgbaToCanvas(tex)))
  })
  const run = (): Promise<void> => guard(async () => {
    if (!src) return
    setBusy(true)
    try {
      const r = (await window.kc.analyzeTexture(src.url, { colors: colors || undefined, sensitivity: sens })) as AnalysisResult
      const lb = await buildLabels(r, src.url)
      setRes(r); setLabels(lb); setEd(noEdits()); resetHist(); setViewBox({ z: 1, x: 0, y: 0 })
    } finally { setBusy(false) }
  })

  // every change of the choices goes through `edit`, so undo / redo cover all of them
  const edit = (fn: (e: AnalysisEdits) => AnalysisEdits): void => {
    const cur = edRef.current
    const nx = fn(cur)
    if (nx === cur) return
    setPast((h) => [...h.slice(-80), cur]); setFuture([])
    edRef.current = nx
    setEd(nx)
  }
  const undo = (): void => { const h = past; if (!h.length) return; const cur = edRef.current; setFuture((f) => [cur, ...f]); setPast(h.slice(0, -1)); edRef.current = h[h.length - 1]; setEd(h[h.length - 1]) }
  const redo = (): void => { const f = future; if (!f.length) return; const cur = edRef.current; setPast((h) => [...h, cur]); setFuture(f.slice(1)); edRef.current = f[0]; setEd(f[0]) }
  azHooks.undo = undo
  azHooks.redo = redo
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); azHooks.redo() }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [])

  // the layers the review would make (heavy: debounced)
  useEffect(() => {
    if (!res) { setPlan(null); return }
    let alive = true
    const t = setTimeout(() => { planLayers(res, ed, { recognize, vector, tolerance: tol }).then((p) => { if (alive) setPlan(p) }).catch(() => undefined) }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [res, ed, recognize, vector, tol])

  // the "after" half of the slider (fast, from the label map)
  const after = useMemo(() => (res && labels ? composeAfter(labels, res, ed) : null), [res, labels, ed])
  useEffect(() => {
    const c = afterRef.current
    if (!c || !after) return
    const img = showDiff ? after.diff : after.canvas
    c.width = img.width; c.height = img.height
    c.getContext('2d')!.drawImage(img, 0, 0)
  }, [after, showDiff])

  const W = res?.width ?? 2048
  const live = (c: number): boolean => !!res && repOf(c, ed.merge) === c
  const setMerge = (i: number, to: number | null): void => edit((e) => {
    const merge = { ...e.merge }
    if (to === null) delete merge[i]
    else { merge[i] = to; for (const k of Object.keys(merge)) if (merge[Number(k)] === i) merge[Number(k)] = to }
    return { ...e, merge }
  })

  // ---- pointer → texture coordinates, labels under the cursor
  const toTex = (e: { clientX: number; clientY: number }): Pt => {
    const r = worldRef.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)), Math.max(0, Math.min(W, ((e.clientY - r.top) / r.height) * W))]
  }
  const labelAt = (p: Pt): { part: number; col: number } | null => {
    if (!labels || !res) return null
    const x = Math.min(labels.n - 1, Math.floor((p[0] / W) * labels.n)), y = Math.min(labels.n - 1, Math.floor((p[1] / W) * labels.n))
    const i = y * labels.n + x
    return labels.part[i] === NONE_PART ? null : { part: labels.part[i], col: labels.col[i] }
  }
  const rows = useMemo(() => (res ? buildRows(res, ed) : []), [res, ed])
  const isOn = (r: Row): boolean => (r.kind === 'part' ? !ed.skipPart[r.part] : r.kind === 'detail' ? !ed.noDetail[r.part] : !ed.off[r.key] && !(r.color !== undefined && ed.drop[r.color]))
  const toggleRow = (r: Row): void => edit((e) => (r.kind === 'part' ? { ...e, skipPart: { ...e.skipPart, [r.part]: !e.skipPart[r.part] } } : r.kind === 'detail' ? { ...e, noDetail: { ...e.noDetail, [r.part]: !e.noDetail[r.part] } } : { ...e, off: { ...e.off, [r.key]: !e.off[r.key] } }))
  const keyAt = (p: Pt): string | null => {
    if (!labels || !res) return null
    const x = Math.min(labels.n - 1, Math.floor((p[0] / W) * labels.n)), y = Math.min(labels.n - 1, Math.floor((p[1] / W) * labels.n))
    return rowKeyAt(labels, res, ed, y * labels.n + x)
  }
  const describe = (p: Pt): string => {
    const k = keyAt(p)
    const r = rows.find((x) => x.key === k)
    return r ? `${r.name} ${isOn(r) ? '(fica)' : '(fora)'}` : ''
  }
  /** Click on a row (or on the texture): highlights it; Ctrl / Shift add to the selection. Never switches it off. */
  const selectRow = (key: string, add: boolean): void => {
    anchor.current = key
    setSel((cur) => { if (!add) return new Set([key]); const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }
  const clickPick = (p: Pt, add: boolean): void => { const k = keyAt(p); if (k) selectRow(k, add); else if (!add) setSel(new Set()) }

  // highlight of the selected rows over the texture
  useEffect(() => {
    const c = hlRef.current
    if (!c) return
    const h = labels && res ? highlightCanvas(labels, res, ed, sel) : null
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    if (h) { c.width = h.width; c.height = h.height; c.getContext('2d')!.drawImage(h, 0, 0) }
  }, [labels, res, ed, sel])

  // merge: the selected rows take the colour of the row clicked last (a layer or a part)
  const mergeSel = (): void => {
    if (!res) return
    const tKey = anchor.current && sel.has(anchor.current) ? anchor.current : [...sel][0]
    const T = rows.find((r) => r.key === tKey)
    if (!T || T.color === undefined) { notify('err', 'O destino do «Juntar» tem de ser uma camada de cor ou uma parte.'); return }
    const t = T.color
    const srcs = rows.filter((r) => sel.has(r.key) && r.key !== tKey && r.kind !== 'detail' && r.color !== undefined && r.color !== t)
    if (!srcs.length) { notify('err', 'Seleciona pelo menos duas camadas de cor ou partes (Ctrl + clique).'); return }
    edit((e0) => {
      let e = e0
      for (const r of srcs) {
        const part = res.parts.find((p) => p.part === r.part)!
        const pm = { ...(e.pm[r.part] ?? {}) }
        const from = effColor(e, r.part, r.color!)
        for (const m of part.masks) if (effColor(e, r.part, m.color) === from) pm[m.color] = t
        if (part.dominant !== null && effColor(e, r.part, part.dominant) === from) pm[part.dominant] = t
        e = { ...e, pm: { ...e.pm, [r.part]: pm } }
      }
      return e
    })
    setSel(new Set([tKey]))
    notify('ok', `${srcs.length} camada(s) juntada(s) em ${T.name}`)
  }

  const onDown = (e: React.PointerEvent): void => {
    if (!src) return
    const panning = tool === 'pan' || !res || e.button === 1 || e.button === 2 || e.altKey
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
    if (panning) {
      const s = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
      const move = (ev: PointerEvent): void => setViewBox((v) => ({ ...v, x: s.vx + ev.clientX - s.x, y: s.vy + ev.clientY - s.y }))
      const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
      return
    }
    if (e.button !== 0) return
    const p0 = toTex(e)
    if (tool === 'pick') { clickPick(p0, e.ctrlKey || e.shiftKey || e.metaKey); return }
    let pts: Pt[] = [p0]
    setDraft(pts)
    const rectOf = (a: Pt, b: Pt): Pt[] => [a, [b[0], a[1]], b, [a[0], b[1]]]
    const move = (ev: PointerEvent): void => {
      const p = toTex(ev)
      pts = tool === 'rect' ? rectOf(p0, p) : [...pts, p]
      setDraft(pts)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDraft(null)
      const area = Math.abs(Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]))) * Math.abs(Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])))
      if (pts.length >= 3 && area > 25) edit((x) => ({ ...x, regions: [...x.regions, { mode, pts: pts.map(([a, b]) => [Math.round(a), Math.round(b)] as Pt) }] }))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const zoomBy = (f: number, cx = side / 2, cy = side / 2): void => setViewBox((v) => {
    const z = Math.max(1, Math.min(16, v.z * f))
    const k = z / v.z
    return z === 1 ? { z, x: 0, y: 0 } : { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
  })
  const onWheel = (e: React.WheelEvent): void => {
    const fr = frameRef.current
    if (!fr || !src) return
    const r = fr.getBoundingClientRect()
    zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, e.clientX - r.left, e.clientY - r.top)
  }

  // ---- layers to save / apply
  const chosen = plan?.layers ?? []

  const saveSet = (): Promise<void> => guard(async () => {
    if (!plan || !chosen.length) throw new Error('Escolhe pelo menos uma camada.')
    const name = setName.trim() || 'Camadas'
    const layers = chosen.map((p) => p.layer)
    const assets: Record<string, Asset> = {}
    for (const p of chosen) if (p.asset) assets[p.asset.id] = p.asset
    const thumb = (await layersThumb(layers, assets)) ?? (after ? (() => { const c = document.createElement('canvas'); c.width = c.height = 192; c.getContext('2d')!.drawImage(after.canvas, 0, 0, 192, 192); return c.toDataURL('image/png') })() : '')
    const id = uid() + Date.now().toString(36)
    const set: UserLayerSet = { id, name, date: new Date().toISOString(), layers, assets, colors: plan.colors, thumb }
    await window.kc.saveUserLayers(id, JSON.stringify(set))
    notify('ok', `${layers.length} camada(s) guardada(s) na biblioteca: ${name}`)
  })

  const kitSlots = (project?.kits ?? []).map((k) => k.slot)
  const freeSlots = ALL_SLOTS.filter((s) => !kitSlots.includes(s))
  const slotTarget = target || (kitSlots.includes(activeSlot) ? activeSlot : kitSlots[0] ?? '')
  const apply = (): void => {
    if (!plan || !res || !project) return
    const slot = slotTarget
    const tpl = project.kits.find((k) => k.slot === activeSlot) ?? project.kits[0]
    setProject((p) => {
      const assets = { ...p.assets }
      for (const pl of plan.layers) if (pl.asset) assets[pl.asset.id] = pl.asset
      if (p.kits.some((k) => k.slot === slot)) return { ...p, assets, kits: p.kits.map((k) => (k.slot === slot ? applyPlan(k, plan, ed) : k)) }
      const fresh = applyPlan({ ...tpl, slot, layers: [] }, plan, ed)
      return { ...p, assets, kits: [...p.kits, fresh].sort((a, b) => slotOrder(a.slot, b.slot)) }
    })
    setActiveSlot(slot)
    setView('editor')
    notify('ok', `Textura separada em ${plan.nColor} camada(s) de cor e ${plan.nDetail} de detalhes`)
  }

  const tooMany = (plan?.nColor ?? 0) > MAX_COLOR_LAYERS
  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams])
  const dropped = rows.filter((r) => !isOn(r)).length

  return (
    <div className="analyzer">
      <aside className="az-side">
        <div className="sub-title">Textura</div>
        <div className="btn-row"><button className="btn small" onClick={pickFile}>Ficheiro (PNG / FTEX)…</button></div>
        <div className="muted small">Ou um equipamento do jogo:</div>
        <select value={gTeam} onChange={(e) => setGTeam(Number(e.target.value))}>
          <option value={-1}>— equipa —</option>
          {sortedTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="btn-row">
          <select value={gSlot} onChange={(e) => setGSlot(e.target.value)}>{ALL_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s] ?? s}</option>)}</select>
          <button className="btn small" disabled={gTeam < 0} onClick={fromGame}>Ler do jogo</button>
        </div>
        <div className="muted small">{src ? src.label : 'Escolhe uma textura de kit (2048×2048, no formato do jogo).'}</div>
        {src && (
          <div className="set-grid">
            <label>Cores</label>
            <select value={colors} onChange={(e) => setColors(Number(e.target.value))}>
              <option value={0}>Automático</option>
              {Array.from({ length: 15 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <label>Sensibilidade</label>
            <input type="range" min={0} max={100} value={sens} onChange={(e) => setSens(Number(e.target.value))} />
          </div>
        )}
        {src && <div className="btn-row"><button className="btn small primary" disabled={busy} onClick={run}>{busy ? 'A analisar…' : res ? 'Analisar de novo' : 'Analisar'}</button></div>}
        {res && (
          <>
            <div className="sub-title">Ferramentas de seleção</div>
            <div className="az-tools">
              <button className="btn small" title="Desfazer (Ctrl+Z)" disabled={!past.length} onClick={undo}>↶ Desfazer</button>
              <button className="btn small" title="Refazer (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}>↷ Refazer</button>
            </div>
            <div className="az-tools">
              {([['pick', '☝ Cor', 'Clica na textura para destacar a camada (Ctrl / Shift: várias). Não a desliga'], ['rect', '▭ Retângulo', 'Desenha um retângulo na textura'], ['lasso', '➰ Laço', 'Desenha à mão livre à volta do que queres'], ['pan', '✥ Mover', 'Arrasta a textura (também: botão direito ou Alt). A roda do rato faz zoom']] as [Tool, string, string][]).map(([t, l, h]) => (
                <button key={t} className={'btn small' + (tool === t ? ' primary' : '')} title={h} onClick={() => setTool(t)}>{l}</button>
              ))}
            </div>
            {(tool === 'rect' || tool === 'lasso') && (
              <div className="az-tools">
                <button className={'btn small' + (mode === 'keep' ? ' primary' : '')} title="Só o que está dentro das seleções fica nas camadas (várias seleções somam-se)" onClick={() => setMode('keep')}>Ficar só com o de dentro</button>
                <button className={'btn small' + (mode === 'cut' ? ' primary' : '')} title="O que fica dentro da seleção sai das camadas" onClick={() => setMode('cut')}>Tirar o que está dentro</button>
              </div>
            )}
            <div className="muted small">{tool === 'pick' ? 'Clica na textura para destacar a camada na lista e no kit. Para a desligar usa a caixa da lista.' : tool === 'pan' ? 'Arrasta para mover; roda do rato para o zoom.' : 'Desenha na textura. Verde = ficar só, vermelho = tirar.'}</div>
            <div className="btn-row">
              <button className="btn small ghost" disabled={!ed.regions.length} onClick={() => edit((x) => ({ ...x, regions: x.regions.slice(0, -1) }))}>Desfazer seleção</button>
              <button className="btn small ghost" disabled={!ed.regions.length && !dropped && !Object.keys(ed.pm).length} onClick={() => edit((x) => ({ ...x, regions: [], drop: {}, noDetail: {}, off: {}, skipPart: {}, pm: {} }))}>Repor tudo</button>
              <button className="btn small ghost" disabled={view.z === 1} onClick={() => setViewBox({ z: 1, x: 0, y: 0 })}>Zoom 1×</button>
            </div>
            <div className="muted small">{`${ed.regions.length} seleção(ões) desenhada(s); ${dropped} cor(es) tirada(s).`}</div>
          </>
        )}
      </aside>

      <section className="az-main">
        <div className="az-stage" ref={stageRef} onWheel={onWheel}>
          {!src && <div className="muted az-empty">Escolhe uma textura à esquerda para a analisar.</div>}
          {src && (
            <div className="az-frame" ref={frameRef} style={{ width: side, height: side }}>
              <div ref={worldRef} className={'az-world tool-' + tool} style={{ width: side, height: side, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
                onPointerDown={onDown} onPointerMove={(e) => { if (tool === 'pick' && res && e.buttons === 0) setHover(describe(toTex(e))) }} onPointerLeave={() => setHover('')} onContextMenu={(e) => e.preventDefault()}>
                <img className="az-img" src={src.url} alt="" draggable={false} />
                {res && <canvas ref={afterRef} className="az-img top" style={{ clipPath: `inset(0 0 0 ${cut}%)` }} />}
                {res && <canvas ref={hlRef} className="az-img top az-hl" />}
                {res && <div className="az-line" style={{ left: `${cut}%`, width: 2 / view.z }} />}
                {res && (
                  <svg className="az-overlay" viewBox={`0 0 ${W} ${W}`}>
                    {ed.regions.map((r, i) => <polygon key={i} className={'az-reg ' + r.mode} points={r.pts.map((p) => p.join(',')).join(' ')} />)}
                    {draft && <polygon className={'az-reg draft ' + mode} points={draft.map((p) => p.join(',')).join(' ')} />}
                  </svg>
                )}
              </div>
              {busy && <div className="az-busy"><span className="spinner big" /></div>}
            </div>
          )}
        </div>
        {src && (
          <div className="az-bar">
            <button className="btn small" title="Aproximar" onClick={() => zoomBy(1.5)}>＋</button>
            <button className="btn small" title="Afastar" onClick={() => zoomBy(1 / 1.5)}>－</button>
            <button className="btn small" title="Ver a textura inteira" onClick={() => setViewBox({ z: 1, x: 0, y: 0 })}>{`${Math.round(view.z * 100)}%`}</button>
            {!res && <span className="muted small">Roda do rato: zoom · arrasta para mover</span>}
            {res && <>
            <button className="btn small" title="Desfazer (Ctrl+Z)" disabled={!past.length} onClick={undo}>↶</button>
            <button className="btn small" title="Refazer (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}>↷</button>
            <span className="muted small">Original</span>
            <input className="grow" type="range" min={0} max={100} value={cut} onChange={(e) => setCut(Number(e.target.value))} title="Esquerda: original · direita: resultado" />
            <span className="muted small">Resultado</span>
            <label className="check"><input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} /> Mapa de diferenças</label>
            <span className="muted small">{after ? `Diferença média: ${after.meanDiff.toFixed(1)} em 255` : ''}</span>
            <span className="az-hover">{hover}</span>
            </>}
          </div>
        )}
      </section>

      <aside className="az-side az-right">
        {!res && <div className="muted small">Depois de analisar, aqui vês as cores encontradas. Podes juntar cores parecidas, descartar as que não queres, escolher na própria textura o que fica e o que sai, e ver a diferença no slider. Os detalhes (emblemas, patrocinadores, degradês e sombras pintadas) ficam como imagem.</div>}
        {res && (
          <>
            <div className="sub-title">Cores</div>
            {res.palette.map((c, i) => (
              <div key={i} className={'az-color' + (live(i) ? '' : ' merged')}>
                <span className="contrast-sw" style={{ background: c.hex }} />
                <span className="grow">{c.hex}</span>
                <span className="muted small">{`${(c.share * 100).toFixed(1)}%`}</span>
                <select value={ed.merge[i] ?? ''} title="Junta esta cor a outra" onChange={(e) => setMerge(i, e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">—</option>
                  {res.palette.map((o, j) => (j !== i && live(j) ? <option key={j} value={j}>{`Juntar com ${o.hex}`}</option> : null))}
                </select>
                <label className="check" title="Não criar camada com esta cor"><input type="checkbox" checked={!!ed.drop[i]} onChange={(e) => edit((x) => ({ ...x, drop: { ...x.drop, [i]: e.target.checked } }))} /> Descartar</label>
              </div>
            ))}
            {tooMany && <div className="kitlab-warn">Há muitas camadas de cor; junta ou descarta cores parecidas.</div>}
            <div className="muted small">Sombras, dobras, degradês e texturas fotográficas não se separam bem em cores lisas e ficam como imagem (Detalhes). Desenhos que atravessam costuras ficam divididos pelas partes do kit.</div>
            <div className="sub-title">Formas</div>
            <label className="check"><input type="checkbox" checked={recognize} onChange={(e) => setRecognize(e.target.checked)} /> Reconhecer riscas, bandas e metades da camisola (ficam como desenhos do kit, fáceis de editar)</label>
            <label className="check"><input type="checkbox" checked={vector} onChange={(e) => setVector(e.target.checked)} /> Converter as outras cores em formas vetoriais (editáveis com a caneta)</label>
            {vector && <div className="set-grid"><label>Tolerância</label><select value={tol} onChange={(e) => setTol(Number(e.target.value))}><option value={1}>Fina (1 px)</option><option value={2}>Normal (2 px)</option><option value={4}>Solta (4 px)</option></select></div>}
            {plan && (plan.nPattern > 0 || plan.nVector > 0) && <div className="muted small">{`${plan.nPattern} reconhecida(s) como desenho do kit, ${plan.nVector} em vetor.`}</div>}

            <div className="sub-title">Partes e camadas</div>
            <div className="muted small">Clica numa linha para a destacar no kit (Ctrl / Shift: várias). A caixa liga e desliga. Com duas ou mais selecionadas, «Juntar» dá-lhes a cor da última que clicaste.</div>
            <div className="btn-row">
              <button className="btn small primary" disabled={sel.size < 2} onClick={mergeSel}>{`Juntar ${sel.size || ''} selecionadas`}</button>
              <button className="btn small ghost" disabled={!sel.size} onClick={() => setSel(new Set())}>Limpar seleção</button>
            </div>
            {rows.map((r) => (
              <div key={r.key} className={'az-row ' + r.kind + (sel.has(r.key) ? ' sel' : '') + (isOn(r) ? '' : ' off')} onClick={(e) => selectRow(r.key, e.ctrlKey || e.shiftKey || e.metaKey)}>
                <input type="checkbox" checked={isOn(r)} title="Ligar / desligar" onClick={(e) => e.stopPropagation()} onChange={() => toggleRow(r)} />
                {r.kind !== 'detail' && <span className="contrast-sw" style={{ background: r.hex }} />}
                <span className="grow">{r.kind === 'part' ? <b>{r.name}</b> : r.name}</span>
                <span className="muted small">{r.kind === 'part' ? 'base' : `${(r.share * 100).toFixed(1)}%`}</span>
              </div>
            ))}
            {!plan && <div className="muted small"><span className="spinner" /> A preparar as camadas…</div>}
            {plan && !plan.layers.length && <div className="muted small">Não há camadas (tudo foi tirado ou é a cor de base).</div>}

            <div className="sub-title">Guardar na biblioteca</div>
            <div className="muted small">Guarda as camadas do resultado (as que estão ligadas) para as usares noutros kits (no editor: Adicionar camada → Da biblioteca).</div>
            <div className="btn-row"><input className="grow" value={setName} placeholder="Nome" onChange={(e) => setSetName(e.target.value)} /><button className="btn small primary" disabled={!chosen.length} onClick={saveSet}>{`Guardar ${chosen.length} camada(s)`}</button></div>

            <div className="sub-title">Aplicar a um kit</div>
            {!project && <div className="muted small">Abre uma equipa (separador Equipas) para aplicares o resultado a um dos seus kits.</div>}
            {project && (
              <>
                <div className="set-grid">
                  <label>Aplicar a</label>
                  <select value={slotTarget} onChange={(e) => setTarget(e.target.value)}>
                    {kitSlots.map((s) => <option key={s} value={s}>{`${SLOT_LABEL[s] ?? s}${s === activeSlot ? ' (kit aberto)' : ''}`}</option>)}
                    {freeSlots.map((s) => <option key={s} value={s}>{`${SLOT_LABEL[s] ?? s} (livre)`}</option>)}
                  </select>
                </div>
                <div className="muted small">As camadas antigas das partes analisadas e o desenho da camisola são substituídos; emblemas, números e o resto ficam. Podes desfazer com Ctrl+Z.</div>
                <div className="set-row"><div className="grow" /><button className="btn primary" disabled={!plan} onClick={apply}>{plan ? `Aplicar (${plan.nColor} + ${plan.nDetail})` : 'Aplicar'}</button></div>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
