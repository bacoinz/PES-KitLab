/** Import dialog for a `.kitlab` file: preview, target slot, and whether to use the file's crest / brand / sponsors. */
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state'
import { ALL_SLOTS, SLOT_LABEL, uid } from '../model/design'
import { applyKitlab, slotFamily, teamLogos, type ParsedKitlab } from '../kitlab'
import { kitPreview3d } from '../previews'

export function KitlabImportModal({ file, onClose }: { file: ParsedKitlab; onClose: () => void }): JSX.Element | null {
  const { project, setProject, setActiveSlot, notify } = useApp()
  const team = useMemo(() => (project ? teamLogos(project) : {}), [project])
  const taken = useMemo(() => new Set((project?.kits ?? []).map((k) => k.slot)), [project])
  const slots = ALL_SLOTS.filter((s) => slotFamily(s) === slotFamily(file.slot))
  const [slot, setSlot] = useState(() => slots.find((s) => !taken.has(s)) ?? (slots.includes(file.slot) ? file.slot : slots[0]))
  const fileCrest = file.crestId ? file.assets[file.crestId] : undefined
  const fileBrand = file.brandId ? file.assets[file.brandId] : undefined
  // the team's crest is usually the right one; without a team crest the file's is better than none
  const [crest, setCrest] = useState(!team.crest)
  const [brand, setBrand] = useState(true)
  const [sponsors, setSponsors] = useState(true)
  const [img, setImg] = useState('')
  const key = useMemo(() => 'kitlab:' + uid(), [])
  useEffect(() => { kitPreview3d(file.kit, file.assets, 'torso', key).then(setImg).catch(() => undefined) }, [file, key])
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  if (!project) return null
  const Thumb = ({ a }: { a?: { dataUrl: string; name: string } }): JSX.Element => (a ? <img className="logo-thumb big" src={a.dataUrl} alt="" title={a.name} /> : <span className="muted small">—</span>)
  const doImport = (): void => {
    if (taken.has(slot) && !confirm(`Substituir o equipamento ${SLOT_LABEL[slot] ?? slot}? (Podes desfazer com Ctrl+Z.)`)) return
    setProject((p) => applyKitlab(p, file, { slot, crest, brand, sponsors }))
    setActiveSlot(slot)
    notify('ok', 'Kit importado: ' + (SLOT_LABEL[slot] ?? slot))
    onClose()
  }
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal kitlab-import" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Importar kit (.kitlab)</b><div className="grow" /><button className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="kitlab-body">
          <div className="kitlab-prev">{img ? <img src={img} alt="" /> : <span className="spinner" />}</div>
          <div className="kitlab-opts">
            <div><b>{file.name}</b>{file.team && <span className="muted small"> · {file.team}</span>}</div>
            <div className="set-grid">
              <label>Equipamento de destino</label>
              <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                {slots.map((s) => <option key={s} value={s}>{(SLOT_LABEL[s] ?? s) + (taken.has(s) ? ' — substituir' : ' — livre')}</option>)}
              </select>
            </div>
            {fileCrest && (
              <label className="check kitlab-row">
                <input type="checkbox" checked={crest} onChange={(e) => setCrest(e.target.checked)} />
                <span className="grow">Usar o emblema do ficheiro</span>
                <Thumb a={fileCrest} /><span className="muted small">ficheiro</span><Thumb a={team.crest} /><span className="muted small">equipa</span>
              </label>
            )}
            {fileBrand && (
              <label className="check kitlab-row">
                <input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} />
                <span className="grow">Usar a marca do ficheiro</span>
                <Thumb a={fileBrand} /><span className="muted small">ficheiro</span><Thumb a={team.brand} /><span className="muted small">equipa</span>
              </label>
            )}
            {file.sponsors > 0 && (
              <label className="check kitlab-row">
                <input type="checkbox" checked={sponsors} onChange={(e) => setSponsors(e.target.checked)} />
                <span className="grow">Importar os patrocinadores ({file.sponsors})</span>
              </label>
            )}
            <div className="muted small">Sem a opção marcada, a posição, o tamanho e as cores ficam as do ficheiro, mas a imagem passa a ser a da equipa.{(!team.crest || !team.brand) && <> <span>Se a equipa não tiver emblema ou marca, esse logo fica desligado.</span></>}</div>
            {file.missingFonts.length > 0 && <div className="kitlab-warn">Tipos de letra que não estão instalados neste PC: {file.missingFonts.join(', ')}. O kit usa outro no lugar deles.</div>}
            {file.missingAssets > 0 && <div className="kitlab-warn">{file.missingAssets} imagem(ns) em falta no ficheiro.</div>}
            <div className="set-row"><div className="grow" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={doImport}>Importar</button></div>
          </div>
        </div>
      </div>
    </div>
  )
}
