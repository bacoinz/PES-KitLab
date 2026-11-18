/** The 3D model's mesh laid out in the texture (UV wireframe): shirt, both sleeves, collar, shorts, socks. */
import { S } from './uv'

const cache = new Map<string, Promise<OffscreenCanvas>>()
const SOCKS = 'Asset/model/character/#Win/common_package_fpk/Assets/pes16/model/character/common/socks_long.fmdl'

export function uvWireframe(collar: number, shortsModel: number): Promise<OffscreenCanvas> {
  const key = collar + ':' + shortsModel
  let p = cache.get(key)
  if (!p) { p = build(collar, shortsModel); cache.set(key, p) }
  return p
}

async function build(collar: number, shortsModel: number): Promise<OffscreenCanvas> {
  const names = [
    'nocloth/#Win/shirt_out.fmdl', 'nocloth/#Win/sleeve_short_001.fmdl', 'nocloth/#Win/sleeve_long_001.fmdl',
    `nocloth/#Win/collar_${String(collar).padStart(3, '0')}.fmdl`, `cloth/#Win/pants_${String(shortsModel).padStart(3, '0')}.fmdl`, SOCKS
  ]
  const c = new OffscreenCanvas(S, S), g = c.getContext('2d')!
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.2; g.lineJoin = 'round'
  const seen = new Set<number>()
  for (const n of names) {
    const meshes = await window.kc.readModel(n).catch(() => [])
    for (const m of meshes) {
      g.beginPath()
      const ix = m.indices, uv = m.uvs
      for (let i = 0; i + 2 < ix.length; i += 3) {
        const a = ix[i], b = ix[i + 1], d = ix[i + 2]
        // each triangle edge once per mesh
        for (const [p, q] of [[a, b], [b, d], [d, a]]) {
          const k = Math.min(p, q) * 70000 + Math.max(p, q)
          if (seen.has(k)) continue
          seen.add(k)
          g.moveTo(uv[p * 2] * S, uv[p * 2 + 1] * S); g.lineTo(uv[q * 2] * S, uv[q * 2 + 1] * S)
        }
      }
      g.stroke()
      seen.clear()
    }
  }
  return c
}
