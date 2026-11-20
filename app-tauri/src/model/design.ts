/** Kit design model – everything the compositor needs to paint a 2048² PES 2021 kit texture. */

export type Part = 'shirt' | 'sleeves' | 'shorts' | 'socks'
export type LogoTint = 'original' | 'mono' | 'auto' | 'white' | 'black' | 'bw'

/** Solid colour or multi-stop linear gradient (angle in degrees, 90 = top→bottom). */
export type Fill = { kind: 'solid'; color: string } | { kind: 'gradient'; angle: number; stops: { color: string; at: number }[] }
export const solid = (color: string): Fill => ({ kind: 'solid', color })
export const fillMain = (f: Fill | undefined, fallback: string): string => (!f ? fallback : f.kind === 'solid' ? f.color : f.stops[0]?.color ?? fallback)

/** Shirt zones a layer can cover. */
export type Zone = 'front' | 'back' | 'sleeves'
/** Where a fabric / seam layer goes: shirt zones plus shorts and socks. */
export type FabricZone = Zone | 'shorts' | 'socks'

export interface KitColors {
  shirt: string; shirt2: string; shirt3: string
  sleeves: string; cuffs: string; collar: string
  shorts: string; shorts2: string
  socks: string; socks2: string
  armband: string
}

export interface PatternSpec { id: string; color: string; count: number; width: number /* 5..95 */; angle?: number; fill?: Fill; stripeW?: number; gap?: number; offset?: number; dx?: number; dy?: number /* offset of the whole design (px) */; warp?: number /* sleeves: bend of the line along the arm and over the shoulders (−150 … 150) */; maskLayer?: string; maskInvert?: boolean /* sleeve design: only where another layer is (or is not) */
  /** shorts / socks base design: stitching and fabric on the design's elements */
  stitch?: StitchSpec; fabric?: TextureSpec }

export interface OverlayLayer {
  id: string
  kind: 'pattern' | 'texture' | 'shape' | 'text' | 'image' | 'panel' | 'group' | 'freeform' | 'design' | 'vector' | 'collar'
  fill?: Fill // overrides color (gradients)
  zones?: Zone[] // shirt layers: where to draw (default front+back)
  count?: number; width?: number // pattern layers
  stroke?: 'solid' | 'dashed' | 'dotted' | 'dashdot'; lineWidth?: number // graphic textures: line style and thickness (%)
  texOutline?: boolean // built-in textures: shapes drawn as outlines (with the line style) instead of filled
  fromTemplate?: boolean
  part: Part | 'torso'
  visible: boolean
  opacity: number // 0..1
  color: string
  // texture: patternId + scale ; shape: shapeId ; text: text/font ; image: assetId
  pattern?: string
  scale?: number
  shape?: 'band' | 'panelSides' | 'shoulders' | 'collarV' | 'cuffs' | 'hem' | 'yoke' | 'stripeH' | 'stripeV'
  text?: string
  font?: string
  assetId?: string
  x?: number; y?: number; size?: number; rotation?: number
  dx?: number; dy?: number // offset for textures/shapes (texture px)
  sx?: number; sy?: number // independent horizontal / vertical scale (1 = 100 %)
  side?: 'front' | 'back' | 'both'
  blend?: GlobalCompositeOperation
  // 0.2
  stripeW?: number; gap?: number; offset?: number // stripes / hoops: own width and spacing per stripe (px), shift
  warp?: { kind: 'none' | 'arc' | 'flag' | 'wave'; amount: number }
  fit?: 'free' | 'part' | 'tile' | 'uv' // 'uv' = a full texture in the kit layout (graphics library); image layers: 'part' stretches the image over the whole part, 'tile' repeats it (custom pattern)
  maskLayer?: string // show only where another layer is (clipping mask)…
  maskInvert?: boolean // …or only where it is not
  // 0.2.4
  name?: string // user label in the layer list
  flipX?: boolean // mirror left ↔ right
  mirrorCenter?: boolean // add a mirrored copy (symmetric about the centre)
  mirrorBack?: boolean // back zone: mirror left ↔ right instead of repeating the front
  mirrorLegs?: boolean // socks: on the right sock the layer goes on the opposite side of the leg (mirror image of the left sock)
  blur?: number // softness, texture px
  // panels (kind 'panel'): drawn straight in texture space along the garment seams; width in `size`
  panel?: PanelKind
  panelSleeve?: boolean // side / shoulder panels continue along the sleeve
  pstyle?: PanelStyle // design inside the panel (colour 2 = colors[1])
  pcount?: number // stripes inside the panel
  pgap?: number // spacing between those stripes (px)
  // groups: a 'group' layer draws nothing; its members (group = its id) follow it in the list and inherit its
  // visibility and opacity
  group?: string
  collapsed?: boolean
  locked?: boolean // can't be selected / moved / edited until unlocked
  // custom pattern (image layer, fit 'tile'): motif size in `size`, spacing in `gap`; original colours or one colour
  tileTint?: 'original' | 'color'
  // free drawing (kind 'freeform'): strokes in texture px, flat [x0, y0, x1, y1, …]; `erase` paints the layer away
  strokes?: { pts: number[]; w: number; erase?: boolean }[]
  shine?: number // own shininess (3D preview) where this layer is, 0 … 100
  zoom?: number // overall size %, 10 … 800 (multiplies sx / sy)
  shortOnly?: boolean // sleeves zone: only the short sleeves
  // base designs (kind 'design', see compositor/designs.ts): design id, colour slots, own parameters, gradient stops
  design?: string
  colors?: string[]
  p?: Record<string, number | boolean | string>
  stops?: { c: string; at: number }[]
  // text (fase D)
  letterSpacing?: number // −50 … 1000
  arch?: number // −150 … 150 (bend the line into an arc)
  italic?: boolean
  vertical?: boolean // text: letters stacked one under the other
  border?: boolean
  borderW?: number // 1 … 8
  borderColor?: string
  placement?: TextPlacement
  // vector drawing (kind 'vector'): paths in a unit box (−0.5 … 0.5), drawn 400 px wide at the part's centre
  vpaths?: VPath[]
  strokeW?: number // open paths: line width (px at 100 %)
  // stitching along the edge of the layer's shape (inside or outside it)
  stitch?: StitchSpec
  // collar design (kind 'collar'): one of COLLAR_DESIGNS, colours in `colors`, `width` for the front / back styles
  collarStyle?: CollarStyle
  /** sleeves zone: default = the front drawn again on each sleeve; 'continue' = the shirt's drawing goes on into the
   *  sleeves (same texture coordinates at the armhole) */
  sleeveMap?: 'frame' | 'continue'
  /** fabric texture ("Tecido") over what this layer draws; collar designs: only on the colour slots in `fabricSlots` */
  fabric?: TextureSpec
  fabricSlots?: number[]
  /** embroidery texture over an image / text layer (on top of the outline / stitching options) */
  embroidery?: TextureSpec
  outlineRelief?: number // 0 … 100: a layer with an outline (text border, design outline) stands out from the fabric (3D preview only)
}
/** A texture laid over a layer, badge or cuff: built-in id (compositor/fabric.ts), size % and angle (degrees), strength 0 … 1 (default per texture). */
export interface TextureSpec { id: string; scale?: number; angle?: number; opacity?: number; mix?: number /* socks: mix (%) with the kit's own grain in the 3D relief */ }
/** Starting values: fabric on collars / cuffs (fine stretchy rib) and on sleeves, stitching on sleeves and collars. */
export const FABRIC_COLLAR: Omit<TextureSpec, 'id'> = { scale: 77, angle: 0, opacity: 0.25 }
export const FABRIC_SLEEVE: Omit<TextureSpec, 'id'> = { scale: 77, angle: -90, opacity: 0.25 }
export const COLLAR_FABRIC: TextureSpec = { id: 'ribfine', ...FABRIC_COLLAR }
/** New kits: fine knit over everything (soft light) and a double stitch on the hems. */
export const MAIN_FABRIC: TextureSpec = { id: 'knit', scale: 48, opacity: 0.31 }
export const HEM_STITCH: StitchSpec = { kind: 'double', side: 'center', opacity: 0.3, scale: 45, relief: 0 }
export const FABRIC_CUFF: Omit<TextureSpec, 'id'> = { scale: 70, angle: 90, opacity: 0.4 }
export const CUFF_FABRIC: TextureSpec = { id: 'ribfine', ...FABRIC_CUFF }
export const SOCKS_FABRIC: TextureSpec = { id: 'ribfine', scale: 110, angle: 0, opacity: 0.1, mix: 20 }
export const SOCK_LAYER_FABRIC: TextureSpec = { id: 'ribfine', scale: 100, angle: 0, opacity: 0.25 }
/** The fly / back seam is one thin line (a dashed one). */
export const MID_STITCH: StitchSpec = { kind: 'dashed', side: 'center', opacity: 0.4, scale: 20, relief: 5 }
/** The shorts hem: same look as the fly / back seam (the user's choice, 2026-11-19). */
export const SHORTS_HEM_STITCH: StitchSpec = { ...MID_STITCH }
export const STITCH_DEFAULT: StitchSpec = { kind: 'dashed', side: 'center', opacity: 0.3, scale: 45, relief: 0 }
export type StitchKind = 'dashed' | 'dotted' | 'double' | 'solid' | 'zigzag' | 'cross'
export interface StitchSpec { kind: StitchKind; side: 'in' | 'out' | 'center'; opacity: number /* 0..1 */; scale: number /* % */; color?: string /* thread colour; default = shadow */; relief?: number /* 0 … 100: raised fabric along the seam (3D preview only) */ }
export const STITCH_KINDS: [StitchKind, string][] = [['dashed', 'Pesponto (tracejado)'], ['double', 'Pesponto duplo'], ['dotted', 'Pontos'], ['solid', 'Linha contínua'], ['zigzag', 'Zigue-zague'], ['cross', 'Ponto cruz']]
/** Anchor of a vector path; optional Bézier handles (absolute, same unit space). */
export interface VPt { x: number; y: number; ix?: number; iy?: number; ox?: number; oy?: number }
export interface VPath { pts: VPt[]; closed: boolean }
export type TextPlacement = 'front' | 'back' | 'frontBack' | 'sleeveL' | 'sleeveR' | 'sleeves' | 'sleevesMirror' | 'sleevesInv'
  | 'sideR' | 'sideL' | 'sides' | 'sidesMirror' | 'sidesMirrorInv' | 'armband' | 'backCollar'

/** Layers as the compositor sees them: groups removed, members carry the group's visibility / opacity. */
export function resolveGroups(layers: OverlayLayer[]): OverlayLayer[] {
  const groups = new Map(layers.filter((l) => l.kind === 'group').map((g) => [g.id, g]))
  return layers.filter((l) => l.kind !== 'group').map((l) => {
    const g = l.group ? groups.get(l.group) : undefined
    if (!g) return l
    // the group's own placement goes onto every member: offset (added), size (multiplied), rotation (added, each about
    // its own middle), blend mode and shine (when the group has one); panels and collar designs follow the seams
    const out: OverlayLayer = { ...l, visible: l.visible && g.visible, opacity: l.opacity * g.opacity }
    if (g.blend) out.blend = g.blend
    if (g.shine != null) out.shine = g.shine
    const fixed = l.kind === 'panel' || l.kind === 'collar' || (l.kind === 'image' && l.fit === 'uv')
    if (!fixed) {
      const gdx = g.dx ?? 0, gdy = g.dy ?? 0
      if (gdx || gdy) {
        const free = l.kind === 'text' || (l.kind === 'image' && l.fit !== 'part' && l.fit !== 'tile')
        if (free) { out.x = (l.x ?? 1024) + gdx; out.y = (l.y ?? (l.kind === 'text' ? 1100 : 1300)) + gdy } else if (l.kind !== 'freeform') { out.dx = (l.dx ?? 0) + gdx; out.dy = (l.dy ?? 0) + gdy }
      }
      if (g.zoom && g.zoom !== 100) out.zoom = ((l.zoom ?? 100) * g.zoom) / 100
      if (g.rotation) out.rotation = (l.rotation ?? 0) + g.rotation
    }
    return out
  })
}

/** Every colour the members of a group use (layer colour, colour slots, gradient stops, outlines). */
export function groupColors(layers: OverlayLayer[], gid: string): string[] {
  const set = new Set<string>()
  const add = (c?: string): void => { if (c && /^#/.test(c)) set.add(c.toLowerCase()) }
  for (const l of layers) {
    if (l.group !== gid) continue
    if (!(l.kind === 'design' && l.colors?.length)) add(l.color)
    l.colors?.forEach(add)
    l.stops?.forEach((s) => add(s.c))
    if (l.fill?.kind === 'gradient') l.fill.stops.forEach((s) => add(s.color))
    if (l.border) add(l.borderColor)
  }
  return [...set]
}

/** Replace one colour by another in every member of a group (all the places groupColors looks at). */
export function swapGroupColor(layers: OverlayLayer[], gid: string, from: string, to: string): OverlayLayer[] {
  const f = from.toLowerCase()
  const sw = (c: string | undefined): string | undefined => (c && c.toLowerCase() === f ? to : c)
  return layers.map((l) => (l.group !== gid ? l : {
    ...l, color: sw(l.color)!, colors: l.colors?.map((c) => sw(c)!), stops: l.stops?.map((s) => ({ ...s, c: sw(s.c)! })),
    fill: l.fill?.kind === 'gradient' ? { ...l.fill, stops: l.fill.stops.map((s) => ({ ...s, color: sw(s.color)! })) } : l.fill?.kind === 'solid' ? { ...l.fill, color: sw(l.fill.color)! } : l.fill,
    borderColor: sw(l.borderColor)
  }))
}

/** Keep every group's members right after it (relative order kept); members of missing groups are ungrouped. */
export function normalizeGroups(layers: OverlayLayer[]): OverlayLayer[] {
  const ids = new Set(layers.filter((l) => l.kind === 'group').map((g) => g.id))
  const clean = layers.map((l) => (l.group && (!ids.has(l.group) || l.kind === 'group') ? { ...l, group: undefined } : l))
  const out: OverlayLayer[] = []
  for (const l of clean) {
    if (l.group) continue
    out.push(l)
    if (l.kind === 'group') out.push(...clean.filter((m) => m.group === l.id))
  }
  return out
}

/**
 * Drag & drop in the layer list (the top row is drawn last): the dragged layer (or a whole group) lands just above
 * the target row; dropped on a group (header or member) it joins that group; `targetId` '' sends it to the bottom.
 */
export function dropLayer(layers: OverlayLayer[], dragId: string, targetId: string): OverlayLayer[] {
  const ls = normalizeGroups(layers)
  const d = ls.find((l) => l.id === dragId)
  if (!d) return ls
  const block = d.kind === 'group' ? ls.filter((l) => l.id === d.id || l.group === d.id) : [d]
  const rest = ls.filter((l) => !block.includes(l))
  const t = rest.find((l) => l.id === targetId)
  if (targetId && !t) return ls
  const lastOf = (g: string): number => rest.reduce((i, l, k) => (l.id === g || l.group === g ? k : i), -1)
  let at = -1, group: string | undefined
  if (!t) at = -1
  // dropped on a group's header: a layer goes inside the group (on top of its members), a group goes after it
  else if (t.kind === 'group') { at = lastOf(t.id); if (d.kind !== 'group') group = t.id }
  else if (t.group && d.kind === 'group') at = lastOf(t.group)
  else { at = rest.indexOf(t); group = t.group }
  const moved = d.kind === 'group' ? block : [{ ...d, group }]
  return normalizeGroups([...rest.slice(0, at + 1), ...moved, ...rest.slice(at + 1)])
}

/** Move a layer one step back (-1) or forward (+1): members within their group, everything else as whole blocks. */
export function moveLayer(layers: OverlayLayer[], id: string, dir: -1 | 1): OverlayLayer[] {
  const ls = normalizeGroups(layers)
  const L = ls.find((l) => l.id === id)
  if (!L) return ls
  if (L.group) {
    const members = ls.map((l, i) => [l, i] as const).filter(([l]) => l.group === L.group).map(([, i]) => i)
    const p = members.indexOf(ls.indexOf(L)), q = members[p + dir]
    if (q === undefined) return ls
    const out = [...ls]; [out[members[p]], out[q]] = [out[q], out[members[p]]]
    return out
  }
  const units: OverlayLayer[][] = []
  for (const l of ls) if (l.group) units[units.length - 1].push(l); else units.push([l])
  const u = units.findIndex((x) => x[0].id === id), v = u + dir
  if (v < 0 || v >= units.length) return ls
  ;[units[u], units[v]] = [units[v], units[u]]
  return units.flat()
}
export type PanelStyle = 'solid' | 'stripes' | 'stripes2c' | 'border' | 'twoTone' | 'center' | 'tipped'
export const PANEL_STYLES: [PanelStyle, string, number][] = [
  ['solid', 'Liso', 1], ['stripes', 'Riscas', 1], ['stripes2c', 'Riscas (2 cores)', 2], ['border', 'Com rebordo', 2], ['twoTone', 'Duas cores', 2], ['center', 'Risca ao centro', 2], ['tipped', 'Rebordo interior', 2]
]
export type PanelKind = 'sides' | 'shoulders' | 'neck' | 'cuffs' | 'shortsHem' | 'shortsSides' | 'sockFold' | 'sockTrim'

export interface LogoPlacement {
  assetId?: string
  enabled: boolean
  tint: LogoTint
  color?: string
  size: number // px in texture space (box)
  outlineColor?: string
  outlineWidth?: number // 0 = none
  dx: number; dy: number // offset from default spot
  rot?: number // own rotation (degrees), on top of the spot's
  side?: 'left' | 'right' | 'both' // sleeve badges; shorts logos: which leg
  spot?: 'front' | 'back' | 'middle' // shorts sponsor; back sponsors: 'top' | 'bottom' via place
  place?: 'top' | 'bottom' // back sponsors: above or below the name/number
  alsoShorts?: boolean // chest brand repeated on the shorts
  alsoSocks?: boolean // … on the socks
  alsoSleeves?: boolean // … on both sleeves (a sleeve badge marked `brand`)
  brand?: boolean // sleeve badge that follows the chest brand
  shine?: number // own shininess in the 3D preview (when the Logos tab's overall shininess is off)
  embroidery?: TextureSpec // embroidery texture over the logo
  outlineRelief?: number // 0 … 100: the logo and its outline stand out from the fabric (3D preview only)
}

export interface Logos {
  crest: LogoPlacement
  brand: LogoPlacement
  sponsor: LogoPlacement // legacy single sponsor (migrated into sponsors)
  backSponsor: LogoPlacement // legacy
  sleeveBadge: LogoPlacement // legacy
  sponsors?: LogoPlacement[]
  backSponsors?: LogoPlacement[]
  sleeveBadges?: LogoPlacement[]
  shortsCrest: LogoPlacement
  shortsBrand: LogoPlacement
  shortsSponsor?: LogoPlacement // legacy single shorts sponsor (migrated into shortsSponsors)
  shortsSponsors?: LogoPlacement[]
  socksSponsors?: LogoPlacement[] // more logos on the socks besides the brand
  socksBrand: LogoPlacement
}

export type CollarStyle = 'solid' | 'tipped' | 'twoTone' | 'stripes2' | 'stripes3' | 'threeColor' | 'half' | 'front' | 'back' | 'halftone'
  | 'vInsert' | 'vInsert3' | 'vSlim' | 'placket'
  | 'front1' | 'front2' | 'front3' | 'innerTrim' | 'outerTrim' | 'doubleTrim' | 'stripes4' | 'vSlimL' | 'vSlimR' | 'vInsertR3' | 'vLine' | 'placketStripe' | 'placketWide'
/**
 * Collar design. `front`: the part of the collar model that lies on the chest (flaps, lining) — 'base' paints it
 * in the shirt colour (default: no torso design showing through in pieces), 'design' leaves the shirt design.
 */
export interface CollarSpec { style: CollarStyle; c1: string; c2: string; c3: string; front?: 'design' | 'base' | 'color'; frontColor?: string; width?: number
  /** own options of the collar design (rim / stripes / V / placket sizes), see COLLAR_PARAMS */
  p?: Record<string, number | boolean | string> }
export interface CuffSpec { style: 'none' | 'solid' | 'tipped' | 'stripes2' | 'stripes3'; c1: string; c2: string; width: number; stitch?: StitchSpec
  /** fabric texture ("Tecido") on the cuffs, only on the colour slots in `fabricSlots` (0 = colour 1, 1 = colour 2; none = all) */
  fabric?: TextureSpec; fabricSlots?: number[]
  /** stripes / tip: width of each stripe, space between stripes, distance of the first one from the cuff's edge (px) */
  stripeW?: number; gap?: number; offset?: number }
export interface FabricLayer { id: string; source: string /* builtin id or asset:<id> */; zones: FabricZone[]; opacity: number; scale: number; blend: GlobalCompositeOperation; visible: boolean; v2?: boolean /* zones include shorts / socks explicitly */ }
export interface ArmbandSpec { all?: boolean /* same in every kit of the team */; show: boolean; fill: Fill; text: string; textColor: string; font: string; textSize?: number /* % of the default size */; crest?: boolean; crestSize?: number; pattern?: string; patternColor?: string; patternScale?: number /* % */; patternAngle?: number; patternWidth?: number /* % */; patternDx?: number }

/** Own look for the chest or shorts number (otherwise they use the back numbers). */
export interface PartNumSpec { mode: 'same' | 'recolor' | 'font' | 'file'; fill: string; outline: string; outlineWidth: number; font: string; asset?: string; recolor?: boolean }

export interface NumbersSpec {
  chest?: PartNumSpec
  leg?: PartNumSpec
  mode: 'game' | 'recolor' | 'font' | 'file'
  backAsset?: string; legAsset?: string; nameAsset?: string // imported FTEX/PNG atlases (mode 'file')
  fileRecolor?: boolean // mode 'file': repaint the chosen set with `fill` (game / other teams' numbers recoloured)
  nameBelow?: boolean
  font: string
  fill: string
  outline: string
  outlineWidth: number
}

export interface KitBase {
  kind: 'template' | 'image'
  imageAssetId?: string // full 2048 texture (game kit or imported)
  cleanLogos?: boolean // legacy: all areas
  clean?: string[] // CLEAN_RECTS keys to erase
  recolor?: { from: string; to: string; part?: string }[]
}

export interface KitDesign {
  slot: string
  base: KitBase
  colors: KitColors
  torso: PatternSpec
  sleevePattern: PatternSpec
  shortsPattern: PatternSpec
  socksPattern: PatternSpec
  layers: OverlayLayer[]
  logos: Logos
  numbers: NumbersSpec
  config: Record<string, number | string>
  templateId?: string
  // v2
  fills?: Partial<Record<'shirt' | 'sleeves' | 'shorts' | 'socks', Fill>>
  sleeveToShoulder?: boolean
  shine?: number // fabric shininess in the 3D preview, 0 (matte) … 100 (glossy)
  collar?: CollarSpec
  cuffs?: CuffSpec
  fabrics?: FabricLayer[]
  armband?: ArmbandSpec
  /** where the sleeve design sits among the layers: drawn right after this layer / group ('' = under all of them) */
  sleeveAfter?: string
  /** shorts / socks base moved among the layers: drawn again right after this layer / group (over the ones below) */
  baseAfter?: { shorts?: string; socks?: string }
  /** "Mangas com ombros": the sleeve colour also covers the shoulders up to the neck (raglan), with the seam bent by
   *  `curve` and its neck / armpit points moved */
  raglan?: { sharp?: number /* 0 … 100: how sharp the corner of the seam is (0 = smooth curve) */; curve?: number; bend?: number /* seam bend as an angle in degrees (replaces `curve`, in px, of older kits) */; neck?: number; arm?: number; down?: number; armX?: number /* armpit point X */; neckB?: number; downB?: number /* neck point of the back (X / Y); unset = like the front */ }
  /** stitching along the sleeves (the raglan seam, or the armhole) */
  sleeveStitch?: StitchSpec
  /** 3D shininess of the logos: one value for all (`all`), or each logo's own `shine` */
  logoShine?: { all: boolean; value: number }
  /** 3D shininess of the preview name and numbers: one value, or one per part */
  numberShine?: { all: boolean; value: number; back?: number; name?: number; chest?: number; leg?: number }
  /** the kit's main fabric over everything (null = none; new kits: fine knit) and the stitching of the hems (null = none) */
  fabric?: TextureSpec | null
  hemStitch?: StitchSpec | null
  /** socks: the fabric on the base (null = none), a second base colour (one colour per sock), shorts seams: hem and the middle (fly / back) */
  socksFabric?: TextureSpec | null
  socksColor2?: string
  fabricShorts?: boolean // the kit's main fabric on the shorts too (default yes)
  shortsHem?: StitchSpec | null
  shortsMid?: StitchSpec | null
  v?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
}

export interface Asset { id: string; name: string; dataUrl: string; w?: number; h?: number }

export interface TeamProject {
  version: 1
  teamId: number
  teamName: string
  league: string
  crestAssetId?: string
  updateGameEmblem: boolean
  kits: KitDesign[]
  assets: Record<string, Asset>
}

// ---------------------------------------------------------------- colour utils
export function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '')
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}
export const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
export function luminance(h: string): number {
  const [r, g, b] = hexToRgb(h)
  return 0.299 * r + 0.587 * g + 0.114 * b
}
export const contrastOn = (bg: string): string => (luminance(bg) > 150 ? '#111111' : '#ffffff')
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b)
  return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t)
}
export function colorDist(a: string, b: string): number {
  const x = hexToRgb(a), y = hexToRgb(b)
  return Math.sqrt((x[0] - y[0]) ** 2 * 0.3 + (x[1] - y[1]) ** 2 * 0.59 + (x[2] - y[2]) ** 2 * 0.11)
}

// ---------------------------------------------------------------- defaults
const logo = (size: number, enabled = true, tint: LogoTint = 'original'): LogoPlacement => ({ enabled, tint, size, dx: 0, dy: 0 })

/**
 * Where each logo sits at offset 0, as an offset from the measured spot in compose.ts (logo frame: x right, y down;
 * the user's chosen defaults, 2026-11-14). Shorts: per leg (the other leg mirrors x).
 */
export const LOGO_BASE = {
  crest: [-7, 18], brand: [10, 12], backSponsor: [0, 40], sleeveBadge: [-6, -26], sleeveBrand: [-21, -125], socks: [-44, 3],
  shortsCrest: [-75, 26] /* right leg */, shortsBrand: [76, 46] /* left leg */
} as const
export function shortsBase(kind: 'shortsCrest' | 'shortsBrand', leg: 'left' | 'right'): [number, number] {
  const [x, y] = LOGO_BASE[kind]
  const measured = kind === 'shortsCrest' ? 'right' : 'left'
  return [leg === measured ? x : -x, y]
}
export const LOGO_SIZES = { crest: 98, brand: 93, backSponsor: 100, sleeveBadge: 100, sleeveBrand: 74, shortsCrest: 94, shortsBrand: 88, socks: 72 }

export function defaultLogos(): Logos {
  return {
    crest: logo(LOGO_SIZES.crest), brand: logo(LOGO_SIZES.brand, true, 'auto'), sponsor: logo(380, true, 'auto'), backSponsor: logo(330, false, 'auto'),
    sleeveBadge: logo(120, false), shortsCrest: { ...logo(LOGO_SIZES.shortsCrest, true), side: 'right' }, shortsBrand: { ...logo(LOGO_SIZES.shortsBrand, true, 'auto'), side: 'left' }, socksBrand: logo(LOGO_SIZES.socks, false, 'auto'),
    sponsors: [], backSponsors: [], sleeveBadges: [], shortsSponsor: { ...logo(220, false, 'auto'), spot: 'back' }
  }
}

/** Fill the v2 logo lists from the legacy single slots when they are missing. */
export function normalizeLogos(lg: Logos): Logos {
  const l = { ...lg }
  if (!l.sponsors?.length && l.sponsor?.assetId) l.sponsors = [{ ...l.sponsor }]
  if (!l.backSponsors?.length && l.backSponsor?.assetId) l.backSponsors = [{ ...l.backSponsor }]
  if (!l.sleeveBadges?.length && l.sleeveBadge?.assetId) l.sleeveBadges = [{ ...l.sleeveBadge, side: l.sleeveBadge.side ?? 'both' }]
  l.sponsors ??= []; l.backSponsors ??= []; l.sleeveBadges ??= []; l.socksSponsors ??= []
  l.shortsSponsor ??= { enabled: false, tint: 'auto', size: 160, dx: 0, dy: 0, spot: 'back' }
  // several shorts sponsors (0.4.0): the old single one becomes the first of the list
  if (!l.shortsSponsors) { l.shortsSponsors = l.shortsSponsor.assetId ? [{ ...l.shortsSponsor }] : []; l.shortsSponsor = { ...l.shortsSponsor, enabled: false, assetId: undefined } }
  return l
}

export function colorsFrom(c1: string, c2: string, c3?: string): KitColors {
  return {
    shirt: c1, shirt2: c2, shirt3: c3 ?? c2, sleeves: c1, cuffs: c2, collar: c2,
    shorts: c1, shorts2: c2, socks: c1, socks2: c2, armband: '#f2c230'
  }
}

export const NONE: PatternSpec = { id: 'none', color: '#ffffff', count: 3, width: 40 }

export function defaultDesign(slot: string, c1 = '#1f4fb4', c2 = '#ffffff'): KitDesign {
  const d = migrateKit({
    slot,
    base: { kind: 'template' },
    colors: colorsFrom(c1, c2),
    torso: { ...NONE },
    sleevePattern: { ...NONE },
    shortsPattern: { ...NONE },
    socksPattern: { id: 'topBand', color: c2, count: 2, width: 40 },
    layers: [],
    logos: defaultLogos(),
    numbers: { mode: 'game', font: 'Impact', fill: contrastOn(c1), outline: c2, outlineWidth: 0 },
    // written in the old (pre-v6) sense: migrateKit flips it, so a new kit ends with NUMBER_DEFAULTS (1 = right leg)
    config: { Collar: 66, WinterCollar: 66, ShirtModel: 144, ShortsModel: 1, TightKit: 1, ...NUMBER_DEFAULTS, ShortsNumberSide: 1 - NUMBER_DEFAULTS.ShortsNumberSide }
  })
  // new kits: name / numbers and logos with their own shininess on (logos: the general value; socks sponsors off by default)
  return { ...d, fabric: MAIN_FABRIC, hemStitch: HEM_STITCH, shortsHem: SHORTS_HEM_STITCH, shortsMid: MID_STITCH, numberShine: { all: true, value: 90 }, logoShine: { all: false, value: 75 } }
}

/** Name / number defaults for new kits (the user's choice, 2026-11-14; the height sliders run inverted: shown 17 = BackNumberY 12, shown 7 = NameY 32). */
export const NUMBER_DEFAULTS = { BackNumberY: 12, BackNumberSize: 24, BackNumberSpacing: 12, NameY: 32, NameSize: 5, NameStretch: 2, ShortsNumberSide: 1, ShortsNumberSize: 18, ShortsNumberX: 10, ShortsNumberY: 15 }

export function defaultFabrics(): FabricLayer[] {
  return [
    { id: 'seams', source: 'seams', zones: ['front', 'back', 'sleeves', 'shorts', 'socks'], opacity: 0.55, scale: 100, blend: 'multiply', visible: false, v2: true },
    { id: 'knit', source: 'knit', zones: ['front', 'back', 'sleeves'], opacity: 0.22, scale: 100, blend: 'soft-light', visible: false, v2: true }
  ]
}

/** Bring any saved design up to the current model (v2): torso pattern → layer, single logos → lists, defaults. */
export function migrateKit(k: KitDesign): KitDesign {
  if (k.v === 10) return k
  return toV10(k.v === 9 ? k : toV9(k.v === 8 ? k : toV8(k.v === 7 ? k : toV7(k.v === 6 ? k : toV6(k.v === 5 ? k : toV5(k.v === 4 ? k : toV4(migrateV3(k))))))))
}

/**
 * v10 (0.4.23): the shorts' base design (inside "Base") is a layer of its own, so it stays editable; imported kits
 * never drew the sock fabric, so it starts off there (they can switch it on).
 */
function toV10(k: KitDesign): KitDesign {
  const d: KitDesign = { ...k, v: 10 }
  if (k.base.kind === 'image' && k.socksFabric) d.socksFabric = null
  const p = k.shortsPattern
  if (p && p.id !== 'none' && k.base.kind !== 'image') {
    const L: OverlayLayer = {
      id: uid(), kind: 'pattern', part: 'shorts', pattern: p.id, color: p.color, fill: p.fill, count: p.count, width: p.width, visible: true, opacity: 1,
      rotation: p.angle || undefined, dx: p.dx || undefined, dy: p.dy || undefined, stitch: p.stitch, fabric: p.fabric, fromTemplate: true
    }
    // right after the layer the base design was moved behind (else at the bottom of the shorts layers)
    const layers = [...k.layers]
    const after = k.baseAfter?.shorts
    let at = 0
    if (after) { const idx = layers.map((l, i) => (l.id === after || l.group === after ? i : -1)).filter((i) => i >= 0); if (idx.length) at = Math.max(...idx) + 1 }
    layers.splice(at, 0, L)
    d.layers = layers
    d.shortsPattern = { ...NONE }
  }
  return d
}

/** v9 (0.4.19): the shorts hem and middle seam start switched on (kits of 0.4.18 had them off by default). */
function toV9(k: KitDesign): KitDesign {
  return { ...k, v: 9, shortsHem: k.shortsHem ?? SHORTS_HEM_STITCH, shortsMid: k.shortsMid ?? MID_STITCH }
}

/** v8 (0.4.18): the sock texture is a fabric on the sock base (kits saved before get the former 3D look as a real fabric); shorts seams are options (none in older kits). */
function toV8(k: KitDesign): KitDesign {
  return { ...k, v: 8, socksFabric: k.socksFabric === undefined ? SOCKS_FABRIC : k.socksFabric, shortsHem: k.shortsHem ?? null, shortsMid: k.shortsMid ?? null }
}

/** v7 (0.4.16): the kit's main fabric and hem stitching are options; kits saved before keep neither (null). */
function toV7(k: KitDesign): KitDesign {
  return { ...k, v: 7, fabric: k.fabric ?? null, hemStitch: k.hemStitch ?? null }
}

/**
 * v6 (0.4.4): ShortsNumberSide follows the Sider (0 = left, 1 = right). The editor had them the other way round
 * (0 shown as "Direita"), so the number went on the other leg in the game: saved values are flipped to keep the leg
 * that was chosen in the editor.
 */
function toV6(k: KitDesign): KitDesign {
  const v = k.config?.ShortsNumberSide
  const d: KitDesign = { ...k, v: 6 }
  if (v !== undefined && v !== null && v !== '') d.config = { ...k.config, ShortsNumberSide: Number(v) === 1 ? 0 : 1 }
  return d
}

/** v5 (0.3): the collar row only holds the model and the base colour; a collar design becomes its own layer (on top). */
function toV5(k: KitDesign): KitDesign {
  const d: KitDesign = { ...k, layers: [...k.layers] }
  const cs = d.collar
  if (cs && cs.style !== 'solid' && d.base.kind === 'template') {
    d.layers.push({ id: uid(), kind: 'collar', collarStyle: cs.style, part: 'torso', visible: true, opacity: 1, color: cs.c1, colors: [cs.c1, cs.c2, cs.c3], width: cs.width })
    d.collar = { ...cs, style: 'solid' }
  }
  d.v = 5
  return d
}

/**
 * v4 (0.2.37): logos have new spots at offset 0 (LOGO_BASE). Saved offsets are moved by the same amount so every
 * logo stays exactly where it was; the shorts logos get the leg they used by default before (crest left, brand right).
 */
function toV4(k: KitDesign): KitDesign {
  const d: KitDesign = JSON.parse(JSON.stringify(k))
  const L = d.logos
  const sub = (lp: LogoPlacement | undefined, b: readonly [number, number] | [number, number]): void => { if (lp) { lp.dx -= b[0]; lp.dy -= b[1] } }
  sub(L.crest, LOGO_BASE.crest)
  sub(L.brand, LOGO_BASE.brand)
  for (const b of L.backSponsors ?? []) if (b.place !== 'top') sub(b, LOGO_BASE.backSponsor)
  for (const b of L.sleeveBadges ?? []) sub(b, b.brand ? LOGO_BASE.sleeveBrand : LOGO_BASE.sleeveBadge)
  sub(L.socksBrand, LOGO_BASE.socks)
  for (const [key, def] of [['shortsCrest', 'left'], ['shortsBrand', 'right']] as const) {
    const lp = L[key]
    if (!lp) continue
    lp.side ??= def
    if (lp.side === 'both') { lp.dy -= LOGO_BASE[key][1]; continue }
    sub(lp, shortsBase(key, lp.side === 'left' ? 'left' : 'right'))
  }
  d.v = 4
  return d
}

function migrateV3(k: KitDesign): KitDesign {
  if (k.v === 3) return k
  if (k.v === 2) {
    // v3 (0.2): shorts / socks logos are placed flat on each leg's UV island; old offsets were millimetres on the
    // 3D projection, so they restart from the new default spots
    const d: KitDesign = JSON.parse(JSON.stringify(k))
    for (const lp of [d.logos.shortsCrest, d.logos.shortsBrand, d.logos.shortsSponsor, d.logos.socksBrand]) if (lp) { lp.dx = 0; lp.dy = 0 }
    d.v = 3
    return d
  }
  const d: KitDesign = JSON.parse(JSON.stringify(k))
  if (d.torso && d.torso.id !== 'none') {
    d.layers.unshift({ id: uid(), kind: 'pattern', part: 'torso', pattern: d.torso.id, color: d.torso.color, count: d.torso.count, width: d.torso.width, zones: ['front', 'back'], visible: true, opacity: 1, fromTemplate: true })
    d.torso = { ...NONE }
  }
  for (const L of d.layers) {
    if (L.part === 'shirt' || L.part === 'torso') {
      L.part = 'torso'
      if (!L.zones) L.zones = L.kind === 'text' ? (L.side === 'back' ? ['back'] : L.side === 'both' ? ['front', 'back'] : ['front']) : ['front', 'back']
    }
  }
  d.logos = normalizeLogos(d.logos)
  d.collar ??= { style: 'solid', c1: d.colors.collar, c2: d.colors.shirt, c3: d.colors.shirt2 }
  d.cuffs ??= { style: 'solid', c1: d.colors.cuffs, c2: d.colors.shirt2, width: 60 }
  d.fabrics ??= defaultFabrics()
  d.armband ??= { show: true, fill: solid(d.colors.armband), text: 'C', textColor: '#111111', font: 'Arial Black' }
  d.fills ??= {}
  d.v = 3
  return d
}

export function migrateProject(p: TeamProject): TeamProject {
  return { ...p, kits: p.kits.map(migrateKit) }
}

/** Up to 12 team kits (p1…p12) and 4 goalkeeper kits (g1…g4). */
export const PLAYER_SLOTS = Array.from({ length: 12 }, (_, i) => 'p' + (i + 1))
export const GK_SLOTS = Array.from({ length: 4 }, (_, i) => 'g' + (i + 1))
export const ALL_SLOTS = [...PLAYER_SLOTS, ...GK_SLOTS]
export const SLOT_LABEL: Record<string, string> = {
  p1: 'Principal', p2: 'Alternativo', p3: 'Terceiro', p4: 'Quarto',
  ...Object.fromEntries(PLAYER_SLOTS.slice(4).map((s) => [s, 'Equipamento ' + s.slice(1)])),
  ...Object.fromEntries(GK_SLOTS.map((s) => [s, 'GR ' + s.slice(1)]))
}

export const uid = (): string => Math.random().toString(36).slice(2, 10)

/** p1 … p12, g1 … g4 (numeric order) */
export const slotOrder = (a: string, b: string): number => (a[0] === b[0] ? (Number(a.slice(1)) || 0) - (Number(b.slice(1)) || 0) : a[0] === 'p' ? -1 : 1)

/**
 * "Copy to all kits" for logos: what the other kit already has (same image) stays as it is; what is missing is
 * added. Without colours, a logo that fills an empty place keeps that kit's own colour settings for it.
 */
export function mergeLogos(to: Logos, from: Logos, withColors: boolean): Logos {
  const src = JSON.parse(JSON.stringify(from)) as Logos
  const look = (t: LogoPlacement, s: LogoPlacement): LogoPlacement => (withColors ? s : { ...s, tint: t.tint, color: t.color, outlineColor: t.outlineColor, outlineWidth: t.outlineWidth })
  const one = (t: LogoPlacement | undefined, s: LogoPlacement | undefined): LogoPlacement | undefined => {
    if (!s) return t
    if (!t) return s
    if (t.assetId && t.assetId === s.assetId && t.enabled) return withColors ? { ...t, tint: s.tint, color: s.color, outlineColor: s.outlineColor, outlineWidth: s.outlineWidth } : t
    return s.assetId || s.enabled ? look(t, s) : t
  }
  const list = (t: LogoPlacement[] | undefined, s: LogoPlacement[] | undefined): LogoPlacement[] => {
    const out = [...(t ?? [])]
    for (const x of s ?? []) {
      const i = out.findIndex((y) => (x.brand ? y.brand : !!x.assetId && y.assetId === x.assetId))
      if (i < 0) out.push(withColors || x.tint === 'original' ? x : { ...x, tint: 'auto', color: undefined })
      else if (withColors) out[i] = { ...out[i], tint: x.tint, color: x.color, outlineColor: x.outlineColor, outlineWidth: x.outlineWidth }
    }
    return out
  }
  return {
    ...to,
    crest: one(to.crest, src.crest)!, brand: one(to.brand, src.brand)!, shortsCrest: one(to.shortsCrest, src.shortsCrest)!, shortsBrand: one(to.shortsBrand, src.shortsBrand)!, socksBrand: one(to.socksBrand, src.socksBrand)!,
    sponsors: list(to.sponsors, src.sponsors), backSponsors: list(to.backSponsors, src.backSponsors), sleeveBadges: list(to.sleeveBadges, src.sleeveBadges), shortsSponsors: list(to.shortsSponsors, src.shortsSponsors), socksSponsors: list(to.socksSponsors, src.socksSponsors)
  }
}

/** "Copy to all kits" for numbers / names / fonts: without colours each kit keeps its own number colours. */
export function copyNumbers(to: NumbersSpec, from: NumbersSpec, withColors: boolean): NumbersSpec {
  const s = JSON.parse(JSON.stringify(from)) as NumbersSpec
  if (withColors) return s
  const part = (t: PartNumSpec | undefined, x: PartNumSpec | undefined): PartNumSpec | undefined => (x && t ? { ...x, fill: t.fill, outline: t.outline } : x)
  return { ...s, fill: to.fill, outline: to.outline, chest: part(to.chest, s.chest), leg: part(to.leg, s.leg) }
}
