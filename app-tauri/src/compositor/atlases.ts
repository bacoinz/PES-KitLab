/** Glyph atlases (numbers / name) a kit will use in the game – for the 3D preview and for export. */
import type { NumbersSpec, Asset } from '../model/design'
import { findBoxes, recolorNumbers, renderNumbers, outlineAtlas, type NumberPart } from './numbers'
import { rgbaToCanvas, loadAsset, canvas, ctx2d } from './images'
import type { GlyphAtlas } from './decorate'
import type { RgbaImage } from '@shared/types'

const origCache = new Map<string, Promise<RgbaImage | null>>()
export const ATLAS_CHARS: Record<NumberPart, string> = { back: '0123456789', leg: '0123456789', chest: '0123456789', name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.' }

export function originalAtlas(teamId: number, slot: string, part: NumberPart): Promise<RgbaImage | null> {
  const key = `${teamId}:${slot}:${part}`
  let p = origCache.get(key)
  if (!p) {
    p = (async () => {
      for (const s of [slot, slot.startsWith('g') ? 'g1' : 'p1']) {
        const img = await window.kc.readKitTexture(teamId, s, part, 0).catch(() => null)
        if (img) return img
      }
      return null
    })()
    origCache.set(key, p)
  }
  return p
}

async function assetRgba(a: Asset | undefined): Promise<RgbaImage | null> {
  if (!a) return null
  const b = await loadAsset(a)
  const c = canvas(b.width, b.height), g = ctx2d(c)
  g.drawImage(b, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  return { width: c.width, height: c.height, data: new Uint8Array(d.buffer, d.byteOffset, d.length) }
}

/** The RGBA image the game will get for one part, or null to keep the team's original file. */
export async function atlasImage(teamId: number, slot: string, part: NumberPart, spec: NumbersSpec, assets: Record<string, Asset>): Promise<{ img: RgbaImage | OffscreenCanvas; orig: RgbaImage | null } | null> {
  // chest / shorts numbers may have their own look
  const own = part === 'chest' ? spec.chest : part === 'leg' ? spec.leg : undefined
  if (part === 'chest' && (!own || own.mode === 'same')) return null // the game then uses the back numbers
  const origPart: NumberPart = part === 'chest' ? 'back' : part
  const orig = await originalAtlas(teamId, slot, origPart)
  const eff = own && own.mode !== 'same'
    ? { ...spec, mode: own.mode as NumbersSpec['mode'], fill: own.fill, outline: own.outline, outlineWidth: own.outlineWidth, font: own.font, backAsset: own.asset, legAsset: own.asset, fileRecolor: own.recolor }
    : spec
  const withOutline = (c: OffscreenCanvas): OffscreenCanvas => (eff.mode !== 'font' && eff.outlineWidth > 0 ? outlineAtlas(c, eff.outline, eff.outlineWidth) : c)
  if (own && own.mode === 'recolor' && part !== 'name') {
    // chest / shorts "Recolorir": the same numbers as the back (the back's own file when one was loaded, else the
    // game's), only with these colours — no need to load the file again
    const src = spec.mode === 'file'
      ? (await assetRgba(part === 'leg' && spec.legAsset ? assets[spec.legAsset] : spec.backAsset ? assets[spec.backAsset] : undefined)) ?? orig
      : orig ?? (part === 'leg' ? await originalAtlas(teamId, slot, 'back') : null)
    if (src) return { img: withOutline(recolorNumbers(src, eff)), orig: src }
    // nothing to recolour: draw them with the back's font in these colours
    return { img: renderNumbers(part === 'chest' ? 'back' : part, findBoxes(origPart, null), { ...eff, mode: 'font', font: spec.font }), orig: null }
  }
  if (eff.mode === 'file') {
    const id = part === 'name' ? eff.nameAsset : part === 'leg' ? eff.legAsset ?? eff.backAsset : eff.backAsset
    const img = await assetRgba(id ? assets[id] : undefined)
    if (!img) return null
    if (eff.fileRecolor) return { img: withOutline(recolorNumbers(img, eff)), orig: img }
    return { img: eff.outlineWidth > 0 ? withOutline(rgbaToCanvas(img)) : img, orig }
  }
  if (eff.mode === 'game') return orig ? { img: eff.outlineWidth > 0 && part !== 'chest' ? withOutline(rgbaToCanvas(orig)) : orig, orig } : null
  if (eff.mode === 'recolor') return orig ? { img: withOutline(recolorNumbers(orig, eff)), orig } : null
  return { img: renderNumbers(part === 'chest' ? 'back' : part, findBoxes(origPart, orig), eff), orig }
}

/** Same team / kit / numbers spec → same atlases (switching tabs or kits does not rebuild them). */
const atlasCache = new Map<string, Promise<Record<NumberPart, GlyphAtlas | undefined>>>()
export function loadAtlases(teamId: number, slot: string, spec: NumbersSpec, assets: Record<string, Asset> = {}): Promise<Record<NumberPart, GlyphAtlas | undefined>> {
  const ids = [spec.backAsset, spec.legAsset, spec.nameAsset, spec.chest?.asset, spec.leg?.asset].map((id) => (id && assets[id] ? id + ':' + assets[id].dataUrl.length : ''))
  const key = JSON.stringify([teamId, slot, spec, ids])
  let p = atlasCache.get(key)
  if (!p) {
    p = buildAtlases(teamId, slot, spec, assets)
    p.catch(() => atlasCache.delete(key))
    if (atlasCache.size > 12) atlasCache.delete(atlasCache.keys().next().value!)
    atlasCache.set(key, p)
  }
  return p
}

async function buildAtlases(teamId: number, slot: string, spec: NumbersSpec, assets: Record<string, Asset> = {}): Promise<Record<NumberPart, GlyphAtlas | undefined>> {
  const out = {} as Record<NumberPart, GlyphAtlas | undefined>
  for (const part of ['back', 'leg', 'name', 'chest'] as NumberPart[]) {
    let r = await atlasImage(teamId, slot, part, spec, assets)
    if (!r && part === 'chest') { out.chest = undefined; continue }
    // nothing to show (team without files): fall back to a font so the preview still has numbers
    if (!r) r = { img: renderNumbers(part, findBoxes(part, null), { ...spec, mode: 'font' }), orig: null }
    const img = r.img instanceof OffscreenCanvas ? r.img : rgbaToCanvas(r.img)
    const boxesSrc = r.img instanceof OffscreenCanvas ? r.orig : r.img
    out[part] = { img, boxes: findBoxes(part === 'chest' ? 'back' : part, boxesSrc), chars: ATLAS_CHARS[part] }
  }
  return out
}
