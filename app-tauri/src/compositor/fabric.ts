/** Fabric textures and stitched seams (built-in) â€“ drawn on top of the kit with multiply / soft-light. */
import { SEAM, TORSO } from './uv'

type G = OffscreenCanvasRenderingContext2D

export const FABRICS: [string, string][] = [
  ['seams', 'Costuras'], ['knit', 'Malha fina'], ['mesh', 'Malha furada'], ['pique', 'Piqué'], ['rib', 'Canelado'],
  ['jacquard', 'Jacquard diagonal'], ['honeycomb', 'Favo (dri-fit)'], ['twill', 'Sarja']
]

const tiles = new Map<string, OffscreenCanvas>()

/** Small seamless tiles on a neutral grey (128 = no change in soft-light / overlay). */
export function fabricTile(id: string): OffscreenCanvas {
  const hit = tiles.get(id)
  if (hit) return hit
  const n = 64
  const c = new OffscreenCanvas(n, n)
  const g = c.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, n, n)
  const dark = 'rgba(0,0,0,0.55)', light = 'rgba(255,255,255,0.45)'
  if (id === 'knit') {
    for (let y = 0; y < n; y += 4) for (let x = 0; x < n; x += 4) {
      g.fillStyle = (x / 4 + y / 4) % 2 ? dark : light
      g.fillRect(x, y, 2, 3)
    }
  } else if (id === 'mesh') {
    for (let y = 0; y < n; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < n; x += 8) {
      g.fillStyle = dark; g.beginPath(); g.arc(x + 2, y + 2, 1.8, 0, 7); g.fill()
      g.fillStyle = light; g.beginPath(); g.arc(x + 2.6, y + 2.6, 0.8, 0, 7); g.fill()
    }
  } else if (id === 'pique') {
    for (let y = 0; y < n; y += 6) for (let x = 0; x < n; x += 6) { g.fillStyle = dark; g.fillRect(x, y, 3, 3); g.fillStyle = light; g.fillRect(x + 3, y + 3, 2, 2) }
  } else if (id === 'rib') {
    for (let x = 0; x < n; x += 4) { g.fillStyle = dark; g.fillRect(x, 0, 1.5, n); g.fillStyle = light; g.fillRect(x + 2, 0, 1, n) }
  } else if (id === 'jacquard' || id === 'twill') {
    const step = id === 'twill' ? 6 : 16
    g.lineWidth = id === 'twill' ? 1.6 : 5
    for (let k = -n; k < n * 2; k += step) {
      g.strokeStyle = dark; g.beginPath(); g.moveTo(k, 0); g.lineTo(k + n, n); g.stroke()
      g.strokeStyle = light; g.beginPath(); g.moveTo(k + step / 2, 0); g.lineTo(k + step / 2 + n, n); g.stroke()
    }
  } else if (id === 'honeycomb') {
    const r = 5, dx = r * Math.sqrt(3)
    g.strokeStyle = dark; g.lineWidth = 1.2
    for (let y = 0, row = 0; y < n + r; y += r * 1.5, row++) for (let x = row % 2 ? dx / 2 : 0; x < n + dx; x += dx) {
      g.beginPath()
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) }
      g.closePath(); g.stroke()
    }
  }
  tiles.set(id, c)
  return c
}

/** Repeat a tile (built-in id or a user image) over the whole texture. */
export function drawFabric(g: G, src: string | CanvasImageSource, scale: number): void {
  const img = typeof src === 'string' ? fabricTile(src) : src
  const pat = g.createPattern(img as CanvasImageSource, 'repeat')
  if (!pat) return
  const s = Math.max(0.1, scale / 100)
  pat.setTransform(new DOMMatrix().scale(s, s))
  g.fillStyle = pat
  g.fillRect(0, 0, 2048, 2048)
}

/** Stitched seams where the real garment has them (side seams, shoulders, hems, cuffs, shorts, socks). */
export function drawSeams(g: G, zones: { front: boolean; back: boolean; sleeves: boolean; shorts?: boolean; socks?: boolean }): void {
  const line = (pts: [number, number][], w = 7): void => {
    g.save()
    g.lineCap = 'round'
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = w
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke()
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.setLineDash([9, 7])
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + 6, y + 6) : g.moveTo(x + 6, y + 6))); g.stroke()
    g.restore()
  }
  const X0 = TORSO.x0, X1 = TORSO.x1
  if (zones.front) {
    line([[X0 + 10, SEAM + 4], [X0 + 10, 1860]]); line([[X1 - 10, SEAM + 4], [X1 - 10, 1860]]) // side seams
    line([[X0, 1840], [X1, 1840]], 5) // hem
    line([[X0, SEAM + 8], [X1, SEAM + 8]], 5) // shoulder
  }
  if (zones.back) {
    line([[X0 + 10, SEAM - 4], [X0 + 10, 60]]); line([[X1 - 10, SEAM - 4], [X1 - 10, 60]])
    line([[X0, 80], [X1, 80]], 5)
    line([[X0, SEAM - 8], [X1, SEAM - 8]], 5)
  }
  if (zones.sleeves) {
    for (const x of [500, 1548]) line([[x, 690], [x, 1212]], 5) // short sleeve cuff
    for (const x of [698, 1350]) line([[x, 690], [x, 1212]], 6) // armhole
    for (const x of [20, 2028]) line([[x, 132], [x, 630]], 5) // long sleeve cuff (stops before the socks at y 640)
  }
  // shorts: hems, side seams; socks: top band
  if (zones.shorts) {
    for (const x of [40, 2008]) line([[x, 1164], [x, 1960]], 5)
    for (const [a, b] of [[0, 672], [1376, 2048]]) line([[a, 1590], [b, 1590]], 4)
  }
  if (zones.socks) for (const x0 of [0, 1638]) line([[x0, 726], [x0 + 410, 726]], 5)
}
