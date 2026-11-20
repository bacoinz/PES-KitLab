/**
 * Settings tab, three cards sized to their content:
 *  - Geral: language, game folder, data folder, export;
 *  - 2D, 3D e pré-visualizações: 3D view defaults, the 2D texture background, the grids' preview colours;
 *  - Templates: the template of each kind of new kit, made in the editor (plus a couple of new-kit options).
 */
import { useState } from 'react'
import { useApp } from '../state'
import { LIGHT_PRESETS } from '../three/KitViewer'
import { ColorInput } from './common'
import { Footer, KofiButton } from './Footer'
import { ShortcutSettings } from './ShortcutSettings'
import type { KitDefaults, PresetType, Settings as S } from '@shared/ipc'

const ls = (k: string, d: string): string => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const lsSet = (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export function Settings(): JSX.Element {
  const { settings, status, notify, openGame, project, activeSlot, openPresetEditor } = useApp()
  const save = async (patch: Partial<S>): Promise<void> => {
    const s = await window.kc.saveSettings(patch)
    useApp.setState({ settings: s })
  }
  const def: KitDefaults = settings?.defaults ?? {}
  const setDef = (patch: Partial<KitDefaults>): Promise<void> => save({ defaults: { ...def, ...patch } })
  const kit = project?.kits.find((k) => k.slot === activeSlot)
  const sel = (value: string | number | undefined, options: [string | number, string][], on: (v: string) => void): JSX.Element => (
    <select value={String(value ?? '')} onChange={(e) => on(e.target.value)}>{options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}</select>
  )
  // 2D texture view (the editor reads these when it opens)
  const [texBg, setTexBg] = useState(() => ls('kc.texBg', '#1b1e25'))
  const [showBg, setShowBg] = useState(() => ls('kc.showTexBg', '1') !== '0')
  const [outline, setOutline] = useState(() => ls('kc.tplOutline', '0') === '1')
  const pc = settings?.previewColors ?? ['#ff1493', '#39ff14', '#00e5ff']
  return (
    <div className="settings-wrap">
    <div className="settings-page">
      <section className="set-card">
        <h3>Geral</h3>
        <div className="set-sub" data-notr>Idioma · Language</div>
        {sel(settings?.lang ?? 'pt', [['pt', 'Português'], ['en', 'English'], ['es', 'Español']], (lang) => { void save({ lang: lang as S['lang'] }); notify('ok', lang === 'pt' ? 'Idioma: Português' : lang === 'en' ? 'Language: English' : 'Idioma: Español') })}

        <div className="set-sub">Pasta do jogo</div>
        <div className="set-row"><code className="grow">{settings?.gameRoot ?? status?.root ?? '—'}</code>
          <button className="btn small" onClick={async () => {
            const d = await window.kc.pickFolder('Pasta do jogo (onde está o FL_2027.exe)')
            if (!d) return
            try { await openGame(d); notify('ok', 'Jogo: ' + d) } catch (e) { notify('err', String((e as Error).message ?? e)) }
          }}>Alterar…</button>
          {settings?.gameRoot && <button className="btn small ghost" onClick={() => window.kc.openPath(settings.gameRoot!)}>Abrir</button>}
        </div>
        <div className="muted small">Se mudares o jogo de sítio, escolhe aqui a pasta nova (onde estão o FL_2027.exe e a SiderAddons).</div>

        <div className="set-sub">Dados</div>
        <div className="set-row">
          <button className="btn small" onClick={async () => { const t = await window.kc.listTextures('patterns'); window.kc.openPath(t.root.replace(/[\\/]library[\\/][^\\/]+$/, '')) }}>Abrir a pasta KitCreatorData</button>
          <button className="btn small ghost" onClick={() => { if (!confirm('Repor as preferências da interface (painéis, vista 3D, cores guardadas)?')) return; try { Object.keys(localStorage).filter((k) => k.startsWith('kc.')).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ } notify('ok', 'Preferências repostas') }}>Repor preferências da interface</button>
        </div>

        <div className="set-sub">Pasta de exportação dos kits</div>
        <div className="set-row">
          <code className="grow" style={{ opacity: settings?.kitExportAsk ?? true ? 0.45 : 1 }}>{settings?.kitExportDir || '—'}</code>
          <button className="btn small" disabled={settings?.kitExportAsk ?? true} onClick={async () => {
            const d = await window.kc.pickFolder('Pasta predefinida para exportar os kits')
            if (d) await save({ kitExportDir: d })
          }}>Alterar…</button>
          {settings?.kitExportDir && <button className="btn small ghost" onClick={() => window.kc.openPath(settings.kitExportDir!)}>Abrir</button>}
        </div>
        <label className="check"><input type="checkbox" checked={settings?.kitExportAsk ?? true} onChange={(e) => save({ kitExportAsk: e.target.checked })} /> Perguntar sempre</label>
        <div className="muted small">Cada clube é exportado para uma pasta com o seu nome dentro desta pasta.</div>

        <div className="set-sub">Gravação automática</div>
        <div className="set-grid">
          <label>Guardar a equipa aberta</label>{sel(settings?.autoSave ?? 0, [[0, 'Desligada'], [2, 'De 2 em 2 minutos'], [5, 'De 5 em 5 minutos'], [10, 'De 10 em 10 minutos'], [15, 'De 15 em 15 minutos']], (v) => save({ autoSave: Number(v) as S['autoSave'] }))}
        </div>

        <div className="set-sub">Exportação</div>
        <div className="set-grid">
          <label>Formato</label>{sel(settings?.defaultFormat ?? 'DXT5', [['DXT5', 'DXT5 (rápido, igual aos kit-server)'], ['BC7', 'BC7 (melhor qualidade, mais lento)']], (v) => save({ defaultFormat: v as S['defaultFormat'] }))}
          <label>Tamanho da textura</label>{sel(settings?.exportSize ?? 2048, [[512, '512 px'], [1024, '1024 px'], [2048, '2048 px (igual ao jogo)'], [4096, '4096 px']], (v) => save({ exportSize: Number(v) as S['exportSize'] }))}
        </div>
      </section>

      <section className="set-card">
        <h3>2D, 3D e pré-visualizações</h3>
        <div className="set-sub">Vista 3D</div>
        <div className="set-grid">
          <label>Luz</label>{sel(ls('kc.v3.preset', 'hdri'), LIGHT_PRESETS, (v) => { lsSet('kc.v3.preset', v); notify('ok', 'Luz predefinida guardada') })}
          <label>Intensidade</label><input type="number" min={0} max={100} defaultValue={Number(ls('kc.light', '40'))} onChange={(e) => lsSet('kc.light', String(Math.max(0, Math.min(100, Number(e.target.value) || 0))))} />
          <label>Camisola</label>{sel(ls('kc.tucked', '0'), [['0', 'Por fora dos calções'], ['1', 'Por dentro dos calções']], (v) => lsSet('kc.tucked', v))}
        </div>
        <div className="set-sub">Textura 2D</div>
        <label className="check"><input type="checkbox" checked={showBg} onChange={(e) => { setShowBg(e.target.checked); lsSet('kc.showTexBg', e.target.checked ? '1' : '0') }} /> Pintar o fundo (zonas que o jogo não usa)</label>
        <label className="check"><input type="checkbox" checked={outline} onChange={(e) => { setOutline(e.target.checked); lsSet('kc.tplOutline', e.target.checked ? '1' : '0') }} /> Mostrar os contornos do template</label>
        <div className="set-grid"><label>Cor do fundo</label><ColorInput value={texBg} onChange={(v) => { setTexBg(v); lsSet('kc.texBg', v) }} /></div>
        <div className="set-sub">Pré-visualizações das grelhas</div>
        <div className="muted small">Cores com que as grelhas de Designs, Padrões, golas e punhos mostram cada design (1.ª, 2.ª e 3.ª cor) e a cor do kit por baixo.</div>
        <div className="set-grid">
          {(['1.ª cor', '2.ª cor', '3.ª cor'] as const).map((label, i) => [
            <label key={'l' + i}>{label}</label>,
            <ColorInput key={'c' + i} value={pc[i]} onChange={(v) => { const n = [...pc]; n[i] = v; void save({ previewColors: n }) }} />
          ])}
          <label>Kit por baixo</label><ColorInput value={settings?.previewBase ?? '#eeeeee'} onChange={(previewBase) => void save({ previewBase })} />
        </div>
        <div className="set-row"><button className="btn small ghost" onClick={() => void save({ previewColors: ['#ff1493', '#39ff14', '#00e5ff'], previewBase: '#eeeeee' })}>Repor cores</button></div>
        <div className="muted small">A vista 3D e a textura 2D aplicam-se da próxima vez que abrires o editor.</div>
      </section>

      <section className="set-card">
        <h3>Templates</h3>
        <div className="muted small">O kit com que cada equipamento novo começa: desenha-o no editor e carrega em Guardar (as cores passam a ser as de cada equipa).</div>
        <div className="preset-rows">
          {([['home', 'Principal'], ['away', 'Alternativo'], ['third', 'Terceiro'], ['fourth', 'Quarto'], ['gk', 'Guarda-redes']] as [PresetType, string][]).map(([t, label]) => {
            const own = def.presets?.[t]
            return (
              <div key={t} className="preset-row">
                <label>{label}</label>
                <span className="muted small">{own ? 'Template próprio ✓' : t === 'fourth' && def.presets?.third ? 'Igual ao terceiro' : 'Automático'}</span>
                <button className="btn small" title="Abre o editor com este kit: desenha-o e carrega em Guardar" onClick={() => openPresetEditor(t)}>{own ? 'Editar no editor' : 'Criar no editor'}</button>
                {own ? <button className="btn small ghost" onClick={() => { const p = { ...def.presets }; delete p[t]; void setDef({ presets: p }) }}>Esquecer</button> : <span />}
              </div>
            )
          })}
        </div>
        <div className="set-grid">
          <label>Justa ao corpo</label>{sel(def.tight === undefined ? '' : def.tight ? '1' : '0', [['', 'Do template'], ['1', 'Sim'], ['0', 'Não']], (v) => setDef({ tight: v === '' ? undefined : v === '1' }))}
          <label>Número no peito</label>{sel(def.chestNumber ?? 'auto', [['auto', 'Só nas seleções'], ['always', 'Sempre'], ['never', 'Nunca']], (v) => setDef({ chestNumber: v as KitDefaults['chestNumber'] }))}
        </div>
        <div className="set-row">
          <button className="btn small" disabled={!kit} title="Guarda o design do kit aberto (camadas, gola, punhos, modelos) para todos os equipamentos novos sem template próprio. As cores são trocadas pelas da equipa."
            onClick={() => { if (!kit) return; const { logos: _l, numbers: _n, slot: _s, base: _b, ...rest } = kit; void setDef({ preset: JSON.stringify(rest) }); notify('ok', 'Kit aberto guardado como predefinido') }}>Usar o kit aberto como predefinido</button>
          {def.preset && <><span className="muted small">Predefinido guardado ✓</span><button className="btn small ghost" onClick={() => setDef({ preset: undefined })}>Esquecer</button></>}
        </div>
      </section>

      <ShortcutSettings />

      <section className="set-card">
        <h3>Apoiar o projeto</h3>
        <div className="muted small">O PES KitLab é gratuito. Se te poupa tempo, podes ajudar a manter o desenvolvimento.</div>
        <div className="set-row"><KofiButton /></div>
      </section>
    </div>
    <Footer />
    </div>
  )
}
