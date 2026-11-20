/**
 * Texture analyser page: the preview side. After the app core has split the texture, the page needs to answer two
 * things quickly while the user edits: "which colour / detail is under this pixel" (click selection) and "what would
 * the texture look like with these choices" (the right half of the before / after slider). Both come from a label map
 * of the analysis at reduced size (1024 px), not from the full-size layers, so every edit shows up at once.
 */
import type { Asset, OverlayLayer } from './model/design'
import { hexToRgb } from './model/design'
import { PART_LABEL, effColor, regionMasks, type AnalysisEdits, type AnalysisResult, type PartKey } from './analyze'
import { uvVectorCanvas } from './compositor/compose'

export const DETAIL = 255
export const NONE_PART = 255
export const LABEL_SIZE = 1024

export interface Labels {
  n: number
  /** index in `res.parts` or NONE_PART */
  part: Uint8Array
  /** palette index, or DETAIL for the detail cut-out */
  col: Uint8Array
  /** the original at label size */
  orig: Uint8ClampedArray
}

const loadImg = (url: string): Promise<HTMLImageElement> => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagem inválida')); i.src = url })

/** Reads every mask and detail of the analysis into one label map (and the original at the same size). */
export async function buildLabels(res: AnalysisResult, srcUrl: string, n = LABEL_SIZE): Promise<Labels> {
  const c = document.createElement('canvas'); c.width = n; c.height = n
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingEnabled = false
  const part = new Uint8Array(n * n).fill(NONE_PART)
  const col = new Uint8Array(n * n).fill(DETAIL)
  const read = async (url: string, pi: number, color: number): Promise<void> => {
    g.clearRect(0, 0, n, n)
    g.drawImage(await loadImg(url), 0, 0, n, n)
    const d = g.getImageData(0, 0, n, n).data
    for (let i = 0; i < n * n; i++) if (d[i * 4 + 3] >= 128) { part[i] = pi; col[i] = color }
  }
  for (let pi = 0; pi < res.parts.length; pi++) for (const m of res.parts[pi].masks) await read(m.png, pi, m.color)
  for (let pi = 0; pi < res.parts.length; pi++) if (res.parts[pi].detail) await read(res.parts[pi].detail!, pi, DETAIL)
  g.clearRect(0, 0, n, n)
  g.imageSmoothingEnabled = true
  g.drawImage(await loadImg(srcUrl), 0, 0, n, n)
  const orig = new Uint8ClampedArray(g.getImageData(0, 0, n, n).data)
  return { n, part, col, orig }
}

export interface Composed { canvas: HTMLCanvasElement; diff: HTMLCanvasElement; meanDiff: number }

/** The texture as it would come out with these choices, plus the difference to the original (×4). */
export function composeAfter(L: Labels, res: AnalysisResult, e: AnalysisEdits): Composed {
  const n = L.n
  const rgb = res.palette.map((p) => hexToRgb(p.hex))
  const domOf = res.parts.map((p) => (p.dominant !== null ? effColor(e, p.part, p.dominant) : null))
  const base = domOf.map((d) => (d !== null ? rgb[d] : null))
  const rm = regionMasks(e.regions, n, n / res.width)
  const cutD = rm.cut.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, n, n).data
  const keepD = rm.keepAny ? rm.keep.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, n, n).data : null
  const out = new Uint8ClampedArray(n * n * 4)
  const dif = new Uint8ClampedArray(n * n * 4)
  let sum = 0, cnt = 0
  for (let i = 0; i < n * n; i++) {
    const o = i * 4
    const pi = L.part[i]
    let r = L.orig[o], g = L.orig[o + 1], b = L.orig[o + 2]
    if (pi !== NONE_PART) {
      const key = res.parts[pi].part
      if (!e.skipPart[key]) {
        const bs = base[pi] ?? [r, g, b]
        const cl = L.col[i]
        let px: [number, number, number] = bs
        if (cl === DETAIL) { if (!e.noDetail[key]) px = [r, g, b] }
        else { const c = effColor(e, key, cl); if (c !== domOf[pi] && !e.drop[c] && !e.drop[cl] && !e.off[`${key}:${c}`]) px = rgb[c] }
        // regions: what is cut or outside the kept area falls back to the base colour of the part
        if (cutD[o + 3] > 127 || (keepD && keepD[o + 3] <= 127)) px = bs
        ;[r, g, b] = px
      }
      const d = (Math.abs(r - L.orig[o]) + Math.abs(g - L.orig[o + 1]) + Math.abs(b - L.orig[o + 2])) / 3
      sum += d; cnt++
      const v = Math.min(255, d * 4)
      dif[o] = dif[o + 1] = dif[o + 2] = v; dif[o + 3] = 255
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = L.orig[o + 3]
  }
  const mk = (d: Uint8ClampedArray): HTMLCanvasElement => {
    const c = document.createElement('canvas'); c.width = n; c.height = n
    c.getContext('2d')!.putImageData(new ImageData(d, n, n), 0, 0)
    return c
  }
  return { canvas: mk(out), diff: mk(dif), meanDiff: sum / Math.max(1, cnt) }
}

/** A small preview of a set of layers (images tinted with their colour, texture-space vector shapes); null when none can be drawn. */
export async function layersThumb(layers: OverlayLayer[], assets: Record<string, Asset>, size = 192): Promise<string | null> {
  const c = document.createElement('canvas'); c.width = size; c.height = size
  const g = c.getContext('2d')!
  const t = document.createElement('canvas'); t.width = size; t.height = size
  const tg = t.getContext('2d')!
  let drew = false
  for (const L of layers) {
    if (!L.visible) continue
    let src: CanvasImageSource | null = null
    if (L.kind === 'image' && L.assetId && assets[L.assetId]) src = await loadImg(assets[L.assetId].dataUrl)
    else if (L.kind === 'vector' && L.vspace === 'uv' && (L.vpaths ?? []).length) src = uvVectorCanvas(L)
    if (!src) continue
    tg.globalCompositeOperation = 'source-over'
    tg.clearRect(0, 0, size, size)
    tg.drawImage(src, 0, 0, size, size)
    if (L.kind === 'vector' || L.tileTint === 'color') { tg.globalCompositeOperation = 'source-in'; tg.fillStyle = L.color; tg.fillRect(0, 0, size, size) }
    g.globalAlpha = L.opacity ?? 1
    g.drawImage(t, 0, 0)
    drew = true
  }
  g.globalAlpha = 1
  return drew ? c.toDataURL('image/png') : null
}

/** One line of the layer list: a part (its base colour), a colour layer of a part, or the details of a part. */
export interface Row { key: string; kind: 'part' | 'color' | 'detail'; part: PartKey; color?: number; hex: string; name: string; share: number }

/** The rows with the current edits, parts in order: the part, its colour layers (biggest first), its details. */
export function buildRows(res: AnalysisResult, e: AnalysisEdits): Row[] {
  const rows: Row[] = []
  for (const p of res.parts) {
    const dom = p.dominant !== null ? effColor(e, p.part, p.dominant) : null
    const total = p.masks.reduce((s, m) => s + m.area, 0) + p.detailArea || 1
    rows.push({ key: p.part, kind: 'part', part: p.part as PartKey, color: dom ?? undefined, hex: dom !== null ? res.palette[dom].hex : '#808080', name: PART_LABEL[p.part as PartKey], share: 1 })
    const by = new Map<number, number>()
    for (const m of p.masks) { const c = effColor(e, p.part, m.color); if (c !== dom) by.set(c, (by.get(c) ?? 0) + m.area) }
    for (const [c, a] of [...by].sort((x, y) => y[1] - x[1])) rows.push({ key: `${p.part}:${c}`, kind: 'color', part: p.part as PartKey, color: c, hex: res.palette[c].hex, name: `${PART_LABEL[p.part as PartKey]} · ${res.palette[c].hex}`, share: a / total })
    if (p.detail) rows.push({ key: `${p.part}:d`, kind: 'detail', part: p.part as PartKey, hex: '#ffffff', name: `Detalhes · ${PART_LABEL[p.part as PartKey]}`, share: p.detailArea / total })
  }
  return rows
}

/** The row a pixel belongs to (a pixel of the base colour belongs to its part). */
export function rowKeyAt(L: Labels, res: AnalysisResult, e: AnalysisEdits, i: number): string | null {
  const pi = L.part[i]
  if (pi === NONE_PART) return null
  const p = res.parts[pi]
  if (L.col[i] === DETAIL) return `${p.part}:d`
  const c = effColor(e, p.part, L.col[i])
  const dom = p.dominant !== null ? effColor(e, p.part, p.dominant) : null
  return c === dom ? p.part : `${p.part}:${c}`
}

/** A highlight (translucent yellow) over the pixels of the selected rows; a part row highlights the whole part. */
export function highlightCanvas(L: Labels, res: AnalysisResult, e: AnalysisEdits, sel: Set<string>): HTMLCanvasElement | null {
  if (!sel.size) return null
  const n = L.n
  const out = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const pi = L.part[i]
    if (pi === NONE_PART) continue
    const k = rowKeyAt(L, res, e, i)
    if (k && (sel.has(k) || sel.has(res.parts[pi].part))) { out[i * 4] = 255; out[i * 4 + 1] = 210; out[i * 4 + 2] = 0; out[i * 4 + 3] = 150 }
  }
  const c = document.createElement('canvas'); c.width = n; c.height = n
  c.getContext('2d')!.putImageData(new ImageData(out, n, n), 0, 0)
  return c
}
