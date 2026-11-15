/**
 * Number / name textures (_back 2048×256 digits 0-9, _leg 2048×256 digits, _name 2048×512 A-Z + '.').
 * The game reads each glyph from a fixed box, so new glyphs are always drawn into the boxes found in the
 * team's original texture (or a fixed grid when no original exists).
 */
import type { NumbersSpec } from '../model/design'
import { hexToRgb } from '../model/design'
import { canvas, ctx2d } from './images'

export interface Box { x0: number; y0: number; x1: number; y1: number }
export type NumberPart = 'back' | 'leg' | 'name' | 'chest'

const GLYPHS: Record<NumberPart, string[]> = {
  back: '0123456789'.split(''),
  leg: '0123456789'.split(''),
  chest: '0123456789'.split(''),
  name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.'.split('')
}

/** Column-projection segmentation of glyphs in a row band. */
function segmentRow(a: Uint8Array, w: number, y0: number, y1: number): Box[] {
  const col = new Array<number>(w).fill(0)
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (a[y * w + x] > 40) col[x]++
  const boxes: Box[] = []
  let start = -1
  for (let x = 0; x <= w; x++) {
    const on = x < w && col[x] > 0
    if (on && start < 0) start = x
    if (!on && start >= 0) {
      if (x - start > 6) {
        let by0 = y1, by1 = y0
        for (let y = y0; y < y1; y++) for (let xx = start; xx < x; xx++) if (a[y * w + xx] > 40) { if (y < by0) by0 = y; if (y > by1) by1 = y }
        boxes.push({ x0: start, y0: by0, x1: x, y1: by1 + 1 })
      }
      start = -1
    }
  }
  // merge fragments closer than 6px (e.g. glyph parts)
  const merged: Box[] = []
  for (const b of boxes) {
    const m = merged[merged.length - 1]
    if (m && b.x0 - m.x1 < 6) { m.x1 = b.x1; m.y0 = Math.min(m.y0, b.y0); m.y1 = Math.max(m.y1, b.y1) }
    else merged.push({ ...b })
  }
  return merged
}

export function findBoxes(part: NumberPart, img: { width: number; height: number; data: Uint8Array } | null): Box[] {
  const n = GLYPHS[part].length
  if (img) {
    const { width: w, height: h, data } = img
    const a = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) a[i] = data[i * 4 + 3]
    const rows = part === 'name' ? [[0, h / 2], [h / 2, h]] : [[0, h]]
    const boxes = rows.flatMap(([y0, y1]) => segmentRow(a, w, y0, y1))
    if (boxes.length === n) return boxes
  }
  // fallback grid
  const w = 2048, h = part === 'name' ? 512 : 256
  if (part === 'name') {
    return GLYPHS.name.map((_, i) => {
      const r = i < 14 ? 0 : 1, c = i % 14, cw = w / 14
      return { x0: c * cw + 8, y0: r * 256 + 16, x1: (c + 1) * cw - 8, y1: r * 256 + 240 }
    })
  }
  const cw = w / 10
  return GLYPHS[part].map((_, i) => ({ x0: i * cw + 10, y0: 10, x1: (i + 1) * cw - 10, y1: h - 10 }))
}

/** Re-colour an existing number texture: main colour → fill, everything else (outline/shadow) → outline. */
export function recolorNumbers(img: { width: number; height: number; data: Uint8Array }, spec: NumbersSpec): OffscreenCanvas {
  const { width: w, height: h, data } = img
  const hist = new Map<number, number>()
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 200) {
    const k = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4)
    hist.set(k, (hist.get(k) ?? 0) + 1)
  }
  const main = [...hist].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const mr = ((main >> 8) & 15) * 16 + 8, mg = ((main >> 4) & 15) * 16 + 8, mb = (main & 15) * 16 + 8
  const fill = hexToRgb(spec.fill), out = hexToRgb(spec.outline)
  const c = canvas(w, h), g = ctx2d(c)
  const id = g.createImageData(w, h), d = id.data
  for (let i = 0; i < w * h; i++) {
    const q = i * 4
    const dist = Math.abs(data[q] - mr) + Math.abs(data[q + 1] - mg) + Math.abs(data[q + 2] - mb)
    const t = Math.min(1, dist / 120)
    for (let k = 0; k < 3; k++) d[q + k] = fill[k] * (1 - t) + out[k] * t
    d[q + 3] = data[q + 3]
  }
  g.putImageData(id, 0, 0)
  return c
}

let mctx: OffscreenCanvasRenderingContext2D | null = null
const measureCtx = (): OffscreenCanvasRenderingContext2D => (mctx ??= ctx2d(canvas(8, 8)))

/** Draw a new font into the original glyph boxes. */
export function renderNumbers(part: NumberPart, boxes: Box[], spec: NumbersSpec): OffscreenCanvas {
  const w = 2048, h = part === 'name' ? 512 : 256
  const c = canvas(w, h), g = ctx2d(c)
  const chars = GLYPHS[part]
  boxes.forEach((b, i) => {
    const ch = chars[i]
    if (!ch) return
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0
    const tg = measureCtx()
    tg.font = `400px "${spec.font}", "Arial Black", sans-serif`
    tg.textBaseline = 'alphabetic'
    const m = tg.measureText(ch)
    const gw = Math.max(1, Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight))
    const gh = Math.max(1, Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent))
    const pad = spec.outlineWidth * 4
    const glyph = canvas(gw + pad * 2, gh + pad * 2), gg = ctx2d(glyph)
    gg.font = tg.font
    gg.textBaseline = 'alphabetic'
    const ox = pad + m.actualBoundingBoxLeft, oy = pad + m.actualBoundingBoxAscent
    if (spec.outlineWidth > 0) {
      gg.lineJoin = 'round'
      gg.strokeStyle = spec.outline
      gg.lineWidth = spec.outlineWidth * 8
      gg.strokeText(ch, ox, oy)
    }
    gg.fillStyle = spec.fill
    gg.fillText(ch, ox, oy)
    // '.' keeps its own proportions, other glyphs fill the box (the game scales by box)
    if (ch === '.') {
      const s = Math.min(bw / glyph.width, bh / glyph.height)
      g.drawImage(glyph, b.x0 + (bw - glyph.width * s) / 2, b.y1 - glyph.height * s, glyph.width * s, glyph.height * s)
    } else g.drawImage(glyph, b.x0, b.y0, bw, bh)
  })
  return c
}

/**
 * Outline any glyph atlas: a dilated silhouette in `color` behind the glyphs (radius in px of the 2048 atlas).
 * The silhouette is blurred once and thresholded (one pass over the pixels) instead of being stamped hundreds of times
 * round a circle, which took seconds on a 2048 atlas and froze the 3D view while numbers / letters loaded.
 */
export function outlineAtlas(src: OffscreenCanvas, color: string, width: number): OffscreenCanvas {
  if (width <= 0) return src
  const r = Math.max(1, Math.round(width * 2.5))
  const w = src.width, h = src.height
  const bl = canvas(w, h), bg = ctx2d(bl)
  bg.filter = `blur(${Math.max(0.5, r / 2)}px)`
  bg.drawImage(src, 0, 0)
  const id = bg.getImageData(0, 0, w, h), d = id.data
  const [cr, cg, cb] = hexToRgb(color)
  // blur(σ = r/2): the alpha falls to ≈2 % at distance r from a solid edge
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    d[i] = cr; d[i + 1] = cg; d[i + 2] = cb
    d[i + 3] = a <= 3 ? 0 : Math.min(255, (a - 3) * 12)
  }
  const out = canvas(w, h), g = ctx2d(out)
  g.putImageData(id, 0, 0)
  g.drawImage(src, 0, 0)
  return out
}

export const SYSTEM_FONTS = [
  'Arial Black', 'Impact', 'Bahnschrift', 'Bahnschrift SemiBold Condensed', 'Segoe UI Black', 'Franklin Gothic Medium', 'Trebuchet MS',
  'Georgia', 'Rockwell', 'Rockwell Extra Bold', 'Copperplate Gothic Bold', 'Agency FB', 'Haettenschweiler', 'Verdana', 'Tahoma',
  'Consolas', 'Courier New', 'Times New Roman', 'Stencil', 'Showcard Gothic'
]

/** Register a TTF/OTF chosen by the user. Returns the family name. */
export async function registerFont(name: string, bytes: Uint8Array): Promise<string> {
  const ff = new FontFace(name, bytes)
  await ff.load()
  document.fonts.add(ff)
  return name
}
