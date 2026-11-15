import type { Fill } from '../model/design'
import { ColorInput, Slider } from './common'

const css = (f: Fill): string => f.kind === 'solid' ? f.color
  : `linear-gradient(${f.angle + 90}deg, ${[...f.stops].sort((a, b) => a.at - b.at).map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})`

/** Solid colour or multi-stop gradient (several colours, their order/positions and the angle). */
export function FillInput({ value, onChange }: { value: Fill; onChange: (f: Fill) => void }): JSX.Element {
  if (value.kind === 'solid') {
    return (
      <span className="fill-input">
        <ColorInput value={value.color} onChange={(color) => onChange({ kind: 'solid', color })} />
        <button className="btn tiny ghost" title="Usar gradiente" onClick={() => onChange({ kind: 'gradient', angle: 90, stops: [{ color: value.color, at: 0 }, { color: '#000000', at: 1 }] })}>Gradiente</button>
      </span>
    )
  }
  const stops = value.stops
  const set = (i: number, patch: Partial<{ color: string; at: number }>): void => onChange({ ...value, stops: stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  return (
    <div className="fill-grad">
      <div className="grad-bar" style={{ background: css(value) }} />
      {stops.map((s, i) => (
        <div key={i} className="grad-stop">
          <ColorInput value={s.color} onChange={(color) => set(i, { color })} />
          <Slider value={Math.round(s.at * 100)} min={0} max={100} onChange={(v) => set(i, { at: v / 100 })} />
          <button className="btn tiny ghost" disabled={i === 0} title="Subir" onClick={() => {
            const n = [...stops]; [n[i - 1], n[i]] = [{ ...n[i], at: n[i - 1].at }, { ...n[i - 1], at: n[i].at }]; onChange({ ...value, stops: n })
          }}>↑</button>
          <button className="btn tiny ghost" disabled={stops.length <= 2} title="Remover cor" onClick={() => onChange({ ...value, stops: stops.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <div className="grad-tools">
        <button className="btn tiny" onClick={() => onChange({ ...value, stops: [...stops, { color: stops[stops.length - 1].color, at: 1 }].map((s, j, a) => ({ ...s, at: j / (a.length - 1) })) })}>+ cor</button>
        <span className="muted small">Ângulo</span>
        <Slider value={value.angle} min={0} max={360} step={5} onChange={(angle) => onChange({ ...value, angle })} />
        <button className="btn tiny ghost" title="Voltar a cor sólida" onClick={() => onChange({ kind: 'solid', color: stops[0].color })}>Sólida</button>
      </div>
    </div>
  )
}

export function FillRow({ label, value, onChange }: { label: string; value: Fill; onChange: (f: Fill) => void }): JSX.Element {
  return (
    <div className="row fill-row">
      <span className="row-label">{label}</span>
      <span className="row-ctl"><FillInput value={value} onChange={onChange} /></span>
    </div>
  )
}
