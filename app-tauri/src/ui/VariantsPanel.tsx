/**
 * "Variantes de cor" in the Origin tab: proposals of the kit in other colours (inverted, complementary, analogous,
 * triad, darker), checked for legibility of the name and numbers, to be created in free slots in one go.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Asset, KitDesign, TeamProject } from '../model/design'
import { ALL_SLOTS, SLOT_LABEL } from '../model/design'
import { makeVariants, variantKit, type Variant } from '../model/variants'
import { composeRgba } from '../compositor/compose'
import { applySuggestion, checkContrast } from '../compositor/contrast'
import type { GlyphAtlas } from '../compositor/decorate'
import { variantPreview } from '../previews'

interface Item { v: Variant; kit: KitDesign; ok: boolean; img: string }
interface Props {
  project: TeamProject
  kit: KitDesign
  assets: Record<string, Asset>
  atlases: Record<string, GlyphAtlas | undefined>
  onCreate: (kits: KitDesign[]) => void
}

export function VariantsPanel({ project, kit, assets, atlases, onCreate }: Props): JSX.Element {
  const [seed, setSeed] = useState(0)
  const [items, setItems] = useState<Item[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [showBad, setShowBad] = useState(false)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const family = kit.slot.startsWith('g') ? 'g' : 'p'
  const free = useMemo(() => ALL_SLOTS.filter((s) => s.startsWith(family) && !project.kits.some((k) => k.slot === s)), [project.kits, family])
  const colorKey = [kit.colors.shirt, kit.colors.shirt2, kit.colors.shirt3].join()

  useEffect(() => {
    let alive = true
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const out: Item[] = []
        const base = { back: atlases.back, leg: atlases.leg, chest: atlases.chest, name: atlases.name, config: kit.config, playerName: 'JOGADOR', number: '10', nameBelow: kit.numbers.nameBelow }
        // what the kit itself already has: a variant is only held against parts that would read worse than now
        const own = checkContrast(await composeRgba(kit, assets, { size: 512 }), base, kit)
        const ownRatio = Object.fromEntries(own.map((r) => [r.part, r.ratio]))
        for (const v of makeVariants(kit.colors.shirt, kit.colors.shirt2, kit.colors.shirt3, seed)) {
          let k = variantKit(kit, v)
          // legibility: the name and numbers of the new colours; recolourable ones get the nearest colour that reads well
          const tex = await composeRgba(k, assets, { size: 512 })
          let rows = checkContrast(tex, base, k)
          if (rows.some((r) => !r.ok && r.suggest)) {
            let n = k.numbers
            for (const r of rows) if (!r.ok) n = applySuggestion(n, r)
            k = { ...k, numbers: n }
            rows = checkContrast(tex, base, k)
          }
          const img = await variantPreview(k, assets, `${v.id}:${v.cols.join()}:${kit.slot}:${k.numbers.fill}`)
          out.push({ v, kit: k, ok: rows.every((r) => r.ok || r.ratio >= (ownRatio[r.part] ?? 0) - 0.25), img })
          if (!alive) return
        }
        if (!alive) return
        setItems(out)
        setPicked(Object.fromEntries(out.filter((i) => i.ok).slice(0, Math.min(3, free.length)).map((i) => [i.v.id, true])))
      } catch { if (alive) setItems([]) } finally { if (alive) setBusy(false) }
    }, 500)
    return () => { alive = false; clearTimeout(t) }
  }, [colorKey, seed, kit.slot, atlases, assets]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (items ?? []).filter((i) => i.ok || showBad)
  const hidden = (items ?? []).length - (items ?? []).filter((i) => i.ok).length
  const chosen = shown.filter((i) => picked[i.v.id])
  const create = (): void => {
    let list = chosen
    if (list.length > free.length) {
      if (!confirm(`Só há ${free.length} equipamento(s) livre(s). Criar só os primeiros ${free.length}?`)) return
      list = list.slice(0, free.length)
    }
    onCreate(list.map((i, n) => ({ ...i.kit, slot: free[n] })))
  }
  return (
    <div className="var-panel">
      <div className="muted small">Propostas do kit atual com outras cores (visitante, terceiro…). Trocam as três cores principais e tudo o que as usa (camadas, gola, punhos, contornos). As que deixariam o nome ou os números ilegíveis ficam de fora.</div>
      {free.length === 0 && <div className="kitlab-warn">Não há equipamentos livres neste tipo de kit. Elimina um (botão "Eliminar kit") e volta aqui.</div>}
      {busy && <div className="muted small"><span className="spinner" /> A preparar as propostas…</div>}
      <div className="var-grid">
        {shown.map((i) => (
          <label key={i.v.id} className={'var-card' + (picked[i.v.id] ? ' on' : '')}>
            <input type="checkbox" checked={!!picked[i.v.id]} onChange={(e) => setPicked((p) => ({ ...p, [i.v.id]: e.target.checked }))} />
            {i.img ? <img src={i.img} alt="" /> : <span className="spinner" />}
            <b>{i.v.name}</b>
            <span className="var-sw">{i.v.cols.map((c, n) => <span key={n} className="contrast-sw" style={{ background: c }} title={c} />)}{!i.ok && <span title="Pouco contraste no nome ou nos números">⚠</span>}</span>
          </label>
        ))}
      </div>
      {hidden > 0 && <label className="check"><input type="checkbox" checked={showBad} onChange={(e) => setShowBad(e.target.checked)} /> {`Mostrar também as ${hidden} com pouco contraste`}</label>}
      <div className="btn-row">
        <button className="btn small primary" disabled={!chosen.length || !free.length} onClick={create}>{`Criar ${chosen.length} variante(s)`}</button>
        <button className="btn small" title="Outras propostas com as mesmas regras" onClick={() => setSeed((s) => s + 1)}>Mais variantes</button>
      </div>
      {free.length > 0 && <div className="muted small">{`Vão para os equipamentos livres: ${free.slice(0, 4).map((s) => SLOT_LABEL[s] ?? s).join(', ')}${free.length > 4 ? '…' : ''}.`}</div>}
    </div>
  )
}
