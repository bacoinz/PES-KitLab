/**
 * The kit template (public/kit-template.png, from "KIT Template.png"): only its outlines are used — the parts are
 * every non-transparent pixel. The 2D view paints the background outside them and can draw their contours.
 */
const S = 2048
let cache: Promise<{ mask: OffscreenCanvas; outline: OffscreenCanvas } | null> | null = null

export function kitTemplate(): Promise<{ mask: OffscreenCanvas; outline: OffscreenCanvas } | null> {
  cache ??= (async () => {
    const r = await fetch('/kit-template.png')
    if (!r.ok) return null
    const img = await createImageBitmap(await r.blob())
    const src = new OffscreenCanvas(S, S), sg = src.getContext('2d', { willReadFrequently: true })!
    sg.drawImage(img, 0, 0, S, S)
    const d = sg.getImageData(0, 0, S, S).data
    const inside = new Uint8Array(S * S)
    for (let i = 0; i < S * S; i++) inside[i] = d[i * 4 + 3] > 16 ? 1 : 0
    // the two boxes at the bottom (x 461..659 and 1388..1586, y ≥ 1905) are design notes, not kit parts
    for (let y = 1905; y < S; y++) for (const [x0, x1] of [[455, 665], [1382, 1592]]) for (let x = x0; x <= x1; x++) inside[y * S + x] = 0
    const mask = new OffscreenCanvas(S, S), mg = mask.getContext('2d')!
    const md = mg.createImageData(S, S)
    const outline = new OffscreenCanvas(S, S), og = outline.getContext('2d')!
    const od = og.createImageData(S, S)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x
      if (!inside[i]) continue
      md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = md.data[i * 4 + 3] = 255
      // contour: an inside pixel touching the outside (or the texture edge)
      // (2 px wide so it stays visible when the view is zoomed out)
      let edge = x < 2 || y < 2 || x > S - 3 || y > S - 3
      for (let k = 1; k <= 2 && !edge; k++) edge = !inside[i - k] || !inside[i + k] || !inside[i - k * S] || !inside[i + k * S]
      if (edge) { od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = 255; od.data[i * 4 + 3] = 255 }
    }
    mg.putImageData(md, 0, 0)
    og.putImageData(od, 0, 0)
    return { mask, outline }
  })().catch(() => null)
  return cache
}
