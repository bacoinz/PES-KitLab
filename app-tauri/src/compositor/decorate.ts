/**
 * Preview-only: paints a sample name and numbers on a kit texture the way the game overlays them
 * (the game draws them at runtime from the _back/_leg/_name textures + config.txt, they are not part of the kit texture).
 * Placement is an approximation of the game's config.txt ranges.
 */
import type { Box } from './numbers'
import { NUMBER_DEFAULTS as ND } from '../model/design'
import { canvas, ctx2d } from './images'
import { SEAM } from './uv'

export interface GlyphAtlas { img: OffscreenCanvas; boxes: Box[]; chars: string }

export interface DecorateInput {
  back?: GlyphAtlas // digits 0-9
  leg?: GlyphAtlas // digits 0-9
  chest?: GlyphAtlas // own chest digits (else back)
  name?: GlyphAtlas // A-Z .
  config: Record<string, number | string>
  playerName: string
  number: string
  nameBelow?: boolean
  /** only this part (shininess map of the 3D preview) */
  only?: 'back' | 'name' | 'chest' | 'leg'
}

const num = (c: Record<string, number | string>, k: string, d: number): number => {
  const v = Number(c[k])
  return Number.isFinite(v) ? v : d
}

/** Draw a string from an atlas, centred on (0,0) of the current transform, `h` tall. */
function drawString(g: OffscreenCanvasRenderingContext2D, a: GlyphAtlas, text: string, h: number, spacing: number, stretch = 1, maxW = Infinity): void {
  const glyphs = [...text.toUpperCase()].map((ch) => {
    const i = a.chars.indexOf(ch)
    return i >= 0 ? a.boxes[i] : null
  })
  const widths = glyphs.map((b) => (b ? ((b.x1 - b.x0) / Math.max(1, b.y1 - b.y0)) * h * stretch : h * 0.35))
  let total = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, glyphs.length - 1)
  const k = total > maxW ? maxW / total : 1
  total *= k
  let x = -total / 2
  glyphs.forEach((b, i) => {
    const w = widths[i] * k
    if (b) g.drawImage(a.img, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, x, -h / 2, w, h)
    x += w + spacing * k
  })
}

export function decorateKit(tex: OffscreenCanvas, inp: DecorateInput): OffscreenCanvas {
  const out = canvas(tex.width, tex.height)
  const g = ctx2d(out)
  g.drawImage(tex, 0, 0)
  g.drawImage(decorationOverlay(inp), 0, 0, tex.width, tex.height)
  return out
}

/** Transparent 2048² canvas with only the sample name / numbers (composited on the GPU as the last pass). */
export function decorationOverlay(inp: DecorateInput): OffscreenCanvas {
  const out = new OffscreenCanvas(2048, 2048)
  const g = out.getContext('2d')!
  draw(g, inp)
  return out
}

function draw(g: OffscreenCanvasRenderingContext2D, inp: DecorateInput): void {
  const c = inp.config

  // back (stored rotated 180° above the shoulder seam): local +y = down the player's back
  g.save()
  g.translate(1024, SEAM)
  g.rotate(Math.PI)
  const numH = 120 + num(c, 'BackNumberSize', ND.BackNumberSize) * 8 // ~312 px
  const numTop = 150 + num(c, 'BackNumberY', ND.BackNumberY) * 11
  const spacing = (num(c, 'BackNumberSpacing', ND.BackNumberSpacing) - 7) * 4
  const want = (p: string): boolean => !inp.only || inp.only === p
  if (inp.back && inp.number && want('back')) {
    g.save(); g.translate(0, numTop + numH / 2); drawString(g, inp.back, inp.number, numH, spacing); g.restore()
  }
  if (inp.name && inp.playerName && num(c, 'Name', 0) === 0 && want('name')) {
    const nameH = 30 + num(c, 'NameSize', ND.NameSize) * 5
    const stretch = 0.85 + num(c, 'NameStretch', ND.NameStretch) * 0.1
    // NameY is absolute (0 = top of the back, 39 = low); it no longer follows the number
    const y = inp.nameBelow ? numTop + numH + 18 + nameH / 2 + (num(c, 'NameY', ND.NameY) - 29) * 3 : 30 + num(c, 'NameY', ND.NameY) * 6
    g.save()
    g.translate(0, y)
    const shape = num(c, 'NameShape', 1)
    if (shape > 0) {
      // curved names: draw letter by letter on an arc
      const text = inp.playerName.toUpperCase()
      const r = 5200 / shape
      const each = Math.min(nameH * 0.78 * stretch, 520 / Math.max(1, text.length))
      ;[...text].forEach((ch, i) => {
        const a = ((i - (text.length - 1) / 2) * each) / r
        g.save()
        g.translate(Math.sin(a) * r, r - Math.cos(a) * r)
        g.rotate(a)
        drawString(g, inp.name!, ch, nameH, 0, stretch)
        g.restore()
      })
    } else drawString(g, inp.name, inp.playerName, nameH, 6, stretch, 560)
    g.restore()
  }
  g.restore()

  // chest number (front, upright below the seam)
  const chestSize = num(c, 'ChestNumberSize', 14)
  const chestAtlas = inp.chest ?? inp.back
  if (chestAtlas && inp.number && chestSize > 0 && want('chest')) {
    const h = 30 + chestSize * 5
    g.save()
    g.translate(1024 + (num(c, 'ChestNumberX', 15) - 15) * 14, SEAM + 120 + num(c, 'ChestNumberY', 15) * 6)
    drawString(g, chestAtlas, inp.number, h, spacing * (h / numH))
    g.restore()
  }

  // shorts number: legs are stored rotated (right leg +90°, left leg -90°), front of the leg ≈ y 1745
  const shortsSize = num(c, 'ShortsNumberSize', ND.ShortsNumberSize)
  const legAtlas = inp.leg ?? inp.back
  if (legAtlas && inp.number && shortsSize > 0 && want('leg')) {
    const h = 26 + shortsSize * 4
    // Sider: 0 = left, 1 = right (the player's legs; left = the island at texture x > 1024, as for the shorts logos)
    const left = num(c, 'ShortsNumberSide', ND.ShortsNumberSide) === 0
    g.save()
    if (left) { g.translate(1898 - (num(c, 'ShortsNumberY', ND.ShortsNumberY) - 7) * 10, 1745 + (num(c, 'ShortsNumberX', ND.ShortsNumberX) - 7) * 10); g.rotate(-Math.PI / 2) }
    else { g.translate(150 + (num(c, 'ShortsNumberY', ND.ShortsNumberY) - 7) * 10, 1745 - (num(c, 'ShortsNumberX', ND.ShortsNumberX) - 7) * 10); g.rotate(Math.PI / 2) }
    drawString(g, legAtlas, inp.number, h, 2)
    g.restore()
  }
}
