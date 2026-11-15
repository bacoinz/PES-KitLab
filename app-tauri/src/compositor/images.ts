/** Image helpers: asset loading, logo tinting, palette extraction, recolouring and logo cleaning. */
import type { Asset, LogoTint } from '../model/design'
import { hexToRgb, rgbToHex, luminance } from '../model/design'
import { partAt } from './uv'

export type Img = ImageBitmap | HTMLCanvasElement | OffscreenCanvas
const cache = new Map<string, Promise<ImageBitmap>>()

/** Decoded images are cached by content (asset ids like "crest" repeat across teams). */
export function loadAsset(a: Asset): Promise<ImageBitmap> {
  let p = cache.get(a.dataUrl)
  if (!p) {
    // images over 2048 px are decoded at 2048 (the texture size): a 6000 px pattern was 140 MB of memory
    p = fetch(a.dataUrl).then((r) => r.blob()).then(async (b) => {
      const bmp = await createImageBitmap(b)
      const m = Math.max(bmp.width, bmp.height)
      if (m <= 2048) return bmp
      const k = 2048 / m
      const out = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' })
      bmp.close()
      return out
    })
    cache.set(a.dataUrl, p)
    // (previews of a big library would otherwise keep hundreds of bitmaps)
    while (cache.size > 48) cache.delete(cache.keys().next().value!)
  }
  return p
}

export const imgW = (i: Img): number => (i as ImageBitmap).width
export const imgH = (i: Img): number => (i as ImageBitmap).height

export function canvas(w: number, h: number): OffscreenCanvas { return new OffscreenCanvas(w, h) }
export function ctx2d(c: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
}

/** Recolour a logo: original | mono (single colour) | auto (dark on light, white on dark) | white | black. */
export function tintLogo(img: Img, mode: LogoTint, bg: string, color?: string): Img {
  if (mode === 'original') return img
  const c = canvas(imgW(img), imgH(img))
  const g = ctx2d(c)
  g.drawImage(img as CanvasImageSource, 0, 0)
  if (mode === 'bw') {
    // monochrome: keep the logo's detail as greys
    const id = g.getImageData(0, 0, c.width, c.height), d = id.data
    for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y }
    g.putImageData(id, 0, 0)
    return c
  }
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = mode === 'mono' ? color ?? '#ffffff' : mode === 'white' ? '#ffffff' : mode === 'black' ? '#111111' : luminance(bg) > 150 ? '#111111' : '#ffffff'
  g.fillRect(0, 0, c.width, c.height)
  return c
}

/** Remove a flat background (e.g. white JPEG backdrop) by flood-filling from the corners. */
export function removeBackground(img: Img, tolerance = 28): OffscreenCanvas {
  const w = imgW(img), h = imgH(img)
  const c = canvas(w, h), g = ctx2d(c)
  g.drawImage(img as CanvasImageSource, 0, 0)
  const id = g.getImageData(0, 0, w, h), d = id.data
  const seen = new Uint8Array(w * h)
  const stack: number[] = [0, w - 1, (h - 1) * w, h * w - 1]
  const ref = [d[0], d[1], d[2]]
  while (stack.length) {
    const p = stack.pop()!
    if (seen[p]) continue
    seen[p] = 1
    const q = p * 4
    if (Math.abs(d[q] - ref[0]) + Math.abs(d[q + 1] - ref[1]) + Math.abs(d[q + 2] - ref[2]) > tolerance * 3 && d[q + 3] > 10) continue
    d[q + 3] = 0
    const x = p % w, y = (p / w) | 0
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - w)
    if (y < h - 1) stack.push(p + w)
  }
  g.putImageData(id, 0, 0)
  return c
}

/** Crop transparent borders. */
export function trim(img: Img): Img {
  const w = imgW(img), h = imgH(img)
  const c = canvas(w, h), g = ctx2d(c)
  g.drawImage(img as CanvasImageSource, 0, 0)
  const d = g.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) return img
  const o = canvas(x1 - x0 + 1, y1 - y0 + 1)
  ctx2d(o).drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height)
  return o
}

/** Dominant colours (k-means on opaque pixels). */
export function palette(img: Img, k = 4, region?: (x: number, y: number) => boolean): { color: string; share: number }[] {
  const w = imgW(img), h = imgH(img)
  const scale = Math.min(1, 256 / Math.max(w, h))
  const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale))
  const c = canvas(sw, sh), g = ctx2d(c)
  g.drawImage(img as CanvasImageSource, 0, 0, sw, sh)
  const d = g.getImageData(0, 0, sw, sh).data
  const px: number[][] = []
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const q = (y * sw + x) * 4
    if (d[q + 3] < 200) continue
    if (region && !region(x / scale, y / scale)) continue
    px.push([d[q], d[q + 1], d[q + 2]])
  }
  if (!px.length) return []
  let cent = Array.from({ length: k }, (_, i) => px[Math.floor(((i + 0.5) / k) * px.length)].slice())
  const assign = new Array<number>(px.length).fill(0)
  for (let it = 0; it < 10; it++) {
    const sums = cent.map(() => [0, 0, 0, 0])
    px.forEach((p, i) => {
      let b = 0, bd = Infinity
      cent.forEach((c2, j) => { const dd = (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2 + (p[2] - c2[2]) ** 2; if (dd < bd) { bd = dd; b = j } })
      assign[i] = b
      sums[b][0] += p[0]; sums[b][1] += p[1]; sums[b][2] += p[2]; sums[b][3]++
    })
    cent = cent.map((c2, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : c2))
  }
  const counts = cent.map((_, j) => assign.filter((a) => a === j).length)
  const out = cent.map((c2, j) => ({ color: rgbToHex(c2[0], c2[1], c2[2]), share: counts[j] / px.length })).filter((x) => x.share > 0.01)
  // merge near-duplicates
  const merged: { color: string; share: number }[] = []
  for (const p of out.sort((a, b) => b.share - a.share)) {
    const m = merged.find((x) => { const a = hexToRgb(x.color), b = hexToRgb(p.color); return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60 })
    if (m) m.share += p.share
    else merged.push({ ...p })
  }
  return merged
}

/**
 * Shift colours of an image: each pixel moves by (to - from) weighted by its closeness to `from`,
 * so shading, folds and fine fabric detail are kept. `part` limits the change to one kit part.
 */
export function recolor(g: OffscreenCanvasRenderingContext2D, w: number, h: number, maps: { from: string; to: string; part?: string }[]): void {
  if (!maps.length) return
  const id = g.getImageData(0, 0, w, h), d = id.data
  const ms = maps.map((m) => ({ f: hexToRgb(m.from), t: hexToRgb(m.to), part: m.part }))
  const R = 90 // colour radius
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = (y * w + x) * 4
      let dr = 0, dg = 0, db = 0, wsum = 0
      let p: string | null = null
      for (const m of ms) {
        if (m.part) { p ??= partAt((x * 2048) / w, (y * 2048) / h); if (p !== m.part) continue }
        const dist = Math.sqrt((d[q] - m.f[0]) ** 2 + (d[q + 1] - m.f[1]) ** 2 + (d[q + 2] - m.f[2]) ** 2)
        if (dist >= R) continue
        const wt = 1 - dist / R
        dr += (m.t[0] - m.f[0]) * wt; dg += (m.t[1] - m.f[1]) * wt; db += (m.t[2] - m.f[2]) * wt; wsum += wt
      }
      if (!wsum) continue
      const k = Math.min(1, wsum) / wsum
      d[q] += dr * k; d[q + 1] += dg * k; d[q + 2] += db * k
    }
  }
  g.putImageData(id, 0, 0)
}

/**
 * Erase logos inside rectangles by rebuilding the fabric from the edges: if the top and bottom edges match
 * (vertical stripes / plain) the area is filled column by column, otherwise row by row (horizontal hoops).
 */
export function cleanRects(g: OffscreenCanvasRenderingContext2D, rects: [number, number, number, number][], scale = 1): void {
  for (const r of rects) {
    const [x0, y0, x1, y1] = r.map((v) => Math.round(v * scale))
    const w = x1 - x0, h = y1 - y0
    if (w <= 2 || h <= 2) continue
    const id = g.getImageData(x0 - 1, y0 - 1, w + 2, h + 2), d = id.data, W = w + 2
    const at = (x: number, y: number): number => (y * W + x) * 4
    let diffV = 0, diffH = 0
    for (let x = 1; x <= w; x++) for (let c = 0; c < 3; c++) diffV += Math.abs(d[at(x, 0) + c] - d[at(x, h + 1) + c])
    for (let y = 1; y <= h; y++) for (let c = 0; c < 3; c++) diffH += Math.abs(d[at(0, y) + c] - d[at(w + 1, y) + c])
    const vertical = diffV / w <= diffH / h
    for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
      const o = at(x, y)
      for (let c = 0; c < 4; c++) {
        if (vertical) { const t = y / (h + 1); d[o + c] = d[at(x, 0) + c] * (1 - t) + d[at(x, h + 1) + c] * t }
        else { const t = x / (w + 1); d[o + c] = d[at(0, y) + c] * (1 - t) + d[at(w + 1, y) + c] * t }
      }
    }
    g.putImageData(id, x0 - 1, y0 - 1)
  }
}

export async function dataUrlFromBytes(bytes: Uint8Array, mime: string): Promise<string> {
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' })
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob) })
}

export function rgbaToCanvas(img: { width: number; height: number; data: Uint8Array }): OffscreenCanvas {
  const c = canvas(img.width, img.height)
  ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height), 0, 0)
  return c
}

export async function canvasToDataUrl(c: OffscreenCanvas, type = 'image/png'): Promise<string> {
  const b = await c.convertToBlob({ type })
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(b) })
}

export function canvasRgba(c: OffscreenCanvas): Uint8Array {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data
  return new Uint8Array(d.buffer, d.byteOffset, d.length)
}

/**
 * Add a solid outline around a logo. `width` is in texture pixels for a logo drawn into a `box`-sized square,
 * converted here to the image's own pixels.
 */
export function outlineLogo(img: Img, color: string, width: number, box: number): Img {
  const w = imgW(img), h = imgH(img)
  const r = Math.max(w, h) / Math.max(1, box)
  const pad = Math.max(1, Math.ceil(width * r))
  const sil = canvas(w, h), sg = ctx2d(sil)
  sg.drawImage(img as CanvasImageSource, 0, 0)
  sg.globalCompositeOperation = 'source-in'
  sg.fillStyle = color
  sg.fillRect(0, 0, w, h)
  const out = canvas(w + pad * 2, h + pad * 2), g = ctx2d(out)
  const steps = Math.max(16, Math.min(48, pad * 4))
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    g.drawImage(sil, pad + Math.cos(a) * pad, pad + Math.sin(a) * pad)
  }
  for (let rr = pad - 1; rr > 0; rr -= Math.max(1, pad / 3)) for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    g.drawImage(sil, pad + Math.cos(a) * rr, pad + Math.sin(a) * rr)
  }
  g.drawImage(img as CanvasImageSource, pad, pad)
  return out
}
