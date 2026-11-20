/** "Gerador de padrões" in the Origin tab: pick a style and colours, preview it, and apply it as normal editable layers. */
import { useEffect, useMemo, useState } from 'react'
import type { Asset, KitDesign } from '../model/design'
import { STYLES, buildStyle, styleById } from '../model/styles'
import { recipePreview } from '../previews'
import { ColorInput, Row, Select, Slider } from './common'

interface Props { kit: KitDesign; assets: Record<string, Asset>; onApply: (tpl: ReturnType<typeof buildStyle>, c1: string, c2: string, c3: string) => void }

export function PatternGenPanel({ kit, assets, onApply }: Props): JSX.Element {
  const [style, setStyle] = useState(STYLES[0].id)
  const [seed, setSeed] = useState(1)
  const [cols, setCols] = useState<[string, string, string]>([kit.colors.shirt, kit.colors.shirt2, kit.colors.shirt3])
  const [count, setCount] = useState<number | null>(null) // null = the seed chooses
  const [width, setWidth] = useState<number | null>(null)
  // another kit (or colours changed in the other tabs): start from its colours again
  useEffect(() => { setCols([kit.colors.shirt, kit.colors.shirt2, kit.colors.shirt3]) }, [kit.slot]) // eslint-disable-line react-hooks/exhaustive-deps
  const def = styleById(style)
  const tpl = useMemo(() => buildStyle(style, seed, { count: count ?? undefined, width: width ?? undefined }), [style, seed, count, width])
  const [img, setImg] = useState('')
  const key = JSON.stringify([style, seed, count, width, cols, kit.slot, kit.config.Collar])
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => { recipePreview(kit, tpl, cols, assets, key).then((u) => { if (alive) setImg(u) }).catch(() => undefined) }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownCount = tpl.torso?.[2] ?? tpl.layers?.find((l) => l.kind === 'pattern')?.count ?? def.count?.[1] ?? 0
  const shownWidth = tpl.torso?.[3] ?? tpl.layers?.[0]?.width ?? tpl.layers?.[0]?.size ?? def.width?.[1] ?? 0
  return (
    <div className="gen-panel">
      <div className="muted small">Escolhe um estilo e as cores: o kit fica com camadas normais, que podes ajustar nas outras abas. "Surpreende-me" experimenta outra variante do mesmo estilo.</div>
      <Row label="Estilo"><Select value={style} options={STYLES.map((s) => [s.id, s.name] as [string, string])} onChange={(v) => { setStyle(v); setCount(null); setWidth(null) }} /></Row>
      <div className="gen-body">
        <div className="gen-prev">{img ? <img src={img} alt="" /> : <span className="spinner" />}</div>
        <div className="gen-ctl">
          {(['Cor 1', 'Cor 2', 'Cor 3'] as const).map((l, i) => (
            <Row key={l} label={l}><ColorInput value={cols[i]} onChange={(v) => setCols((c) => c.map((x, j) => (j === i ? v : x)) as [string, string, string])} /></Row>
          ))}
          {def.count && (
            <>
              <label className="check"><input type="checkbox" checked={count !== null} onChange={(e) => setCount(e.target.checked ? shownCount || def.count![1] : null)} /> {def.count[0]} (manual)</label>
              {count !== null && <Slider value={count} min={def.count[1]} max={def.count[2]} onChange={setCount} />}
            </>
          )}
          {def.width && (
            <>
              <label className="check"><input type="checkbox" checked={width !== null} onChange={(e) => setWidth(e.target.checked ? shownWidth || def.width![1] : null)} /> {def.width[0]} (manual)</label>
              {width !== null && <Slider value={width} min={def.width[1]} max={def.width[2]} onChange={setWidth} />}
            </>
          )}
        </div>
      </div>
      <div className="btn-row">
        <button className="btn small" title="Outra variante do mesmo estilo" onClick={() => { setSeed(Math.floor(Math.random() * 1e6)); setCount(null); setWidth(null) }}>Surpreende-me</button>
        <button className="btn small primary" title="Aplica este estilo ao kit (podes desfazer com Ctrl+Z)" onClick={() => onApply(tpl, cols[0], cols[1], cols[2])}>Gerar</button>
        <button className="btn small ghost" title="Volta às cores atuais do kit" onClick={() => setCols([kit.colors.shirt, kit.colors.shirt2, kit.colors.shirt3])}>Usar as cores do kit</button>
      </div>
    </div>
  )
}
