import { create } from 'zustand'
import type { GameStatus, TeamInfo, TeamExport, KitExport } from '@shared/types'
import type { Settings, LibraryItem, DraftInfo, PresetType, KitDefaults } from '@shared/ipc'
import type { TeamProject, KitDesign, KitColors, Asset, Logos } from './model/design'
import { defaultLogos, uid, slotOrder, migrateProject, migrateKit } from './model/design'
import { generateSet, teamColorsFromPalette, applyTemplate, TEMPLATES } from './model/templates'
import { luminance, colorDist } from './model/design'
import { composeKit, composeRgba, composeLive, designConfig, frontThumb } from './compositor/compose'
import { palette, dataUrlFromBytes, rgbaToCanvas, canvasToDataUrl, canvasRgba, loadAsset, canvas, ctx2d, trim } from './compositor/images'
import { findBoxes, recolorNumbers, renderNumbers, type NumberPart } from './compositor/numbers'
import { atlasImage } from './compositor/atlases'

export type View = 'teams' | 'editor' | 'bulk' | 'library' | 'settings'

interface State {
  settings: Settings | null
  status: GameStatus | null
  teams: TeamInfo[]
  progress: string
  toast: { kind: 'ok' | 'err'; text: string } | null
  view: View
  project: TeamProject | null
  savedProject: TeamProject | null // last saved version of the open project
  drafts: DraftInfo[]
  activeSlot: string
  past: TeamProject[]
  future: TeamProject[]
  library: LibraryItem[]
  bulkSelection: number[]
  teamsFilter: { league: string; country: string; q: string; kits: 'all' | 'with' | 'without'; open: Record<string, boolean> }

  setView(v: View): void
  notify(kind: 'ok' | 'err', text: string): void
  init(): Promise<void>
  openGame(root: string): Promise<void>
  refreshTeams(): Promise<void>
  refreshLibrary(): Promise<void>
  openTeam(team: TeamInfo, opts?: { fromGame?: boolean }): Promise<void>
  /** Editor on a sandbox project (teamId PRESET_TEAM) with the "new kit" templates, one kit per type. */
  openPresetEditor(type: PresetType): void
  /** Save the sandbox kits as the "new kit" templates of their types. */
  savePresets(): Promise<void>
  /** Editor on one saved shirt template; Guardar writes it back. */
  openUserTemplate(t: UserTemplate): void
  saveUserTemplate(): Promise<void>
  editingTemplate: UserTemplate | null
  loadProject(p: TeamProject, saved?: TeamProject | null): void
  refreshDrafts(): Promise<void>
  openDraft(teamId: number): Promise<boolean>
  saveProject(): Promise<void>
  discardKit(slot: string): void
  discardAll(): void
  exportTeams(ids: number[]): Promise<void>
  setProject(fn: (p: TeamProject) => TeamProject, record?: boolean): void
  updateKit(slot: string, fn: (k: KitDesign) => KitDesign): void
  setActiveSlot(s: string): void
  undo(): void
  redo(): void
  /** history panel: go straight to step i of [...past, project, ...future] */
  jumpHistory(i: number): void
  toggleBulk(id: number, on?: boolean): void
  setBulk(ids: number[]): void
}

/** Sandbox project used to edit the "new kit" templates (never saved as a team draft). */
/** When each undo step was made (history panel) and when the last one was, to merge quick runs of changes. */
export const stepTime = new WeakMap<TeamProject, number>()
let lastStep = 0
export const PRESET_TEAM = -1
/** Sandbox project used to edit one saved shirt template (Biblioteca → Templates). */
export const USER_TPL_TEAM = -2
export interface UserTemplate { id: string; name: string; date: string; kit: KitDesign; assets: Record<string, Asset> }
export const PRESET_SLOT: Record<PresetType, string> = { home: 'p1', away: 'p2', third: 'p3', fourth: 'p4', gk: 'g1' }
export const slotType = (slot: string): PresetType => (slot === 'p1' ? 'home' : slot === 'p2' ? 'away' : slot === 'p3' ? 'third' : slot === 'p4' ? 'fourth' : 'gk')
/** Template for a new kit in this slot: its own one (editor), else the single saved kit. */
function presetFor(def: KitDefaults, slot: string): string | undefined {
  const t = slotType(slot)
  return def.presets?.[t] ?? (t === 'fourth' ? def.presets?.third : undefined) ?? def.preset
}
/** A saved design on top of a generated kit; `recolour`: the preset's colours become the kit's (team colours). */
function applyPreset(k: KitDesign, json: string, recolour: boolean): KitDesign {
  try {
    const pre = JSON.parse(json) as Partial<KitDesign>
    const map = new Map<string, string>()
    if (recolour && pre.colors) for (const key of Object.keys(pre.colors) as (keyof KitColors)[]) if (k.colors[key]) map.set(String(pre.colors[key]).toLowerCase(), k.colors[key])
    const swap = (v: unknown): unknown => typeof v === 'string' ? map.get(v.toLowerCase()) ?? v
      : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, swap(b)])) : v
    const recol = swap(pre) as Partial<KitDesign>
    return { ...k, ...recol, colors: recolour ? k.colors : recol.colors ?? k.colors, logos: k.logos, numbers: k.numbers, slot: k.slot, base: k.base, layers: (recol.layers ?? []).map((l) => ({ ...l, id: uid() })) }
  } catch { return k /* ignore a broken preset */ }
}

export const useApp = create<State>((set, get) => ({
  settings: null,
  status: null,
  teams: [],
  progress: '',
  toast: null,
  view: 'teams',
  project: null,
  savedProject: null,
  drafts: [],
  activeSlot: 'p1',
  past: [],
  future: [],
  library: [],
  bulkSelection: [],
  teamsFilter: { league: '', country: '', q: '', kits: 'all', open: {} },

  setView: (view) => set({ view }),
  notify: (kind, text) => {
    set({ toast: { kind, text } })
    setTimeout(() => { if (get().toast?.text === text) set({ toast: null }) }, kind === 'err' ? 8000 : 4000)
  },
  init: async () => {
    window.kc.onProgress((m) => set({ progress: m }))
    const settings = await window.kc.getSettings()
    set({ settings })
    get().refreshLibrary()
    get().refreshDrafts()
    if (settings.gameRoot) await get().openGame(settings.gameRoot).catch((e) => get().notify('err', String(e.message ?? e)))
  },
  openGame: async (root) => {
    const status = await window.kc.openGame(root)
    const teams = await window.kc.listTeams()
    set({ status, teams, settings: await window.kc.getSettings() })
  },
  refreshTeams: async () => set({ teams: await window.kc.listTeams() }),
  refreshLibrary: async () => set({ library: await window.kc.listLibrary() }),

  openTeam: async (team, opts = {}) => {
    set({ progress: 'A preparar ' + team.name })
    try {
      const assets: Record<string, Asset> = {}
      let crestId: string | undefined
      let colors: [string, string, string] = ['#1f4fb4', '#ffffff', '#111111']
      const emb = await window.kc.readEmblem(team.id)
      if (emb) {
        crestId = 'crest'
        assets.crest = { id: 'crest', name: team.name, dataUrl: await dataUrlFromBytes(emb, 'image/png') }
        colors = teamColorsFromPalette(palette(trim(await loadAsset(assets.crest)), 5))
      }
      const slots = team.slots.length ? [...new Set(team.slots.map((s) => s.slot))].sort(slotOrder) : ['p1', 'p2', 'g1']
      // the team's real home kit is the best source for its colours
      const kitColors = await gameKitColors(team.id).catch(() => null)
      if (kitColors) colors = kitColors
      // derive colours from the team's current config when available
      const cfg = team.slots.find((s) => s.slot === 'p1')?.config
      if (!kitColors && cfg?.ShirtColor1 && /^#[0-9a-f]{6}$/i.test(cfg.ShirtColor1)) colors = [cfg.ShirtColor1, cfg.ShirtColor2 && cfg.ShirtColor2 !== cfg.ShirtColor1 ? cfg.ShirtColor2 : colors[1], colors[2]]
      const logos: Logos = defaultLogos()
      logos.crest.assetId = crestId
      logos.shortsCrest.assetId = crestId
      const def = get().settings?.defaults ?? {}
      const T = def.templates ?? {}
      let kits = generateSet({ c1: colors[0], c2: colors[1], c3: colors[2], slots, logos, templates: { home: T.home || 'classic', away: T.away || 'classic', third: T.third || 'modern', gk: T.gk || 'classic' } })
      // own templates (made in the editor, per kit type) or the open kit saved as preset: their design, with their
      // colours swapped for the team's
      kits = kits.map((k) => { const pre = presetFor(def, k.slot); return pre ? applyPreset(k, pre, true) : k })
      for (const k of kits) {
        // chest number: off for clubs, on for national teams (unless the settings say otherwise)
        k.config.ChestNumberSize = def.chestNumber === 'always' ? 14 : def.chestNumber === 'never' ? 0 : team.country === 'Seleções' ? 14 : 0
        if (def.collar) { k.config.Collar = def.collar; k.config.WinterCollar = def.collar }
        if (def.shortsModel) k.config.ShortsModel = def.shortsModel
        if (def.tight !== undefined) k.config.TightKit = def.tight ? 1 : 0
        if (def.shine) k.shine = def.shine
      }
      if (opts.fromGame) {
        for (const k of kits) {
          const tex = await window.kc.readKitTexture(team.id, k.slot, 'kit', 0)
          if (!tex) continue
          const id = 'game_' + k.slot
          assets[id] = { id, name: `${team.name} ${k.slot} (jogo)`, dataUrl: await canvasToDataUrl(rgbaToCanvas(tex)) }
          k.base = { kind: 'image', imageAssetId: id, cleanLogos: false, recolor: [] }
          k.logos = { ...k.logos, crest: { ...k.logos.crest, enabled: false }, brand: { ...k.logos.brand, enabled: false }, sponsor: { ...k.logos.sponsor, enabled: false }, shortsCrest: { ...k.logos.shortsCrest, enabled: false }, shortsBrand: { ...k.logos.shortsBrand, enabled: false } }
          const c = team.slots.find((s) => s.slot === k.slot)?.config
          if (c?.Collar) k.config.Collar = Number(c.Collar)
        }
      }
      get().loadProject({ version: 1, teamId: team.id, teamName: team.name, league: team.league, crestAssetId: crestId, updateGameEmblem: false, kits, assets }, null)
      set({ view: 'editor' })
    } finally {
      set({ progress: '' })
    }
  },
  editingTemplate: null,
  openUserTemplate: (t) => {
    const kit = migrateKit({ ...JSON.parse(JSON.stringify(t.kit)), slot: 'p1' })
    const proj: TeamProject = { version: 1, teamId: USER_TPL_TEAM, teamName: 'Template: ' + t.name, league: '', updateGameEmblem: false, kits: [kit], assets: { ...t.assets } }
    get().loadProject(proj, proj)
    set({ view: 'editor', activeSlot: 'p1', editingTemplate: t })
  },
  saveUserTemplate: async () => {
    const p = get().project, t = get().editingTemplate
    if (!p || p.teamId !== USER_TPL_TEAM || !t) return
    const kit = p.kits[0]
    const used = new Set<string>()
    JSON.stringify(kit, (k2, v) => { if (typeof v === 'string' && ['assetId', 'imageAssetId', 'backAsset', 'legAsset', 'nameAsset', 'asset'].includes(k2)) used.add(v); if (k2 === 'source' && typeof v === 'string' && v.startsWith('asset:')) used.add(v.slice(6)); return v })
    const nt: UserTemplate = { ...t, date: new Date().toISOString(), kit, assets: Object.fromEntries([...used].filter((a) => p.assets[a]).map((a) => [a, p.assets[a]])) }
    await window.kc.saveUserTemplate(t.id, JSON.stringify(nt))
    set({ savedProject: p, editingTemplate: nt })
  },
  openPresetEditor: (type) => {
    const def = get().settings?.defaults ?? {}
    const T = def.templates ?? {}
    const types: PresetType[] = ['home', 'away', 'third', 'fourth', 'gk']
    const wanted = types.filter((t) => t === type || def.presets?.[t])
    const slots = wanted.map((t) => PRESET_SLOT[t])
    let kits = generateSet({ c1: '#1f4fb4', c2: '#ffffff', c3: '#111111', slots, logos: defaultLogos(), templates: { home: T.home || 'classic', away: T.away || 'classic', third: T.third || 'modern', gk: T.gk || 'classic' } })
    // the saved templates keep their own colours here (they are swapped for the team's when a team uses them)
    kits = kits.map((k) => { const pre = def.presets?.[slotType(k.slot)]; return pre ? applyPreset(k, pre, false) : k })
    for (const k of kits) k.config.ChestNumberSize ??= 0
    get().loadProject({ version: 1, teamId: PRESET_TEAM, teamName: 'Kit novo (templates)', league: '', updateGameEmblem: false, kits, assets: {} }, null)
    set({ view: 'editor', activeSlot: PRESET_SLOT[type] })
  },
  savePresets: async () => {
    const p = get().project
    if (!p || p.teamId !== PRESET_TEAM) return
    const def = get().settings?.defaults ?? {}
    const presets = { ...def.presets }
    for (const k of p.kits) { const { logos: _l, numbers: _n, slot: _s, base: _b, ...rest } = k; presets[slotType(k.slot)] = JSON.stringify(rest) }
    const s = await window.kc.saveSettings({ defaults: { ...def, presets } })
    set({ settings: s, savedProject: p })
  },
  loadProject: (raw, savedRaw) => { const p = migrateProject(raw); const saved = savedRaw ? (savedRaw === raw ? p : migrateProject(savedRaw)) : savedRaw; set({ project: p, savedProject: saved === undefined ? p : saved, activeSlot: p.kits[0]?.slot ?? 'p1', past: [], future: [] }) },
  refreshDrafts: async () => set({ drafts: await window.kc.listDrafts() }),
  openDraft: async (teamId) => {
    const j = await window.kc.loadDraft(teamId)
    if (!j) return false
    const p = JSON.parse(j) as TeamProject
    get().loadProject(p, p)
    set({ view: 'editor' })
    return true
  },
  saveProject: async () => {
    const p = get().project
    if (!p) return
    const thumbs: Record<string, string> = {}
    for (const k of p.kits) thumbs[k.slot] = await canvasToDataUrl(frontThumb(await composeKit(k, p.assets, { scale: 0.25 }), 128))
    await window.kc.saveDraft(p.teamId, JSON.stringify(p), thumbs)
    set({ savedProject: p })
    await get().refreshDrafts()
  },
  discardKit: (slot) => {
    const saved = get().savedProject
    get().setProject((p) => {
      const orig = saved?.kits.find((k) => k.slot === slot)
      const kits = orig ? p.kits.map((k) => (k.slot === slot ? orig : k)) : p.kits.filter((k) => k.slot !== slot)
      return { ...p, kits: kits.length ? kits : p.kits }
    })
    if (!saved?.kits.some((k) => k.slot === slot)) set({ activeSlot: get().project?.kits[0]?.slot ?? 'p1' })
  },
  discardAll: () => {
    const saved = get().savedProject
    if (saved) get().setProject(() => saved)
  },
  exportTeams: async (ids) => {
    let ok = 0
    const errors: string[] = []
    for (const [i, id] of ids.entries()) {
      const j = await window.kc.loadDraft(id)
      if (!j) continue
      const p = JSON.parse(j) as TeamProject
      set({ progress: `A exportar ${i + 1}/${ids.length}: ${p.teamName}` })
      try {
        await exportProject(p)
        await window.kc.saveDraft(id, j, {}, true)
        ok++
      } catch (e) { errors.push(`${p.teamName}: ${String((e as Error).message ?? e)}`) }
    }
    set({ progress: '' })
    await get().refreshDrafts()
    await get().refreshTeams()
    if (errors.length) get().notify('err', errors.join(' · '))
    else get().notify('ok', `${ok} equipa(s) exportada(s) para o jogo`)
  },
  setProject: (fn, record = true) => {
    const cur = get().project
    if (!cur) return
    const next = fn(cur)
    if (next === cur) return
    // undo steps: up to 300; a quick run of changes (dragging a slider, typing) is one step
    const now = Date.now()
    const merge = record && now - lastStep < 400 && get().past.length > 0
    if (record) lastStep = now
    if (record && !merge) stepTime.set(next, now)
    else if (merge) stepTime.set(next, now)
    set({ project: next, past: record && !merge ? [...get().past.slice(-300), cur] : get().past, future: record ? [] : get().future })
  },
  updateKit: (slot, fn) => get().setProject((p) => ({ ...p, kits: p.kits.map((k) => (k.slot === slot ? fn(k) : k)) })),
  setActiveSlot: (activeSlot) => set({ activeSlot }),
  undo: () => {
    const { past, project, future } = get()
    if (!past.length || !project) return
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] })
  },
  redo: () => {
    const { past, project, future } = get()
    if (!future.length || !project) return
    set({ project: future[0], future: future.slice(1), past: [...past, project] })
  },
  jumpHistory: (i) => {
    const { past, project, future } = get()
    if (!project) return
    const all = [...past, project, ...future]
    if (i < 0 || i >= all.length) return
    lastStep = 0
    set({ project: all[i], past: all.slice(0, i), future: all.slice(i + 1) })
  },
  toggleBulk: (id, on) => {
    const s = new Set(get().bulkSelection)
    if (on ?? !s.has(id)) s.add(id)
    else s.delete(id)
    set({ bulkSelection: [...s] })
  },
  setBulk: (ids) => set({ bulkSelection: ids })
}))

/** Main colours of a team's current home kit (torso front of the game texture). */
export async function gameKitColors(teamId: number): Promise<[string, string, string] | null> {
  const img = await window.kc.readKitTexture(teamId, 'p1', 'kit', 3)
  if (!img) return null
  const k = img.width / 2048
  const pal = palette(rgbaToCanvas(img), 5, (x, y) => x / k >= 720 && x / k < 1330 && y / k >= 990 && y / k < 1820)
  if (!pal.length) return null
  const sorted = [...pal].sort((a, b) => b.share - a.share)
  const c1 = sorted[0].color
  // shading of the main colour shows up as near-duplicates: require a real difference
  const c2 = sorted.find((p) => p.share > 0.04 && colorDist(p.color, c1) > 70)?.color ?? (luminance(c1) > 140 ? '#111111' : '#ffffff')
  const c3 = sorted.find((p) => p.share > 0.03 && colorDist(p.color, c1) > 70 && colorDist(p.color, c2) > 70)?.color ?? (luminance(c1) > 140 ? '#1a1a1a' : '#f0f0f0')
  return [c1, c2, c3]
}

// ---------------------------------------------------------------- asset helpers
export async function assetFromFile(path: string): Promise<Asset> {
  const name = path.split(/[\\/]/).pop() ?? 'imagem'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'dds' || ext === 'ftex') {
    const img = await window.kc.decodeImageFile(path)
    if (!img) throw new Error('Não foi possível ler ' + name)
    return { id: uid(), name, dataUrl: await canvasToDataUrl(rgbaToCanvas(img)), w: img.width, h: img.height }
  }
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
  const bytes = await window.kc.readFile(path)
  return normaliseAsset({ id: uid(), name, dataUrl: await dataUrlFromBytes(bytes, mime) })
}

/** A small copy of an image file for grid previews (at most `max` px, stable id per file so caches are reused). */
export async function previewAssetFromFile(path: string, max = 512): Promise<Asset> {
  const name = path.split(/[\\/]/).pop() ?? 'imagem'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
  const bmp = await createImageBitmap(new Blob([await window.kc.readFile(path)], { type: mime }))
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = canvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)))
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return { id: 'pv:' + path, name, dataUrl: await canvasToDataUrl(c), w: c.width, h: c.height }
}

/** The file as it is (no trimming / resizing): full-texture graphics must keep their 2048² layout. */
export async function rawAssetFromFile(path: string): Promise<Asset> {
  const name = path.split(/[\\/]/).pop() ?? 'imagem'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
  return { id: uid(), name, dataUrl: await dataUrlFromBytes(await window.kc.readFile(path), mime) }
}

export async function assetFromUrl(url: string): Promise<Asset> {
  const r = await window.kc.fetchUrl(url)
  let mime = r.mime.split(';')[0]
  if (!mime.startsWith('image/')) mime = /\.svg(\?|$)/i.test(url) ? 'image/svg+xml' : 'image/png'
  const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'logo')
  return normaliseAsset({ id: uid(), name, dataUrl: await dataUrlFromBytes(r.data, mime) })
}

/** Rasterise (SVG) and crop transparent borders so every logo is a tight PNG. */
async function normaliseAsset(a: Asset): Promise<Asset> {
  let bmp: ImageBitmap
  if (a.dataUrl.startsWith('data:image/svg')) {
    const img = new Image()
    img.src = a.dataUrl
    await img.decode()
    const s = 1024 / Math.max(img.naturalWidth || 512, img.naturalHeight || 512)
    const c = canvas(Math.round((img.naturalWidth || 512) * s), Math.round((img.naturalHeight || 512) * s))
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height)
    bmp = await createImageBitmap(c)
  } else bmp = await createImageBitmap(await (await fetch(a.dataUrl)).blob())
  const t = trim(bmp)
  const c = canvas((t as ImageBitmap).width, (t as ImageBitmap).height)
  ctx2d(c).drawImage(t as CanvasImageSource, 0, 0)
  return { ...a, dataUrl: await canvasToDataUrl(c), w: c.width, h: c.height }
}

export async function libraryAsset(item: LibraryItem): Promise<Asset> {
  return assetFromFile(item.path)
}

// ---------------------------------------------------------------- export
async function numbersFor(team: TeamProject, k: KitDesign, part: NumberPart): Promise<{ width: number; height: number; data: Uint8Array } | undefined> {
  if (k.numbers.mode === 'game') return undefined
  const r = await atlasImage(team.teamId, k.slot, part, k.numbers, team.assets)
  if (!r) return undefined
  if (r.img instanceof OffscreenCanvas) return { width: r.img.width, height: r.img.height, data: canvasRgba(r.img) }
  return { width: r.img.width, height: r.img.height, data: r.img.data }
}

export async function emblemImage(p: TeamProject): Promise<{ width: number; height: number; data: Uint8Array } | undefined> {
  if (!p.updateGameEmblem || !p.crestAssetId || !p.assets[p.crestAssetId]) return undefined
  const img = trim(await loadAsset(p.assets[p.crestAssetId]))
  const c = canvas(512, 512), g = ctx2d(c)
  const w = (img as ImageBitmap).width, h = (img as ImageBitmap).height, r = Math.min(480 / w, 480 / h)
  g.imageSmoothingQuality = 'high'
  g.drawImage(img as CanvasImageSource, (512 - w * r) / 2, (512 - h * r) / 2, w * r, h * r)
  return { width: 512, height: 512, data: canvasRgba(c) }
}

async function buildTeamExport(p: TeamProject, onStep?: (m: string) => void): Promise<{ t: TeamExport; thumb?: Uint8Array }> {
  const kits: KitExport[] = []
  let thumb: Uint8Array | undefined
  const size = useApp.getState().settings?.exportSize ?? 2048
  for (const k of p.kits) {
    onStep?.(`A desenhar ${p.teamName} ${k.slot}`)
    const kitRgba = await composeRgba(k, p.assets, { size })
    if (k.slot === 'p1' || !thumb) {
      const b = await frontThumb(await composeKit(k, p.assets, { scale: 0.5 }), 256).convertToBlob({ type: 'image/png' })
      thumb = new Uint8Array(await b.arrayBuffer())
    }
    kits.push({
      slot: k.slot,
      kit: kitRgba,
      back: await numbersFor(p, k, 'back'),
      leg: await numbersFor(p, k, 'leg'),
      name: await numbersFor(p, k, 'name'),
      chest: await numbersFor(p, k, 'chest'),
      config: designConfig(k)
    })
  }
  return { t: { teamId: p.teamId, teamName: p.teamName, league: p.league, kits, emblem: await emblemImage(p) }, thumb }
}

export async function exportProject(p: TeamProject, onStep?: (m: string) => void): Promise<string> {
  const { t, thumb } = await buildTeamExport(p, onStep)
  const r = await window.kc.exportTeam(t, JSON.stringify(p), thumb)
  return r.message
}

/** Export the kits of these teams (their saved work) in the kit-server layout, into a folder the user picks.
 *  The folder comes from Settings (unless "ask always") and each club gets a sub-folder with its name. */
export async function exportKitserverTeams(ids: number[], destFolder?: string): Promise<void> {
  const st = useApp.getState()
  const cfg = st.settings
  const preset = !(cfg?.kitExportAsk ?? true) && cfg?.kitExportDir ? cfg.kitExportDir : undefined
  const dest = destFolder ?? preset ?? await window.kc.pickFolder('Pasta onde guardar os kits (formato kitserver)')
  if (!dest) return
  const used = new Set<string>()
  let ok = 0, skipped = 0, lastFolder = dest
  const errors: string[] = []
  for (const [i, id] of ids.entries()) {
    const j = await window.kc.loadDraft(id)
    if (!j) { skipped++; continue }
    const p = JSON.parse(j) as TeamProject
    useApp.setState({ progress: `A exportar ${i + 1}/${ids.length}: ${p.teamName}` })
    try {
      let n = p.teamName.replace(/[<>:"/|?*#\x00-\x1f]|\\/g, '_').trim().replace(/\.+$/, '') || String(id)
      if (used.has(n.toLowerCase())) n = `${n} (${id})`
      used.add(n.toLowerCase())
      const folder = dest.replace(/[\\/]+$/, '') + '\\' + n
      const { t } = await buildTeamExport(p)
      await window.kc.exportKitserver(t, folder)
      ok++
      lastFolder = folder
    } catch (e) { errors.push(`${p.teamName}: ${String((e as Error).message ?? e)}`) }
  }
  useApp.setState({ progress: '' })
  // show the result: the club's folder for one team, the export folder for several (not in scripted runs)
  if (ok && !destFolder) void window.kc.openPath(ok === 1 ? lastFolder : dest)
  if (errors.length) st.notify('err', errors.join(' · '))
  else if (!ok) st.notify('err', 'Nenhuma das equipas tem trabalho guardado para exportar')
  else st.notify('ok', `${ok} equipa(s) exportada(s) em formato kitserver para ${dest}${skipped ? ` (${skipped} sem trabalho guardado)` : ''}`)
}

// exposed for scripted verification runs (KC_SCRIPT)
;(window as unknown as { __kc: typeof useApp }).__kc = useApp
// files added to the library folders show up without restarting the app
let libBusy = false
const refreshLib = (): void => {
  if (libBusy || !useApp.getState().settings) return
  libBusy = true
  useApp.getState().refreshLibrary().catch(() => undefined).finally(() => { libBusy = false })
  window.dispatchEvent(new Event('kc:library'))
}
window.addEventListener('focus', refreshLib)
setInterval(() => { if (document.visibilityState === 'visible') refreshLib() }, 4000)
;(window as unknown as { __kcTest: object }).__kcTest = { applyTemplate, TEMPLATES, frontThumb, composeKit, composeRgba, composeLive, renderNumbers, findBoxes, recolorNumbers, canvasToDataUrl, rgbaToCanvas, exportKitserverTeams }
