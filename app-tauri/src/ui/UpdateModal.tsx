/** "New version" pop-up (shown at start-up and from Definições → Verificar atualização). */
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { UpdateInfo } from '@shared/ipc'

export const useUpdate = create<{ info: UpdateInfo | null; set: (i: UpdateInfo | null) => void }>((set) => ({ info: null, set: (info) => set({ info }) }))

export function UpdateModal(): JSX.Element | null {
  const { info, set } = useUpdate()
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => window.kc.onUpdateProgress(setPct), [])
  useEffect(() => { setBusy(false); setPct(0); setErr('') }, [info])
  if (!info) return null
  const close = (): void => { if (!busy) set(null) }
  const go = async (): Promise<void> => {
    setBusy(true); setErr('')
    try { await window.kc.installUpdate(info.url, info.version) } catch (e) { setErr(String((e as Error).message ?? e)); setBusy(false) }
  }
  const mb = info.size ? (info.size / 1048576).toFixed(1) + ' MB' : ''
  return (
    <div className="modal-bg" onPointerDown={close}>
      <div className="modal update-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Nova versão disponível</b></div>
        <div className="update-body">
          <div><b>PES KitLab v{info.version}</b> {mb && <span className="muted small">({mb})</span>}</div>
          {info.notes && <pre className="update-notes">{info.notes}</pre>}
          {busy && <div className="update-prog"><div style={{ width: pct + '%' }} /></div>}
          {busy && <div className="muted small">{pct < 100 ? 'A descarregar… ' + pct + '%' : 'A substituir e a reiniciar…'}</div>}
          {err && <div className="update-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <div className="grow" />
          <button className="btn ghost" disabled={busy} onClick={close}>Mais tarde</button>
          <button className="btn primary" disabled={busy} onClick={go}>Download e substituir</button>
        </div>
      </div>
    </div>
  )
}

/** Looks for an update; `manual` reports "up to date" / errors through `notify`. */
export async function checkForUpdates(manual: boolean, notify: (k: 'ok' | 'err', t: string) => void): Promise<void> {
  try {
    const i = await window.kc.checkUpdate(!manual)
    if (i) useUpdate.getState().set(i)
    else if (manual) notify('ok', 'Já tens a versão mais recente')
  } catch (e) { if (manual) notify('err', String((e as Error).message ?? e)) }
}
