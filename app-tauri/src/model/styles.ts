/**
 * Style generator: a handful of parametric recipes (stripes, hoops, halves, diagonal, 70s retro, classic Italian).
 * A recipe is a template description (`Tpl`) built from a few numbers, so the result is a normal kit with normal,
 * editable layers: nothing is flattened. The seed only picks among the variants a recipe allows ("Surpreende-me").
 * The names describe a look; none copies a specific club's kit.
 */
import type { Tpl } from './templates'
import { D, P } from './templates'

export interface StyleParams { count?: number; width?: number }
export interface StyleDef {
  id: string
  name: string
  /** the "Quantidade" and "Largura" sliders: [label, min, max]; missing = the recipe does not use it */
  count?: [string, number, number]
  width?: [string, number, number]
  build(p: StyleParams, rnd: () => number): Tpl
}

/** Small seeded random numbers: the same seed always gives the same kit. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const int = (rnd: () => number, a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1))
const pick = <T,>(rnd: () => number, l: T[]): T => l[Math.floor(rnd() * l.length)]

export const STYLES: StyleDef[] = [
  {
    id: 'g-stripes', name: 'Riscas verticais', count: ['Quantidade de riscas', 2, 9], width: ['Largura', 25, 65],
    build: (p, r) => {
      const n = p.count ?? pick(r, [3, 5, 7]), w = p.width ?? int(r, 35, 60)
      return { id: 'g-stripes', name: 'Riscas verticais', torso: ['stripes', 'c2', n, w], sleeveColor: r() < 0.4 ? 'c2' : undefined, socks: r() < 0.5 ? ['hoops', 'c2', 2, 40] : ['topBand', 'c2'], collar: pick(r, [30, 66, 12, 1]) }
    }
  },
  {
    id: 'g-hoops', name: 'Bandas horizontais', count: ['Quantidade de bandas', 2, 8], width: ['Largura', 30, 65],
    build: (p, r) => {
      const n = p.count ?? int(r, 3, 6), w = p.width ?? int(r, 40, 58)
      return { id: 'g-hoops', name: 'Bandas horizontais', torso: ['hoops', 'c2', n, w], sleeves: r() < 0.5 ? ['hoops', 'c2', Math.max(2, n - 1), w] : undefined, socks: ['hoops', 'c2', 3, 50], collar: pick(r, [1, 30, 66]) }
    }
  },
  {
    id: 'g-halves', name: 'Metades e quartos', width: undefined,
    build: (_p, r) => {
      const quarters = r() < 0.4
      return { id: 'g-halves', name: 'Metades e quartos', torso: [quarters ? 'quarters' : 'halves', 'c2'], sleeveColor: 'c2', shorts: !quarters && r() < 0.5 ? ['halves', 'c2'] : undefined, socks: ['topBand', 'c2'], collar: pick(r, [30, 66]) }
    }
  },
  {
    id: 'g-diagonal', name: 'Faixa diagonal', count: ['Quantidade de faixas', 1, 8], width: ['Largura', 20, 60],
    build: (p, r) => {
      const many = (p.count ?? 1) > 1 || (p.count === undefined && r() < 0.5)
      const w = p.width ?? (many ? int(r, 20, 38) : int(r, 32, 55))
      if (!many) return { id: 'g-diagonal', name: 'Faixa diagonal', torso: ['sash', 'c2', 1, w], socks: ['topBand', 'c2'], collar: pick(r, [12, 66]) }
      return { id: 'g-diagonal', name: 'Faixa diagonal', layers: [D('diagonal', 'c2', p.count ?? int(r, 3, 7), w, { mirrorCenter: r() < 0.5 })], sleeves: ['end', 'c2'], collar: pick(r, [12, 30]) }
    }
  },
  {
    id: 'g-retro70', name: 'Retro anos 70', count: ['Quantidade de linhas', 6, 20], width: ['Espaçamento', 20, 45],
    build: (p, r) => {
      const n = p.count ?? int(r, 8, 16), w = p.width ?? int(r, 25, 35)
      return { id: 'g-retro70', name: 'Retro anos 70', torso: ['pinstripes', 'c3', n, w], sleeves: ['rings', 'c2', int(r, 2, 3)], socks: ['stripes', 'c2', 2, 40], collar: 1, cuffs: 'c2' }
    }
  },
  {
    id: 'g-classic', name: 'Clássico italiano', width: ['Largura da gola', 30, 80],
    build: (p, r) => {
      const w = p.width ?? int(r, 35, 65)
      return { id: 'g-classic', name: 'Clássico italiano', layers: r() < 0.5 ? [P('neck', 'c2', w), P('shortsHem', 'c2', 40)] : [P('neck', 'c2', w)], sleeves: ['end', 'c2', 1, 15], shorts: ['side', 'c2'], socks: ['topBand', 'c2'], collar: pick(r, [66, 12]), cuffs: 'c2' }
    }
  }
]

export const styleById = (id: string): StyleDef => STYLES.find((s) => s.id === id) ?? STYLES[0]

/** The template description for a style, a seed and the user's own numbers (undefined = let the seed choose). */
export function buildStyle(id: string, seed: number, p: StyleParams = {}): Tpl {
  return styleById(id).build(p, seeded(seed * 7919 + id.length * 131))
}
