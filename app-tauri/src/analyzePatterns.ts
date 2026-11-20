/**
 * Texture analyser, phase B: before a shape of the shirt is drawn as free vector paths, check whether it is one of the
 * kit's own designs: regular vertical stripes, horizontal bands or a half. Those become the normal "pattern" layers
 * (count, stripe width, gap, offset), which are far easier to edit than Bézier shapes.
 *
 * The numbers come straight from the mask: runs of columns (or rows) that are fully covered on the front of the
 * shirt, with the same width and the same gap, and the back of the shirt must agree (it is the same pattern mirrored
 * about the side seams, see drawTorsoPattern in compositor/patterns.ts).
 */
import type { OverlayLayer } from './model/design'
import { uid } from './model/design'

const S = 2048
const SEAM = 960
const X0 = 704, X1 = 1344
/** the collar zone of the texture (y ≥ 1866) is not part of the shirt body */
const BODY_END = 1860
const BACK_AXIS = 951.75
const backY = (y: number): number => 2 * BACK_AXIS - y

const loadImg = (url: string): Promise<HTMLImageElement> => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('máscara inválida')); i.src = url })

/** Alpha of the mask, 2048 × 2048 (1 = inside). */
async function alphaOf(png: string): Promise<Uint8Array> {
  const img = await loadImg(png)
  const c = document.createElement('canvas')
  c.width = S; c.height = S
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, S, S)
  const d = g.getImageData(0, 0, S, S).data
  const a = new Uint8Array(S * S)
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] >= 128 ? 1 : 0
  return a
}

interface Run { s: number; e: number } // [s, e)

/** Runs where `frac[i]` is above one half; columns / rows in between (anti-aliasing) take the side they lean to. */
function runsOf(frac: number[], from: number): Run[] {
  const out: Run[] = []
  let s = -1
  frac.forEach((f, i) => {
    if (f > 0.5 && s < 0) s = i
    if (f <= 0.5 && s >= 0) { out.push({ s: s + from, e: i + from }); s = -1 }
  })
  if (s >= 0) out.push({ s: s + from, e: frac.length + from })
  return out
}
const clean = (frac: number[]): boolean => frac.filter((f) => f > 0.1 && f < 0.9).length <= Math.max(6, frac.length * 0.04)
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)
const same = (v: number[], tol: number): boolean => v.every((x) => Math.abs(x - mean(v)) <= tol)

export interface Recognized { layer: OverlayLayer; kind: 'stripes' | 'hoops' | 'halves'; label: string }

/** Coverage of columns x ∈ [X0, X1) over the rows [y0, y1). */
function colFrac(a: Uint8Array, y0: number, y1: number): number[] {
  const out: number[] = []
  for (let x = X0; x < X1; x++) { let n = 0; for (let y = y0; y < y1; y++) n += a[y * S + x]; out.push(n / (y1 - y0)) }
  return out
}
/** Coverage of rows y ∈ [y0, y1) over the columns [x0, x1). */
function rowFrac(a: Uint8Array, y0: number, y1: number, x0: number, x1: number): number[] {
  const out: number[] = []
  for (let y = y0; y < y1; y++) { let n = 0; for (let x = x0; x < x1; x++) n += a[y * S + x]; out.push(n / (x1 - x0)) }
  return out
}
/** Rows over the two shoulder-wide strips (the neck opening is left out of the middle). */
function rowFracSides(a: Uint8Array, y0: number, y1: number): number[] {
  const l = rowFrac(a, y0, y1, 760, 880), r = rowFrac(a, y0, y1, 1160, 1290)
  return l.map((v, i) => (v * 120 + r[i] * 130) / 250)
}

function base(color: string, name: string): Pick<OverlayLayer, 'id' | 'kind' | 'part' | 'color' | 'visible' | 'opacity' | 'zones' | 'name' | 'width'> {
  return { id: uid(), kind: 'pattern', part: 'torso', color, visible: true, opacity: 1, zones: ['front', 'back'], name, width: 40 }
}

/** The design of a shirt mask when it is regular stripes, bands or a half; null otherwise. */
export async function recognizeTorso(png: string, color: string, label: string): Promise<Recognized | null> {
  const a = await alphaOf(png)
  const name = `${label} · ${color}`

  // ---- half: the right half of the shirt, nothing on the left
  {
    const f = colFrac(a, 1100, BODY_END)
    const left = f.slice(56, 316), right = f.slice(324, 586) // the middle of each half, away from the seams
    if (mean(left) < 0.03 && mean(right) > 0.95 && clean(f.slice(56, 586))) {
      return { kind: 'halves', label: 'Metade', layer: { ...base(color, name), pattern: 'halves', count: 1 } as OverlayLayer }
    }
  }

  // ---- vertical stripes (front rows, checked on the back too)
  {
    const f = colFrac(a, 1000, BODY_END)
    const runs = runsOf(f, X0)
    const cover = runs.reduce((s, r) => s + r.e - r.s, 0)
    if (runs.length >= 1 && runs.length <= 14 && clean(f) && cover < (X1 - X0) * 0.9 && cover > 20) {
      const widths = runs.map((r) => r.e - r.s)
      const gaps = runs.slice(1).map((r, i) => r.s - runs[i].e)
      if (same(widths, 4) && (gaps.length === 0 || same(gaps, 4)) && Math.min(...widths) >= 6) {
        const back = runsOf(colFrac(a, 120, 880), X0)
        const agree = back.length === runs.length && back.every((r, i) => Math.abs(r.s - runs[i].s) <= 4 && Math.abs(r.e - runs[i].e) <= 4)
        if (agree) {
          const sw = Math.round(mean(widths)), gap = gaps.length ? Math.round(mean(gaps)) : 0, n = runs.length
          const total = n * sw + (n - 1) * gap
          const offset = Math.round(runs[0].s - (1024 - total / 2))
          return { kind: 'stripes', label: 'Riscas verticais', layer: { ...base(color, name), pattern: 'stripes', count: n, stripeW: sw, gap, offset } as OverlayLayer }
        }
      }
    }
  }

  // ---- horizontal bands: from the shoulder seam down on the front, mirrored about the side seams on the back
  {
    const y0 = SEAM + 12, y1 = BODY_END
    const f = rowFracSides(a, y0, y1)
    const runs = runsOf(f, y0)
    const cover = runs.reduce((s, r) => s + r.e - r.s, 0)
    if (runs.length >= 1 && runs.length <= 14 && clean(f) && cover < (y1 - y0) * 0.9 && cover > 20) {
      const heights = runs.map((r) => r.e - r.s)
      const gaps = runs.slice(1).map((r, i) => r.s - runs[i].e)
      if (same(heights, 4) && (gaps.length === 0 || same(gaps, 4)) && Math.min(...heights) >= 6) {
        const sh = Math.round(mean(heights)), gap = gaps.length ? Math.round(mean(gaps)) : 0
        const offset = Math.round(runs[0].s - SEAM - 40)
        // the back must have the same bands, mirrored
        const ok = runs.every((r) => {
          const lo = Math.round(backY(r.e)), hi = Math.round(backY(r.s))
          if (lo < 60 || hi > 940) return true // out of the visible back: nothing to compare
          return mean(rowFracSides(a, lo + 2, hi - 2)) > 0.9
        })
        if (ok) return { kind: 'hoops', label: 'Bandas horizontais', layer: { ...base(color, name), pattern: 'hoops', count: runs.length, stripeW: sh, gap, offset } as OverlayLayer }
      }
    }
  }
  return null
}
