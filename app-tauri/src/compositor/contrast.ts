/**
 * Legibility check for the name and numbers: WCAG contrast ratio between the colour of the print and the kit under it.
 * The kit under it is measured, not guessed: the sample print is drawn on its own (decorationOverlay) and only the
 * texture pixels below its glyphs are looked at, so stripes, patterns and fabrics count. The result is a warning,
 * never a block: many real kits have low contrast on purpose.
 */
import type { KitDesign, NumbersSpec } from '../model/design'
import { colorDist, hexToRgb, rgbToHex } from '../model/design'
import { decorationOverlay, type DecorateInput } from './decorate'

export type CheckPart = 'back' | 'name' | 'chest' | 'leg'
export const CHECK_PARTS: CheckPart[] = ['back', 'name', 'chest', 'leg']
/** Large text (numbers and names are): WCAG asks 3:1. */
export const MIN_CONTRAST = 3

const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
export const relLum = (r: number, g: number, b: number): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export const lumOfHex = (h: string): number => { const [r, g, b] = hexToRgb(h); return relLum(r, g, b) }
export const contrastRatio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

export interface PartCheck {
  part: CheckPart
  /** worst case under the print (the 5 % of the pixels with the least contrast are left out as noise) */
  ratio: number
  ok: boolean
  fg: string // colour that was measured (the outline when the print has one)
  bg: string // average kit colour under the print
  field: 'fill' | 'outline'
  /** the colour settings can be changed here (not for the game's own baked-in numbers) */
  canApply: boolean
  suggest?: string
}

/** Contrast of `fg` against the sampled background luminances: the 5th percentile of the per-pixel ratios. */
export function worstRatio(fgLum: number, bgLums: ArrayLike<number>): number {
  const r = Float64Array.from(bgLums as ArrayLike<number>, (l) => contrastRatio(fgLum, l)).sort()
  return r.length ? r[Math.floor(r.length * 0.05)] : 21
}

/** How the print of a part is coloured (the chest and shorts numbers may have their own look). */
function specFor(n: NumbersSpec, part: CheckPart): { mode: string; fill: string; outline: string; outlineWidth: number } {
  const own = part === 'chest' ? n.chest : part === 'leg' ? n.leg : undefined
  if (own && own.mode !== 'same') return { mode: own.mode, fill: own.fill, outline: own.outline, outlineWidth: own.outlineWidth }
  return { mode: n.mode, fill: n.fill, outline: n.outline, outlineWidth: n.outlineWidth }
}

/**
 * Checks each visible part of the print against the composed kit texture `tex` (RGBA, any square size).
 * `base` is the same input the 3D preview draws its sample name and numbers with.
 */
export function checkContrast(tex: { width: number; height: number; data: Uint8Array }, base: DecorateInput, kit: KitDesign): PartCheck[] {
  const out: PartCheck[] = []
  const cands = [...new Set([...Object.values(kit.colors), '#ffffff', '#000000'].filter((c): c is string => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()))]
  for (const part of CHECK_PARTS) {
    const ov = decorationOverlay({ ...base, only: part })
    const px = ov.getContext('2d')!.getImageData(0, 0, 2048, 2048).data
    const lums: number[] = []
    let n = 0, fr = 0, fg = 0, fb = 0, br = 0, bg = 0, bb = 0, nf = 0
    for (let y = 0; y < 2048; y += 3) {
      const ty = Math.min(tex.height - 1, Math.floor((y / 2048) * tex.height))
      for (let x = 0; x < 2048; x += 3) {
        const a = px[(y * 2048 + x) * 4 + 3]
        if (a < 128) continue
        const ti = (ty * tex.width + Math.min(tex.width - 1, Math.floor((x / 2048) * tex.width))) * 4
        if (tex.data[ti + 3] < 10) continue
        const r = tex.data[ti], g = tex.data[ti + 1], b = tex.data[ti + 2]
        lums.push(relLum(r, g, b)); br += r; bg += g; bb += b; n++
        if (a > 200) { const o = (y * 2048 + x) * 4; fr += px[o]; fg += px[o + 1]; fb += px[o + 2]; nf++ }
      }
    }
    if (n < 30) continue // nothing of this part is on the kit
    const spec = specFor(kit.numbers, part)
    const recolorable = spec.mode === 'font' || spec.mode === 'recolor' || (spec.mode === 'file' && !!kit.numbers.fileRecolor)
    const useOutline = (spec.mode === 'font' || spec.mode === 'recolor') && spec.outlineWidth > 0 && /^#[0-9a-f]{6}$/i.test(spec.outline)
    const fgHex = useOutline ? spec.outline.toLowerCase() : recolorable && /^#[0-9a-f]{6}$/i.test(spec.fill) ? spec.fill.toLowerCase() : rgbToHex(fr / Math.max(1, nf), fg / Math.max(1, nf), fb / Math.max(1, nf))
    const ratio = worstRatio(lumOfHex(fgHex), lums)
    const ok = ratio >= MIN_CONTRAST
    let suggest: string | undefined
    if (!ok && recolorable) {
      const scored = cands.map((c) => ({ c, r: worstRatio(lumOfHex(c), lums) }))
      const pass = scored.filter((s) => s.r >= MIN_CONTRAST).sort((a, b) => colorDist(fgHex, a.c) - colorDist(fgHex, b.c))
      const best = pass[0] ?? scored.sort((a, b) => b.r - a.r)[0]
      if (best && best.r > ratio) suggest = best.c
    }
    out.push({ part, ratio, ok, fg: fgHex, bg: rgbToHex(br / n, bg / n, bb / n), field: useOutline ? 'outline' : 'fill', canApply: recolorable, suggest })
  }
  return out
}

/** The numbers settings with the suggested colour set for that part (on the chest / shorts own look when it has one). */
export function applySuggestion(n: NumbersSpec, c: PartCheck): NumbersSpec {
  if (!c.suggest) return n
  const own = c.part === 'chest' ? n.chest : c.part === 'leg' ? n.leg : undefined
  if (own && own.mode !== 'same') return { ...n, [c.part]: { ...own, [c.field]: c.suggest } } as NumbersSpec
  return { ...n, [c.field]: c.suggest }
}
