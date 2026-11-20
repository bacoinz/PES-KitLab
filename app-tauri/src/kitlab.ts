/**
 * Shareable kit file (`.kitlab`): one kit with everything it uses (layers, colours, fabrics, numbers, names, sponsors,
 * crest, brand and all the images), packed by the app core (kitlab.rs) as a ZIP with `kit.json` and `assets/`.
 * Importing never trusts the file: the app core checks the ZIP, this module checks the kit, and the kit goes through
 * the same format migrations as any saved kit.
 */
import { create } from 'zustand'
import type { Asset, KitDesign, LogoPlacement, TeamProject } from './model/design'
import { KIT_VERSION, kitAssetIds, migrateKit, remapKitAssets, slotOrder, uid } from './model/design'
import { SYSTEM_FONTS } from './compositor/numbers'

export const KITLAB_FORMAT = 1

/** A parsed .kitlab picked on a team card: the editor opens its import dialog for it as soon as the team is open. */
export const usePendingKitlab = create<{ file: ParsedKitlab | null; set(f: ParsedKitlab | null): void }>((set) => ({ file: null, set: (file) => set({ file }) }))

export interface ParsedKitlab {
  name: string
  team: string
  slot: string
  kit: KitDesign // migrated to the current format, asset ids as in the file
  assets: Record<string, Asset> // by the file's asset ids
  /** the crest / brand images of the file (asset ids as in the file) */
  crestId?: string
  brandId?: string
  sponsors: number
  missingFonts: string[]
  missingAssets: number
}

export interface KitlabChoices { slot: string; crest: boolean; brand: boolean; sponsors: boolean }

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export const crestIdOf = (k: KitDesign): string | undefined => k.logos.crest?.assetId ?? k.logos.shortsCrest?.assetId
export const brandIdOf = (k: KitDesign): string | undefined =>
  k.logos.brand?.assetId ?? k.logos.shortsBrand?.assetId ?? k.logos.socksBrand?.assetId ?? k.logos.sleeveBadges?.find((b) => b.brand && b.assetId)?.assetId

/** How many sponsor / badge images the kit places (not counting the crest and the brand). */
export function sponsorCount(k: KitDesign): number {
  const L = k.logos
  const lists = [L.sponsors, L.backSponsors, L.shortsSponsors, L.socksSponsors, L.sleeveBadges?.filter((b) => !b.brand)]
  const single = [L.sponsor, L.backSponsor, L.sleeveBadge, L.shortsSponsor]
  return lists.reduce((n, l) => n + (l ?? []).filter((x) => x.assetId).length, 0) + single.filter((x) => x?.assetId).length
}

// ---------------------------------------------------------------- export
export interface ExportOutcome { path: string | null; assets: number }

export interface BuiltKitlab { fileName: string; manifest: string; assets: { id: string; dataUrl: string }[] }

/** The manifest and images of a kit. Crest and brand are always included, also for kits that come from the game. */
export function buildKitlab(project: TeamProject, kit: KitDesign, version: string): BuiltKitlab {
  const k = clone(kit)
  // kits made from a game texture have no logos of their own: give them the team's crest and brand so the file has them
  const crestId = crestIdOf(k) ?? (project.crestAssetId && project.assets[project.crestAssetId] ? project.crestAssetId : undefined)
  if (crestId && !k.logos.crest.assetId) k.logos.crest.assetId = crestId
  const brandId = brandIdOf(k) ?? project.kits.map(brandIdOf).find((id) => id && project.assets[id])
  if (brandId && !k.logos.brand.assetId) k.logos.brand.assetId = brandId
  const ids = [...kitAssetIds(k)].filter((id) => project.assets[id])
  const map: Record<string, string> = {}
  ids.forEach((id, i) => { map[id] = 'a' + (i + 1) })
  const out = remapKitAssets(k, map)
  const manifest = {
    format: 'kitlab',
    formatVersion: KITLAB_FORMAT,
    app: version,
    name: `${project.teamName} ${kit.slot}`,
    team: project.teamName,
    slot: kit.slot,
    contains: { crest: !!(crestId && map[crestId]), brand: !!(brandId && map[brandId]), sponsors: sponsorCount(k) },
    kit: out,
    assets: Object.fromEntries(ids.map((id) => {
      const a = project.assets[id]
      const role = id === crestId ? 'crest' : id === brandId ? 'brand' : undefined
      return [map[id], { name: a.name, w: a.w, h: a.h, role }]
    }))
  }
  const base = `${project.teamName}-${kit.slot}`.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'kit'
  return { fileName: base + '.kitlab', manifest: JSON.stringify(manifest), assets: ids.map((id) => ({ id: map[id], dataUrl: project.assets[id].dataUrl })) }
}

/** Writes the kit as a `.kitlab` (save dialog). */
export async function exportKitlab(project: TeamProject, kit: KitDesign, version: string): Promise<ExportOutcome> {
  const b = buildKitlab(project, kit, version)
  return { path: await window.kc.exportKitlab(b.fileName, b.manifest, b.assets), assets: b.assets.length }
}

// ---------------------------------------------------------------- import
const NEWER = 'Este ficheiro foi feito numa versão mais recente do PES KitLab. Atualiza a app para o abrir.'

/** Reads a `.kitlab` and checks it. Throws an Error with a message for the user when it is not usable. */
export async function parseKitlab(path: string): Promise<ParsedKitlab> {
  const r = await window.kc.readKitlab(path)
  const m = r.kit
  if (!isObj(m) || m.format !== 'kitlab') throw new Error('Este ficheiro não é um kit do PES KitLab.')
  if (typeof m.formatVersion !== 'number' || m.formatVersion > KITLAB_FORMAT) throw new Error(NEWER)
  const raw = m.kit
  if (!isObj(raw) || typeof raw.slot !== 'string' || !Array.isArray(raw.layers) || !isObj(raw.logos) || !isObj(raw.colors)) throw new Error('O kit dentro do ficheiro está incompleto.')
  if (typeof raw.v === 'number' && raw.v > KIT_VERSION) throw new Error(NEWER)
  let kit: KitDesign
  try { kit = migrateKit(clone(raw) as unknown as KitDesign) } catch { throw new Error('O kit dentro do ficheiro não é válido.') }
  if (!/^[pg]\d{1,2}$/.test(kit.slot)) throw new Error('O kit dentro do ficheiro tem um equipamento desconhecido.')
  const info = isObj(m.assets) ? m.assets : {}
  const assets: Record<string, Asset> = {}
  for (const [id, a] of Object.entries(r.assets)) {
    const meta = isObj(info[id]) ? (info[id] as Record<string, unknown>) : {}
    assets[id] = { id, name: (typeof meta.name === 'string' ? meta.name : a.name).slice(0, 120), dataUrl: a.dataUrl, w: a.w, h: a.h }
  }
  const missingAssets = [...kitAssetIds(kit)].filter((id) => !assets[id]).length
  const have = new Set(SYSTEM_FONTS.map((f) => f.toLowerCase()))
  const fonts = [kit.numbers?.font, kit.numbers?.chest?.font, kit.numbers?.leg?.font, kit.armband?.font, ...kit.layers.map((l) => l.font)]
  const missingFonts = [...new Set(fonts.filter((f): f is string => typeof f === 'string' && f.length > 0 && !have.has(f.toLowerCase())))]
  return {
    name: typeof m.name === 'string' ? m.name.slice(0, 120) : kit.slot,
    team: typeof m.team === 'string' ? m.team.slice(0, 120) : '',
    slot: kit.slot,
    kit, assets,
    crestId: crestIdOf(kit) && assets[crestIdOf(kit)!] ? crestIdOf(kit) : undefined,
    brandId: brandIdOf(kit) && assets[brandIdOf(kit)!] ? brandIdOf(kit) : undefined,
    sponsors: sponsorCount(kit),
    missingFonts, missingAssets
  }
}

/** The team's own crest and brand (the images other kits of the team use), for the import dialog. */
export function teamLogos(project: TeamProject): { crest?: Asset; brand?: Asset } {
  const crest = project.crestAssetId ? project.assets[project.crestAssetId] : undefined
  const brandId = project.kits.map(brandIdOf).find((id) => id && project.assets[id])
  return { crest, brand: brandId ? project.assets[brandId] : undefined }
}

/** Slots a kit of this kind can go to: players p1 … p12, goalkeepers g1 … g4. */
export const slotFamily = (slot: string): string => (slot.startsWith('g') ? 'g' : 'p')

/**
 * The project with the file's kit in `choices.slot` (replacing what was there). Positions, sizes and colours always come
 * from the file; the choices only decide which images are used for the crest, the brand and the sponsors. Every image
 * that comes in gets a new id, so nothing already in the project is overwritten.
 */
export function applyKitlab(project: TeamProject, f: ParsedKitlab, c: KitlabChoices): TeamProject {
  const idMap: Record<string, string> = {}
  for (const id of Object.keys(f.assets)) { let n = uid(); while (project.assets[n] || Object.values(idMap).includes(n)) n = uid(); idMap[id] = n }
  const kit = remapKitAssets(clone(f.kit), idMap)
  kit.slot = c.slot
  const L = kit.logos
  const { crest: teamCrest, brand: teamBrand } = teamLogos(project)
  const use = (lp: LogoPlacement, a: Asset | undefined): LogoPlacement => (a ? { ...lp, assetId: a.id } : { ...lp, assetId: undefined, enabled: false })
  if (!c.crest) {
    L.crest = use(L.crest, teamCrest)
    L.shortsCrest = use(L.shortsCrest, teamCrest)
  }
  if (!c.brand) {
    L.brand = use(L.brand, teamBrand)
    L.shortsBrand = use(L.shortsBrand, teamBrand)
    L.socksBrand = use(L.socksBrand, teamBrand)
    L.sleeveBadges = (L.sleeveBadges ?? []).flatMap((b) => (!b.brand ? [b] : teamBrand ? [{ ...b, assetId: teamBrand.id }] : []))
  }
  if (!c.sponsors) {
    const off = (lp: LogoPlacement): LogoPlacement => ({ ...lp, assetId: undefined, enabled: false })
    L.sponsors = []; L.backSponsors = []; L.shortsSponsors = []; L.socksSponsors = []
    L.sleeveBadges = (L.sleeveBadges ?? []).filter((b) => b.brand)
    L.sponsor = off(L.sponsor); L.backSponsor = off(L.backSponsor); L.sleeveBadge = off(L.sleeveBadge)
    if (L.shortsSponsor) L.shortsSponsor = off(L.shortsSponsor)
  }
  // only the images the kit still uses come into the project
  const fresh: Record<string, Asset> = {}
  for (const [fid, a] of Object.entries(f.assets)) fresh[idMap[fid]] = { ...a, id: idMap[fid] }
  const assets = { ...project.assets }
  for (const id of kitAssetIds(kit)) if (!assets[id] && fresh[id]) assets[id] = fresh[id]
  const kits = [...project.kits.filter((k) => k.slot !== c.slot), kit].sort((a, b) => slotOrder(a.slot, b.slot))
  return { ...project, kits, assets }
}

// exposed for scripted verification runs (KC_SCRIPT)
;(window as unknown as { __kcKitlab: object }).__kcKitlab = { buildKitlab, parseKitlab, applyKitlab, usePendingKitlab }
