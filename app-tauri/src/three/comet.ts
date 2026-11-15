/**
 * Kit models from the CometKITpreviewer template (converted to GLB, see public/models/models.json). Same UV layout as
 * the game: shirt normal/tight (in/out), short/long sleeves (normal/Kappa, with/without captain armband), PC collars
 * 1–133, shorts body + side panel 1–16, socks.
 */
import * as THREE from 'three'

export interface CometEntry { name: string; file: string; smooth: string | null; kind: string; id: number | null; tris: number }

let index: Promise<CometEntry[] | null> | null = null
export function cometIndex(): Promise<CometEntry[] | null> {
  index ??= fetch('/models/models.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
  return index
}

const geoCache = new Map<string, Promise<THREE.BufferGeometry | null>>()

/** Minimal GLB reader for our own exports: POSITION, NORMAL, TEXCOORD_0 + indices. */
export function loadGlb(file: string): Promise<THREE.BufferGeometry | null> {
  let p = geoCache.get(file)
  if (!p) {
    p = fetch('/models/' + file).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => {
      if (!b) return null
      const dv = new DataView(b)
      const jl = dv.getUint32(12, true)
      const j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, jl)))
      const bin = 20 + jl + 8
      const acc = (i: number): Float32Array | Uint16Array | Uint32Array => {
        const a = j.accessors[i], v = j.bufferViews[a.bufferView]
        const n = a.count * ({ VEC3: 3, VEC2: 2, SCALAR: 1 } as Record<string, number>)[a.type]
        const off = bin + (v.byteOffset ?? 0)
        if (a.componentType === 5126) return new Float32Array(b.slice(off, off + n * 4))
        if (a.componentType === 5123) return new Uint16Array(b.slice(off, off + n * 2))
        return new Uint32Array(b.slice(off, off + n * 4))
      }
      const prim = j.meshes[0].primitives[0]
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(acc(prim.attributes.POSITION), 3))
      g.setAttribute('normal', new THREE.BufferAttribute(acc(prim.attributes.NORMAL), 3))
      g.setAttribute('uv', new THREE.BufferAttribute(acc(prim.attributes.TEXCOORD_0), 2))
      g.setIndex(new THREE.BufferAttribute(acc(prim.indices), 1))
      return g
    }).catch(() => null)
    geoCache.set(file, p)
  }
  return p
}

/** The collar model file used for a collar id (the requested one, or the nearest the template has) and its UV box. */
export async function collarModel(id: number): Promise<{ file: string; box: [number, number, number, number] } | null> {
  const idx = await cometIndex()
  if (!idx) return null
  const cs = idx.filter((e) => e.kind === 'collar_pc' && e.id != null)
  if (!cs.length) return null
  const e = cs.reduce((best, c) => (Math.abs(c.id! - id) < Math.abs(best.id! - id) ? c : best), cs[0])
  return { file: e.file, box: (e as unknown as { uvBox: [number, number, number, number] }).uvBox }
}

const fitted = new Map<string, Promise<THREE.BufferGeometry | null>>()
/**
 * The collar model for the 3D view with its chest part (flaps / lining, UV y < 1860) re-mapped: each of those
 * vertices samples the shirt texel straight behind it. The 2D texture stays exactly as the game uses it; only the
 * preview model is adjusted so the flaps show the shirt design where they sit.
 */
export function collarFitted(collarFile: string, shirtFile: string): Promise<THREE.BufferGeometry | null> {
  const key = collarFile + '|' + shirtFile
  let p = fitted.get(key)
  if (!p) {
    p = Promise.all([loadGlb(collarFile), loadGlb(shirtFile)]).then(([cg, sg]) => {
      if (!cg || !sg) return null
      const cp = cg.getAttribute('position').array as Float32Array, cu = cg.getAttribute('uv').array as Float32Array
      const sp = sg.getAttribute('position').array as Float32Array, su = sg.getAttribute('uv').array as Float32Array, si = sg.getIndex()!.array
      // shirt triangles near the neck only
      const tris: number[] = []
      for (let t = 0; t < si.length; t += 3) { const y = sp[si[t] * 3 + 1]; if (y > 1.25) tris.push(t) }
      const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      const P = (arr: Float32Array, i: number): number[] => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]]
      // closest point on a triangle → barycentric (Ericson, Real-Time Collision Detection)
      const closest = (p: number[], a: number[], b: number[], c: number[]): [number, number, number, number] => {
        const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
        const d1 = dot(ab, ap), d2 = dot(ac, ap)
        let u: number, v: number, w: number
        if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0 } else {
          const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp)
          if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0 } else {
            const vc = d1 * d4 - d3 * d2
            if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0 } else {
              const cp2 = sub(p, c), d5 = dot(ab, cp2), d6 = dot(ac, cp2)
              if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1 } else {
                const vb = d5 * d2 - d1 * d6
                if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t } else {
                  const va = d3 * d6 - d5 * d4
                  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + (d5 - d6)); u = 0; v = 1 - t; w = t } else {
                    const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w
                  }
                }
              }
            }
          }
        }
        const q = [a[0] * u + b[0] * v + c[0] * w, a[1] * u + b[1] * v + c[1] * w, a[2] * u + b[2] * v + c[2] * w]
        const d = sub(p, q)
        return [dot(d, d), u, v, w]
      }
      // a smooth (linear) map position → shirt UV fitted on the shirt's own front / back around the neck: it also
      // covers the neck opening, where there is no shirt behind the flaps to project onto
      const fit = (side: number): ((x: number, y: number) => [number, number]) | null => {
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, su0 = 0, sv0 = 0, sxu = 0, syu = 0, sxv = 0, syv = 0
        for (let i = 0; i < sp.length / 3; i++) {
          const x = sp[i * 3], y = sp[i * 3 + 1], z = sp[i * 3 + 2]
          if (z * side <= 0.02 || y < 1.2 || Math.abs(x) > 0.16) continue
          const u = su[i * 2], v = su[i * 2 + 1]
          if (v * 2048 > 1860 || u * 2048 < 704 || u * 2048 > 1344) continue // torso texels only
          n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; su0 += u; sv0 += v; sxu += x * u; syu += y * u; sxv += x * v; syv += y * v
        }
        if (n < 6) return null
        // normal equations for [a b c]·[x y 1]
        const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
        const solve = (r: number[]): number[] => {
          const det = (m: number[][]): number => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
          const D = det(M)
          return [0, 1, 2].map((k) => det(M.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / D)
        }
        const A = solve([sxu, syu, su0]), B = solve([sxv, syv, sv0])
        return (x, y) => [A[0] * x + A[1] * y + A[2], B[0] * x + B[1] * y + B[2]]
      }
      const front = fit(1), back = fit(-1)
      const lookup = (vi: number): [number, number] => {
        const p = P(cp, vi)
        const f = p[2] >= 0 ? front : back
        if (f) return f(p[0], p[1])
        let best = Infinity, out: [number, number] = [cu[vi * 2], cu[vi * 2 + 1]]
        for (const t of tris) {
          const i0 = si[t], i1 = si[t + 1], i2 = si[t + 2]
          const [d, u, v, w] = closest(p, P(sp, i0), P(sp, i1), P(sp, i2))
          if (d < best) { best = d; out = [su[i0 * 2] * u + su[i1 * 2] * v + su[i2 * 2] * w, su[i0 * 2 + 1] * u + su[i1 * 2 + 1] * v + su[i2 * 2 + 1] * w] }
        }
        return out
      }
      const g = cg.clone()
      const uvs = new Float32Array(cu)
      for (let vi = 0; vi < uvs.length / 2; vi++) {
        if (cu[vi * 2 + 1] * 2048 >= 1860) continue
        const [u, v] = lookup(vi)
        uvs[vi * 2] = u; uvs[vi * 2 + 1] = v
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      return g
    }).catch(() => null)
    fitted.set(key, p)
  }
  return p
}

const shortsFits = new Map<string, Promise<[THREE.BufferGeometry, THREE.BufferGeometry] | null>>()
/**
 * Shorts body + leg-end piece (MESH_pants_NNN) overlap in a ~3 cm band: both edges showed as a line on the thigh.
 * For the 3D view: the body loses the triangles hidden under the leg piece, and the leg piece's upper vertices are
 * placed on the body surface, so the two read as one garment. The texture is not touched.
 */
export function shortsFitted(bodyFile: string, hemFile: string): Promise<[THREE.BufferGeometry, THREE.BufferGeometry] | null> {
  const key = bodyFile + '|' + hemFile
  let p = shortsFits.get(key)
  if (!p) {
    p = Promise.all([loadGlb(bodyFile), loadGlb(hemFile)]).then(([bg, hg]) => {
      if (!bg || !hg) return null
      const hp = hg.getAttribute('position').array as Float32Array
      let top = -Infinity
      for (let i = 1; i < hp.length; i += 3) top = Math.max(top, hp[i])
      // the body's lower rim hangs over the leg piece and showed as a step: every body vertex below the leg piece's
      // top edge is pushed just inside the leg piece's surface, so the leg piece covers it (nothing is cut)
      const hi = hg.getIndex()!.array
      const tris: number[] = []
      for (let t = 0; t < hi.length; t += 3) tris.push(t)
      const H = (i: number): number[] => [hp[i * 3], hp[i * 3 + 1], hp[i * 3 + 2]]
      const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      const closest = (p: number[], a: number[], b: number[], c: number[]): number[] => {
        const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
        const d00 = dot(ab, ab), d01 = dot(ab, ac), d11 = dot(ac, ac), d20 = dot(ap, ab), d21 = dot(ap, ac)
        const den = d00 * d11 - d01 * d01 || 1e-12
        let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den
        if (v < 0) v = 0
        if (w < 0) w = 0
        if (v + w > 1) { const k = v + w; v /= k; w /= k }
        return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]
      }
      const bp = bg.getAttribute('position').array as Float32Array
      const body = bg
      // the leg piece's upper band eases onto the body's original surface, so its top edge is level with the body
      const B = (i: number): number[] => [bp[i * 3], bp[i * 3 + 1], bp[i * 3 + 2]]
      const bi = bg.getIndex()!.array
      const btris: number[] = []
      for (let t = 0; t < bi.length; t += 3) { const y = bp[bi[t] * 3 + 1]; if (y > top - 0.06 && y < top + 0.05) btris.push(t) }
      const np = new Float32Array(hp), band = 0.03
      for (let i = 0; i < np.length / 3; i++) {
        const p = [np[i * 3], np[i * 3 + 1], np[i * 3 + 2]]
        const wgt = Math.max(0, Math.min(1, (p[1] - (top - band)) / band))
        if (wgt <= 0) continue
        let best = Infinity, q = p
        for (const t of btris) {
          const c = closest(p, B(bi[t]), B(bi[t + 1]), B(bi[t + 2]))
          const d = dot(sub(p, c), sub(p, c))
          if (d < best) { best = d; q = c }
        }
        if (best > 0.0064) continue
        const e = wgt * wgt * (3 - 2 * wgt)
        np[i * 3] = p[0] + (q[0] - p[0]) * e; np[i * 3 + 2] = p[2] + (q[2] - p[2]) * e
      }
      const hem = hg.clone()
      hem.setAttribute('position', new THREE.BufferAttribute(np, 3))
      hem.computeVertexNormals()
      // shading: the body is smooth (subdivided), the leg piece faceted — smooth the leg piece's normals across
      // split vertices, and in the joining band take the body's normal so the two read as one surface
      const hn = hem.getAttribute('normal').array as Float32Array, bn = bg.getAttribute('normal').array as Float32Array
      const groups = new Map<string, number[]>()
      for (let i = 0; i < np.length / 3; i++) { const k = np[i * 3].toFixed(4) + ',' + np[i * 3 + 1].toFixed(4) + ',' + np[i * 3 + 2].toFixed(4); const g = groups.get(k); if (g) g.push(i); else groups.set(k, [i]) }
      for (const g of groups.values()) {
        let x = 0, y = 0, z = 0
        for (const i of g) { x += hn[i * 3]; y += hn[i * 3 + 1]; z += hn[i * 3 + 2] }
        const l = Math.hypot(x, y, z) || 1
        for (const i of g) { hn[i * 3] = x / l; hn[i * 3 + 1] = y / l; hn[i * 3 + 2] = z / l }
      }
      for (let i = 0; i < np.length / 3; i++) {
        const wgt = Math.max(0, Math.min(1, (np[i * 3 + 1] - (top - band)) / band))
        if (wgt <= 0) continue
        let best = Infinity, k = -1
        for (let j = 0; j < bp.length / 3; j++) {
          if (Math.abs(bp[j * 3 + 1] - np[i * 3 + 1]) > 0.04) continue
          const d = (bp[j * 3] - np[i * 3]) ** 2 + (bp[j * 3 + 1] - np[i * 3 + 1]) ** 2 + (bp[j * 3 + 2] - np[i * 3 + 2]) ** 2
          if (d < best) { best = d; k = j }
        }
        if (k < 0 || best > 0.0025) continue
        const x = hn[i * 3] + (bn[k * 3] - hn[i * 3]) * wgt, y = hn[i * 3 + 1] + (bn[k * 3 + 1] - hn[i * 3 + 1]) * wgt, z = hn[i * 3 + 2] + (bn[k * 3 + 2] - hn[i * 3 + 2]) * wgt
        const l = Math.hypot(x, y, z) || 1
        hn[i * 3] = x / l; hn[i * 3 + 1] = y / l; hn[i * 3 + 2] = z / l
      }
      hem.getAttribute('normal').needsUpdate = true
      return [body, hem] as [THREE.BufferGeometry, THREE.BufferGeometry]
    }).catch(() => null)
    shortsFits.set(key, p)
  }
  return p
}

export interface CometOptions {
  tucked: boolean
  tight: boolean
  long: boolean
  kappa: boolean
  captain: boolean
  collar: number
  shortsModel: number
}

const pad3 = (n: number): string => String(n).padStart(3, '0')

/** GLB files (subdivided where available) for a kit configuration. */
export async function cometFiles(o: CometOptions): Promise<string[] | null> {
  const idx = await cometIndex()
  if (!idx) return null
  const byFile = new Map(idx.map((e) => [e.file, e]))
  const pick = (base: string): string | null => {
    const e = byFile.get(base + '.glb')
    return e ? e.smooth ?? e.file : null
  }
  const shirt = pick(`shirt_${o.tucked ? 'in' : 'out'}${o.tight ? '_tight' : ''}`)
  const cap = o.captain
  const sleeve = o.tight
    ? o.long
      ? (o.kappa ? (cap ? '4_long_kappa_with_captin' : '3_long_kappa') : cap ? '2_long_with_captin' : '1_long')
      : (o.kappa ? (cap ? '4_short_kappa_with_captin' : '3_short_kappa') : cap ? '2_short_with_captin' : '1_short')
    : o.long
      ? (o.kappa ? (cap ? '8_long_sleeve_kappa_with_captin' : '7_long_sleeve_kappa') : cap ? '6_long_sleeve_with_captin' : '5_long_sleeve')
      : (o.kappa ? (cap ? '4_short_sleeve_kappa_with_captin' : '3_short_sleeve_kappa') : cap ? '2_short_sleeve_with_captin' : '1_short_sleeve')
  // collar: the requested PC collar, or the nearest one the template has
  const collars = idx.filter((e) => e.kind === 'collar_pc' && e.id != null).map((e) => e.id!).sort((a, b) => a - b)
  const cid = collars.includes(o.collar) ? o.collar : collars.reduce((best, c) => (Math.abs(c - o.collar) < Math.abs(best - o.collar) ? c : best), collars[0] ?? 1)
  const shorts = pick(o.tucked ? '1_pants_in_sub' : o.tight ? '3_pants_out_tight' : '2_pants_out_sub')
  const sm = Math.max(1, Math.min(16, o.shortsModel || 1))
  return [shirt, pick(sleeve), `mesh_collar_${pad3(cid)}.glb`, shorts, `mesh_pants_${pad3(sm)}.glb`, pick('socks_long')].filter((f): f is string => !!f)
}

const islandCache = new Map<string, Promise<OffscreenCanvas | null>>()

/**
 * Where the current models actually sample the 2048² texture: every UV triangle filled white (slightly grown so
 * neighbouring triangles never leave cracks). Everything else is texture the kit never shows.
 */
export function uvIslands(o: CometOptions): Promise<OffscreenCanvas | null> {
  // the texture is the same with or without the captain's armband and with short or long sleeves:
  // show the islands of every variant so toggling them in the 3D view never changes the 2D view
  const key = JSON.stringify({ ...o, long: null, captain: null })
  let p = islandCache.get(key)
  if (!p) {
    p = (async () => {
      const variants = await Promise.all([false, true].map((long) => cometFiles({ ...o, long, captain: true })))
      if (!variants[0] || !variants[1]) return null
      const files = [...new Set([...variants[0], ...variants[1]])]
      // the base meshes have the same islands as the subdivided ones, with far fewer triangles
      const base = files.map((f) => f.replace(/_sd\.glb$/, '.glb'))
      const geos = await Promise.all(base.map(loadGlb))
      if (!geos.some(Boolean)) return null
      const c = new OffscreenCanvas(2048, 2048), g = c.getContext('2d')!
      g.fillStyle = g.strokeStyle = '#fff'
      g.lineWidth = 3
      g.lineJoin = 'round'
      for (const geo of geos) {
        if (!geo) continue
        const uv = geo.getAttribute('uv').array as Float32Array, idx = geo.getIndex()!.array
        g.beginPath()
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t] * 2, b = idx[t + 1] * 2, d = idx[t + 2] * 2
          g.moveTo(uv[a] * 2048, uv[a + 1] * 2048); g.lineTo(uv[b] * 2048, uv[b + 1] * 2048); g.lineTo(uv[d] * 2048, uv[d + 1] * 2048); g.closePath()
        }
        g.fill(); g.stroke()
      }
      return c
    })().catch(() => null)
    islandCache.set(key, p)
  }
  return p
}
