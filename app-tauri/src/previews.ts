/** Thumbnail generators for the picker grids (cached object URLs). */
import * as THREE from 'three'
import type { KitDesign, Asset, OverlayLayer, PatternSpec } from './model/design'
import { applyTemplate, applyTpl, type Tpl } from './model/templates'
import { composeKit, frontThumb } from './compositor/compose'
import { drawTexture } from './compositor/patterns'
import { canvas, ctx2d } from './compositor/images'

const cache = new Map<string, Promise<string>>()
const url = async (c: OffscreenCanvas): Promise<string> => URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }))

function memo(key: string, fn: () => Promise<string>): Promise<string> {
  let p = cache.get(key)
  if (!p) {
    p = fn().catch(() => '')
    cache.set(key, p)
    if (cache.size > 1500) cache.delete(cache.keys().next().value!)
  }
  return p
}

const PREVIEW_SCALE = 0.25
const noLogos = (k: KitDesign): KitDesign => ({ ...k, logos: { ...k.logos, sponsors: [], backSponsors: [], sleeveBadges: [], crest: { ...k.logos.crest, enabled: false }, brand: { ...k.logos.brand, enabled: false } } })
const kitKey = (k: KitDesign): string => JSON.stringify([k.colors, k.torso, k.sleevePattern, k.shortsPattern, k.socksPattern])

export function templatePreview(k: KitDesign, tplId: string, assets: Record<string, Asset>): Promise<string> {
  return memo(`tpl:${tplId}:${k.colors.shirt}:${k.colors.shirt2}:${k.colors.shirt3}:${k.slot}`, async () => {
    const d = applyTemplate({ ...k, layers: [] }, tplId, k.colors.shirt, k.colors.shirt2, k.colors.shirt3)
    return kitPreview3d(noLogos(d), assets, 'torso', 'tpl:' + tplId + JSON.stringify(d.colors))
  })
}

/** Preview of a generated style (model/styles.ts) in the given colours; `key` names every number that went into it. */
export function recipePreview(k: KitDesign, tpl: Tpl, cols: [string, string, string], assets: Record<string, Asset>, key: string): Promise<string> {
  return memo('gen:' + key, async () => kitPreview3d(noLogos(applyTpl({ ...k, layers: [] }, tpl, cols[0], cols[1], cols[2])), assets, 'torso', 'gen:' + key))
}

export type PatternPart = 'torso' | 'sleeves' | 'shorts' | 'socks'
const PART_FIELD: Record<PatternPart, 'torso' | 'sleevePattern' | 'shortsPattern' | 'socksPattern'> = {
  torso: 'torso', sleeves: 'sleevePattern', shorts: 'shortsPattern', socks: 'socksPattern'
}

/** Crop of the texture that shows one part upright. */
function partView(tex: OffscreenCanvas, part: PatternPart, size: number): OffscreenCanvas {
  if (part === 'torso') return frontThumb(tex, size)
  const q = tex.width / 2048
  const c = canvas(size, size), g = ctx2d(c)
  if (part === 'sleeves') {
    // both sleeves unrolled, shoulder at the top: short sleeve (left) and long sleeve (right)
    const strip = (shoulder: number, cuff: number, y0: number, y1: number, ox: number, w: number): void => {
      const sx = w / (y1 - y0), sy = size / (shoulder - cuff)
      g.save()
      g.beginPath(); g.rect(ox, 0, w, size); g.clip()
      // out_x = (y - y0)·sx + ox, out_y = (shoulder - x)·sy
      g.setTransform(0, -sy, sx, 0, ox - y0 * sx, shoulder * sy)
      g.drawImage(tex, 0, 0, 2048, 2048)
      g.restore()
    }
    strip(704, 490, 684, 1218, size * 0.04, size * 0.44)
    strip(691, 7, 134, 650, size * 0.52, size * 0.44)
    return c
  }
  if (part === 'socks') {
    g.drawImage(tex, 0, 620 * q, 410 * q, 540 * q, size * 0.12, 0, size * 0.76, size)
  } else {
    // right leg of the shorts is stored rotated 90°
    g.translate(size / 2, size / 2)
    g.rotate(-Math.PI / 2)
    g.drawImage(tex, 0, 1160 * q, 672 * q, 804 * q, -size * 0.42, -size * 0.5, size * 0.84, size)
  }
  return c
}

export function patternPreview(k: KitDesign, part: PatternPart, id: string, assets: Record<string, Asset>): Promise<string> {
  const f = PART_FIELD[part]
  const spec: PatternSpec = { ...k[f], id }
  return memo(`pat:${part}:${id}:${JSON.stringify(spec)}:${JSON.stringify(k.colors)}`, async () => {
    const d: KitDesign = { ...k, base: { kind: 'template' }, layers: [], [f]: spec }
    const p3 = part === 'shorts' ? 'shorts' : part === 'socks' ? 'socks' : 'torso'
    const r = await kitPreview3d(noLogos(d), assets, p3, 'pat:' + part + id + JSON.stringify([spec, k.colors]))
    return r || url(partView(await composeKit(d, assets, { scale: PREVIEW_SCALE, skipLogos: true }), part, 256))
  })
}

export function texturePreview(id: string, color: string, bg: string, scale = 70): Promise<string> {
  return memo(`tex:${id}:${color}:${bg}:${scale}`, async () => {
    const c = canvas(256, 256), g = ctx2d(c)
    g.fillStyle = bg; g.fillRect(0, 0, 256, 256)
    g.fillStyle = g.strokeStyle = color
    g.globalAlpha = 0.85
    drawTexture(g, id, 0, 0, 256, 256, scale * 0.5)
    return url(c)
  })
}

export function shapePreview(k: KitDesign, L: OverlayLayer, shape: string, assets: Record<string, Asset>): Promise<string> {
  const layer: OverlayLayer = { ...L, shape: shape as OverlayLayer['shape'], visible: true, opacity: 1, dx: 0, dy: 0, rotation: 0 }
  return memo(`shape:${shape}:${L.color}:${L.size}:${L.part}:${kitKey(k)}`, async () => {
    const d: KitDesign = { ...k, layers: [layer] }
    const part = L.part === 'shorts' || L.part === 'socks' ? L.part : 'torso'
    return url(partView(await composeKit(d, assets, { scale: PREVIEW_SCALE, skipLogos: true }), part as PatternPart, 256))
  })
}

// ---------------------------------------------------------------- 3D model thumbnails (collars, shorts)
let r3: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera } | null = null
let chain: Promise<unknown> = Promise.resolve()
const modelCache = new Map<string, Promise<THREE.BufferGeometry[]>>()

function geoms(name: string): Promise<THREE.BufferGeometry[]> {
  let p = modelCache.get(name)
  if (!p) {
    p = window.kc.readModel(name).then((ms) => ms.map((m) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
      g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
      g.setIndex(new THREE.BufferAttribute(m.indices, 1))
      if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
      else g.computeVertexNormals()
      g.computeBoundingBox()
      return g
    })).catch(() => [])
    modelCache.set(name, p)
  }
  return p
}

function renderer3d(): NonNullable<typeof r3> {
  if (r3) return r3
  const el = document.createElement('canvas')
  el.width = el.height = 320
  const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(320, 320, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.8))
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 2, 3); scene.add(key)
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 10)
  r3 = { renderer, scene, cam }
  return r3
}

interface Part3d { name: string; color?: string; tex?: OffscreenCanvas }

/** Render models framed on the bounding box of the `focus` parts (meshes smaller than 2 cm are ignored). */
async function render3d(parts: Part3d[], focus: number[], view: { dir: [number, number, number]; pad: number }): Promise<string> {
  const loaded = await Promise.all(parts.map((p) => geoms(p.name)))
  if (!focus.some((i) => loaded[i]?.length)) return ''
  const job = chain.then(async () => {
    const { renderer, scene, cam } = renderer3d()
    const group = new THREE.Group()
    const box = new THREE.Box3()
    const textures: THREE.Texture[] = []
    loaded.forEach((gs, i) => {
      const p = parts[i]
      let map: THREE.Texture | null = null
      if (p.tex) { map = new THREE.Texture(p.tex as unknown as HTMLCanvasElement); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true; textures.push(map) }
      const mat = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : p.color ?? '#cccccc', map, roughness: 0.8, side: THREE.DoubleSide })
      gs.forEach((g) => {
        group.add(new THREE.Mesh(g, mat))
        const bb = g.boundingBox!
        if (focus.includes(i) && bb.getSize(new THREE.Vector3()).length() > 0.02) box.union(bb)
      })
    })
    scene.add(group)
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3())
    const dist = (Math.max(s.x, s.y, s.z) * view.pad) / Math.tan((cam.fov * Math.PI) / 360)
    const d = new THREE.Vector3(...view.dir).normalize()
    cam.position.copy(c).addScaledVector(d, dist)
    cam.lookAt(c)
    renderer.render(scene, cam)
    scene.remove(group)
    textures.forEach((t) => t.dispose())
    const blob: Blob = await new Promise((res) => renderer.domElement.toBlob((b) => res(b!), 'image/png'))
    return URL.createObjectURL(blob)
  })
  chain = job.catch(() => undefined)
  return job
}

/** Collar on the upper shirt, painted with the kit's own texture (so stripes/colours of the collar show). */
export function collarPreview(n: number, tex: OffscreenCanvas | null, texKey: string): Promise<string> {
  const name = `nocloth/#Win/collar_${String(n).padStart(3, '0')}.fmdl`
  return memo(`collar:${n}:${texKey}`, () =>
    render3d([{ name: 'nocloth/#Win/shirt_out.fmdl', tex: tex ?? undefined, color: '#888' }, { name, tex: tex ?? undefined, color: '#ddd' }], [1], { dir: [0, 0.45, 1], pad: 0.62 }))
}

export function shortsPreview(n: number, tex: OffscreenCanvas | null, texKey: string): Promise<string> {
  const name = `cloth/#Win/pants_${String(n).padStart(3, '0')}.fmdl`
  return memo(`pants:${n}:${texKey}`, () => render3d([{ name, tex: tex ?? undefined, color: '#c33' }], [0], { dir: [0.35, 0.1, 1], pad: 0.6 }))
}

export function fabricPreview(id: string, color: string, opacity: number, blend: GlobalCompositeOperation, scale: number, img?: ImageBitmap): Promise<string> {
  return memo(`fab:${id}:${color}:${opacity}:${blend}:${scale}`, async () => {
    const { drawFabric } = await import('./compositor/fabric')
    const c = canvas(256, 256), g = ctx2d(c)
    g.fillStyle = color; g.fillRect(0, 0, 256, 256)
    const l = canvas(256, 256), lg = ctx2d(l)
    if (id === 'seams') {
      lg.lineCap = 'round'
      for (const y of [60, 196]) {
        lg.strokeStyle = 'rgba(0,0,0,0.55)'; lg.lineWidth = 7; lg.beginPath(); lg.moveTo(0, y); lg.lineTo(256, y); lg.stroke()
        lg.strokeStyle = 'rgba(255,255,255,0.4)'; lg.lineWidth = 2; lg.setLineDash([9, 7]); lg.beginPath(); lg.moveTo(0, y + 6); lg.lineTo(256, y + 6); lg.stroke(); lg.setLineDash([])
      }
    } else drawFabric(lg, img ?? id, scale * 2.5)
    g.globalAlpha = Math.min(1, opacity * 2)
    g.globalCompositeOperation = blend
    g.drawImage(l, 0, 0)
    return url(c)
  })
}

/** "10" + "ABC" drawn from a number/name texture set. */
export function numberSetPreview(key: string, back: OffscreenCanvas | null, name: OffscreenCanvas | null, backBoxes: { x0: number; y0: number; x1: number; y1: number }[], nameBoxes: { x0: number; y0: number; x1: number; y1: number }[]): Promise<string> {
  return memo(`numset:${key}`, async () => {
    const c = canvas(256, 256), g = ctx2d(c)
    g.fillStyle = '#3a3f4b'; g.fillRect(0, 0, 256, 256)
    const draw = (img: OffscreenCanvas, b: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number, h: number): number => {
      const w = ((b.x1 - b.x0) / Math.max(1, b.y1 - b.y0)) * h
      g.drawImage(img, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, x, y, w, h)
      return w
    }
    if (back && backBoxes.length >= 10) {
      const w1 = ((backBoxes[1].x1 - backBoxes[1].x0) / (backBoxes[1].y1 - backBoxes[1].y0)) * 140
      const w0 = ((backBoxes[0].x1 - backBoxes[0].x0) / (backBoxes[0].y1 - backBoxes[0].y0)) * 140
      let x = 128 - (w1 + w0 + 8) / 2
      x += draw(back, backBoxes[1], x, 90, 140) + 8
      draw(back, backBoxes[0], x, 90, 140)
    }
    if (name && nameBoxes.length >= 3) {
      let x = 128 - 3 * 22
      for (const i of [0, 1, 2]) x += draw(name, nameBoxes[i], x, 30, 46) + 6
    }
    return url(c)
  })
}

/** Shirt model cards (config ShirtModel): simple silhouettes. */
export function shirtModelPreview(id: number, color: string): Promise<string> {
  return memo(`shirtmodel:${id}:${color}`, async () => {
    const c = canvas(256, 256), g = ctx2d(c)
    const sleeve = id === 151 ? 0.62 : id === 176 ? 0.5 : 0.42
    const loose = id === 176 ? 1.12 : id === 160 ? 1.05 : 1
    g.fillStyle = color
    g.strokeStyle = 'rgba(0,0,0,0.35)'
    g.lineWidth = 3
    const w = 110 * loose
    g.beginPath()
    g.moveTo(128 - w / 2, 50)
    g.lineTo(128 - w / 2 - 70 * sleeve, 50 + 160 * sleeve)
    g.lineTo(128 - w / 2 - 70 * sleeve + 34, 50 + 160 * sleeve + 14)
    g.lineTo(128 - w / 2, 110)
    g.lineTo(128 - w / 2 + 4, 226)
    g.lineTo(128 + w / 2 - 4, 226)
    g.lineTo(128 + w / 2, 110)
    g.lineTo(128 + w / 2 + 70 * sleeve - 34, 50 + 160 * sleeve + 14)
    g.lineTo(128 + w / 2 + 70 * sleeve, 50 + 160 * sleeve)
    g.lineTo(128 + w / 2, 50)
    g.lineTo(150, 40); g.quadraticCurveTo(128, 64, 106, 40)
    g.closePath()
    g.fill(); g.stroke()
    return url(c)
  })
}

const SOCKS_FMDL = 'Asset/model/character/#Win/common_package_fpk/Assets/pes16/model/character/common/socks_long.fmdl'
/**
 * 3D preview of a kit design on the game models: the shirt (body, short sleeves, collar), the shorts or the socks.
 * `key` must change whenever the design changes (cached).
 */
export function kitPreview3d(k: KitDesign, assets: Record<string, Asset>, part: 'torso' | 'shorts' | 'socks' | 'cuff' | 'side' | 'shoulder', key: string): Promise<string> {
  return memo('k3d:' + part + ':' + key, async () => {
    const tex = await composeKit(k, assets, { scale: PREVIEW_SCALE })
    if (part === 'torso') {
      const collar = `nocloth/#Win/collar_${String(Number(k.config.Collar ?? 66)).padStart(3, '0')}.fmdl`
      return render3d([{ name: 'nocloth/#Win/shirt_out.fmdl', tex }, { name: 'nocloth/#Win/sleeve_short_001.fmdl', tex }, { name: collar, tex }], [0, 1], { dir: [0.35, 0.12, 1], pad: 0.47 })
    }
    // close-ups: the side of the shirt (side panels) and the shoulder from above (shoulder panels)
    if (part === 'side' || part === 'shoulder') {
      const collar = `nocloth/#Win/collar_${String(Number(k.config.Collar ?? 66)).padStart(3, '0')}.fmdl`
      // shoulder: from the side and a little above, framed on the sleeve so the whole arm shows
      return render3d([{ name: 'nocloth/#Win/shirt_out.fmdl', tex }, { name: 'nocloth/#Win/sleeve_short_001.fmdl', tex }, { name: collar, tex }], part === 'side' ? [0] : [1], part === 'side' ? { dir: [1, 0.05, 0.12], pad: 0.4 } : { dir: [1, 0.55, 0.45], pad: 0.68 })
    }
    // close-up of one sleeve's end (cuffs)
    if (part === 'cuff') return render3d([{ name: 'nocloth/#Win/shirt_out.fmdl', tex }, { name: 'nocloth/#Win/sleeve_short_001.fmdl', tex }], [1], { dir: [1, 0.1, 0.55], pad: 0.36 })
    if (part === 'shorts') return render3d([{ name: `cloth/#Win/pants_${String(Number(k.config.ShortsModel ?? 1)).padStart(3, '0')}.fmdl`, tex }], [0], { dir: [0.35, 0.1, 1], pad: 0.5 })
    return render3d([{ name: SOCKS_FMDL, tex }], [0], { dir: [0.45, 0.1, 1], pad: 0.48 })
  })
}
