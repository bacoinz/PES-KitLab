/**
 * Colour variants of a kit (away / third / alternative): the kit's three main colours (shirt, second and third colour)
 * are swapped for new ones by a harmony rule (inverted, complementary, analogous, triad, darker) and every place that
 * uses them follows: colour slots, layers, collar, cuffs, gradients, outlines. Nothing is repainted pixel by pixel, so
 * the edges stay clean. The kit format is not touched: the roles are the colours the kit already has.
 */
import type { KitDesign } from './design'
import { colorDist, contrastOn, hexToRgb, rgbToHex } from './design'
import { seeded } from './styles'

export interface Variant { id: string; name: string; cols: [string, string, string] }

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255)
}
/** Turns the hue; greys and whites (no saturation) stay as they are. */
export const rotateHue = (hex: string, deg: number): string => { const [h, s, l] = toHsl(hex); return s < 0.08 ? hex : fromHsl((h + deg + 720) % 360, s, l) }
export const darken = (hex: string, by: number): string => { const [h, s, l] = toHsl(hex); return fromHsl(h, s, Math.max(0.04, l * (1 - by))) }

/** Up to seven proposals for the three main colours; `seed` shifts the hue turns a little ("more variants"). */
export function makeVariants(c1: string, c2: string, c3: string, seed: number): Variant[] {
  const r = seeded(seed * 104729 + 7)
  const j = seed === 0 ? 0 : Math.round(r() * 24 - 12)
  const out: Variant[] = [
    { id: 'inverted', name: 'Invertida', cols: [c2, c1, c3] },
    { id: 'complement', name: 'Complementar', cols: [rotateHue(c1, 180 + j), c2, rotateHue(c3, 180 + j)] },
    { id: 'analogPlus', name: 'Análoga (+)', cols: [rotateHue(c1, 35 + j), c2, rotateHue(c3, 35 + j)] },
    { id: 'analogMinus', name: 'Análoga (−)', cols: [rotateHue(c1, -35 + j), c2, rotateHue(c3, -35 + j)] },
    { id: 'triadA', name: 'Tríade A', cols: [rotateHue(c1, 120 + j), c2, rotateHue(c3, 120 + j)] },
    { id: 'triadB', name: 'Tríade B', cols: [rotateHue(c1, 240 + j), c2, rotateHue(c3, 240 + j)] },
    { id: 'darker', name: 'Mais escura', cols: [darken(c1, 0.4), c2, c3] }
  ]
  // drop the ones that came out (almost) like the kit itself, and repeats
  const kept: Variant[] = []
  for (const v of out) {
    const same = colorDist(v.cols[0], c1) < 25 && colorDist(v.cols[1], c2) < 25
    if (!same && !kept.some((k) => colorDist(k.cols[0], v.cols[0]) < 20 && colorDist(k.cols[1], v.cols[1]) < 20)) kept.push(v)
  }
  return kept
}

/** The kit with colours swapped everywhere (a swap of two colours works too: the change is done in one go). */
export function recolorKit(kit: KitDesign, map: Record<string, string>): KitDesign {
  const m = new Map(Object.entries(map).map(([a, b]) => [a.toLowerCase(), b]))
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return /^#[0-9a-f]{6}$/i.test(v) ? m.get(v.toLowerCase()) ?? v : v
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(kit) as KitDesign
}

/** The kit as this variant: its colours swapped, and recolourable numbers set to black or white for the new shirt. */
export function variantKit(kit: KitDesign, v: Variant): KitDesign {
  const [c1, c2, c3] = [kit.colors.shirt, kit.colors.shirt2, kit.colors.shirt3]
  const map: Record<string, string> = { [c1.toLowerCase()]: v.cols[0], [c2.toLowerCase()]: v.cols[1] }
  if (c3.toLowerCase() !== c2.toLowerCase() && c3.toLowerCase() !== c1.toLowerCase()) map[c3.toLowerCase()] = v.cols[2]
  const k = recolorKit(kit, map)
  const n = k.numbers
  const recolorable = n.mode === 'font' || n.mode === 'recolor' || (n.mode === 'file' && n.fileRecolor)
  return recolorable ? { ...k, numbers: { ...n, fill: contrastOn(k.colors.shirt) } } : k
}
