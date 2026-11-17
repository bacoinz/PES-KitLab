# PES KitLab

Criador de equipamentos portátil (Windows) para o **SP Football Life 2027** (base PES 2021, Sider 7.3.3): lê as equipas do jogo, edita/cria kits com pré-visualização 3D, gera em massa e exporta para o Sider kit-server.
A UI e as respostas são em **PT-PT**. Alterações por versão: `CHANGELOG.md`.

## Stack
- Tauri 2 + núcleo Rust (`app-tauri/src-tauri`): CPK/FTEX/FMDL, índice do jogo, exportação, kit-server.
- UI React + TypeScript + Vite (`app-tauri/src`), compositor WebGL2, viewer three.js com modelos GLB Comet.
- Rust em `%USERPROFILE%\.cargo\bin` (acrescentar ao PATH).

## Estrutura
```
app-tauri/
  src-tauri/src/   lib.rs (comandos Tauri), store.rs (exportar/versões), game/ (cpk, wesys, tex, fmdl, index, teams, kitserver)
  src/compositor/  gpu.ts, compose.ts, uv.ts, designs.ts, template.ts (2D = fonte)
  src/three/       KitViewer.tsx, comet.ts (3D só embrulha o 2D)
  src/model/       design.ts (KitDesign, migrações vN), templates.ts
  src/ui/          Editor, Teams, Bulk, Settings, common
  src/i18n*.ts     tradução PT→EN/ES por correspondência exata
  scripts/         export_comet_glb.py (Blender → public/models)
  public/          modelos GLB, kit-template.png, logo
docs/              notas de design e capturas
```

## Comandos (em `app-tauri/`)
```bash
npm install
npx tsc --noEmit                      # typecheck
cd src-tauri && cargo test --release  # testes Rust (usam o jogo real, só leitura)
npx tauri build --no-bundle           # exe em src-tauri/target/release/
npm run dist                          # sobe patch, compila, copia para dist-portable/
npm run dist:same                     # igual, sem subir a versão
```
UI automática: `KC_SCRIPT=passos.json` (+ `KC_DATA=<pasta>`) corre passos `{wait, js, shot, quit}` e escreve `passos.json.log`; ganchos `window.__kc`, `window.__kcTest`, `window.__kcView`.

## Regras
- **Estilo**: ficheiros de texto sem BOM (cuidado com `Set-Content -Encoding utf8` no PowerShell 5); textos novos na UI em português + entrada no `i18n-dict.ts`; mudar o formato de `KitDesign` = nova versão + `toVN`.
- O 2D é a fonte; o 3D só embrulha. A textura 2D nunca muda por causa do 3D.
- Só se escreve o que é da app: secção KitCreator no fim de `map.txt`, `content\kits\KitCreator\…`, raiz `livecpk\KitCreator`, linha `cpk.root` no `sider.ini`. Dados em `KitCreatorData\` ao lado do exe (debug: `app-tauri/KitCreatorData` ou `KC_DATA`); o nome interno `KitCreatorData`/`pt.kitcreator.pes` não muda.
- `loadModel` devolve arrays em cache: nunca lhes fazer push.
- **Testes**: depois de alterações podes correr a app (`KC_SCRIPT`) e testar a escrita de ficheiros sem pedir licença.
- **Git/release**: depois de alterações podes fazer commit da versão sem pedir. Push, tags e releases no GitHub só quando o utilizador disser. Cada alteração entra no `CHANGELOG.md`; este ficheiro mantém-se curto (sem histórico).
- O email do utilizador é privado (repositório público: autor com o email noreply do GitHub).
- Jogo: `D:\Games\SP Football Life 2027`.
