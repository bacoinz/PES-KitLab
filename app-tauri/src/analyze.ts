/**
 * Texture analyser (UI side). The app core (game/analyze.rs) splits a kit texture into flat colour masks per kit part
 * and a detail cut-out per part; this module turns the user's choices in the review screen into normal editable
 * layers: one image layer per colour and part (a mask painted in one colour, so it can be recoloured, hidden and
 * reordered), one "detail" layer per part with the original pixels, and the base colours of each part.
 */
import type { Asset, KitDesign, OverlayLayer, VPath } from './model/design'
import { NONE, uid } from './model/design'
import { recognizeTorso } from './analyzePatterns'

export type PartKey = 'torso' | 'sleeves' | 'shorts' | 'socks'
export interface AnalysisMask { color: number; area: number; png: string }
export interface AnalysisPart { part: PartKey; dominant: number | null; masks: AnalysisMask[]; detail: string | null; detailArea: number }
export interface AnalysisResult {
  width: number
  palette: { hex: string; share: number }[]
  parts: AnalysisPart[]
  recomposed: string
  diff: string
  meanDiff: number
}

/** What the user decided in the review: colours merged into others or dropped, detail kept or not. */
/** A selection made on the texture: `cut` takes what is inside out of the layers, `keep` keeps only what is inside. */
export interface Region { mode: 'cut' | 'keep'; pts: [number, number][] }

export interface AnalysisEdits {
  /** palette index → index it is merged into (the mask joins that colour) */
  merge: Record<number, number>
  drop: Record<number, boolean>
  noDetail: Record<string, boolean>
  /** parts left alone (the kit keeps what it has there) */
  skipPart: Record<string, boolean>
  /** selections drawn on the texture (texture px) */
  regions: Region[]
  /** per part: palette index → index it becomes in that part only (merging layers / parts) */
  pm: Record<string, Record<number, number>>
  /** colour layers switched off, keyed `part:colour` (colour = the palette index the layer ends up with) */
  off: Record<string, boolean>
}
export const noEdits = (): AnalysisEdits => ({ merge: {}, drop: {}, noDetail: {}, skipPart: {}, regions: [], pm: {}, off: {} })

export const PART_LABEL: Record<PartKey, string> = { torso: 'Camisola', sleeves: 'Mangas', shorts: 'Calções', socks: 'Meias' }

/** The colour a palette entry ends up as (following merges; a merge into a merged colour follows through). */
export function repOf(i: number, merge: Record<number, number>): number {
  let c = i
  for (let k = 0; k < 20 && merge[c] !== undefined && merge[c] !== c; k++) c = merge[c]
  return c
}

/** The colour a palette entry ends up as in one part: that part's own merges first, then the global ones. */
export function effColor(e: AnalysisEdits, part: string, c: number): number {
  return repOf(repOf(c, e.pm[part] ?? {}), e.merge)
}

const loadImg = (url: string): Promise<HTMLImageElement> => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('máscara inválida')); i.src = url })

/** Joins several masks (white where the colour is) into one PNG. */
async function unionPng(pngs: string[], size: number): Promise<string> {
  if (pngs.length === 1) return pngs[0]
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const g = c.getContext('2d')!
  for (const p of pngs) g.drawImage(await loadImg(p), 0, 0)
  return c.toDataURL('image/png')
}

const polyPath = (g: CanvasRenderingContext2D, pts: [number, number][], k = 1): void => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); g.closePath() }

/** Paints the regions as two masks (alpha): what is cut, and what is kept (`keepAny` = there is a keep region). */
export function regionMasks(regions: Region[], size: number, k = 1): { cut: HTMLCanvasElement; keep: HTMLCanvasElement; keepAny: boolean } {
  const mk = (mode: Region['mode']): HTMLCanvasElement => {
    const c = document.createElement('canvas'); c.width = size; c.height = size
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    for (const r of regions) if (r.mode === mode && r.pts.length > 2) { polyPath(g, r.pts, k); g.fill() }
    return c
  }
  return { cut: mk('cut'), keep: mk('keep'), keepAny: regions.some((r) => r.mode === 'keep' && r.pts.length > 2) }
}

/** The mask / detail PNG with the regions applied; null when nothing is left. */
async function clipPng(png: string, regions: Region[], size: number): Promise<string | null> {
  if (!regions.length) return png
  const img = await loadImg(png)
  const c = document.createElement('canvas'); c.width = size; c.height = size
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  const m = regionMasks(regions, size)
  g.globalCompositeOperation = 'destination-out'; g.drawImage(m.cut, 0, 0)
  if (m.keepAny) { g.globalCompositeOperation = 'destination-in'; g.drawImage(m.keep, 0, 0) }
  g.globalCompositeOperation = 'source-over'
  const d = new Uint32Array(g.getImageData(0, 0, size, size).data.buffer)
  let any = false
  for (let i = 0; i < d.length; i += 3) if (d[i] >>> 24) { any = true; break }
  if (!any) for (let i = 0; i < d.length; i++) if (d[i] >>> 24) { any = true; break }
  return any ? c.toDataURL('image/png') : null
}

export interface PlannedLayer { layer: OverlayLayer; asset?: Asset }

/** Phase B options: turn shirt stripes / bands / halves into the kit's own designs, and masks into vector shapes. */
export interface PlanOpts { recognize?: boolean; vector?: boolean; tolerance?: number }

const vecCache = new Map<string, VPath[]>()
function hashOf(s: string): string { let h = 5381; for (let i = 0; i < s.length; i += 7) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ':' + h }
/** The mask (PNG) as closed Bézier paths in texture px (app core, game/vectorize.rs); tolerance in px. */
export async function vectorizeMask(png: string, tolerance = 2): Promise<VPath[]> {
  const key = tolerance + '|' + hashOf(png)
  const hit = vecCache.get(key)
  if (hit) return hit
  const r = (await window.kc.vectorizeMask(png, { tolerance })) as { paths: VPath[] }
  if (vecCache.size > 60) vecCache.clear()
  vecCache.set(key, r.paths)
  return r.paths
}

/** The layer as a vector layer in texture space (same place in the list, same colour). */
export function vectorLayerFrom(L: OverlayLayer, paths: VPath[]): OverlayLayer {
  return { id: L.id, kind: 'vector', part: L.part, vspace: 'uv', vpaths: paths, color: L.color, fill: L.fill, visible: L.visible, opacity: L.opacity, blend: L.blend, name: (L.name ?? 'Cor') + ' · vetor' }
}

/** Texture-space paths as the pen editor wants them (unit box, shapes filling it) and the way back. */
export function uvToUnit(paths: VPath[]): { paths: VPath[]; back: (p: VPath[]) => VPath[] } {
  const xs: number[] = [], ys: number[] = []
  for (const p of paths) for (const q of p.pts) { xs.push(q.x); ys.push(q.y) }
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 1024, cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 1024
  const size = Math.max(60, xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 2048) * 1.15
  const map = (p: VPath[], fx: (v: number) => number, fy: (v: number) => number): VPath[] => p.map((q) => ({
    closed: q.closed,
    pts: q.pts.map((t) => ({ x: fx(t.x), y: fy(t.y), ...(t.ix !== undefined ? { ix: fx(t.ix), iy: fy(t.iy!) } : {}), ...(t.ox !== undefined ? { ox: fx(t.ox), oy: fy(t.oy!) } : {}) }))
  }))
  return { paths: map(paths, (x) => (x - cx) / size, (y) => (y - cy) / size), back: (p) => map(p, (x) => Math.round((x * size + cx) * 10) / 10, (y) => Math.round((y * size + cy) * 10) / 10) }
}
export interface Plan {
  layers: PlannedLayer[]
  /** base colour of each part */
  colors: Partial<Record<PartKey, string>>
  /** how many colour layers / detail layers (colour layers include the recognised and the vector ones) */
  nColor: number
  nDetail: number
  nPattern: number
  nVector: number
}

/** The layers and base colours the review would apply with these edits. */
export async function planLayers(r: AnalysisResult, e: AnalysisEdits, o: PlanOpts = {}): Promise<Plan> {
  const layers: PlannedLayer[] = []
  const colors: Partial<Record<PartKey, string>> = {}
  let nColor = 0, nDetail = 0, nPattern = 0, nVector = 0
  for (const p of r.parts) {
    if (e.skipPart[p.part]) continue
    const dom = p.dominant !== null ? effColor(e, p.part, p.dominant) : null
    if (dom !== null) colors[p.part] = r.palette[dom].hex
    // masks grouped by the colour they end up as; the base colour and dropped colours need no layer
    const groups = new Map<number, AnalysisMask[]>()
    for (const m of p.masks) {
      const c = effColor(e, p.part, m.color)
      if (c === dom || e.drop[c] || e.drop[m.color] || e.off[`${p.part}:${c}`]) continue
      groups.set(c, [...(groups.get(c) ?? []), m])
    }
    for (const [c, ms] of [...groups].sort((a, b) => b[1].reduce((s, m) => s + m.area, 0) - a[1].reduce((s, m) => s + m.area, 0))) {
      const hex = r.palette[c].hex
      const whole = await unionPng(ms.map((m) => m.png), r.width)
      const png = await clipPng(whole, e.regions, r.width)
      if (!png) continue
      const id = uid() + 'm'
      const name = `${PART_LABEL[p.part]} · ${hex}`
      // regular stripes, bands and halves of the shirt are the kit's own designs
      if (o.recognize && p.part === 'torso') {
        const rec = await recognizeTorso(png, hex, PART_LABEL.torso)
        if (rec) { layers.push({ layer: rec.layer }); nColor++; nPattern++; continue }
      }
      const img: OverlayLayer = { id: uid(), kind: 'image', part: p.part, assetId: id, fit: 'uv', tileTint: 'color', color: hex, visible: true, opacity: 1, name }
      if (o.vector) {
        const paths = await vectorizeMask(png, o.tolerance ?? 2)
        if (paths.length) { layers.push({ layer: vectorLayerFrom(img, paths) }); nColor++; nVector++; continue }
      }
      layers.push({ asset: { id, name, dataUrl: png, w: r.width, h: r.width }, layer: img })
      nColor++
    }
  }
  // details go on top of the colours
  for (const p of r.parts) {
    if (e.skipPart[p.part] || e.noDetail[p.part] || !p.detail) continue
    const id = uid() + 'd'
    const name = `Detalhes · ${PART_LABEL[p.part]}`
    const det = await clipPng(p.detail, e.regions, r.width)
    if (!det) continue
    layers.push({
      asset: { id, name, dataUrl: det, w: r.width, h: r.width },
      layer: { id: uid(), kind: 'image', part: p.part, assetId: id, fit: 'uv', visible: true, opacity: 1, color: '#ffffff', name }
    })
    nDetail++
  }
  return { layers, colors, nColor, nDetail, nPattern, nVector }
}

/**
 * The kit with the analysis applied: a plain template base (no old torso design), the base colour of each part, and the
 * new layers. Logos, numbers, collar and the rest of the settings stay. Parts the user skipped keep their old layers.
 */
export function applyPlan(kit: KitDesign, plan: Plan, e: AnalysisEdits): KitDesign {
  const skipped = (part: OverlayLayer['part']): boolean => !!e.skipPart[part === 'shirt' ? 'torso' : part]
  const keep = kit.layers.filter((l) => skipped(l.part))
  const c = plan.colors
  const colors = { ...kit.colors }
  if (c.torso) { colors.shirt = c.torso; colors.collar = c.torso }
  if (c.sleeves) { colors.sleeves = c.sleeves; colors.cuffs = c.sleeves }
  if (c.shorts) colors.shorts = c.shorts
  if (c.socks) colors.socks = c.socks
  return {
    ...kit,
    base: { kind: 'template' },
    templateId: undefined,
    colors,
    fills: {},
    torso: { ...NONE },
    sleevePattern: e.skipPart.sleeves ? kit.sleevePattern : { ...NONE },
    shortsPattern: e.skipPart.shorts ? kit.shortsPattern : { ...NONE },
    socksPattern: e.skipPart.socks ? kit.socksPattern : { ...NONE },
    socksColor2: e.skipPart.socks ? kit.socksColor2 : undefined,
    layers: [...plan.layers.map((p) => p.layer), ...keep]
  }
}

// exposed for scripted verification runs (KC_SCRIPT)
;(window as unknown as { __kcAnalyze: object }).__kcAnalyze = { planLayers, regionMasks, applyPlan, noEdits, vectorizeMask, recognizeTorso }
