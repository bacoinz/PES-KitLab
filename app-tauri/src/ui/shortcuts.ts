/**
 * Keyboard shortcuts: one catalogue of commands (id, label, default key), one `keydown` listener for the whole app,
 * and the user's own keys (Settings → Atalhos de teclado) on top of the defaults. Screens plug in the code that runs
 * a command with `registerHandlers`; a handler that returns `false` did nothing, so the key is left to the browser.
 */
import { useSyncExternalStore } from 'react'
import { useApp } from '../state'

export type Ctx = 'global' | 'editor' | 'bulk'
export interface CmdDef { id: string; label: string; group: string; ctx: Ctx; keys: string | null; /** also fires while typing in a field */ inInput?: boolean }
export type Handler = () => boolean | void

export const GROUPS = ['Geral', 'Editor', 'Camadas', 'Equipas em massa'] as const

const TAB_NAMES = ['Configurações', 'Camisola', 'Calções', 'Meias', 'Braçadeira', 'Logos', 'Números']

export const CATALOG: CmdDef[] = [
  { id: 'palette.open', label: 'Painel de comandos', group: 'Geral', ctx: 'global', keys: 'Ctrl+K', inInput: true },
  { id: 'help.open', label: 'Mostrar os atalhos', group: 'Geral', ctx: 'global', keys: '?' },
  { id: 'edit.undo', label: 'Desfazer', group: 'Geral', ctx: 'global', keys: 'Ctrl+Z' },
  { id: 'edit.redo', label: 'Refazer', group: 'Geral', ctx: 'global', keys: 'Ctrl+Y' },
  { id: 'view.toggle', label: 'Alternar vista 3D / textura 2D', group: 'Editor', ctx: 'editor', keys: 'Ctrl+Tab', inInput: true },
  { id: 'tab.prev', label: 'Aba anterior', group: 'Editor', ctx: 'editor', keys: 'Ctrl+Shift+ArrowLeft' },
  { id: 'tab.next', label: 'Aba seguinte', group: 'Editor', ctx: 'editor', keys: 'Ctrl+Shift+ArrowRight' },
  ...TAB_NAMES.map((n, i): CmdDef => ({ id: 'tab.' + (i + 1), label: 'Ir para a aba ' + n, group: 'Editor', ctx: 'editor', keys: 'Alt+' + (i + 1), inInput: true })),
  { id: 'layer.left', label: 'Mover a camada 1 px para a esquerda', group: 'Camadas', ctx: 'editor', keys: 'ArrowLeft' },
  { id: 'layer.right', label: 'Mover a camada 1 px para a direita', group: 'Camadas', ctx: 'editor', keys: 'ArrowRight' },
  { id: 'layer.up', label: 'Mover a camada 1 px para cima', group: 'Camadas', ctx: 'editor', keys: 'ArrowUp' },
  { id: 'layer.down', label: 'Mover a camada 1 px para baixo', group: 'Camadas', ctx: 'editor', keys: 'ArrowDown' },
  { id: 'layer.left10', label: 'Mover a camada 10 px para a esquerda', group: 'Camadas', ctx: 'editor', keys: 'Shift+ArrowLeft' },
  { id: 'layer.right10', label: 'Mover a camada 10 px para a direita', group: 'Camadas', ctx: 'editor', keys: 'Shift+ArrowRight' },
  { id: 'layer.up10', label: 'Mover a camada 10 px para cima', group: 'Camadas', ctx: 'editor', keys: 'Shift+ArrowUp' },
  { id: 'layer.down10', label: 'Mover a camada 10 px para baixo', group: 'Camadas', ctx: 'editor', keys: 'Shift+ArrowDown' },
  { id: 'layer.forward', label: 'Subir a camada na lista', group: 'Camadas', ctx: 'editor', keys: ']' },
  { id: 'layer.backward', label: 'Descer a camada na lista', group: 'Camadas', ctx: 'editor', keys: '[' },
  { id: 'layer.delete', label: 'Apagar a camada', group: 'Camadas', ctx: 'editor', keys: 'Delete' },
  { id: 'layer.duplicate', label: 'Duplicar a camada', group: 'Camadas', ctx: 'editor', keys: 'Ctrl+D' },
  { id: 'layer.hide', label: 'Esconder / mostrar a camada', group: 'Camadas', ctx: 'editor', keys: 'H' },
  { id: 'layer.lock', label: 'Bloquear / desbloquear a camada', group: 'Camadas', ctx: 'editor', keys: 'L' },
  { id: 'layer.bigger', label: 'Aumentar a camada', group: 'Camadas', ctx: 'editor', keys: '+' },
  { id: 'layer.smaller', label: 'Diminuir a camada', group: 'Camadas', ctx: 'editor', keys: '-' },
  { id: 'layer.rotate', label: 'Rodar a camada 15°', group: 'Camadas', ctx: 'editor', keys: 'R' },
  { id: 'bulk.generate', label: 'Gerar todas as equipas', group: 'Equipas em massa', ctx: 'bulk', keys: 'Ctrl+Enter' }
]
const BY_ID = new Map(CATALOG.map((c) => [c.id, c]))

/** Keys the web view uses itself (reload, print, find): never reachable, never assignable. */
export const RESERVED = ['F5', 'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+P', 'Ctrl+F', 'Ctrl+Shift+F5']

// ---- user keys (id → combo, or null = no shortcut); only what differs from the defaults
let user: Record<string, string | null> = {}
let version = 0
const subs = new Set<() => void>()
const bump = (): void => { version++; subs.forEach((f) => f()) }
export function setUserKeys(u: Record<string, string | null> | undefined): void { user = { ...(u ?? {}) }; bump() }
export const userKeys = (): Record<string, string | null> => user
export function keysOf(id: string): string | null { return id in user ? user[id] : BY_ID.get(id)?.keys ?? null }
/** re-render when any key changes */
export function useShortcutKeys(): number { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => version) }

/** Another command that uses this combo in a screen where both can fire. */
export function conflictOf(id: string, combo: string): CmdDef | undefined {
  const me = BY_ID.get(id)
  return CATALOG.find((c) => c.id !== id && keysOf(c.id) === combo && (c.ctx === me?.ctx || c.ctx === 'global' || me?.ctx === 'global'))
}

// ---- key → combo text ("Ctrl+Shift+ArrowLeft")
export function comboOf(e: KeyboardEvent): string | null {
  const k = e.key
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'Dead', 'Unidentified'].includes(k)) return null
  const letter = /^Key[A-Z]$/.test(e.code), digit = /^Digit\d$/.test(e.code)
  // AltGr (Ctrl+Alt on Windows) types symbols such as [ ] on Portuguese / Spanish keyboards
  const ag = e.getModifierState?.('AltGraph') ?? false
  const key = letter ? e.code.slice(3) : digit ? e.code.slice(5) : k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k
  const symbol = k.length === 1 && !letter && !digit && !/[a-z0-9]/i.test(k)
  const mods: string[] = []
  if ((e.ctrlKey || e.metaKey) && !ag) mods.push('Ctrl')
  if (e.altKey && !ag) mods.push('Alt')
  if (e.shiftKey && !symbol) mods.push('Shift')
  return [...mods, key].join('+')
}

const NAMES: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Del', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', Space: 'Espaço' }
export function prettyKeys(combo: string | null): string {
  if (!combo) return '—'
  const plus = combo.endsWith('++') // the "+" key itself
  const parts = (plus ? combo.slice(0, -2) : combo).split('+').filter((p) => p !== '')
  if (plus) parts.push('+')
  return parts.map((p) => NAMES[p] ?? p).join(' + ')
}

// ---- who runs what
type Provider = (id: string) => Handler | undefined
const providers = new Set<Provider>()
export function registerHandlers(p: Provider): () => void { providers.add(p); return () => { providers.delete(p) } }
export function handlerOf(id: string): Handler | undefined { for (const p of providers) { const h = p(id); if (h) return h } return undefined }
export function ctxActive(c: Ctx): boolean { const v = useApp.getState().view; return c === 'global' || (c === 'editor' && v === 'editor') || (c === 'bulk' && v === 'bulk') }
/** Commands that can run right now (command palette). */
export const availableCommands = (): CmdDef[] => CATALOG.filter((c) => ctxActive(c.ctx) && !!handlerOf(c.id))
export function runCommand(id: string): void { handlerOf(id)?.() }

/** True while the Settings screen waits for a new combo. */
let capturing = false
export const setCapturing = (v: boolean): void => { capturing = v }

const NON_TEXT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  if (t.tagName === 'INPUT') return !NON_TEXT.includes((t as HTMLInputElement).type)
  return t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
}

function onKey(e: KeyboardEvent): void {
  if (capturing) return
  const combo = comboOf(e)
  if (!combo) return
  if (RESERVED.includes(combo)) { e.preventDefault(); return }
  // dialogs with their own keys (colour picker, pen, eyedropper) keep them; the command palette is not one of them
  if (document.querySelector('.modal-bg, .cp-bg, .eyedrop-overlay')) return
  const typing = isTyping(e)
  for (const c of CATALOG) {
    if (keysOf(c.id) !== combo || !ctxActive(c.ctx) || (typing && !c.inInput)) continue
    const h = handlerOf(c.id)
    if (!h || h() === false) continue
    e.preventDefault(); e.stopPropagation()
    return
  }
}
let installed = false
export function installShortcuts(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKey, true)
}
