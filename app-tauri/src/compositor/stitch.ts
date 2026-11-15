/**
 * Stitching along the edge of a layer's shape ("Costura" in the layer panel): the shape's coverage is blurred once and
 * traced at an iso level (marching squares), which gives a smooth line a few px inside or outside the edge; the
 * line is then drawn as stitches (dashes, double row, dots, solid, zig-zag, cross stitch) with a shadow and a light
 * thread so it reads on light and dark colours.
 */
import type { StitchSpec } from '../model/design'

const R = 1024 // tracing resolution (the texture is 2048²: every traced unit = 2 texture px)
type Line = [number, number][]

/** Iso-lines of a scalar field (w × h, values 0..255) at `level`, joined into polylines (in field units). */
function trace(f: Uint8ClampedArray | Uint8Array, w: number, h: number, level: number, stride = 4, off = 3): Line[] {
  const v = (x: number, y: number): number => f[(y * w + x) * stride + off]
  // each segment joins two cell edges: edge ids h(x,y) = horizontal edge from (x,y), v(x,y) = vertical edge
  const pt = new Map<number, [number, number]>()
  const adj = new Map<number, number[]>()
  const H = (x: number, y: number): number => (y * (w + 1) + x) * 2, V = (x: number, y: number): number => (y * (w + 1) + x) * 2 + 1
  const link = (a: number, b: number): void => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a) }
  const at = (id: number, x0: number, y0: number, a: number, b: number, horiz: boolean): number => {
    if (!pt.has(id)) { const t = (level - a) / (b - a || 1); pt.set(id, horiz ? [x0 + t, y0] : [x0, y0 + t]) }
    return id
  }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1)
    const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0)
    if (k === 0 || k === 15) continue
    const top = (): number => at(H(x, y), x, y, a, b, true)
    const right = (): number => at(V(x + 1, y), x + 1, y, b, c, false)
    const bottom = (): number => at(H(x, y + 1), x, y + 1, d, c, true)
    const left = (): number => at(V(x, y), x, y, a, d, false)
    switch (k) {
      case 1: case 14: link(left(), bottom()); break
      case 2: case 13: link(bottom(), right()); break
      case 3: case 12: link(left(), right()); break
      case 4: case 11: link(top(), right()); break
      case 6: case 9: link(top(), bottom()); break
      case 7: case 8: link(left(), top()); break
      case 5: link(left(), top()); link(bottom(), right()); break
      case 10: link(left(), bottom()); link(top(), right()); break
    }
  }
  // walk the chains
  const used = new Set<number>()
  const lines: Line[] = []
  const walk = (start: number): Line => {
    const out: Line = [pt.get(start)!]
    used.add(start)
    let cur = start
    for (;;) {
      const next = (adj.get(cur) ?? []).find((n) => !used.has(n))
      if (next === undefined) break
      used.add(next); out.push(pt.get(next)!); cur = next
    }
    return out
  }
  // open chains first (start at ends), then the closed loops
  for (const [id, n] of adj) if (n.length === 1 && !used.has(id)) lines.push(walk(id))
  for (const id of adj.keys()) if (!used.has(id)) { const l = walk(id); l.push(l[0]); lines.push(l) }
  return lines.filter((l) => l.length > 3)
}

/** Light smoothing (the traced line follows the pixel grid). */
function smooth(l: Line): Line {
  if (l.length < 5) return l
  const closed = l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]
  return l.map((p, i) => {
    if (!closed && (i === 0 || i === l.length - 1)) return p
    const a = l[(i - 1 + l.length) % l.length], b = l[(i + 1) % l.length]
    return [(a[0] + p[0] * 2 + b[0]) / 4, (a[1] + p[1] * 2 + b[1]) / 4]
  })
}

/** Points every `step` px along a line, with the unit normal at each. */
function resample(l: Line, step: number): { x: number; y: number; nx: number; ny: number; tx: number; ty: number }[] {
  const out: { x: number; y: number; nx: number; ny: number; tx: number; ty: number }[] = []
  let carry = 0
  for (let i = 1; i < l.length; i++) {
    const [x0, y0] = l[i - 1], [x1, y1] = l[i]
    const len = Math.hypot(x1 - x0, y1 - y0)
    if (!len) continue
    const tx = (x1 - x0) / len, ty = (y1 - y0) / len
    for (let d = carry; d < len; d += step) out.push({ x: x0 + tx * d, y: y0 + ty * d, nx: -ty, ny: tx, tx, ty })
    carry = (carry - len) % step
    if (carry < 0) carry += step
  }
  return out
}

/**
 * Stitches for one coverage image (white / opaque = the layer). Returns a transparent 2048² canvas with the stitches,
 * or null when the shape has no edge.
 */
export function stitchCanvas(cov: OffscreenCanvas, sp: StitchSpec): OffscreenCanvas | null {
  const k = Math.max(0.3, (sp.scale ?? 100) / 100)
  // distance of the stitch line from the edge (texture px) → blur and iso level
  const dist = 9 * k
  const sigma = Math.max(1.2, dist / 2 / 0.84) // in tracing units (2 px)
  const small = new OffscreenCanvas(R, R), g = small.getContext('2d', { willReadFrequently: true })!
  g.filter = `blur(${sigma}px)`
  g.drawImage(cov, 0, 0, R, R)
  const data = g.getImageData(0, 0, R, R).data
  // coverage = alpha (the caller hands in white on transparent)
  const f = new Uint8ClampedArray(R * R)
  for (let i = 3, j = 0; i < data.length; i += 4, j++) f[j] = data[i]
  // inside: iso above the edge (0.5) / outside: below it; offset ≈ 0.84 σ
  // centred: on the edge itself (a double row straddles it)
  const lvl = (o: number): number => Math.round(255 * (sp.side === 'center' ? 0.5 + 0.3 * o : sp.side === 'out' ? 0.5 - 0.3 * o : 0.5 + 0.3 * o))
  const rows = sp.side === 'center' ? (sp.kind === 'double' ? [-0.45, 0.45] : [0]) : sp.kind === 'double' ? [0.55, 1.15] : [1]
  const lines = rows.flatMap((o) => trace(f, R, R, lvl(o), 1, 0).map(smooth).map((l) => l.map(([x, y]) => [x * 2, y * 2] as [number, number])))
  if (!lines.length) return null
  const out = new OffscreenCanvas(2048, 2048), c = out.getContext('2d')!
  c.lineCap = 'round'; c.lineJoin = 'round'
  const thread = sp.color
  const pathOf = (l: Line, dx = 0, dy = 0): void => { c.beginPath(); l.forEach(([x, y], i) => (i ? c.lineTo(x + dx, y + dy) : c.moveTo(x + dx, y + dy))) }
  // shadow under the thread, then the thread (own colour or a soft light), slightly up-left
  const layer = (draw: (dx: number, dy: number) => void): void => {
    c.strokeStyle = c.fillStyle = 'rgba(0,0,0,0.55)'; draw(1.2 * k, 1.2 * k)
    c.strokeStyle = c.fillStyle = thread ?? 'rgba(255,255,255,0.55)'; draw(0, 0)
  }
  const w = 2.6 * k
  for (const l of lines) {
    switch (sp.kind) {
      case 'zigzag': {
        const pts = resample(l, 5 * k)
        layer((dx, dy) => { c.lineWidth = w * 0.8; c.setLineDash([]); c.beginPath(); pts.forEach((p, i) => { const a = (i % 2 ? 1 : -1) * 3.5 * k; const x = p.x + p.nx * a + dx, y = p.y + p.ny * a + dy; if (i) c.lineTo(x, y); else c.moveTo(x, y) }); c.stroke() })
        break
      }
      case 'cross': {
        const pts = resample(l, 9 * k)
        layer((dx, dy) => {
          c.lineWidth = w * 0.7; c.setLineDash([]); c.beginPath()
          for (const p of pts) {
            const s = 3 * k
            for (const sg of [1, -1]) { const ux = (p.tx + p.nx * sg) * s, uy = (p.ty + p.ny * sg) * s; c.moveTo(p.x - ux + dx, p.y - uy + dy); c.lineTo(p.x + ux + dx, p.y + uy + dy) }
          }
          c.stroke()
        })
        break
      }
      default: {
        const dash = sp.kind === 'dotted' ? [0.01, 7 * k] : sp.kind === 'solid' ? [] : [9 * k, 6 * k]
        layer((dx, dy) => { c.lineWidth = sp.kind === 'dotted' ? w * 1.3 : w; c.setLineDash(dash); pathOf(l, dx, dy); c.stroke() })
      }
    }
  }
  return out
}
