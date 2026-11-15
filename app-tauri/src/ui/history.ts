/** Short names for the undo steps (history panel): what changed between two versions of the project. */
import type { KitDesign, TeamProject } from '../model/design'
import { SLOT_LABEL } from '../model/design'

const KEY_LABEL: Record<string, string> = {
  layers: 'Camadas', logos: 'Logos e patrocínios', colors: 'Cores', fills: 'Cores', numbers: 'Números e nomes', armband: 'Braçadeira',
  collar: 'Gola', cuffs: 'Punhos', config: 'Configuração', base: 'Base do kit', sleevePattern: 'Mangas', shortsPattern: 'Calções',
  socksPattern: 'Meias', raglan: 'Mangas com ombros', sleeveAfter: 'Ordem das mangas', baseAfter: 'Ordem da base', fabric: 'Tecido',
  shine: 'Brilho', logoShine: 'Brilho dos logos', numberShine: 'Brilho dos números', sleeveStitch: 'Costura das mangas', templateId: 'Template'
}

function layerName(L: { name?: string; kind: string; text?: string }): string {
  return L.name || (L.kind === 'text' ? 'Texto ' + (L.text ?? '') : ({ design: 'Design', panel: 'Painel', shape: 'Forma', image: 'Imagem', texture: 'Padrão', vector: 'Caneta', group: 'Grupo', collar: 'Gola', pattern: 'Design', freeform: 'Pincel' } as Record<string, string>)[L.kind] ?? L.kind)
}

function kitChange(a: KitDesign, b: KitDesign): string {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = (a as unknown as Record<string, unknown>)[k], y = (b as unknown as Record<string, unknown>)[k]
    if (x === y || JSON.stringify(x) === JSON.stringify(y)) continue
    if (k === 'layers') {
      const la = a.layers, lb = b.layers
      if (lb.length > la.length) { const n = lb.find((l) => !la.some((m) => m.id === l.id)); return 'Camada adicionada' + (n ? ': ' + layerName(n) : '') }
      if (lb.length < la.length) { const n = la.find((l) => !lb.some((m) => m.id === l.id)); return 'Camada apagada' + (n ? ': ' + layerName(n) : '') }
      if (la.map((l) => l.id).join() !== lb.map((l) => l.id).join()) return 'Ordem das camadas'
      const n = lb.find((l, i) => JSON.stringify(l) !== JSON.stringify(la[i]))
      return n ? 'Camada: ' + layerName(n) : 'Camadas'
    }
    return KEY_LABEL[k] ?? k
  }
  return 'Alteração'
}

export function describeStep(a: TeamProject | undefined, b: TeamProject): string {
  if (!a) return 'Início'
  if (a.kits.length !== b.kits.length) return b.kits.length > a.kits.length ? 'Kit novo' : 'Kit apagado'
  for (const kb of b.kits) {
    const ka = a.kits.find((k) => k.slot === kb.slot)
    if (!ka) return 'Kit novo'
    if (ka !== kb && JSON.stringify(ka) !== JSON.stringify(kb)) return (SLOT_LABEL[kb.slot] ?? kb.slot) + ' · ' + kitChange(ka, kb)
  }
  if (a.crestAssetId !== b.crestAssetId) return 'Emblema'
  return 'Alteração'
}
