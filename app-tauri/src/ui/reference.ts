/**
 * Reference image: a photo or screenshot of a real kit to copy from. Session only: it is not part of the kit design,
 * not in the undo history, never in the exported texture and never in the 3D view. It can be shown in a floating
 * window (move, resize, zoom) and / or over (or under) the kit on the 2D texture view.
 */
import { useEffect } from 'react'
import { create } from 'zustand'

export interface RefOverlay { on: boolean; above: boolean; opacity: number /* 0 … 100 */; scale: number /* % of "fits the texture" */; dx: number; dy: number; rot: number }
/** The window sits `dr` px from the right edge and `db` px from the bottom edge of the viewer. */
export interface RefWin { open: boolean; min: boolean; dr: number; db: number; w: number; h: number }

export const WIN_DEFAULT: RefWin = { open: true, min: false, dr: 14, db: 108, w: 300, h: 260 }
const OVERLAY_DEFAULT: RefOverlay = { on: false, above: true, opacity: 50, scale: 100, dx: 0, dy: 0, rot: 0 }
const LS = 'kc.refWin'

function savedWin(): RefWin {
  try {
    const j = JSON.parse(localStorage.getItem(LS) ?? 'null') as Partial<RefWin> | null
    if (j && [j.dr, j.db, j.w, j.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return { ...WIN_DEFAULT, dr: j.dr!, db: j.db!, w: j.w!, h: j.h! }
  } catch { /* no storage */ }
  return { ...WIN_DEFAULT }
}

interface RefState {
  url: string | null
  name: string
  img: HTMLImageElement | null
  overlay: RefOverlay
  win: RefWin
  setOverlay(p: Partial<RefOverlay>): void
  setWin(p: Partial<RefWin>): void
  resetWin(): void
  load(blob: Blob, name: string): Promise<void>
  clear(): void
}

export const useRef2 = create<RefState>((set, get) => ({
  url: null,
  name: '',
  img: null,
  overlay: { ...OVERLAY_DEFAULT },
  win: savedWin(),
  setOverlay: (p) => set((s) => ({ overlay: { ...s.overlay, ...p } })),
  setWin: (p) => {
    const win = { ...get().win, ...p }
    set({ win })
    try { localStorage.setItem(LS, JSON.stringify({ dr: win.dr, db: win.db, w: win.w, h: win.h })) } catch { /* no storage */ }
  },
  resetWin: () => get().setWin({ ...WIN_DEFAULT, open: true }),
  load: async (blob, name) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url
    try { await img.decode() } catch { URL.revokeObjectURL(url); throw new Error('Não consegui abrir essa imagem.') }
    const old = get().url
    set({ url, name, img, overlay: { ...get().overlay, dx: 0, dy: 0, rot: 0, scale: 100 }, win: { ...get().win, open: true, min: false } })
    if (old) URL.revokeObjectURL(old)
  },
  clear: () => {
    const old = get().url
    set({ url: null, name: '', img: null, overlay: { ...OVERLAY_DEFAULT } })
    if (old) URL.revokeObjectURL(old)
  }
}))

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }
export const REF_EXTS = Object.keys(MIME)

/** Opens an image file from disk as the reference. */
export async function loadReferenceFromPath(path: string): Promise<void> {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  if (!MIME[ext]) throw new Error('Escolhe uma imagem PNG, JPG, WebP, GIF ou BMP.')
  const bytes = await window.kc.readFile(path)
  await useRef2.getState().load(new Blob([bytes], { type: MIME[ext] }), path.split(/[\\/]/).pop() ?? 'referência')
}

/** Paste (Ctrl+V) or drop an image anywhere over the viewer to use it as the reference. */
export function useReferenceInput(onError: (msg: string) => void): void {
  useEffect(() => {
    const take = (f: File | null | undefined): boolean => {
      if (!f || !f.type.startsWith('image/')) return false
      useRef2.getState().load(f, f.name || 'referência').catch((e) => onError(String((e as Error).message ?? e)))
      return true
    }
    const onPaste = (e: ClipboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      for (const it of e.clipboardData?.items ?? []) if (it.kind === 'file' && take(it.getAsFile())) { e.preventDefault(); return }
    }
    const inViewer = (e: DragEvent): boolean => !!(e.target as HTMLElement | null)?.closest?.('.viewport') && !!e.dataTransfer?.types.includes('Files')
    const onOver = (e: DragEvent): void => { if (inViewer(e)) e.preventDefault() }
    const onDrop = (e: DragEvent): void => { if (inViewer(e)) { e.preventDefault(); take(e.dataTransfer?.files[0]) } }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('paste', onPaste); window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop) }
  }, [onError])
}

// exposed for scripted verification runs (KC_SCRIPT)
;(window as unknown as { __kcRef: typeof useRef2 }).__kcRef = useRef2
