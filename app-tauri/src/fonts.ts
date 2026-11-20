import { useSyncExternalStore } from 'react'
import { SYSTEM_FONTS } from './compositor/numbers'

/**
 * Fonts of the PC. The list comes from the app core (every font file in the Windows font folders) and is checked
 * again when the window gets focus and every few seconds, so a font installed while the app is open shows up by itself.
 */
const base = [...SYSTEM_FONTS]
const extra = new Set<string>() // fonts loaded from a file by the user
let installed: string[] = []
let list: string[] = [...SYSTEM_FONTS]
const subs = new Set<() => void>()

function rebuild(): void {
  const next = [...new Set([...extra, ...installed, ...(installed.length ? [] : base)])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  if (next.length === list.length && next.every((f, i) => f === list[i])) return
  list = next
  SYSTEM_FONTS.splice(0, SYSTEM_FONTS.length, ...next)
  subs.forEach((f) => f())
}

export function addUserFont(name: string): void { extra.add(name); rebuild() }

export async function refreshFonts(): Promise<void> {
  try {
    const f = await window.kc.listFonts()
    if (f.length) { installed = f; rebuild() }
  } catch { /* keep the current list */ }
}

let started = false
export function startFontWatcher(): void {
  if (started) return
  started = true
  void refreshFonts()
  window.addEventListener('focus', () => { void refreshFonts() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshFonts() })
  setInterval(() => { if (!document.hidden) void refreshFonts() }, 4000)
}

/** The current font list; the component re-renders when it changes. */
export function useFontList(): string[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb) } }, () => list)
}
