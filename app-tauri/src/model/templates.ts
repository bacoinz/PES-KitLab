/** Ready-made kit templates and the bulk kit-set generator. */
import type { KitDesign, PatternSpec, Logos, OverlayLayer } from './design'
import { defaultDesign, colorsFrom, contrastOn, luminance, colorDist, mix, hexToRgb, NONE, slotOrder, uid, normalizeLogos } from './design'

type Role = 'c1' | 'c2' | 'c3'
interface Tpl {
  id: string
  name: string
  torso?: [string, Role, number?, number?] // id, colour role, count, width
  sleeves?: [string, Role, number?, number?]
  shorts?: [string, Role, number?, number?]
  socks?: [string, Role, number?, number?]
  sleeveColor?: Role
  collar?: number
  cuffs?: Role
  /** extra editable layers (panels, textures, warped / blurred designs…); `mask` = index of another extra layer */
  layers?: TplLayer[]
}
type TplLayer = Partial<OverlayLayer> & { kind: OverlayLayer['kind']; role: Role; mask?: number }
const P = (panel: NonNullable<OverlayLayer['panel']>, role: Role, size: number, more: Partial<OverlayLayer> = {}): TplLayer => ({ kind: 'panel', panel, role, size, part: panel.startsWith('shorts') ? 'shorts' : panel.startsWith('sock') ? 'socks' : 'torso', ...more })
const TX = (pattern: string, role: Role, opacity: number, scale = 70, more: Partial<TplLayer> = {}): TplLayer => ({ kind: 'texture', pattern, role, opacity, scale, zones: ['front', 'back'], ...more })
const D = (pattern: string, role: Role, count: number, width: number, more: Partial<OverlayLayer> = {}): TplLayer => ({ kind: 'pattern', pattern, role, count, width, zones: ['front', 'back'], ...more })

export const TEMPLATES: Tpl[] = [
  { id: 'classic', name: 'Clássico liso', socks: ['topBand', 'c2', 1, 20], collar: 66 },
  { id: 'modern', name: 'Moderno', sleeves: ['end', 'c2', 1, 15], shorts: ['side', 'c2', 1, 30], socks: ['stripes', 'c2', 2, 30], collar: 12 },
  { id: 'stripes', name: 'Riscas', torso: ['stripes', 'c2', 3, 50], sleeveColor: 'c2', socks: ['hoops', 'c2', 2, 40], collar: 30 },
  { id: 'thinStripes', name: 'Riscas finas', torso: ['pinstripes', 'c2', 14, 40], socks: ['topBand', 'c2'], collar: 66 },
  { id: 'hoops', name: 'Listas (Celtic)', torso: ['hoops', 'c2', 4, 50], sleeves: ['hoops', 'c2', 3, 50], socks: ['hoops', 'c2', 3, 50], collar: 1 },
  { id: 'halves', name: 'Metades', torso: ['halves', 'c2'], sleeveColor: 'c2', shorts: ['halves', 'c2'], collar: 30 },
  { id: 'quarters', name: 'Quartos', torso: ['quarters', 'c2'], socks: ['topBand', 'c2'], collar: 66 },
  { id: 'sash', name: 'Faixa diagonal', torso: ['sash', 'c2', 1, 40], socks: ['topBand', 'c2'], collar: 12 },
  { id: 'center', name: 'Faixa central', torso: ['center', 'c2', 1, 40], shorts: ['side', 'c2'], collar: 66 },
  { id: 'chevron', name: 'Chevron', torso: ['chevron', 'c2', 1, 40], sleeves: ['top', 'c2'], collar: 30 },
  { id: 'bigV', name: 'V no peito', torso: ['bigV', 'c2', 1, 35], socks: ['topBand', 'c2'], collar: 12 },
  { id: 'chestBand', name: 'Faixa no peito', torso: ['chestBand', 'c2', 1, 40], sleeves: ['top', 'c2'], collar: 66 },
  { id: 'shoulders', name: 'Ombros', torso: ['shoulders', 'c2', 1, 40], sleeves: ['shoulder', 'c2', 1, 40], collar: 66 },
  { id: 'sides', name: 'Painéis laterais', torso: ['sides', 'c2', 1, 40], shorts: ['sidePanel', 'c2'], socks: ['topBand', 'c2'], collar: 12 },
  { id: 'side3', name: 'Três riscas', torso: ['side3', 'c2', 3, 40], sleeves: ['three', 'c2', 3, 40], shorts: ['three', 'c2'], socks: ['stripes', 'c2', 3, 30], collar: 30 },
  { id: 'gradient', name: 'Degradê', torso: ['gradient', 'c2', 1, 60], sleeves: ['end', 'c2'], collar: 12 },
  { id: 'diagonal', name: 'Riscas diagonais', torso: ['diagonal', 'c2', 6, 30], socks: ['topBand', 'c2'], collar: 12 },
  { id: 'check', name: 'Xadrez', torso: ['check', 'c2', 6, 40], sleeveColor: 'c1', collar: 66 },
  { id: 'cross', name: 'Cruz', torso: ['cross', 'c2', 1, 40], socks: ['topBand', 'c2'], collar: 1 },
  { id: 'split', name: 'Corte diagonal', torso: ['split', 'c2', 1, 45], sleeveColor: 'c2', collar: 12 },
  { id: 'bottom', name: 'Base contrastante', torso: ['bottom', 'c2', 1, 30], sleeves: ['end', 'c2'], collar: 66 },
  { id: 'halfHoops', name: 'Listas à frente', torso: ['halfHoops', 'c2', 3, 50], collar: 30 },
  { id: 'retro', name: 'Retro', torso: ['pinstripes', 'c3', 10, 30], sleeves: ['rings', 'c2', 2], socks: ['stripes', 'c2', 2, 40], collar: 1, cuffs: 'c2' },
  { id: 'twin', name: 'Duas faixas', torso: ['twin', 'c2', 2, 40], shorts: ['side', 'c2'], collar: 66 },
  { id: 'sideTape', name: 'Fita lateral', torso: ['sideTape', 'c2', 1, 30], sleeves: ['top', 'c2'], shorts: ['side', 'c2'], collar: 12 },
  // 0.2.12: templates built from several layers (panels, graphic textures, warps, blur, masks)
  { id: 'panelsPro', name: 'Painéis modernos', layers: [P('sides', 'c2', 110, { panelSleeve: true }), P('shoulders', 'c2', 44, { panelSleeve: true }), P('shortsSides', 'c2', 50), P('sockFold', 'c2', 84)], collar: 12 },
  { id: 'neckYoke', name: 'Gola em destaque', layers: [P('neck', 'c2', 70), P('shortsHem', 'c2', 50), P('sockTrim', 'c2', 18)], collar: 66, cuffs: 'c2' },
  { id: 'tonalDots', name: 'Pontos tom-sobre-tom', layers: [TX('dots', 'c3', 0.2, 60)], sleeves: ['end', 'c2'], socks: ['topBand', 'c2'], collar: 66 },
  { id: 'halftone', name: 'Meio-tom', layers: [TX('halftone', 'c2', 0.45, 90)], sleeves: ['end', 'c2'], shorts: ['side', 'c2'], collar: 12 },
  { id: 'shards', name: 'Estilhaços', layers: [TX('shards', 'c2', 0.35, 110), P('shoulders', 'c2', 40, { panelSleeve: true })], socks: ['stripes', 'c2', 2, 30], collar: 30 },
  { id: 'speed', name: 'Velocidade', layers: [TX('speed', 'c2', 0.4, 90), P('sides', 'c2', 60)], shorts: ['side', 'c2'], collar: 12 },
  { id: 'camo', name: 'Camuflado', layers: [TX('camo', 'c3', 0.35, 120, { zones: ['front', 'back', 'sleeves'] })], shorts: ['side', 'c2'], socks: ['topBand', 'c2'], collar: 66 },
  { id: 'topo', name: 'Curvas de nível', layers: [TX('topo', 'c2', 0.25, 100), P('neck', 'c2', 40)], socks: ['topBand', 'c2'], collar: 12 },
  { id: 'pinlines', name: 'Linhas clássicas', layers: [TX('pinlines', 'c2', 0.6, 50)], collar: 1, cuffs: 'c2', socks: ['stripes', 'c2', 2, 30] },
  { id: 'wave', name: 'Faixa ondulada', layers: [D('chestBand', 'c2', 1, 40, { warp: { kind: 'wave', amount: 60 } })], sleeves: ['end', 'c2'], collar: 30 },
  { id: 'arc', name: 'Faixa em arco', layers: [D('chestBand', 'c2', 1, 35, { warp: { kind: 'arc', amount: 90 } })], sleeves: ['top', 'c2'], socks: ['topBand', 'c2'], collar: 66 },
  { id: 'softSash', name: 'Faixa esbatida', layers: [D('sash', 'c2', 1, 45, { blur: 30 })], socks: ['topBand', 'c2'], collar: 12 },
  { id: 'mirrorDiag', name: 'Diagonais simétricas', layers: [D('diagonal', 'c2', 4, 25, { mirrorCenter: true })], sleeves: ['end', 'c2'], collar: 30 },
  { id: 'hexTech', name: 'Favo técnico', layers: [TX('hex', 'c2', 0.25, 60), P('sides', 'c3', 70)], shorts: ['sidePanel', 'c3'], collar: 12 },
  { id: 'tartan', name: 'Tartan retro', layers: [TX('tartan', 'c2', 0.35, 90)], collar: 1, cuffs: 'c2', socks: ['hoops', 'c2', 2, 40] },
  { id: 'houndstooth', name: 'Pied-de-poule', layers: [TX('houndstooth', 'c2', 0.3, 60)], sleeves: ['end', 'c2'], collar: 66 },
  { id: 'gradientPanels', name: 'Degradê com painéis', torso: ['gradient', 'c2', 1, 60], layers: [P('sides', 'c3', 80, { panelSleeve: true })], collar: 12 },
  { id: 'zigzagBand', name: 'Faixa em zigue-zague', layers: [D('chestBand', 'c2', 1, 40), TX('zigzag', 'c3', 1, 40, { mask: 0 })], sleeves: ['top', 'c2'], collar: 66 },
  { id: 'stripesFade', name: 'Riscas a desvanecer', layers: [D('stripes', 'c2', 5, 45), D('bottom', 'c1', 1, 60, { blur: 60 })], socks: ['hoops', 'c2', 2, 30], collar: 30 },
  { id: 'starBand', name: 'Faixa estrelada', layers: [D('center', 'c2', 1, 35), TX('stars', 'c3', 1, 50, { mask: 0 })], shorts: ['side', 'c2'], collar: 12 }
]

const spec = (t: [string, Role, number?, number?] | undefined, cols: Record<Role, string>): PatternSpec =>
  t ? { id: t[0], color: cols[t[1]], count: t[2] ?? 3, width: t[3] ?? 40 } : { ...NONE }

/** Apply a template to a design keeping logos, numbers and config. */
export function applyTemplate(d: KitDesign, tplId: string, c1: string, c2: string, c3?: string): KitDesign {
  const t = TEMPLATES.find((x) => x.id === tplId) ?? TEMPLATES[0]
  const cols = { c1, c2, c3: c3 ?? mix(c1, c2, 0.5) }
  const colors = colorsFrom(c1, c2, cols.c3)
  if (t.sleeveColor) colors.sleeves = cols[t.sleeveColor]
  colors.cuffs = t.cuffs ? cols[t.cuffs] : colors.sleeves
  colors.collar = c2
  colors.shorts = d.slot.startsWith('g') ? c1 : colors.shorts
  // the template's torso design becomes a normal (editable) pattern layer at the bottom of the stack
  const keep = d.layers.filter((l) => !l.fromTemplate)
  const tl: OverlayLayer[] = t.torso ? [{ id: uid(), kind: 'pattern' as const, part: 'torso' as const, pattern: t.torso[0], color: cols[t.torso[1]], count: t.torso[2] ?? 3, width: t.torso[3] ?? 40, zones: ['front', 'back'] as ('front' | 'back')[], visible: true, opacity: 1, fromTemplate: true }] : []
  const extra: OverlayLayer[] = (t.layers ?? []).map(({ role, mask: _m, ...l }) => ({ part: 'torso', visible: true, opacity: 1, ...l, id: uid(), color: cols[role], fromTemplate: true }))
  ;(t.layers ?? []).forEach((l, i) => { if (l.mask != null && extra[l.mask]) extra[i].maskLayer = extra[l.mask].id })
  tl.push(...extra)
  return {
    ...d,
    templateId: t.id,
    base: { kind: 'template' },
    colors: { ...colors, armband: d.colors.armband },
    fills: {},
    collar: { style: 'solid', c1: c2, c2: c1, c3: cols.c3 },
    cuffs: { style: t.cuffs ? 'solid' : 'none', c1: colors.cuffs, c2: c1, width: 60 },
    layers: [...tl, ...keep],
    torso: { ...NONE },
    sleevePattern: spec(t.sleeves, cols),
    shortsPattern: spec(t.shorts, cols),
    socksPattern: spec(t.socks, cols),
    config: { ...d.config, Collar: t.collar ?? 66, WinterCollar: t.collar ?? 66 },
    numbers: { ...d.numbers, fill: contrastOn(c1), outline: c2 }
  }
}

// ---------------------------------------------------------------- bulk set generation
const GK_COLORS = ['#f2d50f', '#18b04a', '#ff7a00', '#7a2fd0', '#111111', '#1ec8e6', '#e8126e', '#9fe01a', '#8a8a8a']

function saturation(h: string): number {
  const [r, g, b] = hexToRgb(h)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return mx ? (mx - mn) / mx : 0
}

/** Pick primary / secondary / tertiary colours from a crest palette. */
export function teamColorsFromPalette(pal: { color: string; share: number }[]): [string, string, string] {
  const cand = pal.filter((p) => p.share > 0.03)
  if (!cand.length) return ['#1f4fb4', '#ffffff', '#111111']
  const neutral = (c: string): number => (luminance(c) > 225 || luminance(c) < 30 ? 0.55 : 1)
  const score = (p: { color: string; share: number }): number => p.share * (0.6 + 0.4 * saturation(p.color)) * neutral(p.color)
  const scored = [...cand].sort((a, b) => score(b) - score(a))
  const c1 = scored[0].color
  const others = cand.filter((p) => colorDist(p.color, c1) > 60).sort((a, b) => b.share - a.share)
  const c2 = others[0]?.color ?? (luminance(c1) > 140 ? '#111111' : '#ffffff')
  const c3 = others.find((p) => colorDist(p.color, c2) > 60)?.color ?? (luminance(c1) > 140 ? '#1a1a1a' : '#f0f0f0')
  return [c1, c2, c3]
}

export interface BulkTeamInput {
  c1: string; c2: string; c3?: string
  templates: { home: string; away: string; third: string; gk: string }
  perSlot?: Record<string, string> // template per kit (overrides the role default)
  slots: string[] // e.g. p1 p2 p3 g1
  logos: Logos
}

export function generateSet(inp: BulkTeamInput, rnd = Math.random): KitDesign[] {
  const { c1, c2 } = inp
  const c3 = inp.c3 ?? (luminance(c1) > 140 ? '#1a1a1a' : '#f2f2f2')
  const out: KitDesign[] = []
  const pick = (id: string): string => (id === 'random' ? TEMPLATES[Math.floor(rnd() * TEMPLATES.length)].id : id)
  for (const slot of [...inp.slots].sort(slotOrder)) {
    let a: string, b: string, tpl: string
    if (slot === 'p1') { a = c1; b = c2; tpl = pick(inp.templates.home) }
    else if (slot === 'p2') {
      // away: light kit if home is dark and vice versa, keeping the club colour as detail
      const light = luminance(c1) < 140
      a = light ? (luminance(c2) > 180 ? c2 : '#f4f4f4') : (luminance(c2) < 90 ? c2 : '#15161a')
      b = colorDist(a, c1) > 80 ? c1 : c2
      tpl = pick(inp.templates.away)
    } else if (slot === 'p3' || slot === 'p4') { a = c3; b = colorDist(c3, c1) > 80 ? c1 : c2; tpl = pick(inp.templates.third) }
    else {
      const used = [c1, c2, c3, out.find((k) => k.slot === 'p2')?.colors.shirt ?? '#ffffff']
      const gks = [...GK_COLORS].sort((x, y) => Math.min(...used.map((u) => colorDist(y, u))) - Math.min(...used.map((u) => colorDist(x, u))))
      const prev = out.filter((k) => k.slot.startsWith('g')).map((k) => k.colors.shirt)
      a = gks.find((g) => !prev.includes(g)) ?? gks[0]
      b = contrastOn(a) === '#ffffff' ? mix(a, '#000000', 0.45) : mix(a, '#000000', 0.55)
      tpl = pick(inp.templates.gk)
    }
    const base = defaultDesign(slot, a, b)
    base.logos = normalizeLogos(JSON.parse(JSON.stringify(inp.logos)))
    if (slot.startsWith('g')) base.logos.sponsor.enabled = inp.logos.sponsor.enabled
    const own = inp.perSlot?.[slot]
    if (own && own !== 'default') tpl = pick(own)
    out.push(applyTemplate(base, tpl, a, b, slot === 'p1' ? c3 : undefined))
  }
  return out
}
