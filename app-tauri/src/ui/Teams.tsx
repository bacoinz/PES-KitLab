import { useEffect, useMemo, useRef, useState } from 'react'
import type { TeamInfo } from '@shared/types'
import { useApp } from '../state'
import { rgbaToCanvas } from '../compositor/images'
import { frontThumb } from '../compositor/compose'
import { Snapshots } from './Snapshots'
import { exportKitserverTeams } from '../state'

const thumbCache = new Map<string, string>()
const emblemCache = new Map<number, string | null>()

function useVisible(ref: React.RefObject<HTMLElement>): boolean {
  const [v, setV] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { setV(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [ref])
  return v
}

/** Kit order on the cards: players first (p1, p2, …), then goalkeepers. */
const slotRank = (s: string): number => { const m = s.match(/^([a-z]+)(\d+)/i); if (!m) return 999; return (m[1].toLowerCase() === 'p' ? 0 : 100) + Number(m[2]) }

function KitThumb({ team, slot }: { team: TeamInfo; slot: string }): JSX.Element {
  const key = `${team.id}:${slot}`
  const [src, setSrc] = useState(thumbCache.get(key) ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const vis = useVisible(ref)
  useEffect(() => {
    if (!vis || src) return
    let alive = true
    window.kc.readKitTexture(team.id, slot, 'kit', 3).then(async (img) => {
      if (!img || !alive) return
      const b = await frontThumb(rgbaToCanvas(img), 96).convertToBlob()
      const u = URL.createObjectURL(b)
      thumbCache.set(key, u)
      if (alive) setSrc(u)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [vis, src, team.id, slot, key])
  return <div ref={ref} className="kit-thumb" title={slot}>{src ? <img src={src} alt={slot} /> : <span className="muted">{slot}</span>}</div>
}

export function Emblem({ id, size = 40 }: { id: number; size?: number }): JSX.Element {
  const [src, setSrc] = useState(emblemCache.get(id) ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const vis = useVisible(ref)
  useEffect(() => {
    if (!vis || emblemCache.has(id)) return
    window.kc.readEmblem(id).then((b) => {
      const u = b ? URL.createObjectURL(new Blob([b], { type: 'image/png' })) : null
      emblemCache.set(id, u)
      setSrc(u ?? '')
    })
  }, [vis, id])
  return <div ref={ref} className="emblem" style={{ width: size, height: size }}>{src && <img src={src} alt="" />}</div>
}

export function Teams(): JSX.Element {
  const { teams, openTeam, openDraft, drafts, exportTeams, refreshDrafts, bulkSelection, toggleBulk, setBulk, setView, notify, refreshTeams, progress } = useApp()
  const draftOf = new Map(drafts.map((d) => [d.teamId, d]))
  const pendingIds = drafts.filter((d) => !d.exportedAt || d.savedAt > d.exportedAt).map((d) => d.teamId)
  const isPending = (id: number): boolean => pendingIds.includes(id)
  // filters live in the app store so they survive switching to the editor and back
  const f = useApp((st) => st.teamsFilter)
  const setF = (patch: Partial<typeof f>): void => useApp.setState((st) => ({ teamsFilter: { ...st.teamsFilter, ...patch } }))
  const { league, country, q } = f
  const kitsF = f.kits ?? 'all'
  const open_ = f.open
  const setLeague = (league: string): void => setF({ league })
  const setCountry = (country: string): void => setF({ country })
  const setOpen = (open: Record<string, boolean>): void => setF({ open })
  const setQ = (q: string): void => setF({ q })
  const [gridW, setGridW] = useState(() => { try { return Number(localStorage.getItem('kc.teamGrid')) || 330 } catch { return 330 } })
  const [snapTeam, setSnapTeam] = useState<TeamInfo | null>(null)
  /** countries (A→Z, "Seleções"/"Outros" last) → leagues ordered by division (1ª first) */
  const countries = useMemo(() => {
    const m = new Map<string, Map<string, { n: number; tier: number }>>()
    for (const t of teams) {
      const c = m.get(t.country) ?? new Map<string, { n: number; tier: number }>()
      const l = c.get(t.league) ?? { n: 0, tier: t.tier ?? 99 }
      l.n++
      c.set(t.league, l)
      m.set(t.country, c)
    }
    const last = (c: string): number => (c === 'Seleções' ? 1 : c === 'Outros' ? 2 : 0)
    return [...m]
      .sort((a, b) => last(a[0]) - last(b[0]) || a[0].localeCompare(b[0], 'pt'))
      .map(([c, ls]) => ({
        country: c,
        total: [...ls.values()].reduce((s, x) => s + x.n, 0),
        leagues: [...ls].sort((a, b) => a[1].tier - b[1].tier || a[0].localeCompare(b[0], 'pt')).map(([l, x]) => ({ league: l, n: x.n, tier: x.tier }))
      }))
  }, [teams])
  const list = useMemo(() => teams.filter((t) =>
    (!country || t.country === country) && (!league || t.league === league) && (kitsF === 'all' || (kitsF === 'with' ? t.slots.length > 0 : t.slots.length === 0)) &&
    (!q || t.name.toLowerCase().includes(q.toLowerCase()) || String(t.id) === q)
  ).sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.league.localeCompare(b.league, 'pt') || a.name.localeCompare(b.name, 'pt')).slice(0, 400), [teams, country, league, q, kitsF])
  const sel = new Set(bulkSelection)

  const leaveOk = (): boolean => {
    const s = useApp.getState()
    return !s.project || s.project === s.savedProject || confirm(`Há alterações por guardar em ${s.project.teamName}. Continuar sem guardar?`)
  }
  const open = async (t: TeamInfo, fromGame: boolean): Promise<void> => {
    if (!leaveOk()) return
    try { await openTeam(t, { fromGame }) } catch (e) { notify('err', String((e as Error).message ?? e)) }
  }

  return (
    <div className="teams">
      <aside className="leagues">
        <div className="leagues-head">Países e ligas</div>
        <button className={'league' + (!league && !country ? ' active' : '')} onClick={() => { setLeague(''); setCountry('') }}>Todas <span>{teams.length}</span></button>
        {countries.map((c) => {
          const isOpen = open_[c.country] ?? c.country === country
          const single = c.leagues.length === 1
          return (
            <div key={c.country} className="country">
              <button
                className={'league country-head' + (country === c.country && !league ? ' active' : '')}
                onClick={() => { setCountry(c.country); setLeague(''); if (!single) setOpen({ ...open_, [c.country]: !isOpen }) }}
              >
                {!single && <span className="chev">{isOpen ? '▾' : '▸'}</span>}
                <b className="grow">{c.country}</b><span>{c.total}</span>
              </button>
              {!single && isOpen && c.leagues.map((l) => (
                <button key={l.league} className={'league sub' + (league === l.league ? ' active' : '')} onClick={() => { setCountry(c.country); setLeague(l.league) }}>
                  {l.tier < 99 && <span className="tier">{l.tier}ª</span>}<span className="grow">{l.league}</span><span>{l.n}</span>
                </button>
              ))}
            </div>
          )
        })}
      </aside>
      <section className="team-list">
        <div className="toolbar">
          <input className="search" placeholder="Pesquisar equipa ou ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={kitsF} onChange={(e) => setF({ kits: e.target.value as 'all' | 'with' | 'without' })}><option value="all">Todas as equipas</option><option value="with">Só com kits</option><option value="without">Sem kits</option></select>
          <span className="muted small">Tamanho</span><input type="range" min={240} max={640} value={gridW} onChange={(e) => { const v = Number(e.target.value); setGridW(v); try { localStorage.setItem('kc.teamGrid', String(v)) } catch { /* ignore */ } }} />
          <div className="grow" />
          <button className="btn" title="Recarregar equipas e rascunhos" onClick={() => { refreshTeams(); refreshDrafts() }}>⟳ Atualizar</button>
          <button className="btn" onClick={() => setBulk([...new Set([...bulkSelection, ...list.map((t) => t.id)])])}>Selecionar todas ({list.length})</button>
          {bulkSelection.length > 0 && <button className="btn" onClick={() => setBulk([])}>Limpar seleção</button>}
          <button className="btn primary" disabled={!bulkSelection.length} onClick={() => setView('bulk')}>Gerar em massa ({bulkSelection.length}) →</button>
          <button className="btn primary" disabled={!pendingIds.length || !!progress} title="Escreve no jogo todas as equipas com alterações guardadas" onClick={() => {
            if (confirm(`Importar ${pendingIds.length} equipa(s) com alterações para o jogo? Os originais podem ser repostos em "Versões".`)) exportTeams(pendingIds)
          }}>⬆ Importar para o jogo ({pendingIds.length})</button>
          <button className="btn" disabled={!bulkSelection.length || !!progress} title="Guarda os kits das equipas selecionadas numa pasta (uma pasta por clube), no formato do Sider kit-server" onClick={() => exportKitserverTeams(bulkSelection)}>Exportar ({bulkSelection.length})</button>
          <button className="btn play" title="Arranca o Sider (se não estiver aberto) e depois o jogo" onClick={() => {
            window.kc.launchGame().then((m) => notify('ok', m), (e) => notify('err', String((e as Error)?.message ?? e)))
          }}>▶ ABRIR JOGO</button>
        </div>
        <div className="team-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridW}px, 1fr))`, ['--thumb' as string]: `${Math.round(64 * gridW / 330)}px` }}>
          {list.map((t) => (
            <div key={t.id} className={'team-card' + (sel.has(t.id) ? ' selected' : '')}>
              <div className="team-top">
                <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleBulk(t.id)} />
                <Emblem id={t.id} />
                <div className="team-name">
                  <b>{t.name}</b>
                  <span className="muted">#{t.id} · {t.league}{t.managedByUs ? ' · ✓ no jogo (KitCreator)' : ''}</span>
                  {isPending(t.id) && <span className="pending">● alterações por importar</span>}
                </div>
              </div>
              <div className="kits-row">
                {draftOf.has(t.id)
                  ? Object.entries(draftOf.get(t.id)!.thumbs).sort((a, b) => slotRank(a[0]) - slotRank(b[0])).map(([slot, src]) => <div key={slot} className="kit-thumb draft" title={slot + ' (editado)'}><img src={src} alt={slot} /></div>)
                  : [...t.slots].sort((a, b) => slotRank(a.slot) - slotRank(b.slot)).slice(0, 5).map((s) => <KitThumb key={s.slot} team={t} slot={s.slot} />)}
                {!draftOf.has(t.id) && !t.slots.length && <span className="muted small">Sem kits no jogo</span>}
              </div>
              <div className="team-actions">
                {draftOf.has(t.id) ? (
                  <>
                    <button className="btn small primary" onClick={() => { if (leaveOk()) openDraft(t.id) }}>Continuar edição</button>
                    {isPending(t.id) && <button className="btn small" title="Escreve esta equipa no jogo" disabled={!!progress} onClick={() => exportTeams([t.id])}>⬆ Importar</button>}
                    <button className="btn small" title="Guarda os kits desta equipa numa pasta, no formato kitserver" disabled={!!progress} onClick={() => exportKitserverTeams([t.id])}>Exportar</button>
                    <button className="btn small ghost" title="Apaga o rascunho guardado (não mexe no jogo nem nas versões exportadas)" onClick={async () => {
                      if (!confirm(`Apagar o trabalho guardado de ${t.name}? O que já estiver exportado no jogo não muda.`)) return
                      await window.kc.deleteDraft(t.id); await refreshDrafts()
                    }}>Recomeçar</button>
                  </>
                ) : (
                  <>
                    {t.managedByUs && <button className="btn small primary" title="Reabre o projeto editável da versão que está no jogo" onClick={async () => {
                      if (!leaveOk()) return
                      const snap = (await window.kc.listSnapshots(t.id)).find((x) => x.active && !x.fixed)
                      const j = snap && await window.kc.loadSnapshotProject(t.id, snap.id)
                      if (!j) return notify('err', 'Esta versão não tem projeto editável')
                      { const pj = JSON.parse(j); useApp.getState().loadProject(pj, pj) }
                      setView('editor')
                    }}>Editar versão do jogo</button>}
                    <button className={'btn small' + (t.managedByUs ? '' : ' primary')} onClick={() => open(t, false)}>Criar kits</button>
                    <button className="btn small" disabled={!t.slots.length} onClick={() => open(t, true)}>Editar kit do jogo</button>
                  </>
                )}
                <button className="btn small ghost" onClick={() => setSnapTeam(t)}>Versões</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {snapTeam && <Snapshots team={snapTeam} onClose={() => setSnapTeam(null)} />}
    </div>
  )
}
