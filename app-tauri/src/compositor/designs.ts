/**
 * Base designs ("Design base" layers): 26 parametric designs, each with its own settings and colour slots.
 * Drawn in the torso FRONT frame around FRONT_CENTER (the layer transform — size, rotation, offsets, mirrors —
 * is applied before). `col(i)` gives colour slot i (white when the layer is drawn as a mask).
 */
import type { OverlayLayer } from '../model/design'

type G = OffscreenCanvasRenderingContext2D
export type Param = { key: string; label: string; min?: number; max?: number; def: number | boolean | string; options?: [string, string][] }
export interface DesignDef { id: string; label: string; group: string; colors: number; stops?: boolean; params: Param[] }

// the drawing reaches well past the part so rotations never show an edge, and on down the long sleeves (their front
// frame runs ~3200 px)
const CX = 1024, CY = 1400, BIG = 2600
const EDGE: Param = { key: 'edge', label: 'Borda', def: 'straight', options: [['straight', 'Reta'], ['zigzag', 'Zigue-zague'], ['waves', 'Ondas']] }
const MODE: Param = { key: 'mode', label: 'Modo', def: 'noCenter', options: [['noCenter', 'Sem risca central'], ['center', 'Com risca central'], ['offL', 'Desfasado (esq.)'], ['offR', 'Desfasado (dir.)']] }
const shapeParams = (): Param[] => [
  { key: 'outline', label: 'Só o contorno', def: false },
  { key: 'ow', label: 'Espessura do contorno', min: 0, max: 120, def: 0 },
  { key: 'w', label: 'Largura', min: 1, max: 900, def: 150 },
  { key: 'h', label: 'Altura', min: 1, max: 900, def: 200 },
  { key: 'round', label: 'Arredondamento', min: 0, max: 100, def: 0 }
]
const stripesParams = (extra: Param[] = []): Param[] => [
  { key: 'w', label: 'Largura', min: 1, max: 350, def: 50 },
  { key: 'dist', label: 'Distância', min: 0, max: 350, def: 0 },
  { key: 'count', label: 'Contagem (0 = todas)', min: 0, max: 10, def: 0 },
  ...extra, MODE, EDGE
]
const gradParams: Param[] = [{ key: 'smooth', label: 'Suavidade', min: 0, max: 100, def: 100 }, { key: 'revert', label: 'Inverter', def: false }]
const waveParams: Param[] = [
  { key: 'w', label: 'Largura', min: 5, max: 500, def: 100 },
  { key: 'dist', label: 'Distância', min: 0, max: 500, def: 0 },
  { key: 'count', label: 'Contagem', min: 0, max: 10, def: 0 },
  { key: 'depth', label: 'Profundidade', min: -300, max: 300, def: 100 },
  { key: 'steps', label: 'Passos', min: 1, max: 40, def: 2 },
  MODE
]

export const DESIGNS: DesignDef[] = [
  { id: 'rect', label: 'Retângulo', group: 'Formas', colors: 1, params: shapeParams() },
  { id: 'triangle', label: 'Triângulo', group: 'Formas', colors: 1, params: shapeParams() },
  { id: 'circle', label: 'Círculo', group: 'Formas', colors: 1, params: shapeParams() },
  {
    id: 'shapes', label: 'Padrão de formas', group: 'Formas', colors: 1, params: [
      { key: 'shape', label: 'Forma', def: 'circle', options: [['circle', 'Círculo'], ['square', 'Quadrado'], ['triangle', 'Triângulo'], ['diamond', 'Losango'], ['star', 'Estrela'], ['hexagon', 'Hexágono']] },
      { key: 'outline', label: 'Só o contorno', def: false },
      { key: 'ow', label: 'Espessura do contorno', min: 0, max: 120, def: 0 },
      { key: 'w', label: 'Largura da forma', min: 1, max: 800, def: 40 },
      { key: 'h', label: 'Altura da forma', min: 1, max: 800, def: 40 },
      { key: 'round', label: 'Arredondamento', min: 0, max: 100, def: 0 },
      { key: 'srot', label: 'Rotação da forma', min: -180, max: 180, def: 0 },
      { key: 'squeeze', label: 'Achatamento', min: -100, max: 100, def: 0 },
      { key: 'dist', label: 'Distância', min: -50, max: 800, def: 30 },
      { key: 'ratio', label: 'Proporção da distância', min: -100, max: 100, def: 0 },
      { key: 'layout', label: 'Disposição', def: 'offset', options: [['offset', 'Desfasada'], ['voffset', 'Desfasada na vertical'], ['grid', 'Grelha'], ['alt', 'Grelha alternada']] }
    ]
  },
  { id: 'vbands', label: 'Riscas em V (várias cores)', group: 'Riscas', colors: 6, params: [{ key: 'n', label: 'Número de cores', min: 1, max: 6, def: 3 }, { key: 'w', label: 'Largura de cada risca', min: 4, max: 300, def: 45 }, { key: 'gap', label: 'Espaço entre riscas', min: 0, max: 200, def: 0 }, { key: 'y', label: 'Altura', min: -500, max: 900, def: -420 }, { key: 'depth', label: 'Profundidade do V', min: -600, max: 600, def: 180 }] },
  { id: 'hbands', label: 'Faixa horizontal (várias cores)', group: 'Riscas', colors: 6, params: [{ key: 'n', label: 'Número de cores', min: 1, max: 6, def: 3 }, { key: 'w', label: 'Largura de cada risca', min: 4, max: 300, def: 45 }, { key: 'gap', label: 'Espaço entre riscas', min: 0, max: 200, def: 0 }, { key: 'y', label: 'Altura', min: -500, max: 900, def: -200 }, { key: 'depth', label: 'Profundidade do V', min: -600, max: 600, def: 0 }] },
  { id: 'stripe1', label: 'Risca única', group: 'Riscas', colors: 1, params: [{ key: 'w', label: 'Largura', min: 1, max: 900, def: 50 }, EDGE] },
  { id: 'stripeBorder', label: 'Risca com borda', group: 'Riscas', colors: 2, params: [{ key: 'w', label: 'Largura', min: 1, max: 900, def: 50 }, { key: 'bw', label: 'Largura da borda', min: 1, max: 150, def: 10 }, { key: 'dist', label: 'Distância', min: 0, max: 150, def: 0 }, EDGE] },
  { id: 'stripe2c', label: 'Risca de 2 cores', group: 'Riscas', colors: 2, params: [{ key: 'w', label: 'Largura', min: 1, max: 900, def: 50 }, { key: 'dist', label: 'Distância', min: 0, max: 300, def: 0 }, EDGE] },
  { id: 'stripe3c', label: 'Risca de 3 cores', group: 'Riscas', colors: 3, params: [{ key: 'w', label: 'Largura', min: 1, max: 900, def: 50 }, { key: 'f1', label: 'Largura da transição', min: 1, max: 300, def: 100 }, { key: 'dist', label: 'Distância', min: 0, max: 300, def: 0 }, EDGE] },
  { id: 'stripe4c', label: 'Risca de 4 cores', group: 'Riscas', colors: 4, params: [{ key: 'w', label: 'Largura', min: 1, max: 900, def: 50 }, { key: 'f1', label: 'Largura da transição', min: 1, max: 300, def: 100 }, { key: 'd1', label: 'Distância 1', min: 0, max: 300, def: 0 }, { key: 'd2', label: 'Distância 2', min: 0, max: 300, def: 0 }, EDGE] },
  { id: 'stripe5c', label: 'Risca de 5 cores', group: 'Riscas', colors: 5, params: [{ key: 'w', label: 'Largura', min: 1, max: 900, def: 50 }, { key: 'f1', label: 'Largura da transição 1', min: 1, max: 300, def: 100 }, { key: 'f2', label: 'Largura da transição 2', min: 1, max: 300, def: 100 }, { key: 'd1', label: 'Distância 1', min: 0, max: 300, def: 0 }, { key: 'd2', label: 'Distância 2', min: 0, max: 300, def: 0 }, EDGE] },
  { id: 'stripes', label: 'Riscas', group: 'Riscas', colors: 1, params: stripesParams() },
  { id: 'stripes2', label: 'Riscas (2 cores)', group: 'Riscas', colors: 2, params: stripesParams([{ key: 'space', label: 'Espaço entre', def: true }]) },
  { id: 'stripes3', label: 'Riscas (3 cores)', group: 'Riscas', colors: 3, params: stripesParams([{ key: 'space', label: 'Espaço entre', def: true }]) },
  { id: 'stripesSep', label: 'Riscas com separador', group: 'Riscas', colors: 2, params: stripesParams([{ key: 'sw', label: 'Largura do separador', min: 1, max: 100, def: 10 }, { key: 'sd', label: 'Distância do separador', min: -20, max: 100, def: 0 }]) },
  { id: 'gradient', label: 'Degradê', group: 'Degradês', colors: 1, params: gradParams },
  { id: 'multiGradient', label: 'Degradê multicor', group: 'Degradês', colors: 0, stops: true, params: [] },
  { id: 'radial', label: 'Degradê radial', group: 'Degradês', colors: 0, stops: true, params: [{ key: 'cx', label: 'Centro (x)', min: -100, max: 100, def: 0 }, { key: 'cy', label: 'Centro (y)', min: -100, max: 100, def: 0 }, { key: 'r0', label: 'Raio interior', min: 0, max: 100, def: 0 }, { key: 'r1', label: 'Raio exterior', min: 1, max: 200, def: 100 }] },
  { id: 'halftone', label: 'Degradê meio-tom', group: 'Degradês', colors: 1, params: [{ key: 'gsize', label: 'Tamanho do degradê', min: 1, max: 100, def: 50 }, { key: 'lines', label: 'Espessura das linhas', min: 6, max: 80, def: 24 }, { key: 'revert', label: 'Inverter', def: false }] },
  { id: 'halftoneDots', label: 'Degradê meio-tom (pontos)', group: 'Degradês', colors: 1, params: [{ key: 'size', label: 'Tamanho', min: 1, max: 100, def: 100 }, { key: 'el', label: 'Tamanho do elemento', min: 5, max: 32, def: 8 }, { key: 'revert', label: 'Inverter', def: false }, { key: 'shape', label: 'Forma', def: 'circle', options: [['square', 'Quadrado'], ['diamond', 'Losango'], ['circle', 'Círculo'], ['triangle', 'Triângulo']] }] },
  { id: 'stepped', label: 'Degradê em degraus', group: 'Degradês', colors: 1, params: [{ key: 'size', label: 'Tamanho do degrau', min: 10, max: 250, def: 100 }, { key: 'gsize', label: 'Tamanho do degradê', min: 0, max: 100, def: 100 }, { key: 'revert', label: 'Inverter', def: false }] },
  { id: 'checkers', label: 'Xadrez', group: 'Outros', colors: 1, params: [{ key: 'size', label: 'Tamanho', min: 4, max: 500, def: 100 }, { key: 'ratio', label: 'Proporção da largura', min: -90, max: 90, def: 0 }, { key: 'rows', label: 'Linhas (0 = todas)', min: 0, max: 20, def: 0 }, { key: 'cols', label: 'Colunas (0 = todas)', min: 0, max: 20, def: 0 }, { key: 'mode', label: 'Modo', def: 'center', options: [['center', 'Centrado'], ['offL', 'Desfasado (esq.)'], ['offR', 'Desfasado (dir.)']] }] },
  { id: 'zigzag', label: 'Zigue-zague', group: 'Outros', colors: 1, params: waveParams },
  { id: 'waves', label: 'Ondas', group: 'Outros', colors: 1, params: waveParams },
  { id: 'cross', label: 'Cruz', group: 'Outros', colors: 1, params: [{ key: 'w', label: 'Largura', min: 10, max: 500, def: 100 }] },
  { id: 'cross2', label: 'Cruz (2 cores)', group: 'Outros', colors: 2, params: [{ key: 'w', label: 'Largura', min: 10, max: 500, def: 100 }, { key: 'dist', label: 'Distância', min: 0, max: 50, def: 0 }] },
  { id: 'cross2v2', label: 'Cruz (2 cores) v2', group: 'Outros', colors: 2, params: [{ key: 'w', label: 'Largura', min: 10, max: 500, def: 100 }, { key: 'dist', label: 'Distância', min: 0, max: 50, def: 0 }] }
]

export const designDef = (id: string | undefined): DesignDef => DESIGNS.find((d) => d.id === id) ?? DESIGNS[10]
/** Value of a design parameter (layer value or the design's default). */
export function dp<T extends number | boolean | string>(L: OverlayLayer, key: string): T {
  const v = L.p?.[key]
  if (v !== undefined) return v as T
  return (designDef(L.design).params.find((p) => p.key === key)?.def ?? 0) as T
}

const clear = (c: string): string => (/^#[0-9a-f]{6}$/i.test(c) ? c + '00' : 'rgba(255,255,255,0)')
const frac = (v: number): number => v - Math.floor(v)
function edgeOff(edge: string, y: number, w: number): number {
  const amp = Math.max(5, w * 0.18), per = 70
  if (edge === 'zigzag') return amp * (Math.abs(frac(y / per) * 2 - 1) * 2 - 1)
  if (edge === 'waves') return amp * Math.sin((y / per) * Math.PI * 2)
  return 0
}
/** Vertical band x0..x1 (relative to the centre line) over the whole height, edges straight / zigzag / waves. */
function band(g: G, x0: number, x1: number, edge = 'straight', shift: (y: number) => number = () => 0): void {
  if (x1 <= x0) return
  const w = x1 - x0, wavy = edge !== 'straight'
  g.beginPath()
  if (!wavy && shift(0) === 0 && shift(1) === 0) { g.rect(CX + x0, CY - BIG, w, BIG * 2); g.fill(); return }
  for (let y = -BIG; y <= BIG; y += 5) g.lineTo(CX + x0 + shift(y) + edgeOff(edge, y, w), CY + y)
  for (let y = BIG; y >= -BIG; y -= 5) g.lineTo(CX + x1 + shift(y) + edgeOff(edge, y + 35, w), CY + y)
  g.closePath(); g.fill()
}
/** Stripe centres for repeating designs. */
function stripeCenters(period: number, count: number, mode: string): number[] {
  const n = count > 0 ? count : Math.ceil((BIG * 2) / Math.max(4, period)) | 1
  const base = mode === 'center' ? 0 : mode === 'offL' ? -period / 4 : mode === 'offR' ? period / 4 : period / 2
  const out: number[] = []
  if (count > 0) {
    // a symmetric group of `count` stripes
    const start = mode === 'center' ? -((count - 1) / 2) * period : -((count - 1) / 2) * period + (mode === 'noCenter' && count % 2 === 1 ? period / 2 : 0) + (mode === 'offL' ? -period / 4 : mode === 'offR' ? period / 4 : 0)
    for (let i = 0; i < count; i++) out.push(start + i * period)
  } else for (let i = -n; i <= n; i++) out.push(base + i * period)
  return out
}
function shapePath(g: G, kind: string, x: number, y: number, w: number, h: number, round: number): void {
  const r = (Math.min(w, h) / 2) * (round / 100)
  g.beginPath()
  switch (kind) {
    case 'circle': g.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); break
    case 'triangle': g.moveTo(x, y - h / 2); g.lineTo(x + w / 2, y + h / 2); g.lineTo(x - w / 2, y + h / 2); g.closePath(); break
    case 'diamond': g.moveTo(x, y - h / 2); g.lineTo(x + w / 2, y); g.lineTo(x, y + h / 2); g.lineTo(x - w / 2, y); g.closePath(); break
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.45 : 1; g.lineTo(x + Math.cos(a) * (w / 2) * k, y + Math.sin(a) * (h / 2) * k) } g.closePath(); break
    case 'hexagon': for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; g.lineTo(x + Math.cos(a) * w / 2, y + Math.sin(a) * h / 2) } g.closePath(); break
    default: g.roundRect(x - w / 2, y - h / 2, w, h, r)
  }
}
function drawShape(g: G, kind: string, x: number, y: number, w: number, h: number, round: number, outline: boolean, ow = 0, c0?: string, c1?: string): void {
  shapePath(g, kind, x, y, w, h, round)
  // filled in colour 1; the outline (own thickness) in colour 2 ("Cor do contorno"); "Só o contorno" = no fill
  if (!outline) { if (c0) g.fillStyle = c0; g.fill() }
  if (outline || ow > 0) {
    g.lineWidth = ow > 0 ? ow : Math.max(2, Math.min(w, h) * 0.12)
    if (c1) g.strokeStyle = c1
    g.stroke()
  }
}

/** Draw the design. `col(i)` → colour of slot i; `stops` for the gradient designs. */
export function drawDesign(g: G, L: OverlayLayer, col: (i: number) => string, mask: boolean): void {
  const n = (k: string): number => Number(dp<number>(L, k))
  const b = (k: string): boolean => !!dp<boolean>(L, k)
  const s = (k: string): string => String(dp<string>(L, k))
  const fill = (i: number): void => { g.fillStyle = g.strokeStyle = col(i) }
  const id = designDef(L.design).id
  switch (id) {
    case 'rect': case 'triangle': case 'circle':
      fill(0); drawShape(g, id === 'rect' ? 'square' : id, CX, CY, n('w'), n('h'), n('round'), b('outline'), n('ow'), col(0), col(1)); break
    case 'shapes': {
      fill(0)
      const w = n('w'), h = n('h') * (1 - n('squeeze') / 200), d = n('dist'), r = n('ratio') / 100
      const gx = w + d * (1 + r), gy = h + d * (1 - r), layout = s('layout')
      const nx = Math.ceil(BIG / Math.max(4, gx)), ny = Math.ceil(BIG / Math.max(4, gy))
      for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) {
        if (layout === 'alt' && (i + j) % 2) continue
        const x = CX + i * gx + (layout === 'offset' && j % 2 ? gx / 2 : 0), y = CY + j * gy + (layout === 'voffset' && i % 2 ? gy / 2 : 0)
        g.save(); g.translate(x, y); g.rotate((n('srot') * Math.PI) / 180)
        drawShape(g, s('shape'), 0, 0, w, h, n('round'), b('outline'), n('ow'), col(0), col(1))
        g.restore()
      }
      break
    }
    case 'vbands': case 'hbands': {
      // bands of colours stacked down the chest, straight or bent into a V (point in the middle)
      const k = Math.max(1, Math.round(n('n'))), w = n('w'), gap = n('gap'), y0 = CY + n('y'), depth = n('depth')
      for (let i = 0; i < k; i++) {
        const t = y0 + i * (w + gap)
        fill(i)
        g.beginPath()
        // the V spans the shirt's width (half width 330 px), its arms go on at the same slope past the sides
        const e = depth * (1 - BIG / 330)
        g.moveTo(CX - BIG, t + e); g.lineTo(CX, t + depth); g.lineTo(CX + BIG, t + e)
        g.lineTo(CX + BIG, t + e + w); g.lineTo(CX, t + depth + w); g.lineTo(CX - BIG, t + e + w)
        g.closePath(); g.fill()
      }
      break
    }
    case 'stripe1': fill(0); band(g, -n('w') / 2, n('w') / 2, s('edge')); break
    case 'stripeBorder': {
      const w = n('w'), bw = n('bw'), d = n('dist')
      fill(1); band(g, -w / 2 - d - bw, -w / 2 - d, s('edge')); band(g, w / 2 + d, w / 2 + d + bw, s('edge'))
      fill(0); band(g, -w / 2, w / 2, s('edge'))
      break
    }
    case 'stripe2c': case 'stripe3c': case 'stripe4c': case 'stripe5c': {
      const count = designDef(id).colors, w = n('w')
      const widths = [w, ...Array.from({ length: count - 1 }, (_, k) => (w * (k >= 2 && id === 'stripe5c' ? n('f2') : id === 'stripe2c' ? 100 : n('f1'))) / 100)]
      const gaps = Array.from({ length: count - 1 }, (_, k) => (id === 'stripe2c' || id === 'stripe3c' ? n('dist') : k === 0 ? n('d1') : n('d2')))
      fill(0); band(g, -w / 2, w / 2, s('edge'))
      let edge = w / 2
      for (let k = 1; k < count; k++) {
        edge += gaps[k - 1]
        fill(k); band(g, edge, edge + widths[k], s('edge')); band(g, -edge - widths[k], -edge, s('edge'))
        edge += widths[k]
      }
      break
    }
    case 'stripes': case 'stripes2': case 'stripes3': case 'stripesSep': {
      const w = n('w'), cols = Math.max(1, designDef(id).colors - (id === 'stripesSep' ? 1 : 0))
      const spaced = id === 'stripes' || id === 'stripesSep' || b('space')
      const gap = spaced ? (n('dist') || w) : n('dist')
      const centers = stripeCenters(w + gap, n('count'), s('mode'))
      centers.forEach((c, i) => {
        const k = ((i % cols) + cols) % cols
        if (id === 'stripesSep') {
          const sw = n('sw'), sd = n('sd')
          fill(1); band(g, c - w / 2 - sd - sw, c - w / 2 - sd, s('edge')); band(g, c + w / 2 + sd, c + w / 2 + sd + sw, s('edge'))
          fill(0)
        } else fill(k)
        band(g, c - w / 2, c + w / 2, s('edge'))
      })
      break
    }
    case 'gradient': {
      const len = Math.max(1, (1000 * n('smooth')) / 100), c = col(0)
      const gr = g.createLinearGradient(0, CY - len / 2, 0, CY + len / 2)
      gr.addColorStop(0, b('revert') ? clear(c) : c); gr.addColorStop(1, b('revert') ? c : clear(c))
      g.fillStyle = gr; g.fillRect(CX - BIG, CY - BIG, BIG * 2, BIG * 2)
      break
    }
    case 'multiGradient': case 'radial': {
      const st = [...(L.stops ?? [])].sort((a, z) => a.at - z.at)
      if (!st.length) break
      const gr = id === 'radial'
        ? g.createRadialGradient(CX + n('cx') * 3.6, CY + n('cy') * 5, n('r0') * 5, CX + n('cx') * 3.6, CY + n('cy') * 5, Math.max(1, n('r1') * 5))
        : g.createLinearGradient(0, CY - 500, 0, CY + 500)
      for (const x of st) gr.addColorStop(Math.max(0, Math.min(1, x.at / 100)), mask ? '#ffffff' : x.c)
      g.fillStyle = gr; g.fillRect(CX - BIG, CY - BIG, BIG * 2, BIG * 2)
      break
    }
    case 'halftone': {
      fill(0)
      const P = n('lines'), len = Math.max(1, (1000 * n('gsize')) / 100)
      for (let y = -BIG; y < BIG; y += P) {
        let t = Math.max(0, Math.min(1, (y + len / 2) / len))
        if (b('revert')) t = 1 - t
        if (t > 0) g.fillRect(CX - BIG, CY + y + (P * (1 - t)) / 2, BIG * 2, P * t)
      }
      break
    }
    case 'halftoneDots': {
      fill(0)
      const cell = n('el') * 4, k = n('size') / 100
      for (let y = -BIG; y < BIG; y += cell) {
        let t = Math.max(0, Math.min(1, (y + 500) / 1000))
        if (b('revert')) t = 1 - t
        const r = cell * t * k
        if (r < 0.6) continue
        for (let x = -BIG; x < BIG; x += cell) {
          const kind = s('shape') === 'square' ? 'square' : s('shape')
          shapePath(g, kind, CX + x + cell / 2, CY + y + cell / 2, r, r, 0); g.fill()
        }
      }
      break
    }
    case 'stepped': {
      const step = n('size'), len = Math.max(step, (1000 * Math.max(1, n('gsize'))) / 100), steps = Math.max(1, Math.round(len / step)), c = col(0)
      for (let i = 0; i < steps; i++) {
        let a = (i + 1) / steps
        if (b('revert')) a = 1 - i / steps
        g.globalAlpha = a; g.fillStyle = c
        g.fillRect(CX - BIG, CY - len / 2 + i * step, BIG * 2, step)
      }
      g.globalAlpha = 1; g.fillStyle = c
      if (!b('revert')) g.fillRect(CX - BIG, CY + len / 2, BIG * 2, BIG); else g.fillRect(CX - BIG, CY - BIG, BIG * 2, BIG - len / 2)
      break
    }
    case 'checkers': {
      fill(0)
      const size = n('size'), r = n('ratio') / 100, cw = size * (1 + r), ch = size * (1 - r)
      const rows = n('rows'), colsN = n('cols'), mode = s('mode')
      const ox = mode === 'offL' ? -cw / 2 : mode === 'offR' ? cw / 2 : 0
      const ny = rows || Math.ceil(BIG / ch) * 2, nx = colsN || Math.ceil(BIG / cw) * 2
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if ((i + j) % 2) continue
        g.fillRect(CX - (nx * cw) / 2 + ox + i * cw, CY - (ny * ch) / 2 + j * ch, cw, ch)
      }
      break
    }
    case 'zigzag': case 'waves': {
      fill(0)
      const w = n('w'), depth = n('depth'), per = 1000 / Math.max(1, n('steps'))
      const f = (y: number): number => (id === 'zigzag' ? depth * (Math.abs(frac(y / per) * 2 - 1) * 2 - 1) / 2 : (depth / 2) * Math.sin((y / per) * Math.PI * 2))
      for (const c of stripeCenters(w + (n('dist') || w), Math.max(1, n('count') || 1), n('count') ? s('mode') : 'center')) band(g, c - w / 2, c + w / 2, 'straight', f)
      break
    }
    case 'cross': fill(0); g.fillRect(CX - n('w') / 2, CY - BIG, n('w'), BIG * 2); g.fillRect(CX - BIG, CY - n('w') / 2, BIG * 2, n('w')); break
    case 'cross2': case 'cross2v2': {
      const w = n('w'), d = n('dist')
      const vert = (): void => { fill(0); g.fillRect(CX - w / 2, CY - BIG, w, BIG * 2) }
      const hor = (): void => {
        fill(1)
        if (id === 'cross2' && d > 0) { g.fillRect(CX - BIG, CY - w / 2, BIG - w / 2 - d, w); g.fillRect(CX + w / 2 + d, CY - w / 2, BIG, w) } else g.fillRect(CX - BIG, CY - w / 2, BIG * 2, w)
      }
      if (id === 'cross2') { hor(); vert() } else {
        vert()
        if (d > 0) { g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(CX - BIG, CY - w / 2 - d, BIG * 2, w + d * 2); g.restore() }
        hor()
      }
      break
    }
  }
}
