/**
 * Turns a KitDesign (v2) into GPU passes (see gpu.ts) and renders the 2048² kit texture.
 * Geometry (patterns, shapes, text) is rasterised once into cached masks; colours, gradients, blending, logo tinting
 * and placement are GPU work, so editing a colour or moving a logo is instant.
 */
import type { CollarStyle, CollarSpec, KitDesign, Asset, LogoPlacement, OverlayLayer, Fill, PatternSpec } from '../model/design'
import { contrastOn, migrateKit, solid, fillMain, luminance, resolveGroups, LOGO_BASE, shortsBase } from '../model/design'
import { S, REGIONS, SPOTS, CLEAN_RECTS, pathOf, TORSO, SEAM, SHORTS_FRAME, SOCK_FRAME, LEGS, sleeveSeam, SLEEVE_SEAMS, PANEL, NECK_HOLE, BACK_AXIS, backY, mirrorX, type Pt } from './uv'
import { drawTorsoPattern, drawSleevePattern, drawShortsPattern, drawSocksPattern, drawTexture } from './patterns'
import { loadAsset, recolor, cleanRects, imgW, imgH, canvas, ctx2d } from './images'
import { drawSeams, fabricTile } from './fabric'
import { drawDesign } from './designs'
import { stitchCanvas } from './stitch'
import { collarModel } from '../three/comet'
import { renderToCanvas, renderToRgba, type Pass, type MaskSrc, type ImageSource, type Clip } from './gpu'

type G = OffscreenCanvasRenderingContext2D

const P = { cuffs: pathOf([...REGIONS.cuffs, ...REGIONS.longCuffs]) }
export const FRONT_CENTER = { x: 1024, y: 1400 }
/**
 * Front frame → sleeve islands. The long sleeves are mapped so that the upper arm gets the same design as the short
 * sleeve at the same place on the body (measured on the game's models: the short sleeve's shoulder→cuff, u 1289→1558,
 * is the long sleeve's u 1359→1575, i.e. 0.8× the texels; top of the arm v 947 / 400); below that the design runs on.
 */
const SLEEVE_FRAMES: [number, number, number, number, number, number][] = [[0, 1, -1, 0, 762, 684], [0, 1, 1, 0, 1286, 684], [0, 1, -1, 0, 691, 124], [0, 1, 1, 0, 1357, 124]]
// short: from the sleeve cap (x 762) to the end of the turned hem; long: the same arm at the measured place
// (short u 1289 → long 1359, 0.93× along the arm; v = short v − 560, measured where both meet the shirt)
const SLEEVE_SIZES = [[534, 341], [534, 341], [534, 317], [534, 317]]

// ---------------------------------------------------------------- mask helpers
/** Geometry key of a layer: everything except colours / opacity / blend / visibility. */
function geomKey(L: OverlayLayer, extra: unknown): string {
  const { color: _c, fill: _f, opacity: _o, blend: _b, visible: _v, id: _i, name: _n, ...g } = L
  return JSON.stringify([g, extra])
}

/** Draw three zone contents into the R / G / B channels of a (black) mask. */
function zoneChannels(g: G, draws: (((l: G) => void) | null)[]): void {
  const cols = ['#ff0000', '#00ff00', '#0000ff']
  draws.forEach((d, i) => {
    if (!d) return
    const c = new OffscreenCanvas(S, S), l = c.getContext('2d')!
    l.fillStyle = l.strokeStyle = '#fff'
    d(l)
    l.globalCompositeOperation = 'source-in'
    l.fillStyle = cols[i]
    l.fillRect(0, 0, S, S)
    g.save()
    g.globalCompositeOperation = 'lighter'
    g.drawImage(c, 0, 0)
    g.restore()
  })
}

function transform(l: G, L: OverlayLayer, cx: number, cy: number): void {
  const z = (L.zoom ?? 100) / 100
  l.translate(cx + (L.dx ?? 0), cy + (L.dy ?? 0))
  l.rotate(((L.rotation ?? 0) * Math.PI) / 180)
  l.scale((L.sx ?? 1) * z, (L.sy ?? 1) * z)
  l.translate(-cx, -cy)
}

/**
 * Where a layer is resized and rotated from: its own middle. Shapes and pen drawings sit somewhere on the shirt (a
 * band at some height, a stripe at some x…), so scaling about the shirt's centre moved them; designs, patterns and
 * textures fill the whole part and keep the part's centre.
 */
function pivot(L: OverlayLayer): [number, number] {
  const sz = L.size ?? 60
  if (L.kind === 'shape') {
    switch (L.shape) {
      case 'band': return [1024, SEAM + (L.y ?? 200)]
      case 'stripeH': return [1024, SEAM + (L.y ?? 300)]
      case 'stripeV': return [L.x ?? 1024, FRONT_CENTER.y]
      case 'shoulders': return [1024, SEAM + sz / 2]
      case 'yoke': case 'collarV': return [1024, SEAM + sz * 1.5]
      case 'hem': return [1024, TORSO.hem - 90 - sz / 2]
      default: return [FRONT_CENTER.x, FRONT_CENTER.y]
    }
  }
  if (L.kind === 'vector') {
    const pts = (L.vpaths ?? []).flatMap((p) => p.pts)
    if (!pts.length) return [FRONT_CENTER.x, FRONT_CENTER.y]
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    return [FRONT_CENTER.x + ((Math.min(...xs) + Math.max(...xs)) / 2) * VECTOR_BOX, FRONT_CENTER.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * VECTOR_BOX]
  }
  return [FRONT_CENTER.x, FRONT_CENTER.y]
}

function drawShape(l: G, L: OverlayLayer): void {
  const sz = L.size ?? 60
  const X0 = TORSO.x0 - 60, W = TORSO.x1 - TORSO.x0 + 120
  switch (L.shape) {
    case 'band': l.fillRect(X0 - 2400, SEAM + (L.y ?? 200) - sz / 2, W + 4800, sz); break
    // long enough to reach the cuffs of the long sleeves when rotated and shown on the sleeves
    case 'stripeH': l.fillRect(X0 - 2400, SEAM + (L.y ?? 300) - sz / 2, W + 4800, sz); break
    case 'stripeV': l.fillRect((L.x ?? 1024) - sz / 2, SEAM - 2400, sz, 6000); break
    case 'panelSides': { const top = PANEL.armpitF, h = SEAM + 1100 - top; l.fillRect(X0, top, sz + 60, h); l.fillRect(TORSO.x1 - sz, top, sz + 60, h); break } // from under the armpit down
    case 'shoulders': l.fillRect(X0, SEAM, W, sz); break
    case 'yoke': l.beginPath(); l.moveTo(X0, SEAM); l.lineTo(1024, SEAM + sz * 3); l.lineTo(X0 + W, SEAM); l.closePath(); l.fill(); break
    case 'hem': l.fillRect(X0, TORSO.hem - 90 - sz, W, sz); break
    case 'collarV': l.beginPath(); l.moveTo(930, SEAM); l.lineTo(1024, SEAM + sz * 3); l.lineTo(1118, SEAM); l.lineWidth = Math.max(4, sz / 3); l.strokeStyle = '#fff'; l.stroke(); break
    case 'cuffs': l.fill(P.cuffs); break
  }
}

/**
 * Panel layers, white on black straight in texture space (they follow the seams of the UV islands, so they line up
 * front ↔ back and torso ↔ sleeve). Width = L.size (texture px).
 */
/**
 * One band of a panel, between a and b across its width (0 … w, from one edge to the other), white on black
 * straight in texture space. Panels follow the seams of the UV islands, so they line up front ↔ back and
 * torso ↔ sleeve. Centred panels (sides, shoulders, shorts side, sock trim) run from −w/2 to w/2 about their seam.
 */
function drawPanelBand(l: G, L: OverlayLayer, a: number, b: number): void {
  const w = Math.max(2, L.size ?? 60)
  // rotation turns each band about its own centre (the mirrored band the other way)
  const ang = ((L.rotation ?? 0) * Math.PI) / 180
  const both = (pts: Pt[], flipAng = false): void => {
    for (const [k, p] of [pts, mirrorX(pts)].entries()) {
      l.save()
      const a = (k ? -ang : ang) * (flipAng ? -1 : 1)
      if (ang) { const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length; l.translate(cx, cy); l.rotate(a); l.translate(-cx, -cy) }
      l.beginPath(); p.forEach(([x, y], i) => (i ? l.lineTo(x, y) : l.moveTo(x, y))); l.closePath(); l.fill()
      l.restore()
    }
  }
  const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  // "Deslocamento": centred panels move across their seam, edge panels (cuffs, hems, fold) away from the edge
  const off = L.dx ?? 0
  a += off; b += off
  const u0 = a - w / 2, u1 = b - w / 2 // centred coordinates
  switch (L.panel) {
    case 'sides': {
      // centred on the side seam (x 704 on both islands): u > 0 = front (below the shoulder seam), u < 0 = back
      const f0 = Math.max(0, u0), f1 = Math.max(0, u1), k0 = Math.max(0, -u1), k1 = Math.max(0, -u0)
      // side panels stop under the armpit: above it the side strip of the torso runs up the armhole to the
      // shoulder (on the 3D shirt that is the curve round the sleeve), so they never reach the shoulder or sleeves
      // a band that starts on the seam bleeds a few px past it (otherwise the texture filter shows a thin line of
      // the shirt colour right on the seam)
      const bleed = (v: number): number => (v <= 0 ? -8 : v)
      if (f1 > f0) both(rect(PANEL.side + bleed(f0), PANEL.armpitF, PANEL.side + f1, TORSO.hem - 100))
      // (the back is the front flipped in the texture: its bands turn the other way so both sides mirror)
      if (k1 > k0) both(rect(PANEL.side + bleed(k0), 40, PANEL.side + k1, PANEL.armpitB), true)
      break
    }
    case 'shoulders': {
      // the short sleeve uses the shirt's own texture coordinates where they meet, so a band over the shoulder goes on
      // down the short sleeve at the same height, in one piece (two pieces at 960 / 952 overlapped at the sleeve cap and
      // their stripes merged into a block); the long sleeve is the same arm 560 texels higher (measured at the armhole)
      const al = L.dy ?? 0, end = Math.min(1024, 1024 + al)
      both(rect(L.panelSleeve ? PANEL.shortCuff - 10 : PANEL.side + al, PANEL.shoulderY + u0, end, PANEL.shoulderY + u1))
      if (L.panelSleeve) both(rect(0, PANEL.shoulderY - 560 + u0, PANEL.longShoulder, PANEL.shoulderY - 560 + u1))
      // runs right across the top of the shirt (through the neck, which the collar covers): no cut at the neck
      break
    }
    case 'neck': {
      const xs = NECK_HOLE.map((p) => p[0]), ys = NECK_HOLE.map((p) => p[1])
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const rx = (Math.max(...xs) - Math.min(...xs)) / 2, ry = (Math.max(...ys) - Math.min(...ys)) / 2
      l.beginPath(); l.ellipse(cx, cy, rx + b, ry + b, 0, 0, Math.PI * 2); l.fill()
      l.save(); l.globalCompositeOperation = 'destination-out'
      l.beginPath(); l.ellipse(cx, cy, rx + a, ry + a, 0, 0, Math.PI * 2); l.fill()
      l.restore()
      break
    }
    case 'cuffs':
      // from the end of each sleeve inwards: short sleeves end at x ≈490, long sleeves at x ≈8
      both(rect(PANEL.shortCuff + (a ? a : -70), 690, PANEL.shortCuff + b, 1216))
      both(rect(a ? PANEL.longCuff + a : 0, 170, PANEL.longCuff + b, 610))
      break
    case 'shortsHem': both(rect(a ? LEGS[0].hem + a : 0, SHORTS_FRAME.innerTop - 10, LEGS[0].hem + b, SHORTS_FRAME.innerBottom + 10)); break
    case 'shortsSides': both(rect(0, SHORTS_FRAME.side + u0, LEGS[0].waist + 40, SHORTS_FRAME.side + u1)); break
    case 'sockFold': both(rect(0, a ? 640 + a : 630, SOCK_FRAME[0].x1 + 10, 640 + b)); break
    case 'sockTrim': { const y = 640 + (L.y ?? 84); both(rect(0, y + u0, SOCK_FRAME[0].x1 + 10, y + u1)); break }
  }
}

/** The bands of a panel design, per colour slot: [colour 0 bands, colour 1 bands], each band = [a, b]. */
function panelBands(L: OverlayLayer): [number, number][][] {
  const w = Math.max(2, L.size ?? 60)
  const n = Math.max(1, L.pcount ?? 3), gap = Math.max(0, L.pgap ?? Math.round(w / (n * 3)))
  switch (L.pstyle ?? 'solid') {
    case 'stripes': case 'stripes2c': {
      const sw = Math.max(1, (w - gap * (n - 1)) / n)
      const c0: [number, number][] = [], c1: [number, number][] = []
      for (let i = 0; i < n; i++) (L.pstyle === 'stripes2c' && i % 2 ? c1 : c0).push([i * (sw + gap), i * (sw + gap) + sw])
      return [c0, c1]
    }
    case 'border': { const bw = Math.max(1, gap || w * 0.18); return [[[0, w]], [[bw, w - bw]]] }
    case 'tipped': { const bw = Math.max(1, L.pgap ?? 10); return [[[0, w]], [[w - bw, w]]] }
    case 'twoTone': return [[[0, w / 2]], [[w / 2, w]]]
    case 'center': { const cw = Math.max(1, gap || w * 0.25); return [[[0, w]], [[(w - cw) / 2, (w + cw) / 2]]] }
    default: return [[[0, w]], []]
  }
}

/** Whole panel (every band), e.g. when another layer uses it as a mask. */
function drawPanel(l: G, L: OverlayLayer): void {
  const w = Math.max(2, L.size ?? 60)
  drawPanelBand(l, L, 0, w)
}

/** Images used by custom-pattern layers, loaded before the masks are drawn (mask drawing is synchronous). */
const tileImgs = new Map<string, ImageSource>()
const tileCells = new Map<string, OffscreenCanvas>()
/** One repeat of a custom pattern: the motif fitted in a `size` box plus `gap` px of spacing. */
function tileCell(L: OverlayLayer): OffscreenCanvas | null {
  const img = L.assetId ? tileImgs.get(L.assetId) : undefined
  if (!img) return null
  const size = Math.max(8, L.size ?? 160), gap = Math.max(0, L.gap ?? 0)
  const key = [L.assetId, size, gap].join(':')
  let c = tileCells.get(key)
  if (!c) {
    const iw = imgW(img), ih = imgH(img), r = Math.min(size / Math.max(1, iw), size / Math.max(1, ih))
    const w = Math.max(1, Math.round(iw * r)), h = Math.max(1, Math.round(ih * r))
    c = new OffscreenCanvas(w + gap, h + gap)
    c.getContext('2d')!.drawImage(img as CanvasImageSource, gap / 2, gap / 2, w, h)
    if (tileCells.size > 40) tileCells.clear()
    tileCells.set(key, c)
  }
  return c
}

/** Free drawing: round strokes in texture space (erase strokes paint black = no layer), optional symmetric copy. */
function drawStrokes(l: G, L: OverlayLayer): void {
  l.lineCap = l.lineJoin = 'round'
  const copies = L.mirrorCenter ? [false, true] : [false]
  // rotation about the drawing's centre (the mirrored copy turns the other way)
  const ang = ((L.rotation ?? 0) * Math.PI) / 180
  let cx = 0, cy = 0, n = 0
  if (ang) for (const st of L.strokes ?? []) for (let i = 0; i < st.pts.length; i += 2) { cx += st.pts[i]; cy += st.pts[i + 1]; n++ }
  if (n) { cx /= n; cy /= n }
  for (const flip of copies) {
    l.save()
    if (n) { const x = flip ? 2048 - cx : cx; l.translate(x, cy); l.rotate(flip ? -ang : ang); l.translate(-x, -cy) }
    for (const st of L.strokes ?? []) drawStroke(l, st, flip)
    l.restore()
  }
}

function drawStroke(l: G, st: NonNullable<OverlayLayer['strokes']>[number], flip: boolean): void {
  {
    const p = st.pts
    if (p.length < 2) return
    l.strokeStyle = l.fillStyle = st.erase ? '#000' : '#fff'
    l.lineWidth = st.w
    const X = (x: number): number => (flip ? 2048 - x : x)
    if (p.length === 2) { l.beginPath(); l.arc(X(p[0]), p[1], st.w / 2, 0, Math.PI * 2); l.fill(); return }
    l.beginPath(); l.moveTo(X(p[0]), p[1])
    for (let i = 2; i < p.length; i += 2) l.lineTo(X(p[i]), p[i + 1])
    l.stroke()
  }
}

/** Vector drawings: the unit box is drawn this many px wide (before the layer's size / scale). */
export const VECTOR_BOX = 400
/** Closed paths are filled, open ones stroked; segments are cubic Béziers when the anchors have handles. */
export function drawVector(l: G, L: OverlayLayer): void {
  for (const p of L.vpaths ?? []) {
    if (p.pts.length < 2) continue
    l.beginPath()
    l.moveTo(p.pts[0].x, p.pts[0].y)
    const seg = (a: typeof p.pts[0], b: typeof p.pts[0]): void => {
      if (a.ox !== undefined || b.ix !== undefined) l.bezierCurveTo(a.ox ?? a.x, a.oy ?? a.y, b.ix ?? b.x, b.iy ?? b.y, b.x, b.y)
      else l.lineTo(b.x, b.y)
    }
    for (let i = 1; i < p.pts.length; i++) seg(p.pts[i - 1], p.pts[i])
    if (p.closed) { seg(p.pts[p.pts.length - 1], p.pts[0]); l.closePath(); l.fill() }
    else { l.lineWidth = (L.strokeW ?? 8) / VECTOR_BOX; l.lineCap = l.lineJoin = 'round'; l.stroke() }
  }
}

/** True while a layer is painted in its own colours (RGBA passes) instead of as a white mask. */
let paintColors = false
/** True while drawing into a mirrored part frame (right sock): text is flipped back so it reads the right way. */
let unflipText = false

/** White content of a non-image layer in the torso FRONT frame. */
function frontContent(l: G, L: OverlayLayer): void {
  l.fillStyle = l.strokeStyle = '#fff'
  if (L.kind === 'vector') {
    l.save()
    l.translate(FRONT_CENTER.x, FRONT_CENTER.y); l.scale(VECTOR_BOX, VECTOR_BOX)
    drawVector(l, L)
    l.restore()
  } else if (L.kind === 'design') {
    l.save()
    drawDesign(l, L, paintColors ? (i) => L.colors?.[i] ?? L.color : () => '#ffffff', !paintColors)
    l.restore()
  } else if (L.kind === 'image' && L.fit === 'tile') {
    const cell = tileCell(L)
    if (cell) { l.fillStyle = l.createPattern(cell, 'repeat')!; l.fillRect(TORSO.x0 - 1400, SEAM - 1400, TORSO.x1 - TORSO.x0 + 2800, 3800) }
  } else if (L.kind === 'texture' && L.pattern) drawTexture(l, L.pattern, TORSO.x0 - 700, SEAM - 700, TORSO.x1 + 700, TORSO.hem + 700, L.scale ?? 70, L.stroke, L.lineWidth)
  else if (L.kind === 'shape') drawShape(l, L)
  else if (L.kind === 'text' && L.text) {
    l.save()
    l.translate(L.x ?? 1024, L.y ?? 1100)
    if (unflipText) l.scale(-1, 1)
    l.rotate(((L.rotation ?? 0) * Math.PI) / 180)
    l.scale((L.sx ?? 1) * (L.zoom ?? 100) / 100, (L.sy ?? 1) * (L.zoom ?? 100) / 100)
    drawTextBody(l, L)
    l.restore()
  }
}

/**
 * A text layer's line centred on the origin: font, italic, letter spacing, arch (letters laid on an arc) and an
 * optional outline in its own colour (white when drawn as a mask).
 */
function drawTextBody(l: G, L: OverlayLayer): void {
  const size = L.size ?? 60, text = L.text ?? ''
  l.font = `${L.italic ? 'italic ' : ''}bold ${size}px "${L.font ?? 'Arial Black'}"`
  l.textAlign = 'center'
  l.textBaseline = 'middle'
  l.lineJoin = 'round'
  const fillC = paintColors ? fillMain(L.fill, L.color) : '#fff'
  const strokeC = paintColors ? L.borderColor ?? contrastOn(fillMain(L.fill, L.color)) : '#fff'
  const lw = L.border ? ((L.borderW ?? 2) * size) / 12 : 0
  const spacing = ((L.letterSpacing ?? 0) * size) / 200
  const glyph = (ch: string, x: number, y: number): void => {
    if (lw) { l.strokeStyle = strokeC; l.lineWidth = lw; l.strokeText(ch, x, y) }
    l.fillStyle = fillC; l.fillText(ch, x, y)
  }
  const arch = L.arch ?? 0
  if (!arch && !spacing) { glyph(text, 0, 0); return }
  // lay the letters out one by one (spacing / arch)
  const chars = [...text], widths = chars.map((c) => l.measureText(c).width + spacing)
  const total = widths.reduce((a, b) => a + b, 0) - spacing
  if (!arch) { let x = -total / 2; chars.forEach((c, i) => { glyph(c, x + (widths[i] - spacing) / 2, 0); x += widths[i] }); return }
  const span = (Math.abs(arch) / 150) * Math.PI, R = total / Math.max(0.01, span), sgn = arch > 0 ? 1 : -1
  let pos = -total / 2
  chars.forEach((c, i) => {
    const mid = pos + (widths[i] - spacing) / 2, a = mid / R
    l.save()
    // arch > 0: the line bends into an arch (centre of the circle below the text)
    l.translate(Math.sin(a) * R, sgn * (R - Math.cos(a) * R))
    l.rotate(sgn * a)
    glyph(c, 0, 0)
    l.restore()
    pos += widths[i]
  })
}

/** Where a text placement puts the text straight in texture space (sleeves, sides, armband, back of the collar). */
const SLEEVE_TXT = { R: [{ x: 578, y: 975, rot: Math.PI / 2 }, { x: 521, y: 415, rot: Math.PI / 2 }], L: [{ x: 1470, y: 975, rot: -Math.PI / 2 }, { x: 1527, y: 415, rot: -Math.PI / 2 }] }
type TextSpot = { x: number; y: number; rot: number; flip?: boolean; clip: Clip }
function textSpots(L: OverlayLayer): TextSpot[] {
  const sl = (s: 'L' | 'R', extra: Partial<TextSpot> = {}): TextSpot[] => SLEEVE_TXT[s].map((p) => ({ ...p, clip: 'sleeves' as Clip, flip: extra.flip, rot: p.rot + (extra.rot ?? 0) }))
  const side = (s: 'L' | 'R', extra: Partial<TextSpot> = {}): TextSpot => ({ x: s === 'R' ? 748 : 1300, y: 1520, rot: s === 'R' ? -Math.PI / 2 : Math.PI / 2, clip: 'front' as Clip, ...extra })
  switch (L.placement) {
    case 'sleeveL': return sl('L')
    case 'sleeveR': return sl('R')
    case 'sleeves': return [...sl('L'), ...sl('R')]
    case 'sleevesMirror': return [...sl('L'), ...sl('R', { flip: true, rot: Math.PI })]
    case 'sleevesInv': return [...sl('L'), ...sl('R', { rot: Math.PI })]
    case 'sideR': return [side('R')]
    case 'sideL': return [side('L')]
    case 'sides': return [side('R'), side('L')]
    case 'sidesMirror': return [side('R'), side('L', { rot: -Math.PI / 2, flip: true })]
    case 'sidesMirrorInv': return [side('R'), side('L', { flip: true })]
    case 'armband': return [{ x: 256, y: 64, rot: 0, clip: 'armband' }]
    case 'backCollar': return [{ x: 1024, y: 1945, rot: 0, clip: 'collar' }]
    default: return []
  }
}
const SPOT_TEXT = ['sleeveL', 'sleeveR', 'sleeves', 'sleevesMirror', 'sleevesInv', 'sideR', 'sideL', 'sides', 'sidesMirror', 'sidesMirrorInv', 'armband', 'backCollar']
export const isSpotText = (L: OverlayLayer): boolean => L.kind === 'text' && SPOT_TEXT.includes(L.placement ?? '')

function spotTextPasses(out: Pass[], L: OverlayLayer, op: number, blend: GlobalCompositeOperation | undefined, fill: Fill, mask2?: MaskSrc, mask2Invert?: boolean): void {
  const byClip = new Map<Clip, TextSpot[]>()
  for (const s of textSpots(L)) byClip.set(s.clip, [...(byClip.get(s.clip) ?? []), s])
  const ox = (L.x ?? 1024) - 1024, oy = (L.y ?? 1400) - 1400
  for (const [clip, spots] of byClip) {
    const draw = (g: G): void => {
      for (const s of spots) {
        g.save()
        g.translate(s.x, s.y); g.rotate(s.rot)
        if (s.flip) g.scale(-1, 1)
        g.translate(ox, oy)
        g.rotate(((L.rotation ?? 0) * Math.PI) / 180)
        g.scale((L.sx ?? 1) * (L.zoom ?? 100) / 100, (L.sy ?? 1) * (L.zoom ?? 100) / 100)
        drawTextBody(g, L)
        g.restore()
      }
    }
    const key = 'spotText:' + clip + geomKey(L, 0)
    if (L.border) {
      out.push({
        t: 'rgba', key: key + JSON.stringify([L.color, L.fill, L.borderColor]), clip, opacity: op, blend, mask2, mask2Invert, img: () => {
          const c = new OffscreenCanvas(S, S), g = c.getContext('2d')!
          paintColors = true
          try { draw(g) } finally { paintColors = false }
          return c
        }
      })
    } else out.push({ t: 'fill', fill, clip, opacity: op, blend, mask2, mask2Invert, mask: { key, draw: blurred(L, draw) } })
  }
}

// ---------------------------------------------------------------- image placement
/** ox / oy: where offset 0 is, relative to the spot (LOGO_BASE), in the same frame as the logo's own dx / dy. */
interface Spot { x: number; y: number; rot: number; flipDx?: boolean; ox?: number; oy?: number; ky?: number /* scale of y offsets and of the logo's height */ }

function fitted(img: ImageSource, cx: number, cy: number, box: number, rot: number): { cx: number; cy: number; w: number; h: number; rot: number } {
  const w = imgW(img as ImageBitmap), h = imgH(img as ImageBitmap), r = Math.min(box / Math.max(1, w), box / Math.max(1, h))
  return { cx, cy, w: w * r, h: h * r, rot }
}

function tintOf(lp: LogoPlacement, bg: string): { tint: 'original' | 'color' | 'bw'; color?: string } {
  switch (lp.tint) {
    case 'original': return { tint: 'original' }
    case 'bw': return { tint: 'bw' }
    case 'mono': return { tint: 'color', color: lp.color ?? '#ffffff' }
    case 'white': return { tint: 'color', color: '#ffffff' }
    case 'black': return { tint: 'color', color: '#111111' }
    default: return { tint: 'color', color: luminance(bg) > 150 ? '#111111' : '#ffffff' }
  }
}

async function logoPassesOne(out: Pass[], lp: LogoPlacement | undefined, assets: Record<string, Asset>, spots: Spot[], bg: string, clip: Clip): Promise<void> {
  if (!lp?.enabled || !lp.assetId || !assets[lp.assetId]) return
  const img = await loadAsset(assets[lp.assetId])
  const t = tintOf(lp, bg)
  const ow = lp.outlineWidth && lp.outlineWidth > 0 ? lp.outlineWidth : 0
  for (const s of spots) {
    // offsets are in the logo's own upright frame; mirrored spots flip dx so "forward" is the same on both sides
    const dx = (s.flipDx ? -1 : 1) * (lp.dx + (s.ox ?? 0)), dy = (lp.dy + (s.oy ?? 0)) * (s.ky ?? 1)
    const c = Math.cos(s.rot), sn = Math.sin(s.rot)
    const f = fitted(img, s.x + dx * c - dy * sn, s.y + dx * sn + dy * c, lp.size, s.rot)
    f.h *= s.ky ?? 1
    const place = { img, ...f, ...t, outlineWidth: ow, outlineColor: lp.outlineColor ?? contrastOn(bg) }
    out.push({ t: 'image', clip, place })
    // sleeves: the island's top and bottom edges are the underarm seam, so a logo that crosses one edge
    // continues from the other (otherwise that part lands on texels the model never shows and looks cut)
    const seam = clip === 'sleeves' || clip === 'zones' ? sleeveSeam(f.cx, f.cy) : null
    if (seam) {
      const hy = (Math.abs(f.w * Math.sin(f.rot)) + Math.abs(f.h * Math.cos(f.rot))) / 2 + ow
      const period = seam.bottom - seam.top
      if (f.cy - hy < seam.top) out.push({ t: 'image', clip, place: { ...place, cy: f.cy + period } })
      if (f.cy + hy > seam.bottom) out.push({ t: 'image', clip, place: { ...place, cy: f.cy - period } })
    }
  }
}

/**
 * Shorts spots, flat in 2D on each leg's UV island (see SHORTS_FRAME): x runs along the leg (waist → hem), y around it.
 * Left leg (texture x > 1024) is drawn rotated −90°, right leg +90°, so logos stand upright on the body.
 * Logos across the centre seams (bum / fly) are drawn on both islands, straddling the island edge; each half is clipped.
 */
function shortsSpots(lp: LogoPlacement, kind: 'leg' | 'back' | 'middle' | 'backLeg', side: 'left' | 'right' | 'both', h: number, base?: 'shortsCrest' | 'shortsBrand'): Spot[] {
  const F = SHORTS_FRAME
  const o = (leg: 'left' | 'right'): Partial<Spot> => { if (!base) return {}; const [ox, oy] = shortsBase(base, leg); return { ox, oy } }
  const left = (d: number, y: number): Spot => ({ x: LEGS[1].waist + d, y, rot: -Math.PI / 2, ...o('left') })
  // dx is "to the viewer's right" on both legs (as seen from the front)
  const right = (d: number, y: number): Spot => ({ x: LEGS[0].waist - d, y, rot: Math.PI / 2, ...o('right') })
  const sides = (d: number, y: number): Spot[] => (side === 'both' ? [left(d, y), right(d, y)] : side === 'left' ? [left(d, y)] : [right(d, y)])
  switch (kind) {
    case 'back': return [left(60 + h / 2, F.bumSeam), right(60 + h / 2, F.bumSeam)]
    case 'middle': return [left(70 + h / 2, F.flySeam), right(70 + h / 2, F.flySeam)]
    case 'backLeg': return sides(LEGS[1].hem - LEGS[1].waist - 70 - h / 2, F.back)
    default: return sides(LEGS[1].hem - LEGS[1].waist - 70 - h / 2, F.front)
  }
}

/** Socks: upright (x around the leg, y down the leg), front-outer side of each sock. */
function socksSpots(): Spot[] {
  return [
    { x: (SOCK_FRAME[0].front + SOCK_FRAME[0].outer) / 2, y: 935, rot: 0, flipDx: true, ox: LOGO_BASE.socks[0], oy: LOGO_BASE.socks[1] },
    { x: (SOCK_FRAME[1].front + SOCK_FRAME[1].outer) / 2, y: 935, rot: 0, ox: LOGO_BASE.socks[0], oy: LOGO_BASE.socks[1] }
  ]
}

/** Long sleeves: the short sleeve's badge spot at the same place on the arm (see SLEEVE_FRAMES); along the arm the
 *  long sleeve has 0.8× the texels, so offsets and the logo's height along the arm shrink by that much. */
const LONG_BADGES: Spot[] = [{ x: 521, y: 415, rot: Math.PI / 2, ky: 0.93 }, { x: 1527, y: 415, rot: -Math.PI / 2, flipDx: true, ky: 0.93 }]

// ---------------------------------------------------------------- layers
/**
 * Shorts and socks layers are designed in the same upright "front frame" as the shirt (x 664..1384 across,
 * y 960..1960 down) and mapped onto each leg's UV island, so up is up on the body and x runs to the viewer's right.
 * Canvas transforms [a, b, c, d, e, f]: texture = (a·x + c·y + e, b·x + d·y + f).
 */
export const FX = TORSO.x0 - 40, FW = TORSO.x1 - TORSO.x0 + 80 // 664, 720
const legFrame = (left: boolean): [number, number, number, number, number, number] => {
  const ku = 607 / 1000, kv = 779 / FW
  return left
    ? [0, -kv, ku, 0, LEGS[1].waist - SEAM * ku, SHORTS_FRAME.innerBottom + FX * kv] // u = 1408 + (y-960)·ku, v = 1946 − (x−664)·kv
    : [0, kv, -ku, 0, LEGS[0].waist + SEAM * ku, SHORTS_FRAME.innerTop - FX * kv] // u = 640 − (y−960)·ku, v = 1167 + (x−664)·kv
}
/** The two sock islands are mirror images (right leg: front at x 264, left leg: front at x 1780), so the right
 *  sock's frame is flipped (like the logos' flipDx): text and images then sit on the same side of both legs and read
 *  the right way round. */
const sockFrame = (x0: number, flip = false): [number, number, number, number, number, number] => {
  const kx = 360 / FW, ky = 510 / 1000
  return flip ? [-kx, 0, 0, ky, x0 + 360 + FX * kx, 640 - SEAM * ky] : [kx, 0, 0, ky, x0 - FX * kx, 640 - SEAM * ky]
}
export const PART_FRAMES: Record<'shorts' | 'socks', [number, number, number, number, number, number][]> = {
  shorts: [legFrame(true), legFrame(false)],
  socks: [sockFrame(1678), sockFrame(10, true)]
}
const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** Optional warp (arc / flag / wave) applied by re-drawing the layer in thin slices. */
function withWarp(l: G, L: OverlayLayer, draw: (g: G) => void): void {
  const w = L.warp
  if (!w || w.kind === 'none' || !w.amount) { draw(l); return }
  const c = new OffscreenCanvas(S, S), g = c.getContext('2d')!
  g.fillStyle = g.strokeStyle = '#fff'
  draw(g)
  const a = w.amount
  if (w.kind === 'flag') {
    for (let y = 0; y < S; y += 4) l.drawImage(c, 0, y, S, 4, a * Math.sin(((y - SEAM) / 500) * Math.PI * 2), y, S, 4)
  } else {
    for (let x = 0; x < S; x += 4) {
      const t = (x - 1024) / 380
      const dy = w.kind === 'arc' ? -a * (1 - Math.min(1, t * t)) : a * Math.sin(((x - 1024) / 320) * Math.PI * 2)
      l.drawImage(c, x, 0, 4, S, x, dy, 4, S)
    }
  }
}

/** Mirror options: flip left ↔ right about the centre line, and / or add the mirrored copy (symmetric design). */
function withMirror(l: G, L: OverlayLayer, draw: (g: G) => void): void {
  const flip = (g: G): void => { g.translate(2 * FRONT_CENTER.x, 0); g.scale(-1, 1) }
  l.save(); if (L.flipX) flip(l); draw(l); l.restore()
  if (L.mirrorCenter) { l.save(); if (!L.flipX) flip(l); draw(l); l.restore() }
}

/** Soft edges: redraw the mask through a canvas blur filter. */
function blurred(L: OverlayLayer, draw: (g: G) => void): (g: G) => void {
  const b = L.blur ?? 0
  if (b <= 0) return draw
  return (g) => {
    const c = new OffscreenCanvas(S, S), t = c.getContext('2d')!
    t.fillStyle = '#000'; t.fillRect(0, 0, S, S)
    t.fillStyle = t.strokeStyle = '#fff'
    draw(t)
    g.save(); g.filter = `blur(${b}px)`; g.drawImage(c, 0, 0); g.restore()
  }
}

function drawFrontLayer(l: G, L: OverlayLayer): void {
  withMirror(l, L, (m) => drawFrontLayerRaw(m, L))
}

function drawFrontLayerRaw(l: G, L: OverlayLayer): void {
  withWarp(l, L, (g) => {
    g.save()
    g.fillStyle = g.strokeStyle = '#fff'
    if (L.kind === 'pattern' && L.pattern) {
      transform(g, L, FRONT_CENTER.x, FRONT_CENTER.y)
      g.beginPath(); g.rect(-4000, SEAM, 10000, 6000); g.clip()
      drawTorsoPattern(g, { id: L.pattern, color: '#fff', count: L.count ?? 3, width: L.width ?? 40, stripeW: L.stripeW, gap: L.gap, offset: L.offset })
    } else if (L.kind === 'texture' || L.kind === 'shape' || L.kind === 'design' || L.kind === 'vector' || (L.kind === 'image' && L.fit === 'tile')) {
      const [px, py] = pivot(L)
      transform(g, L, px, py)
      frontContent(g, L)
    } else frontContent(g, L)
    g.restore()
  })
}

/**
 * A shirt layer on the sleeves, continuing the shirt: the game's short sleeve uses the same texture coordinates as the
 * shirt where they meet (armhole), so the front drawing goes on as it is all round the sleeve island (the back half is
 * the front drawing flipped only with "Espelhar nas costas"); the long sleeve is the same arm moved in the texture
 * (measured at the armhole: u + 70 away from the shirt, v − 560) and 0.93× along the arm. Stripes over the shoulder
 * therefore run on down the sleeves without a step.
 */
function sleeveContinue(l: G, L: OverlayLayer): void {
  // one drawing all round each sleeve: the front drawing, straight (front and back of the sleeve are only mirrored
  // with "Espelhar nas costas"); the layer's rotation turns it about each sleeve, the right one the other way
  const rot = ((L.rotation ?? 0) * Math.PI) / 180
  const onlySleeves = (L.zones ?? []).length === 1
  // "Espelhar" on a sleeves-only layer: on both sleeves
  const flat: OverlayLayer = { ...L, rotation: 0, ...(onlySleeves && L.flipX ? { flipX: undefined, mirrorCenter: true } : {}) }
  const front = (g: G): void => drawFrontLayer(g, flat)
  const back = (g: G): void => { g.translate(0, 2 * BACK_AXIS); g.scale(1, -1); drawFrontLayer(g, flat) }
  const islands: [number, number, number, number, ((g: G) => void) | null][] = [
    [420, 684, 766, 1218, null], [1282, 684, 1628, 1218, null],
    ...(L.shortOnly ? [] : [
      [0, 128, 700, 656, (g: G) => { g.translate(689 - 0.93 * 759, -560); g.scale(0.93, 1) }],
      [1348, 128, 2048, 656, (g: G) => { g.translate(1359 - 0.93 * 1289, -560); g.scale(0.93, 1) }]
    ] as [number, number, number, number, (g: G) => void][])
  ]
  for (const [x0, y0, x1, y1, tf] of islands) {
    l.save()
    l.beginPath(); l.rect(x0, y0, x1 - x0, y1 - y0); l.clip()
    if (tf) tf(l)
    const right = x0 > 1024, cx = right ? 1456 : 592
    // rotation about the short sleeve's middle on the top of the arm (the long sleeve is the same arm)
    const turn = (g: G): void => { if (rot) { g.translate(cx, BACK_AXIS); g.rotate(right ? -rot : rot); g.translate(-cx, -BACK_AXIS) } }
    if (L.mirrorBack) {
      for (const [y, h, draw] of [[BACK_AXIS, S, front], [0, BACK_AXIS, back]] as [number, number, (g: G) => void][]) {
        l.save(); l.beginPath(); l.rect(0, y, S, h - y); l.clip(); turn(l); draw(l); l.restore()
      }
    } else { turn(l); front(l) }
    l.restore()
  }
}

/** Per-zone drawings of a shirt layer (front, back, sleeves), each in texture space. */
function zoneDraws(L: OverlayLayer): (((l: G) => void) | null)[] {
  const zones = L.zones ?? ['front', 'back']
  const textual = L.kind === 'text'
  return [
        zones.includes('front') ? (l) => drawFrontLayer(l, L) : null,
        zones.includes('back') ? (l) => {
          // graphics flip vertically about the seam (sides line up); text rotates 180° to read from behind
          // (mirrored about BACK_AXIS: on the game's shirt that is where front and back meet at the side seams)
          if (textual) { l.translate(1024, BACK_AXIS); l.rotate(Math.PI); l.translate(-1024, -BACK_AXIS) } else { l.translate(0, 2 * BACK_AXIS); l.scale(1, -1) }
          if (L.mirrorBack) { l.translate(2048, 0); l.scale(-1, 1) }
          drawFrontLayer(l, L)
        } : null,
        zones.includes('sleeves') && !textual && L.sleeveMap === 'continue' ? (l) => sleeveContinue(l, L) : zones.includes('sleeves') && !textual ? (l) => {
          // the front design drawn once on each sleeve: torso width → around the arm (its middle on the top of the arm),
          // shoulder→hem → shoulder→cuff; the right sleeve is the left one mirrored (so is a rotation); "Espelhar" on a
          // sleeves-only layer = on both sleeves (it is on both already)
          for (let i = 0; i < (L.shortOnly ? 2 : SLEEVE_FRAMES.length); i++) {
            l.save()
            // each sleeve keeps to its own island (the long sleeves' drawing used to spill over the short ones:
            // stripes doubled and out of line)
            { const [x0, y0, x1, y1] = SLEEVE_RECTS[i]; l.beginPath(); l.rect(x0, y0, x1 - x0, y1 - y0); l.clip() }
            l.transform(...SLEEVE_FRAMES[i])
            const [w, h] = SLEEVE_SIZES[i]
            l.scale(w / FW, h / 1000)
            l.translate(-FX, -SEAM)
            drawFrontLayer(l, L)
            l.restore()
          }
        } : null
  ]
}

/** Shorts / socks: the layer drawn once per leg frame. */
function partDraw(L: OverlayLayer, part: string): (l: G) => void {
  const frames = part === 'shorts' || part === 'socks' ? PART_FRAMES[part] : null
  return (l) => {
    if (!frames) { l.save(); transform(l, L, 1024, 1024); frontContent(l, L); l.restore(); return }
    const even = (L.kind === 'image' && L.fit === 'tile') || L.kind === 'texture'
    for (const m of frames) {
      l.save(); l.transform(...m)
      if (even) {
        const ax = Math.hypot(m[0], m[1]), ay = Math.hypot(m[2], m[3]), k = Math.sqrt(ax * ay)
        l.translate(FRONT_CENTER.x, FRONT_CENTER.y); l.scale(k / ax, k / ay); l.translate(-FRONT_CENTER.x, -FRONT_CENTER.y)
      }
      // mirrored frame (right sock): the layer lands on the same side of the leg, but text keeps reading normally
      unflipText = m[0] * m[3] - m[1] * m[2] < 0
      try { drawFrontLayer(l, L) } finally { unflipText = false }
      l.restore()
    }
  }
}

/** Cached mask of a non-image layer (zones in R/G/B for the shirt, R for shorts / socks). */
/**
 * The mask a layer uses ("Máscara"): another layer, or a group = all its visible members together (the groups
 * themselves are gone from the resolved list, their members keep the group id).
 */
function refMask(L: OverlayLayer, all: OverlayLayer[], s2s: boolean): MaskSrc | undefined {
  if (!L.maskLayer) return undefined
  const one = all.find((x) => x.id === L.maskLayer && x.id !== L.id)
  if (one) return layerMask(one, s2s) ?? undefined
  const masks = all.filter((x) => x.group === L.maskLayer && x.id !== L.id && x.visible).map((x) => layerMask(x, s2s)).filter((m): m is MaskSrc => !!m)
  if (masks.length <= 1) return masks[0]
  // zone masks keep front / back / sleeves in R / G / B; a plain mask is white in all three, so adding them works
  return {
    key: 'group:' + masks.map((m) => m.key).join('|'),
    zones: masks.some((m) => m.zones),
    draw: (g) => {
      for (const m of masks) {
        const c = new OffscreenCanvas(S, S), t = c.getContext('2d')!
        t.fillStyle = '#000'; t.fillRect(0, 0, S, S)
        t.fillStyle = t.strokeStyle = '#fff'
        m.draw(t)
        g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(c, 0, 0); g.restore()
      }
    }
  }
}

function layerMask(L: OverlayLayer, s2s: boolean): MaskSrc | null {
  if (L.kind === 'image' && L.fit !== 'tile') return null
  if (L.kind === 'panel') return { key: 'panel:' + geomKey(L, 0), draw: blurred(L, (g) => drawPanel(g, L)) }
  if (L.kind === 'freeform') return { key: 'free:' + geomKey(L, 0), draw: blurred(L, (g) => drawStrokes(g, L)) }
  const part = L.part === 'shirt' ? 'torso' : L.part
  if (part === 'torso') {
    const zones = L.zones ?? ['front', 'back']
    return { key: 'layer:' + geomKey(L, [zones, s2s]), zones: true, draw: blurred(L, (g) => zoneChannels(g, zoneDraws(L))) }
  }
  return { key: 'part2:' + geomKey(L, s2s), draw: blurred(L, partDraw(L, part)) }
}

/** Custom pattern in its own colours: one RGBA canvas per shirt zone (or one for shorts / socks). */
function tileRgbaPasses(out: Pass[], L: OverlayLayer, part: string, op: number, blend: GlobalCompositeOperation | undefined, mask2?: MaskSrc, mask2Invert?: boolean): void {
  const paint = (draw: (l: G) => void): OffscreenCanvas => {
    const c = new OffscreenCanvas(S, S), g = c.getContext('2d')!
    paintColors = true
    try { draw(g) } finally { paintColors = false }
    if (!(L.blur ?? 0)) return c
    const b = new OffscreenCanvas(S, S), bg = b.getContext('2d')!
    bg.filter = `blur(${L.blur}px)`; bg.drawImage(c, 0, 0)
    return b
  }
  const key = 'tileRGBA:' + geomKey(L, 0)
  if (part === 'torso') {
    const clips: Clip[] = ['front', 'back', 'sleeves']
    zoneDraws(L).forEach((d, i) => { if (d) out.push({ t: 'rgba', key: key + i, img: () => paint(d), clip: clips[i], opacity: op, blend, mask2, mask2Invert }) })
  } else out.push({ t: 'rgba', key, img: () => paint(partDraw(L, part)), clip: part as Clip, opacity: op, blend, mask2, mask2Invert })
}

const blurCache = new WeakMap<object, Map<number, OffscreenCanvas>>()
/** Image blurred by `b` image px, padded so the soft edge isn't cut (returns the padded canvas and its growth). */
function blurredImg(img: ImageSource, b: number): { img: ImageSource; grow: number } {
  const iw = imgW(img), ih = imgH(img), pad = Math.ceil(b * 2)
  let m = blurCache.get(img as object)
  if (!m) { m = new Map(); blurCache.set(img as object, m) }
  let c = m.get(pad)
  if (!c) {
    c = new OffscreenCanvas(iw + pad * 2, ih + pad * 2)
    const g = c.getContext('2d')!
    g.filter = `blur(${b}px)`
    g.drawImage(img as CanvasImageSource, pad, pad)
    m.set(pad, c)
  }
  return { img: c, grow: (iw + pad * 2) / Math.max(1, iw) }
}

/** Image layers set to "one colour": every image pass they produced is tinted with the layer colour. */
function tintImagePasses(out: Pass[], from: number, L: OverlayLayer): void {
  if (L.tileTint !== 'color') return
  for (let i = from; i < out.length; i++) { const p = out[i]; if (p.t === 'image') p.place = { ...p.place, tint: 'color', color: fillMain(L.fill, L.color) } }
}

/**
 * A layer's passes, plus its stitching ("Costura") when it has one: the shape the layer covers is rebuilt from its
 * own passes (masks, images, painted canvases), one coverage per clip zone, and traced into stitches (stitch.ts).
 */
async function layerPasses(out: Pass[], L: OverlayLayer, all: OverlayLayer[], assets: Record<string, Asset>, s2s: boolean): Promise<void> {
  if (!L.stitch || !L.visible) { await layerPassesRaw(out, L, all, assets, s2s); return }
  const first = out.length
  await layerPassesRaw(out, L, all, assets, s2s)
  stitchPasses(out, out.slice(first), L.stitch, 'stitch:' + geomKey(L, [L.stitch.kind, L.stitch.side, L.stitch.scale, L.stitch.color]), L.opacity)
}

/** Stitches round the shape a set of passes covers (one layer, or every member of a group). */
function stitchPasses(out: Pass[], mine: Pass[], sp: NonNullable<OverlayLayer['stitch']>, key: string, opacity: number): void {
  // coverage canvases per clip (white on transparent); built lazily by the pass's img() when the key is new
  const clips = new Set<Clip>()
  for (const p of mine) {
    if (p.t === 'fill' && p.mask?.zones) { const z = p.zoneSel ?? [1, 1, 1]; (['front', 'back', 'sleeves'] as Clip[]).forEach((c, i) => { if (z[i]) clips.add(c) }) }
    else if ((p.t === 'fill' && p.mask) || p.t === 'image' || p.t === 'rgba') clips.add(p.clip)
  }
  const coverage = (clip: Clip): OffscreenCanvas => {
    const c = new OffscreenCanvas(S, S), g = c.getContext('2d', { willReadFrequently: true })!
    const white = (draw: (t: G) => void, channel?: number): void => {
      const t = new OffscreenCanvas(S, S), tg = t.getContext('2d', { willReadFrequently: true })!
      tg.fillStyle = tg.strokeStyle = '#fff'
      draw(tg)
      const id = tg.getImageData(0, 0, S, S), d = id.data
      for (let i = 0; i < d.length; i += 4) {
        const v = channel === undefined ? Math.max(d[i], d[i + 1], d[i + 2]) : d[i + channel]
        const a = Math.round((v * d[i + 3]) / 255)
        d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a
      }
      tg.putImageData(id, 0, 0)
      g.drawImage(t, 0, 0)
    }
    for (const p of mine) {
      if (p.t === 'fill' && p.mask) {
        if (p.mask.zones) { const ch = ['front', 'back', 'sleeves'].indexOf(clip); if (ch >= 0 && (p.zoneSel ?? [1, 1, 1])[ch]) white(p.mask.draw, ch) }
        else if (p.clip === clip) white(p.mask.draw)
      } else if (p.t === 'image' && p.clip === clip) {
        const q = p.place
        g.save(); g.translate(q.cx, q.cy); g.rotate(q.rot); g.scale(Math.sign(q.w) || 1, Math.sign(q.h) || 1)
        g.drawImage(q.img as CanvasImageSource, -Math.abs(q.w) / 2, -Math.abs(q.h) / 2, Math.abs(q.w), Math.abs(q.h))
        g.restore()
      } else if (p.t === 'rgba' && p.clip === clip) g.drawImage((typeof p.img === 'function' ? p.img() : p.img) as CanvasImageSource, 0, 0)
    }
    // images / painted canvases keep their own colours: make them white
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, S, S)
    return c
  }
  for (const clip of clips) {
    out.push({
      t: 'rgba', key: key + clip, clip, opacity: Math.max(0, Math.min(1, sp.opacity ?? 0.8)) * opacity,
      img: () => stitchCanvas(coverage(clip), sp) ?? new OffscreenCanvas(1, 1)
    })
  }
}

async function layerPassesRaw(out: Pass[], L: OverlayLayer, all: OverlayLayer[], assets: Record<string, Asset>, s2s: boolean): Promise<void> {
  if (!L.visible) return
  const fill = L.fill ?? solid(L.color)
  const part = L.part === 'shirt' ? 'torso' : L.part
  const op = L.opacity, blend = L.blend
  if (L.kind === 'text' && (isSpotText(L) || L.border)) {
    const m2 = refMask(L, all, s2s)
    if (isSpotText(L)) { spotTextPasses(out, L, op, blend, fill, m2, L.maskInvert); return }
    // outlined text needs two colours: painted like a design
    tileRgbaPasses(out, L, part, op, blend, m2, L.maskInvert)
    return
  }
  if (L.kind === 'design') {
    // painted in its own colours (several colour slots / gradients); other layers can still clip it
    tileRgbaPasses(out, L, part, op, blend, refMask(L, all, s2s), L.maskInvert)
    return
  }
  if (L.kind === 'image' && L.fit === 'tile') {
    if (!L.assetId || !assets[L.assetId]) return
    if (!tileImgs.has(L.assetId) && tileImgs.size > 24) tileImgs.clear()
    tileImgs.set(L.assetId, await loadAsset(assets[L.assetId]))
    if (L.tileTint !== 'color') { tileRgbaPasses(out, L, part, op, blend); return }
    // one colour: falls through to the mask path below like any graphic layer
  } else if (L.kind === 'image' && L.fit === 'uv') {
    // a graphic drawn in the kit's own UV layout: covers the whole texture as it is
    if (!L.assetId || !assets[L.assetId]) return
    const img = await loadAsset(assets[L.assetId])
    const tint = L.tileTint === 'color' ? { tint: 'color' as const, color: fillMain(L.fill, L.color) } : {}
    out.push({ t: 'image', clip: 'all', opacity: op, blend, place: { img, cx: S / 2, cy: S / 2, w: S, h: S, rot: 0, ...tint } })
    return
  } else if (L.kind === 'image') {
    if (!L.assetId || !assets[L.assetId]) return
    const first = out.length
    let img: ImageSource = await loadAsset(assets[L.assetId])
    const rot = ((L.rotation ?? 0) * Math.PI) / 180
    const z = (L.zoom ?? 100) / 100, sx = (L.sx ?? 1) * z, sy = (L.sy ?? 1) * z
    const iw = imgW(img), ih = imgH(img)
    // size: the free box (aspect kept, then stretched by sx / sy) or the whole part ("fit")
    const dims = (box: number): { w: number; h: number } => { const r = Math.min(box / Math.max(1, iw), box / Math.max(1, ih)); return { w: iw * r * sx, h: ih * r * sy } }
    const partFit = L.fit === 'part'
    const x = partFit ? 1024 + (L.dx ?? 0) : L.x ?? 1024
    const y = partFit ? (SEAM + TORSO.hem) / 2 + (L.dy ?? 0) : L.y ?? 1300
    let { w, h } = partFit ? { w: FW * sx, h: 1000 * sy } : dims(L.size ?? 300)
    if ((L.blur ?? 0) > 0) {
      const r = blurredImg(img, (L.blur! * iw) / Math.max(1, Math.abs(w)))
      img = r.img; w *= r.grow; h *= r.grow
    }
    // mirror options: copies flipped left ↔ right about the centre line (negative width = flipped image)
    const copies: { x: number; w: number; rot: number }[] = []
    if (L.flipX) copies.push({ x: 2 * FRONT_CENTER.x - x, w: -w, rot: -rot }); else copies.push({ x, w, rot })
    if (L.mirrorCenter) copies.push(L.flipX ? { x, w, rot } : { x: 2 * FRONT_CENTER.x - x, w: -w, rot: -rot })
    if (part === 'torso') {
      const zones = L.zones ?? ['front', 'back']
      for (const c of copies) {
        if (zones.includes('front')) out.push({ t: 'image', clip: 'front', opacity: op, blend, place: { img, cx: c.x, cy: y, w: c.w, h, rot: c.rot } })
        // back: the front design rotated 180° about the shoulder seam so it reads correctly from behind (or mirrored)
        if (zones.includes('back')) {
          const place = L.mirrorBack
            ? { img, cx: c.x, cy: backY(y), w: -c.w, h, rot: Math.PI - c.rot }
            : { img, cx: 2048 - c.x, cy: backY(y), w: c.w, h, rot: c.rot + Math.PI }
          out.push({ t: 'image', clip: 'back', opacity: op, blend, place })
        }
      }
      tintImagePasses(out, first, L)
      return
    }
    const frames = part === 'shorts' || part === 'socks' ? PART_FRAMES[part] : null
    if (!frames) return
    for (const m of frames) for (const c of copies) {
      // frames are not similarities (legs are narrower than tall): map the box axes separately
      const [cx, cy] = apply(m, c.x, y)
      const ax = Math.hypot(m[0], m[1]), ay = Math.hypot(m[2], m[3])
      const det = m[0] * m[3] - m[1] * m[2]
      // a mirrored frame (right sock) moves the image to the mirrored spot but does not flip the image itself
      const place = det < 0 ? { img, cx, cy, w: c.w * ax, h: h * ay, rot: c.rot } : { img, cx, cy, w: c.w * ax, h: h * ay, rot: c.rot + Math.atan2(m[1], m[0]) }
      out.push({ t: 'image', clip: part, opacity: op, blend, place })
    }
    tintImagePasses(out, first, L)
    return
  }
  const mask = layerMask(L, s2s)!
  const mask2 = refMask(L, all, s2s)
  if (L.kind === 'panel') {
    // one fill per colour slot, each masked by its bands
    const clip: Clip = part === 'shorts' || part === 'socks' ? part : 'all'
    const fills = [fill, solid(L.colors?.[1] ?? contrastOn(fillMain(L.fill, L.color)))]
    panelBands(L).forEach((bands, k) => {
      if (!bands.length) return
      out.push({ t: 'fill', fill: fills[k], mask2, mask2Invert: L.maskInvert, clip, opacity: op, blend, mask: { key: 'pband:' + k + geomKey(L, 0), draw: blurred(L, (g) => { for (const [a, b] of bands) drawPanelBand(g, L, a, b) }) } })
    })
    return
  }
  if (L.kind === 'freeform') {
    // torso panels may run onto the sleeves; shorts / socks panels stay on their part; drawings go where drawn
    out.push({ t: 'fill', fill, mask, mask2, mask2Invert: L.maskInvert, clip: 'all', opacity: op, blend })
    return
  }
  if (part === 'torso') {
    const zones = L.zones ?? ['front', 'back']
    out.push({ t: 'fill', fill, mask, mask2, mask2Invert: L.maskInvert, clip: 'zones', zoneSel: [zones.includes('front') ? 1 : 0, zones.includes('back') ? 1 : 0, zones.includes('sleeves') ? 1 : 0], opacity: op, blend })
    return
  }
  out.push({ t: 'fill', fill, mask, mask2, mask2Invert: L.maskInvert, clip: (part === 'shorts' ? 'shorts' : part === 'socks' ? 'socks' : 'sleeves'), opacity: op, blend })
}

// ---------------------------------------------------------------- collar, cuffs, armband
export const COLLAR_DESIGNS: [CollarStyle, string, number][] = [
  ['solid', 'Lisa', 1], ['twoTone', 'Duas cores (fora / dentro)', 2], ['threeColor', 'Três cores', 3], ['tipped', 'Rebordo', 2],
  ['stripes2', 'Duas riscas', 2], ['stripes3', 'Três riscas', 3], ['half', 'Meia gola', 2], ['front', 'Frente de outra cor', 2],
  ['back', 'Nuca de outra cor', 2], ['halftone', 'Degradê meio-tom', 2], ['vInsert', 'V sobreposto', 2], ['vInsert3', 'V sobreposto (3 cores)', 3],
  ['vSlim', 'V fino', 2], ['placket', 'Peitilho', 2],
  ['front1', 'Frente estreita', 2], ['front2', 'Frente média', 2], ['front3', 'Frente larga', 2], ['innerTrim', 'Rebordo de dentro', 2],
  ['doubleTrim', 'Dois rebordos', 2], ['stripes4', 'Quatro riscas finas', 2], ['vSlimL', 'V cruzado (esquerda)', 2], ['vSlimR', 'V cruzado (direita)', 2],
  ['vInsertR3', 'V cruzado (3 cores)', 3], ['vLine', 'V com debrum', 2], ['placketStripe', 'Peitilho com risca', 3], ['placketWide', 'Peitilho largo', 2]
]
/**
 * Collar band (measured on the collar models): x box from the model (both ends = front centre, middle = nape),
 * y 1866 → fold ≈1918 = outer face, below the fold = inner face. The chest part (flaps / lining) is drawn with the
 * collar model's own triangles; in the 3D preview those are re-mapped onto the shirt (collarFitted).
 */
async function collarPasses(out: Pass[], d: KitDesign, layersDrawn: boolean, layer?: CollarSpec): Promise<void> {
  // `layer`: a collar-design layer (its own colours); without it, the kit's collar (model + base colour)
  const cs = layer ?? d.collar
  if (!cs || d.base.kind === 'image') return
  const m = await collarModel(Number(d.config.Collar ?? 66))
  const [bx0, , bx1] = m?.box ?? [664, 1866, 1384, 2034]
  const x0 = bx0 - 8, x1 = bx1 + 8, w = x1 - x0, mid = (x0 + x1) / 2, top = 1860, fold = 1918, bot = 2040
  if (!layersDrawn) {
    // 1. the band itself, before the layers (layers may still paint over the collar region)
    if (!layer) out.push({ t: 'fill', fill: solid(cs.c1), clip: 'collar' })
    const band = (key: string, color: string, draw: (g: G) => void): void => { out.push({ t: 'fill', fill: solid(color), clip: 'collar', mask: { key: 'collar:' + key + ':' + x0 + ':' + x1, draw } }) }
    const st = cs.style
    if (st === 'twoTone') band('inner', cs.c2, (g) => g.fillRect(x0, fold, w, bot - fold))
    if (st === 'threeColor') { band('3a', cs.c2, (g) => g.fillRect(x0, fold - 18, w, 36)); band('3b', cs.c3, (g) => g.fillRect(x0, fold + 18, w, bot - fold)) }
    if (st === 'tipped') band('tip', cs.c2, (g) => { g.fillRect(x0, fold - 9, w, 18); g.fillRect(x0, top, w, 12) })
    if (st === 'stripes2') band('s2', cs.c2, (g) => { g.fillRect(x0, 1878, w, 8); g.fillRect(x0, 1896, w, 8) })
    if (st === 'stripes3') { band('s3', cs.c2, (g) => { g.fillRect(x0, 1874, w, 7); g.fillRect(x0, 1902, w, 7) }); band('s3m', cs.c3, (g) => g.fillRect(x0, 1888, w, 7)) }
    if (st === 'half') band('half', cs.c2, (g) => g.fillRect(mid, top, x1 - mid, bot - top))
    if (st === 'front') { const k = w * ((cs.width ?? 30) / 100) / 2; band('front' + k, cs.c2, (g) => { g.fillRect(x0, top, k, bot - top); g.fillRect(x1 - k, top, k, bot - top) }) }
    if (st === 'back') { const k = w * ((cs.width ?? 40) / 100) / 2; band('back' + k, cs.c2, (g) => g.fillRect(mid - k, top, 2 * k, bot - top)) }
    const fw = st === 'front1' ? 18 : st === 'front2' ? 32 : st === 'front3' ? 50 : 0
    if (fw) { const k = (w * fw) / 200; band('fr' + fw, cs.c2, (g) => { g.fillRect(x0, top, k, bot - top); g.fillRect(x1 - k, top, k, bot - top) }) }
    if (st === 'innerTrim') band('itrim', cs.c2, (g) => g.fillRect(x0, bot - 16, w, 16))
    if (st === 'doubleTrim') band('dtrim', cs.c2, (g) => { g.fillRect(x0, top, w, 10); g.fillRect(x0, fold - 6, w, 12) })
    if (st === 'stripes4') band('s4', cs.c2, (g) => { for (const y of [1870, 1882, 1894, 1906]) g.fillRect(x0, y, w, 5) })
    if (st === 'halftone') band('ht', cs.c2, (g) => { for (let y = top; y < fold; y += 6) { const t = (y - top) / (fold - top); g.fillRect(x0, y, w, 6 * t) } })
    return
  }
  // 2. after the layers: V inserts / placket are drawn on the chest at the neck (the game's collar flaps show
  // whatever the shirt has there, so the texture itself stays a normal shirt texture)
  const V = (key: string, color: string, draw: (g: G) => void): void => { out.push({ t: 'fill', fill: solid(color), clip: 'front', mask: { key: 'collarV:' + key, draw } }) }
  const vPath = (g: G, inset: number, depth: number): void => { g.beginPath(); g.moveTo(887 + inset, 960); g.lineTo(1024, 960 + depth); g.lineTo(1156 - inset, 960); g.closePath(); g.fill() }
  if (cs.style === 'vInsert' || cs.style === 'vInsert3') { V('v1', cs.c1, (g) => vPath(g, 0, 250)); V('v2', cs.c2, (g) => vPath(g, 28, 190)) }
  if (cs.style === 'vInsert3') V('v3', cs.c3, (g) => vPath(g, 52, 140))
  if (cs.style === 'vSlim') { V('vs1', cs.c1, (g) => vPath(g, 0, 250)); V('vs2', cs.c2, (g) => vPath(g, 14, 220)) }
  if (cs.style === 'placket') V('pl', cs.c1, (g) => g.fillRect(1004, 960, 40, 255))
  if (cs.style === 'placketWide') V('plw', cs.c1, (g) => g.fillRect(989, 960, 70, 270))
  if (cs.style === 'placketStripe') { V('pls', cs.c1, (g) => g.fillRect(996, 960, 56, 260)); V('pls2', cs.c3, (g) => g.fillRect(1018, 960, 12, 260)) }
  // crossed V: one side of the V runs over the other (left / right)
  const half = (g: G, right: boolean, inset: number, depth: number): void => { g.beginPath(); if (right) { g.moveTo(1024 - 40 + inset, 960); g.lineTo(1024 + 18, 960 + depth); g.lineTo(1156 - inset, 960) } else { g.moveTo(887 + inset, 960); g.lineTo(1024 - 18, 960 + depth); g.lineTo(1024 + 40 - inset, 960) } g.closePath(); g.fill() }
  if (cs.style === 'vSlimL' || cs.style === 'vSlimR' || cs.style === 'vInsertR3') {
    const r = cs.style !== 'vSlimL'
    V('vc1', cs.c1, (g) => vPath(g, 0, 250))
    V('vc2' + r, cs.c2, (g) => half(g, r, 0, 236))
    if (cs.style === 'vInsertR3') V('vc3', cs.c3, (g) => half(g, r, 22, 200))
  }
  if (cs.style === 'vLine') { V('vl1', cs.c2, (g) => vPath(g, 0, 250)); V('vl2', cs.c1, (g) => vPath(g, 12, 226)) }
}

/**
 * Raglan shoulders ("mangas com ombros"): from the neck (on the shoulder seam) to the armpit (on the side seam) on
 * both sides, front or back; `curve` bends that seam (positive = towards the middle of the shirt), `neck` moves its
 * top along the shoulder (positive = towards the neck), `arm` moves the armpit end down the body.
 */
function drawRaglan(g: G, rg: NonNullable<KitDesign['raglan']>, front: boolean): void {
  // `down`: the neck end goes down the chest (up the back), e.g. a yoke line across the chest
  const N: Pt = [900 + (rg.neck ?? 0), front ? SEAM + (rg.down ?? 0) : SEAM - (rg.down ?? 0)]
  const A: Pt = front ? [700, PANEL.armpitF + (rg.arm ?? 0)] : [700, PANEL.armpitB - (rg.arm ?? 0)]
  const dx = A[0] - N[0], dy = A[1] - N[1], len = Math.hypot(dx, dy) || 1
  let nx = dy / len, ny = -dx / len
  if (nx < 0) { nx = -nx; ny = -ny }
  const k = rg.curve ?? 0
  const C: Pt = [(N[0] + A[0]) / 2 + nx * k, (N[1] + A[1]) / 2 + ny * k]
  // past the seam line (other zone) and past the side (the sleeve island): the clip keeps only this zone of the shirt
  const out = front ? SEAM - 80 : SEAM + 80
  for (const flip of [false, true]) {
    const X = (x: number): number => (flip ? S - x : x)
    g.beginPath()
    g.moveTo(X(N[0]), out); g.lineTo(X(N[0]), N[1])
    g.quadraticCurveTo(X(C[0]), C[1], X(A[0]), A[1])
    g.lineTo(X(600), A[1]); g.lineTo(X(600), out)
    g.closePath(); g.fill()
  }
}

/** Cuffs: a band at the end of each sleeve (short x≈490 / 1558, long x≈8 / 2040). */
function cuffPasses(out: Pass[], d: KitDesign): void {
  const cf = d.cuffs
  if (!cf || cf.style === 'none') return
  const bands: [number, number, number][] = [[490, 1, 684], [1558, -1, 684], [8, 1, 128], [2040, -1, 128]]
  const draw = (g: G, which: 1 | 2): void => {
    for (const [xe, dir, y0] of bands) {
      const h = y0 === 684 ? 534 : 528
      const band = (from: number, to: number): void => { const a = xe + dir * from, b = xe + dir * to; g.fillRect(Math.min(a, b), y0, Math.abs(b - a), h) }
      const w = cf.width
      if (which === 1) band(-80, w) // also covers the turned-up hem beyond the cuff line
      else if (cf.style === 'tipped') band(w - 10, w)
      else if (cf.style === 'stripes2') { band(w * 0.25, w * 0.25 + 8); band(w * 0.6, w * 0.6 + 8) }
      else if (cf.style === 'stripes3') { for (const t of [0.2, 0.45, 0.7]) band(w * t, w * t + 7) }
    }
  }
  out.push({ t: 'fill', fill: solid(cf.c1), clip: 'sleeves', mask: { key: 'cuff1:' + cf.width, draw: (g) => draw(g, 1) } })
  if (cf.style !== 'solid') out.push({ t: 'fill', fill: solid(cf.c2), clip: 'sleeves', mask: { key: 'cuff2:' + cf.style + cf.width, draw: (g) => draw(g, 2) } })
}

async function armbandPasses(out: Pass[], d: KitDesign, assets: Record<string, Asset>, crestId?: string): Promise<void> {
  const ab = d.armband
  if (!ab) return
  out.push({ t: 'fill', fill: ab.fill, clip: 'armband' })
  if (ab.pattern && ab.pattern !== 'none') {
    out.push({
      t: 'fill', fill: solid(ab.patternColor ?? '#ffffff'), clip: 'armband', mask: {
        key: 'abp:' + JSON.stringify([ab.pattern, ab.patternScale, ab.patternAngle, ab.patternWidth, ab.patternDx]), draw: (g) => {
          // size, rotation, thickness and offset of the pattern (about the middle of the band)
          const k = Math.max(0.1, (ab.patternScale ?? 100) / 100), wk = Math.max(0.1, (ab.patternWidth ?? 100) / 100)
          g.save()
          g.beginPath(); g.rect(0, 0, 512, 128); g.clip()
          g.translate(256 + (ab.patternDx ?? 0), 64); g.rotate(((ab.patternAngle ?? 0) * Math.PI) / 180); g.scale(k, k); g.translate(-256, -64)
          const X0 = -1024, X1 = 1536, Y0 = -768, Y1 = 896 // covers the band at any rotation / size
          if (ab.pattern === 'stripes') for (let x = X0 + 16; x < X1; x += 48) g.fillRect(x + (20 - 20 * wk) / 2, Y0, 20 * wk, Y1 - Y0)
          else if (ab.pattern === 'hoops') { const h = 14 * wk; g.fillRect(X0, 21 - h / 2, X1 - X0, h); g.fillRect(X0, 107 - h / 2, X1 - X0, h) }
          else if (ab.pattern === 'check') for (let y = -768; y < 896; y += 32) for (let x = X0 + (((y / 32) % 2 + 2) % 2 ? 32 : 0); x < X1; x += 64) g.fillRect(x, y, 32, 32)
          else if (ab.pattern === 'diagonal') { g.save(); g.translate(256, 64); g.rotate(-0.6); for (let x = -1400; x < 1400; x += 60) g.fillRect(x, -1400, 26 * wk, 2800); g.restore() }
          g.restore()
        }
      }
    })
  }
  const useCrest = !!(ab.crest && crestId && assets[crestId])
  if (useCrest) {
    const img = await loadAsset(assets[crestId!])
    out.push({ t: 'image', clip: 'armband', place: { img, ...fitted(img, 128, 64, ab.crestSize ?? 100, 0) } })
  }
  if (ab.text) {
    out.push({
      t: 'fill', fill: solid(ab.textColor), clip: 'armband', mask: {
        key: 'abt:' + JSON.stringify([ab.text, ab.font, useCrest]), draw: (g) => {
          g.font = `bold 96px "${ab.font}"`
          g.textAlign = 'center'; g.textBaseline = 'middle'
          for (const x of useCrest ? [384] : [128, 384]) g.fillText(ab.text, x, 66)
        }
      }
    })
  }
}

async function fabricPasses(out: Pass[], d: KitDesign, assets: Record<string, Asset>): Promise<void> {
  for (const f of d.fabrics ?? []) {
    if (!f.visible) continue
    // old kits: seams always went on the shorts and socks too
    const zs: string[] = f.source === 'seams' && !f.zones.some((x) => x === 'shorts' || x === 'socks') && !f.v2 ? [...f.zones, 'shorts', 'socks'] : f.zones
    const z = { front: zs.includes('front'), back: zs.includes('back'), sleeves: zs.includes('sleeves'), shorts: zs.includes('shorts'), socks: zs.includes('socks') }
    if (f.source === 'seams') {
      out.push({ t: 'rgba', key: 'seams:' + JSON.stringify(z), img: () => { const c = canvas(S, S); drawSeams(ctx2d(c), z); return c }, clip: 'all', opacity: f.opacity, blend: f.blend })
      continue
    }
    const src = f.source.startsWith('asset:') ? assets[f.source.slice(6)] : undefined
    const img = src ? await loadAsset(src) : fabricTile(f.source)
    const tile = { t: 'tile' as const, key: src ? 'asset:' + src.id : f.source, img, scale: Math.max(0.1, f.scale / 100), opacity: f.opacity, blend: f.blend }
    if (z.front || z.back || z.sleeves) out.push({ ...tile, clip: 'zones', zoneSel: [z.front ? 1 : 0, z.back ? 1 : 0, z.sleeves ? 1 : 0] })
    if (z.shorts) out.push({ ...tile, clip: 'shorts' })
    if (z.socks) out.push({ ...tile, clip: 'socks' })
  }
}

// ---------------------------------------------------------------- the pass list
const specFill = (sp: PatternSpec & { fill?: Fill }): Fill => sp.fill ?? solid(sp.color)
/**
 * Rotation of the sleeve / shorts / socks designs: each island is drawn turned about its own centre (the
 * mirrored island the other way); outside the islands (e.g. the shoulder continuation) the design stays as drawn.
 */
function rotIslands(l: G, deg: number | undefined, rects: [number, number, number, number][], draw: (g: G) => void, dx = 0, dy = 0, outsideDy = 0): void {
  if (!deg && !dx && !dy) { draw(l); return }
  rects.forEach(([x0, y0, x1, y1]) => {
    l.save()
    l.beginPath(); l.rect(x0, y0, x1 - x0, y1 - y0); l.clip()
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    // offsets: the islands of the two sides are mirror images, so x moves the other way on the right-hand one
    l.translate(cx + (cx < 1024 ? dx : -dx), cy + dy); l.rotate((((cx < 1024 ? 1 : -1) * (deg ?? 0)) * Math.PI) / 180); l.translate(-cx, -cy)
    draw(l)
    l.restore()
  })
  l.save()
  l.beginPath(); l.rect(0, 0, S, S); for (const [x0, y0, x1, y1] of rects) l.rect(x0, y0, x1 - x0, y1 - y0)
  l.clip('evenodd'); l.translate(0, outsideDy); draw(l); l.restore()
}

/**
 * "Curvar" of the sleeve design: the line along each sleeve bends (deepest half-way along the arm) and the line over
 * the shoulders bends across the shirt (deepest in the middle), by redrawing the mask in thin slices.
 */
function warpSleeves(l: G, amount: number | undefined, draw: (g: G) => void): void {
  if (!amount) { draw(l); return }
  const c = new OffscreenCanvas(S, S), g = c.getContext('2d')!
  g.fillStyle = g.strokeStyle = '#fff'
  draw(g)
  const a = amount
  // sleeves: columns along the arm (x), shifted in y
  const along = (x0: number, x1: number, y0: number, y1: number): void => {
    for (let x = x0; x < x1; x += 4) { const t = (x - x0) / (x1 - x0); l.drawImage(c, x, y0, 4, y1 - y0, x, y0 + a * Math.sin(Math.PI * t), 4, y1 - y0) }
  }
  along(420, 704, 684, 1218); along(1344, 1628, 684, 1218); along(0, 700, 128, 656); along(1348, 2048, 128, 656)
  // over the shoulders: columns across the shirt
  for (let x = 704; x < 1344; x += 4) { const t = (x - 1024) / 320; l.drawImage(c, x, 660, 4, 600, x, 660 - a * (1 - t * t), 4, 600) }
}
const SLEEVE_RECTS: [number, number, number, number][] = [[420, 684, 766, 1218], [1282, 684, 1628, 1218], [0, 128, 700, 656], [1348, 128, 2048, 656]]
const SHORTS_RECTS: [number, number, number, number][] = LEGS.map((L) => [L.x0, 1160, L.x1, 1964])
const SOCKS_RECTS: [number, number, number, number][] = [[0, 620, 410, 1160], [1638, 620, 2048, 1160]]

const specKey = (sp: PatternSpec, extra?: unknown): string => JSON.stringify([sp.id, sp.count, sp.width, sp.angle, sp.gap, sp.offset, sp.stripeW, sp.dx, sp.dy, sp.warp, extra])

export interface ComposeOptions { size?: number; scale?: number; skipLogos?: boolean; skipFabric?: boolean; overlay?: { key: string; img: ImageSource } }

export async function buildPasses(design: KitDesign, assets: Record<string, Asset>, opt: ComposeOptions = {}): Promise<{ passes: Pass[]; s2s: boolean }> {
  const d = migrateKit(design)
  const s2s = d.sleeveToShoulder !== false
  const out: Pass[] = []
  let sleeveOver: Pass[] = []
  // shorts / socks base dragged among the layers: drawn again right after that layer (or group), over the ones below
  const deferred = new Map<string, Pass[]>()
  const c = d.colors
  const F = d.fills ?? {}

  // 1. base
  if (d.base.kind === 'image' && d.base.imageAssetId && assets[d.base.imageAssetId]) {
    const a = assets[d.base.imageAssetId]
    const img = await loadAsset(a)
    const keys = d.base.clean ?? (d.base.cleanLogos ? Object.keys(CLEAN_RECTS) : [])
    const rec = d.base.recolor ?? []
    out.push({
      t: 'rgba', clip: 'all', key: 'base:' + JSON.stringify([a.id, a.dataUrl.length, keys, rec]), img: () => {
        if (!keys.length && !rec.length) return img
        const cv = canvas(S, S), g = ctx2d(cv)
        g.drawImage(img, 0, 0, S, S)
        if (keys.length) cleanRects(g, keys.flatMap((k) => CLEAN_RECTS[k] ?? []), 1)
        if (rec.length) recolor(g, S, S, rec)
        return cv
      }
    })
  } else {
    out.push({ t: 'fill', fill: solid(fillMain(F.shirt, c.shirt)), clip: 'all' })
    if (F.shirt && F.shirt.kind === 'gradient') out.push({ t: 'fill', fill: F.shirt, clip: 'torso' })
    if (d.torso && d.torso.id !== 'none') out.push({ t: 'fill', fill: specFill(d.torso), clip: 'torso', mask: { key: 'torso:' + specKey(d.torso), draw: (l) => drawTorsoPattern(l, { ...d.torso, color: '#fff' }) } })
    out.push({ t: 'fill', fill: F.sleeves ?? solid(c.sleeves), clip: 'sleeves', s2s: false })
    if (d.sleevePattern.id !== 'none') {
      const spec = d.sleevePattern
      const allLayers = resolveGroups(d.layers)
      const m2 = spec.maskLayer ? refMask({ id: '__sleeves', maskLayer: spec.maskLayer } as OverlayLayer, allLayers, false) : undefined
      // stripes along the top of the arm continue over the shoulders right across the shirt (both sides meet at the
      // neck): drawn on the whole texture; the "shoulder" colour block keeps to the raglan strip
      const across = s2s && (spec.id === 'top' || spec.id === 'three')
      const sp: Pass = { t: 'fill', fill: specFill(spec), clip: across ? 'all' : 'sleeves', s2s: across ? false : s2s, mask: { key: 'sleeve:' + specKey(spec, s2s), draw: (l) => warpSleeves(l, spec.warp, (w) => rotIslands(w, spec.angle, SLEEVE_RECTS, (g) => drawSleevePattern(g, { ...spec, color: '#fff' }, s2s), spec.dx, spec.dy, spec.dy)) }, mask2: m2, mask2Invert: spec.maskInvert }
      // up to the shoulders: only the sleeve design goes over the shoulder, on top of the shirt's design (the
      // shoulder itself stays part of the shirt, so the shirt's layers are not cut there)
      // its place among the layers: dragged in the list (sleeveAfter), else on top with "up to the shoulders"
      if (d.sleeveAfter !== undefined || s2s) sleeveOver = [sp]
      else out.push(sp)
    }
    const shortsBase: Pass[] = [{ t: 'fill', fill: F.shorts ?? solid(c.shorts), clip: 'shorts' }]
    if (d.shortsPattern.id !== 'none') shortsBase.push({ t: 'fill', fill: specFill(d.shortsPattern), clip: 'shorts', mask: { key: 'shorts:' + specKey(d.shortsPattern), draw: (l) => rotIslands(l, d.shortsPattern.angle, SHORTS_RECTS, (g) => drawShortsPattern(g, { ...d.shortsPattern, color: '#fff' }), d.shortsPattern.dx, d.shortsPattern.dy) } })
    out.push(...shortsBase)
    // moved among the layers: the design goes over the layers below it, the base colour stays under all of them
    if (d.baseAfter?.shorts && shortsBase.length > 1) { out.pop(); deferred.set(d.baseAfter.shorts, [...(deferred.get(d.baseAfter.shorts) ?? []), ...shortsBase.slice(1)]) }
    const socksBase: Pass[] = [{ t: 'fill', fill: F.socks ?? solid(c.socks), clip: 'socks' }]
    if (d.socksPattern.id !== 'none') socksBase.push({ t: 'fill', fill: specFill(d.socksPattern), clip: 'socks', mask: { key: 'socks:' + specKey(d.socksPattern), draw: (l) => rotIslands(l, d.socksPattern.angle, SOCKS_RECTS, (g) => drawSocksPattern(g, { ...d.socksPattern, color: '#fff' }), d.socksPattern.dx, d.socksPattern.dy) } })
    out.push(...socksBase)
    if (d.baseAfter?.socks && socksBase.length > 1) { out.pop(); deferred.set(d.baseAfter.socks, [...(deferred.get(d.baseAfter.socks) ?? []), ...socksBase.slice(1)]) }
    await collarPasses(out, d, false)
  }

  // sleeves with shoulders (raglan): the sleeve colour over the shoulders, up to a (bendable) seam from the armpit
  // to the neck; drawn where the sleeves row sits among the layers (on top of them by default)
  const raglan: Pass[] = []
  if (d.raglan && d.base.kind !== 'image') {
    const rg = d.raglan
    for (const front of [true, false]) raglan.push({ t: 'fill', fill: F.sleeves ?? solid(c.sleeves), clip: front ? 'front' : 'back', mask: { key: 'raglan:' + front + JSON.stringify(rg), draw: (g) => drawRaglan(g, rg, front) } })
  }
  if (raglan.length) sleeveOver = [...raglan, ...sleeveOver]
  // the sleeves row placed among the layers: the sleeves themselves (their colour) also go there, over the layers
  // below it (e.g. stripes on the sleeves)
  if (d.sleeveAfter !== undefined && d.base.kind !== 'image') sleeveOver = [{ t: 'fill', fill: F.sleeves ?? solid(c.sleeves), clip: 'sleeves', s2s: false }, ...sleeveOver]
  if (d.sleeveStitch && d.base.kind !== 'image') {
    // round the raglan seam, or round the sleeve islands (armhole and cuffs)
    const cov: Pass[] = raglan.length ? raglan : [{ t: 'fill', fill: solid('#fff'), clip: 'sleeves', mask: { key: 'sleeveIslands', draw: (g) => { g.fill(pathOf([...REGIONS.sleeves, ...REGIONS.longSleeves])) } } }]
    const st: Pass[] = []
    stitchPasses(st, cov, d.sleeveStitch, 'sstitch:' + JSON.stringify([d.sleeveStitch, d.raglan ?? null]), 1)
    sleeveOver = [...sleeveOver, ...st]
  }
  // 2. layers (the template design is the first pattern layer)
  const layers = resolveGroups(d.layers)
  // text on the armband / back of the collar goes on top of those parts (drawn after them)
  const late = (L: OverlayLayer): boolean => L.kind === 'text' && (L.placement === 'armband' || L.placement === 'backCollar')
  // groups with stitching: round everything their visible members draw, after the group's last member
  const stitched = new Map(d.layers.filter((g) => g.kind === 'group' && g.stitch && g.visible).map((g) => [g.id, g]))
  const lastOf = new Map<string, string>()
  for (const L of layers) if (L.group && stitched.has(L.group) && !late(L)) lastOf.set(L.group, L.id)
  const after = d.sleeveAfter
  const afterId = after ? [...layers].reverse().find((L) => L.id === after || L.group === after)?.id : undefined
  if (sleeveOver.length && after !== undefined && !afterId) { out.push(...sleeveOver); sleeveOver = [] } // at the bottom
  for (const L of layers) {
    if (late(L)) continue
    if (L.kind === 'collar') {
      // a collar design: the band and its chest part (V, placket) right here among the layers
      if (L.visible && L.collarStyle && d.base.kind !== 'image') {
        const cc = L.colors ?? []
        const cs: CollarSpec = { style: L.collarStyle, c1: cc[0] ?? L.color, c2: cc[1] ?? contrastOn(cc[0] ?? L.color), c3: cc[2] ?? d.colors.shirt2, width: L.width }
        await collarPasses(out, d, false, cs)
        await collarPasses(out, d, true, cs)
      }
      if (sleeveOver.length && L.id === afterId) { out.push(...sleeveOver); sleeveOver = [] }
      continue
    }
    await layerPasses(out, L, layers, assets, false)
    if (sleeveOver.length && L.id === afterId) { out.push(...sleeveOver); sleeveOver = [] }
    for (const [gid, ps] of deferred) if (gid === L.id || (L.group === gid && [...layers].reverse().find((m) => m.group === gid)?.id === L.id)) out.push(...ps)
    const G = L.group ? stitched.get(L.group) : undefined
    if (G && lastOf.get(G.id) === L.id) {
      const members = layers.filter((m) => m.group === G.id && m.visible && !late(m))
      const tmp: Pass[] = []
      for (const m of members) await layerPassesRaw(tmp, m, layers, assets, false)
      stitchPasses(out, tmp, G.stitch!, 'gstitch:' + JSON.stringify([G.stitch, members.map((m) => geomKey(m, 0))]), G.opacity)
    }
  }
  out.push(...sleeveOver)
  if (d.base.kind !== 'image') {
    cuffPasses(out, d)
    const cf = d.cuffs
    if (cf?.stitch && cf.style !== 'none') { const tmp: Pass[] = []; cuffPasses(tmp, d); stitchPasses(out, tmp, cf.stitch, 'cstitch:' + JSON.stringify(cf), 1) }
  }
  await collarPasses(out, d, true)
  await armbandPasses(out, d, assets, d.logos.crest.assetId)
  for (const L of layers) if (late(L)) await layerPasses(out, L, layers, assets, false)

  // 3. logos (flat in 2D, in each part's own frame)
  if (!opt.skipLogos) for (const g of await allLogoPasses(d, assets)) out.push(...g.passes)

  // 4. fabric & seams on top (multiply / soft-light keep colours)
  if (!opt.skipFabric) await fabricPasses(out, d, assets)
  if (opt.overlay) out.push({ t: 'rgba', key: opt.overlay.key, img: opt.overlay.img, clip: 'all' })
  return { passes: out, s2s: false }
}

/** Every logo's passes, logo by logo (the shininess map paints each with its own value). */
async function allLogoPasses(d: KitDesign, assets: Record<string, Asset>): Promise<{ lp: LogoPlacement; passes: Pass[] }[]> {
  const res: { lp: LogoPlacement; passes: Pass[] }[] = []
  const c = d.colors
  const logoPasses = async (_o: Pass[], lp: LogoPlacement | undefined, a: Record<string, Asset>, spots: Spot[], bg: string, clip: Clip): Promise<void> => {
    if (!lp) return
    const passes: Pass[] = []
    await logoPassesOne(passes, lp, a, spots, bg, clip)
    if (passes.length) res.push({ lp, passes })
  }
  const out: Pass[] = []
  {
    const L = d.logos
    const B = (b: readonly number[]): { ox: number; oy: number } => ({ ox: b[0], oy: b[1] })
    await logoPasses(out, L.crest, assets, [{ ...SPOTS.crest, ...B(LOGO_BASE.crest) }], c.shirt, 'front')
    await logoPasses(out, L.brand, assets, [{ ...SPOTS.brand, ...B(LOGO_BASE.brand) }], c.shirt, 'front')
    for (const sp of L.sponsors ?? []) await logoPasses(out, sp, assets, [SPOTS.sponsor], c.shirt, 'front')
    for (const sp of L.backSponsors ?? []) await logoPasses(out, sp, assets, [sp.place === 'top' ? { x: 1024, y: 862, rot: Math.PI } : { ...SPOTS.backSponsor, ...B(LOGO_BASE.backSponsor) }], c.shirt, 'back')
    // the chest brand repeated on both sleeves ("também nas mangas") is a sleeve badge marked `brand` (own spot)
    for (const b of L.sleeveBadges ?? []) {
      const o = B(b.brand ? LOGO_BASE.sleeveBrand : LOGO_BASE.sleeveBadge)
      const sb = [{ ...SPOTS.sleeveBadge[0], ...o }, { ...SPOTS.sleeveBadge[1], flipDx: true, ...o }], lb = LONG_BADGES.map((s) => ({ ...s, ...o }))
      const short = b.side === 'left' ? [sb[0]] : b.side === 'right' ? [sb[1]] : sb
      const long = b.side === 'left' ? [lb[0]] : b.side === 'right' ? [lb[1]] : lb
      // short sleeves: not cut at the island, what crosses the shoulder end goes on into the shirt strip the sleeve
      // shares; long sleeves: kept on the sleeve (past their end are the sides of the back)
      await logoPasses(out, b, assets, short, c.sleeves, 'zones')
      await logoPasses(out, b, assets, long, c.sleeves, 'sleeves')
    }
    const legSide = (s: string | undefined, def: 'left' | 'right'): 'left' | 'right' | 'both' => (s === 'both' ? 'both' : (s ?? def) === 'left' ? 'left' : 'right')
    await logoPasses(out, L.shortsCrest, assets, shortsSpots(L.shortsCrest, 'leg', legSide(L.shortsCrest.side, 'right'), L.shortsCrest.size, 'shortsCrest'), c.shorts, 'shorts')
    await logoPasses(out, L.shortsBrand, assets, shortsSpots(L.shortsBrand, L.shortsBrand.spot === 'back' ? 'backLeg' : 'leg', legSide(L.shortsBrand.side, 'left'), L.shortsBrand.size, 'shortsBrand'), c.shorts, 'shorts')
    const ss = L.shortsSponsor
    if (ss) {
      const kind = ss.spot === 'back' ? 'back' : ss.spot === 'middle' ? 'middle' : 'leg'
      await logoPasses(out, ss, assets, shortsSpots(ss, kind, legSide(ss.side, 'right'), ss.size * 0.5), c.shorts, 'shorts')
    }
    await logoPasses(out, L.socksBrand, assets, socksSpots(), c.socks, 'socks')
  }
  return res
}

/** Live render for the editor: returns the shared GL canvas (2048²), which the 3D viewer uses as its texture. */
export async function composeLive(design: KitDesign, assets: Record<string, Asset>, opt: ComposeOptions = {}): Promise<HTMLCanvasElement> {
  const { passes, s2s } = await buildPasses(design, assets, opt)
  return renderToCanvas(passes, { s2s })
}

/** Full-resolution RGBA (export). */
export async function composeRgba(design: KitDesign, assets: Record<string, Asset>, opt: ComposeOptions = {}): Promise<{ width: number; height: number; data: Uint8Array }> {
  const { passes, s2s } = await buildPasses(design, assets, opt)
  return renderToRgba(passes, { s2s, size: opt.size ?? S })
}

/** Roughness the 3D preview uses for a shininess 0 (matte fabric) … 100 (glossy). */
export const shineToRoughness = (shine: number): number => 0.93 - Math.max(0, Math.min(100, shine)) * 0.0068

/**
 * Shininess map for the 3D preview (roughness in every channel, 0..255): the kit's own value everywhere, then each
 * layer with its own shininess painted with that layer's shape. Null when nothing differs from the default fabric.
 */
export type DecoPart = 'back' | 'name' | 'chest' | 'leg'
/** Same shape, one grey (the alpha of an image / painted layer as a roughness mask). */
const grayCache = new Map<string, OffscreenCanvas>()
function grayOf(key: string, img: ImageSource, color: string): OffscreenCanvas {
  const k = key + color
  let c = grayCache.get(k)
  if (!c) {
    c = new OffscreenCanvas(imgW(img), imgH(img))
    const g = c.getContext('2d')!
    g.drawImage(img as CanvasImageSource, 0, 0)
    g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height)
    if (grayCache.size > 30) grayCache.clear()
    grayCache.set(k, c)
  }
  return c
}

/**
 * Shininess map for the 3D preview (roughness in every channel, 0..255): the kit's own value everywhere, then each
 * layer / logo / name and number with its own shininess painted with its shape. Null when nothing differs.
 * `decos`: the preview name and numbers, one image per part (they are not part of the kit texture).
 */
export async function composeShine(design: KitDesign, assets: Record<string, Asset>, size = 512, decos: { part: DecoPart; key: string; img: ImageSource }[] = []): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const d = migrateKit(design)
  const layers = resolveGroups(d.layers).filter((l) => l.visible && l.shine != null)
  const ls = d.logoShine, ns = d.numberShine
  const logoOn = !!ls && (ls.all || Object.values(d.logos).some((v) => (Array.isArray(v) ? v.some((x) => x.shine != null) : v?.shine != null)))
  if (!layers.length && !d.shine && !logoOn && !ns) return null
  const gray = (shine: number): string => { const v = Math.round(shineToRoughness(shine) * 255).toString(16).padStart(2, '0'); return '#' + v + v + v }
  const out: Pass[] = [{ t: 'fill', fill: solid(gray(d.shine ?? 0)), clip: 'all' }]
  const s2s = false // the shoulder belongs to the shirt for every layer (see buildPasses)
  const paint = (p: Pass, v: number): void => {
    if (p.t === 'fill') out.push({ ...p, fill: solid(gray(v)), blend: undefined, opacity: 1 })
    else if (p.t === 'image') out.push({ ...p, blend: undefined, opacity: 1, place: { ...p.place, tint: 'color', color: gray(v) } })
    else if (p.t === 'rgba') { const src = typeof p.img === 'function' ? p.img() : p.img; out.push({ ...p, key: 'sh:' + p.key + v, blend: undefined, opacity: 1, img: grayOf(p.key, src, gray(v)) }) }
  }
  for (const L of layers) {
    if (L.kind === 'design') {
      const m = layerMask(L, s2s)
      if (m) out.push({ t: 'fill', fill: solid(gray(L.shine!)), mask: m, clip: L.part === 'shorts' || L.part === 'socks' ? L.part : 'zones', zoneSel: [1, 1, 1] })
      continue
    }
    const tmp: Pass[] = []
    await layerPassesRaw(tmp, { ...L, opacity: 1, blend: undefined, fill: undefined, color: gray(L.shine!) }, layers, assets, s2s)
    for (const p of tmp) paint(p, L.shine!)
  }
  if (logoOn && ls) for (const g of await allLogoPasses(d, assets)) {
    const v = ls.all ? ls.value : g.lp.shine
    if (v != null) for (const p of g.passes) paint(p, v)
  }
  if (ns) for (const dc of decos) {
    const v = ns.all ? ns.value : ns[dc.part]
    if (v != null) paint({ t: 'rgba', key: 'deco:' + dc.key, img: dc.img, clip: 'all' }, v)
  }
  return renderToRgba(out, { s2s, size })
}

/** Compatibility: a 2D OffscreenCanvas copy (thumbnails, previews, bulk). */
export async function composeKit(design: KitDesign, assets: Record<string, Asset>, opt: ComposeOptions = {}): Promise<OffscreenCanvas> {
  const size = opt.size ?? Math.max(16, Math.round(S * (opt.scale ?? 1)))
  const img = await composeRgba(design, assets, { ...opt, size })
  const c = canvas(size, size)
  ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer), size, size), 0, 0)
  return c
}

/** Config.txt values derived from the design (clash colours etc.). */
export function designConfig(design: KitDesign): Record<string, string | number> {
  const d = migrateKit(design)
  const F = d.fills ?? {}
  return {
    ...d.config,
    ShirtColor1: fillMain(F.shirt, d.colors.shirt),
    ShirtColor2: d.colors.shirt2,
    UndershirtColor: fillMain(F.sleeves, d.colors.sleeves),
    ShortsColor: fillMain(F.shorts, d.colors.shorts),
    SocksColor: fillMain(F.socks, d.colors.socks),
    UniColor_Color1: fillMain(F.shirt, d.colors.shirt),
    UniColor_Color2: d.colors.shirt2
  }
}

/** Front-view flat preview (torso + short sleeves) for thumbnails; works with any texture size. */
export function frontThumb(tex: OffscreenCanvas | HTMLCanvasElement, size = 256): OffscreenCanvas {
  const c = canvas(size, size), g = ctx2d(c)
  const q = tex.width / 2048
  const src = (x: number, y: number, w: number, h: number, dx: number, dy: number, dw: number, dh: number): void =>
    g.drawImage(tex, x * q, y * q, w * q, h * q, dx, dy, dw, dh)
  const sw = TORSO.x1 - TORSO.x0, sh = 900
  const k = (size * 0.62) / sw
  const ox = (size - sw * k) / 2, oy = size * 0.06
  const rx = ox + sw * k
  g.save()
  g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox - size * 0.17, oy + size * 0.28); g.lineTo(ox - size * 0.06, oy + size * 0.36); g.lineTo(ox, oy + size * 0.22); g.closePath(); g.clip()
  src(490, 684, 214, 534, ox - size * 0.2, oy, size * 0.2, size * 0.38)
  g.restore()
  g.save()
  g.beginPath(); g.moveTo(rx, oy); g.lineTo(rx + size * 0.17, oy + size * 0.28); g.lineTo(rx + size * 0.06, oy + size * 0.36); g.lineTo(rx, oy + size * 0.22); g.closePath(); g.clip()
  src(1344, 684, 214, 534, rx, oy, size * 0.2, size * 0.38)
  g.restore()
  src(TORSO.x0, SEAM, sw, sh, ox, oy, sw * k, sh * k)
  g.fillStyle = 'rgba(0,0,0,0.35)'
  g.beginPath(); g.ellipse(size / 2, oy, sw * k * 0.16, size * 0.05, 0, 0, Math.PI); g.fill()
  return c
}

export { contrastOn }
