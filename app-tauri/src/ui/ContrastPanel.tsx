/** "Legibilidade" in the Numbers tab: contrast of the name and numbers over the kit, with a one-click suggestion. */
import { useEffect, useRef, useState } from 'react'
import type { Asset, KitDesign, NumbersSpec } from '../model/design'
import { composeRgba } from '../compositor/compose'
import { applySuggestion, checkContrast, MIN_CONTRAST, type CheckPart, type PartCheck } from '../compositor/contrast'
import type { GlyphAtlas } from '../compositor/decorate'

const LABEL: Record<CheckPart, string> = { back: 'Número das costas', name: 'Nome', chest: 'Número do peito', leg: 'Número dos calções' }

interface Props {
  kit: KitDesign
  assets: Record<string, Asset>
  atlases: Record<string, GlyphAtlas | undefined>
  sampleName: string
  sampleNum: string
  onNumbers: (n: NumbersSpec) => void
}

export function ContrastPanel({ kit, assets, atlases, sampleName, sampleNum, onNumbers }: Props): JSX.Element {
  const [rows, setRows] = useState<PartCheck[] | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    if (!atlases.back && !atlases.name) return // the glyphs are still loading
    const my = ++seq.current
    setBusy(true)
    // wait until a slider / colour drag settles: composing the kit is the slow part
    const t = setTimeout(() => {
      composeRgba(kit, assets, { size: 1024 })
        .then((tex) => {
          if (my !== seq.current) return
          setRows(checkContrast(tex, { back: atlases.back, leg: atlases.leg, chest: atlases.chest, name: atlases.name, config: kit.config, playerName: sampleName, number: sampleNum, nameBelow: kit.numbers.nameBelow }, kit))
          setBusy(false)
        })
        .catch(() => { if (my === seq.current) { setRows(null); setBusy(false) } })
    }, 700)
    return () => clearTimeout(t)
  }, [kit, assets, atlases, sampleName, sampleNum])
  const bad = rows?.filter((r) => !r.ok).length ?? 0
  return (
    <div className="contrast-panel">
      <div className="sub-title">Legibilidade {busy && <span className="spinner" />}</div>
      <div className="muted small">Contraste do nome e dos números sobre o kit (o mínimo é 3:1). É só um aviso: muitos equipamentos reais têm pouco contraste de propósito.</div>
      {rows && rows.length === 0 && <div className="muted small">Não há nome nem números visíveis para verificar.</div>}
      {rows?.map((r) => (
        <div key={r.part} className={'contrast-row' + (r.ok ? ' ok' : ' bad')}>
          <span className="contrast-mark" title={r.ok ? 'Lê-se bem' : 'Pouco contraste'}>{r.ok ? '✓' : '⚠'}</span>
          <span className="grow">{LABEL[r.part]}</span>
          <span className="contrast-sw" style={{ background: r.fg }} title={r.field === 'outline' ? 'Contorno' : 'Cor do número'} />
          <span className="muted small">sobre</span>
          <span className="contrast-sw" style={{ background: r.bg }} title="Cor do kit por baixo" />
          <b className="contrast-ratio">{r.ratio.toFixed(1)}:1</b>
          {!r.ok && r.suggest && <button className="btn tiny" title="Muda a cor para a mais próxima que se lê bem" onClick={() => onNumbers(applySuggestion(kit.numbers, r))}>{`Usar ${r.suggest}`}</button>}
          {!r.ok && !r.suggest && !r.canApply && <span className="muted small">números do jogo: muda para "Recolorir os do jogo"</span>}
        </div>
      ))}
      {rows && bad > 0 && <div className="muted small">{`${bad} de ${rows.length} abaixo de ${MIN_CONTRAST}:1.`}</div>}
    </div>
  )
}
