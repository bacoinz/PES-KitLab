import { useCallback, useEffect, useState } from 'react'
import type { SnapshotInfo, TeamInfo } from '@shared/types'
import type { TeamProject } from '../model/design'
import { useApp } from '../state'

/** Team versions: the fixed "Original" plus every exported/saved snapshot. Activate = write to the game. */
export function Snapshots({ team, onClose }: { team: Pick<TeamInfo, 'id' | 'name'>; onClose: () => void }): JSX.Element {
  const { notify, loadProject, setView, refreshTeams } = useApp()
  const [list, setList] = useState<SnapshotInfo[]>([])
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => { try { setList(await window.kc.listSnapshots(team.id)) } catch (e) { notify('err', String(e)) } }, [team.id, notify])
  useEffect(() => { reload() }, [reload])
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true)
    try { await fn(); if (ok) notify('ok', ok); await reload(); await refreshTeams() } catch (e) { notify('err', String((e as Error).message ?? e)) } finally { setBusy(false) }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Versões de {team.name}</b>
          <div className="grow" />
          <button className="btn small" disabled={busy} onClick={() => run(async () => { const p = await window.kc.backupOriginalZip(team.id); if (p) notify('ok', 'Backup guardado em ' + p) })}>Guardar originais (.zip)</button>
          <button className="btn small" disabled={busy || !list.some((s) => s.active && !s.fixed)} onClick={() => {
            const name = prompt('Nome da versão (ex.: "2026/27 real", "Retro 90s")')
            if (name) run(() => window.kc.saveSnapshot(team.id, name), 'Versão guardada')
          }}>Guardar versão ativa como…</button>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted pad">Clica em <b>Ativar</b> para o jogo passar a usar essa versão. "Original" remove as alterações do Kit Creator para esta equipa.</p>
        <div className="snap-grid">
          {list.map((s) => (
            <div key={s.id} className={'snap' + (s.active ? ' active' : '')}>
              <div className="snap-thumb">{s.thumb ? <img src={s.thumb} alt="" /> : <span>{s.fixed ? '🏟️' : '—'}</span>}</div>
              <div className="snap-name">{s.name}</div>
              <div className="muted small">{s.createdAt ? new Date(s.createdAt).toLocaleString('pt-PT') : 'Kits do jogo/modpack'}</div>
              <div className="snap-actions">
                {s.active ? <span className="badge">Ativa</span> : <button className="btn small primary" disabled={busy} onClick={() => run(() => window.kc.activateSnapshot(team.id, s.id), 'Versão ativada no jogo')}>Ativar</button>}
                {!s.fixed && (
                  <>
                    <button className="btn small" disabled={busy} onClick={() => run(async () => {
                      const j = await window.kc.loadSnapshotProject(team.id, s.id)
                      if (!j) throw new Error('Esta versão não tem projeto editável')
                      loadProject(JSON.parse(j) as TeamProject)
                      setView('editor')
                      onClose()
                    })}>Editar</button>
                    <button className="btn small ghost" disabled={busy} onClick={() => { const n = prompt('Novo nome', s.name); if (n) run(() => window.kc.renameSnapshot(team.id, s.id, n)) }}>Renomear</button>
                    <button className="btn small ghost" disabled={busy} onClick={() => run(async () => { const p = await window.kc.exportSnapshotZip(team.id, s.id); if (p) notify('ok', 'Exportado: ' + p) })}>.zip</button>
                    <button className="btn small danger" disabled={busy} onClick={() => { if (confirm(`Apagar a versão "${s.name}"? Não pode ser desfeito.`)) run(() => window.kc.deleteSnapshot(team.id, s.id), 'Versão apagada') }}>Apagar</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
