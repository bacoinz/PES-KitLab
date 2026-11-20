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
import { PART_LABEL, applyPlan, noEdits, planLayers, repOf, type AnalysisEdits, type AnalysisResult, type PartKey, type Plan, type Region } from '../analyze'
import { buildLabels, composeAfter, layersThumb, DETAIL, NONE_PART, type Labels } from '../analyzeView'

const MAX_COLOR_LAYERS = 24
type Tool = 'pick' | 'rect' | 'lasso' | 'pan'
type Pt = [number, number]

export function Analyzer(): JSX.Element {
  const { project, teams, activeSlot, setProject, setActiveSlot, setView, notify } = useApp()
  const [src, setSrc] = useState<{ label: string; url: string } | null>(null)
  const [colors, setColors] = useState(0) // 0 = automatic
  const [sens, setSens] = useState(50)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AnalysisResult | null>(null)
  const [labels, setLabels] = useState<Labels | null>(null)
  const [ed, setEd] = useState<AnalysisEdits>(noEdits())
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
  const [mode, setMode] = useState<Region['mode']>('cut')
  const [draft, setDraft] = useState<Pt[] | null>(null)
  const [hover, setHover] = useState<string>('')
  const [view, setViewBox] = useState({ z: 1, x: 0, y: 0 })
  // saving / applying
  const [unsel, setUnsel] = useState<Set<string>>(new Set())
  const [setName, setSetName] = useState('')
  const [target, setTarget] = useState('')

  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
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
  const reset = (): void => { setRes(null); setLabels(null); setEd(noEdits()); setPlan(null); setUnsel(new Set()); setViewBox({ z: 1, x: 0, y: 0 }); setDraft(null) }
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
      setRes(r); setLabels(lb); setEd(noEdits()); setUnsel(new Set()); setViewBox({ z: 1, x: 0, y: 0 })
    } finally { setBusy(false) }
  })

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
  const setMerge = (i: number, to: number | null): void => setEd((e) => {
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
  const describe = (p: Pt): string => {
    const l = labelAt(p)
    if (!l || !res) return ''
    const key = res.parts[l.part].part as PartKey
    if (l.col === DETAIL) return `${PART_LABEL[key]} · detalhe ${ed.noDetail[key] ? '(fora)' : '(fica)'}`
    const c = repOf(l.col, ed.merge)
    return `${PART_LABEL[key]} · ${res.palette[c].hex} ${ed.drop[c] || ed.drop[l.col] ? '(fora)' : '(fica)'}`
  }
  const clickPick = (p: Pt): void => {
    const l = labelAt(p)
    if (!l || !res) return
    const key = res.parts[l.part].part
    if (l.col === DETAIL) setEd((x) => ({ ...x, noDetail: { ...x.noDetail, [key]: !x.noDetail[key] } }))
    else { const c = repOf(l.col, ed.merge); setEd((x) => ({ ...x, drop: { ...x.drop, [c]: !x.drop[c] } })) }
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
    if (tool === 'pick') { clickPick(p0); return }
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
      if (pts.length >= 3 && area > 25) setEd((x) => ({ ...x, regions: [...x.regions, { mode, pts: pts.map(([a, b]) => [Math.round(a), Math.round(b)] as Pt) }] }))
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
  const layerKeys = useMemo(() => {
    const seen = new Map<string, number>()
    return (plan?.layers ?? []).map((l) => { const n = l.layer.name ?? l.layer.kind; const k = (seen.get(n) ?? 0) + 1; seen.set(n, k); return n + '#' + k })
  }, [plan])
  const chosen = (plan?.layers ?? []).filter((_, i) => !unsel.has(layerKeys[i]))

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
  const dropped = (res?.palette ?? []).filter((_, i) => live(i) && ed.drop[i]).length

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
              {([['pick', '☝ Cor', 'Clica numa cor ou num detalhe da textura para o tirar ou voltar a pôr'], ['rect', '▭ Retângulo', 'Desenha um retângulo na textura'], ['lasso', '➰ Laço', 'Desenha à mão livre à volta do que queres'], ['pan', '✥ Mover', 'Arrasta a textura (também: botão direito ou Alt). A roda do rato faz zoom']] as [Tool, string, string][]).map(([t, l, h]) => (
                <button key={t} className={'btn small' + (tool === t ? ' primary' : '')} title={h} onClick={() => setTool(t)}>{l}</button>
              ))}
            </div>
            {(tool === 'rect' || tool === 'lasso') && (
              <div className="az-tools">
                <button className={'btn small' + (mode === 'cut' ? ' primary' : '')} title="O que fica dentro da seleção sai das camadas" onClick={() => setMode('cut')}>Tirar o que está dentro</button>
                <button className={'btn small' + (mode === 'keep' ? ' primary' : '')} title="Só o que está dentro da seleção fica nas camadas" onClick={() => setMode('keep')}>Ficar só com o de dentro</button>
              </div>
            )}
            <div className="muted small">{tool === 'pick' ? 'Clica na textura: a cor (ou o detalhe) sai; clica de novo e volta. O que sai fica com a cor de base da parte.' : tool === 'pan' ? 'Arrasta para mover; roda do rato para o zoom.' : 'Desenha na textura. Verde = ficar só, vermelho = tirar.'}</div>
            <div className="btn-row">
              <button className="btn small ghost" disabled={!ed.regions.length} onClick={() => setEd((x) => ({ ...x, regions: x.regions.slice(0, -1) }))}>Desfazer seleção</button>
              <button className="btn small ghost" disabled={!ed.regions.length && !dropped} onClick={() => setEd((x) => ({ ...x, regions: [], drop: {}, noDetail: {} }))}>Repor tudo</button>
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
                <label className="check" title="Não criar camada com esta cor"><input type="checkbox" checked={!!ed.drop[i]} onChange={(e) => setEd((x) => ({ ...x, drop: { ...x.drop, [i]: e.target.checked } }))} /> Descartar</label>
              </div>
            ))}
            <div className="sub-title">Partes</div>
            {res.parts.map((p) => {
              const base = p.dominant !== null ? res.palette[repOf(p.dominant, ed.merge)].hex : null
              return (
                <div key={p.part} className="az-part">
                  <label className="check"><input type="checkbox" checked={!ed.skipPart[p.part]} onChange={(e) => setEd((x) => ({ ...x, skipPart: { ...x.skipPart, [p.part]: !e.target.checked } }))} /> <b>{PART_LABEL[p.part as PartKey]}</b></label>
                  {base && <span className="contrast-sw" style={{ background: base }} title="Cor de base" />}
                  <span className="grow muted small">{`${plan?.layers.filter((l) => l.layer.part === p.part && l.layer.tileTint === 'color').length ?? 0} camada(s) de cor`}</span>
                  {p.detail && <label className="check"><input type="checkbox" checked={!ed.noDetail[p.part]} onChange={(e) => setEd((x) => ({ ...x, noDetail: { ...x.noDetail, [p.part]: !e.target.checked } }))} /> Detalhes</label>}
                </div>
              )
            })}
            {tooMany && <div className="kitlab-warn">Há muitas camadas de cor; junta ou descarta cores parecidas.</div>}
            <div className="muted small">Sombras, dobras, degradês e texturas fotográficas não se separam bem em cores lisas e ficam como imagem (Detalhes). Desenhos que atravessam costuras ficam divididos pelas partes do kit.</div>
            <div className="sub-title">Formas</div>
            <label className="check"><input type="checkbox" checked={recognize} onChange={(e) => setRecognize(e.target.checked)} /> Reconhecer riscas, bandas e metades da camisola (ficam como desenhos do kit, fáceis de editar)</label>
            <label className="check"><input type="checkbox" checked={vector} onChange={(e) => setVector(e.target.checked)} /> Converter as outras cores em formas vetoriais (editáveis com a caneta)</label>
            {vector && <div className="set-grid"><label>Tolerância</label><select value={tol} onChange={(e) => setTol(Number(e.target.value))}><option value={1}>Fina (1 px)</option><option value={2}>Normal (2 px)</option><option value={4}>Solta (4 px)</option></select></div>}
            {plan && (plan.nPattern > 0 || plan.nVector > 0) && <div className="muted small">{`${plan.nPattern} reconhecida(s) como desenho do kit, ${plan.nVector} em vetor.`}</div>}

            <div className="sub-title">Camadas geradas</div>
            {!plan && <div className="muted small"><span className="spinner" /> A preparar as camadas…</div>}
            {plan && plan.layers.map((l, i) => (
              <label key={layerKeys[i]} className="check az-layer">
                <input type="checkbox" checked={!unsel.has(layerKeys[i])} onChange={(e) => setUnsel((s) => { const n = new Set(s); if (e.target.checked) n.delete(layerKeys[i]); else n.add(layerKeys[i]); return n })} />
                {l.layer.tileTint === 'color' || l.layer.kind === 'vector' ? <span className="contrast-sw" style={{ background: l.layer.color }} /> : null}
                <span className="grow">{l.layer.name ?? l.layer.kind}</span>
              </label>
            ))}
            {plan && !plan.layers.length && <div className="muted small">Não há camadas (tudo foi tirado ou é a cor de base).</div>}

            <div className="sub-title">Guardar na biblioteca</div>
            <div className="muted small">Guarda as camadas escolhidas acima para as usares noutros kits (no editor: Adicionar camada → Da biblioteca).</div>
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
