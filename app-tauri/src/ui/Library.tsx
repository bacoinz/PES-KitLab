import { useEffect, useMemo, useState } from 'react'
import { useApp, assetFromFile, previewAssetFromFile, type UserTemplate, type UserLayerSet } from '../state'
import { kitPreview3d } from '../previews'
import type { KitDesign } from '../model/design'
import { defaultDesign } from '../model/design'
import { LocalImg, AssetPicker } from './common'
import { MonoLogoModal } from './MonoLogo'
import { listLayerSets } from './LayerSets'
import type { Asset } from '../model/design'

/** 3D preview of a PNG kit texture. */
function ImgThumb({ path }: { path: string }): JSX.Element {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    ;(async () => {
      const a = await previewAssetFromFile(path, 1024)
      const k = defaultDesign('p1')
      const u = await kitPreview3d({ ...k, layers: [], base: { kind: 'image', imageAssetId: a.id, recolor: [] }, logos: { ...k.logos, crest: { ...k.logos.crest, enabled: false }, brand: { ...k.logos.brand, enabled: false } } }, { [a.id]: a }, 'torso', 'libimg:' + path)
      if (alive) setSrc(u)
    })().catch(() => undefined)
    return () => { alive = false }
  }, [path])
  return <div className="tpl-img">{src ? <img src={src} alt="" /> : <span className="spinner" />}</div>
}

/** 3D preview of a saved template (no crest / sponsors). */
function TplThumb({ t }: { t: UserTemplate }): JSX.Element {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    kitPreview3d({ ...(t.kit as KitDesign), slot: 'p1' }, t.assets, 'torso', 'libtpl:' + t.id + t.date).then((u) => { if (alive) setSrc(u) }).catch(() => undefined)
    return () => { alive = false }
  }, [t.id, t.date]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="tpl-img">{src ? <img src={src} alt="" /> : <span className="spinner" />}</div>
}

export function Library(): JSX.Element {
  const { library, settings, refreshLibrary, notify } = useApp()
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState('')
  const [mono, setMono] = useState<Asset | null>(null)
  // saved shirt templates (KitCreatorData/templates)
  const [tpls, setTpls] = useState<UserTemplate[]>([])
  const openUserTemplate = useApp((s) => s.openUserTemplate)
  const loadTpls = (): void => { window.kc.listUserTemplates().then((l) => setTpls(l.map((j) => { try { return JSON.parse(j) as UserTemplate } catch { return null } }).filter((x): x is UserTemplate => !!x).sort((a, b) => String(b.date).localeCompare(String(a.date))))).catch(() => setTpls([])) }
  useEffect(loadTpls, [])
  const [lsets, setLsets] = useState<UserLayerSet[]>([])
  const loadSets = (): void => { listLayerSets().then(setLsets) }
  useEffect(loadSets, [])
  const showSets = folder === '\u0000layers'
  const showTpls = folder === '\u0000templates'
  const showImgs = folder === '\u0000tplimgs'
  const [imgs, setImgs] = useState<{ path: string; name: string; category: string }[]>([])
  const loadImgs = (): void => { window.kc.listTemplateImages().then(setImgs).catch(() => setImgs([])) }
  useEffect(loadImgs, [])
  const folders = settings?.logoFolders ?? []
  const items = useMemo(() => library.filter((l) => (!folder || l.folder === folder) && l.name.toLowerCase().includes(q.toLowerCase())).slice(0, 600), [library, folder, q])
  const saveFolders = async (logoFolders: string[]): Promise<void> => {
    const s = await window.kc.saveSettings({ logoFolders })
    useApp.setState({ settings: s })
    await refreshLibrary()
  }
  return (
    <div className="library">
      <aside className="leagues">
        <div className="leagues-head">Pastas</div>
        <button className={'league' + (showSets ? ' active' : '')} onClick={() => { setFolder('\u0000layers'); loadSets() }}>Camadas guardadas <span>{lsets.length}</span></button>
        <button className={'league' + (showTpls ? ' active' : '')} onClick={() => { setFolder('\u0000templates'); loadTpls() }}>Templates de camisolas <span>{tpls.length}</span></button>
        <button className={'league' + (showImgs ? ' active' : '')} onClick={() => { setFolder('\u0000tplimgs'); loadImgs() }}>Templates de texturas (PNG) <span>{imgs.length}</span></button>
        <button className={'league' + (!folder ? ' active' : '')} onClick={() => setFolder('')}>Todas <span>{library.length}</span></button>
        {folders.map((f) => {
          const name = f.split(/[\\/]/).pop()!
          return (
            <div key={f} className="folder-row">
              <button className={'league' + (folder === name ? ' active' : '')} title={f} onClick={() => setFolder(name)}>{name} <span>{library.filter((l) => l.folder === name).length}</span></button>
              <button className="btn tiny ghost" title="Abrir pasta" onClick={() => window.kc.openPath(f)}>↗</button>
              <button className="btn tiny ghost" title="Remover da lista" onClick={() => saveFolders(folders.filter((x) => x !== f))}>✕</button>
            </div>
          )
        })}
        <button className="btn small" onClick={async () => {
          const d = await window.kc.pickFolder('Pasta com logos, marcas ou patrocínios')
          if (d && !folders.includes(d)) await saveFolders([...folders, d])
        }}>+ Adicionar pasta</button>
        <div className="muted small pad">Põe PNG/WEBP/SVG nestas pastas e ficam disponíveis em todo o lado. Também podes usar um URL diretamente no editor.</div>
        <div className="pad">
          <b>Logo monocromático</b>
          <div className="muted small">Converte um logo numa só cor (branco, preto, dourado…). Também podes clicar num logo da lista.</div>
          <AssetPicker label="Escolher logo…" onPick={setMono} />
        </div>
        <div className="muted small pad">Formato e tamanho de exportação estão agora em Definições.</div>
      </aside>
      <section className="team-list">
        <div className="toolbar">
          <input className="search" placeholder="Pesquisar…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost" onClick={refreshLibrary}>⟳</button>
        </div>
        {showSets && (
          <div className="tpl-grid">
            {!lsets.length && <div className="muted pad">Ainda não há camadas guardadas. No separador Analisador, analisa uma textura e usa «Guardar na biblioteca». No editor: Adicionar camada → Da biblioteca.</div>}
            {lsets.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).map((t) => (
              <div key={t.id} className="tpl-card">
                <div className="tpl-img az-thumb">{t.thumb ? <img src={t.thumb} alt="" /> : null}</div>
                <b title={t.name}>{t.name}</b>
                <span className="muted small">{`${t.layers.length} camada(s) · ${new Date(t.date).toLocaleDateString()}`}</span>
                <div className="btn-row">
                  <button className="btn small ghost" onClick={async () => {
                    const name = prompt('Nome do conjunto de camadas', t.name)
                    if (!name || name === t.name) return
                    await window.kc.saveUserLayers(t.id, JSON.stringify({ ...t, name }))
                    loadSets()
                  }}>Renomear</button>
                  <button className="btn small ghost danger-text" onClick={async () => { if (!confirm(`Apagar "${t.name}"?`)) return; await window.kc.deleteUserLayers(t.id); loadSets() }}>Apagar</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {showTpls && (
          <div className="tpl-grid">
            {!tpls.length && <div className="muted pad">Ainda não há templates. No editor: Origem → "Guardar como template…".</div>}
            {tpls.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).map((t) => (
              <div key={t.id} className="tpl-card">
                <TplThumb t={t} />
                <b title={t.name}>{t.name}</b>
                <span className="muted small">{new Date(t.date).toLocaleDateString()}</span>
                <div className="btn-row">
                  <button className="btn small" onClick={() => openUserTemplate(t)}>Editar</button>
                  <button className="btn small ghost" onClick={async () => {
                    const name = prompt('Nome do template', t.name)
                    if (!name || name === t.name) return
                    await window.kc.saveUserTemplate(t.id, JSON.stringify({ ...t, name }))
                    loadTpls()
                  }}>Renomear</button>
                  <button className="btn small ghost danger-text" onClick={async () => { if (!confirm(`Apagar o template "${t.name}"?`)) return; await window.kc.deleteUserTemplate(t.id); loadTpls() }}>Apagar</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {showImgs && (
          <div className="tpl-grid">
            <div className="tpl-head">
              <span className="muted small">Texturas completas do kit (PNG 2048×2048) em KitCreatorData\\templates. No editor: Origem → Carregar template ▸ → Texturas PNG.</span>
              <button className="btn small" onClick={async () => window.kc.openPath(await window.kc.templateDirPath())}>Abrir pasta</button>
              <button className="btn small ghost" onClick={loadImgs}>⟳</button>
            </div>
            {imgs.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).map((t) => (
              <div key={t.path} className="tpl-card">
                <ImgThumb path={t.path} />
                <b title={t.path}>{t.name}</b>
                <span className="muted small">{t.category || '—'}</span>
              </div>
            ))}
          </div>
        )}
        {!showTpls && !showImgs && !showSets && <div className="lib-grid big">
          {items.map((it) => (
            <div key={it.path} className="lib-item" title={it.path + ' — clicar para fazer uma versão monocromática'} onClick={() => assetFromFile(it.path).then(setMono).catch((e) => notify('err', String(e)))}><LocalImg path={it.path} /><span>{it.name}</span></div>
          ))}
        </div>}
      </section>
      {mono && <MonoLogoModal asset={mono} onClose={() => setMono(null)} />}
    </div>
  )
}
