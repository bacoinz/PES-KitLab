//! PES Kit Creator – Tauri core. Commands mirror `src/shared/ipc.ts` (window.kc); the JS shim in `src/kc.ts`
//! maps each camelCase method to the snake_case command here. Large binary payloads travel as raw IPC bodies.
pub mod fonts;
pub mod game;
pub mod kitlab;
pub mod store;

use game::fmdl::{parse_fmdl, MeshData};
use game::index::GameIndex;
use game::kitserver::read_text;
use game::tex::{decode_dds, decode_ftex};
use game::teams::{emblem_path, kit_tex_name, load_teams, TeamInfo, KIT_TEX_DIR};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use store::{b64, ExportResult, SnapshotInfo, Store, TeamExport};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

type R<T> = Result<T, String>;
fn e2s<E: std::fmt::Display>(e: E) -> String { e.to_string() }

pub struct AppState {
    data_dir: PathBuf,
    settings: Mutex<Value>,
    gi: Mutex<Option<Arc<RwLock<GameIndex>>>>,
    teams: Mutex<Vec<TeamInfo>>,
}

impl AppState {
    fn gi(&self) -> R<Arc<RwLock<GameIndex>>> {
        self.gi.lock().unwrap().clone().ok_or_else(|| "Escolhe primeiro a pasta do jogo".to_string())
    }
    fn store(&self) -> R<Store> { Ok(Store { data_dir: self.data_dir.clone(), gi: self.gi()? }) }
    fn save_settings(&self) -> R<()> {
        let s = self.settings.lock().unwrap().clone();
        fs::write(self.data_dir.join("settings.json"), serde_json::to_vec_pretty(&s).map_err(e2s)?).map_err(e2s)
    }
}

fn data_dir() -> PathBuf {
    let base = std::env::var_os("KC_DATA").map(PathBuf::from).unwrap_or_else(|| {
        let exe = std::env::current_exe().unwrap_or_default();
        let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
        if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..") } else { dir }
    });
    let d = base.join("KitCreatorData");
    let _ = fs::create_dir_all(&d);
    d
}

/// Standard logo library folders (KitCreatorData/library/…).
const LOGO_DIRS: [&str; 4] = ["Logos", "Brands", "Badges", "Sponsors"];

fn load_settings(dir: &Path) -> Value {
    let mut s: Value = fs::read(dir.join("settings.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}));
    let o = s.as_object_mut().unwrap();
    o.entry("logoFolders").or_insert(json!([]));
    o.entry("defaultFormat").or_insert(json!("DXT5"));
    o.entry("lang").or_insert(json!("pt"));
    if o["logoFolders"].as_array().map(|a| a.is_empty()).unwrap_or(true) {
        let mut f = vec![];
        for p in ["C:/AI Projects/FLLeagueMOD/LOGOS", "C:/AI Projects/FLLeagueMOD/MARCAS"] { if Path::new(p).exists() { f.push(json!(p)); } }
        for n in LOGO_DIRS {
            let p = dir.join("library").join(n);
            let _ = fs::create_dir_all(&p);
            f.push(json!(p.to_string_lossy()));
        }
        o.insert("logoFolders".into(), json!(f));
    }
    // library folders of another KitCreatorData (e.g. copied settings from the old app): bring their files into ours
    let lib = dir.join("library");
    let mut changed = false;
    let fixed: Vec<Value> = o["logoFolders"].as_array().cloned().unwrap_or_default().into_iter().map(|v| {
        let Some(p) = v.as_str() else { return v };
        let path = PathBuf::from(p);
        let norm = p.replace('/', "\\").to_lowercase();
        let ours = lib.to_string_lossy().replace('/', "\\").to_lowercase();
        if !norm.contains("\\kitcreatordata\\library\\") || norm.starts_with(&ours) { return v }
        let Some(name) = path.file_name() else { return v };
        let dest = lib.join(name);
        fn copy_dir(a: &Path, b: &Path) {
            let _ = fs::create_dir_all(b);
            if let Ok(rd) = fs::read_dir(a) {
                for e in rd.flatten() {
                    let (s, t) = (e.path(), b.join(e.file_name()));
                    if s.is_dir() { copy_dir(&s, &t) } else if !t.exists() { let _ = fs::copy(&s, &t); }
                }
            }
        }
        copy_dir(&path, &dest);
        changed = true;
        json!(dest.to_string_lossy())
    }).collect();
    // library folders renamed (2026-11-14): Marcas → Brands, Patrocinadores → Sponsors, plus Badges; folders that no
    // longer exist are dropped and the standard ones that exist are always listed
    let mut fixed: Vec<Value> = fixed.into_iter().filter_map(|v| {
        let p = PathBuf::from(v.as_str()?);
        let renamed = match p.file_name().and_then(|n| n.to_str()) { Some("Marcas") => Some("Brands"), Some("Patrocinadores") => Some("Sponsors"), _ => None };
        let p = match renamed { Some(n) if p.parent().map(|d| d.join(n).exists()).unwrap_or(false) => { changed = true; p.parent().unwrap().join(n) } _ => p };
        if !p.exists() { changed = true; return None }
        Some(json!(p.to_string_lossy()))
    }).collect();
    for n in LOGO_DIRS {
        let p = lib.join(n);
        let listed = fixed.iter().any(|v| v.as_str().map(|x| PathBuf::from(x) == p).unwrap_or(false));
        if p.exists() && !listed { fixed.push(json!(p.to_string_lossy())); changed = true }
    }
    if changed {
        o.insert("logoFolders".into(), json!(fixed));
        let _ = fs::write(dir.join("settings.json"), serde_json::to_vec_pretty(&s).unwrap_or_default());
    }
    s
}

fn progress(app: &AppHandle, m: &str) { let _ = app.emit("kc:progress", m.to_string()); }

/// [u32 width][u32 height][rgba…]; empty = null
fn rgba_response(w: u32, h: u32, data: Vec<u8>) -> Response {
    let mut out = Vec::with_capacity(8 + data.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend(data);
    Response::new(out)
}

/// Raw request body: [u32 headerLen][header JSON][blob…]; header.blobs = lengths.
fn unpack(body: &[u8]) -> R<(Value, Vec<&[u8]>)> {
    if body.len() < 4 { return Err("pedido vazio".into()); }
    let hl = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
    let header: Value = serde_json::from_slice(&body[4..4 + hl]).map_err(e2s)?;
    let mut blobs = vec![];
    let mut p = 4 + hl;
    for l in header["blobs"].as_array().cloned().unwrap_or_default() {
        let l = l.as_u64().unwrap_or(0) as usize;
        blobs.push(&body[p..p + l]);
        p += l;
    }
    Ok((header, blobs))
}
fn raw_body<'a>(req: &'a Request<'_>) -> R<&'a [u8]> {
    match req.body() { InvokeBody::Raw(b) => Ok(b), _ => Err("corpo binário em falta".into()) }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(e2s)?
}

// ---------------------------------------------------------------- settings / dialogs
#[tauri::command]
fn get_settings(st: State<AppState>) -> Value { st.settings.lock().unwrap().clone() }

#[tauri::command]
fn get_version(app: AppHandle) -> String { app.package_info().version.to_string() }

#[tauri::command]
fn save_settings(st: State<AppState>, s: Value) -> R<Value> {
    {
        let mut cur = st.settings.lock().unwrap();
        if let (Some(c), Some(n)) = (cur.as_object_mut(), s.as_object()) { for (k, v) in n { c.insert(k.clone(), v.clone()); } }
    }
    st.save_settings()?;
    Ok(st.settings.lock().unwrap().clone())
}

#[tauri::command]
async fn pick_folder(app: AppHandle, title: Option<String>) -> R<Option<String>> {
    blocking(move || {
        let mut d = app.dialog().file();
        if let Some(t) = title { d = d.set_title(t); }
        Ok(d.blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
    }).await
}

#[derive(serde::Deserialize)]
struct Filter { name: String, extensions: Vec<String> }

#[tauri::command]
async fn pick_files(app: AppHandle, filters: Vec<Filter>, multi: Option<bool>) -> R<Vec<String>> {
    blocking(move || {
        let mut d = app.dialog().file();
        for f in &filters { let ex: Vec<&str> = f.extensions.iter().map(String::as_str).collect(); d = d.add_filter(&f.name, &ex); }
        let paths = if multi.unwrap_or(false) { d.blocking_pick_files().unwrap_or_default() } else { d.blocking_pick_file().into_iter().collect() };
        Ok(paths.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect())
    }).await
}

fn save_dialog(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.dialog().file().set_file_name(name).blocking_save_file().and_then(|p| p.into_path().ok())
}

#[tauri::command]
async fn save_file(app: AppHandle, request: Request<'_>) -> R<Option<String>> {
    let (h, blobs) = unpack(raw_body(&request)?)?;
    let name = h["name"].as_str().unwrap_or("ficheiro").to_string();
    let data = blobs.first().map(|b| b.to_vec()).unwrap_or_default();
    blocking(move || {
        let Some(p) = save_dialog(&app, &name) else { return Ok(None) };
        fs::write(&p, data).map_err(e2s)?;
        Ok(Some(p.to_string_lossy().into_owned()))
    }).await
}

// ---------------------------------------------------------------- texture analyser (split a kit texture into colour layers)
#[tauri::command]
async fn analyze_texture(data_url: String, opts: Option<game::analyze::Opts>) -> R<Value> {
    blocking(move || {
        let (_, body) = data_url.split_once(',').ok_or("Imagem inválida")?;
        let bytes = kitlab::b64_decode(body).ok_or("Imagem corrompida")?;
        let img = image::load_from_memory(&bytes).map_err(e2s)?.to_rgba8();
        let (w, h) = (img.width() as usize, img.height() as usize);
        let a = game::analyze::analyze(img.as_raw(), w, h, &opts.unwrap_or_default())?;
        serde_json::to_value(a).map_err(e2s)
    }).await
}

// ---------------------------------------------------------------- .kitlab (shareable kit file)
#[tauri::command]
async fn export_kitlab(app: AppHandle, name: String, manifest: String, assets: Vec<kitlab::AssetIn>) -> R<Option<String>> {
    blocking(move || {
        let zip = kitlab::build(&manifest, &assets)?;
        let Some(mut p) = app.dialog().file().set_file_name(&name).add_filter("PES KitLab", &["kitlab"]).blocking_save_file().and_then(|p| p.into_path().ok()) else { return Ok(None) };
        if p.extension().is_none() { p.set_extension("kitlab"); }
        fs::write(&p, zip).map_err(e2s)?;
        Ok(Some(p.to_string_lossy().into_owned()))
    }).await
}

#[tauri::command]
async fn read_kitlab(path: String) -> R<Value> {
    blocking(move || {
        let len = fs::metadata(&path).map_err(e2s)?.len();
        if len > kitlab::MAX_TOTAL { return Err("Ficheiro demasiado grande".into()); }
        kitlab::read(&fs::read(&path).map_err(e2s)?)
    }).await
}

// ---------------------------------------------------------------- game
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameStatus { root: String, exe: Option<String>, sider_dir: Option<String>, kits_root: Option<String>, livecpk_roots: Vec<String>, team_count: usize }

#[tauri::command]
async fn open_game(app: AppHandle, root: String) -> R<GameStatus> {
    let a2 = app.clone();
    blocking(move || {
        let st = a2.state::<AppState>();
        progress(&a2, "A abrir o jogo…");
        let p = |m: &str| progress(&a2, m);
        let gi = GameIndex::build(Path::new(&root), &st.data_dir.join("index.json"), &p).map_err(e2s)?;
        progress(&a2, "A ler equipas…");
        let teams = load_teams(&gi).map_err(e2s)?;
        let s = |p: &Option<PathBuf>| p.as_ref().map(|x| x.to_string_lossy().into_owned());
        let status = GameStatus {
            root: gi.paths.root.to_string_lossy().into(), exe: s(&gi.paths.exe), sider_dir: s(&gi.paths.sider_dir), kits_root: s(&gi.paths.kits_root),
            livecpk_roots: gi.paths.livecpk_roots.iter().map(|x| x.to_string_lossy().into_owned()).collect(), team_count: teams.len(),
        };
        *st.gi.lock().unwrap() = Some(Arc::new(RwLock::new(gi)));
        *st.teams.lock().unwrap() = teams;
        st.settings.lock().unwrap()["gameRoot"] = json!(root);
        st.save_settings()?;
        progress(&a2, "");
        Ok(status)
    }).await
}

#[tauri::command]
async fn list_teams(app: AppHandle) -> R<Vec<TeamInfo>> {
    blocking(move || {
        let st = app.state::<AppState>();
        if let Ok(gi) = st.gi() {
            let t = load_teams(&gi.read().unwrap()).map_err(e2s)?;
            *st.teams.lock().unwrap() = t;
        }
        let t = st.teams.lock().unwrap().clone();
        Ok(t)
    }).await
}

fn read_kit_file(st: &AppState, team_id: u32, slot: &str, part: &str) -> R<Option<Vec<u8>>> {
    let gi = st.gi()?;
    let teams = st.teams.lock().unwrap();
    let s = teams.iter().find(|t| t.id == team_id).and_then(|t| t.slots.iter().find(|x| x.slot == slot)).cloned();
    drop(teams);
    if let Some(s) = s.filter(|s| s.source == "kitserver") {
        if let Some(file) = &s.file {
            let f = if part == "kit" { Some(PathBuf::from(file)) } else {
                let key = match part { "back" => "BackNumbersFile", "leg" => "LegNumbersFile", "name" => "NameFontFile", _ => "ChestNumbersFile" };
                s.config.as_ref().and_then(|c| c.get(key)).filter(|v| !v.is_empty()).map(|v| Path::new(file).parent().unwrap().join(format!("{v}.ftex")))
            };
            if let Some(f) = f { if let Ok(b) = fs::read(f) { return Ok(Some(b)); } }
        }
    }
    let suffix = if part == "kit" { String::new() } else { format!("_{part}") };
    let g = gi.read().unwrap();
    Ok(g.read(&format!("{KIT_TEX_DIR}{}{suffix}.ftex", kit_tex_name(team_id, slot))))
}

#[tauri::command]
async fn read_kit_texture(app: AppHandle, team_id: u32, slot: String, part: String, mip: u32) -> R<Response> {
    blocking(move || {
        let st = app.state::<AppState>();
        let Some(b) = read_kit_file(&st, team_id, &slot, &part)? else { return Ok(Response::new(vec![])) };
        let mut img = decode_ftex(&b, mip).map_err(e2s)?;
        if part == "kit" { for a in img.data.iter_mut().skip(3).step_by(4) { *a = 255; } }
        Ok(rgba_response(img.width, img.height, img.data))
    }).await
}

#[tauri::command]
async fn read_emblem(app: AppHandle, team_id: u32) -> R<Response> {
    blocking(move || {
        let gi = app.state::<AppState>().gi()?;
        let g = gi.read().unwrap();
        for suf in ["_ll", "_l", ""] { if let Some(b) = g.read(&emblem_path(team_id, suf)) { return Ok(Response::new(b)); } }
        Ok(Response::new(vec![]))
    }).await
}

#[tauri::command]
async fn read_model(app: AppHandle, name: String) -> R<Vec<MeshData>> {
    blocking(move || {
        let gi = app.state::<AppState>().gi()?;
        let inner = if name.starts_with("Asset/") { name } else { format!("Asset/model/character/uniform/{name}") };
        let b = gi.read().unwrap().read(&inner);
        Ok(b.and_then(|b| parse_fmdl(&b).ok()).unwrap_or_default())
    }).await
}

#[tauri::command]
fn list_collars(st: State<AppState>) -> R<Vec<u32>> {
    let gi = st.gi()?;
    let re = Regex::new(r"uniform/nocloth/#Win/collar_(\d+)\.fmdl$").unwrap();
    let mut v: Vec<u32> = gi.read().unwrap().list_cpk(&re).iter().filter_map(|p| re.captures(p).and_then(|c| c[1].parse().ok())).collect();
    v.sort();
    v.dedup();
    Ok(v)
}

#[derive(Serialize, Clone, Default)]
struct NumberSet { id: String, label: String, #[serde(skip_serializing_if = "Option::is_none")] back: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] leg: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] name: Option<String> }

#[tauri::command]
async fn list_number_sets(app: AppHandle) -> R<Vec<NumberSet>> {
    blocking(move || {
        let gi = app.state::<AppState>().gi()?;
        let Some(root) = gi.read().unwrap().paths.kits_root.clone() else { return Ok(vec![]) };
        let re = Regex::new(r"(?i)^(.+?)_(back|leg|name)\.ftex$").unwrap();
        let skip = Regex::new(r"(?i)^u\d+[pg]\d+").unwrap();
        let mut sets: BTreeMap<String, NumberSet> = BTreeMap::new();
        fn walk(dir: &Path, depth: u32, f: &mut dyn FnMut(&Path)) {
            if depth > 5 { return; }
            let Ok(rd) = fs::read_dir(dir) else { return };
            for e in rd.flatten() { let p = e.path(); if p.is_dir() { walk(&p, depth + 1, f) } else { f(&p) } }
        }
        walk(&root, 0, &mut |p| {
            let n = p.file_name().unwrap_or_default().to_string_lossy();
            let Some(m) = re.captures(&n) else { return };
            if skip.is_match(&m[1]) { return; }
            let key = m[1].to_lowercase();
            let s = sets.entry(key.clone()).or_insert_with(|| NumberSet { id: key, label: m[1].to_string(), ..Default::default() });
            let ps = Some(p.to_string_lossy().into_owned());
            match m[2].to_lowercase().as_str() { "back" if s.back.is_none() => s.back = ps, "leg" if s.leg.is_none() => s.leg = ps, "name" if s.name.is_none() => s.name = ps, _ => {} }
        });
        let mut v: Vec<NumberSet> = sets.into_values().filter(|s| s.back.is_some() || s.name.is_some()).collect();
        v.sort_by_key(|s| s.label.to_lowercase());
        Ok(v)
    }).await
}

// ---------------------------------------------------------------- files / library
/// Font families installed on the PC (system + per-user folders).
#[tauri::command]
async fn list_fonts() -> R<Vec<String>> {
    blocking(|| Ok(fonts::list_fonts())).await
}

#[tauri::command]
async fn read_file(path: String) -> R<Response> {
    blocking(move || fs::read(&path).map(Response::new).map_err(e2s)).await
}

#[tauri::command]
async fn decode_image_file(path: String) -> R<Response> {
    blocking(move || {
        let b = fs::read(&path).map_err(e2s)?;
        let ext = Path::new(&path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let img = match ext.as_str() {
            "ftex" => decode_ftex(&b, 0).ok(),
            "dds" => decode_dds(&b).ok(),
            _ => image::load_from_memory(&b).ok().map(|i| { let i = i.to_rgba8(); game::tex::Rgba { width: i.width(), height: i.height(), data: i.into_raw() } }),
        };
        Ok(img.map(|i| rgba_response(i.width, i.height, i.data)).unwrap_or_else(|| Response::new(vec![])))
    }).await
}

#[tauri::command]
async fn fetch_url(url: String) -> R<Response> {
    blocking(move || {
        if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("URL inválido".into()); }
        let r = ureq::get(&url).set("User-Agent", "KitCreator/0.2").call().map_err(|e| format!("Erro ao descarregar: {e}"))?;
        let mime = r.header("content-type").unwrap_or("").to_string();
        let mut data = vec![];
        use std::io::Read;
        r.into_reader().take(30 * 1024 * 1024 + 1).read_to_end(&mut data).map_err(e2s)?;
        if data.len() > 30 * 1024 * 1024 { return Err("Ficheiro demasiado grande".into()); }
        let mut out = (mime.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(mime.as_bytes());
        out.extend(data);
        Ok(Response::new(out))
    }).await
}

#[derive(Serialize)]
struct LibraryItem { path: String, name: String, folder: String }

#[tauri::command]
async fn list_library(app: AppHandle) -> R<Vec<LibraryItem>> {
    blocking(move || {
        let folders: Vec<String> = app.state::<AppState>().settings.lock().unwrap()["logoFolders"].as_array().cloned().unwrap_or_default().iter().filter_map(|v| v.as_str().map(String::from)).collect();
        let re = Regex::new(r"(?i)\.(png|webp|jpe?g|svg|gif|bmp)$").unwrap();
        let mut out = vec![];
        fn walk(dir: &Path, depth: u32, re: &Regex, out: &mut Vec<PathBuf>) {
            if depth > 3 { return; }
            let Ok(rd) = fs::read_dir(dir) else { return };
            for e in rd.flatten() { let p = e.path(); if p.is_dir() { walk(&p, depth + 1, re, out) } else if re.is_match(&p.to_string_lossy()) { out.push(p) } }
        }
        for f in folders {
            let mut v = vec![];
            walk(Path::new(&f), 0, &re, &mut v);
            let folder = Path::new(&f).file_name().unwrap_or_default().to_string_lossy().into_owned();
            for p in v {
                out.push(LibraryItem { name: p.file_stem().unwrap_or_default().to_string_lossy().into(), path: p.to_string_lossy().into(), folder: folder.clone() });
            }
        }
        Ok(out)
    }).await
}

// ---------------------------------------------------------------- pattern / graphic libraries (user textures by category)
const PATTERN_CATS: [&str; 21] = ["Geométrico", "Grunge", "Riscas", "Cultural", "Abstrato", "Natureza", "Zigue-zague", "Multicor", "Xadrez", "Grelha", "Ondas", "Ícones", "Mosaico", "Camuflado", "Pontos", "Chevrons", "Animal", "Tipografia", "Mármore", "Arquitetura", "Mapas"];
const GRAPHIC_CATS: [&str; 17] = ["Riscas", "Listas", "Degradê", "Faixa", "Padrão", "Metades", "Risca única", "Gola", "Mangas", "Lista única", "Chevron", "Xadrez", "Cruz", "Quartos", "Cor inteira", "Multicor", "Auxiliar"];

#[derive(Serialize)]
struct TextureItem { path: String, name: String, category: String }

/// `kind` = "patterns" | "graphics": KitCreatorData/library/<Patterns|Graphics>/<category> (made with the default
/// categories when missing) and the images in it.
#[tauri::command]
async fn list_textures(app: AppHandle, kind: String) -> R<Value> {
    let data_dir = app.state::<AppState>().data_dir.clone();
    blocking(move || {
        let (dir_name, old_name, cats, readme): (&str, &str, &[&str], &str) = if kind == "graphics" {
            ("Graphics", "Gráficos", &GRAPHIC_CATS, "Gráficos: imagens PNG com o desenho completo.\r\n- 2048x2048 (ou outro quadrado) no layout do kit (como o KIT Template.png): aplicadas a toda a textura.\r\n- Outras proporções: desenho da frente, esticado sobre a camisola.\r\nTransparente = sem desenho. Põe cada imagem na pasta da categoria; podes criar pastas novas.\r\n")
        } else {
            ("Patterns", "Padrões", &PATTERN_CATS, "Padrões: imagens que se repetem em mosaico (PNG, JPG, WEBP).\r\n- Preto sobre branco (ou desenho sobre transparente): o desenho toma a cor da camada.\r\n- A camada também pode usar as cores originais da imagem.\r\nPõe cada imagem na pasta da categoria; podes criar pastas novas.\r\n")
        };
        let base = data_dir.join("library").join(dir_name);
        // the old Portuguese folder becomes the new one; the default categories only go into a brand-new folder
        // (the user's own categories are what is there)
        let old = data_dir.join("library").join(old_name);
        if !base.exists() && old.exists() { let _ = fs::rename(&old, &base); }
        let fresh = !base.exists();
        if fresh { for c in cats { let _ = fs::create_dir_all(base.join(c)); } }
        let rd = base.join("LEIA-ME.txt");
        if !rd.exists() { let _ = fs::write(&rd, readme.replace("\\r\\n", "\r\n")); }
        let re = Regex::new(r"(?i)\.(png|webp|jpe?g|gif|bmp)$").unwrap();
        let mut items = vec![];
        let mut categories: Vec<String> = vec![];
        if let Ok(rd) = fs::read_dir(&base) {
            for e in rd.flatten() {
                let p = e.path();
                if !p.is_dir() { continue }
                let cat = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
                if !categories.contains(&cat) { categories.push(cat.clone()) }
                if let Ok(files) = fs::read_dir(&p) {
                    for f in files.flatten() {
                        let fp = f.path();
                        if fp.is_file() && re.is_match(&fp.to_string_lossy()) {
                            items.push(TextureItem { name: fp.file_stem().unwrap_or_default().to_string_lossy().into(), path: fp.to_string_lossy().into(), category: cat.clone() });
                        }
                    }
                }
            }
        }
        categories.sort_by_key(|c| c.to_lowercase());
        Ok(json!({ "root": base.to_string_lossy(), "categories": categories, "items": items }))
    }).await
}

// ---------------------------------------------------------------- export / snapshots
#[tauri::command]
async fn export_team(app: AppHandle, request: Request<'_>) -> R<ExportResult> {
    let body = raw_body(&request)?.to_vec();
    blocking(move || {
        let (h, blobs) = unpack(&body)?;
        let t: TeamExport = serde_json::from_value(h["team"].clone()).map_err(e2s)?;
        let project = h["project"].as_str().unwrap_or("{}").to_string();
        let thumb = h["thumb"].as_u64().and_then(|i| blobs.get(i as usize).copied());
        let st = app.state::<AppState>();
        let fmt = st.settings.lock().unwrap()["defaultFormat"].as_str().unwrap_or("DXT5").to_string();
        let a2 = app.clone();
        let p = move |m: &str| progress(&a2, m);
        let r = st.store()?.export_team(&t, &blobs, &project, thumb, &fmt, &p).map_err(e2s);
        progress(&app, "");
        r
    }).await
}

/// Exports a team's kits in the Sider kit-server layout into `dest` (p1/, g1/…, order.ini, gk_order.ini) without touching the game.
#[tauri::command]
async fn export_kitserver(app: AppHandle, request: Request<'_>) -> R<String> {
    let body = raw_body(&request)?.to_vec();
    blocking(move || {
        let (h, blobs) = unpack(&body)?;
        let t: TeamExport = serde_json::from_value(h["team"].clone()).map_err(e2s)?;
        let dest = std::path::PathBuf::from(h["dest"].as_str().ok_or("pasta em falta")?);
        let st = app.state::<AppState>();
        let fmt = st.settings.lock().unwrap()["defaultFormat"].as_str().unwrap_or("DXT5").to_string();
        let a2 = app.clone();
        let p = move |m: &str| progress(&a2, m);
        fs::create_dir_all(&dest).map_err(e2s)?;
        let r = st.store()?.write_kits(&t, &blobs, &fmt, &p, &dest).map_err(e2s);
        progress(&app, "");
        r?;
        Ok(dest.to_string_lossy().into_owned())
    }).await
}

#[tauri::command]
async fn restore_original(app: AppHandle, team_id: u32) -> R<ExportResult> {
    blocking(move || app.state::<AppState>().store()?.restore_original(team_id).map_err(e2s)).await
}
/// Why the game may not show this team's kits (club of an editable-kits pack), or None.
#[tauri::command]
fn licence_hint(st: State<AppState>, team_id: u32) -> Option<String> { st.store().ok()?.unlicensed_hint(team_id) }
#[tauri::command]
fn list_snapshots(st: State<AppState>, team_id: u32) -> R<Vec<SnapshotInfo>> { Ok(st.store()?.list_snapshots(team_id)) }
#[tauri::command]
fn save_snapshot(st: State<AppState>, team_id: u32, name: String, from_snapshot: Option<String>) -> R<SnapshotInfo> {
    let s = st.store()?;
    let src = from_snapshot.or_else(|| s.list_snapshots(team_id).into_iter().find(|x| x.active && x.fixed.is_none()).map(|x| x.id)).ok_or("Não há nenhuma versão ativa para guardar — exporta primeiro")?;
    s.duplicate_snapshot(team_id, &src, &name).map_err(e2s)
}
#[tauri::command]
fn rename_snapshot(st: State<AppState>, team_id: u32, id: String, name: String) -> R<()> { st.store()?.rename_snapshot(team_id, &id, &name).map_err(e2s) }
#[tauri::command]
fn delete_snapshot(st: State<AppState>, team_id: u32, id: String) -> R<()> { st.store()?.delete_snapshot(team_id, &id).map_err(e2s) }
#[tauri::command]
async fn activate_snapshot(app: AppHandle, team_id: u32, id: String) -> R<ExportResult> {
    blocking(move || {
        let s = app.state::<AppState>().store()?;
        if id == "original" { s.restore_original(team_id) } else { s.activate_snapshot(team_id, &id) }.map_err(e2s)
    }).await
}
#[tauri::command]
fn load_snapshot_project(st: State<AppState>, team_id: u32, id: String) -> R<Option<String>> { Ok(st.store()?.snapshot_project(team_id, &id)) }
#[tauri::command]
async fn export_snapshot_zip(app: AppHandle, team_id: u32, id: String) -> R<Option<String>> {
    blocking(move || {
        let z = app.state::<AppState>().store()?.snapshot_zip(team_id, &id).map_err(e2s)?;
        let Some(p) = save_dialog(&app, &format!("kit_{team_id}_{id}.zip")) else { return Ok(None) };
        fs::write(&p, z).map_err(e2s)?;
        Ok(Some(p.to_string_lossy().into_owned()))
    }).await
}
#[tauri::command]
async fn backup_original_zip(app: AppHandle, team_id: u32) -> R<Option<String>> {
    blocking(move || {
        let st = app.state::<AppState>();
        let name = st.teams.lock().unwrap().iter().find(|t| t.id == team_id).map(|t| t.name.clone()).unwrap_or_default();
        let z = st.store()?.original_zip(team_id).map_err(e2s)?;
        let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        let Some(p) = save_dialog(&app, &format!("original_{team_id}_{safe}.zip")) else { return Ok(None) };
        fs::write(&p, z).map_err(e2s)?;
        Ok(Some(p.to_string_lossy().into_owned()))
    }).await
}
#[tauri::command]
fn open_path(p: String) -> R<String> {
    std::process::Command::new("explorer").arg(&p).spawn().map_err(e2s)?;
    Ok(String::new())
}

// ---------------------------------------------------------------- drafts
fn draft_dir(st: &AppState) -> PathBuf { st.data_dir.join("drafts") }

#[tauri::command]
fn save_draft(st: State<AppState>, team_id: u32, project_json: String, thumbs: Value, exported: Option<bool>) -> R<()> {
    let d = draft_dir(&st);
    fs::create_dir_all(&d).map_err(e2s)?;
    let meta_path = d.join(format!("{team_id}.meta.json"));
    let prev: Value = fs::read(&meta_path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}));
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    fs::write(d.join(format!("{team_id}.json")), project_json).map_err(e2s)?;
    let meta = if exported.unwrap_or(false) {
        json!({ "teamId": team_id, "savedAt": prev.get("savedAt").cloned().unwrap_or(json!(now)), "exportedAt": now, "thumbs": prev.get("thumbs").cloned().unwrap_or(thumbs) })
    } else {
        json!({ "teamId": team_id, "savedAt": now, "thumbs": thumbs })
    };
    fs::write(meta_path, serde_json::to_vec(&meta).map_err(e2s)?).map_err(e2s)
}
#[tauri::command]
fn load_draft(st: State<AppState>, team_id: u32) -> Option<String> { read_text(&draft_dir(&st).join(format!("{team_id}.json"))) }
#[tauri::command]
fn delete_draft(st: State<AppState>, team_id: u32) -> R<()> {
    for f in [format!("{team_id}.json"), format!("{team_id}.meta.json")] { let _ = fs::remove_file(draft_dir(&st).join(f)); }
    Ok(())
}
// ---------------------------------------------------------------- user templates (KitCreatorData/templates/<id>.json)
fn template_dir(st: &State<AppState>) -> PathBuf { let d = st.data_dir.join("templates"); let _ = fs::create_dir_all(&d); d }
fn safe_id(id: &str) -> String { id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect() }
#[tauri::command]
fn save_user_template(st: State<AppState>, id: String, json: String) -> R<()> { fs::write(template_dir(&st).join(format!("{}.json", safe_id(&id))), json).map_err(e2s) }
#[tauri::command]
fn list_user_templates(st: State<AppState>) -> Vec<String> {
    let Ok(rd) = fs::read_dir(template_dir(&st)) else { return vec![] };
    rd.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".json")).filter_map(|e| read_text(&e.path())).collect()
}
/// Full kit textures (PNG / JPG in the layout of the kit) the user puts in KitCreatorData/templates: path, name,
/// sub-folder (category; '' at the top level).
/// Colour of the screen pixel under the mouse (eyedropper: works anywhere, the 3D view included). "#rrggbb".
#[tauri::command]
fn screen_pixel() -> R<String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut p = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut p) == 0 { return Err("sem posição do rato".into()); }
        let dc = GetDC(std::ptr::null_mut());
        let c = GetPixel(dc, p.x, p.y);
        ReleaseDC(std::ptr::null_mut(), dc);
        if c == 0xFFFF_FFFF { return Err("pixel fora do ecrã".into()); }
        return Ok(format!("#{:02x}{:02x}{:02x}", c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff));
    }
    #[allow(unreachable_code)]
    Err("só no Windows".into())
}

#[tauri::command]
fn list_template_images(st: State<AppState>) -> Vec<Value> {
    let base = template_dir(&st);
    let re = Regex::new(r"(?i)\.(png|jpe?g|webp)$").unwrap();
    let mut out = vec![];
    fn walk(dir: &Path, cat: &str, depth: u32, re: &Regex, out: &mut Vec<Value>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { if depth < 2 { let c = p.file_name().unwrap_or_default().to_string_lossy().into_owned(); walk(&p, &c, depth + 1, re, out) } }
            else if re.is_match(&p.to_string_lossy()) { out.push(json!({ "path": p.to_string_lossy(), "name": p.file_stem().unwrap_or_default().to_string_lossy(), "category": cat })) }
        }
    }
    walk(&base, "", 0, &re, &mut out);
    out
}
#[tauri::command]
fn template_dir_path(st: State<AppState>) -> String { template_dir(&st).to_string_lossy().into_owned() }
#[tauri::command]
fn delete_user_template(st: State<AppState>, id: String) -> R<()> { let _ = fs::remove_file(template_dir(&st).join(format!("{}.json", safe_id(&id)))); Ok(()) }

#[tauri::command]
fn list_drafts(st: State<AppState>) -> Vec<Value> {
    let Ok(rd) = fs::read_dir(draft_dir(&st)) else { return vec![] };
    rd.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".meta.json")).filter_map(|e| fs::read(e.path()).ok().and_then(|b| serde_json::from_slice(&b).ok())).collect()
}

// ---------------------------------------------------------------- launch game (Sider first)
fn is_running(exe: &str) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("tasklist").args(["/FI", &format!("IMAGENAME eq {exe}"), "/NH"]).creation_flags(0x0800_0000).output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(&exe.to_lowercase())).unwrap_or(false)
    }
    #[cfg(not(windows))]
    { let _ = exe; false }
}

#[tauri::command]
async fn launch_game(app: AppHandle) -> R<String> {
    blocking(move || {
        let st = app.state::<AppState>();
        let paths = match st.gi() {
            Ok(g) => g.read().unwrap().paths.clone(),
            Err(_) => {
                let root = st.settings.lock().unwrap()["gameRoot"].as_str().map(String::from).ok_or("Escolhe primeiro a pasta do jogo")?;
                game::index::detect_game(Path::new(&root))
            }
        };
        let exe = paths.exe.clone().ok_or("Executável do jogo não encontrado")?;
        let mut msg = String::new();
        if let Some(sd) = &paths.sider_dir {
            let sider = sd.join("sider.exe");
            if sider.exists() && !is_running("sider.exe") {
                std::process::Command::new(&sider).current_dir(sd).spawn().map_err(|e| format!("Sider: {e}"))?;
                std::thread::sleep(std::time::Duration::from_millis(2500));
                msg.push_str("Sider iniciado. ");
            }
        }
        std::process::Command::new(&exe).current_dir(exe.parent().unwrap()).spawn().map_err(|e| format!("Jogo: {e}"))?;
        msg.push_str("Jogo a arrancar…");
        Ok(msg)
    }).await
}

// ---------------------------------------------------------------- automated UI script (verification): KC_SCRIPT=steps.json
// steps: [{ "wait": ms, "js": "expression (may be async)", "shot": "file.png", "quit": true }]; results → steps.json.log
static SCRIPT_RESULT: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn script_result(r: String) { *SCRIPT_RESULT.lock().unwrap() = Some(r); }

fn screenshot_window(win: &tauri::WebviewWindow, file: &str) {
    let (Ok(pos), Ok(size)) = (win.inner_position(), win.inner_size()) else { return };
    let ps = format!(
        "Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap {w},{h}; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen({x},{y},0,0,$b.Size); $b.Save('{f}', [System.Drawing.Imaging.ImageFormat]::Png)",
        w = size.width, h = size.height, x = pos.x, y = pos.y, f = file.replace('\'', "''")
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &ps]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window over the app
    }
    let _ = cmd.status();
}

fn run_script(app: AppHandle, file: String) {
    std::thread::spawn(move || {
        let steps: Vec<Value> = fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let mut log = vec![];
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let Some(win) = app.get_webview_window("main") else { return };
        let _ = win.set_focus();
        for s in steps {
            if let Some(ms) = s["wait"].as_u64() { std::thread::sleep(std::time::Duration::from_millis(ms)); }
            if let Some(js) = s["js"].as_str() {
                *SCRIPT_RESULT.lock().unwrap() = None;
                let wrapped = format!(
                    "(async () => {{ let r; try {{ r = JSON.stringify(await ({js})) ?? 'undefined' }} catch (e) {{ r = 'ERR ' + (e && e.stack || e) }} window.__TAURI_INTERNALS__.invoke('script_result', {{ r: String(r) }}) }})()"
                );
                let _ = win.eval(&wrapped);
                let t0 = std::time::Instant::now();
                loop {
                    if let Some(r) = SCRIPT_RESULT.lock().unwrap().take() { log.push(r); break; }
                    if t0.elapsed().as_secs() > 120 { log.push("TIMEOUT".into()); break; }
                    std::thread::sleep(std::time::Duration::from_millis(30));
                }
            }
            if let Some(f) = s["shot"].as_str() { screenshot_window(&win, f); }
            if s["quit"].as_bool().unwrap_or(false) { break; }
        }
        let _ = fs::write(format!("{file}.log"), log.join("\n"));
        app.exit(0);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir = data_dir();
    let settings = load_settings(&dir);
    let _ = fs::write(dir.join("settings.json"), serde_json::to_vec_pretty(&settings).unwrap());
    let _ = b64; // used by store
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { data_dir: dir, settings: Mutex::new(settings), gi: Mutex::new(None), teams: Mutex::new(vec![]) })
        .invoke_handler(tauri::generate_handler![
            get_settings, get_version, save_settings, pick_folder, export_kitserver, pick_files, save_file, open_game, list_teams, read_kit_texture,
            read_emblem, read_model, list_collars, list_number_sets, read_file, list_fonts, decode_image_file, fetch_url, list_library, list_textures, export_team,
            restore_original, list_snapshots, save_snapshot, rename_snapshot, delete_snapshot, activate_snapshot, load_snapshot_project,
            export_snapshot_zip, backup_original_zip, open_path, save_draft, load_draft, delete_draft, list_drafts, launch_game, save_user_template, export_kitlab, read_kitlab, analyze_texture, list_user_templates, delete_user_template, list_template_images, template_dir_path, screen_pixel, licence_hint,
            script_result
        ])
        .setup(|app| {
            if let Ok(f) = std::env::var("KC_SCRIPT") { run_script(app.handle().clone(), f); }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PES Kit Creator");
}
