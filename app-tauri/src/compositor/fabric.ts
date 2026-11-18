/** Fabric textures and stitched seams (built-in) â€“ drawn on top of the kit with multiply / soft-light. */
import { SEAM, TORSO } from './uv'

type G = OffscreenCanvasRenderingContext2D

export const FABRICS: [string, string][] = [
  ['seams', 'Costuras'], ['knit', 'Malha fina'], ['mesh', 'Malha furada'], ['pique', 'Piqué'], ['rib', 'Canelado'],
  ['jacquard', 'Jacquard diagonal'], ['honeycomb', 'Favo (dri-fit)'], ['twill', 'Sarja']
]

/** Fabric types a layer can have ("Tecido"): the knit fabrics plus the stretchy ones used on collars, cuffs and socks. */
export const LAYER_FABRICS: [string, string][] = [
  ['knit', 'Malha fina'], ['mesh', 'Malha furada'], ['pique', 'Piqué'], ['rib', 'Canelado'], ['ribfine', 'Canelado fino (elástico)'], ['elastic', 'Elástico de gola / punho'],
  ['jacquard', 'Jacquard diagonal'], ['honeycomb', 'Favo (dri-fit)'], ['twill', 'Sarja']
]
/** Embroidery textures for badges, brands, sponsors, images and text. */
export const EMBROIDERIES: [string, string][] = [['satin', 'Cetim (linhas)'], ['tatami', 'Tatami (preenchimento)'], ['cross', 'Ponto cruz'], ['chain', 'Ponto corrente']]
/** How a texture is laid over a layer: opacity and blend (the tiles are neutral grey, 128 = no change). */
export const TEXTURE_LOOK: Record<string, { opacity: number; blend: GlobalCompositeOperation }> = {
  knit: { opacity: 0.4, blend: 'source-over' }, mesh: { opacity: 0.5, blend: 'source-over' }, pique: { opacity: 0.5, blend: 'source-over' }, rib: { opacity: 0.6, blend: 'source-over' },
  ribfine: { opacity: 0.7, blend: 'source-over' }, elastic: { opacity: 0.8, blend: 'source-over' }, jacquard: { opacity: 0.5, blend: 'source-over' }, honeycomb: { opacity: 0.5, blend: 'source-over' }, twill: { opacity: 0.5, blend: 'source-over' },
  satin: { opacity: 0.85, blend: 'source-over' }, tatami: { opacity: 0.85, blend: 'source-over' }, cross: { opacity: 0.85, blend: 'source-over' }, chain: { opacity: 0.85, blend: 'source-over' }
}

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
  } else if (id === 'ribfine' || id === 'elastic') {
    // stretchy rib: thin vertical ribs (elastic = deeper, with a 1×1 purl line between them)
    const st = id === 'elastic' ? 3 : 2
    for (let x = 0; x < n; x += st * 2) {
      g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x, 0, st * 0.6, n)
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x + st, 0, st * 0.7, n)
    }
    if (id === 'elastic') for (let y = 0; y < n; y += 4) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, y, n, 1) }
  } else if (id === 'satin') {
    // long parallel threads (along x); the angle option turns them
    for (let y = 0; y < n; y += 3) {
      const gr = g.createLinearGradient(0, y, 0, y + 3)
      gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.65)')
      g.fillStyle = gr; g.fillRect(0, y, n, 3)
    }
  } else if (id === 'tatami') {
    // fill stitch: rows of short threads in a brick pattern
    for (let y = 0, r = 0; y < n; y += 4, r++) for (let x = (r % 3) * 6; x < n + 18; x += 18) {
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y + 3, 17, 1)
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x, y, 17, 2)
    }
  } else if (id === 'cross') {
    for (let y = 0; y < n; y += 4) for (let x = 0; x < n; x += 4) {
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 4); g.stroke()
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(x + 4, y); g.lineTo(x, y + 4); g.stroke()
    }
  } else if (id === 'chain') {
    for (let y = 0, r = 0; y < n; y += 5, r++) for (let x = (r % 2) * 3; x < n; x += 6) {
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y + 4); g.lineTo(x + 6, y); g.stroke()
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(x + 0.5, y + 1.4); g.lineTo(x + 3, y + 4.8); g.lineTo(x + 5.5, y + 1.4); g.stroke()
    }
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

const reliefs = new Map<string, OffscreenCanvas>()
/**
 * The tile as relief on transparent (dark threads black, light ones white, by how far from the neutral grey): drawn
 * normally it shows on any colour, which soft-light / overlay lose on pure white or black.
 */
function reliefTile(id: string): OffscreenCanvas {
  const hit = reliefs.get(id)
  if (hit) return hit
  const src = fabricTile(id), n = src.width
  const c = new OffscreenCanvas(n, n), g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(src, 0, 0)
  const im = g.getImageData(0, 0, n, n), d = im.data
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] - 128) / 128
    d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : 255
    d[i + 3] = Math.min(255, Math.round(Math.abs(v) * 255))
  }
  g.putImageData(im, 0, 0)
  reliefs.set(id, c)
  return c
}

/** A built-in texture tile repeated over the whole texture (scale %, angle degrees), on a canvas. */
export function texturePaint(id: string, scale: number, angle: number): OffscreenCanvas {
  const c = new OffscreenCanvas(2048, 2048), g = c.getContext('2d')!
  const pat = g.createPattern(reliefTile(id), 'repeat')
  if (!pat) return c
  const s = Math.max(0.1, scale / 100)
  pat.setTransform(new DOMMatrix().rotate(angle).scale(s, s))
  g.fillStyle = pat
  g.fillRect(0, 0, 2048, 2048)
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
