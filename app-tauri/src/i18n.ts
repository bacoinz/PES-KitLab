/**
 * Interface translation (PT → EN / ES). The UI is written in Portuguese; this layer watches the DOM and swaps text
 * nodes and the title / placeholder / aria-label attributes by exact match (after trimming and setting aside
 * decorations such as "…", "▸", "✓", ":"). Messages built with values use RULES; native confirm/alert/prompt are
 * wrapped too. 'pt' = nothing changes (the original text is put back).
 */
import { DICT } from './i18n-dict'

export type Lang = 'pt' | 'en' | 'es'
let lang: Lang = 'pt'
/** Strings seen without a translation (for checking coverage: window.__i18nMiss). */
const MISS = new Set<string>()
;(window as unknown as { __i18nMiss: Set<string> }).__i18nMiss = MISS
const LI = { en: 0, es: 1 } as const

/** Messages with values: [regex, en, es]; $1.. are the captured groups (translated too when they are known). */
const RULES: [RegExp, string, string][] = [
  [/^Gola (\d+)$/, 'Collar $1', 'Cuello $1'],
  [/^Gola · (.+)$/, 'Collar · $1', 'Cuello · $1'],
  [/^Template: (.+)$/, 'Template: $1', 'Plantilla: $1'],
  [/^Calções (\d+)$/, 'Shorts $1', 'Pantalón $1'],
  [/^Patrocinador (\d+)$/, 'Sponsor $1', 'Patrocinador $1'],
  [/^Badge (\d+)$/, 'Badge $1', 'Insignia $1'],
  [/^Costas (\d+)$/, 'Back $1', 'Espalda $1'],
  [/^Cor (\d+)$/, 'Colour $1', 'Color $1'],
  [/^Todas as golas \((\d+)\)$/, 'All collars ($1)', 'Todos los cuellos ($1)'],
  [/^Golas principais \((\d+) de (\d+)\)$/, 'Main collars ($1 of $2)', 'Cuellos principales ($1 de $2)'],
  [/^— de qualquer equipa do jogo \((\d+)\)$/, '— from any team in the game ($1)', '— de cualquier equipo del juego ($1)'],
  [/^A exportar (\d+)\/(\d+): (.+)$/, 'Exporting $1/$2: $3', 'Exportando $1/$2: $3'],
  [/^A gerar (\d+)\/(\d+): (.+)$/, 'Generating $1/$2: $3', 'Generando $1/$2: $3'],
  [/^A guardar (\d+)\/(\d+): (.+)$/, 'Saving $1/$2: $3', 'Guardando $1/$2: $3'],
  [/^A desenhar (.+)$/, 'Drawing $1', 'Dibujando $1'],
  [/^(\d+) de (\d+) equipas guardadas — exporta-as para o jogo no ecrã Equipas$/, '$1 of $2 teams saved — export them to the game in the Teams screen', '$1 de $2 equipos guardados — expórtalos al juego en la pantalla Equipos'],
  [/^(\d+) equipa\(s\) exportada\(s\) para o jogo$/, '$1 team(s) exported to the game', '$1 equipo(s) exportado(s) al juego'],
  [/^Cor (#[0-9a-fA-F]+) aplicada ao último campo de cor$/, 'Colour $1 applied to the last colour field', 'Color $1 aplicado al último campo de color'],
  [/^Cor (#[0-9a-fA-F]+) copiada — clica num campo de cor para a usar$/, 'Colour $1 copied — click a colour field to use it', 'Color $1 copiado — haz clic en un campo de color para usarlo'],
  [/^(\S+) → (\S+) em todo o equipamento$/, '$1 → $2 across the whole kit', '$1 → $2 en toda la equipación'],
  [/^De certeza\? Os emblemas, marcas e patrocínios de (.+) vão ser substituídos pelos deste kit\.$/, 'Are you sure? The badges, brands and sponsors of $1 will be replaced by this kit\'s.', '¿Seguro? Los escudos, marcas y patrocinadores de $1 se sustituirán por los de esta equipación.'],
  [/^De certeza\? Os números, nomes, fontes e posições de (.+) vão ser substituídos pelos deste kit\.$/, 'Are you sure? The numbers, names, fonts and positions of $1 will be replaced by this kit\'s.', '¿Seguro? Los números, nombres, fuentes y posiciones de $1 se sustituirán por los de esta equipación.'],
  [/^Eliminar o equipamento (.+)\? \(Só fica definitivo quando guardares\.\)$/, 'Delete the $1 kit? (It only becomes final when you save.)', '¿Eliminar la equipación $1? (Solo será definitivo cuando guardes.)'],
  [/^Apagar a versão "(.+)"\? Não pode ser desfeito\.$/, 'Delete the version "$1"? This cannot be undone.', '¿Borrar la versión "$1"? No se puede deshacer.'],
  [/^Há alterações por guardar em (.+)\. Continuar sem guardar\?$/, 'There are unsaved changes in $1. Continue without saving?', 'Hay cambios sin guardar en $1. ¿Continuar sin guardar?'],
  [/^Exportar (\d+) equipa\(s\) com alterações para o jogo\? Os originais podem ser repostos em "Versões"\.$/, 'Export $1 team(s) with changes to the game? The originals can be restored in "Versions".', '¿Exportar $1 equipo(s) con cambios al juego? Los originales se pueden restaurar en "Versiones".'],
  [/^Apagar o trabalho guardado de (.+)\? O que já estiver exportado no jogo não muda\.$/, 'Delete the saved work for $1? What is already exported to the game does not change.', '¿Borrar el trabajo guardado de $1? Lo que ya esté exportado al juego no cambia.'],
  [/^A pasta "(.+)" ainda está vazia\.$/, 'The "$1" folder is still empty.', 'La carpeta "$1" todavía está vacía.'],
  [/^(.+) \(jogo\)$/, '$1 (game)', '$1 (juego)'],
  [/^(\d+) camada\(s\)\. Para pôr outra camada no grupo, abre-a e escolhe o grupo\.$/, '$1 layer(s). To put another layer in the group, open it and choose the group.', '$1 capa(s). Para poner otra capa en el grupo, ábrela y elige el grupo.'],
  [/^Grupo (\d+)$/, 'Group $1', 'Grupo $1'],
  [/^(\d+) equipas$/, '$1 teams', '$1 equipos'],
  [/^GR (\d+)$/, 'GK $1', 'POR $1'],
  [/^(.+) — 1ª divisão$/, '$1 — 1st division', '$1 — 1.ª división'],
  [/^(.+) \(cópia\)$/, '$1 (copy)', '$1 (copia)'],
  [/^Máscara: (.+) → (.+)$/, 'Mask: $1 → $2', 'Máscara: $1 → $2'],
  [/^Máscara: (.+) — clica para tirar$/, 'Mask: $1 — click to remove', 'Máscara: $1 — haz clic para quitarla'],
  [/^Template (guardado|carregado): (.+)$/, 'Template $1: $2', 'Plantilla $1: $2'],
  [/^Apagar o template "(.+)"\?$/, 'Delete the template "$1"?', '¿Borrar la plantilla "$1"?'],
  [/^(\d+) camadas (copiadas|coladas)$/, '$1 layers copied/pasted', '$1 capas $2'],
  [/^Colar \((\d+) camadas\)$/, 'Paste ($1 layers)', 'Pegar ($1 capas)'],
  [/^(.+) já é usado em "(.+)"\. Trocar\? \(O outro fica sem atalho\.\)$/, '$1 is already used for "$2". Swap? (The other one loses its shortcut.)', '$1 ya se usa en "$2". ¿Cambiar? (El otro se queda sin atajo.)'],
  [/^Guardado: (.+) — usados nos kits novos$/, 'Saved: $1 — used for new kits', 'Guardado: $1 — usadas en las equipaciones nuevas']
]

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
const PRE = /^([+●🎲▶·—⟳✎📁⬆\-]+\s*)/u
const SUF = /(\s*(?:…|\.\.\.|▸|✓|:|·|\(\d+\)))+$/

function look(s: string): string | undefined {
  const e = DICT[s]
  if (e && lang !== 'pt') return e[LI[lang as 'en' | 'es']]
  return undefined
}

/** Translate one string (already PT). Returns the same string when nothing is known. */
export function t(src: string): string {
  if (lang === 'pt' || !src) return src
  const lead = src.match(/^\s*/)![0], trail = src.match(/\s*$/)![0]
  const s = norm(src)
  if (!s || !/[A-Za-zÀ-ú]/.test(s)) return src
  const out = tr(s)
  if (out === undefined) { MISS.add(s); return src }
  return lead + out + trail
}

function tr(s: string, depth = 0): string | undefined {
  const d = look(s)
  if (d !== undefined) return d
  // decorations around a known core
  const p = s.match(PRE)?.[1] ?? '', rest = s.slice(p.length)
  const sf = rest.match(SUF)?.[0] ?? '', core = rest.slice(0, rest.length - sf.length).trim()
  if ((p || sf) && core && core !== s) {
    const c = look(core) ?? (depth < 2 ? tr(core, depth + 1) : undefined)
    if (c !== undefined) return p + c + sf
  }
  for (const [re, en, es] of RULES) {
    const m = s.match(re)
    if (m) return (lang === 'en' ? en : es).replace(/\$(\d)/g, (_, i) => { const g = m[Number(i)] ?? ''; return look(g) ?? g })
  }
  if (depth < 2) {
    for (const sep of [' · ', ' — ', ': ', ' → ', ' / ']) {
      if (!s.includes(sep)) continue
      const parts = s.split(sep)
      let hit = false
      const o = parts.map((x) => { const y = look(x.trim()) ?? tr(x.trim(), depth + 1); if (y !== undefined) { hit = true; return y } return x })
      if (hit) return o.join(sep)
    }
  }
  return undefined
}

// ---------------------------------------------------------------- DOM
const ATTRS = ['title', 'placeholder', 'aria-label']
const textSrc = new WeakMap<Text, { src: string; out: string }>()
const attrSrc = new WeakMap<Element, Record<string, { src: string; out: string }>>()
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'svg'])

function skipNode(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || (e as HTMLElement).isContentEditable || e.hasAttribute('data-notr')) return true
  }
  return false
}

function doText(n: Text): void {
  const rec = textSrc.get(n)
  if (rec && n.data === rec.out) return
  const src = n.data
  if (skipNode(n.parentElement)) return
  const out = t(src)
  textSrc.set(n, { src, out })
  if (out !== src) n.data = out
}

function doAttrs(el: Element): void {
  if (skipNode(el)) return
  let rec = attrSrc.get(el)
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v === null) continue
    const r = rec?.[a]
    if (r && v === r.out) continue
    const out = t(v)
    if (!rec) { rec = {}; attrSrc.set(el, rec) }
    rec[a] = { src: v, out }
    if (out !== v) el.setAttribute(a, out)
  }
}

function walk(root: Node): void {
  if (root.nodeType === 3) { doText(root as Text); return }
  if (root.nodeType !== 1) return
  doAttrs(root as Element)
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) doText(n as Text)
    else doAttrs(n as Element)
  }
}

/** Put the Portuguese back (when switching languages the original is the source). */
function restore(root: Node): void {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n: Node | null = root; n; n = w.nextNode()) {
    if (n.nodeType === 3) { const r = textSrc.get(n as Text); if (r && (n as Text).data === r.out) (n as Text).data = r.src; textSrc.delete(n as Text) }
    else if (n.nodeType === 1) {
      const el = n as Element, rec = attrSrc.get(el)
      if (rec) { for (const a in rec) if (el.getAttribute(a) === rec[a].out) el.setAttribute(a, rec[a].src); attrSrc.delete(el) }
    }
  }
}

let obs: MutationObserver | null = null
let wrapped = false

function wrapDialogs(): void {
  if (wrapped) return
  wrapped = true
  const c = window.confirm.bind(window), a = window.alert.bind(window), p = window.prompt.bind(window)
  window.confirm = (m?: string) => c(m === undefined ? m : t(String(m)))
  window.alert = (m?: unknown) => a(m === undefined ? m : t(String(m)))
  window.prompt = (m?: string, d?: string) => p(m === undefined ? m : t(String(m)), d)
}

export function getLang(): Lang { return lang }

export function setLang(l: Lang | undefined): void {
  const next: Lang = l === 'en' || l === 'es' ? l : 'pt'
  if (next === lang && (obs || next === 'pt')) return
  restore(document.body)
  lang = next
  document.documentElement.lang = next === 'pt' ? 'pt-PT' : next
  wrapDialogs()
  if (next === 'pt') { obs?.disconnect(); obs = null; return }
  walk(document.body)
  if (!obs) {
    obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target as Text)
        else if (m.type === 'attributes') doAttrs(m.target as Element)
        else m.addedNodes.forEach(walk)
      }
    })
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  }
}
