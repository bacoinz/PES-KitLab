import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, assetFromFile, rawAssetFromFile, previewAssetFromFile, PRESET_TEAM, USER_TPL_TEAM, stepTime } from '../state'
import type { PanelStyle, TextPlacement, PanelKind, KitDesign, OverlayLayer, Asset, LogoPlacement, LogoTint, Fill, PatternSpec, FabricLayer, FabricZone, Zone, Logos, StitchKind, StitchSpec, TextureSpec } from '../model/design'
import { describeStep } from './history'
import { PANEL_STYLES, SLOT_LABEL, ALL_SLOTS, uid, defaultDesign, contrastOn, slotOrder, solid, fillMain, normalizeGroups, dropLayer, migrateKit, LOGO_SIZES, NUMBER_DEFAULTS, STITCH_KINDS, FABRIC_COLLAR, FABRIC_SLEEVE, COLLAR_FABRIC, CUFF_FABRIC, FABRIC_CUFF, SOCK_LAYER_FABRIC, MAIN_FABRIC, HEM_STITCH, SHORTS_HEM_STITCH, MID_STITCH, STITCH_DEFAULT, mergeLogos, copyNumbers, groupColors, swapGroupColor, resolveGroups, kitAssetIds } from '../model/design'
import { TEMPLATES, applyTemplate, applyTpl } from '../model/templates'
import { PatternGenPanel } from './PatternGenPanel'
import { TORSO_PATTERNS, SLEEVE_PATTERNS, SHORTS_PATTERNS, SOCKS_PATTERNS, TEXTURES, STROKES } from '../compositor/patterns'
import { composeKit, composeLive, composeShine, composeRelief, composeSockCover, onStaleRender, composeLiveShared, COLLAR_DESIGNS, collarParams, collarDefaults, frontThumb, raglanBend } from '../compositor/compose'
import { decorationOverlay, type GlyphAtlas } from '../compositor/decorate'
import { loadAtlases } from '../compositor/atlases'
import { FABRICS, LAYER_FABRICS, EMBROIDERIES, TEXTURE_LOOK } from '../compositor/fabric'
import { palette, loadAsset, rgbaToCanvas, canvasToDataUrl, canvas, ctx2d, imgW, imgH, type Img } from '../compositor/images'
import { partAt, REGIONS, pathOf } from '../compositor/uv'
import { registerFont, findBoxes } from '../compositor/numbers'
import { useFontList, addUserFont } from '../fonts'
import { KitViewer, LIGHT_PRESETS, ENVS, type CamView, type LightPreset, type EnvKind } from '../three/KitViewer'
import { uvWireframe } from '../compositor/uvmesh'
import { kitTemplate } from '../compositor/template'
import { TexView, type Tool2D } from './TexView'
import { Icon, type IconName } from './icons'
import { VectorEditor } from './VectorEditor'
import { DESIGNS, designDef, dp } from '../compositor/designs'
import { Swatch, ColorCtx, type NamedColor } from './ColorPicker'
import { registerHandlers } from './shortcuts'
import { exportKitlab, parseKitlab, type ParsedKitlab } from '../kitlab'
import { KitlabImportModal } from './KitlabImportModal'
import { ContrastPanel } from './ContrastPanel'
import { ReferencePanel } from './ReferencePanel'
import { TextureAnalyzeModal } from './TextureAnalyzeModal'
import { ReferenceWindow } from './ReferenceWindow'
import { useRef2, useReferenceInput } from './reference'
import { nudgeLayer, resizeLayer, rotateLayer, reorderLayer, duplicateLayer } from './layerKeys'
import { layerBox, handleAt, hitLayer, toFrame, dragTo, boxOutline, type Zone2D, type DragStart } from './select2d'
import { Section, Row, ColorInput, Slider, Select, AssetPicker, CropModal, pickColorTarget, TeamColors } from './common'
import { FillRow } from './FillInput'
import { Flyout, PreviewGrid, ThumbButton, CatGrid, type PreviewItem, type CatItem } from './Picker'
import { kitPreview3d, templatePreview, patternPreview, texturePreview, shapePreview, collarPreview, shortsPreview, shirtModelPreview, fabricPreview, numberSetPreview, type PatternPart } from '../previews'
import type { NumberSet } from '@shared/ipc'
import type { PartNumSpec } from '../model/design'

type Tab = 'origin' | 'shirt' | 'shorts' | 'socks' | 'armband' | 'logos' | 'numbers'
const TAB_ICONS: Record<Tab, IconName> = { origin: 'gear', shirt: 'base', shorts: 'shorts', socks: 'sock', armband: 'armband', logos: 'logo', numbers: 'number' }
const TABS: [Tab, string, CamView][] = [['origin', 'Configurações', 'front'], ['shirt', 'Camisola', 'front'], ['shorts', 'Calções', 'shorts'], ['socks', 'Meias', 'socks'], ['armband', 'Braçadeira', 'sleeve'], ['logos', 'Logos', 'front'], ['numbers', 'Números', 'back']]
const TINTS: [LogoTint, string][] = [['original', 'Cores originais'], ['bw', 'Preto e branco (monocromático)'], ['auto', 'Automático (contraste)'], ['mono', 'Uma cor'], ['white', 'Branco'], ['black', 'Preto']]
const CLEAN_AREAS: [string, string][] = [['crest', 'Emblema'], ['brand', 'Marca'], ['sponsor', 'Patrocinador (peito)'], ['back', 'Patrocinador (costas)'], ['sleeves', 'Mangas'], ['shorts', 'Calções'], ['socks', 'Meias']]
const SHAPES: [NonNullable<OverlayLayer['shape']>, string][] = [
  ['band', 'Faixa horizontal'], ['stripeH', 'Risca horizontal'], ['stripeV', 'Risca vertical'], ['panelSides', 'Painéis laterais'],
  ['shoulders', 'Ombros'], ['yoke', 'Peitilho em V'], ['hem', 'Bainha'], ['collarV', 'Decote em V']
]
const STRIPED = ['stripes', 'pinstripes', 'hoops', 'thinHoops', 'halfHoops']
/** Order of the "Adicionar camada" grid (Grupo spans both columns). */
const ADD_ORDER = ['Designs', 'Caneta', 'Padrão', 'Padrão personalizado', 'Imagem/textura', 'Texto', 'Grupo']
/** Categories of the built-in designs in the Designs panel. */
const DESIGN_CAT: Record<string, string> = { vbands: 'Riscas', hbands: 'Faixas & Xadrez', checkers: 'Faixas & Xadrez', zigzag: 'Riscas', waves: 'Riscas', cross: 'Faixas & Xadrez', cross2: 'Faixas & Xadrez', cross2v2: 'Faixas & Xadrez', rect: 'Padrões & Formas', triangle: 'Padrões & Formas', circle: 'Padrões & Formas', shapes: 'Padrões & Formas' }
const SHAPE_CAT: Record<string, string> = { band: 'Faixas & Xadrez', stripeH: 'Faixas & Xadrez', stripeV: 'Faixas & Xadrez', hem: 'Faixas & Xadrez', panelSides: 'Painéis Laterais', shoulders: 'Painéis de Ombro', yoke: 'Gola', collarV: 'Gola' }
/** Order of the Designs panel's categories (the rest after them). */
const CAT_ORDER = ['Riscas', 'Faixas & Xadrez', 'Gradientes', 'Gola', 'Painéis', 'Painéis Laterais', 'Painéis de Ombro', 'Punhos', 'Padrões & Formas']
const catRank = (c: string): number => { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length : i }
/** Folders of the Graphics library (and the built-in groups) merged into the panel's categories. */
function graphicCat(c: string): string {
  const k = c.toLowerCase()
  if (/^(riscas?|listas?|risca única|lista única|chevron|ondas?|zigue)/.test(k)) return 'Riscas'
  if (/^(degrad|gradiente)/.test(k)) return 'Gradientes'
  if (/^(faixas?|xadrez|cruz|quartos|metades)/.test(k)) return 'Faixas & Xadrez'
  if (/^gola/.test(k)) return 'Gola'
  if (/^(padr|formas?)/.test(k)) return 'Padrões & Formas'
  return c
}
const PANEL_LABEL: Record<string, string> = { sides: 'Lateral', shoulders: 'Ombro', cuffs: 'Punho', shortsHem: 'Bainha', shortsSides: 'Faixa lateral', sockFold: 'Dobra', sockTrim: 'Remate', neck: 'Gola' }
/** A fixed row at the bottom of the layer list (base, collar, sleeves…): opens its own settings. */
interface FixedRow { id: string; label: string; icon: IconName; color?: string; setColor?: (c: string) => void; body: JSX.Element; cam?: CamView; movable?: boolean /* can be dragged among the layers, takes a mask */; mask?: string }
const PANELS: [PanelKind, string, 'torso' | 'shorts' | 'socks', number][] = [
  ['cuffs', 'Punhos', 'torso', 40], ['sides', 'Painéis laterais', 'torso', 90], ['shoulders', 'Painéis de ombro', 'torso', 70], ['neck', 'Painel da gola', 'torso', 50],
  ['shortsHem', 'Bainha', 'shorts', 60], ['shortsSides', 'Faixa lateral', 'shorts', 50],
  ['sockFold', 'Dobra', 'socks', 84], ['sockTrim', 'Remate', 'socks', 16]
]
function layerLabel(L: OverlayLayer): string {
  if (L.name) return L.name
  if (L.kind === 'panel') return PANELS.find((p) => p[0] === L.panel)?.[1] ?? 'Painel'
  if (L.kind === 'group') return 'Grupo'
  if (L.kind === 'design') return designDef(L.design).label
  if (L.kind === 'vector') return 'Caneta'
  if (L.kind === 'collar') return 'Gola · ' + (COLLAR_DESIGNS.find((c) => c[0] === L.collarStyle)?.[1] ?? '')
  if (L.kind === 'freeform') return 'Pincel'
  if (L.kind === 'image' && L.fit === 'tile') return 'Padrão personalizado'
  return L.kind === 'pattern' ? `Design: ${(L.part === 'shorts' ? SHORTS_PATTERNS : TORSO_PATTERNS).find((t) => t[0] === L.pattern)?.[1] ?? L.pattern}`
    : L.kind === 'texture' ? TEXTURES.find((t) => t[0] === L.pattern)?.[1] ?? 'Textura'
      : L.kind === 'text' ? `“${L.text}”` : L.kind === 'image' ? (L.fit === 'part' ? 'Imagem (peça inteira)' : L.fit === 'uv' ? 'Textura' : 'Imagem/textura') : SHAPES.find((s) => s[0] === L.shape)?.[1] ?? 'Forma'
}
const BLEND_OPTIONS: [string, string][] = [
  ['source-over', 'Normal'], ['darken', 'Escurecer'], ['multiply', 'Multiplicar'], ['color-burn', 'Queimar cor'],
  ['lighten', 'Aclarar'], ['screen', 'Clarear (ecrã)'], ['color-dodge', 'Subexpor cor'],
  ['overlay', 'Sobrepor'], ['soft-light', 'Luz suave'], ['hard-light', 'Luz forte'],
  ['difference', 'Diferença'], ['exclusion', 'Exclusão'],
  ['hue', 'Matiz'], ['saturation', 'Saturação'], ['color', 'Cor'], ['luminosity', 'Luminosidade']
]
const SHIRT_MODELS: [number, string][] = [[144, 'Normal'], [151, 'Manga semi-longa'], [160, 'Largo'], [176, 'Clássico']]
const COLLAR_STYLES: [NonNullable<KitDesign['collar']>['style'], string][] = [['solid', 'Uma cor'], ['tipped', 'Rebordo'], ['twoTone', 'Duas cores'], ['stripes2', 'Duas riscas'], ['stripes3', 'Três riscas']]
const CUFF_STYLES: [NonNullable<KitDesign['cuffs']>['style'], string][] = [['none', 'Sem punho'], ['solid', 'Punho liso'], ['tipped', 'Rebordo'], ['stripes2', 'Duas riscas'], ['stripes3', 'Três riscas']]
const ZONES: [Zone, string][] = [['front', 'Peito'], ['back', 'Costas'], ['sleeves', 'Mangas']]
const PATTERN_LISTS: Record<PatternPart, [string, string][]> = { torso: TORSO_PATTERNS, sleeves: SLEEVE_PATTERNS, shorts: SHORTS_PATTERNS, socks: SOCKS_PATTERNS }
const RECOLOR_PARTS: Record<string, [string, string][]> = { shirt: [['shirt', 'Camisola'], ['sleeves', 'Mangas'], ['collar', 'Gola']], shorts: [['shorts', 'Calções']], socks: [['socks', 'Meias']] }

type Fly =
  | { kind: 'template' } | { kind: 'pattern'; part: 'sleeves' | 'shorts' | 'socks' } | { kind: 'layerPattern'; layer: string }
  | { kind: 'texture'; layer: string } | { kind: 'shape'; layer: string } | { kind: 'collar' } | { kind: 'shirtModel' } | { kind: 'shortsModel' }
  | { kind: 'fabric'; id: string } | { kind: 'numberSet'; target: 'both' | 'numbers' | 'name' | 'chest' | 'leg' }

function readWidth(): number { try { return Number(localStorage.getItem('kc.sidebar')) || 480 } catch { return 480 } }

function partPalettes(img: Img): Record<string, string[]> {
  const k = (img as ImageBitmap).width / 2048
  const out: Record<string, string[]> = {}
  for (const part of ['shirt', 'sleeves', 'collar', 'shorts', 'socks']) out[part] = palette(img, 5, (x, y) => partAt(x / k, y / k) === part).filter((p) => p.share > 0.03).map((p) => p.color)
  return out
}

const partSpec = (k: KitDesign, part: 'chest' | 'leg'): PartNumSpec => k.numbers[part] ?? { mode: 'same', fill: k.numbers.fill, outline: k.numbers.outline, outlineWidth: k.numbers.outlineWidth, font: k.numbers.font }
const newLogo = (size: number, extra: Partial<LogoPlacement> = {}): LogoPlacement => ({ enabled: true, tint: 'auto', size, dx: 0, dy: 0, ...extra })

/** Layers copied with the right-click menu (kept while the app is open, so they can be pasted into another kit). */
/** Drag type of the layer list (rows, fixed rows, mask handles): other drops are ignored. */
const KC_DRAG = 'application/x-kitlab-layer'
let layerClipboard: { layers: OverlayLayer[]; assets: Record<string, Asset> } | null = null
/** Right-click copy of a logo / sponsor (its image, colours, size and place), also between kits and teams. */
let logoClipboard: { lp: LogoPlacement; asset?: Asset } | null = null

/** Logos tab with each logo's own shininess: the overall value new rows start from (undefined = not in that mode). */
const LogoShineCtx = createContext<{ all: boolean; value: number } | undefined>(undefined)

/**
 * A texture over a layer / logo / cuff: type (list), size, angle and strength. Used for the fabric ("Tecido") of layers,
 * collars and cuffs and for the embroidery ("Bordado") of logos, images and text. `slots` adds "only on these colours".
 */
function TextureRow({ label, list, value, onChange, angle = true, slots, defaults, mix }: {
  label: string; list: [string, string][]; value?: TextureSpec; onChange: (v?: TextureSpec) => void; angle?: boolean; defaults?: Omit<TextureSpec, 'id'>; mix?: boolean
  slots?: { names: string[]; value?: number[]; onChange: (v?: number[]) => void }
}): JSX.Element {
  const look = value ? TEXTURE_LOOK[value.id] : undefined
  // switching it off and on again brings the previous values back
  const last = useRef<TextureSpec | undefined>(undefined)
  if (value) last.current = value
  return (
    <>
      <Row label={label}><Select value={value?.id ?? ''} options={[['', 'Nenhum'], ...list]} onChange={(id) => onChange(id ? { ...defaults, ...last.current, ...value, id } : undefined)} /></Row>
      {value && (
        <div className="subsec">
          <div className="subsec-title">{label} · {list.find((x) => x[0] === value.id)?.[1]}</div>
          <Row label="Escala"><Slider value={value.scale ?? 100} min={20} max={500} onChange={(scale) => onChange({ ...value, scale })} /></Row>
          {angle && <Row label="Ângulo"><Slider value={value.angle ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(a) => onChange({ ...value, angle: a })} /></Row>}
          <Row label="Intensidade"><Slider value={Math.round((value.opacity ?? look?.opacity ?? 0.5) * 100)} min={5} max={100} onChange={(o) => onChange({ ...value, opacity: o / 100 })} /></Row>
          {mix && <Row label="Mistura"><Slider value={value.mix ?? 50} min={0} max={100} onChange={(m) => onChange({ ...value, mix: m })} /></Row>}
          {slots && (
            <Row label="Só nas cores">
              <span className="sw-row">{slots.names.map((nm, i) => {
                const on = !slots.value || slots.value.includes(i)
                return <label key={i} className="check"><input type="checkbox" checked={on} onChange={(e) => {
                  const cur = slots.value ?? slots.names.map((_, j) => j)
                  const next = e.target.checked ? [...cur, i] : cur.filter((j) => j !== i)
                  slots.onChange(next.length === slots.names.length ? undefined : next)
                }} /> {nm}</label>
              })}</span>
            </Row>
          )}
        </div>
      )}
    </>
  )
}

/** A new "Mangas com ombros": the user's preferred starting values. */
const RAGLAN_DEFAULT = { bend: -93, armX: 50, arm: -4, neck: 69, down: 68, neckB: 88, downB: 44 }

/** Embroidery defaults (when a texture is picked). */
const EMB_DEFAULTS = { scale: 70, angle: 45, opacity: 0.49 }

function LogoBlock({ title, lp, assets, onChange, onAsset, folderHint, onRemove, extra }: {
  title: string; lp: LogoPlacement; assets: Record<string, Asset>; onChange: (lp: LogoPlacement) => void; onAsset: (a: Asset) => void; folderHint?: string; onRemove?: () => void; extra?: JSX.Element
}): JSX.Element {
  const a = lp.assetId ? assets[lp.assetId] : undefined
  const ownShine = useContext(LogoShineCtx)
  const [crop, setCrop] = useState(false)
  const [bgCut, setBgCut] = useState(false)
  const [open, setOpen] = useState(false)
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()
  return (
    <div className="lrow-wrap">
      <div className={'lrow' + (open ? ' open' : '') + (lp.enabled && a ? '' : ' hidden')} onClick={() => setOpen(!open)}>
        <button className="lr-eye" title={lp.enabled ? 'Esconder' : 'Mostrar'} onClick={(e) => { stop(e); onChange({ ...lp, enabled: !lp.enabled }) }}><Icon name={lp.enabled ? 'eye' : 'eyeOff'} /></button>
        {a ? <img className="lr-thumb" src={a.dataUrl} alt="" /> : <span className="lr-sw-empty" />}
        <span className="lr-name">{title}{a ? '' : ' — sem logo'}</span>
        <span onClick={stop} className="lr-tools">
          <AssetPicker label={a ? '↻' : '+ Logo'} onPick={(x) => { onAsset(x); onChange({ ...lp, assetId: x.id, enabled: true }) }} folderHint={folderHint} />
          {a && <button className="lr-act show" title="Recortar este logo" onClick={() => setCrop(true)}>✂</button>}
          {a && <button className="lr-act show" title="Remover o fundo: clica na cor a tirar" onClick={() => setBgCut(true)}>🪄</button>}
          {onRemove ? <button className="lr-act show" title="Remover" onClick={onRemove}>✕</button>
            : a && <button className="lr-act show" title="Remover este logo" onClick={() => onChange({ ...lp, assetId: undefined, enabled: false })}>✕</button>}
        </span>
        {crop && a && <CropModal asset={a} onCancel={() => setCrop(false)} onDone={(x) => { setCrop(false); if (x.id !== a.id) { onAsset(x); onChange({ ...lp, assetId: x.id }) } }} />}
        {bgCut && a && <CropModal asset={a} initialMode="bg" onCancel={() => setBgCut(false)} onDone={(x) => { setBgCut(false); if (x.id !== a.id) { onAsset(x); onChange({ ...lp, assetId: x.id }) } }} />}
      </div>
      {open && <div className="lrow-body" onClick={stop}>
      {extra}
      {lp.enabled && a && (
        <>
          <Row label="Cor"><Select value={lp.tint} options={TINTS} onChange={(tint) => onChange({ ...lp, tint })} /></Row>
          {lp.tint === 'mono' && <Row label="Cor do logo"><ColorInput value={lp.color ?? '#ffffff'} onChange={(color) => onChange({ ...lp, color })} /></Row>}
          <Row label="Contorno"><Slider value={lp.outlineWidth ?? 0} min={0} max={30} onChange={(outlineWidth) => onChange({ ...lp, outlineWidth })} /></Row>
          {(lp.outlineWidth ?? 0) > 0 && <Row label="Cor do contorno"><ColorInput value={lp.outlineColor ?? '#ffffff'} onChange={(outlineColor) => onChange({ ...lp, outlineColor })} /></Row>}
          {(lp.outlineWidth ?? 0) > 0 && <Row label="Relevo"><Slider value={lp.outlineRelief ?? 0} min={0} max={100} onChange={(outlineRelief) => onChange({ ...lp, outlineRelief: outlineRelief || undefined })} /></Row>}
          <TextureRow label="Bordado" list={EMBROIDERIES} defaults={EMB_DEFAULTS} value={lp.embroidery} onChange={(embroidery) => onChange({ ...lp, embroidery })} />
          <Row label="Tamanho"><Slider value={lp.size} min={30} max={700} onChange={(size) => onChange({ ...lp, size })} /></Row>
          <Row label="Esquerda / direita"><Slider value={lp.dx} min={-600} max={600} snaps={[0]} onChange={(dx) => onChange({ ...lp, dx })} /></Row>
          <Row label="Baixo / cima"><Slider invert value={lp.dy} min={-600} max={600} snaps={[0]} onChange={(dy) => onChange({ ...lp, dy })} /></Row>
          <Row label="Rotação"><Slider value={lp.rot ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(rot) => onChange({ ...lp, rot: rot || undefined })} /></Row>
          {ownShine && (
            <Row label="Brilho">
              <label className="check" title="Só na pré-visualização 3D"><input type="checkbox" checked={lp.shine !== -1} onChange={(e) => onChange({ ...lp, shine: e.target.checked ? undefined : -1 })} /> {lp.shine === -1 ? 'Desligado' : lp.shine == null ? (ownShine.all ? 'Igual em todos' : 'Brilho geral') : ''}</label>
              {lp.shine !== -1 && <Slider value={lp.shine ?? ownShine.value} min={0} max={100} onChange={(shine) => onChange({ ...lp, shine })} />}
            </Row>
          )}
        </>
      )}
      </div>}
    </div>
  )
}

const TEXT_PLACEMENTS: [string, string][] = [
  ['front', 'Frente'], ['back', 'Costas'], ['frontBack', 'Frente e costas'], ['sleeveL', 'Manga esquerda'], ['sleeveR', 'Manga direita'],
  ['sleeves', 'Ambas as mangas'], ['sleevesMirror', 'Ambas as mangas (espelhadas)'], ['sleevesInv', 'Ambas as mangas (invertidas)'],
  ['sideR', 'Lado direito'], ['sideL', 'Lado esquerdo'], ['sides', 'Lados'], ['sidesMirror', 'Lados (espelhados)'], ['sidesMirrorInv', 'Lados (espelhados invertidos)'],
  ['armband', 'Braçadeira de capitão'], ['backCollar', 'Gola']
]
/** Every font installed on the PC (the list updates by itself when one is installed). */
function FontSelect({ value, onChange }: { value: string; onChange: (f: string) => void }): JSX.Element {
  const fonts = useFontList()
  return <Select value={value} options={(fonts.includes(value) ? fonts : [value, ...fonts]).map((f) => [f, f] as [string, string])} onChange={onChange} />
}
/** Font list with each name written in its own font. */
function FontPicker({ value, onChange }: { value: string; onChange: (f: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const fonts = useFontList()
  const shown = q ? fonts.filter((f) => f.toLowerCase().includes(q.toLowerCase())) : fonts
  return (
    <span className="font-picker">
      <button type="button" className="fp-btn" style={{ fontFamily: `"${value}"` }} onClick={(e) => { e.preventDefault(); setOpen(!open); setQ('') }}><span className="fp-sample">ABC 0123</span> {value} ▾</button>
      {open && (
        <div className="fp-list" onMouseLeave={() => setOpen(false)}>
          <input className="fp-search" autoFocus placeholder={`Pesquisar entre ${fonts.length} fontes…`} value={q} onChange={(e) => setQ(e.target.value)} />
          {shown.map((f) => (
            <button type="button" key={f} className={'fp-item' + (f === value ? ' on' : '')} style={{ fontFamily: `"${f}"` }} onClick={(e) => { e.preventDefault(); onChange(f); setOpen(false) }}>
              <span className="fp-sample">ABCDEF 012345</span><span className="fp-name">{f}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
/**
 * Library pattern → layer asset. Mostly grey images become a mask (dark or opaque drawing = pattern, light or
 * transparent = background) so the pattern takes the layer colour; coloured images are kept as they are.
 */
async function patternMask(a: Asset): Promise<{ asset: Asset; mono: boolean }> {
  const img = await loadAsset(a)
  const w = img.width, h = img.height, c = canvas(w, h), g = ctx2d(c)
  g.drawImage(img as CanvasImageSource, 0, 0)
  const id = g.getImageData(0, 0, w, h), d = id.data
  let sat = 0, opaque = 0, n = 0
  for (let i = 0; i < d.length; i += 16) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); sat += mx ? (mx - mn) / mx : 0; if (d[i + 3] > 240) opaque++; n++ }
  if (sat / n > 0.18) return { asset: a, mono: false }
  const solid = opaque / n > 0.98
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const alpha = solid ? 255 - lum : d[i + 3]
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = alpha
  }
  g.putImageData(id, 0, 0)
  return { asset: { id: uid(), name: a.name + ' (padrão)', dataUrl: await canvasToDataUrl(c) }, mono: true }
}
const FRONT_Y = 1400 // vertical centre of the front frame (offsets are measured from here)
const ROT_SNAPS = [-180, -135, -90, -45, 0, 45, 90, 135, 180]
/** PES-style switch. */
function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }): JSX.Element {
  return <button type="button" className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}><span className="knob" />{label}</button>
}
/** Blend modes grouped like image editors (separators between families). */
function BlendSelect({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const groups: [string, string][][] = [[['source-over', 'Normal']], [['darken', 'Escurecer'], ['multiply', 'Multiplicar'], ['color-burn', 'Queimar cor']],
    [['lighten', 'Aclarar'], ['screen', 'Ecrã'], ['color-dodge', 'Subexpor cor']], [['overlay', 'Sobrepor'], ['soft-light', 'Luz suave'], ['hard-light', 'Luz forte']],
    [['difference', 'Diferença'], ['exclusion', 'Exclusão']], [['hue', 'Matiz'], ['saturation', 'Saturação'], ['color', 'Cor'], ['luminosity', 'Luminosidade']]]
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.map((g, i) => [i > 0 && <option key={'s' + i} disabled>──────────</option>, ...g.map(([v, l]) => <option key={v} value={v}>{l}</option>)])}
    </select>
  )
}
const FABRIC_ZONES: [FabricZone, string][] = [...ZONES, ['shorts', 'Calções'], ['socks', 'Meias']]
/** Colour slots a design layer uses (designs with "Número de cores" use that many). */
function designCols(L: OverlayLayer): number {
  const def = designDef(L.design)
  return def.params.some((x) => x.key === 'n') ? Math.min(def.colors, Math.max(1, Math.round(Number(dp<number>(L, 'n'))))) : def.colors
}
/** "Ombro · Riscas (2 cores)": every panel is labelled the same way. */
function panelLabel(L: OverlayLayer): string {
  const st = PANEL_STYLES.find((x) => x[0] === (L.pstyle ?? 'solid'))?.[1] ?? 'Liso'
  return (PANEL_LABEL[L.panel ?? 'sides'] ?? 'Painel') + ' · ' + st
}
function ZonePicker({ value, onChange }: { value: FabricZone[]; onChange: (z: FabricZone[]) => void }): JSX.Element {
  return (
    <Row label="Onde">
      {FABRIC_ZONES.map(([z, label]) => (
        <label key={z} className="check"><input type="checkbox" checked={value.includes(z)} onChange={(e) => onChange(e.target.checked ? [...value, z] : value.filter((x) => x !== z))} /> {label}</label>
      ))}
    </Row>
  )
}

/** Stitching controls (layers, groups, cuffs). New stitching: topstitch, centred, intensity 32, scale 45. */
function StitchEditor({ value: st, onChange, label = 'Costura', def }: { value: StitchSpec | undefined; onChange: (s: StitchSpec | undefined) => void; label?: string; def?: StitchSpec }): JSX.Element {
  // switching it off and on again brings the previous values back
  const last = useRef<StitchSpec | undefined>(undefined)
  if (st) last.current = st
  const setSt = (patch: Partial<StitchSpec>): void => onChange({ kind: 'dashed', side: 'center', opacity: 0.3, scale: 45, relief: 0, ...def, ...last.current, ...st, ...patch })
  return (
    <>
      <Row label={label}><Select value={st?.kind ?? ''} options={[['', 'Nenhum'], ...STITCH_KINDS]} onChange={(k) => (k ? setSt({ kind: k as StitchKind }) : onChange(undefined))} /></Row>
      {st && (
        <div className="subsec">
          <div className="subsec-title">{label} · {STITCH_KINDS.find((x) => x[0] === st.kind)?.[1]}</div>
          <Row label="Lado"><Select value={st.side} options={[['center', 'Centrado'], ['in', 'Por dentro'], ['out', 'Por fora']]} onChange={(side) => setSt({ side: side as StitchSpec['side'] })} /></Row>
          <Row label="Intensidade"><Slider value={Math.round(st.opacity * 100)} min={0} max={100} onChange={(o) => setSt({ opacity: o / 100 })} /></Row>
          <Row label="Escala"><Slider value={st.scale} min={20} max={300} onChange={(scale) => setSt({ scale })} /></Row>
          <Row label="Linha">
            <Select value={st.color ? 'color' : 'auto'} options={[['auto', 'Relevo (sombra e luz)'], ['color', 'Cor própria']]} onChange={(m) => setSt({ color: m === 'color' ? st.color ?? '#ffffff' : undefined })} />
            {st.color && <ColorInput value={st.color} onChange={(color) => setSt({ color })} />}
          </Row>
          <Row label="Relevo"><Slider value={st.relief ?? 0} min={0} max={100} onChange={(relief) => setSt({ relief: relief || undefined })} /></Row>
        </div>
      )}
    </>
  )
}

/** Shininess of one thing in the 3D preview: off = the fabric's. */
function ShineRow({ value, fallback, onChange, label = 'Brilho' }: { value: number | undefined; fallback: number; onChange: (v: number | undefined) => void; label?: string }): JSX.Element {
  return (
    <Row label={label}>
      <label className="check" title="Só na pré-visualização 3D"><input type="checkbox" checked={value != null} onChange={(e) => onChange(e.target.checked ? fallback : undefined)} /> {value == null ? 'Igual ao tecido da camisola' : ''}</label>
      {value != null && <Slider value={value} min={0} max={100} onChange={onChange} />}
    </Row>
  )
}

export function Editor(): JSX.Element {
  const { project, savedProject, activeSlot, setActiveSlot, updateKit, setProject, undo, redo, past, future, notify, saveProject, discardAll, setView } = useApp()
  const jumpHistory = useApp((s) => s.jumpHistory)
  const [licence, setLicence] = useState<string | null>(null)
  useEffect(() => { setLicence(null); if (project && project.teamId >= 0) window.kc.licenceHint(project.teamId).then(setLicence).catch(() => undefined) }, [project?.teamId])
  const [histOpen, setHistOpen] = useState(false)
  useEffect(() => {
    if (!histOpen) return
    const close = (): void => setHistOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [histOpen])
  // the GPU compositor renders into one shared canvas; `texV` bumps on every new frame
  const [tex, setTex] = useState<HTMLCanvasElement | null>(null)
  const [texV, setTexV] = useState(0)
  const [overlay, setOverlay] = useState<{ key: string; img: OffscreenCanvas } | undefined>(undefined)
  const [atlases, setAtlases] = useState<Record<string, GlyphAtlas | undefined>>({})
  const [showNames, setShowNames] = useState(() => { try { return localStorage.getItem('kc.showNames') !== '0' } catch { return true } })
  const [sampleName, setSampleName] = useState(() => { try { return localStorage.getItem('kc.sampleName') ?? 'JOGADOR' } catch { return 'JOGADOR' } })
  const [sampleNum, setSampleNum] = useState(() => { try { return localStorage.getItem('kc.sampleNum') ?? '10' } catch { return '10' } })
  const [mode, setMode] = useState<'3d' | '2d'>('3d')
  const [cam, setCam] = useState<{ view: CamView; n: number }>({ view: 'front', n: 0 })
  const [spin, setSpin] = useState(false)
  // 3D view settings (kept between sessions)
  const ls = (k: string, d: string): string => { try { return localStorage.getItem(k) ?? d } catch { return d } }
  const [view3d, setView3dState] = useState(() => ({ preset: ls('kc.v3.preset', 'hdri') as LightPreset, env: ls('kc.v3.env', 'room') as EnvKind, bg: ls('kc.v3.bg', ''), hideShorts: ls('kc.v3.hs', '0') === '1', hideSocks: ls('kc.v3.hk', '0') === '1', sockKnit: ls('kc.v3.sk', '1') === '1', sockScale: Number(ls('kc.v3.ss', '100')), sockStrength: Number(ls('kc.v3.sg', '100')), sockMix: Number(ls('kc.v3.sm', '100')) }))
  const setView3d = (patch: Partial<typeof view3d>): void => setView3dState((v) => {
    const n = { ...v, ...patch }
    try { localStorage.setItem('kc.v3.preset', n.preset); localStorage.setItem('kc.v3.env', n.env); localStorage.setItem('kc.v3.bg', n.bg); localStorage.setItem('kc.v3.hs', n.hideShorts ? '1' : '0'); localStorage.setItem('kc.v3.hk', n.hideSocks ? '1' : '0'); localStorage.setItem('kc.v3.sk', n.sockKnit ? '1' : '0'); localStorage.setItem('kc.v3.ss', String(n.sockScale)); localStorage.setItem('kc.v3.sg', String(n.sockStrength)); localStorage.setItem('kc.v3.sm', String(n.sockMix)) } catch { /* ignore */ }
    return n
  })
  const [viewMenu, setViewMenu] = useState(false)
  const [camMenu, setCamMenu] = useState(false)
  const [light, setLight] = useState(() => { try { return Number(localStorage.getItem('kc.light') ?? 40) } catch { return 40 } })
  const shot3d = useRef<(() => Promise<Blob | null>) | null>(null)
  const setShot3d = useCallback((f: () => Promise<Blob | null>) => { shot3d.current = f }, [])
  const [longSleeves, setLongSleeves] = useState(false)
  const [busy, setBusy] = useState(false)
  const [collars, setCollars] = useState<number[]>([])
  const [numberSets, setNumberSets] = useState<NumberSet[]>([])
  const [partPal, setPartPal] = useState<Record<string, string[]>>({})
  const [openLayer, setOpenLayer] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  const [vecEdit, setVecEdit] = useState<string | null>(null) // vector layer open in the editor
  const [texPick, setTexPick] = useState<{ kind: 'patterns' | 'graphics'; part: 'torso' | 'shorts' | 'socks'; category?: string; replace?: string } | null>(null)
  const [allCollars, setAllCollars] = useState(false)
  const [designPick, setDesignPick] = useState<string | null>(null) // design layer whose design is being chosen
  // right-click menu of the layer list (copy / paste layers, also from one kit to another)
  const [userTpl, setUserTpl] = useState<{ id: string; name: string; date: string; kit: KitDesign; assets: Record<string, Asset> }[] | null>(null) // open = side panel shown
  const [tplImgs, setTplImgs] = useState<{ path: string; name: string; category: string }[]>([])
  const loadUserTpls = (): void => {
    window.kc.listTemplateImages().then(setTplImgs).catch(() => setTplImgs([]))
    window.kc.listUserTemplates().then((l) => setUserTpl(l.map((j) => { try { return JSON.parse(j) } catch { return null } }).filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date))))).catch(() => setUserTpl([])) }
  const [ctx, setCtx] = useState<{ x: number; y: number; layer?: string; part: 'torso' | 'shorts' | 'socks' } | null>(null)
  const [copyColors, setCopyColors] = useState(false)
  const [logoCtx, setLogoCtx] = useState<{ x: number; y: number; lp: LogoPlacement; set: (n: LogoPlacement) => void; key?: 'sponsors' | 'backSponsors' | 'sleeveBadges' | 'shortsSponsors' | 'socksSponsors'; i?: number } | null>(null)
  useEffect(() => {
    if (!logoCtx) return
    const close = (): void => setLogoCtx(null)
    window.addEventListener('pointerdown', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close) }
  }, [logoCtx])
  useEffect(() => {
    if (!ctx) return
    const close = (): void => setCtx(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close) }
  }, [ctx])
  type TexItem = { path: string; name: string; category: string }
  const [texLib, setTexLib] = useState<{ root: string; items: TexItem[]; categories: string[] }>({ root: '', items: [], categories: [] })
  useEffect(() => {
    if (!texPick) return
    const load = (): void => { window.kc.listTextures(texPick.kind).then(setTexLib).catch(() => undefined) }
    load()
    window.addEventListener('kc:library', load)
    return () => window.removeEventListener('kc:library', load)
  }, [texPick?.kind]) // eslint-disable-line react-hooks/exhaustive-deps
  // free drawing: the stroke being drawn (committed as one undo step on release)
  const [brushErase, setBrushErase] = useState(false)
  const strokeRef = useRef<{ id: string; pts: number[]; w: number; color: string } | null>(null)
  const [, setStrokeTick] = useState(0)
  const [fly, setFly] = useState<Fly | null>(null)
  // only one side panel at a time
  useEffect(() => { if (fly) { setTexPick(null); setDesignPick(null) } }, [fly])
  useEffect(() => { if (texPick) { setFly(null); setDesignPick(null) } }, [texPick])
  useEffect(() => { if (designPick) { setFly(null); setTexPick(null) } }, [designPick])
  const [tab, setTab] = useState<Tab>('shirt')
  const [kitlabFile, setKitlabFile] = useState<ParsedKitlab | null>(null)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const refImg = useRef2((r) => r.img), refOv = useRef2((r) => r.overlay)
  const reference = useMemo(() => (refImg ? { img: refImg, o: refOv } : null), [refImg, refOv])
  useReferenceInput(useCallback((m: string) => useApp.getState().notify('err', m), []))
  const [width, setWidth] = useState(readWidth)
  useEffect(() => { document.documentElement.style.setProperty('--sidebar-w', width + 'px') }, [width])
  const [tucked, setTucked] = useState(() => { try { return localStorage.getItem('kc.tucked') === '1' } catch { return false } })
  const teams = useApp((st) => st.teams)
  const settings = useApp((st) => st.settings)
  const [texBg, setTexBg] = useState(() => { try { return localStorage.getItem('kc.texBg') ?? '#1b1e25' } catch { return '#1b1e25' } })
  const [showTexBg, setShowTexBg] = useState(() => { try { return localStorage.getItem('kc.showTexBg') !== '0' } catch { return true } })
  // fabric textures in the preview (the 3D uses the same texture; export always has them)
  const [showFabric, setShowFabric] = useState(() => { try { return localStorage.getItem('kc.showFabric') !== '0' } catch { return true } })
  const [showStitch, setShowStitch] = useState(() => { try { return localStorage.getItem('kc.showStitch') !== '0' } catch { return true } })
  const canvas2d = useRef<HTMLCanvasElement>(null)
  const kit = project?.kits.find((k) => k.slot === activeSlot) ?? project?.kits[0]
  const assets = useMemo(() => project?.assets ?? {}, [project?.assets])
  const go = useCallback((view: CamView, force = false) => setCam((c) => (c.view === view && !force ? c : { view, n: c.n + 1 })), [])
  const at = (view: CamView) => (e: React.PointerEvent): void => { e.stopPropagation(); go(view) }

  useEffect(() => {
    window.kc.listCollars().then(setCollars).catch(() => setCollars([]))
    window.kc.listNumberSets().then(setNumberSets).catch(() => setNumberSets([]))
  }, [])

  // GPU render, at most once per animation frame (cached masks make colour/position edits a few ms)
  const renderSeq = useRef(0)
  const sharedTexRef = useRef<WebGLTexture | null>(null)
  // stitching kept while a slider moved: draw again once it stops
  const [staleTick, setStaleTick] = useState(0)
  useEffect(() => { onStaleRender(() => setStaleTick((v) => v + 1)); return () => onStaleRender(null) }, [])
  const live = mode === '3d' && showNames ? overlay : undefined
  useEffect(() => {
    if (!kit || !project) return
    const seq = ++renderSeq.current
    const raf = requestAnimationFrame(() => {
      const o = { overlay: live, skipFabric: !showFabric, skipStitch: !showStitch }
      // 3D: drawn straight into the 3D view's WebGL context (no copy of the texture); 2D: the compositor's own canvas
      const draw = mode === '3d'
        ? composeLiveShared(kit, project.assets, o).then(async (t) => { if (t) { sharedTexRef.current = t; return null } return composeLive(kit, project.assets, o) })
        : composeLive(kit, project.assets, o)
      draw
        .then((c) => { if (seq === renderSeq.current) { if (c) setTex(c); setTexV((v) => v + 1) } })
        .catch((e) => notify('err', 'Erro a desenhar: ' + e))
    })
    return () => cancelAnimationFrame(raf)
  }, [kit, project, notify, live, showFabric, showStitch, staleTick, mode])

  const numKey = kit ? JSON.stringify([project?.teamId, kit.slot, kit.numbers]) : ''
  useEffect(() => {
    if (!kit || !project) return
    let alive = true
    // wait until a slider / colour drag settles: building the atlases is the slow part of the number preview
    const t = setTimeout(() => { loadAtlases(project.teamId, kit.slot, kit.numbers, project.assets).then((a) => { if (alive) setAtlases(a) }).catch(() => setAtlases({})) }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [numKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // preview name / numbers: a transparent overlay, rebuilt only when they change
  const ovSeq = useRef(0)
  useEffect(() => {
    try { localStorage.setItem('kc.showNames', showNames ? '1' : '0'); localStorage.setItem('kc.sampleName', sampleName); localStorage.setItem('kc.sampleNum', sampleNum) } catch { /* ignore */ }
    if (!showNames || !kit) { setOverlay(undefined); return }
    setOverlay({ key: 'deco:' + ++ovSeq.current, img: decorationOverlay({ back: atlases.back, leg: atlases.leg, name: atlases.name, config: kit.config, playerName: sampleName, number: sampleNum, nameBelow: kit.numbers.nameBelow }) })
  }, [atlases, showNames, sampleName, sampleNum, kit?.config, kit?.numbers.nameBelow]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem('kc.texBg', texBg); localStorage.setItem('kc.showTexBg', showTexBg ? '1' : '0') } catch { /* ignore */ }
  }, [texBg, showTexBg])

  // keyboard shortcuts of the editor (catalogue in ui/shortcuts.ts); the handlers are filled in on every render, below
  const kbd = useRef<Record<string, () => boolean | void>>({})
  useEffect(() => registerHandlers((id) => (id === 'view.toggle' ? () => setMode((m) => (m === '3d' ? '2d' : '3d')) : kbd.current[id])), [])
  const [tool, setTool] = useState<Tool2D>('hand')
  // 2D select / transform tool
  const [sel, setSel] = useState<{ id: string; z: Zone2D } | null>(null)
  const dragRef = useRef<{ d: DragStart; recorded: boolean } | null>(null)
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({})
  useEffect(() => {
    for (const L of kit?.layers ?? []) {
      const a = L.assetId && project?.assets[L.assetId]
      if (L.kind !== 'image' || !a || dims[a.id]) continue
      loadAsset(a).then((b) => setDims((d) => ({ ...d, [a.id]: { w: b.width, h: b.height } }))).catch(() => undefined)
    }
  }, [kit?.layers, project?.assets]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const [nsQ, setNsQ] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [favs, setFavs] = useState<string[]>([])
  useEffect(() => { window.kc.getSettings().then((s) => setFavs(((s as unknown as { favNumberSets?: string[] }).favNumberSets) ?? [])).catch(() => undefined) }, [])
  const toggleFav = (id: string): void => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]
    setFavs(next)
    window.kc.saveSettings({ favNumberSets: next } as never).catch(() => undefined)
  }
  const onPickColor = useCallback((hex: string) => {
    navigator.clipboard?.writeText(hex).catch(() => undefined)
    notify('ok', pickColorTarget(hex) ? `Cor ${hex} aplicada ao último campo de cor` : `Cor ${hex} copiada — clica num campo de cor para a usar`)
  }, [notify])
  // every colour already used by the team's kits, offered as swatches by all colour fields
  const teamColors = useMemo(() => {
    const set = new Set<string>()
    const walk = (v: unknown): void => {
      if (typeof v === 'string') { if (/^#[0-9a-f]{6}$/i.test(v)) set.add(v.toLowerCase()) }
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'dataUrl') walk(x)
    }
    for (const k of project?.kits ?? []) walk([k.colors, k.fills, k.collar, k.cuffs, k.layers, k.armband, k.numbers])
    return [...set].slice(0, 40)
  }, [project?.kits])

  // shininess map for the 3D preview (only when some layer has its own shininess; refreshed once edits settle)
  const [shineMap, setShineMap] = useState<{ width: number; height: number; data: Uint8Array } | null>(null)
  useEffect(() => {
    if (!kit || !project || mode !== '3d') return
    let alive = true
    const t = setTimeout(() => {
      // the preview name / numbers, one image per part, when they have their own shininess
      const decos = kit.numberShine && showNames ? (['back', 'name', 'chest', 'leg'] as const).map((part) => ({ part, key: part + JSON.stringify([kit.config, sampleName, sampleNum, kit.numbers.nameBelow, Object.keys(atlases)]), img: decorationOverlay({ back: atlases.back, leg: atlases.leg, name: atlases.name, config: kit.config, playerName: sampleName, number: sampleNum, nameBelow: kit.numbers.nameBelow, only: part }) })) : []
      composeShine(kit, project.assets, 512, decos).then((m) => { if (alive) setShineMap(m) }).catch(() => undefined)
    }, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [kit, project, mode, atlases, showNames, sampleName, sampleNum]) // eslint-disable-line react-hooks/exhaustive-deps

  // relief (seams / outlines that stand out) for the 3D preview; null when nothing has relief
  const [reliefMap, setReliefMap] = useState<OffscreenCanvas | null>(null)
  useEffect(() => {
    if (!kit || !project || mode !== '3d') return
    let alive = true
    const t = setTimeout(() => { (showStitch ? composeRelief(kit, project.assets) : Promise.resolve(null)).then((m) => { if (alive) setReliefMap(m) }).catch(() => undefined) }, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [kit, project, mode, showStitch])

  // what the sock layers cover: the sock relief in 3D belongs to the sock base only
  const [sockCover, setSockCover] = useState<OffscreenCanvas | null>(null)
  useEffect(() => {
    if (!kit || !project || mode !== '3d' || !kit.socksFabric) { setSockCover(null); return }
    let alive = true
    const t = setTimeout(() => { composeSockCover(kit, project.assets).then((m) => { if (alive) setSockCover(m) }).catch(() => undefined) }, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [kit, project, mode])

  // small copy for the collar / shorts picker previews (refreshed once edits settle)
  const [smallTex, setSmallTex] = useState<OffscreenCanvas | null>(null)
  useEffect(() => {
    if (!kit || !project) return
    let alive = true
    // drawn on its own (the 3D view's texture is not a canvas)
    const t = setTimeout(() => { composeKit(kit, project.assets, { size: 512 }).then((c) => { if (alive) setSmallTex(c) }).catch(() => undefined) }, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [kit, project])

  // UV islands of the models the 3D view uses: the 2D view paints the background everywhere else
  // the kit template (KIT Template.png): its parts are where the texture is used; the same for every kit
  const [islands, setIslands] = useState<OffscreenCanvas | null>(null)
  const [tplOutline, setTplOutline] = useState<OffscreenCanvas | null>(null)
  const [showOutline] = useState(() => { try { return localStorage.getItem('kc.tplOutline') === '1' } catch { return false } })
  // the 3D model's mesh (UV wireframe) over the texture
  const [showMesh, setShowMesh] = useState(() => { try { return localStorage.getItem('kc.mesh3d') === '1' } catch { return false } })
  const [meshImg, setMeshImg] = useState<OffscreenCanvas | null>(null)
  const collarId = Number(kit?.config.Collar ?? 66), shortsId = Number(kit?.config.ShortsModel ?? 1)
  useEffect(() => { if (showMesh) uvWireframe(collarId, shortsId).then(setMeshImg).catch(() => setMeshImg(null)) }, [showMesh, collarId, shortsId])
  useEffect(() => { kitTemplate().then((t) => { setIslands(t?.mask ?? null); setTplOutline(t?.outline ?? null) }) }, [])

  const baseId = kit?.base.kind === 'image' ? kit.base.imageAssetId : undefined
  useEffect(() => {
    setPartPal({})
    if (!baseId || !project?.assets[baseId]) return
    loadAsset(project.assets[baseId]).then((b) => setPartPal(partPalettes(b)))
  }, [baseId, project?.assets])

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = width
    let last = w0
    const move = (ev: MouseEvent): void => { last = Math.max(360, Math.min(900, w0 + ev.clientX - x0)); setWidth(last) }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      try { localStorage.setItem('kc.sidebar', String(last)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [width])

  if (!project || !kit) return <div className="pad">Nenhum projeto aberto.</div>

  const up = (fn: (k: KitDesign) => KitDesign): void => updateKit(kit.slot, fn)
  const addAsset = (a: Asset): void => setProject((p) => ({ ...p, assets: { ...p.assets, [a.id]: a } }), false)
  const setLayer = (id: string, fn: (l: OverlayLayer) => OverlayLayer): void => up((k) => ({ ...k, layers: k.layers.map((x) => (x.id === id ? fn(x) : x)) }))
  {
    // the layer the keys act on: the one selected on the 2D view, else the open one in the list
    const cur = (sel?.id ?? openLayer) ? kit.layers.find((l) => l.id === (sel?.id ?? openLayer)) : undefined
    const onLayer = (fn: (L: OverlayLayer) => boolean | void, edits = true) => (): boolean | void => { if (!cur || (edits && cur.locked)) return false; return fn(cur) }
    const nudge = (dx: number, dy: number) => onLayer((L) => { const p = nudgeLayer(L, dx, dy, (id) => dims[id]); if (!p) return false; setLayer(L.id, (x) => ({ ...x, ...p })) })
    const goTab = (i: number): void => { const [t, , view] = TABS[(i + TABS.length) % TABS.length]; setTab(t); go(view); setFly(null) }
    const tabAt = TABS.findIndex(([t]) => t === tab)
    const k: Record<string, () => boolean | void> = {
      'ref.toggle': () => { const r = useRef2.getState(); if (!r.url) return false; r.setWin({ open: !r.win.open, min: false }) },
      'tab.prev': () => goTab(tabAt - 1),
      'tab.next': () => goTab(tabAt + 1),
      'layer.left': nudge(-1, 0), 'layer.right': nudge(1, 0), 'layer.up': nudge(0, -1), 'layer.down': nudge(0, 1),
      'layer.left10': nudge(-10, 0), 'layer.right10': nudge(10, 0), 'layer.up10': nudge(0, -10), 'layer.down10': nudge(0, 10),
      'layer.forward': onLayer((L) => { const r = reorderLayer(kit.layers, L.id, 1); if (!r) return false; up((x) => ({ ...x, layers: r })) }),
      'layer.backward': onLayer((L) => { const r = reorderLayer(kit.layers, L.id, -1); if (!r) return false; up((x) => ({ ...x, layers: r })) }),
      'layer.delete': onLayer((L) => {
        if (L.kind === 'group' && kit.layers.some((x) => x.group === L.id) && !confirm('Apagar o grupo e todas as camadas dele? (Para manter as camadas usa "Desagrupar".)')) return
        up((x) => ({ ...x, layers: x.layers.filter((y) => y.id !== L.id && y.group !== L.id) }))
        setSel(null); setOpenLayer(null)
      }),
      'layer.duplicate': onLayer((L) => { up((x) => ({ ...x, layers: duplicateLayer(x.layers, L) })) }, false),
      'layer.hide': onLayer((L) => { setLayer(L.id, (x) => ({ ...x, visible: !x.visible })) }, false),
      'layer.lock': onLayer((L) => { setLayer(L.id, (x) => ({ ...x, locked: !x.locked || undefined })) }, false),
      'layer.bigger': onLayer((L) => { setLayer(L.id, (x) => ({ ...x, ...resizeLayer(x, true) })) }),
      'layer.smaller': onLayer((L) => { setLayer(L.id, (x) => ({ ...x, ...resizeLayer(x, false) })) }),
      'layer.rotate': onLayer((L) => { setLayer(L.id, (x) => ({ ...x, ...rotateLayer(x) })) })
    }
    TABS.forEach((_, i) => { k['tab.' + (i + 1)] = () => goTab(i) })
    kbd.current = k
  }
  const setLogos = (fn: (l: Logos) => Logos): void => up((k) => ({ ...k, logos: fn(k.logos) }))
  const setCfg = (key: string, v: number | string): void => up((k) => ({ ...k, config: { ...k.config, [key]: v } }))
  const cfg = (key: string, d: number): number => { const v = Number(kit.config[key]); return kit.config[key] !== undefined && Number.isFinite(v) ? v : d }
  const F = kit.fills ?? {}
  const setFill = (part: 'shirt' | 'sleeves' | 'shorts' | 'socks', f: Fill): void => up((k) => ({ ...k, fills: { ...k.fills, [part]: f }, colors: { ...k.colors, [part]: fillMain(f, k.colors[part]) } }))
  /** Swap one colour for another everywhere in this kit (layers, fills, collar, cuffs, armband, numbers…). */
  const swapColor = (from: string, to: string): void => {
    const f = from.toLowerCase()
    const swap = (v: unknown): unknown => typeof v === 'string' ? (v.toLowerCase() === f ? to : v)
      : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'dataUrl' || k === 'config' ? x : swap(x)])) : v
    up((k) => swap(k) as KitDesign)
  }
  /** Every colour this kit uses, most used first. */
  const kitPalette = (() => {
    const n = new Map<string, number>()
    const walk = (v: unknown, key = ''): void => {
      if (typeof v === 'string') { if (/^#[0-9a-f]{6}$/i.test(v)) n.set(v.toLowerCase(), (n.get(v.toLowerCase()) ?? 0) + 1) }
      else if (Array.isArray(v)) v.forEach((x) => walk(x))
      else if (v && typeof v === 'object' && key !== 'config') for (const [k, x] of Object.entries(v)) if (k !== 'dataUrl') walk(x, k)
    }
    const visible = (l: OverlayLayer): boolean => l.visible && (!l.group || kit.layers.find((g) => g.id === l.group)?.visible !== false)
    walk([kit.colors.shirt, kit.colors.sleeves, kit.colors.shorts, kit.colors.socks, kit.fills, kit.base.kind === 'template' ? [kit.collar, kit.cuffs?.style !== 'none' ? kit.cuffs : null] : null,
      [kit.sleevePattern, kit.shortsPattern, kit.socksPattern].filter((p) => p.id !== 'none'), kit.layers.filter((l) => l.kind !== 'group' && visible(l))])
    return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  })()
  const dirty = project !== savedProject
  const collarKey = JSON.stringify([kit.collar, kit.colors.shirt, F.shirt, kit.base.imageAssetId, kit.base.recolor, kit.layers.length])
  const shortsKey = JSON.stringify([F.shorts, kit.colors.shorts, kit.shortsPattern, kit.base.imageAssetId, kit.base.recolor])

  const presetMode = project.teamId === PRESET_TEAM
  const tplMode = project.teamId === USER_TPL_TEAM
  const doSave = async (): Promise<void> => {
    setBusy(true)
    if (tplMode) {
      try { await useApp.getState().saveUserTemplate(); notify('ok', 'Template guardado') } catch (e) { notify('err', String((e as Error).message ?? e)) } finally { setBusy(false) }
      return
    }
    if (presetMode) {
      // sandbox for the "new kit" templates: every kit here becomes the template of its type
      try { await useApp.getState().savePresets(); notify('ok', 'Guardado: ' + project.kits.map((k) => SLOT_LABEL[k.slot] ?? k.slot).join(', ') + ' — usados nos kits novos') }
      catch (e) { notify('err', String((e as Error).message ?? e)) }
      finally { setBusy(false) }
      return
    }
    try { await saveProject(); notify('ok', 'Alterações guardadas. Exporta para o jogo no ecrã Equipas.') }
    catch (e) { notify('err', String((e as Error).message ?? e)) }
    finally { setBusy(false) }
  }
  const addSlot = (slot: string): void => {
    const src = project.kits.find((k) => k.slot === (slot.startsWith('g') ? 'g1' : 'p1')) ?? kit
    const d = { ...JSON.parse(JSON.stringify(src)), slot } as KitDesign
    setProject((p) => ({ ...p, kits: [...p.kits, d].sort((a, b) => slotOrder(a.slot, b.slot)) }))
    setActiveSlot(slot)
  }
  const copyFrom = (slot: string, invert: boolean): void => {
    const src = project.kits.find((k) => k.slot === slot)
    if (!src) return
    up((k) => {
      const d = JSON.parse(JSON.stringify(src)) as KitDesign
      d.slot = k.slot
      if (invert) {
        const c = d.colors
        d.colors = { ...c, shirt: c.shirt2, shirt2: c.shirt, sleeves: c.sleeves === c.shirt ? c.shirt2 : c.shirt, cuffs: c.shirt, collar: c.shirt, shorts: c.shorts2, shorts2: c.shorts, socks: c.socks2, socks2: c.socks }
        d.fills = {}
        for (const l of d.layers) if (l.color === c.shirt2) { l.color = c.shirt; l.fill = undefined }
        d.numbers = { ...d.numbers, fill: contrastOn(d.colors.shirt) }
      }
      return d
    })
  }
  const importAtlas = async (part: 'backAsset' | 'legAsset' | 'nameAsset'): Promise<void> => {
    const f = await window.kc.pickFiles([{ name: 'Texturas', extensions: ['ftex', 'dds', 'png'] }])
    if (!f[0]) return
    const img = await window.kc.decodeImageFile(f[0])
    if (!img) return notify('err', 'Não consegui ler o ficheiro')
    const a: Asset = { id: uid(), name: f[0].split(/[\\/]/).pop()!, dataUrl: await canvasToDataUrl(rgbaToCanvas(img)) }
    addAsset(a)
    up((k) => ({ ...k, numbers: { ...k.numbers, mode: 'file', [part]: a.id } }))
  }
  /** Number/name textures from the kit-server sets or from any team in the game. */
  const readSet = async (id: string, part: 'back' | 'leg' | 'name'): Promise<Asset | null> => {
    let img = null
    if (id.startsWith('team:')) img = await window.kc.readKitTexture(Number(id.slice(5)), 'p1', part, 0).catch(() => null)
    else { const s = numberSets.find((x) => x.id === id); const path = s?.[part]; if (path) img = await window.kc.decodeImageFile(path) }
    if (!img) return null
    const a: Asset = { id: uid(), name: `${id} ${part}`, dataUrl: await canvasToDataUrl(rgbaToCanvas(img)) }
    addAsset(a)
    return a
  }
  const useNumberSet = async (id: string, target: 'both' | 'numbers' | 'name' | 'chest' | 'leg'): Promise<void> => {
    if (target === 'chest' || target === 'leg') {
      const a = await readSet(id, target === 'leg' ? 'leg' : 'back') ?? await readSet(id, 'back')
      if (!a) return notify('err', 'Essa equipa não tem números')
      up((k) => ({ ...k, numbers: { ...k.numbers, [target]: { ...partSpec(k, target), mode: 'file', asset: a.id } } }))
      return
    }
    const ids: Partial<Record<'backAsset' | 'legAsset' | 'nameAsset', string>> = {}
    if (target !== 'name') { const b = await readSet(id, 'back'); if (b) ids.backAsset = b.id; const l = await readSet(id, 'leg'); if (l) ids.legAsset = l.id }
    if (target !== 'numbers') { const n = await readSet(id, 'name'); if (n) ids.nameAsset = n.id }
    if (!Object.keys(ids).length) return notify('err', 'Essa equipa não tem esses ficheiros')
    up((k) => ({ ...k, numbers: { ...k.numbers, mode: 'file', ...ids } }))
  }

  const recolorRows = (group: string): JSX.Element | null => {
    if (kit.base.kind !== 'image') return null
    return (
      <>
        <div className="muted small">Cores detetadas no kit importado — muda a cor e o sombreado/tecido mantém-se.</div>
        {RECOLOR_PARTS[group].map(([part, label]) => (
          <div key={part} className="recolor-part">
            <div className="sub-title">{label}</div>
            {(partPal[part] ?? []).map((from, i) => {
              const m = kit.base.recolor?.find((r) => r.from === from && r.part === part)
              return (
                <Row key={from} label="">
                  <span className="swatch big" style={{ background: from }} /> →
                  <ColorInput value={m?.to ?? from} onChange={(to) => up((k) => ({
                    ...k,
                    colors: i === 0 ? { ...k.colors, [part]: to } : k.colors,
                    base: { ...k.base, recolor: [...(k.base.recolor ?? []).filter((r) => !(r.from === from && r.part === part)), ...(to === from ? [] : [{ from, to, part }])] }
                  }))} />
                  {m && <button className="btn tiny ghost" title="Repor" onClick={() => up((k) => ({ ...k, base: { ...k.base, recolor: (k.base.recolor ?? []).filter((r) => !(r.from === from && r.part === part)) } }))}>↺</button>}
                </Row>
              )
            })}
            {!partPal[part]?.length && <span className="muted small">a analisar…</span>}
          </div>
        ))}
      </>
    )
  }

  const layerEditor = (L: OverlayLayer, part: 'torso' | 'shorts' | 'socks'): JSX.Element => {
    const ch = (patch: Partial<OverlayLayer>): void => setLayer(L.id, (x) => ({ ...x, ...patch }))
    const free = L.kind === 'text' || L.kind === 'image'
    // back to the defaults: everything about placement and look, keeping what the layer is (design, colours, zones…)
    const resetLayer = (): void => ch({
      zoom: undefined, sx: undefined, sy: undefined, rotation: 0, dx: 0, dy: 0, flipX: undefined, mirrorCenter: undefined, mirrorBack: undefined,
      warp: undefined, blur: undefined, opacity: 1, blend: undefined, shine: undefined, stitch: undefined, shortOnly: undefined,
      ...(L.kind === 'text' ? { x: 1024, y: 1350 } : L.kind === 'image' && L.fit !== 'part' && L.fit !== 'tile' ? { x: 1024, y: 1300 } : {}),
      ...(L.kind === 'design' ? { p: {} } : {})
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const randomize = (): void => {
      const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
      const c = kit.colors
      const color = pick([c.shirt2, c.shirt3, c.collar, c.cuffs, '#ffffff', '#111111'].filter((x) => x && x !== c.shirt))
      const patch: Partial<OverlayLayer> = { color, fill: undefined, rotation: pick([0, 0, 0, 15, -15, 45, -45, 90]) }
      if (L.kind === 'pattern') Object.assign(patch, { pattern: pick(TORSO_PATTERNS.filter((t) => t[0] !== 'none'))[0], count: 1 + Math.floor(Math.random() * 8), width: 15 + Math.floor(Math.random() * 60), stripeW: undefined })
      if (L.kind === 'texture') Object.assign(patch, { pattern: pick(TEXTURES)[0], scale: 40 + Math.floor(Math.random() * 160) })
      if (L.kind === 'design') {
        const d = pick(DESIGNS)
        const pal = [c.shirt2, c.shirt3, c.collar, '#ffffff', '#111111'].filter((x) => x && x !== c.shirt)
        Object.assign(patch, { design: d.id, p: {}, colors: Array.from({ length: Math.max(1, d.colors) }, () => pick(pal)), stops: d.stops ? [{ c: pick(pal), at: 0 }, { c: c.shirt, at: 100 }] : L.stops })
      }
      ch(patch)
    }
    const sameList = (x: OverlayLayer): boolean => x.part === L.part || (part === 'torso' && ['torso', 'shirt', 'sleeves'].includes(x.part))
    const shineRow = (
      <Row label="Brilho próprio">
        <label className="check" title="Só na pré-visualização 3D: o jogo usa o seu próprio material"><input type="checkbox" checked={L.shine != null} onChange={(e) => ch({ shine: e.target.checked ? 70 : undefined })} /> {L.shine == null ? 'Igual ao tecido da camisola' : ''}</label>
        {L.shine != null && <Slider value={L.shine} min={0} max={100} onChange={(shine) => ch({ shine })} />}
      </Row>
    )
    // stitching along the edge of the layer's shape (or of everything a group draws)
    const stitchRow = <StitchEditor value={L.stitch} onChange={(stitch) => ch({ stitch })} />
    // fabric ("Tecido") over the layer; collars choose which of their colours get it; images / text also get embroidery
    const fabricRow = (
      <TextureRow label="Tecido" list={LAYER_FABRICS} value={L.fabric} onChange={(fabric) => ch({ fabric })} defaults={L.kind === 'collar' ? FABRIC_COLLAR : (L.zones ?? []).length === 1 && L.zones![0] === 'sleeves' ? FABRIC_SLEEVE : undefined}
        slots={L.kind === 'collar' ? { names: ['Cor 1', 'Cor 2', 'Cor 3'].slice(0, (COLLAR_DESIGNS.find((x) => x[0] === L.collarStyle) ?? COLLAR_DESIGNS[0])[2]), value: L.fabricSlots, onChange: (fabricSlots) => ch({ fabricSlots }) } : undefined} />
    )
    const embroRow = L.kind === 'image' || L.kind === 'text' ? <TextureRow label="Bordado" list={EMBROIDERIES} defaults={EMB_DEFAULTS} value={L.embroidery} onChange={(embroidery) => ch({ embroidery })} /> : null
    // designs (base designs, shapes, panels, graphics): one card, 3D preview of this layer, opens the Designs panel to swap it
    const designCard = (label: string): JSX.Element => (
      <ThumbButton label={label} onClick={() => setTexPick({ kind: 'graphics', part, replace: L.id })}
        load={() => pv3({ ...L, id: 'pv', visible: true, opacity: 1, group: undefined, maskLayer: undefined, stitch: undefined }, part, 'card:' + JSON.stringify(L))} deps={[JSON.stringify(L), kit.colors.shirt, kit.config.Collar]} />
    )
    const groupRow = L.kind === 'group' ? null : (
      <Row label="Grupo"><Select value={L.group ?? ''} options={[['', 'Nenhum'], ...kit.layers.filter((g) => g.kind === 'group' && sameList(g)).map((g) => [g.id, layerLabel(g)] as [string, string])]}
        onChange={(g) => up((k) => ({ ...k, layers: normalizeGroups(k.layers.map((x) => (x.id === L.id ? { ...x, group: g || undefined } : x))) }))} /></Row>
    )
    if (L.kind === 'group') {
      const members = kit.layers.filter((x) => x.group === L.id)
      const gcols = groupColors(kit.layers, L.id)
      const offMaxG = members.some((m) => (m.zones ?? []).includes('sleeves')) ? 2000 : 500
      return (
        <div className="layer-body pm">
          <Row label="Nome"><input value={L.name ?? ''} placeholder="Grupo" onChange={(e) => ch({ name: e.target.value || undefined })} /></Row>
          <div className="muted small">{members.length ? `${members.length} camada(s). Para pôr outra camada no grupo, arrasta-a para o grupo ou abre-a e escolhe o grupo.` : 'Grupo vazio: arrasta camadas para cima do grupo.'}</div>
          <div className="pm-sep" />
          {gcols.length > 0 && (
            <Row label="Cores do grupo">
              <span className="sw-row">{gcols.map((c) => <Swatch key={c} value={c} title={'Trocar ' + c + ' em todas as camadas do grupo'} onChange={(v) => up((k) => ({ ...k, layers: swapGroupColor(k.layers, L.id, c, v) }))} />)}</span>
            </Row>
          )}
          <div className="pm-sep" />
          <Row label="Deslocamento (x)"><Slider value={L.dx ?? 0} min={-offMaxG} max={offMaxG} snaps={[0]} onChange={(dx) => ch({ dx: dx || undefined })} /></Row>
          <Row label="Deslocamento (y)"><Slider value={-(L.dy ?? 0)} min={-offMaxG} max={offMaxG} snaps={[0]} onChange={(y) => ch({ dy: -y || undefined })} /></Row>
          <Row label="Tamanho"><Slider value={L.zoom ?? 100} min={10} max={800} onChange={(zoom) => ch({ zoom: zoom === 100 ? undefined : zoom })} /></Row>
          <Row label="Rotação"><Slider value={L.rotation ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(rotation) => ch({ rotation: rotation || undefined })} /></Row>
          <div className="muted small">Aplicados por cima dos valores de cada camada (os painéis e as golas seguem as costuras e não se mexem).</div>
          <div className="pm-sep" />
          <Row label="Modo de mistura"><BlendSelect value={(L.blend ?? 'source-over') as string} onChange={(b) => ch({ blend: b === 'source-over' ? undefined : b as GlobalCompositeOperation })} /></Row>
          <Row label="Opacidade"><Slider value={Math.round(L.opacity * 100)} min={0} max={100} onChange={(o) => ch({ opacity: o / 100 })} /></Row>
          {stitchRow}
          {fabricRow}
          {shineRow}
          <div className="muted small">O brilho do grupo, quando ligado, vale para todas as camadas dele.</div>
          <div className="pm-sep" />
          <div className="btn-row">
            <button className="btn small" onClick={() => ch({ dx: undefined, dy: undefined, zoom: undefined, rotation: undefined, blend: undefined, shine: undefined, opacity: 1, stitch: undefined })}>Repor valores por defeito</button>
            <button className="btn small" title="As camadas ficam com o deslocamento, tamanho e rotação do grupo e saem dele" onClick={() => up((k) => {
              const resolved = new Map(resolveGroups(k.layers).map((x) => [x.id, x]))
              return { ...k, layers: k.layers.filter((x) => x.id !== L.id).map((x) => (x.group === L.id ? { ...(resolved.get(x.id) ?? x), visible: x.visible, opacity: x.opacity * L.opacity, group: undefined } : x)) }
            })}>Desagrupar</button>
          </div>
        </div>
      )
    }
    if (L.kind === 'freeform') {
      const strokes = L.strokes ?? []
      const mine = kit.layers.filter((x) => x.id !== L.id && x.kind !== 'image' && !(x.kind === 'group' && x.id === L.group) && sameList(x))
      return (
        <div className="layer-body pm">
          <Row label="Nome"><input value={L.name ?? ''} placeholder="Caneta" onChange={(e) => ch({ name: e.target.value || undefined })} /></Row>
          {groupRow}
          <Row label="Máscara">
            <Select value={L.maskLayer ?? ''} options={[['', 'Nenhuma'], ...(part === 'torso' ? [['__sleeves', 'Só nas mangas'] as [string, string]] : []), ...mine.map((x) => [x.id, 'Só onde está: ' + layerLabel(x)] as [string, string])]} onChange={(maskLayer) => ch({ maskLayer: maskLayer || undefined })} />
            {L.maskLayer && <label className="check"><input type="checkbox" checked={!!L.maskInvert} onChange={(e) => ch({ maskInvert: e.target.checked })} /> Inverter</label>}
          </Row>
          <div className="pm-sep" />
          <FillRow label="Cor" value={L.fill ?? solid(L.color)} onChange={(f) => ch({ fill: f.kind === 'solid' ? undefined : f, color: fillMain(f, L.color) })} />
          <Row label="Espessura"><Slider value={L.size ?? 24} min={2} max={300} onChange={(size) => ch({ size })} /></Row>
          <div className="btn-row">
            <button className="btn small" disabled={!strokes.length} onClick={() => ch({ strokes: strokes.slice(0, -1) })}>Apagar último traço</button>
            <button className="btn small" disabled={!strokes.length} onClick={() => { if (confirm('Apagar todo o desenho desta camada?')) ch({ strokes: [] }) }}>Limpar desenho</button>
            <span className="muted small">{strokes.length} traço(s)</span>
          </div>
          <div className="pm-sep" />
          <label className="check"><input type="checkbox" checked={!!L.mirrorCenter} onChange={(e) => ch({ mirrorCenter: e.target.checked || undefined })} /> Simetria (esquerda ↔ direita)</label>
          <div className="pm-sep" />
          <Row label="Rotação"><Slider value={L.rotation ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(rotation) => ch({ rotation: rotation || undefined })} /></Row>
          <div className="pm-sep" />
          <Row label="Modo de mistura"><BlendSelect value={(L.blend ?? 'source-over') as string} onChange={(b) => ch({ blend: b as GlobalCompositeOperation })} /></Row>
          <Row label="Opacidade"><Slider value={Math.round(L.opacity * 100)} min={0} max={100} onChange={(o) => ch({ opacity: o / 100 })} /></Row>
          <Row label="Desfoque"><Slider value={L.blur ?? 0} min={0} max={100} onChange={(blur) => ch({ blur: blur || undefined })} /></Row>
          {stitchRow}
          {fabricRow}
          {shineRow}
          <div className="pm-sep" />
          <button className="btn small" onClick={resetLayer}>Repor valores por defeito</button>
        </div>
      )
    }
    if (L.kind === 'collar') {
      const def = COLLAR_DESIGNS.find((x) => x[0] === L.collarStyle) ?? COLLAR_DESIGNS[0]
      const cols = [0, 1, 2].map((i) => L.colors?.[i] ?? [L.color, contrastOn(L.color), kit.colors.shirt2][i])
      return (
        <div className="layer-body">
          <Row label="Nome"><input value={L.name ?? ''} placeholder={layerLabel({ ...L, name: undefined })} onChange={(e) => ch({ name: e.target.value || undefined })} /></Row>
          {groupRow}
          {designCard('Gola · ' + def[1])}
          <Row label={def[2] > 1 ? 'Cores' : 'Cor'}>
            <span className="sw-row">{cols.slice(0, def[2]).map((c, i) => <Swatch key={i} value={c} title={'Cor ' + (i + 1)} onChange={(v) => { const n = [...cols]; n[i] = v; ch({ colors: n, color: n[0] }) }} />)}</span>
          </Row>
          {L.collarStyle && (() => {
            const st = L.collarStyle
            const P = { ...collarDefaults(st, L.width), ...(L.p ?? {}) }
            const setP = (k: string, v: number | string): void => ch({ p: { ...(L.p ?? {}), [k]: v } })
            return (
              <>
                {collarParams(st).map((pm) => pm.options
                  ? <Row key={pm.key} label={pm.label}><Select value={String(P[pm.key])} options={pm.options} onChange={(v) => setP(pm.key, v)} /></Row>
                  : <Row key={pm.key} label={pm.label}><Slider value={Number(P[pm.key] ?? 0)} min={pm.min ?? 0} max={pm.max ?? 100} onChange={(v) => setP(pm.key, v)} /></Row>)}
                {collarParams(st).length > 0 && <button className="btn tiny ghost" onClick={() => ch({ p: undefined })}>Repor medidas</button>}
              </>
            )
          })()}
          {stitchRow}
          {fabricRow}
        </div>
      )
    }
    if (L.kind === 'panel') {
      const mine = kit.layers.filter((x) => x.id !== L.id && x.kind !== 'image' && !(x.kind === 'group' && x.id === L.group) && (x.part === L.part || (part === 'torso' && (x.part === 'shirt' || x.part === 'torso'))))
      const two = (PANEL_STYLES.find((x) => x[0] === (L.pstyle ?? 'solid'))?.[2] ?? 1) > 1
      return (
        <div className="layer-body pm">
          <Row label="Nome"><input value={L.name ?? ''} placeholder={layerLabel({ ...L, name: undefined })} onChange={(e) => ch({ name: e.target.value || undefined })} /></Row>
          {groupRow}
          <Row label="Máscara">
            <Select value={L.maskLayer ?? ''} options={[['', 'Nenhuma'], ...(part === 'torso' ? [['__sleeves', 'Só nas mangas'] as [string, string]] : []), ...mine.map((x) => [x.id, 'Só onde está: ' + layerLabel(x)] as [string, string])]} onChange={(maskLayer) => ch({ maskLayer: maskLayer || undefined })} />
            {L.maskLayer && <label className="check"><input type="checkbox" checked={!!L.maskInvert} onChange={(e) => ch({ maskInvert: e.target.checked })} /> Inverter</label>}
          </Row>
          <div className="pm-sep" />
          {designCard(panelLabel(L))}
          <Row label={two ? 'Cores' : 'Cor'}>
            <span className="sw-row">
              <Swatch value={fillMain(L.fill, L.color)} title="Cor 1" onChange={(color) => ch({ color, fill: undefined })} />
              {two && <Swatch value={L.colors?.[1] ?? contrastOn(fillMain(L.fill, L.color))} title="Cor 2" onChange={(c) => ch({ colors: [L.color, c] })} />}
            </span>
          </Row>
          <Row label="Largura"><Slider value={L.size ?? 60} min={4} max={L.panel === 'sockFold' ? 300 : 400} onChange={(size) => ch({ size })} /></Row>
          {(L.pstyle === 'stripes' || L.pstyle === 'stripes2c') && <Row label="Riscas"><Slider value={L.pcount ?? 3} min={1} max={12} onChange={(pcount) => ch({ pcount })} /></Row>}
          {(L.pstyle === 'stripes' || L.pstyle === 'stripes2c') && <Row label="Largura de cada risca"><Slider value={L.stripeW ?? 0} min={0} max={200} onChange={(stripeW) => ch({ stripeW: stripeW || undefined })} /></Row>}
          {(L.pstyle === 'stripes' || L.pstyle === 'stripes2c') && !L.stripeW && <div className="muted small">Largura de cada risca 0 = as riscas repartem a largura do painel.</div>}
          {L.pstyle && L.pstyle !== 'solid' && L.pstyle !== 'twoTone' && <Row label={L.pstyle === 'border' ? 'Rebordo' : L.pstyle === 'center' ? 'Largura da risca' : 'Espaçamento'}><Slider value={L.pgap ?? Math.round((L.size ?? 60) / ((L.pcount ?? 3) * 3))} min={0} max={200} onChange={(pgap) => ch({ pgap })} /></Row>}
          {L.panel === 'sockTrim' && <Row label="Posição"><Slider value={L.y ?? 84} min={0} max={480} onChange={(y) => ch({ y })} /></Row>}
          {L.panel === 'shoulders' && <label className="check"><input type="checkbox" checked={!!L.panelSleeve} onChange={(e) => ch({ panelSleeve: e.target.checked || undefined })} /> Continuar pelas mangas</label>}
          {L.panel === 'shortsSides' && <Toggle on={!!L.mirrorCenter} label="Espelhar (pernas iguais ao espelho)" onChange={(v) => ch({ mirrorCenter: v || undefined })} />}
          <div className="pm-sep" />
          <Row label={L.panel === 'shoulders' ? 'Deslocamento (através)' : 'Deslocamento'}><Slider value={L.dx ?? 0} min={-300} max={300} snaps={[0]} onChange={(dx) => ch({ dx: dx || undefined })} /></Row>
          {L.panel === 'shoulders' && <Row label="Deslocamento (ao longo)"><Slider value={L.dy ?? 0} min={-300} max={300} snaps={[0]} onChange={(dy) => ch({ dy: dy || undefined })} /></Row>}
          <Row label="Rotação"><Slider value={L.rotation ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(rotation) => ch({ rotation: rotation || undefined })} /></Row>
          <div className="pm-sep" />
          <Row label="Modo de mistura"><BlendSelect value={(L.blend ?? 'source-over') as string} onChange={(b) => ch({ blend: b as GlobalCompositeOperation })} /></Row>
          <Row label="Opacidade"><Slider value={Math.round(L.opacity * 100)} min={0} max={100} onChange={(o) => ch({ opacity: o / 100 })} /></Row>
          <Row label="Desfoque"><Slider value={L.blur ?? 0} min={0} max={100} onChange={(blur) => ch({ blur: blur || undefined })} /></Row>
          {stitchRow}
          {fabricRow}
          {shineRow}
          <div className="pm-sep" />
          <button className="btn small" onClick={resetLayer}>Repor valores por defeito</button>
        </div>
      )
    }
    // offsets are shown the same way for every layer: −500..500 from the part's centre, positive = right / up
    const freeXY = L.kind === 'text' || (L.kind === 'image' && L.fit !== 'part' && L.fit !== 'tile')
    const offX = freeXY ? (L.x ?? 1024) - 1024 : L.dx ?? 0
    const offY = freeXY ? FRONT_Y - (L.y ?? (L.kind === 'text' ? 1100 : 1300)) : -(L.dy ?? 0)
    // on the sleeves the drawing runs on down the long sleeves: offsets go far enough to reach their cuffs
    const offMax = part === 'torso' && (L.zones ?? []).includes('sleeves') ? 2000 : 500
    const setOff = (x: number, y: number): void => ch(freeXY ? { x: 1024 + x, y: FRONT_Y - y } : { dx: x, dy: -y })
    const masked = L.kind !== 'image' || (L.fit === 'tile' && L.tileTint === 'color')
    const showColor = masked && L.kind !== 'design'
    const maskRow = masked ? (
      <Row label="Máscara">
        <Select value={L.maskLayer ?? ''} options={[['', '—'], ...(part === 'torso' ? [['__sleeves', 'Mangas'] as [string, string]] : []), ...kit.layers.filter((x) => x.id !== L.id && x.kind !== 'image' && !(x.kind === 'group' && x.id === L.group) && (x.part === L.part || (part === 'torso' && (x.part === 'shirt' || x.part === 'torso')))).map((x) => [x.id, layerLabel(x)] as [string, string])]} onChange={(maskLayer) => ch({ maskLayer: maskLayer || undefined })} />
        {L.maskLayer && <label className="check"><input type="checkbox" checked={!!L.maskInvert} onChange={(e) => ch({ maskInvert: e.target.checked })} /> Inverter</label>}
      </Row>
    ) : null
    // design parameters: the outline goes with the colours, rounding with the deformation; plain shapes have no
    // width / height of their own any more (Tamanho x / y do that)
    const def = L.kind === 'design' ? designDef(L.design) : null
    const setP = (k: string, v: number | boolean | string): void => ch({ p: { ...(L.p ?? {}), [k]: v } })
    const basicShape = !!def && ['rect', 'triangle', 'circle'].includes(def.id)
    const paramRow = (pm: NonNullable<typeof def>['params'][number]): JSX.Element => {
      const v = dp<number | boolean | string>(L, pm.key)
      if (pm.options) return <Row key={pm.key} label={pm.label}><Select value={String(v)} options={pm.options} onChange={(x) => setP(pm.key, x)} /></Row>
      if (typeof pm.def === 'boolean') return <Toggle key={pm.key} on={!!v} label={pm.label} onChange={(x) => setP(pm.key, x)} />
      return <Row key={pm.key} label={pm.label}><Slider value={Number(v)} min={pm.min ?? 0} max={pm.max ?? 100} onChange={(x) => setP(pm.key, x)} /></Row>
    }
    const outlineKeys = ['outline', 'ow']
    const params = def ? def.params.filter((pm) => !outlineKeys.includes(pm.key) && pm.key !== 'round' && !(basicShape && (pm.key === 'w' || pm.key === 'h'))) : []
    const hasOutline = !!def && def.params.some((pm) => pm.key === 'ow')
    const roundParam = def?.params.find((pm) => pm.key === 'round')
    const noTransform = L.kind === 'image' && L.fit === 'uv'
    return (
      <div className="layer-body pm">
        {/* 1. name, group, mask */}
        <Row label="Nome"><input value={L.name ?? ''} placeholder={layerLabel({ ...L, name: undefined })} onChange={(e) => ch({ name: e.target.value || undefined })} /></Row>
        {groupRow}
        {maskRow}
        <div className="pm-sep" />

        {/* 2. preview, what the layer is, colour, outline, stitching, shine */}
        {L.kind === 'vector' && (
          <>
            <button className="btn" onClick={() => setVecEdit(L.id)}>✎ Editar desenho ({(L.vpaths ?? []).length} forma{(L.vpaths ?? []).length === 1 ? '' : 's'})</button>
            {(L.vpaths ?? []).some((v) => !v.closed) && <Row label="Espessura das linhas"><Slider value={L.strokeW ?? 8} min={1} max={120} onChange={(strokeW) => ch({ strokeW })} /></Row>}
          </>
        )}
        {def && (() => {
          const nCols = def.params.some((x) => x.key === 'n') ? Math.min(def.colors, Math.max(1, Math.round(Number(dp<number>(L, 'n'))))) : def.colors
          const cols = Array.from({ length: nCols }, (_, i) => L.colors?.[i] ?? [kit.colors.shirt2, kit.colors.shirt3, '#ffffff', '#111111', kit.colors.collar, '#888888'][i] ?? '#888888')
          const stops = L.stops ?? [{ c: kit.colors.shirt2, at: 0 }, { c: kit.colors.shirt, at: 100 }]
          const outlined = hasOutline && (!!dp<boolean>(L, 'outline') || Number(dp<number>(L, 'ow')) > 0)
          const lineColor = L.colors?.[1] ?? cols[0]
          return (
            <>
              {designCard(def.label)}
              {def.colors > 0 && (
                <Row label={def.colors > 1 ? 'Cores' : 'Cor'}>
                  <span className="sw-row">{cols.map((c, i) => <Swatch key={i} value={c} title={'Cor ' + (i + 1)} onChange={(v) => { const n = [...(L.colors ?? cols)]; n[i] = v; ch({ colors: n, color: n[0] }) }} />)}</span>
                </Row>
              )}
              {def.stops && (
                <div className="stops">
                  {stops.map((st, i) => (
                    <div key={i} className="stop-row">
                      <Swatch value={st.c} title={'Paragem ' + (i + 1)} onChange={(v) => ch({ stops: stops.map((x, k) => (k === i ? { ...x, c: v } : x)) })} />
                      <Slider value={st.at} min={0} max={100} onChange={(at) => ch({ stops: stops.map((x, k) => (k === i ? { ...x, at } : x)) })} />
                      {stops.length > 2 && <button className="btn tiny ghost" onClick={() => ch({ stops: stops.filter((_, k) => k !== i) })}>✕</button>}
                    </div>
                  ))}
                  <button className="btn tiny" onClick={() => ch({ stops: [...stops, { c: '#ffffff', at: 50 }] })}>+ Cor</button>
                </div>
              )}
              {hasOutline && (
                <>
                  <Row label="Espessura do contorno"><Slider value={Number(dp<number>(L, 'ow'))} min={0} max={120} onChange={(x) => setP('ow', x)} /></Row>
                  {outlined && <Row label="Relevo"><Slider value={L.outlineRelief ?? 0} min={0} max={100} onChange={(outlineRelief) => ch({ outlineRelief: outlineRelief || undefined })} /></Row>}
                  {outlined && <Row label="Cor do contorno"><Swatch value={lineColor} title="Cor do contorno" onChange={(v) => { const n = [...(L.colors ?? cols)]; n[0] = n[0] ?? cols[0]; n[1] = v; ch({ colors: n }) }} /></Row>}
                  <Toggle on={!!dp<boolean>(L, 'outline')} label="Só o contorno" onChange={(x) => setP('outline', x)} />
                </>
              )}
              {params.map(paramRow)}
            </>
          )
        })()}
        {L.kind === 'pattern' && L.part === 'shorts' && (
          <>
            <Row label="Design"><Select value={L.pattern ?? 'side'} options={SHORTS_PATTERNS.filter((t) => t[0] !== 'none')} onChange={(pattern) => ch({ pattern })} /></Row>
            <Row label="Quantidade"><Slider value={L.count ?? 3} min={1} max={20} onChange={(count) => ch({ count })} /></Row>
            <Row label="Largura"><Slider value={L.width ?? 40} min={5} max={95} onChange={(width) => ch({ width })} /></Row>
            <Row label="Rotação"><Slider value={L.rotation ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(rotation) => ch({ rotation: rotation || undefined })} /></Row>
            <Row label="Deslocamento (x)"><Slider value={L.dx ?? 0} min={-400} max={400} snaps={[0]} onChange={(dx) => ch({ dx: dx || undefined })} /></Row>
            <Row label="Deslocamento (y)"><Slider value={L.dy ?? 0} min={-400} max={400} snaps={[0]} onChange={(dy) => ch({ dy: dy || undefined })} /></Row>
          </>
        )}
        {L.kind === 'pattern' && L.part !== 'shorts' && (
          <>
            <ThumbButton label={TORSO_PATTERNS.find((t) => t[0] === L.pattern)?.[1] ?? 'Design'} onClick={() => setFly({ kind: 'layerPattern', layer: L.id })}
              load={() => patternPreview({ ...kit, layers: [], torso: { id: 'none', color: L.color, count: L.count ?? 3, width: L.width ?? 40 } }, 'torso', L.pattern ?? 'stripes', assets)} deps={[L.pattern, kit.colors.shirt, L.color, L.count, L.width]} />
            <Row label="Quantidade"><Slider value={L.count ?? 3} min={1} max={40} onChange={(count) => ch({ count })} /></Row>
            {STRIPED.includes(L.pattern ?? '') && (
              <Row label="Medidas"><Select value={L.stripeW ? 'px' : 'auto'} options={[['auto', 'Automáticas (preenche a camisola)'], ['px', 'Largura e espaçamento próprios']]}
                onChange={(m) => ch(m === 'px' ? { stripeW: L.stripeW || 40, gap: L.gap ?? 40 } : { stripeW: undefined })} /></Row>
            )}
            {L.stripeW ? (
              <>
                <Row label="Largura de cada risca"><Slider value={L.stripeW} min={2} max={400} onChange={(stripeW) => ch({ stripeW })} /></Row>
                <Row label="Espaçamento"><Slider value={L.gap ?? 40} min={0} max={500} onChange={(gap) => ch({ gap })} /></Row>
              </>
            ) : <Row label="Largura"><Slider value={L.width ?? 40} min={5} max={95} onChange={(width) => ch({ width })} /></Row>}
          </>
        )}
        {L.kind === 'texture' && (
          <>
            <ThumbButton label={TEXTURES.find((t) => t[0] === L.pattern)?.[1] ?? 'Padrão'} onClick={() => setTexPick({ kind: 'patterns', part, replace: L.id })}
              load={() => texturePreview(L.pattern ?? 'dots', fillMain(L.fill, L.color), kit.colors.shirt, L.scale)} deps={[L.pattern, L.color, L.fill, kit.colors.shirt, L.scale]} />
            <Row label="Formas"><Select value={L.texOutline ? 'line' : 'fill'} options={[['fill', 'Cheias'], ['line', 'Só o contorno (traço)']]} onChange={(v) => ch({ texOutline: v === 'line' || undefined })} /></Row>
            <Row label="Traço"><Select value={L.stroke ?? 'solid'} options={STROKES} onChange={(stroke) => ch({ stroke })} /></Row>
            <Row label="Espessura do traço"><Slider value={L.lineWidth ?? 100} min={20} max={400} step={5} onChange={(lineWidth) => ch({ lineWidth })} /></Row>
            <Row label="Tamanho do padrão"><Slider value={L.scale ?? 70} min={12} max={400} onChange={(scale) => ch({ scale })} /></Row>
          </>
        )}
        {L.kind === 'shape' && (
          <>
            {designCard(SHAPES.find((s) => s[0] === L.shape)?.[1] ?? 'Design')}
            <Row label="Espessura"><Slider value={L.size ?? 60} min={4} max={600} onChange={(size) => ch({ size })} /></Row>
          </>
        )}
        {L.kind === 'text' && (
          <>
            <Row label="Fonte"><FontPicker value={L.font ?? 'Arial Black'} onChange={(font) => ch({ font })} /></Row>
            <Row label="Texto"><input value={L.text ?? ''} onChange={(e) => ch({ text: e.target.value })} /></Row>
            {part === 'torso' && (
              <Row label="Posição"><Select value={L.placement ?? ((L.zones ?? ['front', 'back']).length > 1 ? 'frontBack' : (L.zones ?? ['front'])[0] === 'back' ? 'back' : 'front')} options={TEXT_PLACEMENTS}
                onChange={(placement) => ch({ placement: placement as TextPlacement, ...(placement === 'backCollar' ? { y: FRONT_Y + 54, size: 30 } : {}), ...(placement === 'front' ? { zones: ['front'] } : placement === 'back' ? { zones: ['back'] } : placement === 'frontBack' ? { zones: ['front', 'back'] } : {}) })} /></Row>
            )}
            <Row label="Espaçamento de letras"><Slider value={L.letterSpacing ?? 0} min={-50} max={1000} snaps={[0]} onChange={(letterSpacing) => ch({ letterSpacing: letterSpacing || undefined })} /></Row>
            <Toggle on={!!L.italic} label="Itálico" onChange={(v) => ch({ italic: v || undefined })} />
            <Toggle on={!!L.vertical} label="Texto vertical (letras empilhadas)" onChange={(v) => ch({ vertical: v || undefined })} />
          </>
        )}
        {L.kind === 'image' && (
          <>
            <Row label={L.fit === 'tile' ? 'Padrão' : 'Imagem/textura'}>{L.assetId && assets[L.assetId] && <img className="logo-thumb" src={assets[L.assetId].dataUrl} alt="" />}
              {L.fit === 'tile' && <button className="btn small" onClick={() => setTexPick({ kind: 'patterns', part, replace: L.id })}>Trocar ▸</button>}
              <AssetPicker label={L.fit === 'tile' ? 'Imagem própria…' : L.assetId ? 'Trocar' : 'Escolher'} autoOpen={!L.assetId} onPick={async (a) => {
                addAsset(a)
                // a complete kit texture (square): only the part of this tab is taken from it
                let full = false
                try { const im = await loadAsset(a); full = !L.fit || L.fit === 'free' ? Math.abs(imgW(im) - imgH(im)) < 4 && imgW(im) >= 512 : false } catch { /* keep the mode */ }
                ch(full ? { assetId: a.id, fit: 'uv' } : { assetId: a.id })
              }} /></Row>
            <Row label="Modo"><Select value={L.fit ?? 'free'} options={[['free', 'Imagem solta'], ['part', 'Ocupar a peça inteira'], ['tile', 'Padrão (repetir em mosaico)'], ['uv', 'Textura completa (só a parte desta aba)']]}
              onChange={(fit) => ch(fit === 'tile' ? { fit: 'tile', size: 160, gap: L.gap ?? 0, dx: 0, dy: 0 } : { fit: fit as 'free' | 'part' })} /></Row>
            {L.fit === 'tile' && <Row label="Espaçamento"><Slider value={L.gap ?? 0} min={0} max={600} onChange={(gap) => ch({ gap })} /></Row>}
            <Row label="Cores"><Select value={L.tileTint ?? 'original'} options={[['original', 'Originais da imagem'], ['color', L.fit === 'tile' ? 'Uma cor (ou gradiente)' : 'Uma cor']]} onChange={(v) => ch({ tileTint: v as 'original' | 'color' })} /></Row>
            {L.fit !== 'tile' && L.tileTint === 'color' && <Row label="Cor"><ColorInput value={fillMain(L.fill, L.color)} onChange={(color) => ch({ color, fill: undefined })} /></Row>}
          </>
        )}
        {showColor && <FillRow label="Cor" value={L.fill ?? solid(L.color)} onChange={(f) => ch({ fill: f.kind === 'solid' ? undefined : f, color: fillMain(f, L.color) })} />}

        {/* 3. where it shows */}
        {part === 'torso' && L.kind !== 'text' && !noTransform && (
          <>
            <div className="pm-sep" />
            <div className="pm-label">Mostrar em</div>
            <div className="toggles">
              {ZONES.map(([z, label]) => {
                const zs = L.zones ?? ['front', 'back']
                return <Toggle key={z} on={zs.includes(z)} label={label} onChange={(v) => ch({ zones: v ? [...zs, z] : zs.filter((x) => x !== z) })} />
              })}
              {(L.zones ?? []).includes('sleeves') && <Toggle on={!!L.shortOnly} label="Só nas mangas curtas" onChange={(v) => ch({ shortOnly: v || undefined })} />}
            </div>
          </>
        )}

        {!noTransform && (
          <>
            {/* 4. mirrors */}
            <div className="pm-sep" />
            <div className="toggles">
              <Toggle on={!!L.flipX} label="Espelhar" onChange={(v) => ch({ flipX: v || undefined })} />
              <Toggle on={!!L.mirrorCenter} label="Espelhar (centro)" onChange={(v) => ch({ mirrorCenter: v || undefined })} />
              {part === 'torso' && <Toggle on={!!L.mirrorBack} label="Espelhar nas costas" onChange={(v) => ch({ mirrorBack: v || undefined })} />}
              {part === 'socks' && <Toggle on={!!L.mirrorLegs} label="Espelhar para o outro lado da meia" onChange={(v) => ch({ mirrorLegs: v || undefined })} />}
            </div>

            {/* 5. offset, size, rotation */}
            <div className="pm-sep" />
            <Row label="Deslocamento (x)"><Slider value={Math.round(offX)} min={-offMax} max={offMax} snaps={[0]} onChange={(x) => setOff(x, offY)} /></Row>
            <Row label="Deslocamento (y)"><Slider value={Math.round(offY)} min={-offMax} max={offMax} snaps={[0]} onChange={(y) => setOff(offX, y)} /></Row>
            <Row label="Tamanho"><Slider value={L.zoom ?? 100} min={10} max={800} onChange={(zoom) => ch({ zoom: zoom === 100 ? undefined : zoom })} /></Row>
            <Row label="Tamanho (x)"><Slider value={Math.round((L.sx ?? 1) * 100)} min={10} max={800} onChange={(v) => ch({ sx: v / 100 })} /></Row>
            <Row label="Tamanho (y)"><Slider value={Math.round((L.sy ?? 1) * 100)} min={10} max={800} onChange={(v) => ch({ sy: v / 100 })} /></Row>
            <Row label="Rotação"><Slider value={L.rotation ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(rotation) => ch({ rotation })} /></Row>
          </>
        )}

        {/* 6. rounding and deformation (text: its arc) */}
        {(roundParam || masked || L.kind === 'text') && <div className="pm-sep" />}
        {roundParam && paramRow(roundParam)}
        {L.kind === 'text' && <Row label="Arco"><Slider value={L.arch ?? 0} min={-150} max={150} snaps={[0]} onChange={(arch) => ch({ arch: arch || undefined })} /></Row>}
        {masked && (
          <>
            <Row label="Deformar"><Select value={L.warp?.kind ?? 'none'} options={[['none', 'Sem deformação'], ['arc', 'Arco'], ['wave', 'Onda'], ['flag', 'Bandeira']]} onChange={(kind) => ch({ warp: { kind, amount: L.warp?.amount || 60 } })} /></Row>
            {L.warp && L.warp.kind !== 'none' && <Row label="Intensidade"><Slider value={L.warp.amount} min={-300} max={300} onChange={(amount) => ch({ warp: { ...L.warp!, amount } })} /></Row>}
          </>
        )}

        {/* 7. blend, opacity, blur */}
        <div className="pm-sep" />
        <Row label="Modo de mistura"><BlendSelect value={(L.blend ?? 'source-over') as string} onChange={(b) => ch({ blend: b as GlobalCompositeOperation })} /></Row>
        <Row label="Opacidade"><Slider value={Math.round(L.opacity * 100)} min={0} max={100} onChange={(o) => ch({ opacity: o / 100 })} /></Row>
        <Row label="Desfoque"><Slider value={L.blur ?? 0} min={0} max={100} onChange={(blur) => ch({ blur: blur || undefined })} /></Row>
        {L.kind === 'text' && (
          <>
            <Toggle on={!!L.border} label="Contorno" onChange={(v) => ch({ border: v || undefined })} />
            {L.border && (
              <>
                <Row label="Cor do contorno"><ColorInput value={L.borderColor ?? contrastOn(fillMain(L.fill, L.color))} onChange={(borderColor) => ch({ borderColor })} /></Row>
                <Row label="Espessura do contorno"><Slider value={L.borderW ?? 2} min={1} max={8} onChange={(borderW) => ch({ borderW })} /></Row>
                <Row label="Relevo"><Slider value={L.outlineRelief ?? 0} min={0} max={100} onChange={(outlineRelief) => ch({ outlineRelief: outlineRelief || undefined })} /></Row>
              </>
            )}
          </>
        )}
        {stitchRow}
        {embroRow}
        {fabricRow}
        {shineRow}
        <div className="pm-sep" />
        <button className="btn small" title="Tamanho, rotação, posição, espelhos, deformação, desfoque, opacidade, mistura, brilho e costura voltam aos valores iniciais (o design, as cores e as zonas ficam)" onClick={resetLayer}>Repor valores por defeito</button>
      </div>
    )
  }

  /**
   * Layer list in the PES Master style: compact rows (eye · colour swatch · type icon · name · duplicate · delete),
   * the top row is drawn on top, drag a row to move it (onto a group member = join that group), fixed rows at the
   * bottom (base, collar, sleeves…) and the "Adicionar camada" grid. Clicking a row opens its settings below it.
   */
  const layerList = (part: 'torso' | 'shorts' | 'socks', fixed: FixedRow[] = []): JSX.Element => {
    const inPart = (l: OverlayLayer): boolean => (part === 'torso' ? l.part === 'torso' || l.part === 'shirt' || l.part === 'sleeves' : l.part === part)
    const camFor = (l: OverlayLayer): CamView => (part !== 'torso' ? (part as CamView) : l.zones?.length === 1 && l.zones[0] === 'back' ? 'back' : l.zones?.length === 1 && l.zones[0] === 'sleeves' ? 'sleeve' : 'front')
    // display order: top of the list = drawn last; a group shows its header first, then its members (top first)
    const ordered = normalizeGroups(kit.layers).filter(inPart)
    const units: OverlayLayer[][] = []
    for (const l of ordered) if (l.group && units.length && units[units.length - 1][0].kind === 'group' && units[units.length - 1][0].id === l.group) units[units.length - 1].push(l); else units.push([l])
    const display = units.reverse().flatMap((u) => (u[0].kind === 'group' ? [u[0], ...u.slice(1).reverse()] : u))
    const addLayer = (L: OverlayLayer, fly?: () => void): void => { up((k) => ({ ...k, layers: [...k.layers, L] })); setOpenLayer(L.id); fly?.() }
    const base = (kind: OverlayLayer['kind'], more: Partial<OverlayLayer> = {}): OverlayLayer => ({
      id: uid(), kind, part, visible: true, opacity: kind === 'texture' ? 0.25 : 1,
      color: kind === 'texture' ? contrastOn(kit.colors.shirt) : kit.colors.shirt2, pattern: kind === 'pattern' ? 'stripes' : 'dots', count: 3, width: 40,
      shape: 'band', text: 'TEXTO', size: kind === 'image' ? 300 : 60, dx: 0, dy: 0, rotation: 0, zones: part === 'torso' ? ['front', 'back'] : undefined, ...more
    })
    const panel = (p: PanelKind): OverlayLayer => ({ id: uid(), kind: 'panel', panel: p, part, visible: true, opacity: 1, color: kit.colors.shirt2, size: PANELS.find((x) => x[0] === p)?.[3] ?? 60 })
    const adds: [string, IconName, () => void][] = [
      ['Padrão', 'pattern', () => setTexPick({ kind: 'patterns', part })],
      ['Designs', 'design', () => setTexPick({ kind: 'graphics', part })],
      ['Padrão personalizado', 'tile', () => addLayer(base('image', { fit: 'tile', tileTint: 'original', size: 160, gap: 0 }))],
      ['Caneta', 'freeform', () => { const id = uid(); addLayer({ id, kind: 'vector', part, visible: true, opacity: 1, color: kit.colors.shirt2, vpaths: [], zones: part === 'torso' ? ['front', 'back'] : undefined }); setVecEdit(id) }],
      ['Imagem/textura', 'logo', () => addLayer(base('image'))],
      ['Texto', 'text', () => addLayer(base('text', { x: 1024, y: 1350, size: 90 }))],
      ['Grupo', 'group', () => addLayer({ id: uid(), kind: 'group', part, visible: true, opacity: 1, color: '#888888', name: 'Grupo ' + (kit.layers.filter((x) => x.kind === 'group').length + 1) })]
    ]
    const iconOf = (L: OverlayLayer): IconName => L.kind === 'collar' ? 'collar' : L.kind === 'pattern' || L.kind === 'design' ? 'design' : L.kind === 'texture' ? 'pattern' : L.kind === 'shape' ? 'graphic' : L.kind === 'text' ? 'text'
      : L.kind === 'image' ? (L.fit === 'tile' ? 'tile' : 'logo') : L.kind === 'panel' ? 'panel' : L.kind === 'freeform' || L.kind === 'vector' ? 'freeform' : 'group'
    // drag & drop: a layer moves; the mask handle of a layer dropped on another makes it that layer's mask (and
    // hides it, it only shapes the other one); the sleeves row goes just above the row it is dropped on
    const dropOn = (target: OverlayLayer): void => {
      const id = dragId.current
      dragId.current = null
      if (!id || id === target.id) return
      if (id.startsWith('mask:')) {
        const src = id.slice(5)
        if (src === target.id || target.group === src) return
        up((k) => ({ ...k, layers: k.layers.map((x) => (x.id === target.id ? { ...x, maskLayer: src, maskInvert: undefined } : x.id === src ? { ...x, visible: false } : x)) }))
        notify('ok', 'Máscara: ' + layerLabel(kit.layers.find((x) => x.id === src) ?? target) + ' → ' + layerLabel(target))
        return
      }
      if (id === 'fixed:sleeves') { up((k) => ({ ...k, sleeveAfter: target.id })); return }
      if (id === 'fixed:shortsBase' || id === 'fixed:socksBase') { const which = id === 'fixed:shortsBase' ? 'shorts' : 'socks'; up((k) => ({ ...k, baseAfter: { ...k.baseAfter, [which]: target.kind === 'group' || !target.group ? target.id : target.group } })); return }
      up((k) => ({ ...reanchor(k, id), layers: dropLayer(k.layers, id, target.id) }))
    }
    // a fixed row (Mangas / base of the shorts or socks) placed right above a layer that is now being moved stays
    // where it is: it is tied to the layer below the moved one instead of following it
    const reanchor = (k: KitDesign, moved: string): KitDesign => {
      const ls = normalizeGroups(k.layers)
      const L = ls.find((x) => x.id === moved)
      if (!L) return k
      const block = new Set(ls.filter((x) => x.id === moved || x.group === moved).map((x) => x.id))
      const below = (): string => { const i = ls.findIndex((x) => block.has(x.id)); for (let j = i - 1; j >= 0; j--) if (!block.has(ls[j].id)) return ls[j].group && !block.has(ls[j].group!) && ls.find((g) => g.id === ls[j].group) ? ls[j].group! : ls[j].id; return '' }
      const fix = (a: string | undefined): string | undefined => (a && block.has(a) ? below() : a)
      const sa = fix(k.sleeveAfter)
      const bs = fix(k.baseAfter?.shorts), bk = fix(k.baseAfter?.socks)
      return { ...k, sleeveAfter: sa, baseAfter: k.baseAfter ? { ...k.baseAfter, shorts: bs || undefined, socks: bk || undefined } : k.baseAfter }
    }
    const row = (L: OverlayLayer): JSX.Element | null => {
      const isGroup = L.kind === 'group'
      const parent = L.group ? kit.layers.find((g) => g.id === L.group) : undefined
      if (parent?.collapsed) return null
      const count = kit.layers.filter((x) => x.group === L.id).length
      const asset = L.assetId ? assets[L.assetId] : undefined
      const duplicate = (): void => up((k) => {
        const ls = normalizeGroups(k.layers)
        const i = ls.findIndex((x) => x.id === L.id)
        if (!isGroup) return { ...k, layers: [...ls.slice(0, i + 1), { ...L, id: uid() }, ...ls.slice(i + 1)] }
        const nid = uid(), members = ls.filter((x) => x.group === L.id)
        const block = [{ ...L, id: nid, name: (L.name ?? 'Grupo') + ' (cópia)' }, ...members.map((m) => ({ ...m, id: uid(), group: nid }))]
        const end = i + members.length + 1
        return { ...k, layers: [...ls.slice(0, end), ...block, ...ls.slice(end)] }
      })
      const remove = (): void => {
        if (isGroup && count && !confirm('Apagar o grupo e todas as camadas dele? (Para manter as camadas usa "Desagrupar".)')) return
        up((k) => ({ ...k, layers: k.layers.filter((x) => x.id !== L.id && x.group !== L.id) }))
      }
      const open = openLayer === L.id
      const locked = !!L.locked || !!parent?.locked
      return (
        <div key={L.id} className={'lrow-wrap' + (parent ? ' in-group' : '') + (locked ? ' locked' : '')}>
          <div className={'lrow' + (open ? ' open' : '') + (L.visible ? '' : ' hidden') + (isGroup ? ' group' : '')}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, layer: L.id, part }) }}
            draggable={!locked} onDragStart={(e) => { if (locked) { e.preventDefault(); return } dragId.current = L.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(KC_DRAG, L.id) }} onDragEnd={() => { dragId.current = null }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drop') }} onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); if (!e.dataTransfer.types.includes(KC_DRAG)) { dragId.current = null; return } dropOn(L) }}
            onPointerDown={at(camFor(L))} onClick={() => setOpenLayer(open ? null : L.id)}>
            <button className="lr-eye" title={L.visible ? 'Esconder' : 'Mostrar'} onClick={(e) => { e.stopPropagation(); setLayer(L.id, (x) => ({ ...x, visible: !x.visible })) }}><Icon name={L.visible ? 'eye' : 'eyeOff'} /></button>
            {isGroup
              ? <button className="lr-fold" title={L.collapsed ? 'Mostrar camadas' : 'Recolher'} onClick={(e) => { e.stopPropagation(); setLayer(L.id, (x) => ({ ...x, collapsed: !x.collapsed })) }}>{L.collapsed ? '▸' : '▾'}</button>
              : L.kind === 'image' && asset && L.tileTint !== 'color'
                ? <img className="lr-thumb" src={asset.dataUrl} alt="" />
                : L.kind === 'design'
                  ? <span className="lr-sws" onClick={(e) => e.stopPropagation()}>{(designDef(L.design).stops ? (L.stops ?? []).map((x) => x.c) : Array.from({ length: designCols(L) }, (_, i) => L.colors?.[i] ?? L.color)).slice(0, 6).map((c, i) => (
                      <Swatch key={i} value={c} title={'Cor ' + (i + 1)} className="swatch-btn lr-sw" onChange={(v) => setLayer(L.id, (x) => designDef(x.design).stops
                        ? { ...x, stops: (x.stops ?? []).map((st, k) => (k === i ? { ...st, c: v } : st)) }
                        : { ...x, colors: Array.from({ length: designDef(x.design).colors }, (_, k) => (k === i ? v : x.colors?.[k] ?? x.color)), color: i === 0 ? v : x.color })} />
                    ))}</span>
                  : <span onClick={(e) => e.stopPropagation()}><Swatch value={fillMain(L.fill, L.color)} title={layerLabel(L)} onChange={(c) => setLayer(L.id, (x) => ({ ...x, color: c, fill: undefined }))} className="swatch-btn lr-sw" /></span>}
            <span className="lr-ico"><Icon name={iconOf(L)} /></span>
            <span className="lr-name">{layerLabel(L)}{isGroup ? ` (${count})` : ''}</span>
            {L.maskLayer && <button className="lr-mask" title={'Máscara: ' + (L.maskLayer === '__sleeves' ? 'Mangas' : layerLabel(kit.layers.find((x) => x.id === L.maskLayer) ?? L)) + ' — clica para tirar'} onClick={(e) => { e.stopPropagation(); setLayer(L.id, (x) => ({ ...x, maskLayer: undefined, maskInvert: undefined })) }}>◐</button>}
            <button className="lr-act mask-handle" draggable title="Máscara: arrasta este botão para cima de outra camada — esta passa a ser a máscara dela"
              onDragStart={(e) => { e.stopPropagation(); dragId.current = 'mask:' + L.id; e.dataTransfer.effectAllowed = 'link'; e.dataTransfer.setData(KC_DRAG, 'mask:' + L.id) }} onDragEnd={() => { dragId.current = null }}
              onClick={(e) => { e.stopPropagation(); notify('ok', 'Arrasta o botão de máscara para cima da camada que queres mascarar') }}><Icon name="mask" size={13} /></button>
            <button className={'lr-act' + (L.locked ? ' show on' : '')} title={L.locked ? 'Desbloquear' : 'Bloquear (não se seleciona, move nem edita)'} onClick={(e) => { e.stopPropagation(); setLayer(L.id, (x) => ({ ...x, locked: !x.locked || undefined })) }}><Icon name="lock" size={13} /></button>
            <button className="lr-act" title={isGroup ? 'Duplicar o grupo' : 'Duplicar'} onClick={(e) => { e.stopPropagation(); duplicate() }}>⧉</button>
            <button className="lr-act" title={isGroup ? 'Apagar o grupo e as camadas dele' : 'Apagar'} onClick={(e) => { e.stopPropagation(); remove() }}>✕</button>
          </div>
          {open && <div className="lrow-body" onClick={(e) => e.stopPropagation()}>{locked ? <><div className="muted small">Camada bloqueada — desbloqueia-a (cadeado) para a mudar.</div><fieldset disabled className="locked-body">{layerEditor(L, part)}</fieldset></> : layerEditor(L, part)}</div>}
        </div>
      )
    }
    const fixedRow = (f: FixedRow): JSX.Element => {
      const id = 'fixed:' + f.id, open = openLayer === id
      const onDrop = (): void => {
        const d = dragId.current
        dragId.current = null
        if (!d) return
        if (d.startsWith('mask:') && f.id === 'sleeves') {
          const src = d.slice(5)
          up((k) => ({ ...k, sleevePattern: { ...k.sleevePattern, maskLayer: src, maskInvert: undefined }, layers: k.layers.map((x) => (x.id === src ? { ...x, visible: false } : x)) }))
        } else if (d === 'fixed:sleeves') up((k) => ({ ...k, sleeveAfter: '' }))
        else if (d === 'fixed:shortsBase' || d === 'fixed:socksBase') { const which = d === 'fixed:shortsBase' ? 'shorts' : 'socks'; up((k) => ({ ...k, baseAfter: { ...k.baseAfter, [which]: undefined } })) }
        else if (!d.startsWith('mask:') && !d.startsWith('fixed:')) {
          // dropped on a fixed row placed among the layers: the layer goes right above that row (over what it draws);
          // on a fixed row at the bottom: under every layer
          const anchor = afterOf(f)
          up((k) => ({ ...reanchor(k, d), layers: dropLayer(k.layers, d, anchor && anchor !== d && k.layers.some((x) => x.id === anchor) ? anchor : '') }))
        }
      }
      return (
        <div key={id} className="lrow-wrap">
          <div className={'lrow fixed' + (open ? ' open' : '') + (f.movable ? ' movable' : '')} onPointerDown={f.cam ? at(f.cam) : undefined} onClick={() => setOpenLayer(open ? null : id)}
            draggable={!!f.movable} onDragStart={(e) => { if (!f.movable) return; dragId.current = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(KC_DRAG, id) }} onDragEnd={() => { dragId.current = null }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!e.dataTransfer.types.includes(KC_DRAG)) { dragId.current = null; return } onDrop() }}>
            <span className="lr-eye off">{f.movable ? <span className="lr-grip">⋮⋮</span> : <Icon name="lock" />}</span>
            {f.color && f.setColor ? <span onClick={(e) => e.stopPropagation()}><Swatch value={f.color} title={f.label} onChange={f.setColor} className="swatch-btn lr-sw" /></span> : <span className="lr-sw-empty" />}
            <span className="lr-ico"><Icon name={f.icon} /></span>
            <span className="lr-name">{f.label}</span>
            {f.mask && <span className="lr-mask" title={'Máscara: ' + f.mask}>◐</span>}
          </div>
          {open && <div className="lrow-body" onClick={(e) => e.stopPropagation()}>{f.body}</div>}
        </div>
      )
    }
    // the sleeves row, once dragged among the layers, is shown where it is drawn
    const afterOf = (f: FixedRow): string | undefined => (f.id === 'sleeves' ? kit.sleeveAfter : f.id === 'shortsBase' ? kit.baseAfter?.shorts : f.id === 'socksBase' ? kit.baseAfter?.socks : undefined)
    const placedAll = fixed.filter((f) => f.movable && afterOf(f) && display.some((l) => l.id === afterOf(f)))
    return (
      <>
        <div className="lrows" onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, part }) }}>
          {display.map((l) => { const here = placedAll.filter((f) => afterOf(f) === l.id); return here.length ? [...here.map(fixedRow), row(l)] : row(l) })}
          {fixed.filter((f) => !placedAll.includes(f)).map(fixedRow)}
        </div>
        <div className="add-title">ADICIONAR CAMADA</div>
        <div className="add-grid">
          {ADD_ORDER.map((n) => adds.find((a) => a[0] === n)).filter((a): a is [string, IconName, () => void] => !!a).map(([label, icon, fn]) => <button key={label} className={'add-btn' + (label === 'Grupo' ? ' wide' : '')} onClick={fn}><Icon name={icon} /> {label}</button>)}
        </div>
      </>
    )
  }

  const partNumBlock = (part: 'chest' | 'leg'): JSX.Element => {
    const sp = partSpec(kit, part)
    const ch = (patch: Partial<PartNumSpec>): void => up((k) => ({ ...k, numbers: { ...k.numbers, [part]: { ...partSpec(k, part), ...patch } } }))
    return (
      <div className="part-num">
        <Row label="Aspeto"><Select value={sp.mode} options={[['same', 'Igual aos das costas'], ['recolor', 'Recolorir'], ['font', 'Fonte do PC'], ['file', 'Ficheiro / do jogo']]} onChange={(mode) => ch({ mode })} /></Row>
        {sp.mode === 'file' && (
          <div className="btn-row">
            <button className="btn small" onClick={() => setFly({ kind: 'numberSet', target: part })}>Escolher do jogo ▸</button>
            <button className="btn small" onClick={async () => {
              const f = await window.kc.pickFiles([{ name: 'Texturas', extensions: ['ftex', 'dds', 'png'] }])
              if (!f[0]) return
              const img = await window.kc.decodeImageFile(f[0])
              if (!img) return notify('err', 'Não consegui ler o ficheiro')
              const a: Asset = { id: uid(), name: f[0].split(/[\\/]/).pop()!, dataUrl: await canvasToDataUrl(rgbaToCanvas(img)) }
              addAsset(a); ch({ asset: a.id })
            }}>{sp.asset ? 'Ficheiro ✓' : 'Importar FTEX'}</button>
          </div>
        )}
        {sp.mode === 'font' && <Row label="Fonte"><FontSelect value={sp.font} onChange={(font) => ch({ font })} /></Row>}
        {sp.mode === 'file' && <label className="check"><input type="checkbox" checked={!!sp.recolor} onChange={(e) => ch({ recolor: e.target.checked })} /> Recolorir estes números</label>}
        {(sp.mode === 'font' || sp.mode === 'recolor' || (sp.mode === 'file' && sp.recolor)) && <Row label="Cor"><ColorInput value={sp.fill} onChange={(fill) => ch({ fill })} /></Row>}
        {sp.mode !== 'same' && (
          <>
            <Row label="Contorno"><ColorInput value={sp.outline} onChange={(outline) => ch({ outline })} /></Row>
            <Row label="Espessura contorno"><Slider value={sp.outlineWidth} min={0} max={12} onChange={(outlineWidth) => ch({ outlineWidth })} /></Row>
          </>
        )}
      </div>
    )
  }

  const patternBlock = (part: 'sleeves' | 'shorts' | 'socks', field: 'sleevePattern' | 'shortsPattern' | 'socksPattern', label: string): JSX.Element => {
    const p = kit[field] as PatternSpec
    return (
      <div className="pattern-row">
        <ThumbButton label={`${label}: ${PATTERN_LISTS[part].find((x) => x[0] === p.id)?.[1] ?? ''}`} onClick={() => setFly({ kind: 'pattern', part })}
          load={() => kitPreview3d({ ...stripLogos(kit), layers: [], [field]: p }, assets, part === 'sleeves' ? 'torso' : part, 'pb:' + field + JSON.stringify([p, kit.colors, kit.fills, kit.config.Collar]))} deps={[JSON.stringify(p), JSON.stringify(kit.colors), JSON.stringify(kit.fills)]} />
        {p.id !== 'none' && (
          <>
            <FillRow label="Cor do design" value={p.fill ?? solid(p.color)} onChange={(f) => up((k) => ({ ...k, [field]: { ...p, fill: f.kind === 'solid' ? undefined : f, color: fillMain(f, p.color) } }))} />
            <Row label="Quantidade"><Slider value={p.count} min={1} max={20} onChange={(count) => up((k) => ({ ...k, [field]: { ...p, count } }))} /></Row>
            <Row label="Largura"><Slider value={p.width} min={5} max={95} onChange={(width) => up((k) => ({ ...k, [field]: { ...p, width } }))} /></Row>
            <Row label="Rotação"><Slider value={p.angle ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(angle) => up((k) => ({ ...k, [field]: { ...p, angle: angle || undefined } }))} /></Row>
            <Row label="Deslocamento (x)"><Slider value={p.dx ?? 0} min={-400} max={400} snaps={[0]} onChange={(dx) => up((k) => ({ ...k, [field]: { ...p, dx: dx || undefined } }))} /></Row>
            <Row label="Deslocamento (y)"><Slider value={p.dy ?? 0} min={-400} max={400} snaps={[0]} onChange={(dy) => up((k) => ({ ...k, [field]: { ...p, dy: dy || undefined } }))} /></Row>
            {part === 'sleeves' && <Row label="Curvar"><Slider value={p.warp ?? 0} min={-150} max={150} snaps={[0]} onChange={(warp) => up((k) => ({ ...k, [field]: { ...p, warp: warp || undefined } }))} /></Row>}
            {part !== 'sleeves' && <StitchEditor value={p.stitch} onChange={(stitch) => up((k) => ({ ...k, [field]: { ...p, stitch } }))} />}
            {part !== 'sleeves' && <TextureRow label="Tecido" list={LAYER_FABRICS} value={p.fabric} onChange={(fabric) => up((k) => ({ ...k, [field]: { ...p, fabric } }))} />}
            {part === 'sleeves' && p.id === 'three' && <Row label="Espaçamento"><Slider value={p.gap ?? Math.round(((80 * Math.max(5, p.width) / 100) / 0.4) * 0.45 * 0.9)} min={0} max={120} onChange={(gap) => up((k) => ({ ...k, [field]: { ...p, gap } }))} /></Row>}
          </>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------- flyout content
  let flyTitle = ''
  let flyExtra: JSX.Element | undefined
  let items: PreviewItem[] = []
  let value: string | undefined
  let pick: (id: string) => void = () => undefined
  const flyLayer = fly && 'layer' in fly ? kit.layers.find((l) => l.id === fly.layer) : undefined
  if (fly?.kind === 'template') {
    flyTitle = 'Templates completos'
    items = TEMPLATES.map((t) => ({ id: t.id, label: t.name, load: () => templatePreview(kit, t.id, assets) }))
    value = kit.templateId
    pick = (id) => up((k) => ({ ...applyTemplate(k, id, k.colors.shirt, k.colors.shirt2, k.colors.shirt3), logos: k.logos, numbers: k.numbers, fabrics: k.fabrics, armband: k.armband }))
  } else if (fly?.kind === 'pattern') {
    const part = fly.part
    const field = part === 'sleeves' ? 'sleevePattern' : part === 'shorts' ? 'shortsPattern' : 'socksPattern'
    flyTitle = { sleeves: 'Design das mangas', shorts: 'Design dos calções', socks: 'Design das meias' }[part]
    items = PATTERN_LISTS[part].map(([id, label]) => ({ id, label, load: () => kitPreview3d({ ...stripLogos(pvKit), [field]: { ...kit[field], id, color: PV[0], fill: undefined } }, assets, part === 'sleeves' ? 'torso' : part, 'pl:' + field + id + JSON.stringify([kit[field], PV, PVB])) }))
    value = kit[field].id
    pick = (id) => up((k) => ({ ...k, [field]: { ...k[field], id } }))
  } else if (fly?.kind === 'layerPattern' && flyLayer) {
    flyTitle = 'Designs'
    items = TORSO_PATTERNS.filter((t) => t[0] !== 'none').map(([id, label]) => ({ id, label, load: () => patternPreview({ ...kit, layers: [], torso: { id: 'none', color: flyLayer.color, count: flyLayer.count ?? 3, width: flyLayer.width ?? 40 } }, 'torso', id, assets) }))
    value = flyLayer.pattern
    pick = (id) => setLayer(flyLayer.id, (l) => ({ ...l, pattern: id }))
  } else if (fly?.kind === 'texture' && flyLayer) {
    flyTitle = 'Texturas gráficas'
    items = TEXTURES.map(([id, label]) => ({ id, label, load: () => texturePreview(id, fillMain(flyLayer.fill, flyLayer.color), kit.colors.shirt, flyLayer.scale) }))
    value = flyLayer.pattern
    pick = (id) => setLayer(flyLayer.id, (l) => ({ ...l, pattern: id }))
  } else if (fly?.kind === 'shape' && flyLayer) {
    flyTitle = 'Formas'
    items = SHAPES.map(([id, label]) => ({ id, label, load: () => shapePreview(kit, flyLayer, id, assets) }))
    value = flyLayer.shape
    pick = (id) => setLayer(flyLayer.id, (l) => ({ ...l, shape: id as OverlayLayer['shape'] }))
  } else if (fly?.kind === 'collar') {
    const every = collars.length ? collars : Array.from({ length: 130 }, (_, i) => i + 1)
    // the most distinct models first; every model the game has on request
    const MAIN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 20, 30, 41, 49, 59, 63, 66, 74, 90, 100, 107]
    const list = allCollars ? every : MAIN.filter((n) => every.includes(n))
    flyTitle = allCollars ? `Todas as golas (${list.length})` : `Golas principais (${list.length} de ${every.length})`
    items = list.map((n) => ({ id: String(n), label: `Gola ${n}`, load: () => collarPreview(n, smallTex, collarKey) }))
    value = String(kit.config.Collar ?? 66)
    flyExtra = <button className="btn small" onClick={() => setAllCollars(!allCollars)}>{allCollars ? 'Só as principais' : 'Ver todas'}</button>
    pick = (id) => up((k) => ({ ...k, config: { ...k.config, Collar: Number(id), WinterCollar: Number(id) } }))
  } else if (fly?.kind === 'shirtModel') {
    flyTitle = 'Modelo da camisola'
    items = SHIRT_MODELS.map(([n, label]) => ({ id: String(n), label, load: () => shirtModelPreview(n, fillMain(F.shirt, kit.colors.shirt)) }))
    value = String(kit.config.ShirtModel ?? 144)
    pick = (id) => setCfg('ShirtModel', Number(id))
  } else if (fly?.kind === 'shortsModel') {
    flyTitle = 'Modelo dos calções'
    items = Array.from({ length: 15 }, (_, i) => i + 1).map((n) => ({ id: String(n), label: `Calções ${n}`, load: () => shortsPreview(n, smallTex, shortsKey) }))
    value = String(kit.config.ShortsModel ?? 1)
    pick = (id) => setCfg('ShortsModel', Number(id))
  } else if (fly?.kind === 'fabric') {
    const fid = fly.id
    const fab = kit.fabrics?.find((f) => f.id === fid)
    flyTitle = 'Texturas de tecido'
    items = FABRICS.map(([id, label]) => ({ id, label, load: () => fabricPreview(id, fillMain(F.shirt, kit.colors.shirt), fab?.opacity ?? 0.3, id === 'seams' ? 'multiply' : fab?.blend ?? 'soft-light', fab?.scale ?? 100) }))
    value = fab?.source
    pick = (id) => up((k) => ({ ...k, fabrics: (k.fabrics ?? []).map((f) => (f.id === fid ? { ...f, source: id, blend: id === 'seams' ? 'multiply' : f.blend === 'multiply' ? 'soft-light' : f.blend } : f)) }))
  } else if (fly?.kind === 'numberSet') {
    const target = fly.target
    const withKits = teams.filter((t) => t.slots.some((sl) => sl.slot === 'p1'))
    flyTitle = { both: 'Números e letras', numbers: 'Números', name: 'Letras do nome', chest: 'Número do peito', leg: 'Número dos calções' }[target] + ` — de qualquer equipa do jogo (${numberSets.length + withKits.length})`
    items = [
      ...numberSets.map((s) => ({
        id: s.id, label: s.label, load: async () => {
          const b = s.back ? await window.kc.decodeImageFile(s.back) : null
          const n = s.name ? await window.kc.decodeImageFile(s.name) : null
          return numberSetPreview(s.id, b ? rgbaToCanvas(b) : null, n ? rgbaToCanvas(n) : null, findBoxes('back', b), findBoxes('name', n))
        }
      })),
      ...withKits.map((t) => ({
        id: 'team:' + t.id, label: t.name, load: async () => {
          const b = await window.kc.readKitTexture(t.id, 'p1', 'back', 0).catch(() => null)
          const n = await window.kc.readKitTexture(t.id, 'p1', 'name', 0).catch(() => null)
          return numberSetPreview('team:' + t.id, b ? rgbaToCanvas(b) : null, n ? rgbaToCanvas(n) : null, findBoxes('back', b), findBoxes('name', n))
        }
      }))
    ]
    // search + favourites (★, kept in KitCreatorData/settings.json)
    const q = nsQ.trim().toLowerCase()
    items = items
      .filter((it) => (!q || it.label.toLowerCase().includes(q) || it.id.toLowerCase().includes(q)) && (!favOnly || favs.includes(it.id)))
      .map((it) => ({ ...it, starred: favs.includes(it.id), onStar: () => toggleFav(it.id) }))
      .sort((a, b) => Number(b.starred) - Number(a.starred))
    flyExtra = (
      <>
        <input className="fly-search" placeholder="Pesquisar…" value={nsQ} onChange={(e) => setNsQ(e.target.value)} />
        <button className={'btn small' + (favOnly ? ' primary' : '')} title="Mostrar só os favoritos" onClick={() => setFavOnly(!favOnly)}>★</button>
      </>
    )
    pick = (id) => { useNumberSet(id, target) }
  }

  // ---------------------------------------------------------------- tabs
  const clean = kit.base.clean ?? (kit.base.cleanLogos ? CLEAN_AREAS.map((c) => c[0]) : [])
  const logos = kit.logos
  type ListKey = 'sponsors' | 'backSponsors' | 'sleeveBadges' | 'shortsSponsors' | 'socksSponsors'
  // "add to the other kits": a sponsor / badge goes into the same list of every other kit of the team (not twice)
  const toOtherKits = (key: ListKey, lp: LogoPlacement): void => {
    if (!lp.assetId) return notify('err', 'Escolhe primeiro a imagem deste logo')
    let n = 0
    setProject((p) => ({ ...p, kits: p.kits.map((k) => {
      if (k.slot === kit.slot) return k
      const list = k.logos[key] ?? []
      if (list.some((x) => x.assetId === lp.assetId)) return k
      n++
      return { ...k, logos: { ...k.logos, [key]: [...list, JSON.parse(JSON.stringify(lp))] } }
    }) }))
    setTimeout(() => notify('ok', n ? `Adicionado a ${n} kit(s)` : 'Os outros kits já o têm'), 0)
  }
  const toOthersBtn = (key: ListKey, lp: LogoPlacement): JSX.Element => <button className="btn tiny" title="Põe este logo também nos outros equipamentos da equipa (os que já o têm ficam como estão)" onClick={() => toOtherKits(key, lp)}>Adicionar aos outros kits</button>
  // right-click on a logo row: copy its look, paste over another logo, duplicate (lists), add to the other kits
  const logoMenu = (lp: LogoPlacement, set: (n: LogoPlacement) => void, key?: ListKey, i?: number) => ({
    onContextMenu: (e: React.MouseEvent): void => { e.preventDefault(); e.stopPropagation(); setLogoCtx({ x: e.clientX, y: e.clientY, lp, set, key, i }) }
  })
  const listOf = (key: ListKey): LogoPlacement[] => logos[key] ?? []
  const setList = (key: ListKey, list: LogoPlacement[]): void => setLogos((l) => ({ ...l, [key]: list }))

  const originTab = (
    <>
      {licence && <div className="warn-box" data-notr>⚠ {licence}</div>}
      <Section group={tab} title="Cores do kit" onActivate={() => go('front')}>
        <div className="muted small">Todas as cores deste equipamento. Muda uma e todas as camadas, designs, gola e punhos com essa cor mudam também — para fazer variantes do mesmo kit noutras cores.</div>
        <div className="kit-palette">
          {kitPalette.map((c) => <Swatch key={c} value={c} title={c} className="swatch-btn kp-sw" onChange={(v) => { if (v.toLowerCase() !== c) swapColor(c, v) }} />)}
        </div>
      </Section>
      <Section group={tab} title="Origem" onActivate={() => go('front')}>
        <Row label="Origem">
          <Select value={kit.base.kind} options={[['template', 'Criado aqui (camadas)'], ['image', 'Imagem / kit do jogo']]} onChange={(kind) => up((k) => ({ ...k, base: { ...k.base, kind } }))} />
        </Row>
        <div className="btn-row">
          <button className="btn small" onClick={async () => {
            const img = await window.kc.readKitTexture(project.teamId, kit.slot, 'kit', 0)
            if (!img) return notify('err', 'Esta equipa não tem este kit no jogo')
            const a: Asset = { id: uid(), name: 'kit do jogo ' + kit.slot, dataUrl: await canvasToDataUrl(rgbaToCanvas(img)) }
            addAsset(a)
            up((k) => ({ ...k, base: { ...k.base, kind: 'image', imageAssetId: a.id, recolor: [] } }))
          }}>Kit atual do jogo</button>
          <button className="btn small" onClick={async () => {
            const f = await window.kc.pickFiles([{ name: 'Kits', extensions: ['png', 'dds', 'ftex', 'jpg', 'webp'] }])
            if (!f[0]) return
            try {
              const a = await assetFromFile(f[0])
              addAsset(a)
              up((k) => ({ ...k, base: { ...k.base, kind: 'image', imageAssetId: a.id, recolor: [] } }))
            } catch (e) { notify('err', String(e)) }
          }}>Importar…</button>
        </div>
        <div className="btn-row">
          <span className="muted small">Copiar de:</span>
          {project.kits.filter((k) => k.slot !== kit.slot).map((k) => (
            <span key={k.slot}>
              <button className="btn small ghost" onClick={() => copyFrom(k.slot, false)}>{SLOT_LABEL[k.slot] ?? k.slot}</button>
              <button className="btn small ghost" title="cores invertidas" onClick={() => copyFrom(k.slot, true)}>⇄</button>
            </span>
          ))}
          <button className="btn small ghost" onClick={() => up((k) => ({ ...defaultDesign(k.slot), logos: k.logos }))}>Começar do zero</button>
        </div>
        <div className="btn-row">
          <span className="muted small">Templates guardados:</span>
          <button className="btn small" title="Guarda este equipamento (camadas, cores, gola, punhos, marca) como template, sem o emblema nem os patrocinadores" onClick={async () => {
            const name = prompt('Nome do template', `${project.teamName} ${SLOT_LABEL[kit.slot] ?? kit.slot}`)
            if (!name) return
            // without the crest and the sponsors; the brand stays
            const L = kit.logos
            const off = (lp: LogoPlacement): LogoPlacement => ({ ...lp, assetId: undefined, enabled: false })
            const logos: Logos = { ...L, crest: off(L.crest), shortsCrest: off(L.shortsCrest), sponsor: off(L.sponsor), backSponsor: off(L.backSponsor), sponsors: [], backSponsors: [], sleeveBadges: (L.sleeveBadges ?? []).filter((b) => b.brand), shortsSponsor: L.shortsSponsor ? off(L.shortsSponsor) : undefined, shortsSponsors: [] }
            const t = { ...kit, logos, armband: kit.armband ? { ...kit.armband, crest: false } : kit.armband }
            const used = kitAssetIds(t)
            const id = uid() + Date.now().toString(36)
            await window.kc.saveUserTemplate(id, JSON.stringify({ id, name, date: new Date().toISOString(), kit: t, assets: Object.fromEntries([...used].filter((a) => assets[a]).map((a) => [a, assets[a]])) }))
            notify('ok', 'Template guardado: ' + name)
          }}>Guardar como template…</button>
          <button className="btn small" onClick={loadUserTpls}>Carregar template ▸</button>
        </div>
        <div className="btn-row">
          <span className="muted small">Partilhar:</span>
          <button className="btn small" title="Grava este equipamento com tudo o que usa (camadas, cores, números, patrocinadores, emblema, marca e imagens) num único ficheiro .kitlab" onClick={async () => {
            try {
              if (!localStorage.getItem('kc.kitlabWarned')) {
                if (!confirm('O ficheiro .kitlab leva o emblema, a marca e todas as imagens deste kit. Logótipos e marcas oficiais podem ter direitos de autor: partilha-o só se tiveres esse direito. Exportar?')) return
                localStorage.setItem('kc.kitlabWarned', '1')
              }
            } catch { /* no storage: ask every time */ if (!confirm('O ficheiro .kitlab leva o emblema, a marca e todas as imagens deste kit. Logótipos e marcas oficiais podem ter direitos de autor: partilha-o só se tiveres esse direito. Exportar?')) return }
            try {
              const r = await exportKitlab(project, kit, await window.kc.getVersion())
              if (r.path) notify('ok', 'Kit exportado: ' + r.path)
            } catch (e) { notify('err', String((e as Error).message ?? e)) }
          }}>Exportar .kitlab…</button>
          <button className="btn small" title="Abre um ficheiro .kitlab e põe o kit num equipamento desta equipa" onClick={async () => {
            try {
              const [p] = await window.kc.pickFiles([{ name: 'PES KitLab', extensions: ['kitlab'] }])
              if (p) setKitlabFile(await parseKitlab(p))
            } catch (e) { notify('err', String((e as Error).message ?? e)) }
          }}>Importar .kitlab…</button>
        </div>
      </Section>
      {kit.base.kind === 'template' && (
        <Section group={tab} title="Gerador de padrões">
          <PatternGenPanel kit={kit} assets={assets} onApply={(tpl, c1, c2, c3) => up((k) => applyTpl(k, tpl, c1, c2, c3))} />
        </Section>
      )}
      <Section group={tab} title="Analisar textura">
        <div className="muted small">Abre uma textura de kit (PNG ou FTEX, ou a do jogo) e separa-a em camadas de cor que podes recolorir, esconder e reordenar, com os emblemas e desenhos que não são cores lisas à parte.</div>
        <div className="btn-row"><button className="btn small" onClick={() => setAnalyzeOpen(true)}>Analisar textura…</button></div>
      </Section>
      <Section group={tab} title="Imagem de referência">
        <ReferencePanel />
      </Section>
      <Section group={tab} title="Copiar para todos os kits">
        <div className="muted small">Copia deste kit ({SLOT_LABEL[kit.slot] ?? kit.slot}) para os outros equipamentos da equipa. Os logos que um kit já tem ficam como estão; só se acrescenta o que falta.</div>
        <label className="check"><input type="checkbox" checked={copyColors} onChange={(e) => setCopyColors(e.target.checked)} /> Copiar também as cores</label>
        <div className="btn-row">
          <button className="btn small" onClick={() => {
            const others = project.kits.filter((k) => k.slot !== kit.slot).map((k) => SLOT_LABEL[k.slot] ?? k.slot).join(', ')
            if (!confirm(`Copiar os emblemas, marcas e patrocínios deste kit para ${others}?` + (copyColors ? ' (com as cores)' : ' (sem as cores)'))) return
            setProject((p) => ({ ...p, kits: p.kits.map((k) => (k.slot === kit.slot ? k : { ...k, logos: mergeLogos(k.logos, kit.logos, copyColors) })) }))
          }}>Logos e patrocínios → todos</button>
          <button className="btn small" onClick={() => {
            const others = project.kits.filter((k) => k.slot !== kit.slot).map((k) => SLOT_LABEL[k.slot] ?? k.slot).join(', ')
            if (!confirm(`Copiar os números, nomes, fontes e posições deste kit para ${others}?` + (copyColors ? ' (com as cores)' : ' (sem as cores)'))) return
            const keys = ['Name', 'NameShape', 'NameY', 'NameSize', 'NameStretch', 'BackNumberY', 'BackNumberSize', 'BackNumberSpacing', 'BackNumberType', 'ChestNumberX', 'ChestNumberY', 'ChestNumberSize', 'ShortsNumberSide', 'ShortsNumberX', 'ShortsNumberY', 'ShortsNumberSize']
            setProject((p) => ({ ...p, kits: p.kits.map((k) => (k.slot === kit.slot ? k : { ...k, numbers: copyNumbers(k.numbers, kit.numbers, copyColors), config: { ...k.config, ...Object.fromEntries(keys.filter((x) => kit.config[x] !== undefined).map((x) => [x, kit.config[x]])) } })) }))
          }}>Números, nomes e fontes → todos</button>
        </div>
      </Section>
      {kit.base.kind === 'template' && (
        <Section group={tab} title="Template completo">
          <div className="muted small">Aplica um conjunto pronto (design da camisola, mangas, calções e meias) com as cores atuais. Depois afinas tudo nas outras abas.</div>
          <ThumbButton label={TEMPLATES.find((t) => t.id === kit.templateId)?.name ?? 'Escolher template'} onClick={() => setFly({ kind: 'template' })}
            load={() => templatePreview(kit, kit.templateId ?? 'classic', assets)} deps={[kit.templateId, kit.colors.shirt, kit.colors.shirt2, kit.colors.shirt3]} />
        </Section>
      )}
    </>
  )

  const ab = kit.armband ?? { show: true, fill: solid(kit.colors.armband), text: 'C', textColor: '#111111', font: 'Arial Black' }
  // "Aplicar a todos os kits": the armband is the same in every kit of the team (changes go to all of them)
  const setAb = (patch: Partial<typeof ab>): void => {
    const next = { ...ab, ...patch }
    if (next.all) setProject((p) => ({ ...p, kits: p.kits.map((k) => ({ ...k, armband: JSON.parse(JSON.stringify(next)) })) }))
    else up((k) => ({ ...k, armband: next }))
  }
  const armbandBody = (
    <>
      <label className="check" title="As alterações à braçadeira passam a valer para todos os equipamentos da equipa"><input type="checkbox" checked={!!ab.all} onChange={(e) => {
        if (e.target.checked) setAb({ all: true })
        else setProject((p) => ({ ...p, kits: p.kits.map((k) => (k.armband ? { ...k, armband: { ...k.armband, all: undefined } } : k)) }))
      }} /> Aplicar a todos os kits</label>
      <label className="check"><input type="checkbox" checked={ab.show} onChange={(e) => setAb({ show: e.target.checked })} /> Mostrar no 3D</label>
      <FillRow label="Cor" value={ab.fill} onChange={(fill) => setAb({ fill })} />
      <Row label="Texto"><input value={ab.text} maxLength={10} onChange={(e) => setAb({ text: e.target.value })} /></Row>
      <Row label="Cor do texto"><ColorInput value={ab.textColor} onChange={(textColor) => setAb({ textColor })} /></Row>
      <Row label="Fonte"><FontSelect value={ab.font} onChange={(font) => setAb({ font })} /></Row>
      <Row label="Tamanho da fonte"><Slider value={ab.textSize ?? 100} min={30} max={160} snaps={[100]} onChange={(textSize) => setAb({ textSize })} /></Row>
      <label className="check"><input type="checkbox" checked={!!ab.crest} onChange={(e) => setAb({ crest: e.target.checked })} /> Emblema do clube na braçadeira</label>
      {ab.crest && <Row label="Tamanho do emblema"><Slider value={ab.crestSize ?? 100} min={40} max={128} onChange={(crestSize) => setAb({ crestSize })} /></Row>}
      <Row label="Imagem/textura">
        {ab.image && assets[ab.image] && <img className="logo-thumb" src={assets[ab.image].dataUrl} alt="" />}
        <AssetPicker label={ab.image ? 'Trocar' : 'Escolher'} onPick={async (a) => {
          addAsset(a)
          let sq = false
          try { const im = await loadAsset(a); sq = Math.abs(imgW(im) - imgH(im)) < 4 && imgW(im) >= 512 } catch { /* keep the mode */ }
          setAb({ image: a.id, imageMode: sq ? 'uv' : 'stretch', imageSize: 100, imageDx: 0, imageDy: 0 })
        }} />
        {ab.image && <button className="btn tiny ghost" title="Tirar a imagem" onClick={() => setAb({ image: undefined, imageMode: undefined })}>✕</button>}
      </Row>
      {ab.image && (
        <>
          <Row label="Modo"><Select value={ab.imageMode ?? 'stretch'} options={[['stretch', 'Ocupar a braçadeira toda'], ['free', 'Imagem solta (proporção mantida)'], ['uv', 'Textura completa (só a braçadeira)']]} onChange={(imageMode) => setAb({ imageMode: imageMode as 'stretch' | 'free' | 'uv' })} /></Row>
          {(ab.imageMode ?? 'stretch') !== 'uv' && (
            <>
              <Row label="Tamanho"><Slider value={ab.imageSize ?? 100} min={20} max={400} snaps={[100]} onChange={(imageSize) => setAb({ imageSize })} /></Row>
              <Row label="Posição X"><Slider value={ab.imageDx ?? 0} min={-256} max={256} snaps={[0]} onChange={(imageDx) => setAb({ imageDx })} /></Row>
              <Row label="Posição Y"><Slider value={ab.imageDy ?? 0} min={-64} max={64} snaps={[0]} onChange={(imageDy) => setAb({ imageDy })} /></Row>
            </>
          )}
        </>
      )}
      <Row label="Padrão"><Select value={ab.pattern ?? 'none'} options={[['none', 'Liso'], ['stripes', 'Riscas'], ['hoops', 'Listas nas bordas'], ['check', 'Quadrados'], ['diagonal', 'Diagonais']]} onChange={(pattern) => setAb({ pattern })} /></Row>
      {ab.pattern && ab.pattern !== 'none' && (
        <>
          <Row label="Cor do padrão"><ColorInput value={ab.patternColor ?? '#ffffff'} onChange={(patternColor) => setAb({ patternColor })} /></Row>
          <Row label="Tamanho"><Slider value={ab.patternScale ?? 100} min={20} max={400} onChange={(patternScale) => setAb({ patternScale })} /></Row>
          <Row label="Espessura"><Slider value={ab.patternWidth ?? 100} min={10} max={400} onChange={(patternWidth) => setAb({ patternWidth })} /></Row>
          <Row label="Rotação"><Slider value={ab.patternAngle ?? 0} min={-180} max={180} snaps={ROT_SNAPS} onChange={(patternAngle) => setAb({ patternAngle })} /></Row>
          <Row label="Deslocamento"><Slider value={ab.patternDx ?? 0} min={-256} max={256} snaps={[0]} onChange={(patternDx) => setAb({ patternDx })} /></Row>
        </>
      )}
    </>
  )
  const armbandTab = <Section group={tab} title="Braçadeira de capitão" onActivate={() => go('sleeve')}>{armbandBody}</Section>
  const baseBody = (<>
        <ThumbButton label={SHIRT_MODELS.find((m) => m[0] === cfg('ShirtModel', 144))?.[1] ?? 'Modelo'} onClick={() => setFly({ kind: 'shirtModel' })}
          load={() => shirtModelPreview(cfg('ShirtModel', 144), fillMain(F.shirt, kit.colors.shirt))} deps={[kit.config.ShirtModel, F.shirt, kit.colors.shirt]} />
        <Row label="Justa ao corpo"><Select value={String(cfg('TightKit', 1))} options={[['1', 'Sim'], ['0', 'Não']]} onChange={(v) => setCfg('TightKit', Number(v))} /></Row>
        <Row label="Mangas compridas"><Select value={String(cfg('LongSleevesType', 62))} options={[['62', 'Normal + segunda pele'], ['187', 'Só segunda pele']]} onChange={(v) => setCfg('LongSleevesType', Number(v))} /></Row>
        {kit.base.kind === 'template' ? <FillRow label="Cor base" value={F.shirt ?? solid(kit.colors.shirt)} onChange={(f) => setFill('shirt', f)} /> : recolorRows('shirt')}
        <Row label="Cor secundária"><ColorInput value={kit.colors.shirt2} onChange={(v) => up((k) => ({ ...k, colors: { ...k.colors, shirt2: v } }))} /></Row>
      </>)
  const collarBody = (<>
        <ThumbButton label={`Gola ${kit.config.Collar ?? 66}`} onClick={() => setFly({ kind: 'collar' })}
          load={() => collarPreview(cfg('Collar', 66), smallTex, collarKey)} deps={[kit.config.Collar, collarKey, !!smallTex]} />
        {kit.base.kind === 'template' ? (() => {
          const cs = kit.collar ?? { style: 'solid' as const, c1: kit.colors.collar, c2: '#ffffff', c3: '#000000' }
          const setC = (patch: Partial<typeof cs>): void => up((k) => ({ ...k, collar: { ...cs, ...k.collar, ...patch } }))
          return (
            <>
              <Row label="Cor"><ColorInput value={cs.c1} onChange={(c1) => { setC({ c1, style: 'solid' }); up((k) => ({ ...k, colors: { ...k.colors, collar: c1 } })) }} /></Row>
              <div className="muted small">Os designs da gola (riscas, V, rebordos…) são camadas: Adicionar camada → Designs → Gola.</div>
            </>
          )
        })() : <div className="muted small">Num kit importado as cores da gola vêm da imagem (usa as cores detetadas em "Modelo").</div>}
      </>)
  const rg = kit.raglan
  const setRg = (patch: Partial<NonNullable<KitDesign['raglan']>>): void => up((k) => ({ ...k, raglan: { ...k.raglan, ...patch } }))
  const sleevesBody = (<>
        {kit.base.kind === 'template' && <FillRow label="Cor" value={F.sleeves ?? solid(kit.colors.sleeves)} onChange={(f) => setFill('sleeves', f)} />}
        {kit.base.kind === 'template' && <Row label="Mangas"><Select value={rg ? 'with' : 'without'} options={[['without', 'Mangas sem ombros'], ['with', 'Mangas com ombros']]} onChange={(v) => up((k) => ({ ...k, raglan: v === 'with' ? { ...RAGLAN_DEFAULT } : undefined }))} /></Row>}
        {rg && (
          <>
            <Row label="Curva"><Slider value={raglanBend(rg)} min={-140} max={140} snaps={[0]} onChange={(bend) => setRg({ bend, curve: undefined })} /></Row>
            <Row label="Ângulo"><Slider value={rg.sharp ?? 0} min={0} max={100} onChange={(sharp) => setRg({ sharp: sharp || undefined })} /></Row>
            <Row label="Braço X"><Slider value={rg.armX ?? 0} min={-100} max={100} snaps={[0]} onChange={(armX) => setRg({ armX: armX || undefined })} /></Row>
            <Row label="Braço Y"><Slider value={rg.arm ?? 0} min={-200} max={200} snaps={[0]} onChange={(arm) => setRg({ arm: arm || undefined })} /></Row>
            <Row label="Pescoço (Frente) X"><Slider value={rg.neck ?? 0} min={-150} max={400} snaps={[0]} onChange={(neck) => setRg({ neck: neck || undefined })} /></Row>
            <Row label="Pescoço (Frente) Y"><Slider value={rg.down ?? 0} min={0} max={800} onChange={(down) => setRg({ down: down || undefined })} /></Row>
            <Row label="Pescoço (Costas) X"><Slider value={rg.neckB ?? rg.neck ?? 0} min={-150} max={400} snaps={[0]} onChange={(neckB) => setRg({ neckB })} /></Row>
            <Row label="Pescoço (Costas) Y"><Slider value={rg.downB ?? rg.down ?? 0} min={0} max={800} onChange={(downB) => setRg({ downB })} /></Row>
          </>
        )}
        {kit.base.kind === 'template' && <StitchEditor value={kit.sleeveStitch} onChange={(sleeveStitch) => up((k) => ({ ...k, sleeveStitch }))} />}
        {kit.base.kind === 'template' && (rg || kit.sleevePattern.id !== 'none') && (
          <>
            <Row label="Máscara">
              <Select value={kit.sleevePattern.maskLayer ?? ''} options={[['', '—'], ...kit.layers.filter((x) => x.kind !== 'image' && (x.part === 'torso' || x.part === 'shirt')).map((x) => [x.id, layerLabel(x)] as [string, string])]} onChange={(maskLayer) => up((k) => ({ ...k, sleevePattern: { ...k.sleevePattern, maskLayer: maskLayer || undefined } }))} />
              {kit.sleevePattern.maskLayer && <label className="check"><input type="checkbox" checked={!!kit.sleevePattern.maskInvert} onChange={(e) => up((k) => ({ ...k, sleevePattern: { ...k.sleevePattern, maskInvert: e.target.checked || undefined } }))} /> Inverter</label>}
            </Row>
            <div className="muted small">{kit.sleeveAfter === undefined ? 'Arrasta a linha "Mangas" para a pôr entre as camadas.' : kit.sleeveAfter === '' ? 'Por baixo de todas as camadas.' : 'Por cima de: ' + layerLabel(kit.layers.find((x) => x.id === kit.sleeveAfter) ?? kit.layers[0])}
              {kit.sleeveAfter !== undefined && <button className="btn tiny ghost" onClick={() => up((k) => ({ ...k, sleeveAfter: undefined }))}>Repor</button>}</div>
          </>
        )}
        {kit.base.kind === 'template' && kit.sleevePattern.id !== 'none' && (
          <div className="muted small">Este kit tem um design antigo nas mangas ({PATTERN_LISTS.sleeves.find((x) => x[0] === kit.sleevePattern.id)?.[1]}). Para riscas nas mangas usa uma camada de Designs com "Mostrar em: Mangas".
            <button className="btn tiny ghost" onClick={() => up((k) => ({ ...k, sleevePattern: { ...k.sleevePattern, id: 'none' } }))}>Remover</button></div>
        )}
      </>)
  const cuffsBody = (<>
        {kit.base.kind === 'template' && (
          <>
                        <ThumbButton label={'Punho · ' + (CUFF_STYLES.find((c) => c[0] === kit.cuffs?.style)?.[1] ?? '')} onClick={() => setTexPick({ kind: 'graphics', part: 'torso', category: 'Punhos' })}
              load={() => kitPreview3d({ ...stripLogos(kit), layers: [] }, assets, 'torso', 'cuff:' + JSON.stringify([kit.cuffs, kit.colors, kit.fills]))} deps={[JSON.stringify(kit.cuffs), kit.colors.shirt]} />
            <button className="btn small ghost" onClick={() => up((k) => ({ ...k, cuffs: { ...k.cuffs!, style: 'none' } }))}>Tirar os punhos</button>
            {kit.cuffs?.style !== 'none' && (
              <>
                <Row label="Cor"><ColorInput value={kit.cuffs?.c1 ?? kit.colors.cuffs} onChange={(c1) => up((k) => ({ ...k, cuffs: { ...k.cuffs!, c1 }, colors: { ...k.colors, cuffs: c1 } }))} /></Row>
                {kit.cuffs?.style !== 'solid' && <Row label="Cor 2"><ColorInput value={kit.cuffs?.c2 ?? '#ffffff'} onChange={(c2) => up((k) => ({ ...k, cuffs: { ...k.cuffs!, c2 } }))} /></Row>}
                <Row label="Largura do punho"><Slider value={kit.cuffs?.width ?? 60} min={10} max={160} onChange={(width) => up((k) => ({ ...k, cuffs: { ...k.cuffs!, width } }))} /></Row>
                {kit.cuffs && kit.cuffs.style !== 'solid' && (() => {
                  const cf = kit.cuffs, w = cf.width, n = cf.style === 'stripes3' ? 3 : 2
                  const sw = cf.stripeW ?? (cf.style === 'tipped' ? 10 : n === 3 ? 7 : 8)
                  const setC = (patch: Partial<typeof cf>): void => up((k) => ({ ...k, cuffs: { ...k.cuffs!, ...patch } }))
                  return (
                    <>
                      <Row label={cf.style === 'tipped' ? 'Largura do rebordo' : 'Largura de cada risca'}><Slider value={sw} min={1} max={80} onChange={(stripeW) => setC({ stripeW })} /></Row>
                      {cf.style !== 'tipped' && <Row label="Espaçamento"><Slider value={Math.round(cf.gap ?? (n === 3 ? w * 0.25 - sw : w * 0.35 - sw))} min={0} max={120} onChange={(gap) => setC({ gap })} /></Row>}
                      <Row label={cf.style === 'tipped' ? 'Distância da ponta' : 'Distância da ponta (1.ª risca)'}><Slider value={Math.round(cf.offset ?? (cf.style === 'tipped' ? 0 : n === 3 ? w * 0.2 : w * 0.25))} min={0} max={160} onChange={(offset) => setC({ offset })} /></Row>
                      <button className="btn tiny ghost" onClick={() => setC({ stripeW: undefined, gap: undefined, offset: undefined })}>Repor riscas</button>
                    </>
                  )
                })()}
                <StitchEditor value={kit.cuffs?.stitch} onChange={(stitch) => up((k) => ({ ...k, cuffs: { ...k.cuffs!, stitch } }))} />
                <TextureRow label="Tecido" defaults={FABRIC_CUFF} list={LAYER_FABRICS} value={kit.cuffs?.fabric} onChange={(fabric) => up((k) => ({ ...k, cuffs: { ...k.cuffs!, fabric } }))}
                  slots={kit.cuffs?.style !== 'solid' ? { names: ['Cor 1', 'Cor 2'], value: kit.cuffs?.fabricSlots, onChange: (fabricSlots) => up((k) => ({ ...k, cuffs: { ...k.cuffs!, fabricSlots } })) } : undefined} />
              </>
            )}
          </>
        )}
      </>)
  const fabricBody = (<>
        <Row label="Brilho do tecido"><Slider value={kit.shine ?? 0} min={0} max={100} onChange={(shine) => up((k) => ({ ...k, shine: shine || undefined }))} /></Row>
        <div className="muted small">Brilho só na pré-visualização 3D (0 = mate, 100 = brilhante). Cada camada pode ter o seu em "Brilho próprio".</div>
        <TextureRow label="Tecido" list={LAYER_FABRICS} value={kit.fabric ?? undefined} defaults={{ scale: 48, opacity: 0.31 }} onChange={(fabric) => up((k) => ({ ...k, fabric: fabric ?? null }))} />
        {kit.fabric && <Toggle on={kit.fabricShorts !== false} label="Também nos calções" onChange={(v) => up((k) => ({ ...k, fabricShorts: v ? undefined : false }))} />}
        <div className="muted small">O tecido do kit cobre tudo (em luz suave), menos as meias (têm o seu), e as camadas e logótipos com brilho próprio.</div>
        <StitchEditor label="Costura da bainha" def={HEM_STITCH} value={kit.hemStitch ?? undefined} onChange={(hemStitch) => up((k) => ({ ...k, hemStitch: hemStitch ?? null }))} />
        {(kit.fabrics ?? []).some((f) => f.visible) && <div className="muted small">Tecidos e costuras de versões anteriores deste kit:</div>}
        {(kit.fabrics ?? []).filter((f) => f.visible).map((f) => {
          const ch = (patch: Partial<FabricLayer>): void => up((k) => ({ ...k, fabrics: (k.fabrics ?? []).map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }))
          const isAsset = f.source.startsWith('asset:')
          return (
            <div key={f.id} className="layer">
              <div className="layer-head">
                <input type="checkbox" checked={f.visible} onChange={(e) => ch({ visible: e.target.checked })} />
                <b>{isAsset ? assets[f.source.slice(6)]?.name ?? 'PNG' : FABRICS.find((x) => x[0] === f.source)?.[1]}</b>
                <span className="grow" />
                {!isAsset && <button className="btn tiny" onClick={() => setFly({ kind: 'fabric', id: f.id })}>Trocar ▸</button>}
                <button className="btn tiny ghost" onClick={() => up((k) => ({ ...k, fabrics: (k.fabrics ?? []).filter((x) => x.id !== f.id) }))}>✕</button>
              </div>
              {f.visible && (
                <div className="layer-body">
                  <ZonePicker value={f.source === 'seams' && !f.v2 ? [...f.zones, 'shorts', 'socks'] : f.zones} onChange={(zones) => ch({ zones, v2: true })} />
                  <Row label="Intensidade"><Slider value={Math.round(f.opacity * 100)} min={0} max={100} onChange={(v) => ch({ opacity: v / 100 })} /></Row>
                  {f.source !== 'seams' && <Row label="Escala"><Slider value={f.scale} min={25} max={400} onChange={(scale) => ch({ scale })} /></Row>}
                  <Row label="Mistura"><Select value={f.blend as string} options={[['soft-light', 'Luz suave'], ['multiply', 'Multiplicar'], ['overlay', 'Sobrepor'], ['screen', 'Clarear']]} onChange={(b) => ch({ blend: b as GlobalCompositeOperation })} /></Row>
                </div>
              )}
            </div>
          )
        })}
      </>)

  const shirtTab = (
    <>
      <div className="layers-panel">{layerList('torso', [
          { id: 'sleeves', label: 'Mangas', icon: 'sleeves', color: fillMain(F.sleeves, kit.colors.sleeves), setColor: (c) => setFill('sleeves', solid(c)), body: sleevesBody, cam: 'sleeve', movable: kit.base.kind === 'template', mask: kit.sleevePattern.maskLayer ? layerLabel(kit.layers.find((x) => x.id === kit.sleevePattern.maskLayer) ?? kit.layers[0]) : undefined },
          ...(kit.base.kind === 'template' && kit.cuffs && kit.cuffs.style !== 'none' ? [{ id: 'cuffs', label: 'Punhos', icon: 'sleeves' as IconName, color: kit.cuffs.c1, setColor: (c1: string) => up((k) => ({ ...k, cuffs: { ...k.cuffs!, c1 }, colors: { ...k.colors, cuffs: c1 } })), body: cuffsBody, cam: 'sleeve' as CamView }] : []),
          { id: 'collar', label: `Gola ${kit.config.Collar ?? 66}`, icon: 'collar', color: kit.collar?.c1 ?? kit.colors.collar, setColor: (c1) => up((k) => ({ ...k, collar: { ...k.collar!, c1 }, colors: { ...k.colors, collar: c1 } })), body: collarBody, cam: 'collar' },
          { id: 'base', label: 'Base', icon: 'base', color: fillMain(F.shirt, kit.colors.shirt), setColor: (c) => setFill('shirt', solid(c)), body: baseBody },
          { id: 'fabric', label: 'Tecido e costuras', icon: 'fabric', body: fabricBody }
        ])}</div>

    </>
  )

  const shortsTab = (
    <>
      <div className="layers-panel">{layerList('shorts', [
        { id: 'shortsBase', label: 'Base', icon: 'base', movable: kit.base.kind === 'template', color: fillMain(F.shorts, kit.colors.shorts), setColor: (c) => setFill('shorts', solid(c)), body: (<>
        {kit.base.kind === 'template' ? (
          <>
            <FillRow label="Cor base" value={F.shorts ?? solid(kit.colors.shorts)} onChange={(f) => setFill('shorts', f)} />
          </>
        ) : recolorRows('shorts')}
        {kit.fabric && <Toggle on={kit.fabricShorts !== false} label="Tecido do kit nos calções" onChange={(v) => up((k) => ({ ...k, fabricShorts: v ? undefined : false }))} />}
        <StitchEditor label="Costura da bainha" def={SHORTS_HEM_STITCH} value={kit.shortsHem ?? undefined} onChange={(shortsHem) => up((k) => ({ ...k, shortsHem: shortsHem ?? null }))} />
        <StitchEditor label="Costura da braguilha e de trás" def={MID_STITCH} value={kit.shortsMid ?? undefined} onChange={(shortsMid) => up((k) => ({ ...k, shortsMid: shortsMid ?? null }))} />
        {kit.base.kind !== 'template' && <div className="muted small">O tecido do kit (separador da camisola, "Tecido e costuras") também cobre os calções.</div>}
      </>) }
      ])}</div>
    </>
  )

  const lsh = kit.logoShine
  const logosTab = (
    <LogoShineCtx.Provider value={lsh}>
    <div className="layers-panel logos-tab">
        <div className="sub-title">Brilho (3D)</div>
        <label className="check"><input type="checkbox" checked={!!lsh} onChange={(e) => up((k) => ({ ...k, logoShine: e.target.checked ? { all: true, value: 60 } : undefined }))} /> Brilho próprio nos emblemas, marcas e patrocínios</label>
        {lsh && (
          <>
            <Toggle on={lsh.all} label="Igual em todos" onChange={(all) => up((k) => ({ ...k, logoShine: { ...lsh, all } }))} />
            <Row label={lsh.all ? 'Brilho de todos' : 'Brilho geral'}><Slider value={lsh.value} min={0} max={100} onChange={(value) => up((k) => ({ ...k, logoShine: { ...lsh, value } }))} /></Row>
            <div className="muted small">{lsh.all ? 'Todos ligados por defeito; cada logo tem o seu "Brilho" (abre a linha do logo) para mudar a intensidade ou desligar.' : 'Cada logo tem agora o seu "Brilho" (abre a linha do logo).'}</div>
          </>
        )}

        {kit.base.kind === 'image' && (
          <>
            <div className="sub-title">Remover do kit importado</div>
            <div className="check-grid">
              {CLEAN_AREAS.map(([key, label]) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={clean.includes(key)} onChange={(e) => up((k) => ({ ...k, base: { ...k.base, cleanLogos: undefined, clean: e.target.checked ? [...clean, key] : clean.filter((x) => x !== key) } }))} /> {label}
                </label>
              ))}
            </div>
          </>
        )}
        <div className="sub-title">Emblema do clube</div>
        <Row label="Emblema">
          {project.crestAssetId && project.assets[project.crestAssetId] && <img className="logo-thumb big" src={project.assets[project.crestAssetId].dataUrl} alt="" />}
          <AssetPicker label="Trocar emblema" folderHint="Logos" onPick={(a) => setProject((p) => ({
            ...p, assets: { ...p.assets, [a.id]: a }, crestAssetId: a.id,
            kits: p.kits.map((k) => ({ ...k, logos: { ...k.logos, crest: { ...k.logos.crest, assetId: a.id }, shortsCrest: { ...k.logos.shortsCrest, assetId: a.id } } }))
          }))} />
        </Row>
        <label className="check"><input type="checkbox" checked={project.updateGameEmblem} onChange={(e) => setProject((p) => ({ ...p, updateGameEmblem: e.target.checked }))} /> Substituir também o emblema no jogo (menus, placar)</label>
        <div onPointerDown={at('front')} {...logoMenu(logos.crest, (crest) => setLogos((l) => ({ ...l, crest })))}><LogoBlock title="Emblema · Camisola" lp={logos.crest} assets={assets} onAsset={addAsset} folderHint="Logos" onChange={(crest) => setLogos((l) => ({ ...l, crest }))} /></div>
        <div className="sub-title">Marca</div>
        <div onPointerDown={at('front')} {...logoMenu(logos.brand, (brand) => setLogos((l) => ({ ...l, brand })))}>
          <LogoBlock title="Marca · Camisola" lp={logos.brand} assets={assets} onAsset={addAsset} folderHint="Brands"
            onChange={(brand) => setLogos((l) => ({
              ...l, brand,
              shortsBrand: brand.alsoShorts ? { ...l.shortsBrand, assetId: brand.assetId, enabled: brand.enabled, tint: brand.tint, color: brand.color } : l.shortsBrand,
              socksBrand: brand.alsoSocks ? { ...l.socksBrand, assetId: brand.assetId, enabled: brand.enabled, tint: brand.tint, color: brand.color } : l.socksBrand,
              sleeveBadges: (l.sleeveBadges ?? []).map((b) => (b.brand ? { ...b, assetId: brand.assetId, enabled: brand.enabled && !!brand.alsoSleeves, tint: brand.tint, color: brand.color } : b))
            }))}
            extra={<div className="check-col">
              <label className="check"><input type="checkbox" checked={!!logos.brand.alsoShorts} onChange={(e) => setLogos((l) => ({ ...l, brand: { ...l.brand, alsoShorts: e.target.checked }, shortsBrand: e.target.checked ? { ...l.shortsBrand, assetId: l.brand.assetId, enabled: true, tint: l.brand.tint, color: l.brand.color } : l.shortsBrand }))} /> Também nos calções</label>
              <label className="check"><input type="checkbox" checked={!!logos.brand.alsoSocks} onChange={(e) => setLogos((l) => ({ ...l, brand: { ...l.brand, alsoSocks: e.target.checked }, socksBrand: e.target.checked ? { ...l.socksBrand, assetId: l.brand.assetId, enabled: true, tint: l.brand.tint, color: l.brand.color } : { ...l.socksBrand, enabled: false } }))} /> Também nas meias</label>
              <label className="check"><input type="checkbox" checked={!!logos.brand.alsoSleeves} onChange={(e) => setLogos((l) => {
                const on = e.target.checked, list = l.sleeveBadges ?? []
                // the sleeve copy is its own row in "Badge / marca nas mangas" (both sleeves, own size and place)
                const badges = on
                  ? (list.some((b) => b.brand) ? list.map((b) => (b.brand ? { ...b, enabled: true, assetId: l.brand.assetId } : b)) : [...list, newLogo(LOGO_SIZES.sleeveBrand, { brand: true, side: 'both', assetId: l.brand.assetId, tint: l.brand.tint, color: l.brand.color })])
                  : list.filter((b) => !b.brand)
                return { ...l, brand: { ...l.brand, alsoSleeves: on }, sleeveBadges: badges }
              })} /> Também nas mangas</label>
            </div>} />
        </div>
        <div className="sub-title">Patrocinadores (peito)</div>
        {listOf('sponsors').map((sp, i) => (
          <div key={i} onPointerDown={at('front')} {...logoMenu(sp, (n) => setList('sponsors', listOf('sponsors').map((x, j) => (j === i ? n : x))), 'sponsors', i)}>
            <LogoBlock title={`Patrocinador ${i + 1}`} lp={sp} assets={assets} onAsset={addAsset} folderHint="Sponsors"
              onChange={(n) => setList('sponsors', listOf('sponsors').map((x, j) => (j === i ? n : x)))} onRemove={() => setList('sponsors', listOf('sponsors').filter((_, j) => j !== i))}
              extra={toOthersBtn('sponsors', sp)} />
          </div>
        ))}
        <button className="btn small" onClick={() => setList('sponsors', [...listOf('sponsors'), newLogo(listOf('sponsors').length ? 200 : 380, { dy: listOf('sponsors').length * 150, enabled: false })])}>+ Patrocinador no peito</button>
        <div className="sub-title">Badge / marca nas mangas</div>
        {listOf('sleeveBadges').map((b, i) => (
          <div key={i} onPointerDown={at('sleeve')} {...logoMenu(b, (n) => setList('sleeveBadges', listOf('sleeveBadges').map((x, j) => (j === i ? n : x))), 'sleeveBadges', i)}>
            <LogoBlock title={b.brand ? 'Marca · Mangas' : `Badge ${i + 1}`} lp={b} assets={assets} onAsset={addAsset} folderHint={b.brand ? 'Brands' : 'Badges'}
              onChange={(n) => setList('sleeveBadges', listOf('sleeveBadges').map((x, j) => (j === i ? n : x)))} onRemove={() => setLogos((l) => ({ ...l, brand: b.brand ? { ...l.brand, alsoSleeves: false } : l.brand, sleeveBadges: (l.sleeveBadges ?? []).filter((_, j) => j !== i) }))}
              extra={<><Row label="Manga"><Select value={b.side ?? 'both'} options={[['both', 'As duas'], ['left', 'Esquerda'], ['right', 'Direita']]} onChange={(side) => setList('sleeveBadges', listOf('sleeveBadges').map((x, j) => (j === i ? { ...x, side } : x)))} /></Row>{!b.brand && toOthersBtn('sleeveBadges', b)}</>} />
          </div>
        ))}
        <button className="btn small" onClick={() => setList('sleeveBadges', [...listOf('sleeveBadges'), newLogo(LOGO_SIZES.sleeveBadge, { tint: 'original', side: 'right', enabled: false, dy: listOf('sleeveBadges').filter((b) => !b.brand).length * 120 })])}>+ Badge nas mangas</button>
        <div className="sub-title">Patrocinadores (costas)</div>
        {listOf('backSponsors').map((sp, i) => (
          <div key={i} onPointerDown={at('back')} {...logoMenu(sp, (n) => setList('backSponsors', listOf('backSponsors').map((x, j) => (j === i ? n : x))), 'backSponsors', i)}>
            <LogoBlock title={`Costas ${i + 1}`} lp={sp} assets={assets} onAsset={addAsset} folderHint="Sponsors"
              onChange={(n) => setList('backSponsors', listOf('backSponsors').map((x, j) => (j === i ? n : x)))} onRemove={() => setList('backSponsors', listOf('backSponsors').filter((_, j) => j !== i))}
              extra={<><Row label="Posição"><Select value={sp.place ?? 'bottom'} options={[['top', 'Em cima do nome e número'], ['bottom', 'Em baixo do número']]} onChange={(place) => setList('backSponsors', listOf('backSponsors').map((x, j) => (j === i ? { ...x, place } : x)))} /></Row>{toOthersBtn('backSponsors', sp)}</>} />
          </div>
        ))}
        <button className="btn small" onClick={() => setList('backSponsors', [...listOf('backSponsors'), newLogo(LOGO_SIZES.backSponsor, { enabled: false, dy: listOf('backSponsors').length * 140 })])}>+ Patrocinador nas costas</button>
      
      <div className="sub-title">Calções</div>
      <div onPointerDown={at('shorts')}>
        <div {...logoMenu(logos.shortsCrest, (shortsCrest) => setLogos((l) => ({ ...l, shortsCrest })))}>
        <LogoBlock title="Emblema · Calções" lp={logos.shortsCrest} assets={assets} onAsset={addAsset} folderHint="Logos" onChange={(shortsCrest) => setLogos((l) => ({ ...l, shortsCrest }))}
          extra={<Row label="Perna"><Select value={logos.shortsCrest.side === 'left' || logos.shortsCrest.side === 'both' ? logos.shortsCrest.side : 'right'} options={[['right', 'Direita'], ['left', 'Esquerda'], ['both', 'As duas']]} onChange={(side) => setLogos((l) => ({ ...l, shortsCrest: { ...l.shortsCrest, side } }))} /></Row>} />
        </div>
        <div {...logoMenu(logos.shortsBrand, (shortsBrand) => setLogos((l) => ({ ...l, shortsBrand })))}>
        <LogoBlock title="Marca · Calções" lp={logos.shortsBrand} assets={assets} onAsset={addAsset} folderHint="Brands" onChange={(shortsBrand) => setLogos((l) => ({ ...l, shortsBrand }))}
          extra={<>
            <Row label="Perna"><Select value={logos.shortsBrand.side === 'right' || logos.shortsBrand.side === 'both' ? logos.shortsBrand.side : 'left'} options={[['left', 'Esquerda'], ['right', 'Direita'], ['both', 'As duas']]} onChange={(side) => setLogos((l) => ({ ...l, shortsBrand: { ...l.shortsBrand, side } }))} /></Row>
            <Row label="Onde"><Select value={logos.shortsBrand.spot === 'back' ? 'back' : 'front'} options={[['front', 'Frente da perna'], ['back', 'Parte de trás da perna']]} onChange={(spot) => setLogos((l) => ({ ...l, shortsBrand: { ...l.shortsBrand, spot } }))} /></Row>
          </>} />
        </div>
        {listOf('shortsSponsors').map((sp, i) => {
          const setOne = (n: LogoPlacement): void => setList('shortsSponsors', listOf('shortsSponsors').map((x, j) => (j === i ? n : x)))
          return (
            <div key={i} {...logoMenu(sp, setOne, 'shortsSponsors', i)}>
              <LogoBlock title={`Patrocinador · Calções ${i + 1}`} lp={sp} assets={assets} onAsset={addAsset} folderHint="Sponsors" onChange={setOne}
                onRemove={() => setList('shortsSponsors', listOf('shortsSponsors').filter((_, j) => j !== i))}
                extra={<>
                  <Row label="Onde"><Select value={sp.spot === 'back' ? 'back' : sp.spot === 'middle' ? 'middle' : sp.side === 'left' || sp.side === 'both' ? sp.side : 'right'}
                    options={[['middle', 'Centro (frente)'], ['back', 'Centro (atrás)'], ['left', 'Perna esquerda'], ['right', 'Perna direita'], ['both', 'Ambas as pernas (espelhado)']]}
                    onChange={(v) => setOne(v === 'middle' || v === 'back' ? { ...sp, spot: v } : { ...sp, spot: 'front', side: v as 'left' | 'right' | 'both' })} /></Row>
                  {sp.spot !== 'back' && sp.spot !== 'middle' && <div className="muted small">Esquerda / direita leva o patrocínio à volta da perna, para a frente ou para trás.</div>}
                  {toOthersBtn('shortsSponsors', sp)}
                </>} />
            </div>
          )
        })}
        <button className="btn small" onClick={() => setList('shortsSponsors', [...listOf('shortsSponsors'), newLogo(160, { enabled: false, spot: listOf('shortsSponsors').length ? 'front' : 'back', dy: listOf('shortsSponsors').filter((x) => x.spot === 'front').length * 60 })])}>+ Patrocinador nos calções</button>
      </div>
      <div className="sub-title">Meias</div>
      <div onPointerDown={at('socks')} {...logoMenu(logos.socksBrand, (socksBrand) => setLogos((l) => ({ ...l, socksBrand })))}><LogoBlock title="Marca · Meias" lp={logos.socksBrand} assets={assets} onAsset={addAsset} folderHint="Brands" onChange={(socksBrand) => setLogos((l) => ({ ...l, socksBrand }))} /></div>
      {listOf('socksSponsors').map((sp, i) => {
        const setOne = (n: LogoPlacement): void => setList('socksSponsors', listOf('socksSponsors').map((x, j) => (j === i ? n : x)))
        return (
          <div key={i} onPointerDown={at('socks')} {...logoMenu(sp, setOne, 'socksSponsors', i)}>
            <LogoBlock title={`Patrocinador · Meias ${i + 1}`} lp={sp} assets={assets} onAsset={addAsset} folderHint="Sponsors" onChange={setOne}
              onRemove={() => setList('socksSponsors', listOf('socksSponsors').filter((_, j) => j !== i))}
              extra={<>
                <Row label="Onde"><Select value={sp.side === 'left' || sp.side === 'right' ? sp.side : 'both'} options={[['both', 'Ambas as meias'], ['left', 'Meia esquerda'], ['right', 'Meia direita']]} onChange={(side) => setOne({ ...sp, side: side as 'left' | 'right' | 'both' })} /></Row>
                {toOthersBtn('socksSponsors', sp)}
              </>} />
          </div>
        )
      })}
      <button className="btn small" onClick={() => setList('socksSponsors', [...listOf('socksSponsors'), newLogo(120, { enabled: false, shine: -1, dy: listOf('socksSponsors').length * 90 })])}>+ Patrocinador nas meias</button>
      <button className="btn small" title="Põe a marca da camisola também nos calções e nas meias" onClick={() => setLogos((l) => ({ ...l, shortsBrand: { ...l.shortsBrand, assetId: l.brand.assetId, enabled: !!l.brand.assetId }, socksBrand: { ...l.socksBrand, assetId: l.brand.assetId, enabled: !!l.brand.assetId } }))}>Usar a marca da camisola em tudo</button>
    </div>
    </LogoShineCtx.Provider>
  )
  const ns = kit.numberShine
  const setNs = (patch: Partial<NonNullable<KitDesign['numberShine']>>): void => up((k) => ({ ...k, numberShine: { all: true, value: 60, ...k.numberShine, ...patch } }))
  const numberShineBlock = (
    <>
      <div className="sub-title">Brilho (3D)</div>
      <label className="check"><input type="checkbox" checked={!!ns} onChange={(e) => up((k) => ({ ...k, numberShine: e.target.checked ? { all: true, value: 60 } : undefined }))} /> Brilho próprio no nome e nos números</label>
      {ns && (
        <>
          <Toggle on={ns.all} label="Igual em todos" onChange={(all) => setNs({ all })} />
          {ns.all
            ? <Row label="Brilho"><Slider value={ns.value} min={0} max={100} onChange={(value) => setNs({ value })} /></Row>
            : (['back', 'name', 'chest', 'leg'] as const).map((part) => (
              <ShineRow key={part} label={{ back: 'Número das costas', name: 'Nome', chest: 'Número do peito', leg: 'Número dos calções' }[part]} value={ns[part]} fallback={ns.value} onChange={(v) => setNs({ [part]: v })} />
            ))}
          <div className="muted small">Só na pré-visualização 3D (com "Mostrar nome e número no 3D").</div>
        </>
      )}
    </>
  )
  const numbersTab = (
    <div className="layers-panel numbers-tab">
      <div className="sub-title">Pré-visualização</div>
      <Row label="Nome de exemplo"><input value={sampleName} maxLength={16} onChange={(e) => setSampleName(e.target.value.toUpperCase().replace(/[^A-Z. ]/g, ''))} /></Row>
      <Row label="Número de exemplo"><input value={sampleNum} maxLength={2} onChange={(e) => setSampleNum(e.target.value.replace(/\D/g, ''))} /></Row>
      <label className="check"><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> Mostrar nome e número no 3D</label>
      {numberShineBlock}
      <ContrastPanel kit={kit} assets={assets} atlases={atlases} sampleName={sampleName} sampleNum={sampleNum} onNumbers={(numbers) => up((k) => ({ ...k, numbers }))} />
      <div className="sub-title">Impressão</div>

        <Row label="Letras e números">
          <Select value={kit.numbers.mode} options={[['game', 'Manter os do jogo'], ['recolor', 'Recolorir os do jogo'], ['font', 'Fonte do PC'], ['file', 'Ficheiros (FTEX) / do jogo']]} onChange={(m) => up((k) => ({ ...k, numbers: { ...k.numbers, mode: m } }))} />
        </Row>
        {kit.numbers.mode === 'file' && (
          <div className="btn-row">
            <button className="btn small" onClick={() => setFly({ kind: 'numberSet', target: 'both' })}>Números + letras do jogo ▸</button>
            <button className="btn small" onClick={() => setFly({ kind: 'numberSet', target: 'numbers' })}>Só números ▸</button>
            <button className="btn small" onClick={() => setFly({ kind: 'numberSet', target: 'name' })}>Só letras ▸</button>
            <button className="btn small" onClick={() => importAtlas('backAsset')}>{kit.numbers.backAsset ? 'Números ✓' : 'Importar números'}</button>
            <button className="btn small" onClick={() => importAtlas('nameAsset')}>{kit.numbers.nameAsset ? 'Letras ✓' : 'Importar letras'}</button>
            <button className="btn small" onClick={() => importAtlas('legAsset')}>{kit.numbers.legAsset ? 'Nº calções ✓' : 'Nº calções (opcional)'}</button>
          </div>
        )}
        {kit.numbers.mode === 'font' && (
          <Row label="Fonte">
            <FontSelect value={kit.numbers.font} onChange={(font) => up((k) => ({ ...k, numbers: { ...k.numbers, font } }))} />
            <button className="btn tiny" onClick={async () => {
              const f = await window.kc.pickFiles([{ name: 'Fontes', extensions: ['ttf', 'otf', 'woff', 'woff2'] }])
              if (!f[0]) return
              const name = f[0].split(/[\\/]/).pop()!.replace(/\.\w+$/, '')
              await registerFont(name, await window.kc.readFile(f[0]))
              addUserFont(name)
              up((k) => ({ ...k, numbers: { ...k.numbers, font: name } }))
            }}>TTF…</button>
          </Row>
        )}
        {kit.numbers.mode === 'file' && (
          <label className="check"><input type="checkbox" checked={!!kit.numbers.fileRecolor} onChange={(e) => up((k) => ({ ...k, numbers: { ...k.numbers, fileRecolor: e.target.checked } }))} /> Recolorir os números e letras escolhidos</label>
        )}
        {(kit.numbers.mode === 'font' || kit.numbers.mode === 'recolor' || (kit.numbers.mode === 'file' && kit.numbers.fileRecolor)) && (
          <Row label="Cor"><ColorInput value={kit.numbers.fill} onChange={(fill) => up((k) => ({ ...k, numbers: { ...k.numbers, fill } }))} /></Row>
        )}
        <Row label="Contorno"><ColorInput value={kit.numbers.outline} onChange={(outline) => up((k) => ({ ...k, numbers: { ...k.numbers, outline } }))} /></Row>
        <Row label="Espessura contorno"><Slider value={kit.numbers.outlineWidth} min={0} max={12} onChange={(outlineWidth) => up((k) => ({ ...k, numbers: { ...k.numbers, outlineWidth } }))} /></Row>
        <div className="sub-title">Número no peito</div>
        <label className="check" onPointerDown={at('front')}><input type="checkbox" checked={cfg('ChestNumberSize', 0) > 0} onChange={(e) => setCfg('ChestNumberSize', e.target.checked ? 14 : 0)} /> Mostrar número no peito</label>
        {cfg('ChestNumberSize', 0) > 0 && (
          <div onPointerDown={at('front')}>
            {partNumBlock('chest')}
            <Row label="Esquerda / direita"><Slider value={cfg('ChestNumberX', 15)} min={0} max={29} onChange={(v) => setCfg('ChestNumberX', v)} /></Row>
            <Row label="Altura"><Slider invert value={cfg('ChestNumberY', 15)} min={0} max={29} onChange={(v) => setCfg('ChestNumberY', v)} /></Row>
            <Row label="Tamanho"><Slider value={cfg('ChestNumberSize', 14)} min={1} max={28} onChange={(v) => setCfg('ChestNumberSize', v)} /></Row>
          </div>
        )}
        <div className="sub-title">Nome</div>
        <Row label="Mostrar nome"><Select value={String(cfg('Name', 0))} options={[['0', 'Sim'], ['1', 'Não']]} onChange={(v) => setCfg('Name', Number(v))} /></Row>
        <Row label="Posição"><Select value={kit.numbers.nameBelow ? 'below' : 'above'} options={[['above', 'Em cima do número'], ['below', 'Em baixo do número']]} onChange={(v) => up((k) => ({ ...k, numbers: { ...k.numbers, nameBelow: v === 'below' } }))} /></Row>
        <Row label="Altura"><Slider invert value={cfg('NameY', NUMBER_DEFAULTS.NameY)} min={0} max={39} onChange={(v) => setCfg('NameY', v)} /></Row>
        <Row label="Tamanho"><Slider value={cfg('NameSize', NUMBER_DEFAULTS.NameSize)} min={0} max={20} onChange={(v) => setCfg('NameSize', v)} /></Row>
        <Row label="Espaçamento"><Slider value={cfg('NameStretch', NUMBER_DEFAULTS.NameStretch)} min={0} max={3} onChange={(v) => setCfg('NameStretch', v)} /></Row>
        <Row label="Arco"><Select value={String(cfg('NameShape', 1))} options={[['0', 'Reto'], ['1', 'Curva ligeira'], ['2', 'Curva média'], ['3', 'Curva forte']]} onChange={(v) => setCfg('NameShape', Number(v))} /></Row>
        <div className="sub-title">Número nas costas</div>
        <Row label="Altura"><Slider invert value={cfg('BackNumberY', NUMBER_DEFAULTS.BackNumberY)} min={0} max={29} onChange={(v) => setCfg('BackNumberY', v)} /></Row>
        <Row label="Tamanho"><Slider value={cfg('BackNumberSize', NUMBER_DEFAULTS.BackNumberSize)} min={0} max={28} onChange={(v) => setCfg('BackNumberSize', v)} /></Row>
        <Row label="Espaçamento"><Slider value={cfg('BackNumberSpacing', NUMBER_DEFAULTS.BackNumberSpacing)} min={0} max={14} onChange={(v) => setCfg('BackNumberSpacing', v)} /></Row>
      
      <div className="sub-title">Número nos calções</div>
      <div onPointerDown={at('shorts')}>

        <Row label="Perna"><Select value={String(cfg('ShortsNumberSide', NUMBER_DEFAULTS.ShortsNumberSide))} options={[['1', 'Direita'], ['0', 'Esquerda']]} onChange={(v) => setCfg('ShortsNumberSide', Number(v))} /></Row>
        <Row label="Tamanho (0 = sem)"><Slider value={cfg('ShortsNumberSize', NUMBER_DEFAULTS.ShortsNumberSize)} min={0} max={28} onChange={(v) => setCfg('ShortsNumberSize', v)} /></Row>
        <Row label="Esquerda / direita"><Slider value={cfg('ShortsNumberX', NUMBER_DEFAULTS.ShortsNumberX)} min={0} max={14} onChange={(v) => setCfg('ShortsNumberX', v)} /></Row>
        <Row label="Baixo / cima"><Slider value={cfg('ShortsNumberY', NUMBER_DEFAULTS.ShortsNumberY)} min={0} max={15} onChange={(v) => setCfg('ShortsNumberY', v)} /></Row>
        {partNumBlock('leg')}
        <div className="muted small">O jogo só permite o número dos calções à frente.</div>
      
      </div>
    </div>
  )

  const socksTab = (
    <div className="layers-panel">{layerList('socks', [
      { id: 'socksBase', label: 'Base', icon: 'base', movable: kit.base.kind === 'template', color: fillMain(F.socks, kit.colors.socks), setColor: (c) => setFill('socks', solid(c)), body: (kit.base.kind === 'template' ? <><FillRow label="Cor" value={F.socks ?? solid(kit.colors.socks)} onChange={(f) => setFill('socks', f)} /><Toggle on={!!kit.socksColor2} label="Uma cor por meia" onChange={(v) => up((k) => ({ ...k, socksColor2: v ? k.socksColor2 ?? k.colors.shirt2 : undefined }))} />{kit.socksColor2 && <Row label="Cor da outra meia"><ColorInput value={kit.socksColor2} onChange={(socksColor2) => up((k) => ({ ...k, socksColor2 }))} /></Row>}<TextureRow label="Tecido" list={LAYER_FABRICS} value={kit.socksFabric ?? undefined} defaults={{ scale: 110, opacity: 0.1, mix: 50 }} mix onChange={(socksFabric) => up((k) => ({ ...k, socksFabric: socksFabric ?? null }))} /></> : <>{recolorRows('socks')}<TextureRow label="Tecido" list={LAYER_FABRICS} value={kit.socksFabric ?? undefined} defaults={{ scale: 110, opacity: 0.1, mix: 50 }} mix onChange={(socksFabric) => up((k) => ({ ...k, socksFabric: socksFabric ?? null }))} /></>) }
    ])}</div>
  )




  // ---------------------------------------------------------------- side panels: graphics / patterns / base designs (3D previews)
  const PV = settings?.previewColors ?? ['#ff1493', '#39ff14', '#00e5ff']
  const PVB = settings?.previewBase ?? '#eeeeee'
  const pvKit: KitDesign = {
    ...kit, layers: [], fills: {}, fabrics: [], raglan: undefined, sleeveStitch: undefined,
    colors: { ...kit.colors, shirt: PVB, sleeves: PVB, shorts: PVB, socks: PVB, cuffs: PVB, collar: '#cfcfcf' },
    sleevePattern: { ...kit.sleevePattern, id: 'none' }, shortsPattern: { ...kit.shortsPattern, id: 'none' }, socksPattern: { ...kit.socksPattern, id: 'none' },
    cuffs: { ...(kit.cuffs ?? { c1: PVB, c2: PVB, width: 60 }), style: 'none' }, collar: { style: 'solid', c1: '#cfcfcf', c2: PV[1], c3: PV[2] }
  }
  const stripLogos = (k: KitDesign): KitDesign => ({ ...k, logos: { ...k.logos, sponsors: [], backSponsors: [], sleeveBadges: [], crest: { ...k.logos.crest, enabled: false }, brand: { ...k.logos.brand, enabled: false } } })
  const pv3 = (L: OverlayLayer, P: 'torso' | 'shorts' | 'socks' | 'cuff' | 'side' | 'shoulder', key: string, base: KitDesign = kit): Promise<string> =>
    kitPreview3d({ ...stripLogos(base), layers: [L] }, assets, P, key + JSON.stringify([base.colors, base.config.Collar, base.config.ShortsModel, base === pvKit ? PV : 0]))
  // the grids show every design in the preview colours (Definições → Pré-visualizações) on a plain kit
  let sidePanel: JSX.Element | null = null
  if (userTpl) {
    sidePanel = (
      <Flyout key="usertpl" title="Templates guardados" onClose={() => setUserTpl(null)}>
        <CatGrid items={[
          ...userTpl.map((t) => ({
            id: t.id, label: t.name, category: 'Guardados na app',
            load: () => kitPreview3d(stripLogos({ ...t.kit, slot: kit.slot }), { ...assets, ...t.assets }, 'torso', 'utpl:' + t.id),
            onDelete: () => { if (confirm(`Apagar o template "${t.name}"?`)) window.kc.deleteUserTemplate(t.id).then(loadUserTpls) }
          })),
          // PNG textures in KitCreatorData/templates: they become the kit's base image
          ...tplImgs.map((f) => ({
            id: 'img:' + f.path, label: f.name, category: f.category ? 'Texturas PNG · ' + f.category : 'Texturas PNG',
            load: async () => { const a = await previewAssetFromFile(f.path, 1024); return kitPreview3d(stripLogos({ ...kit, layers: [], base: { kind: 'image', imageAssetId: a.id, recolor: [] } }), { ...assets, [a.id]: a }, 'torso', 'timg:' + f.path) }
          }))
        ]} initialCategory="Guardados na app"
          tools={<button className="btn small" title="Põe aqui texturas PNG de 2048×2048 no layout do kit" onClick={async () => window.kc.openPath(await window.kc.templateDirPath())}>Abrir pasta</button>}
          empty={(c) => <>{c.startsWith('Texturas') ? 'Põe texturas PNG (2048×2048, layout do kit) na pasta KitCreatorData\\templates.' : 'Ainda não guardaste nenhum template (Origem → Guardar como template…).'}</>}
          onPick={async (id) => {
          if (id.startsWith('img:')) {
            // a full kit texture: the kit's base becomes this image (logos, numbers and layers stay on top)
            const path = id.slice(4)
            const a = await rawAssetFromFile(path)
            addAsset(a)
            up((k) => ({ ...k, base: { kind: 'image', imageAssetId: a.id, recolor: [] } }))
            notify('ok', 'Template carregado: ' + (tplImgs.find((x) => x.path === path)?.name ?? ''))
            setUserTpl(null)
            return
          }
          const t = userTpl.find((x) => x.id === id)
          if (!t) return
          // the template's design and brand; this kit keeps its crest, sponsors, numbers and slot
          setProject((p) => ({ ...p, assets: { ...p.assets, ...t.assets } }), false)
          up((k) => {
            const d = migrateKit(JSON.parse(JSON.stringify(t.kit)) as KitDesign)
            return { ...d, slot: k.slot, numbers: k.numbers, logos: { ...k.logos, brand: d.logos.brand, shortsBrand: d.logos.shortsBrand, socksBrand: d.logos.socksBrand, sleeveBadges: [...(k.logos.sleeveBadges ?? []).filter((b) => !b.brand), ...(d.logos.sleeveBadges ?? []).filter((b) => b.brand)] }, layers: d.layers.map((l) => ({ ...l })) }
          })
          notify('ok', 'Template carregado: ' + t.name)
          setUserTpl(null)
        }} />
      </Flyout>
    )
  }
  if (texPick) {
    const P = texPick.part
    const close = (): void => setTexPick(null)
    const mk = (more: Partial<OverlayLayer>): OverlayLayer => ({ id: uid(), part: P, visible: true, opacity: 1, color: kit.colors.shirt2, dx: 0, dy: 0, rotation: 0, zones: P === 'torso' ? ['front', 'back'] : undefined, kind: 'shape', ...more })
    // replace mode (the card of a layer): the new design takes the old layer's place, colours, zones, mask, group…
    const target = texPick.replace ? kit.layers.find((l) => l.id === texPick.replace) : undefined
    const add = (L: OverlayLayer): void => {
      if (target) {
        const keep = { id: target.id, visible: target.visible, opacity: target.opacity, color: target.color, colors: target.colors ?? L.colors, fill: target.fill, group: target.group, zones: target.zones, maskLayer: target.maskLayer, maskInvert: target.maskInvert, stitch: target.stitch, fabric: target.fabric, fabricSlots: target.fabricSlots, embroidery: target.embroidery, outlineRelief: target.outlineRelief, shine: target.shine, blend: target.blend, locked: target.locked }
        setLayer(target.id, () => ({ ...L, ...keep }))
        setOpenLayer(target.id); close(); return
      }
      const withFab = L.part === 'socks' && !L.fabric && ['design', 'panel', 'shape', 'pattern', 'texture'].includes(L.kind) ? { ...L, fabric: SOCK_LAYER_FABRIC } : L.kind === 'panel' && L.panel === 'cuffs' && !L.fabric ? { ...L, fabric: CUFF_FABRIC } : L
      up((k) => ({ ...k, layers: [...k.layers, withFab] })); setOpenLayer(L.id); close()
    }
    const fileItems: CatItem[] = texLib.items.map((f) => ({
      id: 'file:' + f.path, label: f.name, category: f.category,
      load: async () => {
        // previews from a small copy of the file (the library has hundreds of big images: out of memory)
        const a = await previewAssetFromFile(f.path)
        if (texPick.kind === 'patterns') {
          const m = await patternMask(a)
          m.asset.id = 'pvm:' + f.path
          return kitPreview3d({ ...stripLogos(pvKit), layers: [mk({ id: 'pv', kind: 'image', fit: 'tile', assetId: m.asset.id, tileTint: m.mono ? 'color' : 'original', color: PV[0], size: 200, gap: 0 })] }, { ...assets, [m.asset.id]: m.asset }, P, 'file2:' + f.path + PV[0] + PVB)
        }
        const img = await loadAsset(a)
        const fit = Math.abs(img.width - img.height) < 4 ? 'uv' : 'part'
        return kitPreview3d({ ...stripLogos(pvKit), layers: [mk({ id: 'pv', kind: 'image', fit, assetId: a.id, color: PV[0] })] }, { ...assets, [a.id]: a }, P, 'gfile:' + f.path + PVB)
      }
    }))
    const empty = texLib.categories.map((c) => ({ c }))
    void empty
    const pickFile = async (path: string, name: string): Promise<void> => {
      if (texPick.kind === 'patterns') {
        const a = await assetFromFile(path)
        const m = await patternMask(a)
        addAsset(m.asset)
        add(mk({ kind: 'image', fit: 'tile', assetId: m.asset.id, tileTint: m.mono ? 'color' : 'original', size: 160, gap: 0, name }))
      } else {
        const a = await rawAssetFromFile(path)
        addAsset(a)
        const img = await loadAsset(a)
        add(mk({ kind: 'image', fit: Math.abs(img.width - img.height) < 4 ? 'uv' : 'part', assetId: a.id, name }))
      }
    }
    let builtin: CatItem[]
    if (texPick.kind === 'patterns') {
      builtin = TEXTURES.map(([id, label]) => ({ id, label, category: 'Incluídos', load: () => pv3(mk({ id: 'pv', kind: 'texture', pattern: id, color: PV[0], opacity: 1, scale: 200 }), P, 'tx2:' + id, pvKit) }))
    } else {
      // everything in one list: base designs, bands and shapes, panels (sides, shoulders, cuffs, hems, sock trims), collar
      const dcol = [kit.colors.shirt2, kit.colors.shirt3, '#ffffff', '#111111', kit.colors.collar]
      builtin = [
        ...DESIGNS.map((d) => ({ id: 'design:' + d.id, label: d.label, category: DESIGN_CAT[d.id] ?? graphicCat(d.group === 'Degradês' ? 'Gradientes' : d.group), load: () => pv3(mk({ id: 'pv', kind: 'design', design: d.id, color: PV[0], colors: PV, stops: d.stops ? [{ c: PV[0], at: 0 }, { c: PV[1], at: 50 }, { c: PV[2], at: 100 }] : undefined }), P, 'ds:' + d.id, pvKit) })),
        ...(P === 'torso' ? SHAPES.filter(([id]) => id !== 'band').map(([id, label]) => ({ id, label, category: SHAPE_CAT[id] ?? 'Faixas & Xadrez', load: () => pv3(mk({ id: 'pv', kind: 'shape', shape: id, size: 60, color: PV[0] }), id === 'panelSides' ? 'side' : id === 'shoulders' ? 'shoulder' : P, 'sh:' + id, pvKit) })) : []),
        ...PANELS.filter((pp) => pp[2] === P && pp[0] !== 'neck').flatMap(([kind, , , size]) => [...PANEL_STYLES.map(([st, stLabel]) => [st, stLabel, undefined] as [string, string, number | undefined]), ...(kind === 'cuffs' ? [['stripes', 'Duas riscas', 2], ['stripes', 'Três riscas', 3]] as [string, string, number][] : [])].map(([st, stLabel, n]) => ({
          id: `panel:${kind}:${st}${n ? ':' + n : ''}`, label: (PANEL_LABEL[kind] ?? '') + ' · ' + stLabel, category: kind === 'cuffs' ? 'Punhos' : kind === 'sides' ? 'Painéis Laterais' : kind === 'shoulders' ? 'Painéis de Ombro' : 'Painéis',
          load: () => pv3({ id: 'pv', kind: 'panel', panel: kind, pstyle: st as PanelStyle, pcount: n, part: P, visible: true, opacity: 1, color: PV[0], colors: [PV[0], PV[1]], size: size * 1.3, panelSleeve: kind === 'shoulders' || undefined }, kind === 'cuffs' ? 'cuff' : kind === 'sides' ? 'side' : kind === 'shoulders' ? 'shoulder' : P, `pn:${kind}:${st}:${n}`, pvKit)
        }))),
        // the cuffs of the kit itself (one colour band at the end of every sleeve)
        ...(P === 'torso' ? CUFF_STYLES.filter(([id]) => id !== 'none').map(([id, label]) => ({ id: 'cuffs:' + id, label: 'Punho do kit · ' + label, category: 'Punhos', load: () => kitPreview3d({ ...stripLogos(pvKit), cuffs: { c1: PV[0], c2: PV[1], width: kit.cuffs?.width ?? 60, style: id as 'solid' } }, assets, 'cuff', 'cs:' + id + JSON.stringify([kit.cuffs?.width, PV, PVB])) })) : []),
        ...(P === 'torso' ? COLLAR_DESIGNS.filter((c) => !c[3]).map(([id, label]) => ({ id: 'collar:' + id, label, category: 'Gola', load: async () => {
          const cs = { style: id, c1: PV[0], c2: PV[1], c3: PV[2] }
          const t = await composeKit({ ...stripLogos(pvKit), collar: cs }, assets, { scale: 0.25 })
          return collarPreview(cfg('Collar', 66), t, 'cd:' + id + JSON.stringify([cs, PVB]))
        } })) : [])
      ]
    }
    const onPick = (id: string): void => {
      if (id.startsWith('file:')) { const f = texLib.items.find((x) => 'file:' + x.path === id); if (f) void pickFile(f.path, f.name); return }
      if (texPick.kind === 'patterns') { add(mk({ kind: 'texture', pattern: id, color: contrastOn(kit.colors.shirt), opacity: 0.35 })); return }
      if (id.startsWith('design:')) {
        const d = designDef(id.slice(7))
        add({ id: uid(), kind: 'design', design: d.id, part: P, visible: true, opacity: 1, color: kit.colors.shirt2, colors: [kit.colors.shirt2, kit.colors.shirt3, '#ffffff'], zones: P === 'torso' ? ['front', 'back'] : undefined, stops: d.stops ? [{ c: kit.colors.shirt2, at: 0 }, { c: kit.colors.shirt, at: 100 }] : undefined })
        return
      }
      if (id.startsWith('panel:')) {
        const [, kind, st, n] = id.split(':')
        const size = PANELS.find((pp) => pp[0] === kind)?.[3] ?? 60
        add({ id: uid(), kind: 'panel', panel: kind as PanelKind, pstyle: st as PanelStyle, pcount: n ? Number(n) : undefined, part: P, visible: true, opacity: 1, color: kit.colors.shirt2, colors: [kit.colors.shirt2, contrastOn(kit.colors.shirt2)], size, panelSleeve: kind === 'shoulders' ? true : undefined })
        return
      }
      if (id.startsWith('cuffs:')) {
        const style = id.slice(6) as NonNullable<KitDesign['cuffs']>['style']
        up((k) => ({ ...k, cuffs: { ...(k.cuffs ?? { c1: k.colors.cuffs, c2: '#ffffff', width: 60 }), style, c2: k.cuffs?.c2 ?? contrastOn(k.colors.cuffs), fabric: k.cuffs?.fabric ?? CUFF_FABRIC, stitch: k.cuffs?.stitch ?? STITCH_DEFAULT } }))
        setOpenLayer('fixed:cuffs'); close(); return
      }
      if (id.startsWith('collar:')) {
        // a collar design is its own layer (the collar row keeps the model and the base colour)
        const style = id.slice(7) as NonNullable<OverlayLayer['collarStyle']>
        const c1 = kit.collar?.c1 ?? kit.colors.collar
        add({ id: uid(), kind: 'collar', collarStyle: style, part: 'torso', visible: true, opacity: 1, color: c1, colors: [c1, contrastOn(c1), kit.colors.shirt2], fabric: COLLAR_FABRIC, stitch: STITCH_DEFAULT })
        return
      }
      add(mk({ kind: 'shape', shape: id as OverlayLayer['shape'], size: 60 }))
    }
    // every library folder shows as a category, even while empty
    const cats = texLib.categories.map((c) => ({ id: 'cat:' + c, label: '', category: c, load: async () => '' }))
    void cats
    const all = [...builtin, ...fileItems.map((f) => ({ ...f, category: texPick.kind === 'graphics' ? graphicCat(f.category) : f.category }))]
      .map((x, i) => [x, i] as const).sort((a, b) => catRank(a[0].category) - catRank(b[0].category) || a[1] - b[1]).map(([x]) => x)
    const withEmpty = [...all, ...texLib.categories.filter((c) => !all.some((x) => x.category === c)).map((c) => ({ id: 'none:' + c, label: '', category: c, load: async () => '' }))]
    // swapping a layer's design: open on that design's category (collar → Gola, stripes → Riscas, cuffs → Punhos…)
    const curId = !target ? undefined
      : target.kind === 'design' ? 'design:' + target.design
      : target.kind === 'collar' ? 'collar:' + target.collarStyle
      : target.kind === 'panel' ? all.find((x) => x.id.startsWith(`panel:${target.panel}:${target.pstyle ?? 'solid'}`))?.id
      : target.kind === 'shape' ? target.shape
      : target.kind === 'texture' ? target.pattern : undefined
    const curCat = curId ? all.find((x) => x.id === curId)?.category : undefined
    sidePanel = (
      <Flyout key={'tp:' + texPick.kind + texPick.part + (texPick.category ?? '') + (texPick.replace ?? '')} title={texPick.kind === 'patterns' ? (target ? 'Padrões — trocar' : 'Padrões') : target ? 'Designs — trocar' : 'Designs'} onClose={close}>
        <CatGrid items={withEmpty.filter((x) => !x.id.startsWith('none:'))} initialCategory={texPick.category ?? curCat} onPick={onPick}
          value={!target ? undefined : target.kind === 'design' ? 'design:' + target.design : target.kind === 'panel' ? `panel:${target.panel}:${target.pstyle ?? 'solid'}${target.pcount && target.pstyle === 'stripes' && target.panel === 'cuffs' && (target.pcount === 2 || target.pcount === 3) ? ':' + target.pcount : ''}` : target.kind === 'shape' ? target.shape : target.kind === 'collar' ? 'collar:' + target.collarStyle : undefined}
          tools={<>
            <button className="btn small" title="Abrir a pasta para pores aqui as tuas imagens" onClick={() => texLib.root && window.kc.openPath(texLib.root)}>Abrir pasta</button>
            <button className="btn small" title="Voltar a ler as pastas" onClick={() => window.dispatchEvent(new Event('kc:library'))}>⟳</button>
          </>}
          empty={(c) => <>A categoria "{c || 'Todos'}" ainda não tem imagens. Põe-nas em <code>{texLib.root}\{c}</code>.</>} />
      </Flyout>
    )
  } else if (designPick) {
    const DL = kit.layers.find((x) => x.id === designPick)
    if (DL) {
      const P = (DL.part === 'shorts' || DL.part === 'socks' ? DL.part : 'torso') as 'torso' | 'shorts' | 'socks'
      sidePanel = (
        <Flyout key={'dp:' + DL.id} title="Design base" onClose={() => setDesignPick(null)}>
          <CatGrid value={DL.design} items={DESIGNS.map((d) => ({
            id: d.id, label: d.label, category: d.group,
            load: () => pv3({ ...DL, id: 'pv', design: d.id, p: {}, opacity: 1, visible: true, group: undefined, maskLayer: undefined, stops: d.stops ? DL.stops ?? [{ c: kit.colors.shirt2, at: 0 }, { c: kit.colors.shirt, at: 100 }] : DL.stops }, P, 'ds:' + d.id + JSON.stringify([DL.colors, DL.zones]))
          }))} onPick={(id) => { const nd = designDef(id); setLayer(DL.id, (x) => ({ ...x, design: nd.id, p: {}, stops: nd.stops && !x.stops ? [{ c: kit.colors.shirt2, at: 0 }, { c: kit.colors.shirt, at: 100 }] : x.stops })) }} />
        </Flyout>
      )
    }
  }
  // colour picker: "apply to all" swaps one colour everywhere in this kit; presets = kit + team colours
  const colorCtx = {
    applyAll: (from: string, to: string): void => {
      swapColor(from, to)
      notify('ok', `${from} → ${to} em todo o equipamento`)
    },
    presets: [
      ...([['Camisola', kit.colors.shirt], ['Secundária', kit.colors.shirt2], ['Terciária', kit.colors.shirt3], ['Mangas', kit.colors.sleeves], ['Gola', kit.colors.collar], ['Calções', kit.colors.shorts], ['Meias', kit.colors.socks]] as [string, string][]).map(([name, color]) => ({ name: 'Kit · ' + name, color })),
      ...teamColors.map((color) => ({ name: 'Equipa · ' + color, color }))
    ] as NamedColor[]
  }
  return (
    <ColorCtx.Provider value={colorCtx}>
    {ctx && (() => {
      const L = ctx.layer ? kit.layers.find((x) => x.id === ctx.layer) : undefined
      const copy = (): void => {
        if (!L) return
        const block = L.kind === 'group' ? normalizeGroups(kit.layers).filter((x) => x.id === L.id || x.group === L.id) : [{ ...L, group: undefined }]
        layerClipboard = { layers: JSON.parse(JSON.stringify(block)), assets: Object.fromEntries(block.filter((x) => x.assetId && assets[x.assetId]).map((x) => [x.assetId!, assets[x.assetId!]])) }
        notify('ok', block.length > 1 ? `${block.length} camadas copiadas` : 'Camada copiada')
      }
      const paste = (): void => {
        const cb = layerClipboard
        if (!cb) return
        // new ids (a group keeps its members), the layers go to this part, just above the clicked row
        const ids = new Map(cb.layers.map((x) => [x.id, uid()]))
        const P = ctx.part
        const fresh = cb.layers.map((x) => ({ ...x, id: ids.get(x.id)!, group: x.group ? ids.get(x.group) : undefined, maskLayer: x.maskLayer && ids.has(x.maskLayer) ? ids.get(x.maskLayer) : undefined, part: P === 'torso' ? (x.part === 'shorts' || x.part === 'socks' ? 'torso' : x.part) : P, zones: P === 'torso' ? x.zones ?? ['front', 'back'] : undefined } as OverlayLayer))
        setProject((p) => ({ ...p, assets: { ...p.assets, ...cb.assets } }), false)
        up((k) => {
          const ls = normalizeGroups(k.layers)
          const at = L ? (() => { const i = ls.findIndex((x) => x.id === L.id); const end = L.kind === 'group' ? i + ls.filter((x) => x.group === L.id).length : i; return end + 1 })() : ls.length
          return { ...k, layers: normalizeGroups([...ls.slice(0, at), ...fresh, ...ls.slice(at)]) }
        })
        notify('ok', fresh.length > 1 ? `${fresh.length} camadas coladas` : 'Camada colada')
      }
      return (
        <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <button disabled={!L} onClick={() => { copy(); setCtx(null) }}>{L?.kind === 'group' ? 'Copiar grupo' : 'Copiar camada'}</button>
          <button disabled={!layerClipboard} onClick={() => { paste(); setCtx(null) }}>Colar{layerClipboard && layerClipboard.layers.length > 1 ? ` (${layerClipboard.layers.length} camadas)` : ' camada'}</button>
          <button disabled={!L} onClick={() => { if (L) up((k) => { const ls = normalizeGroups(k.layers); const i = ls.findIndex((x) => x.id === L.id); return { ...k, layers: [...ls.slice(0, i + 1), { ...L, id: uid() }, ...ls.slice(i + 1)] } }); setCtx(null) }}>Duplicar</button>
        </div>
      )
    })()}
    {analyzeOpen && <TextureAnalyzeModal kit={kit} onClose={() => setAnalyzeOpen(false)} />}
    {kitlabFile && <KitlabImportModal file={kitlabFile} onClose={() => setKitlabFile(null)} />}
    {logoCtx && (() => {
      const { lp, set, key, i } = logoCtx
      const close = (): void => setLogoCtx(null)
      const cb = logoClipboard
      return (
        <div className="ctx-menu" style={{ left: logoCtx.x, top: logoCtx.y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <button onClick={() => { logoClipboard = { lp: JSON.parse(JSON.stringify(lp)), asset: lp.assetId ? assets[lp.assetId] : undefined }; notify('ok', 'Logo copiado'); close() }}>Copiar logo</button>
          <button disabled={!cb} onClick={() => {
            if (!cb) return
            if (cb.asset) addAsset(cb.asset)
            // the copied look over this one (this row keeps its own place: side / spot / position in the back)
            set({ ...lp, ...cb.lp, side: lp.side ?? cb.lp.side, spot: lp.spot ?? cb.lp.spot, place: lp.place ?? cb.lp.place, brand: lp.brand, alsoShorts: lp.alsoShorts, alsoSocks: lp.alsoSocks, alsoSleeves: lp.alsoSleeves })
            notify('ok', 'Logo colado'); close()
          }}>Colar aqui</button>
          {key && <button disabled={!cb} onClick={() => { if (!cb) return; if (cb.asset) addAsset(cb.asset); setLogos((l) => ({ ...l, [key]: [...(l[key] ?? []), { ...cb.lp, brand: undefined }] })); notify('ok', 'Logo colado como novo'); close() }}>Colar como novo</button>}
          {key && i !== undefined && <button onClick={() => { setLogos((l) => { const list = l[key] ?? []; return { ...l, [key]: [...list.slice(0, i + 1), { ...list[i], brand: undefined, dy: list[i].dy + 60 }, ...list.slice(i + 1)] } }); close() }}>Duplicar</button>}
          {key && <button onClick={() => { toOtherKits(key, lp); close() }}>Adicionar aos outros kits</button>}
        </div>
      )
    })()}
    {vecEdit && (() => {
      const V = kit.layers.find((x) => x.id === vecEdit)
      if (!V) return null
      return <VectorEditor value={V.vpaths ?? []} color={fillMain(V.fill, V.color)} onClose={() => setVecEdit(null)} onApply={(vpaths) => { setLayer(V.id, (x) => ({ ...x, vpaths })); setVecEdit(null) }} />
    })()}
    <div className="editor">
      <aside className="panel" style={{ width }}>
        <div className="panel-head">
          <div className="team-title"><b>{project.teamName}</b>{!presetMode && !tplMode && <span className="muted">#{project.teamId}</span>}{dirty && <span className="dirty">● por guardar</span>}</div>
          {tplMode && <div className="preset-banner">A editar um template guardado (sem emblema nem patrocinadores). "Guardar" grava as alterações no template.</div>}
          {presetMode && <div className="preset-banner">Templates do kit novo: cada equipamento aqui (Principal, Alternativo, 3.º, 4.º, GR) é o template desse tipo. "Guardar" passa a usá-los nos kits novos, com as cores de cada equipa.</div>}
          <div className="slot-tabs">
            {project.kits.map((k) => (
              <button key={k.slot} className={'slot-tab' + (k.slot === kit.slot ? ' active' : '')} onClick={() => setActiveSlot(k.slot)}>
                <span className="swatch" style={{ background: fillMain(k.fills?.shirt, k.colors.shirt) }} />{SLOT_LABEL[k.slot] ?? k.slot}
              </button>
            ))}
            <select className="slot-add" value="" onChange={(e) => e.target.value && addSlot(e.target.value)}>
              <option value="">+ kit</option>
              {ALL_SLOTS.filter((s) => !project.kits.some((k) => k.slot === s)).map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="cat-tabs">
            {TABS.map(([t, label, view]) => <button key={t} className={'icon-tab' + (tab === t ? ' active' : '')} title={label} onClick={() => { setTab(t); go(view); setFly(null) }}><Icon name={TAB_ICONS[t]} size={20} /></button>)}
          </div>
        </div>
        <div className="panel-scroll">
          {tab === 'origin' ? originTab : tab === 'shirt' ? shirtTab : tab === 'shorts' ? shortsTab : tab === 'socks' ? socksTab : tab === 'logos' ? logosTab : tab === 'numbers' ? numbersTab : armbandTab}
        </div>
        <div className="resize-handle" onMouseDown={startDrag} title="Arrastar para redimensionar" />
      </aside>

      {sidePanel}
      {fly && (
        <Flyout title={flyTitle} onClose={() => setFly(null)} extra={flyExtra}>
          <PreviewGrid items={items} value={value} onPick={pick} />
          {fly.kind === 'numberSet' && !numberSets.length && <div className="muted pad">Não encontrei conjuntos de números nas pastas do kit-server.</div>}
        </Flyout>
      )}

      <section className="stage">
        <div className="stage-bar">
          <div className="seg">
            <button className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>3D</button>
            <button className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>Textura</button>
          </div>
          {mode === '2d' && (
            <div className="seg">
              <button className={showMesh ? 'active' : ''} title="Mostrar ou esconder a malha (contornos) do modelo 3D sobre a textura"
                onClick={() => { const v = !showMesh; setShowMesh(v); try { localStorage.setItem('kc.mesh3d', v ? '1' : '0') } catch { /* ignore */ } }}>Malha 3D</button>
              <button className={showFabric ? 'active' : ''} title="Mostrar ou esconder a textura dos tecidos (no 3D e na textura)"
                onClick={() => { const v = !showFabric; setShowFabric(v); try { localStorage.setItem('kc.showFabric', v ? '1' : '0') } catch { /* ignore */ } }}>Mostrar tecidos</button>
              <button className={showStitch ? 'active' : ''} title="Mostrar ou esconder as costuras (no 3D e na textura)"
                onClick={() => { const v = !showStitch; setShowStitch(v); try { localStorage.setItem('kc.showStitch', v ? '1' : '0') } catch { /* ignore */ } }}>Mostrar costuras</button>
            </div>
          )}
          {mode === '3d' && (
            <div className="seg">
              <button className={longSleeves ? 'active' : ''} onClick={() => setLongSleeves(!longSleeves)}>Manga comprida</button>
              <button className={tucked ? 'active' : ''} title="Camisola por dentro ou por fora dos calções (só na pré-visualização)"
                onClick={() => { const v = !tucked; setTucked(v); try { localStorage.setItem('kc.tucked', v ? '1' : '0') } catch { /* ignore */ } }}>{tucked ? 'Dentro dos calções' : 'Fora dos calções'}</button>
              <button className={ab.show ? 'active' : ''} title="Mostrar ou esconder a braçadeira de capitão no 3D" onClick={() => setAb({ show: !ab.show })}>Braçadeira</button>
            </div>
          )}
          <div className="grow" />
          <button className="btn ghost" disabled={!past.length} onClick={undo} title="Desfazer (Ctrl+Z)">↶</button>
          <button className="btn ghost" disabled={!future.length} onClick={redo} title="Refazer (Ctrl+Y)">↷</button>
          <span className="hist-wrap">
            <button className={'btn ghost' + (histOpen ? ' active' : '')} disabled={!past.length && !future.length} onClick={() => setHistOpen(!histOpen)} title="Histórico: volta atrás ou para a frente nas alterações">🕘</button>
            {histOpen && (() => {
              const all = [...past, project, ...future]
              const cur = past.length
              const from = Math.max(0, all.length - 120)
              return (
                <div className="hist-pop" onPointerDown={(e) => e.stopPropagation()}>
                  <div className="hist-head"><b>Histórico</b><span className="muted small">{all.length - 1} passos</span></div>
                  <div className="hist-list">
                    {all.slice(from).map((p, j) => {
                      const i = from + j
                      const t = stepTime.get(p)
                      return (
                        <button key={i} className={'hist-item' + (i === cur ? ' cur' : i > cur ? ' fut' : '')} onClick={() => jumpHistory(i)}>
                          <span>{describeStep(i ? all[i - 1] : undefined, p)}</span>
                          <span className="muted small">{t ? new Date(t).toLocaleTimeString().slice(0, 8) : ''}</span>
                        </button>
                      )
                    }).reverse()}
                  </div>
                </div>
              )
            })()}
          </span>
          <button className="btn" onClick={async () => {
            if (!kit) return
            const b = await (await composeKit(kit, project.assets)).convertToBlob({ type: 'image/png' })
            const p = await window.kc.saveFile(`${project.teamName}_${kit.slot}.png`, new Uint8Array(await b.arrayBuffer()))
            if (p) notify('ok', 'PNG guardado: ' + p)
          }}>PNG</button>
          <button className="btn danger" disabled={project.kits.length < 2} title="Apaga este equipamento da equipa" onClick={() => {
            if (!confirm(`Eliminar o equipamento ${SLOT_LABEL[kit.slot] ?? kit.slot}? (Só fica definitivo quando guardares.)`)) return
            setProject((p) => ({ ...p, kits: p.kits.filter((k) => k.slot !== kit.slot) }))
            setActiveSlot(project.kits.find((k) => k.slot !== kit.slot)!.slot)
          }}>Eliminar kit</button>
          <button className="btn" disabled={!dirty || !savedProject} onClick={() => { if (confirm('Descartar todas as alterações por guardar desta equipa?')) discardAll() }}>Descartar tudo</button>
          <button className="btn primary" disabled={busy || !dirty} onClick={doSave}>{busy ? 'A guardar…' : 'Guardar'}</button>
          <button className="btn ghost" onClick={() => setView(presetMode ? 'settings' : tplMode ? 'library' : 'teams')} title={presetMode ? 'Voltar às Definições' : tplMode ? 'Voltar à Biblioteca' : 'Voltar às equipas'}>✕</button>
        </div>
        <div className="viewport">
          {mode === '3d'
            ? <KitViewer texture={tex} version={texV} sharedTexture={() => sharedTexRef.current} collar={cfg('Collar', 66)} longSleeves={longSleeves} shortsModel={cfg('ShortsModel', 1)} camera={cam} armband={!!ab.show} tucked={tucked} tight={cfg('TightKit', 1) === 1} kappa={cfg('ShortSleevesModel', 1) === 2} shine={kit.shine ?? 0} shineMap={shineMap} relief={reliefMap} autoRotate={spin} snapshot={setShot3d} light={light} lightPreset={view3d.preset} env={view3d.env} background={view3d.bg || null} hideShorts={view3d.hideShorts} hideSocks={view3d.hideSocks} sockKnit={!!kit.socksFabric && showFabric} sockScale={kit.socksFabric?.scale ?? 100} sockStrength={Math.round(((kit.socksFabric?.opacity ?? 0.1) / 0.1) * 100)} sockMix={kit.socksFabric?.mix ?? 50} sockCover={sockCover} />
            : <TexView reference={reference} tex={tex} version={texV} bg={texBg} showBg={showTexBg} islands={islands} outline={showMesh ? meshImg : showOutline ? tplOutline : null} tool={tool} setTool={setTool} onPick={onPickColor}
              onBrush={(e) => {
                if (e.type === 'down') {
                  // paint into the open drawing layer, or start a new one
                  let L = kit.layers.find((l) => l.id === openLayer && l.kind === 'freeform')
                  if (!L) {
                    L = { id: uid(), kind: 'freeform', part: 'torso', visible: true, opacity: 1, color: kit.colors.shirt2, size: 24, strokes: [] }
                    const nl = L
                    up((k) => ({ ...k, layers: [...k.layers, nl] }))
                    setOpenLayer(L.id)
                  }
                  strokeRef.current = { id: L.id, pts: [Math.round(e.x), Math.round(e.y)], w: L.size ?? 24, color: fillMain(L.fill, L.color) }
                  setStrokeTick((t) => t + 1)
                } else if (e.type === 'move' && strokeRef.current) {
                  const p = strokeRef.current.pts, lx = p[p.length - 2], ly = p[p.length - 1]
                  if (Math.hypot(e.x - lx, e.y - ly) < 2) return
                  p.push(Math.round(e.x), Math.round(e.y))
                  setStrokeTick((t) => t + 1)
                } else if (e.type === 'up' && strokeRef.current) {
                  const st = strokeRef.current
                  strokeRef.current = null
                  setLayer(st.id, (x) => ({ ...x, strokes: [...(x.strokes ?? []), { pts: st.pts, w: st.w, ...(brushErase ? { erase: true } : {}) }] }))
                  setStrokeTick((t) => t + 1)
                }
              }}
              onSelect={(e) => {
                const dimOf = (id: string): { w: number; h: number } | undefined => dims[id]
                if (e.type === 'down') {
                  const cur = sel && kit.layers.find((l) => l.id === sel.id)
                  if (cur && sel) {
                    const b = layerBox(cur, dimOf)
                    const h = b && handleAt(b, sel.z, cur, e.x, e.y, e.tol)
                    if (b && h) { const [fx, fy] = toFrame(sel.z, cur, e.x, e.y); dragRef.current = { d: { L: cur, z: sel.z, h, fx, fy, box: b }, recorded: false }; return }
                  }
                  // locked layers (or members of a locked group) can't be picked in the 2D view
                  const hit = hitLayer(kit.layers.filter((l) => !l.locked && !(l.group && kit.layers.find((g) => g.id === l.group)?.locked)), e.x, e.y, dimOf)
                  if (!hit) { setSel(null); return }
                  setSel({ id: hit.L.id, z: hit.z })
                  setOpenLayer(hit.L.id)
                  const b = layerBox(hit.L, dimOf)!
                  const [fx, fy] = toFrame(hit.z, hit.L, e.x, e.y)
                  dragRef.current = { d: { L: hit.L, z: hit.z, h: 'move', fx, fy, box: b }, recorded: false }
                } else if (e.type === 'move' && dragRef.current) {
                  const r = dragRef.current
                  const patch = dragTo(r.d, e.x, e.y, e.shift)
                  // one undo step per drag
                  setProject((p) => ({ ...p, kits: p.kits.map((k) => (k.slot === kit.slot ? { ...k, layers: k.layers.map((x) => (x.id === r.d.L.id ? { ...x, ...patch } : x)) } : k)) }), !r.recorded)
                  r.recorded = true
                } else dragRef.current = null
              }}
              overlay={(g, sc) => {
                const st = strokeRef.current
                if (st && st.pts.length >= 2) {
                  // live preview of the stroke being drawn
                  g.save()
                  g.lineCap = g.lineJoin = 'round'
                  g.lineWidth = st.w
                  g.strokeStyle = g.fillStyle = brushErase ? 'rgba(128,128,128,0.6)' : st.color
                  g.beginPath(); g.moveTo(st.pts[0], st.pts[1])
                  for (let i = 2; i < st.pts.length; i += 2) g.lineTo(st.pts[i], st.pts[i + 1])
                  if (st.pts.length === 2) { g.arc(st.pts[0], st.pts[1], st.w / 2, 0, Math.PI * 2); g.fill() } else g.stroke()
                  g.restore()
                }
                const L = sel && kit.layers.find((l) => l.id === sel.id)
                if (!L || !sel || tool !== 'select') return
                const b = layerBox(L, (id) => dims[id])
                if (!b) return
                const o = boxOutline(b, sel.z, L)
                g.save()
                g.lineWidth = 1.5 / sc
                g.strokeStyle = '#2fbf71'
                g.setLineDash([6 / sc, 4 / sc])
                g.beginPath(); o.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke()
                g.setLineDash([])
                const top: [number, number] = [(o.pts[0][0] + o.pts[1][0]) / 2, (o.pts[0][1] + o.pts[1][1]) / 2]
                g.beginPath(); g.moveTo(...top); g.lineTo(...o.rot); g.stroke()
                g.fillStyle = '#fff'
                const hs = 9 / sc
                for (const [x, y] of o.pts) { g.fillRect(x - hs / 2, y - hs / 2, hs, hs); g.strokeRect(x - hs / 2, y - hs / 2, hs, hs) }
                g.beginPath(); g.arc(o.rot[0], o.rot[1], hs * 0.6, 0, Math.PI * 2); g.fill(); g.stroke()
                g.restore()
              }} />}
          <TeamColors colors={teamColors} />
          <ReferenceWindow picking={mode === '2d' && tool === 'picker'} onPick={onPickColor} />
          {mode === '3d' && (
            <div className="name-preview">
              <label className="check"><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> Nome e número</label>
              {showNames && (
                <>
                  <input className="np-name" value={sampleName} maxLength={16} onChange={(e) => setSampleName(e.target.value.toUpperCase().replace(/[^A-Z. ]/g, ''))} title="Nome de exemplo" />
                  <input className="np-num" value={sampleNum} maxLength={2} onChange={(e) => setSampleNum(e.target.value.replace(/\D/g, ''))} title="Número de exemplo" />
                </>
              )}
            </div>
          )}
          {mode === '3d' && (
            <div className="cam-buttons">
              {([['front', 'Camisola (frente)', 'base'], ['back', 'Camisola (costas)', 'back'], ['sleeve', 'Mangas', 'sleeves'], ['collar', 'Gola', 'collar'], ['shorts', 'Calções', 'shorts'], ['socks', 'Meias', 'sock']] as [CamView, string, IconName][]).map(([v, label, ic]) => <button key={v} className={'icon-cam' + (cam.view === v ? ' active' : '')} title={label} onClick={() => { setSpin(false); go(v, true) }}><Icon name={ic} size={18} /></button>)}
              <span className="cam-sep" />
              <button className={'icon-cam' + (camMenu ? ' active' : '')} title="Câmara: mais vistas, rodar, luz e imagem" onClick={() => setCamMenu(!camMenu)}><Icon name="camera" size={18} /></button>
            </div>
          )}
          {mode === '3d' && camMenu && (
            <div className="cam-buttons cam-buttons-2">
              {([['threeL', '¾ esquerda', 'rotL'], ['side', 'Lado esquerdo', 'sideL'], ['threeBack', '¾ costas', 'back'], ['sideR', 'Lado direito', 'sideR'], ['threeR', '¾ direita', 'rotR']] as [CamView, string, IconName][]).map(([v, label, ic]) => <button key={v} className={'icon-cam' + (cam.view === v ? ' active' : '')} title={label} onClick={() => { setSpin(false); go(v, true) }}><Icon name={ic} size={18} /></button>)}
              <label className="cam-light" title="Luz da cena (0 = escura, 100 = clara). Ajuda a ver a cor real."><Icon name="sun" size={16} />
                <input type="range" min={0} max={100} value={light} onChange={(e) => { const v = Number(e.target.value); setLight(v); try { localStorage.setItem('kc.light', String(v)) } catch { /* ignore */ } }} />
              </label>
              <button className={'icon-cam' + (spin ? ' active' : '')} title="Rodar o equipamento sem parar" onClick={() => setSpin(!spin)}><Icon name="spin" size={18} /></button>
              <button className={'icon-cam' + (viewMenu ? ' active' : '')} title="Vista: luz, ambiente, fundo e peças visíveis" onClick={() => setViewMenu(!viewMenu)}><Icon name="gear" size={18} /></button>
              {viewMenu && (
                <div className="view-menu">
                  <Row label="Luz"><Select value={view3d.preset} options={LIGHT_PRESETS} onChange={(preset) => setView3d({ preset })} /></Row>
                  <Row label="Ambiente"><Select value={view3d.env} options={ENVS} onChange={(env) => setView3d({ env })} /></Row>
                  <Row label="Fundo"><Select value={view3d.bg} options={[['', 'Escuro (da app)'], ['#2a2d36', 'Cinzento escuro'], ['#8a8d95', 'Cinzento'], ['#e9e9ec', 'Claro'], ['#ffffff', 'Branco'], ['#2f6b3a', 'Relva']]} onChange={(bg) => setView3d({ bg })} /></Row>
                  <div className="toggles">
                    <Toggle on={view3d.hideShorts} label="Esconder calções" onChange={(hideShorts) => setView3d({ hideShorts })} />
                    <Toggle on={view3d.hideSocks} label="Esconder meias" onChange={(hideSocks) => setView3d({ hideSocks })} />
                    <Toggle on={tucked} label="Camisola por dentro" onChange={(v) => { setTucked(v); try { localStorage.setItem('kc.tucked', v ? '1' : '0') } catch { /* ignore */ } }} />
                  </div>
                  <div className="muted small">Só muda a pré-visualização; o jogo usa a sua própria luz.</div>
                </div>
              )}
              <button className="icon-cam" title="Guardar esta vista 3D como PNG (fundo transparente)" onClick={async () => {
                const b = await shot3d.current?.()
                if (!b) return
                const p = await window.kc.saveFile(`${project.teamName}_${kit.slot}_3d.png`, new Uint8Array(await b.arrayBuffer()))
                if (p) notify('ok', 'Imagem guardada: ' + p)
              }}><Icon name="save" size={18} /></button>
            </div>
          )}
        </div>
      </section>
    </div>
    </ColorCtx.Provider>
  )
}
