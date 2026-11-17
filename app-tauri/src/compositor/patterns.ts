/** Base design patterns for each kit part, drawn in texture space. */
import { SEAM, TORSO, SLEEVE_AXES, LEGS, SHORTS_SIDE_Y, backY } from './uv'
import type { PatternSpec } from '../model/design'

type G = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const TORSO_PATTERNS: [string, string][] = [
  ['none', 'Liso'], ['stripes', 'Riscas verticais'], ['pinstripes', 'Riscas finas'], ['hoops', 'Listas horizontais'],
  ['thinHoops', 'Listas finas'], ['halves', 'Metades'], ['quarters', 'Quartos'], ['sash', 'Faixa diagonal'],
  ['center', 'Faixa central'], ['twin', 'Duas faixas'], ['sides', 'Laterais'], ['sideTape', 'Fita lateral'],
  ['shoulders', 'Ombros'], ['chestBand', 'Faixa no peito'], ['chevron', 'Chevron (V)'], ['gradient', 'Degradê'],
  ['diagonal', 'Riscas diagonais'], ['check', 'Xadrez'], ['halfHoops', 'Listas só à frente'], ['side3', 'Três riscas laterais'],
  ['cross', 'Cruz'], ['bigV', 'V grande'], ['split', 'Corte diagonal'], ['bottom', 'Base de outra cor']
]

/** Same colour, fully transparent (accepts #rgb and #rrggbb). */
const clear = (c: string): string => {
  const h = c.startsWith('#') && c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c
  return /^#[0-9a-f]{6}$/i.test(h) ? h + '00' : 'rgba(0,0,0,0)'
}
const clipRect = (g: G, x: number, y: number, w: number, h: number): void => { g.beginPath(); g.rect(x, y, w, h); g.clip() }

/**
 * Torso patterns are drawn twice: front (y = SEAM + d) and back (y = SEAM - d) so a hoop meets itself at the side seams.
 * Texture x is the same body side on front and back, so vertical designs are drawn once over the whole height.
 */
export function drawTorsoPattern(g: G, p: PatternSpec): void {
  if (!p || p.id === 'none') return
  const { x0: X0, x1: X1, hem: H } = TORSO
  const W = X1 - X0, D = H - SEAM
  const n = Math.max(1, Math.round(p.count || 1))
  const pw = Math.max(5, Math.min(95, p.width || 40)) / 100
  g.save()
  g.fillStyle = p.color
  g.strokeStyle = p.color
  const both = (fn: (sign: 1 | -1) => void): void => {
    g.save(); clipRect(g, 0, SEAM, 2048, 2048 - SEAM); fn(1); g.restore()
    g.save(); clipRect(g, 0, 0, 2048, SEAM); fn(-1); g.restore()
  }
  // back: mirrored about the side-seam axis (see BACK_AXIS) so designs meet at the sides
  const yAt = (d: number, s: 1 | -1): number => (s > 0 ? SEAM + d : backY(SEAM + d))
  // own stripe width + spacing (px): n stripes centred on the torso (vertical) or from the shoulder seam (hoops)
  const custom = p.stripeW && p.stripeW > 0
  switch (custom ? p.id : '') {
    case 'stripes': case 'pinstripes': {
      const sw = p.stripeW!, gap = p.gap ?? sw, total = n * sw + (n - 1) * gap
      const start = 1024 - total / 2 + (p.offset ?? 0)
      for (let i = 0; i < n; i++) g.fillRect(start + i * (sw + gap), 0, sw, 2048)
      g.restore()
      return
    }
    case 'hoops': case 'thinHoops': case 'halfHoops': {
      const sh = p.stripeW!, gap = p.gap ?? sh, off = 40 + (p.offset ?? 0)
      const draw = (s: 1 | -1): void => { for (let i = 0; i < n; i++) { const d = off + i * (sh + gap); g.fillRect(X0 - 40, s > 0 ? yAt(d, s) : yAt(d + sh, s), W + 80, sh) } }
      if (p.id === 'halfHoops') { g.save(); clipRect(g, 0, SEAM, 2048, 2048 - SEAM); draw(1); g.restore() } else both(draw)
      g.restore()
      return
    }
  }
  switch (p.id) {
    case 'stripes': case 'pinstripes': {
      const k = p.id === 'pinstripes' ? Math.max(n, 10) : n * 2 + 1
      const step = W / k
      const sw = p.id === 'pinstripes' ? Math.max(4, step * 0.12 * pw / 0.4) : step
      for (let i = p.id === 'pinstripes' ? 0 : 1; i < k; i += p.id === 'pinstripes' ? 1 : 2) {
        const cx = X0 + step * (i + 0.5)
        g.fillRect(cx - sw / 2, 0, sw, 2048)
      }
      break
    }
    case 'hoops': case 'thinHoops': {
      const k = p.id === 'thinHoops' ? Math.max(n, 8) : n
      const step = D / k, sh = step * pw * (p.id === 'thinHoops' ? 0.6 : 1)
      both((s) => { for (let i = 0; i < k; i++) { const y = yAt(step * (i + 0.5), s); g.fillRect(X0 - 40, y - sh / 2, W + 80, sh) } })
      break
    }
    case 'halfHoops': {
      const step = D / n, sh = step * pw
      for (let i = 0; i < n; i++) g.fillRect(X0 - 40, SEAM + step * (i + 0.5) - sh / 2, W + 80, sh)
      break
    }
    case 'halves': g.fillRect(1024, 0, X1 - 1024 + 40, 2048); break
    case 'quarters': g.fillRect(1024, SEAM, X1 - 1024 + 40, 2048 - SEAM); g.fillRect(X0 - 40, 0, 1024 - X0 + 40, SEAM); break
    case 'sash': {
      const sw = 260 * pw / 0.4
      g.save(); clipRect(g, 0, SEAM, 2048, 2048 - SEAM); g.translate(1024, SEAM + 440); g.rotate(-Math.PI / 4.2); g.fillRect(-1600, -sw / 2, 3200, sw); g.restore()
      g.save(); clipRect(g, 0, 0, 2048, SEAM); g.translate(1024, backY(SEAM + 440)); g.rotate(Math.PI / 4.2); g.fillRect(-1600, -sw / 2, 3200, sw); g.restore()
      break
    }
    case 'center': { const sw = W * 0.28 * pw / 0.4; g.fillRect(1024 - sw / 2, 0, sw, 2048); break }
    case 'twin': { const sw = W * 0.07 * pw / 0.4, gap = W * 0.09; g.fillRect(1024 - gap - sw, 0, sw, 2048); g.fillRect(1024 + gap, 0, sw, 2048); break }
    case 'sides': { const sw = W * 0.16 * pw / 0.4; g.fillRect(X0 - 40, 0, sw + 40, 2048); g.fillRect(X1 - sw, 0, sw + 40, 2048); break }
    case 'sideTape': { const sw = 24 + 60 * pw; g.fillRect(X0 - 20, 0, sw + 20, 2048); g.fillRect(X1 - sw, 0, sw + 20, 2048); break }
    case 'side3': {
      const sw = 10 + 16 * pw, gp = sw * 0.9
      for (const b of [X0 + 2, X1 - 2 - 3 * sw - 2 * gp]) for (let i = 0; i < 3; i++) g.fillRect(b + i * (sw + gp), 0, sw, 2048)
      break
    }
    case 'shoulders': { const sh = D * 0.3 * pw / 0.4; g.fillRect(X0 - 40, SEAM - sh, W + 80, sh * 2); break }
    case 'chestBand': { const sh = D * 0.18 * pw / 0.4; both((s) => g.fillRect(X0 - 40, s > 0 ? SEAM + 170 : backY(SEAM + 170) - sh, W + 80, sh)); break }
    case 'chevron': {
      const sw = 120 * pw / 0.4
      g.save(); clipRect(g, 0, SEAM, 2048, 2048 - SEAM); g.lineWidth = sw; g.lineJoin = 'miter'
      g.beginPath(); g.moveTo(X0 - 40, SEAM + 60); g.lineTo(1024, SEAM + 420); g.lineTo(X1 + 40, SEAM + 60); g.stroke(); g.restore()
      break
    }
    case 'bigV': {
      g.save(); clipRect(g, 0, SEAM, 2048, 2048 - SEAM)
      g.beginPath(); g.moveTo(X0 - 40, SEAM); g.lineTo(1024, SEAM + D * (0.3 + 0.6 * pw)); g.lineTo(X1 + 40, SEAM); g.closePath(); g.fill(); g.restore()
      break
    }
    case 'cross': {
      const sw = W * 0.18 * pw / 0.4
      g.fillRect(1024 - sw / 2, 0, sw, 2048)
      both((s) => g.fillRect(X0 - 40, yAt(D * 0.35, s) - sw / 2, W + 80, sw))
      break
    }
    case 'split': {
      both((s) => { g.beginPath(); g.moveTo(X0 - 40, yAt(D * (1 - pw), s)); g.lineTo(X1 + 40, yAt(D * 0.1, s)); g.lineTo(X1 + 40, yAt(D + 100, s)); g.lineTo(X0 - 40, yAt(D + 100, s)); g.closePath(); g.fill() })
      break
    }
    case 'bottom': { const h = D * pw; both((s) => g.fillRect(X0 - 40, s > 0 ? H - h : backY(H), W + 80, h)); break }
    case 'gradient': {
      both((s) => {
        const gr = g.createLinearGradient(0, yAt(D, s), 0, SEAM)
        gr.addColorStop(0, p.color); gr.addColorStop(Math.max(0.05, Math.min(0.95, pw)), clear(p.color))
        g.fillStyle = gr; g.fillRect(X0 - 40, Math.min(SEAM, yAt(D, s)), W + 80, D)
      })
      break
    }
    case 'diagonal': {
      const step = W / n, sw = step * pw
      both((s) => { g.save(); g.translate(1024, yAt(440, s)); g.rotate(-0.6 * s); for (let i = -n * 3; i < n * 3; i++) g.fillRect(i * step, -1500, sw, 3000); g.restore() })
      break
    }
    case 'check': {
      // rows start at the shoulder seam and run down the front / up the back (mirrored), so they meet at the sides
      const sz = W / Math.max(2, n)
      both((s) => { for (let iy = 0; iy * sz < 1200; iy++) for (let ix = -1; ix * sz < W + sz; ix++) if ((ix + iy) % 2 === 0) g.fillRect(X0 + ix * sz, s > 0 ? SEAM + iy * sz : backY(SEAM + (iy + 1) * sz), sz, sz) })
      break
    }
  }
  g.restore()
}

// ---------------------------------------------------------------- sleeves
export const SLEEVE_PATTERNS: [string, string][] = [
  ['none', 'Liso'], ['top', 'Risca no ombro'], ['three', 'Três riscas'], ['shoulder', 'Ombro de outra cor'],
  ['end', 'Ponta de outra cor'], ['hoops', 'Listas'], ['rings', 'Anéis no punho']
]

export function drawSleevePattern(g: G, p: PatternSpec, raglan = false): void {
  if (!p || p.id === 'none') return
  const n = Math.max(1, p.count || 3), pw = Math.max(5, Math.min(95, p.width || 40)) / 100
  g.save()
  g.fillStyle = p.color
  ;(['short', 'long'] as const).forEach((kind) => SLEEVE_AXES[kind].forEach((r) => {
    const L = r.b - r.a, at = (t: number): number => r.a + L * t
    const X = (t0: number, t1: number): void => { const a = at(t0), b = at(t1); g.fillRect(Math.min(a, b), r.y0, Math.abs(b - a), r.y1 - r.y0) }
    // same width on both sleeves: the long sleeve has the same texel density at the shoulder (it only tapers to the cuff)
    const sw = 80 * pw / 0.4
    const Hz = (y: number, h: number): void => g.fillRect(Math.min(r.a, r.b), y - h / 2, Math.abs(L), h)
    if (p.id === 'hoops') for (let i = 0; i < n; i++) { const c = (i + 0.5) / n, w = pw / n / 2; X(c - w, c + w) }
    else if (p.id === 'top') Hz(r.top, sw)
    else if (p.id === 'three') { const s = sw * 0.45, m = Math.max(1, p.count || 3), step = s + (p.gap ?? s * 0.9); for (let k = 0; k < m; k++) Hz(r.top + (k - (m - 1) / 2) * step, s) }
    else if (p.id === 'shoulder') X(-0.02, 0.22 + 0.5 * pw)
    else if (p.id === 'end') X(1 - (0.15 + 0.5 * pw), 1.05)
    else if (p.id === 'rings') for (let i = 0; i < Math.min(n, 4); i++) { const c = 0.86 - i * 0.08; X(c - 0.025, c + 0.025) }
  }))
  if (raglan) {
    // continue the design over the shoulder up to the neckline (shoulder top = the seam line)
    const sw = 80 * pw / 0.4
    // right across the top of the shirt: the stripes of both shoulders meet behind the collar (no cut at the neck)
    const along = (y: number, h: number): void => { g.fillRect(TORSO.x0 - 60, y - h / 2, TORSO.x1 - TORSO.x0 + 120, h) }
    const TOP = 952 // same line as the sleeve top so stripes run on without a step
    if (p.id === 'top') along(TOP, sw)
    else if (p.id === 'three') { const s = sw * 0.45, m = Math.max(1, p.count || 3), step = s + (p.gap ?? s * 0.9); for (let k = 0; k < m; k++) along(TOP + (k - (m - 1) / 2) * step, s) }
    else if (p.id === 'shoulder') g.fillRect(0, 0, 2048, 2048) // the whole raglan area (clipped by the caller)
  }
  g.restore()
}

// ---------------------------------------------------------------- shorts
export const SHORTS_PATTERNS: [string, string][] = [
  ['none', 'Liso'], ['side', 'Risca lateral'], ['three', 'Três riscas'], ['hem', 'Bainha'], ['waist', 'Cós'],
  ['hoops', 'Listas'], ['halves', 'Pernas diferentes'], ['sidePanel', 'Painel lateral']
]

export function drawShortsPattern(g: G, p: PatternSpec): void {
  if (!p || p.id === 'none') return
  const n = Math.max(1, p.count || 3), pw = Math.max(5, Math.min(95, p.width || 40)) / 100
  const sw = 70 * pw / 0.4
  g.save()
  g.fillStyle = p.color
  for (const L of LEGS) {
    const a = L.x0, w = L.x1 - L.x0
    if (p.id === 'side') g.fillRect(a, SHORTS_SIDE_Y - sw / 2, w, sw)
    else if (p.id === 'three') { const s = sw * 0.4; for (const k of [-1, 0, 1]) g.fillRect(a, SHORTS_SIDE_Y + k * s * 1.9 - s / 2, w, s) }
    else if (p.id === 'sidePanel') g.fillRect(a, SHORTS_SIDE_Y - sw * 1.6, w, sw * 3.2)
    else if (p.id === 'hem') { const hw = 40 + 120 * pw; g.fillRect(L.dir > 0 ? 0 : 2048 - hw - 25, 1160, hw + 25, 804) }
    else if (p.id === 'waist') { const ww = 30 + 80 * pw; g.fillRect(L.dir > 0 ? L.waist - ww : L.waist - 32, 1160, ww + 32, 804) }
    else if (p.id === 'hoops') {
      for (let i = 0; i < n; i++) {
        const t = 0.12 + ((i + 0.5) / n) * 0.7, hw = (0.7 / n) * pw / 2
        const x = L.dir > 0 ? L.hem + 600 * (t - hw) : L.hem - 600 * (t + hw)
        g.fillRect(x, 1160, 600 * 2 * hw, 804)
      }
    } else if (p.id === 'halves' && L.dir < 0) g.fillRect(L.x0, 1160, w, 804)
  }
  g.restore()
}

// ---------------------------------------------------------------- socks
export const SOCKS_PATTERNS: [string, string][] = [
  ['none', 'Lisas'], ['topBand', 'Canhão de outra cor'], ['stripes', 'Riscas no canhão'], ['hoops', 'Listas'],
  ['bottom', 'Parte de baixo de outra cor'], ['vertical', 'Riscas verticais']
]

export function drawSocksPattern(g: G, p: PatternSpec): void {
  if (!p || p.id === 'none') return
  const n = Math.max(1, p.count || 2), pw = Math.max(5, Math.min(95, p.width || 40)) / 100
  g.save()
  g.fillStyle = p.color
  for (const x0 of [0, 1638]) {
    const W = 410, top = 620, H = 540
    if (p.id === 'topBand') g.fillRect(x0, top, W, 104 + 120 * pw)
    else if (p.id === 'stripes') { const sh = 2 + 40 * pw, gap = Math.max(sh, 10); for (let i = 0; i < n; i++) g.fillRect(x0, top + 140 + i * (sh + gap), W, sh) }
    else if (p.id === 'hoops') { const step = H / (n * 2); for (let i = 0; i < n; i++) g.fillRect(x0, top + step * (2 * i + 0.5), W, step * pw * 2) }
    else if (p.id === 'bottom') g.fillRect(x0, top + H * (1 - pw), W, H * pw)
    else if (p.id === 'vertical') { const step = W / (n * 2); for (let i = 0; i < n * 2; i += 2) g.fillRect(x0 + step * (i + 0.5), top, step * pw, H) }
  }
  g.restore()
}

// ---------------------------------------------------------------- overlay textures (subtle tone-on-tone graphics)
export const TEXTURES: [string, string][] = [
  ['dots', 'Pontos'], ['diamonds', 'Losangos'], ['triangles', 'Triângulos'], ['stars', 'Estrelas'], ['hex', 'Favo de mel'],
  ['pinlines', 'Linhas finas'], ['hlines', 'Linhas horizontais'], ['hatch', 'Linhas diagonais'], ['crosshatch', 'Cruzado'],
  ['waves', 'Ondas'], ['zigzag', 'Zigue-zague'], ['grid', 'Grelha'], ['checker', 'Xadrez pequeno'], ['houndstooth', 'Pied-de-poule'],
  ['tartan', 'Tartan'], ['halftone', 'Meio-tom'], ['camo', 'Camuflado'], ['shards', 'Estilhaços'], ['topo', 'Curvas de nível'], ['speed', 'Velocidade']
]

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

/** Fill the rectangle with a repeating texture in the current fill/stroke colour. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot'
export const STROKES: [StrokeStyle, string][] = [['solid', 'Contínuo'], ['dashed', 'Tracejado'], ['dotted', 'Pontilhado'], ['dashdot', 'Traço-ponto']]

export function drawTexture(g: G, t: string, X0: number, Y0: number, X1: number, Y1: number, s: number, stroke: StrokeStyle = 'solid', widthPct = 100, outline = false): void {
  s = Math.max(12, s)
  // shape patterns (dots, stars, checks…): "only the outline" draws them with the line (its type and thickness);
  // filled, a thicker line makes the shapes bolder
  const fill0 = g.fill, fillRect0 = g.fillRect
  const own = g as unknown as { fill: () => void; fillRect: (x: number, y: number, w: number, h: number) => void }
  if (outline) { own.fill = () => g.stroke(); own.fillRect = (x, y, w, h) => g.strokeRect(x, y, w, h) }
  else if (widthPct > 100) {
    const extra = Math.max(1, s * 0.06 * (widthPct - 100) / 100)
    own.fill = () => { (fill0 as unknown as () => void).call(g); const lw = g.lineWidth, ld = g.getLineDash(); g.lineWidth = extra; g.setLineDash([]); g.stroke(); g.lineWidth = lw; g.setLineDash(ld) }
    own.fillRect = (x, y, w, h) => { fillRect0.call(g, x, y, w, h); const lw = g.lineWidth, ld = g.getLineDash(); g.lineWidth = extra; g.setLineDash([]); g.strokeRect(x, y, w, h); g.lineWidth = lw; g.setLineDash(ld) }
  }
  try { drawTextureInner(g, t, X0, Y0, X1, Y1, s, stroke, widthPct) } finally { delete (own as { fill?: unknown }).fill; delete (own as { fillRect?: unknown }).fillRect }
}
function drawTextureInner(g: G, t: string, X0: number, Y0: number, X1: number, Y1: number, s: number, stroke: StrokeStyle, widthPct: number): void {
  const LW = (v: number): number => Math.max(1, (v * widthPct) / 100)
  const d = Math.max(4, s * 0.12)
  g.setLineDash(stroke === 'dashed' ? [d * 2, d * 1.4] : stroke === 'dotted' ? [0.1, d * 1.3] : stroke === 'dashdot' ? [d * 2.2, d, 0.1, d] : [])
  const W = X1 - X0, H = Y1 - Y0, R = rng(1234 + Math.round(s) * 7)
  g.lineWidth = LW(Math.max(3, s * 0.08))
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const cells = (f: (x: number, y: number, ix: number, iy: number) => void): void => {
    for (let iy = 0, y = Y0; y < Y1 + s; y += s, iy++) for (let ix = 0, x = X0; x < X1 + s; x += s, ix++) f(x, y, ix, iy)
  }
  const poly = (pts: number[][], fill = true): void => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); if (fill) g.fill(); else g.stroke() }
  switch (t) {
    case 'dots': cells((x, y, _i, iy) => { g.beginPath(); g.arc(x + (iy % 2 ? s / 2 : 0), y, s * 0.17, 0, 7); g.fill() }); break
    case 'diamonds': cells((x, y) => poly([[x, y - s * 0.4], [x + s * 0.3, y], [x, y + s * 0.4], [x - s * 0.3, y]])); break
    case 'triangles': cells((x, y, ix, iy) => poly([[x, y - s * 0.35], [x + s * 0.35, y + s * 0.3], [x - s * 0.35, y + s * 0.3]], (ix + iy) % 2 === 1)); break
    case 'stars': cells((x, y, _i, iy) => {
      const pts: number[][] = []
      for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.11 : s * 0.26, a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push([x + (iy % 2 ? s / 2 : 0) + r * Math.cos(a), y + r * Math.sin(a)]) }
      poly(pts)
    }); break
    case 'hex': {
      const r = s * 0.55, dx = r * Math.sqrt(3), dy = r * 1.5
      g.lineWidth = LW(Math.max(3, s * 0.06))
      for (let iy = 0, y = Y0; y < Y1 + dy; y += dy, iy++) for (let x = X0 - dx; x < X1 + dx; x += dx) {
        const cx = x + (iy % 2 ? dx / 2 : 0)
        poly(Array.from({ length: 6 }, (_, i) => [cx + r * Math.cos(Math.PI / 6 + (i * Math.PI) / 3), y + r * Math.sin(Math.PI / 6 + (i * Math.PI) / 3)]), false)
      }
      break
    }
    case 'pinlines': g.lineWidth = LW(Math.max(3, s * 0.05)); for (let x = X0; x < X1 + s; x += s / 2) { g.beginPath(); g.moveTo(x, Y0); g.lineTo(x, Y1); g.stroke() } break
    case 'hlines': g.lineWidth = LW(Math.max(3, s * 0.06)); for (let y = Y0; y < Y1 + s; y += s / 2) { g.beginPath(); g.moveTo(X0, y); g.lineTo(X1, y); g.stroke() } break
    case 'hatch': case 'crosshatch':
      g.lineWidth = LW(Math.max(3, s * 0.06))
      for (let k = -H; k < W + H; k += s / 2) {
        g.beginPath(); g.moveTo(X0 + k, Y1); g.lineTo(X0 + k + H, Y0); g.stroke()
        if (t === 'crosshatch') { g.beginPath(); g.moveTo(X0 + k, Y0); g.lineTo(X0 + k + H, Y1); g.stroke() }
      }
      break
    case 'waves': cells((x, y) => { g.beginPath(); g.moveTo(x - s / 2, y); g.quadraticCurveTo(x - s / 4, y - s * 0.3, x, y); g.quadraticCurveTo(x + s / 4, y + s * 0.3, x + s / 2, y); g.stroke() }); break
    case 'zigzag': cells((x, y) => { g.beginPath(); g.moveTo(x - s / 2, y); g.lineTo(x - s / 4, y - s * 0.25); g.lineTo(x, y); g.lineTo(x + s / 4, y - s * 0.25); g.lineTo(x + s / 2, y); g.stroke() }); break
    case 'grid': g.lineWidth = LW(Math.max(3, s * 0.05)); cells((x, y) => g.strokeRect(x - s / 2, y - s / 2, s, s)); break
    case 'checker': { const q = s / 2; for (let iy = 0, y = Y0; y < Y1; y += q, iy++) for (let ix = 0, x = X0; x < X1; x += q, ix++) if ((ix + iy) % 2) g.fillRect(x, y, q, q); break }
    case 'houndstooth': { const q = s / 2; cells((x, y) => { g.fillRect(x, y, q, q); poly([[x + q, y], [x + s, y - q], [x + s, y]]); poly([[x, y + q], [x - q, y + s], [x, y + s]]) }); break }
    case 'tartan': {
      const b = s * 0.32
      for (let x = X0; x < X1 + s * 2; x += s * 2) { g.fillRect(x, Y0, b, H); g.fillRect(x + s, Y0, b * 0.25, H) }
      for (let y = Y0; y < Y1 + s * 2; y += s * 2) { g.fillRect(X0, y, W, b); g.fillRect(X0, y + s, W, b * 0.25) }
      break
    }
    case 'halftone': {
      const step = s * 0.55
      for (let y = Y0; y < Y1 + step; y += step) {
        const k = Math.max(0, 1 - (y - Y0) / H)
        if (k < 0.04) continue
        for (let x = X0; x < X1 + step; x += step) { g.beginPath(); g.arc(x + (Math.round(y / step) % 2 ? step / 2 : 0), y, step * 0.48 * k, 0, 7); g.fill() }
      }
      break
    }
    case 'camo': cells((x, y) => { const r = R(); g.beginPath(); g.ellipse(x + r * s, y + R() * s, s * (0.3 + r * 0.5), s * (0.2 + R() * 0.4), r * 3, 0, 7); g.fill() }); break
    case 'shards': cells((x, y) => { if (R() < 0.45) return; poly([[x + R() * s, y + R() * s], [x + R() * s, y + R() * s], [x + R() * s, y + R() * s]]) }); break
    case 'topo': {
      g.lineWidth = LW(Math.max(3, s * 0.05))
      const n = Math.max(2, Math.round((W * H) / (s * s * 30)))
      for (let i = 0; i < n; i++) {
        const cx = X0 + R() * W, cy = Y0 + R() * H, ph = R() * 6
        for (let r = s * 0.4; r < s * 4; r += s * 0.4) {
          g.beginPath()
          for (let k = 0; k <= 48; k++) {
            const a = (k / 48) * Math.PI * 2, rr = r * (1 + 0.18 * Math.sin(a * 3 + ph) + 0.08 * Math.sin(a * 5 + ph * 2))
            if (k) g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); else g.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
          }
          g.stroke()
        }
      }
      break
    }
    case 'speed': { const n = Math.round(H / (s * 0.35)); for (let i = 0; i < n; i++) g.fillRect(X0 + R() * W, Y0 + R() * H, s * (1.5 + R() * 4), Math.max(3, s * (0.03 + R() * 0.08))); break }
  }
}
