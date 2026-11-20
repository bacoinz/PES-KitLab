/** Layer sets saved from the analyser (Biblioteca → Camadas guardadas): list helper and the picker used by the editor. */
import { useEffect, useState } from 'react'
import { uid, type Asset } from '../model/design'
import type { UserLayerSet } from '../state'

export async function listLayerSets(): Promise<UserLayerSet[]> {
  try {
    const l = await window.kc.listUserLayers()
    return l.map((j) => { try { return JSON.parse(j) as UserLayerSet } catch { return null } }).filter((x): x is UserLayerSet => !!x).sort((a, b) => String(b.date).localeCompare(String(a.date)))
  } catch { return [] }
}

/** The set as fresh layers and assets (new ids), ready to add to a kit. */
export function instantiateSet(s: UserLayerSet): { layers: UserLayerSet['layers']; assets: Record<string, Asset> } {
  const map = new Map<string, string>()
  const assets: Record<string, Asset> = {}
  for (const [id, a] of Object.entries(s.assets ?? {})) { const nid = uid() + 'l'; map.set(id, nid); assets[nid] = { ...a, id: nid } }
  return { layers: s.layers.map((l) => ({ ...l, id: uid(), assetId: l.assetId ? map.get(l.assetId) ?? l.assetId : undefined })), assets }
}

export function LayerSetPicker({ onInsert, onClose }: { onInsert: (s: UserLayerSet, withColors: boolean) => void; onClose: () => void }): JSX.Element {
  const [sets, setSets] = useState<UserLayerSet[] | null>(null)
  const [withColors, setWithColors] = useState(false)
  useEffect(() => { listLayerSets().then(setSets) }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal" style={{ width: 'min(720px, 94vw)' }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Camadas da biblioteca</b><span className="muted small">guardadas no separador Analisador</span><div className="grow" /><button className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="pad">
          <label className="check"><input type="checkbox" checked={withColors} onChange={(e) => setWithColors(e.target.checked)} /> Usar também as cores de base guardadas (camisola, mangas, calções, meias)</label>
        </div>
        <div className="tpl-grid" style={{ overflow: 'auto' }}>
          {sets === null && <div className="muted pad"><span className="spinner" /></div>}
          {sets && !sets.length && <div className="muted pad">Ainda não há camadas guardadas. No separador Analisador: analisa uma textura e usa «Guardar na biblioteca».</div>}
          {sets?.map((s) => (
            <div key={s.id} className="tpl-card">
              <div className="tpl-img az-thumb">{s.thumb ? <img src={s.thumb} alt="" /> : null}</div>
              <b title={s.name}>{s.name}</b>
              <span className="muted small">{`${s.layers.length} camada(s)`}</span>
              <div className="btn-row"><button className="btn small primary" onClick={() => onInsert(s, withColors)}>Inserir no kit</button></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
