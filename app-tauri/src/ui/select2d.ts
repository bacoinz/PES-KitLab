/**
 * Select / transform tool for the 2D texture view. Layers are edited in their design frame (the upright shirt
 * "front frame", x 664..1384, y 960..1960); clicks on the back, shorts or socks are mapped into that frame.
 * Moves are clamped so a layer's centre always stays inside its part.
 */
import type { OverlayLayer } from '../model/design'
import { resolveGroups } from '../model/design'
import { SEAM, TORSO, partAt } from '../compositor/uv'
import { FRONT_CENTER, FX, FW, PART_FRAMES } from '../compositor/compose'

export type Zone2D = 'front' | 'back' | 'legL' | 'legR' | 'sockL' | 'sockR'
export interface Box { cx: number; cy: number; w: number; h: number; rot: number }
type M = [number, number, number, number, number, number]

const inv = ([a, b, c, d, e, f]: M): M => {
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}
const ap = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** frame → texture for a zone (`textual`: images/text turn 180° on the back, graphics flip vertically) */
function zoneMatrix(z: Zone2D, textual: boolean): M {
  switch (z) {
    case 'front': return [1, 0, 0, 1, 0, 0]
    case 'back': return textual ? [-1, 0, 0, -1, 2048, 2 * SEAM] : [1, 0, 0, -1, 0, 2 * SEAM]
    case 'legL': return PART_FRAMES.shorts[0]
    case 'legR': return PART_FRAMES.shorts[1]
    case 'sockL': return PART_FRAMES.socks[0]
    default: return PART_FRAMES.socks[1]
  }
}

export function zoneAt(x: number, y: number): Zone2D | null {
  const p = partAt(x, y)
  if (p === 'shirt') return x >= TORSO.x0 - 40 && x <= TORSO.x1 + 40 ? (y >= SEAM ? 'front' : 'back') : null
  if (p === 'shorts') return x >= 1024 ? 'legL' : 'legR'
  if (p === 'socks') return x >= 1024 ? 'sockL' : 'sockR'
  return null
}

const partOfZone = (z: Zone2D): OverlayLayer['part'] => (z === 'front' || z === 'back' ? 'torso' : z.startsWith('leg') ? 'shorts' : 'socks')
const tiled = (L: OverlayLayer): boolean => L.kind === 'image' && L.fit === 'tile'
const textual = (L: OverlayLayer): boolean => (L.kind === 'image' && !tiled(L)) || L.kind === 'text'

export function toFrame(z: Zone2D, L: OverlayLayer, x: number, y: number): [number, number] {
  return ap(inv(zoneMatrix(z, textual(L))), x, y)
}

/** Box of a layer in its design frame. `dims` gives image sizes. */
export function layerBox(L: OverlayLayer, dims: (id: string) => { w: number; h: number } | undefined): Box | null {
  const rot = ((L.rotation ?? 0) * Math.PI) / 180, z = (L.zoom ?? 100) / 100, sx = (L.sx ?? 1) * z, sy = (L.sy ?? 1) * z
  if (L.kind === 'image' && !tiled(L)) {
    if (L.fit === 'part') return { cx: 1024 + (L.dx ?? 0), cy: (SEAM + TORSO.hem) / 2 + (L.dy ?? 0), w: FW * sx, h: 1000 * sy, rot }
    const d = (L.assetId && dims(L.assetId)) || { w: 1, h: 1 }
    const box = L.size ?? 300, r = Math.min(box / d.w, box / d.h)
    return { cx: L.x ?? 1024, cy: L.y ?? 1300, w: d.w * r * sx, h: d.h * r * sy, rot }
  }
  if (L.kind === 'vector') return { cx: FRONT_CENTER.x + (L.dx ?? 0), cy: FRONT_CENTER.y + (L.dy ?? 0), w: 400 * sx, h: 400 * sy, rot }
  if (L.kind === 'text') {
    const s = L.size ?? 60
    return { cx: L.x ?? 1024, cy: L.y ?? 1100, w: Math.max(s, (L.text ?? '').length * s * 0.62) * sx, h: s * 1.1 * sy, rot }
  }
  return { cx: FRONT_CENTER.x + (L.dx ?? 0), cy: FRONT_CENTER.y + (L.dy ?? 0), w: FW * sx, h: 1000 * sy, rot }
}

const inside = (b: Box, x: number, y: number): boolean => {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot)
  const lx = (x - b.cx) * c - (y - b.cy) * s, ly = (x - b.cx) * s + (y - b.cy) * c
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2
}

/** Topmost layer under a texture point (precise boxes for images / text first, then full-part designs). */
export function hitLayer(layers: OverlayLayer[], x: number, y: number, dims: (id: string) => { w: number; h: number } | undefined): { L: OverlayLayer; z: Zone2D } | null {
  const z = zoneAt(x, y)
  if (!z) return null
  const part = partOfZone(z)
  const cands = resolveGroups(layers).filter((L) => L.visible && L.kind !== 'panel' && L.kind !== 'freeform' && !(L.kind === 'image' && L.fit === 'uv') && !(L.kind === 'text' && L.placement && !['front', 'back', 'frontBack'].includes(L.placement)) && (L.part === part || (part === 'torso' && L.part === 'shirt')) &&
    (part !== 'torso' || (L.zones ?? ['front', 'back']).includes(z === 'back' ? 'back' : 'front')))
  for (const precise of [true, false]) {
    for (let i = cands.length - 1; i >= 0; i--) {
      const L = cands[i]
      if (precise !== textual(L)) continue
      const b = layerBox(L, dims)
      const [fx, fy] = toFrame(z, L, x, y)
      if (b && inside(b, fx, fy)) return { L, z }
    }
  }
  return null
}

export type Handle = 'move' | 'rotate' | 'nw' | 'ne' | 'sw' | 'se'

/** Corners and rotation handle in TEXTURE px for drawing. */
export function boxOutline(b: Box, z: Zone2D, L: OverlayLayer): { pts: [number, number][]; rot: [number, number] } {
  const m = zoneMatrix(z, textual(L))
  const c = Math.cos(b.rot), s = Math.sin(b.rot)
  const at = (lx: number, ly: number): [number, number] => ap(m, b.cx + lx * c - ly * s, b.cy + lx * s + ly * c)
  return { pts: [at(-b.w / 2, -b.h / 2), at(b.w / 2, -b.h / 2), at(b.w / 2, b.h / 2), at(-b.w / 2, b.h / 2)], rot: at(0, -b.h / 2 - 60) }
}

export function handleAt(b: Box, z: Zone2D, L: OverlayLayer, x: number, y: number, tol: number): Handle | null {
  const o = boxOutline(b, z, L)
  const near = (p: [number, number]): boolean => Math.hypot(p[0] - x, p[1] - y) <= tol
  if (near(o.rot)) return 'rotate'
  const names: Handle[] = ['nw', 'ne', 'se', 'sw']
  for (let i = 0; i < 4; i++) if (near(o.pts[i])) return names[i]
  const [fx, fy] = toFrame(z, L, x, y)
  return inside(b, fx, fy) ? 'move' : null
}

export interface DragStart { L: OverlayLayer; z: Zone2D; h: Handle; fx: number; fy: number; box: Box }

/** New layer values for a drag from `s` to texture point (x, y). */
export function dragTo(s: DragStart, x: number, y: number, shift: boolean): Partial<OverlayLayer> {
  const L = s.L, b = s.box
  const [fx, fy] = toFrame(s.z, L, x, y)
  const freeXY = L.kind === 'text' || (L.kind === 'image' && L.fit !== 'part' && !tiled(L))
  if (s.h === 'move') {
    // keep the centre inside the part
    const cx = Math.max(FX, Math.min(FX + FW, b.cx + fx - s.fx)), cy = Math.max(SEAM, Math.min(SEAM + 1000, b.cy + fy - s.fy))
    if (freeXY) return { x: Math.round(cx), y: Math.round(cy) }
    const base = L.kind === 'image' && !tiled(L) ? { x: 1024, y: (SEAM + TORSO.hem) / 2 } : FRONT_CENTER
    return { dx: Math.round(cx - base.x), dy: Math.round(cy - base.y) }
  }
  if (s.h === 'rotate') {
    const a = Math.atan2(fy - b.cy, fx - b.cx) + Math.PI / 2
    let deg = Math.round((a * 180) / Math.PI)
    if (shift) deg = Math.round(deg / 15) * 15
    if (deg > 180) deg -= 360
    return { rotation: deg }
  }
  // corner: scale about the centre in the box's own axes
  const c = Math.cos(-b.rot), sn = Math.sin(-b.rot)
  const lx = Math.abs((fx - b.cx) * c - (fy - b.cy) * sn), ly = Math.abs((fx - b.cx) * sn + (fy - b.cy) * c)
  let kx = Math.max(0.05, lx / Math.max(1, b.w / 2)), ky = Math.max(0.05, ly / Math.max(1, b.h / 2))
  if (shift) kx = ky = Math.max(kx, ky)
  const sx = (L.sx ?? 1) * kx, sy = (L.sy ?? 1) * ky
  return { sx: Math.round(sx * 100) / 100, sy: Math.round(sy * 100) / 100 }
}
