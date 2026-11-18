import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { MeshDto } from '@shared/ipc'
import { cometFiles, loadGlb, collarFitted, shortsFitted } from './comet'
import { shineToRoughness } from '../compositor/compose'

const modelCache = new Map<string, Promise<MeshDto[]>>()

/** Fine fabric relief (tileable noise) so the shirt doesn't look like plastic. */
function fabricBump(): THREE.Texture {
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n
  const g = c.getContext('2d')!, id = g.createImageData(n, n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 128 + 70 * (((x >> 1) + (y >> 1)) % 2 ? 1 : -1) * 0.5 + (Math.random() - 0.5) * 60
    const o = (y * n + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255
  }
  g.putImageData(id, 0, 0)
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(90, 90)
  return t
}
/** Stretchy sock knit (3D preview only, never in the texture): fine ribs running down the leg (along the texture's v). */
function sockBump(): THREE.Texture {
  const w = 16, h = 8, c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')!, id = g.createImageData(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rib = Math.sin((x / w) * Math.PI * 2 * 2) * 0.5 + 0.5 // 2 ribs per tile
    const v = 70 + rib * 150 + (y % 2 ? 12 : -12)
    const o = (y * w + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255
  }
  g.putImageData(id, 0, 0)
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2048 / 8 / 2, 2048 / 5 / 2)
  t.magFilter = THREE.LinearFilter
  return t
}
function loadModel(name: string): Promise<MeshDto[]> {
  let p = modelCache.get(name)
  if (!p) { p = window.kc.readModel(name).catch(() => []); modelCache.set(name, p) }
  return p
}

function toGeometry(m: MeshDto): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  g.setIndex(new THREE.BufferAttribute(m.indices, 1))
  if (!m.normals) g.computeVertexNormals()
  return g
}

/** Captain armband: a band round the player's left upper arm, mapped to texture x 0..512, y 0..128. */
type BandFit = { pos: THREE.Vector3; dir: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3; rings: number[][] }
const BAND_SEG = 64, BAND_H = 0.06, BAND_T = 0.004, BAND_ROWS = 5

/**
 * Where the armband goes on a sleeve model: the player's left arm (x > 0.15). The axis runs from the middle of the
 * shoulder end to the middle of the cuff end; the band sits 62 % of the way down, square to the arm. Its shape is
 * measured on the sleeve itself: from the axis, a ray every few degrees at a few heights finds the sleeve's surface
 * (the model has only a few hundred points, so its vertices alone gave a band that floated off the arm), and the band
 * goes just outside it.
 */
function armbandFit(meshes: MeshDto[]): BandFit | undefined {
  const P: THREE.Vector3[] = []
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i] > 0.15) P.push(new THREE.Vector3(m.positions[i], m.positions[i + 1], m.positions[i + 2]))
  if (P.length < 20) return undefined
  const c = P.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(P.length)
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const p of P) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j] }
  let v = new THREE.Vector3(1, -0.7, 0)
  for (let k = 0; k < 30; k++) v = new THREE.Vector3(C[0] * v.x + C[1] * v.y + C[2] * v.z, C[3] * v.x + C[4] * v.y + C[5] * v.z, C[6] * v.x + C[7] * v.y + C[8] * v.z).normalize()
  if (v.x < 0) v.negate() // shoulder → cuff
  let ts = P.map((p) => p.clone().sub(c).dot(v))
  let t0 = Math.min(...ts), t1 = Math.max(...ts)
  const mid = (a: number, b: number): THREE.Vector3 => { const q = P.filter((_, i) => ts[i] >= a && ts[i] <= b); return q.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(1, q.length)) }
  const L = t1 - t0
  const a0 = mid(t0 + L * 0.2, t0 + L * 0.4), a1 = mid(t0 + L * 0.8, t0 + L)
  if (a1.distanceTo(a0) > 0.01) { v = a1.clone().sub(a0).normalize(); ts = P.map((p) => p.clone().sub(c).dot(v)); t0 = Math.min(...ts); t1 = Math.max(...ts) }
  const t = t0 + 0.68 * (t1 - t0)
  const pos = mid(t - BAND_H, t + BAND_H)
  pos.addScaledVector(v, t - pos.clone().sub(c).dot(v))
  // the band runs parallel to the sleeve's hem (cut at a slant on the game's sleeve), like the real armband: its
  // edges follow the plane of the hem's opening (best-fit plane of the open edge at the cuff end)
  const hem = hemNormal(meshes, (p) => p.clone().sub(c).dot(v) > t0 + 0.75 * L)
  if (hem && Math.abs(hem.dot(v)) > 0.6) v = hem.dot(v) < 0 ? hem.negate() : hem
  const e2 = new THREE.Vector3(0, 0, 1).projectOnPlane(v).normalize(), e1 = new THREE.Vector3().crossVectors(v, e2).normalize()
  return measureBand(meshes, pos, v, e1, e2)
}

/** The band's rings at a given place: rays from the axis find the sleeve's surface (works on any sleeve model). */
function measureBand(meshes: MeshDto[], pos: THREE.Vector3, v: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3): BandFit | undefined {
  // rays from the axis to the sleeve's surface
  const obj = new THREE.Group()
  const side = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  for (const m of meshes) obj.add(new THREE.Mesh(toGeometry(m), side))
  obj.updateMatrixWorld(true)
  const ray = new THREE.Raycaster()
  const rings: number[][] = []
  for (let row = 0; row < BAND_ROWS; row++) {
    const o = pos.clone().addScaledVector(v, (row / (BAND_ROWS - 1) - 0.5) * BAND_H)
    const r = new Array<number>(BAND_SEG).fill(0)
    for (let s = 0; s < BAND_SEG; s++) {
      const a = (s / BAND_SEG) * Math.PI * 2
      ray.set(o, e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a)))
      const hits = ray.intersectObject(obj, true)
      if (hits.length) r[s] = Math.max(...hits.map((h) => h.distance))
    }
    const known = r.map((x) => x > 0)
    if (!known.some(Boolean)) return undefined
    for (let k = 0; k < BAND_SEG; k++) if (!known[k]) {
      let a = 1, b = 1
      while (!known[(k - a + BAND_SEG) % BAND_SEG]) a++
      while (!known[(k + b) % BAND_SEG]) b++
      r[k] = (r[(k - a + BAND_SEG) % BAND_SEG] * b + r[(k + b) % BAND_SEG] * a) / (a + b)
    }
    rings.push(r.map((_, k) => Math.max(r[k], (r[(k + BAND_SEG - 1) % BAND_SEG] + 2 * r[k] + r[(k + 1) % BAND_SEG]) / 4) + 0.006))
  }
  obj.traverse((x) => { if (x instanceof THREE.Mesh) x.geometry.dispose() })
  return { pos, dir: v, e1, e2, rings }
}

/** Normal of the best-fit plane through the open edges (boundary) of the meshes that `keep` selects. */
function hemNormal(meshes: MeshDto[], keep: (p: THREE.Vector3) => boolean): THREE.Vector3 | undefined {
  const pts: THREE.Vector3[] = []
  for (const m of meshes) {
    const P = m.positions, I = m.indices
    const key = (i: number): string => P[i * 3].toFixed(4) + ',' + P[i * 3 + 1].toFixed(4) + ',' + P[i * 3 + 2].toFixed(4)
    const n = new Map<string, number>(), ends = new Map<string, number>()
    for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) {
      const ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka
      n.set(k, (n.get(k) ?? 0) + 1); ends.set(k, a)
    }
    for (const [k, c] of n) if (c === 1) { const i = ends.get(k)!; const q = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (q.x > 0.15 && keep(q)) pts.push(q) }
  }
  if (pts.length < 6) return undefined
  const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length)
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const p of pts) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j] }
  // smallest eigenvector = largest of (tr·I − C)
  const tr = C[0] + C[4] + C[8]
  const M = C.map((x, i) => (i % 4 === 0 ? tr - x : -x))
  let v = new THREE.Vector3(1, 0.3, 0.2)
  for (let k = 0; k < 60; k++) v = new THREE.Vector3(M[0] * v.x + M[1] * v.y + M[2] * v.z, M[3] * v.x + M[4] * v.y + M[5] * v.z, M[6] * v.x + M[7] * v.y + M[8] * v.z).normalize()
  return v
}

/** A band with a little thickness: outer face (the texture), inner face and the two edges. */
function armbandMesh(mat: THREE.Material, fit?: BandFit): THREE.Mesh {
  const seg = BAND_SEG, pos: number[] = [], uv: number[] = [], idx: number[] = []
  const dir = fit?.dir ?? new THREE.Vector3(0.22, -0.17, 0).normalize()
  // angle 90° (texture x 128, where the crest goes) faces the front
  const e2 = fit?.e2 ?? new THREE.Vector3(0, 0, 1).projectOnPlane(dir).normalize()
  const e1 = fit?.e1 ?? new THREE.Vector3().crossVectors(dir, e2).normalize()
  const c = fit?.pos ?? new THREE.Vector3(0.37, 1.29, 0.005)
  const ringR = (row: number, s: number): number => (fit ? fit.rings[row][s % seg] : 0.05)
  // outer rows bottom → top, then the inner rows top → bottom (the strip closes through the two edges)
  const rows: [number, number, number][] = []
  for (let k = 0; k < BAND_ROWS; k++) rows.push([k, 0, 8 + (112 * k) / (BAND_ROWS - 1)])
  for (let k = BAND_ROWS - 1; k >= 0; k--) rows.push([k, -BAND_T, 124 - (120 * (BAND_ROWS - 1 - k)) / (BAND_ROWS - 1)])
  for (const [k, dr, vv] of rows) for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2, r = ringR(k, s) + dr
    const p = c.clone().addScaledVector(dir, (k / (BAND_ROWS - 1) - 0.5) * BAND_H).addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r)
    pos.push(p.x, p.y, p.z)
    uv.push((s / seg) * 512 / 2048, vv / 2048)
  }
  const W = seg + 1, R = rows.length
  for (let r = 0; r < R; r++) for (let s = 0; s < seg; s++) {
    const a = r * W + s, b = ((r + 1) % R) * W + s
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return new THREE.Mesh(g, mat)
}

/**
 * Waist of the shorts: the top of the waistband and, for every angle round the body, how far the shorts reach
 * just below it (so a tucked shirt can be pulled in to sit inside them).
 */
function waistProfile(g: THREE.BufferGeometry): { top: number; cx: number; cz: number; at: (a: number) => number } | null {
  const p = g.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!p) return null
  let top = -Infinity
  for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i))
  const band: [number, number][] = []
  for (let i = 0; i < p.count; i++) if (p.getY(i) > top - 0.08) band.push([p.getX(i), p.getZ(i)])
  if (band.length < 8) return null
  const cx = band.reduce((s, q) => s + q[0], 0) / band.length, cz = band.reduce((s, q) => s + q[1], 0) / band.length
  const N = 72, r = new Array<number>(N).fill(Infinity)
  // the inner limit: the smallest radius the waistband has at each angle
  for (const [x, z] of band) {
    const a = Math.atan2(z - cz, x - cx), k = ((Math.round((a / (Math.PI * 2)) * N) % N) + N) % N
    r[k] = Math.min(r[k], Math.hypot(x - cx, z - cz))
  }
  const known = r.map(Number.isFinite)
  for (let k = 0; k < N; k++) if (!known[k]) {
    let a = 1, b = 1
    while (!known[(k - a + N) % N] && a < N) a++
    while (!known[(k + b) % N] && b < N) b++
    r[k] = (r[(k - a + N) % N] * b + r[(k + b) % N] * a) / (a + b)
  }
  return { top, cx, cz, at: (a) => r[((Math.round((a / (Math.PI * 2)) * N) % N) + N) % N] }
}

/** Procedural sock: a tapered tube mapped onto one sock region of the texture. */
function sockGeometry(side: 0 | 1): THREE.BufferGeometry {
  const seg = 24, rows = 8
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const x0 = side === 0 ? 0 : 1638, w = 410
  for (let r = 0; r <= rows; r++) {
    const t = r / rows
    const y = 0.56 - t * 0.42
    const rad = 0.052 - 0.012 * Math.sin(t * Math.PI * 0.9)
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2
      pos.push(Math.sin(a) * rad + (side === 0 ? -0.1 : 0.1), y, Math.cos(a) * rad)
      uv.push((x0 + (s / seg) * w) / 2048, (620 + t * 540) / 2048)
    }
  }
  for (let r = 0; r < rows; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + seg + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export type CamView = 'front' | 'back' | 'side' | 'sideR' | 'threeL' | 'threeR' | 'threeBack' | 'shorts' | 'socks' | 'collar' | 'sleeve'

/** Camera presets: [position, target] */
export const CAMS: Record<CamView, [[number, number, number], [number, number, number]]> = {
  front: [[0, 1.15, 2.6], [0, 1.0, 0]],
  back: [[0, 1.15, -2.6], [0, 1.0, 0]],
  side: [[2.6, 1.15, 0], [0, 1.0, 0]], // player's left
  sideR: [[-2.6, 1.15, 0], [0, 1.0, 0]],
  threeL: [[1.85, 1.2, 1.85], [0, 1.0, 0]],
  threeR: [[-1.85, 1.2, 1.85], [0, 1.0, 0]],
  threeBack: [[1.85, 1.2, -1.85], [0, 1.0, 0]],
  sleeve: [[1.5, 1.35, 0.9], [0.22, 1.3, 0]],
  collar: [[0, 1.66, 1.35], [0, 1.42, 0]],
  shorts: [[0.25, 0.85, 1.55], [0, 0.76, 0]],
  socks: [[0.3, 0.5, 1.45], [0, 0.36, 0]]
}

/** Lighting presets: [environment strength, key light strength, key colour, key position, fill strength, fill position]. */
export type LightPreset = 'hdri' | 'studio' | 'default' | 'default2' | 'default3' | 'night' | 'day' | 'dayR' | 'dayL' | 'day2' | 'darkR' | 'darkL'
export const LIGHT_PRESETS: [LightPreset, string][] = [
  ['hdri', 'Ambiente (HDRI)'], ['studio', 'Estúdio'], ['default', 'Predefinida'], ['default2', 'Predefinida 2'], ['default3', 'Predefinida 3'], ['night', 'Noite'],
  ['day', 'Dia'], ['dayR', 'Dia (dir.)'], ['dayL', 'Dia (esq.)'], ['day2', 'Dia 2'], ['darkR', 'Escuro (dir.)'], ['darkL', 'Escuro (esq.)']
]
type LP = { exp: number; env: number; key: number; color: number; pos: [number, number, number]; fill: number; fpos: [number, number, number]; fcolor?: number }
// balanced (0.4.0): a white kit at the default slider does not burn out under any preset; a lower ambient (env)
// and a clear key light make the per-layer shininess visible as highlights
const LIGHTS: Record<LightPreset, LP> = {
  hdri: { exp: 0.95, env: 0.75, key: 0.6, color: 0xffffff, pos: [1.5, 2.5, 3], fill: 0, fpos: [-2, 1, 2] },
  studio: { exp: 0.95, env: 0.55, key: 0.9, color: 0xffffff, pos: [0.5, 3, 3], fill: 0.3, fpos: [-2.5, 1.2, 1.5] },
  default: { exp: 0.95, env: 0.45, key: 1.0, color: 0xfff8f0, pos: [2, 2.5, 2.5], fill: 0.25, fpos: [-2, 0.8, 1] },
  default2: { exp: 0.95, env: 0.45, key: 1.0, color: 0xfff8f0, pos: [-2, 2.5, 2.5], fill: 0.25, fpos: [2, 0.8, 1] },
  default3: { exp: 0.95, env: 0.5, key: 0.85, color: 0xffffff, pos: [0, 2, 3.5], fill: 0.3, fpos: [0, 3, -2] },
  night: { exp: 0.75, env: 0.15, key: 1.1, color: 0xb8c8ff, pos: [0.5, 4, 1.5], fill: 0.25, fpos: [0, 1, -3], fcolor: 0x6f86ff },
  day: { exp: 0.95, env: 0.55, key: 1.25, color: 0xfff1d8, pos: [1, 4, 3], fill: 0.2, fpos: [-1, 1, 2], fcolor: 0xbfd9ff },
  dayR: { exp: 0.95, env: 0.5, key: 1.35, color: 0xfff1d8, pos: [4, 3, 1.5], fill: 0.2, fpos: [-2, 1, 2], fcolor: 0xbfd9ff },
  dayL: { exp: 0.95, env: 0.5, key: 1.35, color: 0xfff1d8, pos: [-4, 3, 1.5], fill: 0.2, fpos: [2, 1, 2], fcolor: 0xbfd9ff },
  day2: { exp: 0.95, env: 0.65, key: 1.0, color: 0xffffff, pos: [0, 5, 1], fill: 0.25, fpos: [0, 1, 3], fcolor: 0xdfeaff },
  darkR: { exp: 0.8, env: 0.06, key: 2.2, color: 0xffffff, pos: [4, 1.5, 0.5], fill: 0.05, fpos: [0, 1, 2] },
  darkL: { exp: 0.8, env: 0.06, key: 2.2, color: 0xffffff, pos: [-4, 1.5, 0.5], fill: 0.05, fpos: [0, 1, 2] }
}
export type EnvKind = 'room' | 'studio' | 'outdoor'
export const ENVS: [EnvKind, string][] = [['room', 'Interior'], ['studio', 'Estúdio claro'], ['outdoor', 'Exterior (céu)']]
/** Small scenes rendered into environment maps (soft image-based light). */
function envScene(kind: EnvKind): THREE.Scene {
  if (kind === 'room') return new RoomEnvironment()
  const sc = new THREE.Scene()
  const box = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: kind === 'studio' ? 0x6b6e78 : 0x8fb5e6 }))
  sc.add(box)
  const panel = (w: number, h: number, pos: [number, number, number], c: number, k = 1): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(...pos); m.lookAt(0, 1, 0); sc.add(m)
  }
  if (kind === 'studio') { panel(4, 4, [0, 3, 4], 0xffffff, 3); panel(3, 5, [-4.5, 1.5, 1], 0xffffff, 2); panel(3, 5, [4.5, 1.5, 1], 0xffffff, 2); panel(6, 2, [0, 5.8, 0], 0xffffff, 2) }
  else { panel(12, 6, [0, 5.9, 0], 0xcfe6ff, 2.5); panel(12, 3, [0, -5.9, 0], 0x5d7a3a, 0.8); panel(1.5, 1.5, [3, 5, 3], 0xfff3d6, 12) }
  return sc
}

export interface ViewerProps {
  texture: OffscreenCanvas | HTMLCanvasElement | null
  version?: number // bumps when the (shared) texture canvas has new content
  collar: number
  longSleeves?: boolean
  shortsModel?: number
  camera?: { view: CamView; n: number } // n changes to re-trigger the same view
  armband?: boolean
  tucked?: boolean // shirt inside the shorts
  tight?: boolean // TightKit=1
  kappa?: boolean // ShortSleevesModel=2
  height?: number | string
  shine?: number // kit shininess 0..100
  shineMap?: { width: number; height: number; data: Uint8Array } | null // per-texel roughness (layers with own shininess)
  autoRotate?: boolean
  light?: number // 0 (dim) … 100 (bright); 40 = default
  lightPreset?: LightPreset
  env?: EnvKind
  background?: string | null // null = transparent (app background)
  hideShorts?: boolean
  hideSocks?: boolean
  /** receives a function that returns the current 3D view as a PNG */
  snapshot?: (take: () => Promise<Blob | null>) => void
}

export function KitViewer({ texture, version = 0, collar, longSleeves, shortsModel = 1, camera, armband = false, tucked = false, tight = true, kappa = false, height = '100%', shine = 0, shineMap = null, autoRotate = false, snapshot, light = 40, lightPreset = 'hdri', env = 'room', background = null, hideShorts = false, hideSocks = false }: ViewerProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const st = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; ctl: OrbitControls; mat: THREE.MeshStandardMaterial; tex: THREE.Texture; group: THREE.Group; raf: number; fly: { pos: THREE.Vector3; target: THREE.Vector3; t: number } | null; key: THREE.DirectionalLight; fill: THREE.DirectionalLight; pmrem: THREE.PMREMGenerator; envMul: number; envTex: THREE.Texture | null; front: THREE.MeshStandardMaterial; sock: THREE.MeshStandardMaterial } | null>(null)
  const [noModels, setNoModels] = useState(false)

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping // keeps hues and saturation close to the texture (ACES washes colours out)
    renderer.toneMappingExposure = 0.95
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    // studio HDRI-style lighting (soft, image based) instead of plain lamps
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20)
    cam.position.set(0, 1.15, 2.6)
    const ctl = new OrbitControls(cam, renderer.domElement)
    ctl.target.set(0, 1.0, 0)
    ctl.enableDamping = true
    ctl.minDistance = 0.8
    ctl.maxDistance = 5
    const key = new THREE.DirectionalLight(0xffffff, 0.55); key.position.set(1.5, 2.5, 3); scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0); fill.position.set(-2, 1, 2); scene.add(fill)
    const tex = new THREE.Texture()
    tex.flipY = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.93, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.75,
      bumpMap: fabricBump(), bumpScale: 0.6
    })
    const group = new THREE.Group()
    scene.add(group)
    const resize = (): void => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'
      cam.aspect = w / Math.max(1, h)
      // narrow view (a side panel open): widen the view instead of cutting the kit at the sides
      cam.zoom = Math.min(1, cam.aspect / 1.1)
      cam.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    ctl.addEventListener('start', () => { if (st.current) st.current.fly = null })
    const loop = (): void => {
      const s = st.current!
      if (s.fly) {
        // ease the camera towards the requested preset
        s.fly.t = Math.min(1, s.fly.t + 0.06)
        const k = 1 - Math.pow(1 - s.fly.t, 3)
        cam.position.lerp(s.fly.pos, k * 0.35)
        ctl.target.lerp(s.fly.target, k * 0.35)
        if (s.fly.t >= 1 && cam.position.distanceTo(s.fly.pos) < 0.005) s.fly = null
      }
      // keep the front-only material in step with the main one (texture, shine)
      const f = s.front, m = s.mat
      if (f.map !== m.map || f.roughnessMap !== m.roughnessMap) { f.map = m.map; f.roughnessMap = m.roughnessMap; f.needsUpdate = true }
      f.roughness = m.roughness; f.envMapIntensity = m.envMapIntensity
      const k = s.sock
      if (k.map !== m.map || k.roughnessMap !== m.roughnessMap) { k.map = m.map; k.roughnessMap = m.roughnessMap; k.needsUpdate = true }
      k.roughness = m.roughness; k.envMapIntensity = m.envMapIntensity
      ctl.update(); renderer.render(scene, cam); s.raf = requestAnimationFrame(loop)
    }
    // game pieces: front faces only, plus an inside-out copy lit like the outside (folds show the cloth's other side
    // with the same light instead of a dark gap)
    const front = mat.clone(); front.side = THREE.FrontSide
    // socks: a stretchier knit than the shirt (own relief, 3D only)
    const sock = mat.clone(); sock.bumpMap = sockBump(); sock.bumpScale = 1.4
    st.current = { renderer, scene, cam, ctl, mat, tex, group, raf: 0, fly: null, key, fill, pmrem, envMul: 1, envTex, front, sock }
    // scripted checks: point the camera anywhere
    ;(window as unknown as { __kcView: unknown }).__kcView = (p: [number, number, number], t: [number, number, number]): void => {
      if (st.current) st.current.fly = { pos: new THREE.Vector3(...p), target: new THREE.Vector3(...t), t: 0 }
    }
    loop()
    return () => {
      cancelAnimationFrame(st.current!.raf)
      ro.disconnect()
      renderer.dispose()
      el.removeChild(renderer.domElement)
      st.current = null
    }
  }, [])

  // geometry
  useEffect(() => {
    let alive = true
    ;(async () => {
      const s = st.current
      if (!s) return
      const C = 'Asset/model/character/#Win/common_package_fpk/Assets/pes16/model/character/common/'
      // CometKITpreviewer models (subdivided, same UVs as the game); kit only, no arms/body
      const all = await cometFiles({ tucked, tight, long: !!longSleeves, kappa, captain: armband, collar, shortsModel })
      const files = all?.filter((f) => !(hideShorts && /pants/i.test(f)) && !(hideSocks && /socks/i.test(f)))
      if (files) {
        // collar: the game's own collar model (its UVs match the game texture exactly); the template's collar,
        // re-mapped onto the shirt, only when the game model is not available
        const shirt = files.find((f) => f.startsWith('shirt'))
        const gameCollar = await loadModel(`nocloth/#Win/collar_${String(collar).padStart(3, '0')}.fmdl`)
        // with the game's collar, the shirt body and sleeves also come from the game: they are made to fit together
        // (the template's shirt has a wider neck opening, which its own collars cover)
        const [gameShirt, gameSleeve] = gameCollar.length ? await Promise.all([
          loadModel('nocloth/#Win/shirt_out.fmdl'),
          loadModel(longSleeves ? 'nocloth/#Win/sleeve_long_001.fmdl' : 'nocloth/#Win/sleeve_short_001.fmdl')
        ]) : [[], []]
        const useGame = gameCollar.length > 0 && gameShirt.length > 0 && gameSleeve.length > 0
        const skip = (f: string): boolean => /collar/i.test(f) ? gameCollar.length > 0 : useGame && (f.startsWith('shirt') || /^\d_(?!pants)/.test(f)) // template sleeve files: 1_short…, 5_long_sleeve…
        // shorts: body + leg-end piece joined (no line on the thigh)
        const body = files.find((f) => /pants_(in|out)/i.test(f)), hem = files.find((f) => /^mesh_pants_/i.test(f))
        const fittedShorts = body && hem ? await shortsFitted(body, hem) : null
        const geos = await Promise.all(files.map((f) => (skip(f) ? Promise.resolve(null)
          : fittedShorts && f === body ? Promise.resolve(fittedShorts[0])
          : fittedShorts && f === hem ? Promise.resolve(fittedShorts[1])
          : /collar/i.test(f) ? (shirt ? collarFitted(f, shirt).then((g) => g ?? loadGlb(f)) : loadGlb(f))
          : loadGlb(f))))
        // tucked in: the game's own tucked shirt is an unposed cloth mesh, so the shirt goes into the shorts: below the
        // shorts' waistband it is pulled in to just inside the shorts' own cross-section (measured round the body for
        // every angle) and cut a little lower, so no shirt edge or step shows at the waist
        const shortsGeo = fittedShorts?.[0] ?? (body ? geos[files.indexOf(body)] : null)
        const waist = tucked && shortsGeo ? waistProfile(shortsGeo) : null
        const cutShirt = (ms: typeof gameShirt): typeof gameShirt => !tucked ? ms : ms.map((m) => {
          const P = new Float32Array(m.positions)
          const top = waist?.top ?? 1.0
          if (waist) {
            for (let i = 0; i < P.length; i += 3) {
              const y = P[i + 1]
              if (y > top + 0.05) continue
              const dx = P[i] - waist.cx, dz = P[i + 2] - waist.cz, r = Math.hypot(dx, dz)
              if (!r) continue
              const lim = waist.at(Math.atan2(dz, dx)) * 0.94
              const k = Math.min(1, Math.max(0, (top + 0.05 - y) / 0.07)) // 0 above the band → 1 inside it
              const nr = r > lim ? r + (lim - r) * k : r
              P[i] = waist.cx + (dx / r) * nr; P[i + 2] = waist.cz + (dz / r) * nr
            }
          }
          const keep: number[] = []
          const cut = top - 0.06
          for (let t = 0; t < m.indices.length; t += 3) {
            const y = (k: number): number => P[m.indices[t + k] * 3 + 1]
            if (y(0) < cut && y(1) < cut && y(2) < cut) continue
            keep.push(m.indices[t], m.indices[t + 1], m.indices[t + 2])
          }
          return { ...m, positions: P, normals: null, indices: new Uint16Array(keep) }
        })
        // the game's shirt has side vents at the hem (open slits): close them in the preview by pulling the two
        // edges of each slit together
        const closeVents = (ms: typeof gameShirt): typeof gameShirt => ms.map((m) => {
          const P = new Float32Array(m.positions), I = m.indices
          const key = (i: number): string => P[i * 3].toFixed(4) + ',' + P[i * 3 + 1].toFixed(4) + ',' + P[i * 3 + 2].toFixed(4)
          const count = new Map<string, number>(), ends = new Map<string, number[]>(), linked = new Set<string>()
          for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) {
            const ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka
            count.set(k, (count.get(k) ?? 0) + 1); ends.set(k, [a, b]); linked.add(k)
          }
          const edgeVerts = new Set<number>()
          for (const [k, n] of count) if (n === 1) for (const v of ends.get(k)!) if (Math.abs(P[v * 3]) > 0.14 && P[v * 3 + 1] > 0.88 && P[v * 3 + 1] < 1.25) edgeVerts.add(v)
          const joined = (a: number, b: number): boolean => { const ka = key(a), kb = key(b); return linked.has(ka < kb ? ka + '|' + kb : kb + '|' + ka) }
          const vs = [...edgeVerts]
          const moved = new Set<number>()
          for (const a of vs) {
            if (moved.has(a)) continue
            let best = Infinity, bb = -1
            for (const b of vs) {
              if (b === a || moved.has(b) || key(a) === key(b) || joined(a, b) || Math.abs(P[a * 3 + 1] - P[b * 3 + 1]) > 0.01 || P[a * 3] * P[b * 3] < 0) continue
              const d = (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2
              if (d < best) { best = d; bb = b }
            }
            if (bb < 0 || best > 0.03 * 0.03) continue
            for (let k = 0; k < 3; k++) { const mid = (P[a * 3 + k] + P[bb * 3 + k]) / 2; P[a * 3 + k] = mid; P[bb * 3 + k] = mid }
            moved.add(a); moved.add(bb)
          }
          // vertex copies (UV seams) at a moved vertex's original position follow it
          const O = m.positions
          const okey = (i: number): string => O[i * 3].toFixed(4) + ',' + O[i * 3 + 1].toFixed(4) + ',' + O[i * 3 + 2].toFixed(4)
          const to = new Map<string, number>()
          for (const v of moved) to.set(okey(v), v)
          for (let i = 0; i < P.length / 3; i++) {
            const v = to.get(okey(i))
            if (v === undefined || v === i) continue
            P[i * 3] = P[v * 3]; P[i * 3 + 1] = P[v * 3 + 1]; P[i * 3 + 2] = P[v * 3 + 2]
          }
          // copies of the moved vertices at the same original position follow
          return { ...m, positions: P, normals: null }
        })
        const gameCollarLen = gameCollar.length
        // a copy: the arrays from loadModel are cached (pushing into them kept old sleeves in every later build)
        const gameParts = useGame ? [...gameCollar, ...closeVents(cutShirt(gameShirt)), ...gameSleeve] : [...gameCollar]
        // the band sits on the upper arm, measured on the short sleeve (same place on the long one)
        const shortFit = armband && useGame ? armbandFit(await loadModel('nocloth/#Win/sleeve_short_001.fmdl')) : undefined
        // same place on the arm with long sleeves, measured again on the long sleeve's own surface
        const bandFit = shortFit && longSleeves ? measureBand(gameSleeve, shortFit.pos, shortFit.dir, shortFit.e1, shortFit.e2) ?? shortFit : shortFit
        if (!alive || !st.current) return
        if (geos.some(Boolean)) {
          s.group.clear()
          for (const g of geos) if (g) s.group.add(new THREE.Mesh(g, s.mat))
          const collarCount = gameCollarLen
          // with the game's sleeves the template's armband sleeve is not used: add the armband band itself
          if (bandFit) s.group.add(armbandMesh(s.mat, bandFit))
          for (const [mi, m] of gameParts.entries()) {
            // collar pieces: the game's normals make the flaps lighter than the shirt under them — rebuild them
            const g = toGeometry(mi < collarCount ? { ...m, normals: null } : m)
            s.group.add(new THREE.Mesh(g, s.front))
            const inside = g.clone()
            const idx = inside.getIndex()!.array as Uint16Array | Uint32Array
            for (let t = 0; t < idx.length; t += 3) { const a = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = a }
            inside.getIndex()!.needsUpdate = true
            inside.computeVertexNormals()
            s.group.add(new THREE.Mesh(inside, s.front))
          }
          setNoModels(false)
          return
        }
      }
      const names = [
        tucked ? 'cloth/#Win/shirt_in.fmdl' : 'nocloth/#Win/shirt_out.fmdl',
        longSleeves ? 'nocloth/#Win/sleeve_long_001.fmdl' : 'nocloth/#Win/sleeve_short_001.fmdl',
        `nocloth/#Win/collar_${String(collar).padStart(3, '0')}.fmdl`,
        `cloth/#Win/pants_${String(shortsModel).padStart(3, '0')}.fmdl`
      ]
      const [parts, socks] = await Promise.all([Promise.all(names.map(loadModel)), loadModel(C + 'socks_long.fmdl')])
      if (!alive || !st.current) return
      s.group.clear()
      let count = 0
      for (const meshes of parts) for (const m of meshes) { s.group.add(new THREE.Mesh(toGeometry(m), s.mat)); count++ }
      if (socks.length) for (const m of socks) s.group.add(new THREE.Mesh(toGeometry(m), s.sock))
      else for (const side of [0, 1] as const) s.group.add(new THREE.Mesh(sockGeometry(side), s.sock))
      if (armband) s.group.add(armbandMesh(s.mat))
      setNoModels(count === 0)
    })()
    return () => { alive = false }
  }, [collar, longSleeves, shortsModel, armband, tucked, tight, kappa, hideShorts, hideSocks])

  // texture
  useEffect(() => {
    const s = st.current
    if (!s || !texture) return
    if (s.tex.image && (s.tex.image as OffscreenCanvas).width !== texture.width) {
      // size changed: new GPU texture
      const t = s.tex.clone(); t.image = texture; t.needsUpdate = true
      s.mat.map = t; s.tex.dispose(); s.tex = t; s.mat.needsUpdate = true
    } else { s.tex.image = texture; s.tex.needsUpdate = true }
  }, [texture, version])

  // shininess: one roughness for the whole kit, or a per-texel map when layers have their own
  useEffect(() => {
    const s = st.current
    if (!s) return
    const old = s.mat.roughnessMap
    if (shineMap) {
      const t = new THREE.DataTexture(shineMap.data, shineMap.width, shineMap.height, THREE.RGBAFormat)
      t.flipY = false
      t.colorSpace = THREE.NoColorSpace
      t.magFilter = THREE.LinearFilter
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.generateMipmaps = true
      t.needsUpdate = true
      s.mat.roughnessMap = t
      s.mat.roughness = 1
    } else {
      s.mat.roughnessMap = null
      s.mat.roughness = shineToRoughness(shine)
    }
    // glossier fabric shows more of the studio reflections
    s.mat.envMapIntensity = (0.6 + Math.max(0, Math.min(100, shine)) * 0.008) * s.envMul
    s.mat.needsUpdate = true
    old?.dispose()
  }, [shine, shineMap])

  // light: exposure of the whole scene (helps judging the real colour)
  useEffect(() => {
    const s = st.current
    if (!s) return
    s.renderer.toneMappingExposure = (0.5 + Math.max(0, Math.min(100, light)) * 0.0085) * (LIGHTS[lightPreset] ?? LIGHTS.hdri).exp
  }, [light, lightPreset])

  // lighting preset, environment and background
  useEffect(() => {
    const s = st.current
    if (!s) return
    const L = LIGHTS[lightPreset] ?? LIGHTS.hdri
    s.key.intensity = L.key; s.key.color.setHex(L.color); s.key.position.set(...L.pos)
    s.fill.intensity = L.fill; s.fill.color.setHex(L.fcolor ?? 0xffffff); s.fill.position.set(...L.fpos)
    s.envMul = L.env
    s.mat.envMapIntensity = (0.6 + Math.max(0, Math.min(100, shine)) * 0.008) * L.env
  }, [lightPreset, shine])
  useEffect(() => {
    const s = st.current
    if (!s) return
    const old = s.envTex
    s.envTex = s.pmrem.fromScene(envScene(env), 0.04).texture
    s.scene.environment = s.envTex
    old?.dispose()
  }, [env])
  useEffect(() => {
    const s = st.current
    if (!s) return
    if (background) s.renderer.setClearColor(background, 1); else s.renderer.setClearColor(0x000000, 0)
  }, [background])

  // turntable
  useEffect(() => {
    const s = st.current
    if (!s) return
    s.ctl.autoRotate = autoRotate
    s.ctl.autoRotateSpeed = 2.5
  }, [autoRotate])

  // PNG of the current view (transparent background)
  useEffect(() => {
    snapshot?.(() => new Promise((res) => {
      const s = st.current
      if (!s) return res(null)
      s.renderer.render(s.scene, s.cam)
      s.renderer.domElement.toBlob((b) => res(b), 'image/png')
    }))
  }, [snapshot])

  // camera presets
  useEffect(() => {
    const s = st.current
    if (!s || !camera) return
    const [p, t] = CAMS[camera.view]
    const target = new THREE.Vector3(...t)
    // narrow viewports (picker grid open) need the camera further back to keep the part in frame
    const pull = Math.max(1, 1.1 / Math.max(0.2, s.cam.aspect))
    const pos = new THREE.Vector3(...p).sub(target).multiplyScalar(pull).add(target)
    s.fly = { pos, target, t: 0 }
  }, [camera?.view, camera?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={host} style={{ width: '100%', height, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
      {noModels && <div className="viewer-note">Modelos 3D do jogo não encontrados — usa a vista 2D.</div>}
    </div>
  )
}
