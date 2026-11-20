/** "Imagem de referência" section of the Origin tab: load, show as a floating window, show over the kit on the 2D view. */
import { loadReferenceFromPath, REF_EXTS, useRef2 } from './reference'
import { Row, Slider, Select } from './common'
import { useApp } from '../state'

export function ReferencePanel(): JSX.Element {
  const { url, name, img, overlay: o, win, setOverlay, setWin, resetWin, clear } = useRef2()
  const notify = useApp((s) => s.notify)
  const pick = async (): Promise<void> => {
    try {
      const [p] = await window.kc.pickFiles([{ name: 'Imagens', extensions: REF_EXTS }])
      if (p) await loadReferenceFromPath(p)
    } catch (e) { notify('err', String((e as Error).message ?? e)) }
  }
  return (
    <div className="ref-panel">
      <div className="muted small">Uma foto ou captura de um equipamento real para copiar. Fica só neste computador, nesta sessão: nunca entra na textura exportada nem no 3D. Funciona melhor com equipamentos esticados ou planos; fotos de jogadores em movimento não encaixam no molde.</div>
      <div className="btn-row">
        <button className="btn small" onClick={pick}>{url ? 'Trocar imagem…' : 'Escolher imagem…'}</button>
        {url && <button className="btn small ghost" onClick={clear}>Remover</button>}
      </div>
      <div className="muted small">Também podes colar (Ctrl+V) ou largar uma imagem em cima do visualizador.</div>
      {url && img && (
        <>
          <img className="ref-panel-thumb" src={url} alt="" title={name} />
          <div className="muted small">{`${name} — ${img.naturalWidth}×${img.naturalHeight}`}</div>
          <div className="sub-title">Janela flutuante</div>
          <label className="check"><input type="checkbox" checked={win.open} onChange={(e) => setWin({ open: e.target.checked, min: false })} /> Mostrar a janela de referência</label>
          <div className="btn-row"><button className="btn small ghost" onClick={resetWin}>Repor posição e tamanho</button></div>
          <div className="muted small">Arrasta a barra para a mudar de sítio, o canto para mudar o tamanho, a roda do rato faz zoom e duplo clique ajusta.</div>
          <div className="sub-title">Sobre o kit (textura 2D)</div>
          <label className="check"><input type="checkbox" checked={o.on} onChange={(e) => setOverlay({ on: e.target.checked })} /> Mostrar sobre o kit</label>
          {o.on && (
            <>
              <Row label="Posição"><Select value={o.above ? 'above' : 'below'} options={[['above', 'Por cima do kit'], ['below', 'Por baixo do kit']]} onChange={(v) => setOverlay({ above: v === 'above' })} /></Row>
              <Row label="Opacidade"><Slider value={o.opacity} min={5} max={100} onChange={(opacity) => setOverlay({ opacity })} /></Row>
              <Row label="Tamanho"><Slider value={o.scale} min={10} max={300} onChange={(scale) => setOverlay({ scale })} /></Row>
              <Row label="Esquerda / direita"><Slider value={o.dx} min={-1024} max={1024} onChange={(dx) => setOverlay({ dx })} /></Row>
              <Row label="Cima / baixo"><Slider value={o.dy} min={-1024} max={1024} onChange={(dy) => setOverlay({ dy })} /></Row>
              <Row label="Rotação"><Slider value={o.rot} min={-180} max={180} onChange={(rot) => setOverlay({ rot })} /></Row>
              <div className="muted small">Só se vê na vista de textura 2D. Com o conta-gotas ativo, clicar lê a cor que se vê (incluindo a referência).</div>
            </>
          )}
        </>
      )}
    </div>
  )
}
