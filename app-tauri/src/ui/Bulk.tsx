import { useEffect, useMemo, useState } from 'react'
import { useApp, assetFromUrl, gameKitColors } from '../state'
import type { Asset, TeamProject, Logos } from '../model/design'
import { defaultLogos, SLOT_LABEL, slotOrder } from '../model/design'
import { TEMPLATES, generateSet, teamColorsFromPalette } from '../model/templates'
import { composeKit, frontThumb } from '../compositor/compose'
import { palette, loadAsset, dataUrlFromBytes, trim, canvasToDataUrl } from '../compositor/images'
import { ColorInput, AssetPicker, Select } from './common'
import { Emblem } from './Teams'

interface Row {
  tpls?: Record<string, string> // per-kit template (default = global)
  teamId: number
  name: string
  league: string
  c1: string; c2: string; c3: string
  crest?: Asset
  brand?: Asset
  sponsor?: Asset
  project?: TeamProject
  thumbs?: Record<string, string>
  status?: string
}

const TPL_OPTS: [string, string][] = [['random', '🎲 Aleatório'], ...TEMPLATES.map((t) => [t.id, t.name] as [string, string])]

export function Bulk(): JSX.Element {
  const { teams, bulkSelection, setBulk, loadProject, setView, notify, drafts, refreshDrafts } = useApp()
  const [rows, setRows] = useState<Row[]>([])
  const [tpl, setTpl] = useState({ home: 'classic', away: 'classic', third: 'modern', gk: 'classic' })
  const [badge, setBadge] = useState<Asset | undefined>()
  const [slots, setSlots] = useState<string[]>(['p1', 'p2', 'p3', 'g1'])
  const [brand, setBrand] = useState<Asset | undefined>()
  const [sponsor, setSponsor] = useState<Asset | undefined>()
  const [emblemInGame, setEmblemInGame] = useState(false)
  const [busy, setBusy] = useState(false)

  // load selected teams with crest-derived colours
  useEffect(() => {
    let alive = true
    ;(async () => {
      const sel = teams.filter((t) => bulkSelection.includes(t.id))
      const keep = new Map(rows.map((r) => [r.teamId, r]))
      const out: Row[] = []
      for (const t of sel) {
        const prev = keep.get(t.id)
        if (prev) { out.push(prev); continue }
        const r: Row = { teamId: t.id, name: t.name, league: t.league, c1: '#1f4fb4', c2: '#ffffff', c3: '#111111' }
        const emb = await window.kc.readEmblem(t.id).catch(() => null)
        if (emb) {
          r.crest = { id: 'crest', name: t.name, dataUrl: await dataUrlFromBytes(emb, 'image/png') }
          ;[r.c1, r.c2, r.c3] = teamColorsFromPalette(palette(trim(await loadAsset(r.crest)), 5))
        }
        const kc = await gameKitColors(t.id).catch(() => null)
        if (kc) [r.c1, r.c2, r.c3] = kc
        out.push(r)
      }
      if (alive) setRows(out)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkSelection, teams])

  const setRow = (id: number, patch: Partial<Row>): void => setRows((rs) => rs.map((r) => (r.teamId === id ? { ...r, ...patch } : r)))

  const build = async (r: Row): Promise<Row> => {
    const assets: Record<string, Asset> = {}
    const logos: Logos = defaultLogos()
    const crest = r.crest ? { ...r.crest, id: 'crest' } : undefined
    if (crest) { assets.crest = crest; logos.crest.assetId = 'crest'; logos.shortsCrest.assetId = 'crest' }
    const b = r.brand ?? brand, s = r.sponsor ?? sponsor
    if (b) { assets.brand = { ...b, id: 'brand' }; logos.brand.assetId = 'brand'; logos.shortsBrand.assetId = 'brand'; logos.socksBrand.assetId = 'brand' }
    else { logos.brand.enabled = false; logos.shortsBrand.enabled = false }
    if (s) { assets.sponsor = { ...s, id: 'sponsor' }; logos.sponsor.assetId = 'sponsor' }
    else logos.sponsor.enabled = false
    if (badge) { assets.badge = { ...badge, id: 'badge' }; logos.sleeveBadges = [{ enabled: true, tint: 'original', size: 110, dx: 0, dy: 0, side: 'right', assetId: 'badge' }] }
    const kits = generateSet({ c1: r.c1, c2: r.c2, c3: r.c3, slots, templates: tpl, logos, perSlot: r.tpls })
    const national = teams.find((t) => t.id === r.teamId)?.country === 'Seleções'
    for (const k of kits) k.config.ChestNumberSize = national ? 14 : 0
    const project: TeamProject = { version: 1, teamId: r.teamId, teamName: r.name, league: r.league, crestAssetId: crest ? 'crest' : undefined, updateGameEmblem: emblemInGame && !!r.crest, kits, assets }
    const thumbs: Record<string, string> = {}
    for (const k of kits) {
      const tex = await composeKit(k, assets)
      thumbs[k.slot] = await canvasToDataUrl(frontThumb(tex, 128))
    }
    return { ...r, project, thumbs, status: undefined }
  }

  const generateAll = async (): Promise<void> => {
    setBusy(true)
    try {
      const out: Row[] = []
      for (const [i, r] of rows.entries()) {
        useApp.setState({ progress: `A gerar ${i + 1}/${rows.length}: ${r.name}` })
        out.push(await build(r))
        setRows([...out, ...rows.slice(out.length)])
      }
    } catch (e) { notify('err', String(e)) } finally { setBusy(false); useApp.setState({ progress: '' }) }
  }

  const exportAll = async (): Promise<void> => {
    const n = rows.filter((r) => r.project).length
    const existing = rows.filter((r) => r.project && drafts.some((d) => d.teamId === r.teamId)).length
    if (existing && !confirm(`${existing} destas equipas já têm alterações guardadas, que vão ser substituídas. Continuar?`)) return
    setBusy(true)
    let ok = 0
    try {
      for (const [i, r] of rows.entries()) {
        if (!r.project) continue
        useApp.setState({ progress: `A guardar ${i + 1}/${rows.length}: ${r.name}` })
        try {
          await window.kc.saveDraft(r.teamId, JSON.stringify({ ...r.project, updateGameEmblem: emblemInGame && !!r.crest }), r.thumbs ?? {})
          ok++; setRow(r.teamId, { status: '✓ guardado' })
        } catch (e) { setRow(r.teamId, { status: '✗ ' + String((e as Error).message ?? e) }) }
      }
      await refreshDrafts()
      notify('ok', `${ok} de ${n} equipas guardadas — exporta-as para o jogo no ecrã Equipas`)
    } finally { setBusy(false); useApp.setState({ progress: '' }) }
  }

  const exportCsv = async (): Promise<void> => {
    const lines = ['teamId,name,color1,color2,color3,crestUrl,brandUrl,sponsorUrl', ...rows.map((r) => `${r.teamId},"${r.name.replace(/"/g, '""')}",${r.c1},${r.c2},${r.c3},,,`)]
    const p = await window.kc.saveFile('equipas.csv', new TextEncoder().encode(lines.join('\r\n')))
    if (p) notify('ok', 'CSV guardado: ' + p)
  }
  const importCsv = async (): Promise<void> => {
    const f = await window.kc.pickFiles([{ name: 'CSV', extensions: ['csv', 'txt'] }])
    if (!f[0]) return
    const txt = new TextDecoder().decode(await window.kc.readFile(f[0]))
    const recs = txt.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')))
    const ids = recs.map((r) => Number(r[0])).filter((n) => teams.some((t) => t.id === n))
    setBulk([...new Set([...bulkSelection, ...ids])])
    setBusy(true)
    try {
      for (const r of recs) {
        const id = Number(r[0])
        const patch: Partial<Row> = {}
        if (/^#[0-9a-f]{6}$/i.test(r[2] ?? '')) patch.c1 = r[2]
        if (/^#[0-9a-f]{6}$/i.test(r[3] ?? '')) patch.c2 = r[3]
        if (/^#[0-9a-f]{6}$/i.test(r[4] ?? '')) patch.c3 = r[4]
        if (r[5]) patch.crest = await assetFromUrl(r[5]).catch(() => undefined)
        if (r[6]) patch.brand = await assetFromUrl(r[6]).catch(() => undefined)
        if (r[7]) patch.sponsor = await assetFromUrl(r[7]).catch(() => undefined)
        setTimeout(() => setRow(id, patch), 600)
      }
      notify('ok', `${recs.length} linhas importadas`)
    } finally { setBusy(false) }
  }

  const generated = useMemo(() => rows.filter((r) => r.project).length, [rows])

  return (
    <div className="bulk">
      <div className="bulk-settings">
        <div className="bs-group">
          <b>Kits a gerar</b>
          {['p1', 'p2', 'p3', 'g1', 'g2'].map((s) => (
            <label key={s} className="check"><input type="checkbox" checked={slots.includes(s)} onChange={(e) => setSlots(e.target.checked ? [...slots, s].sort(slotOrder) : slots.filter((x) => x !== s))} /> {SLOT_LABEL[s]}</label>
          ))}
        </div>
        <div className="bs-group">
          <b>Templates</b>
          <label>Principal <Select value={tpl.home} options={TPL_OPTS} onChange={(home) => setTpl({ ...tpl, home })} /></label>
          <label>Alternativo <Select value={tpl.away} options={TPL_OPTS} onChange={(away) => setTpl({ ...tpl, away })} /></label>
          <label>Terceiro <Select value={tpl.third} options={TPL_OPTS} onChange={(third) => setTpl({ ...tpl, third })} /></label>
          <label>GR <Select value={tpl.gk} options={TPL_OPTS} onChange={(gk) => setTpl({ ...tpl, gk })} /></label>
        </div>
        <div className="bs-group">
          <b>Para todas as equipas</b>
          <span className="inline">Badge manga direita: {badge && <img className="logo-thumb" src={badge.dataUrl} alt="" />}<AssetPicker label={badge ? 'Trocar' : 'Escolher'} onPick={setBadge} />{badge && <button className="btn tiny ghost" onClick={() => setBadge(undefined)}>✕</button>}</span>
          <span className="inline">Marca: {brand && <img className="logo-thumb" src={brand.dataUrl} alt="" />}<AssetPicker label={brand ? 'Trocar' : 'Escolher'} folderHint="MARCAS" onPick={setBrand} />{brand && <button className="btn tiny ghost" onClick={() => setBrand(undefined)}>✕</button>}</span>
          <span className="inline">Patrocinador: {sponsor && <img className="logo-thumb" src={sponsor.dataUrl} alt="" />}<AssetPicker label={sponsor ? 'Trocar' : 'Escolher'} onPick={setSponsor} />{sponsor && <button className="btn tiny ghost" onClick={() => setSponsor(undefined)}>✕</button>}</span>
          <label className="check"><input type="checkbox" checked={emblemInGame} onChange={(e) => setEmblemInGame(e.target.checked)} /> Atualizar emblemas no jogo</label>
        </div>
        <div className="bs-group actions">
          <button className="btn" onClick={importCsv} disabled={busy}>Importar CSV</button>
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Exportar CSV</button>
          <button className="btn primary" onClick={generateAll} disabled={busy || !rows.length || !slots.length}>Gerar {rows.length} equipas</button>
          <button className="btn primary" onClick={exportAll} disabled={busy || !generated}>Guardar {generated} equipas</button>
        </div>
      </div>
      {!rows.length && <div className="empty">Seleciona equipas no separador <b>Equipas</b> (caixas de seleção) ou importa um CSV.</div>}
      <div className="bulk-rows">
        {rows.map((r) => (
          <div key={r.teamId} className="bulk-row">
            <div className="br-team">
              {r.crest ? <img className="emblem-img" src={r.crest.dataUrl} alt="" /> : <Emblem id={r.teamId} />}
              <div><b>{r.name}</b><div className="muted small">#{r.teamId} · {r.league}</div>{r.status && <div className="small">{r.status}</div>}</div>
            </div>
            <div className="br-colors">
              <ColorInput value={r.c1} onChange={(c1) => setRow(r.teamId, { c1, project: undefined })} />
              <ColorInput value={r.c2} onChange={(c2) => setRow(r.teamId, { c2, project: undefined })} />
              <ColorInput value={r.c3} onChange={(c3) => setRow(r.teamId, { c3, project: undefined })} />
            </div>
            <div className="br-tpls" title="Design base de cada equipamento desta equipa">
              {slots.map((sl) => (
                <label key={sl}>{SLOT_LABEL[sl] ?? sl}
                  <select value={r.tpls?.[sl] ?? 'default'} onChange={(e) => setRow(r.teamId, { tpls: { ...r.tpls, [sl]: e.target.value }, project: undefined })}>
                    <option value="default">(geral)</option>
                    {TPL_OPTS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="br-logos">
              <AssetPicker label="Emblema" folderHint="LOGOS" onPick={async (a) => {
                const pal = palette(trim(await loadAsset(a)), 5)
                const [c1, c2, c3] = teamColorsFromPalette(pal)
                setRow(r.teamId, { crest: a, c1, c2, c3, project: undefined })
              }} />
              <AssetPicker label={r.brand ? 'Marca ✓' : 'Marca'} folderHint="MARCAS" onPick={(brand) => setRow(r.teamId, { brand, project: undefined })} />
              <AssetPicker label={r.sponsor ? 'Patroc. ✓' : 'Patroc.'} onPick={(sponsor) => setRow(r.teamId, { sponsor, project: undefined })} />
            </div>
            <div className="br-kits">
              {r.thumbs ? slots.map((s) => r.thumbs![s] && <img key={s} src={r.thumbs![s]} title={SLOT_LABEL[s]} alt={s} />) : <span className="muted small">por gerar</span>}
            </div>
            <div className="br-actions">
              <button className="btn small" disabled={busy} onClick={async () => setRow(r.teamId, await build(r))}>{r.project ? 'Regenerar' : 'Gerar'}</button>
              <button className="btn small" disabled={!r.project} onClick={() => { loadProject(r.project!, null); setView('editor') }}>Editar</button>
              <button className="btn tiny ghost" onClick={() => setBulk(bulkSelection.filter((x) => x !== r.teamId))}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
