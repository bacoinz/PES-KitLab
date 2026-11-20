/** Pure helpers behind the layer keyboard shortcuts (move, size, rotate, reorder). */
import type { OverlayLayer } from '../model/design'
import { normalizeGroups, uid } from '../model/design'
import { layerBox } from './select2d'

type Dims = (id: string) => { w: number; h: number } | undefined

/** Moves the layer `dx, dy` texture px in its design frame (as dragging it on the 2D view does). null = it has no position. */
export function nudgeLayer(L: OverlayLayer, dx: number, dy: number, dims: Dims): Partial<OverlayLayer> | null {
  if (L.kind === 'group') return { dx: (L.dx ?? 0) + dx, dy: (L.dy ?? 0) + dy }
  if (L.kind === 'panel' || L.kind === 'collar' || (L.kind === 'image' && L.fit === 'uv')) return null
  const free = L.kind === 'text' || (L.kind === 'image' && L.fit !== 'part' && L.fit !== 'tile')
  if (free) {
    const b = layerBox(L, dims)
    if (!b) return null
    return { x: Math.round(b.cx + dx), y: Math.round(b.cy + dy) }
  }
  return { dx: (L.dx ?? 0) + dx, dy: (L.dy ?? 0) + dy }
}

/** A copy of the layer (a group with all its members) right above it, with new ids. */
export function duplicateLayer(layers: OverlayLayer[], L: OverlayLayer): OverlayLayer[] {
  const ls = normalizeGroups(layers)
  const i = ls.findIndex((x) => x.id === L.id)
  if (i < 0) return ls
  if (L.kind !== 'group') return [...ls.slice(0, i + 1), { ...L, id: uid() }, ...ls.slice(i + 1)]
  const nid = uid(), members = ls.filter((x) => x.group === L.id)
  const block = [{ ...L, id: nid, name: (L.name ?? 'Grupo') + ' (cópia)' }, ...members.map((m) => ({ ...m, id: uid(), group: nid }))]
  const end = i + members.length + 1
  return [...ls.slice(0, end), ...block, ...ls.slice(end)]
}

/** Overall size ×1.1 (or ÷1.1), 10 … 800 %. */
export function resizeLayer(L: OverlayLayer, grow: boolean): Partial<OverlayLayer> {
  const z = L.zoom ?? 100
  return { zoom: Math.max(10, Math.min(800, Math.round(grow ? z * 1.1 : z / 1.1))) }
}

/** Rotation + 15°, kept in −180 … 180. */
export function rotateLayer(L: OverlayLayer, step = 15): Partial<OverlayLayer> {
  let r = Math.round(((L.rotation ?? 0) + step) % 360)
  if (r > 180) r -= 360
  if (r <= -180) r += 360
  return { rotation: r }
}

/**
 * One place up (`dir` 1 = drawn later, on top) or down in the list, among the layers next to it (same group, same
 * part); a group moves with its members. null = already at the end.
 */
export function reorderLayer(layers: OverlayLayer[], id: string, dir: 1 | -1): OverlayLayer[] | null {
  const ls = normalizeGroups(layers)
  const L = ls.find((l) => l.id === id)
  if (!L) return null
  const sibs = ls.filter((l) => (l.group ?? '') === (L.group ?? '') && l.part === L.part)
  const i = sibs.findIndex((l) => l.id === id)
  const n = sibs[i + dir]
  if (!n) return null
  const blockOf = (x: OverlayLayer): OverlayLayer[] => (x.kind === 'group' ? ls.filter((l) => l.id === x.id || l.group === x.id) : [x])
  const mine = blockOf(L), theirs = blockOf(n)
  const rest = ls.filter((l) => !mine.includes(l))
  const at = dir === 1 ? rest.indexOf(theirs[theirs.length - 1]) + 1 : rest.indexOf(theirs[0])
  return [...rest.slice(0, at), ...mine, ...rest.slice(at)]
}
