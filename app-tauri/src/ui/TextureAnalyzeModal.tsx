/**
 * Review screen of the texture analyser: pick a texture (PNG / FTEX file, the game's kit or this kit's own image), let
 * the app core split it into colour masks, then accept, merge or drop each colour before it becomes editable layers.
 */
import { useEffect, useMemo, useState } from 'react'
import { useApp, assetFromFile } from '../state'
import { ALL_SLOTS, SLOT_LABEL, slotOrder, type KitDesign } from '../model/design'
import { canvasToDataUrl, rgbaToCanvas } from '../compositor/images'
import { PART_LABEL, applyPlan, noEdits, planLayers, repOf, type AnalysisEdits, type AnalysisResult, type Plan, type PartKey } from '../analyze'

const MAX_COLOR_LAYERS = 24

export function TextureAnalyzeModal({ kit, onClose }: { kit: KitDesign; onClose: () => void }): JSX.Element | null {
  const { project, setProject, setActiveSlot, notify } = useApp()
  const [src, setSrc] = useState<{ label: string; url: string } | null>(null)
  const [colors, setColors] = useState(0) // 0 = automatic
  const [sens, setSens] = useState(50)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AnalysisResult | null>(null)
  const [ed, setEd] = useState<AnalysisEdits>(noEdits())
  const [plan, setPlan] = useState<Plan | null>(null)
  const [cut, setCut] = useState(50)
  const [showDiff, setShowDiff] = useState(false)
  const [target, setTarget] = useState(kit.slot)
  // phase B: the kit's own designs for regular stripes / bands, and vector shapes instead of masks
  const [recognize, setRecognize] = useState(true)
  const [vector, setVector] = useState(false)
  const [tol, setTol] = useState(2)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  useEffect(() => {
    if (!res) { setPlan(null); return }
    let alive = true
    const t = setTimeout(() => { planLayers(res, ed, { recognize, vector, tolerance: tol }).then((p) => { if (alive) setPlan(p) }).catch(() => undefined) }, 150)
    return () => { alive = false; clearTimeout(t) }
  }, [res, ed, recognize, vector, tol])
  const taken = useMemo(() => new Set((project?.kits ?? []).map((k) => k.slot)), [project])
  const family = kit.slot.startsWith('g') ? 'g' : 'p'
  const freeSlots = ALL_SLOTS.filter((s) => s.startsWith(family) && !taken.has(s))
  if (!project) return null

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn() } catch (e) { notify('err', String((e as Error).message ?? e)) }
  }
  const pickFile = (): Promise<void> => guard(async () => {
    const [p] = await window.kc.pickFiles([{ name: 'Texturas', extensions: ['png', 'ftex', 'dds', 'jpg', 'jpeg', 'webp'] }])
    if (!p) return
    const a = await assetFromFile(p)
    setSrc({ label: a.name, url: a.dataUrl }); setRes(null); setEd(noEdits())
  })
  const fromGame = (): Promise<void> => guard(async () => {
    const tex = await window.kc.readKitTexture(project.teamId, kit.slot, 'kit', 0)
    if (!tex) throw new Error('Este equipamento não tem textura no jogo.')
    setSrc({ label: `${project.teamName} ${SLOT_LABEL[kit.slot] ?? kit.slot} (jogo)`, url: await canvasToDataUrl(rgbaToCanvas(tex)) }); setRes(null); setEd(noEdits())
  })
  const fromKit = (): void => {
    const a = kit.base.imageAssetId ? project.assets[kit.base.imageAssetId] : undefined
    if (a) { setSrc({ label: a.name, url: a.dataUrl }); setRes(null); setEd(noEdits()) }
  }
  const run = (): Promise<void> => guard(async () => {
    if (!src) return
    setBusy(true)
    try {
      const r = (await window.kc.analyzeTexture(src.url, { colors: colors || undefined, sensitivity: sens })) as AnalysisResult
      setRes(r); setEd(noEdits())
    } finally { setBusy(false) }
  })
  const setMerge = (i: number, to: number | null): void => setEd((e) => {
    const merge = { ...e.merge }
    if (to === null) delete merge[i]
    else { merge[i] = to; for (const k of Object.keys(merge)) if (merge[Number(k)] === i) merge[Number(k)] = to } // flatten what pointed at i
    return { ...e, merge }
  })
  const apply = (): void => {
    if (!plan || !res) return
    const slot = target
    setProject((p) => {
      const assets = { ...p.assets }
      for (const pl of plan.layers) if (pl.asset) assets[pl.asset.id] = pl.asset
      if (slot === kit.slot) return { ...p, assets, kits: p.kits.map((k) => (k.slot === slot ? applyPlan(k, plan, ed) : k)) }
      const fresh = applyPlan({ ...kit, slot, layers: [] }, plan, ed)
      return { ...p, assets, kits: [...p.kits, fresh].sort((a, b) => slotOrder(a.slot, b.slot)) }
    })
    setActiveSlot(slot)
    notify('ok', `Textura separada em ${plan.nColor} camada(s) de cor e ${plan.nDetail} de detalhes`)
    onClose()
  }

  const live = (c: number): boolean => repOf(c, ed.merge) === c
  const tooMany = (plan?.nColor ?? 0) > MAX_COLOR_LAYERS
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal analyze" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Analisar textura</b><span className="muted small">separa uma textura em camadas de cor que podes editar</span><div className="grow" /><button className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="analyze-body">
          <div className="analyze-left">
            <div className="btn-row">
              <button className="btn small" onClick={pickFile}>Ficheiro (PNG / FTEX)…</button>
              {project.teamId >= 0 && <button className="btn small" onClick={fromGame} title="A textura que o jogo tem para este equipamento">Kit do jogo</button>}
              {kit.base.kind === 'image' && kit.base.imageAssetId && <button className="btn small" onClick={fromKit} title="A textura de base importada neste kit">Textura deste kit</button>}
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
            <div className="analyze-view">
              {src && <img className="az-img" src={src.url} alt="" />}
              {res && <img className="az-img top" src={showDiff ? res.diff : res.recomposed} alt="" style={{ clipPath: `inset(0 0 0 ${cut}%)` }} />}
              {res && <div className="az-line" style={{ left: `${cut}%` }} />}
            </div>
            {res && (
              <>
                <input type="range" min={0} max={100} value={cut} onChange={(e) => setCut(Number(e.target.value))} title="Esquerda: original · direita: resultado" />
                <label className="check"><input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} /> Mostrar o mapa de diferenças (em vez do resultado)</label>
                <div className="muted small">{`Diferença média por pixel: ${res.meanDiff.toFixed(1)} em 255`}</div>
              </>
            )}
          </div>
          <div className="analyze-right">
            {!res && <div className="muted small">Depois de analisar, aqui vês as cores encontradas. Podes juntar cores parecidas, descartar as que não queres e escolher o que fazer aos detalhes (emblemas, patrocinadores, degradês e sombras pintadas, que ficam como imagem).</div>}
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
                <div className="set-grid">
                  <label>Aplicar a</label>
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value={kit.slot}>{`${SLOT_LABEL[kit.slot] ?? kit.slot} (este kit)`}</option>
                    {freeSlots.map((s) => <option key={s} value={s}>{`${SLOT_LABEL[s] ?? s} (livre)`}</option>)}
                  </select>
                </div>
                <div className="muted small">As camadas antigas das partes analisadas e o desenho da camisola são substituídos; emblemas, números e o resto ficam. Podes desfazer com Ctrl+Z.</div>
                <div className="set-row"><div className="grow" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!plan} onClick={apply}>{plan ? `Aplicar (${plan.nColor} + ${plan.nDetail})` : 'Aplicar'}</button></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
