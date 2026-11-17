//! Export, snapshots and restore.
//!
//! KitCreator never edits files written by the game or other mods. It only:
//!  - writes its own team folders under <kitsRoot>\KitCreator\<League>\<Team>\
//!  - keeps its own section at the end of map.txt (last entry wins in kits.lua)
//!  - writes emblems into its own livecpk root (<sider>\livecpk\KitCreator), listed first in sider.ini
//! so "restore original" = remove KitCreator's files/entries for that team.
//! Every export becomes a snapshot in KitCreatorData\teams\<id>\snapshots\<snapId>\ (files + project + thumbnail).
use crate::game::index::GameIndex;
use crate::game::kitserver::{default_kit_config, parse_map, read_team_folder, read_text, write_our_section, KitConfig};
use crate::game::tex::{encode_ftex, TexFormat};
use crate::game::teams::{kit_tex_name, KIT_TEX_DIR};
use anyhow::{anyhow, Context, Result};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const OUR_ROOT_NAME: &str = "KitCreator";
const EMBLEM_VARIANTS: [(&str, u32); 9] = [("", 128), ("_l", 256), ("_ll", 512), ("_b", 128), ("_b_l", 256), ("_b_ll", 512), ("_w", 128), ("_w_l", 256), ("_w_ll", 512)];

pub fn safe_name(s: &str) -> String {
    let r: String = s.chars().map(|c| if "<>:\"/\\|?*#".contains(c) || (c as u32) < 0x20 { '_' } else { c }).collect();
    let r = r.trim_end().trim_end_matches('.').to_string();
    if r.is_empty() { "_".into() } else { r }
}

#[derive(Deserialize, Clone, Copy)]
pub struct ImgRef { pub width: u32, pub height: u32, pub blob: usize }

#[derive(Deserialize)]
pub struct KitExport {
    pub slot: String,
    pub kit: ImgRef,
    pub back: Option<ImgRef>,
    pub leg: Option<ImgRef>,
    pub name: Option<ImgRef>,
    pub chest: Option<ImgRef>,
    pub config: BTreeMap<String, serde_json::Value>,
    pub format: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamExport { pub team_id: u32, pub team_name: String, pub league: String, pub kits: Vec<KitExport>, pub emblem: Option<ImgRef> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    pub team_id: u32,
    pub name: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    pub active: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct TeamState { active: Option<String>, folder: Option<String> }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapMeta { id: String, team_id: u32, team_name: String, league: String, name: String, created_at: String }

fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)?.flatten() {
        let (s, d) = (e.path(), dst.join(e.file_name()));
        if s.is_dir() { copy_dir(&s, &d)?; } else { fs::copy(&s, &d)?; }
    }
    Ok(())
}

fn list_files_rec(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { out.extend(list_files_rec(&p)); } else { out.push(p); }
        }
    }
    out
}

pub fn write_zip(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in files {
            z.start_file(name.replace('\\', "/"), opt)?;
            z.write_all(data)?;
        }
        z.finish()?;
    }
    Ok(buf.into_inner())
}

pub fn encode_png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_raw(w, h, rgba.to_vec()).ok_or_else(|| anyhow!("bad image size"))?.write_to(&mut out, image::ImageFormat::Png)?;
    Ok(out.into_inner())
}

fn resize(rgba: &[u8], w: u32, h: u32, nw: u32, nh: u32) -> Vec<u8> {
    let img = image::RgbaImage::from_raw(w, h, rgba.to_vec()).unwrap();
    image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Lanczos3).into_raw()
}

fn now_id() -> String {
    let t = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S-%3fZ").to_string();
    format!("{t}_{:06x}", rand::random::<u32>() & 0xffffff)
}

pub struct Store {
    pub data_dir: PathBuf,
    pub gi: std::sync::Arc<RwLock<GameIndex>>,
}

impl Store {
    fn team_dir(&self, id: u32) -> PathBuf { self.data_dir.join("teams").join(id.to_string()) }
    fn snap_dir(&self, id: u32, snap: &str) -> PathBuf { self.team_dir(id).join("snapshots").join(snap) }
    fn state(&self, id: u32) -> TeamState {
        fs::read(self.team_dir(id).join("state.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    fn set_state(&self, id: u32, s: &TeamState) -> Result<()> {
        fs::create_dir_all(self.team_dir(id))?;
        fs::write(self.team_dir(id).join("state.json"), serde_json::to_vec_pretty(s)?)?;
        Ok(())
    }
    fn kits_root(&self) -> Result<PathBuf> {
        self.gi.read().unwrap().paths.kits_root.clone().ok_or_else(|| anyhow!("Sider kit-server não encontrado (pasta content\\kits)"))
    }
    fn sider_dir(&self) -> Option<PathBuf> { self.gi.read().unwrap().paths.sider_dir.clone() }
    /// A club made by an FL26 Mod Studio pack built with "Kits you can edit in the game" (editable_kits) borrows no
    /// kit of the game: the Sider Kit Server then treats it as unlicensed and switches its kit-server kits off
    /// ("team is unlicensed. Disabling kits."). Our files are right, but the game won't show them: say so.
    pub fn unlicensed_hint(&self, team_id: u32) -> Option<String> {
        use std::io::{Read, Seek, SeekFrom};
        let live = self.sider_dir()?.join("livecpk");
        let id = team_id.to_string();
        for e in fs::read_dir(&live).ok()?.flatten() {
            let d = e.path();
            let Ok(world) = fs::read_to_string(d.join("fl26world.txt")) else { continue };
            if !world.split_whitespace().any(|w| w == id) { continue }
            let Ok(mut f) = fs::File::open(d.join("leaguebuilder-plan.json")) else { continue };
            let len = f.metadata().ok()?.len();
            let _ = f.seek(SeekFrom::Start(len.saturating_sub(8 << 20)));
            let mut tail = String::new();
            let mut buf = vec![];
            if f.read_to_end(&mut buf).is_err() { continue }
            tail.push_str(&String::from_utf8_lossy(&buf));
            if regex::Regex::new(r#""editable_kits"\s*:\s*true"#).ok()?.is_match(&tail) {
                return Some(format!("Atenção: esta equipa vem do pack {} feito com \"Kits you can edit in the game\"; o Sider desliga os kits do kit-server dessas equipas (sem kit licenciado). Volta a gerar o pack no FL26 Mod Studio sem essa opção para os kits aparecerem.", e.file_name().to_string_lossy()));
            }
        }
        None
    }
    fn our_livecpk(&self) -> Result<PathBuf> {
        Ok(self.sider_dir().ok_or_else(|| anyhow!("Sider não encontrado"))?.join("livecpk").join(OUR_ROOT_NAME))
    }

    // ------------------------------------------------------------ original sources
    fn original_kit_folder(&self, team_id: u32) -> Option<PathBuf> {
        let kr = self.kits_root().ok()?;
        let txt = read_text(&kr.join("map.txt"))?;
        let last = parse_map(&txt).into_iter().filter(|e| !e.ours && e.id == team_id).last()?;
        Some(kr.join(last.folder))
    }

    fn original_part(&self, team_id: u32, slot: &str, part: &str) -> Option<Vec<u8>> {
        let order = [slot.to_string(), if slot.starts_with('g') { "g1".into() } else { "p1".into() }];
        if let Some(folder) = self.original_kit_folder(team_id) {
            let tf = read_team_folder(&folder);
            for s in &order {
                let Some(sl) = tf.iter().find(|x| &x.slot == s) else { continue };
                let f = match part { "back" => &sl.back_file, "leg" => &sl.leg_file, "name" => &sl.name_file, _ => &sl.chest_file };
                if let Some(f) = f { if let Ok(b) = fs::read(f) { return Some(b); } }
            }
        }
        let gi = self.gi.read().unwrap();
        order.iter().find_map(|s| gi.read(&format!("{KIT_TEX_DIR}{}_{part}.ftex", kit_tex_name(team_id, s))))
    }

    fn original_config(&self, team_id: u32, slot: &str) -> Option<KitConfig> {
        let folder = self.original_kit_folder(team_id)?;
        read_text(&folder.join(slot).join("config.txt")).map(|t| KitConfig::parse(&t))
    }

    // ------------------------------------------------------------ export
    /// Writes the kit-server layout (p1/, p2/, g1/… each with its textures + config.txt, plus order.ini / gk_order.ini).
    pub fn write_kits(&self, t: &TeamExport, blobs: &[&[u8]], default_format: &str, progress: &(dyn Fn(&str) + Sync), kits_dir: &Path) -> Result<()> {
        // every texture of every kit is encoded in parallel
        struct Job<'a> { path: PathBuf, img: ImgRef, fmt: TexFormat, label: &'a str }
        let mut jobs: Vec<Job> = vec![];
        for k in &t.kits {
            let file = kit_tex_name(t.team_id, &k.slot);
            let kd = kits_dir.join(&k.slot);
            fs::create_dir_all(&kd)?;
            let fmt = match k.format.as_deref().unwrap_or(default_format) { "BC7" => TexFormat::Bc7, _ => TexFormat::Dxt5 };
            jobs.push(Job { path: kd.join(format!("{file}.ftex")), img: k.kit, fmt, label: &k.slot });
            for (part, img) in [("back", k.back), ("leg", k.leg), ("name", k.name), ("chest", k.chest)] {
                if let Some(img) = img { jobs.push(Job { path: kd.join(format!("{file}_{part}.ftex")), img, fmt: TexFormat::Bc7, label: &k.slot }); }
            }
        }
        progress(&format!("A codificar {} texturas…", jobs.len()));
        jobs.par_iter().try_for_each(|j| -> Result<()> {
            let data = blobs.get(j.img.blob).ok_or_else(|| anyhow!("textura em falta ({})", j.label))?;
            fs::write(&j.path, encode_ftex(data, j.img.width, j.img.height, j.fmt))?;
            Ok(())
        })?;
        for k in &t.kits {
            let file = kit_tex_name(t.team_id, &k.slot);
            let kd = kits_dir.join(&k.slot);
            let mut present = BTreeMap::new();
            for (part, img) in [("back", k.back), ("leg", k.leg), ("name", k.name)] {
                if img.is_some() { present.insert(part, true); continue; }
                if let Some(b) = self.original_part(t.team_id, &k.slot, part) {
                    fs::write(kd.join(format!("{file}_{part}.ftex")), b)?;
                    present.insert(part, true);
                }
            }
            let mut cfg = self.original_config(t.team_id, &k.slot).unwrap_or_else(|| default_kit_config(&file, k.slot.starts_with('g')));
            cfg.set("KitFile", &file);
            for (key, part) in [("BackNumbersFile", "back"), ("LegNumbersFile", "leg"), ("NameFontFile", "name")] {
                cfg.set(key, &if present.contains_key(part) { format!("{file}_{part}") } else { String::new() });
            }
            if k.chest.is_some() { cfg.set("ChestNumbersFile", &format!("{file}_chest")); } else if cfg.get("ChestNumbersFile").map(|v| !v.is_empty()).unwrap_or(false) { cfg.set("ChestNumbersFile", ""); }
            for (key, v) in &k.config {
                let s = match v { serde_json::Value::String(s) => s.clone(), other => other.to_string() };
                cfg.set(key, &s);
            }
            fs::write(kd.join("config.txt"), cfg.to_text())?;
        }
        let mut players: Vec<&str> = t.kits.iter().filter(|k| k.slot.starts_with('p')).map(|k| k.slot.as_str()).collect();
        let mut gks: Vec<&str> = t.kits.iter().filter(|k| k.slot.starts_with('g')).map(|k| k.slot.as_str()).collect();
        players.sort();
        gks.sort();
        fs::write(kits_dir.join("order.ini"), players.join("\r\n") + "\r\n")?;
        if !gks.is_empty() { fs::write(kits_dir.join("gk_order.ini"), gks.join("\r\n") + "\r\n")?; }
        Ok(())
    }

    pub fn export_team(&self, t: &TeamExport, blobs: &[&[u8]], project_json: &str, thumb_png: Option<&[u8]>, default_format: &str, progress: &(dyn Fn(&str) + Sync)) -> Result<ExportResult> {
        let snap_id = now_id();
        let dir = self.snap_dir(t.team_id, &snap_id);
        fs::create_dir_all(&dir)?;
        let r = (|| -> Result<()> {
            self.write_kits(t, blobs, default_format, progress, &dir.join("kits"))?;
            if let Some(e) = t.emblem {
                let data = blobs.get(e.blob).ok_or_else(|| anyhow!("emblema em falta"))?;
                let ed = dir.join("emblem");
                fs::create_dir_all(&ed)?;
                fs::write(ed.join("emblem.png"), encode_png(data, e.width, e.height)?)?;
                for size in [128u32, 256, 512] {
                    fs::write(ed.join(format!("emblem_{size}.png")), encode_png(&resize(data, e.width, e.height, size, size), size, size)?)?;
                }
            }
            fs::write(dir.join("project.json"), project_json)?;
            if let Some(th) = thumb_png { fs::write(dir.join("thumb.png"), th)?; }
            let meta = SnapMeta {
                id: snap_id.clone(), team_id: t.team_id, team_name: t.team_name.clone(), league: t.league.clone(),
                name: format!("Versão {}", chrono::Local::now().format("%d/%m/%Y, %H:%M:%S")),
                created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            };
            fs::write(dir.join("meta.json"), serde_json::to_vec_pretty(&meta)?)?;
            Ok(())
        })();
        if let Err(e) = r {
            let _ = fs::remove_dir_all(&dir);
            return Err(e);
        }
        let mut r = self.activate_snapshot(t.team_id, &snap_id)?;
        r.snapshot_id = Some(snap_id);
        if let Some(h) = self.unlicensed_hint(t.team_id) { r.message = format!("{} · {}", r.message, h); }
        Ok(r)
    }

    // ------------------------------------------------------------ activation / restore
    pub fn activate_snapshot(&self, team_id: u32, snap_id: &str) -> Result<ExportResult> {
        let dir = self.snap_dir(team_id, snap_id);
        let meta: SnapMeta = serde_json::from_slice(&fs::read(dir.join("meta.json")).context("versão não encontrada")?)?;
        let league = if meta.league.is_empty() { "Equipas".to_string() } else { meta.league.clone() };
        let team = if meta.team_name.is_empty() { team_id.to_string() } else { meta.team_name.clone() };
        let rel = format!("{OUR_ROOT_NAME}\\{}\\{}", safe_name(&league), safe_name(&team));
        let dest = self.kits_root()?.join(&rel);
        self.remove_our_files(team_id)?;
        if dir.join("kits").exists() {
            copy_dir(&dir.join("kits"), &dest)?;
            self.set_map_entry(team_id, Some(&rel))?;
        }
        if dir.join("emblem").join("emblem.png").exists() { self.write_emblem(team_id, &dir.join("emblem"))?; }
        self.set_state(team_id, &TeamState { active: Some(snap_id.into()), folder: Some(rel) })?;
        Ok(ExportResult { ok: true, message: format!("Kits de {} ativos no jogo", meta.team_name), folder: Some(dest.to_string_lossy().into()), snapshot_id: None })
    }

    pub fn restore_original(&self, team_id: u32) -> Result<ExportResult> {
        self.remove_our_files(team_id)?;
        self.set_state(team_id, &TeamState::default())?;
        Ok(ExportResult { ok: true, message: "Equipa reposta com os kits originais".into(), folder: None, snapshot_id: None })
    }

    fn remove_our_files(&self, team_id: u32) -> Result<()> {
        let st = self.state(team_id);
        let kr = self.kits_root()?;
        if let Some(f) = st.folder {
            let p = kr.join(&f);
            if p.starts_with(kr.join(OUR_ROOT_NAME)) && p.exists() { fs::remove_dir_all(&p)?; }
        }
        self.set_map_entry(team_id, None)?;
        if let Ok(lc) = self.our_livecpk() {
            for (suf, _) in EMBLEM_VARIANTS {
                let p = lc.join(format!("common/render/symbol/flag/e_{team_id:06}_r{suf}.png"));
                if p.exists() { fs::remove_file(p)?; }
            }
        }
        Ok(())
    }

    fn set_map_entry(&self, team_id: u32, folder: Option<&str>) -> Result<()> {
        let mp = self.kits_root()?.join("map.txt");
        let text = read_text(&mp).unwrap_or_else(|| "# teams map\r\n".into());
        self.backup_once(&mp, "map.txt")?;
        let mut ours = BTreeMap::new();
        for e in parse_map(&text) { if e.ours { ours.insert(e.id, e.folder); } }
        match folder { Some(f) => { ours.insert(team_id, f.to_string()); } None => { ours.remove(&team_id); } }
        let new = write_our_section(&text, &ours);
        if new != text { fs::write(&mp, new)?; }
        Ok(())
    }

    /// Keep one pristine copy of a user file before KitCreator first touches it.
    fn backup_once(&self, path: &Path, label: &str) -> Result<()> {
        let b = self.data_dir.join("backups").join(format!("{label}.original"));
        if b.exists() || !path.exists() { return Ok(()); }
        fs::create_dir_all(b.parent().unwrap())?;
        fs::copy(path, b)?;
        Ok(())
    }

    fn ensure_livecpk_root(&self) -> Result<()> {
        let sider = self.sider_dir().ok_or_else(|| anyhow!("Sider não encontrado"))?;
        let ini = sider.join("sider.ini");
        let txt = read_text(&ini).unwrap_or_default();
        let lc = self.our_livecpk()?;
        fs::create_dir_all(&lc)?;
        if !txt.contains(&format!("livecpk\\{OUR_ROOT_NAME}\"")) {
            self.backup_once(&ini, "sider.ini")?;
            let line = format!("cpk.root = \".\\livecpk\\{OUR_ROOT_NAME}\"");
            let mut lines: Vec<String> = txt.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect();
            let re = regex::Regex::new(r"^\s*cpk\.root\s*=").unwrap();
            match lines.iter().position(|l| re.is_match(l)) { Some(i) => lines.insert(i, line), None => lines.push(line) }
            fs::write(&ini, lines.join("\r\n"))?;
        }
        let mut gi = self.gi.write().unwrap();
        if !gi.paths.livecpk_roots.contains(&lc) { gi.paths.livecpk_roots.insert(0, lc); }
        Ok(())
    }

    fn write_emblem(&self, team_id: u32, emblem_dir: &Path) -> Result<()> {
        self.ensure_livecpk_root()?;
        let flag = self.our_livecpk()?.join("common/render/symbol/flag");
        fs::create_dir_all(&flag)?;
        for (suf, size) in EMBLEM_VARIANTS {
            let src = emblem_dir.join(format!("emblem_{size}.png"));
            let from = if src.exists() { src } else { emblem_dir.join("emblem.png") };
            fs::copy(from, flag.join(format!("e_{team_id:06}_r{suf}.png")))?;
        }
        Ok(())
    }

    // ------------------------------------------------------------ snapshots
    pub fn list_snapshots(&self, team_id: u32) -> Vec<SnapshotInfo> {
        let st = self.state(team_id);
        let mut out = vec![SnapshotInfo { id: "original".into(), team_id, name: "Original (jogo)".into(), created_at: String::new(), fixed: Some(true), thumb: None, active: st.active.is_none() }];
        let base = self.team_dir(team_id).join("snapshots");
        let Ok(rd) = fs::read_dir(&base) else { return out };
        let mut ids: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        ids.sort();
        ids.reverse();
        for id in ids {
            let Some(meta) = fs::read(base.join(&id).join("meta.json")).ok().and_then(|b| serde_json::from_slice::<SnapMeta>(&b).ok()) else { continue };
            let thumb = fs::read(base.join(&id).join("thumb.png")).ok().map(|b| format!("data:image/png;base64,{}", b64(&b)));
            out.push(SnapshotInfo { active: st.active.as_deref() == Some(&id), id, team_id, name: meta.name, created_at: meta.created_at, fixed: None, thumb });
        }
        out
    }

    pub fn rename_snapshot(&self, team_id: u32, id: &str, name: &str) -> Result<()> {
        let p = self.snap_dir(team_id, id).join("meta.json");
        let mut meta: SnapMeta = serde_json::from_slice(&fs::read(&p)?)?;
        meta.name = name.into();
        fs::write(p, serde_json::to_vec_pretty(&meta)?)?;
        Ok(())
    }

    pub fn duplicate_snapshot(&self, team_id: u32, id: &str, name: &str) -> Result<SnapshotInfo> {
        let nid = now_id();
        copy_dir(&self.snap_dir(team_id, id), &self.snap_dir(team_id, &nid))?;
        let p = self.snap_dir(team_id, &nid).join("meta.json");
        let mut meta: SnapMeta = serde_json::from_slice(&fs::read(&p)?)?;
        meta.id = nid.clone();
        meta.name = name.into();
        fs::write(p, serde_json::to_vec_pretty(&meta)?)?;
        self.list_snapshots(team_id).into_iter().find(|s| s.id == nid).ok_or_else(|| anyhow!("falhou a cópia"))
    }

    pub fn delete_snapshot(&self, team_id: u32, id: &str) -> Result<()> {
        if self.state(team_id).active.as_deref() == Some(id) { self.restore_original(team_id)?; }
        let d = self.snap_dir(team_id, id);
        if d.exists() { fs::remove_dir_all(d)?; }
        Ok(())
    }

    pub fn snapshot_project(&self, team_id: u32, id: &str) -> Option<String> {
        read_text(&self.snap_dir(team_id, id).join("project.json"))
    }

    pub fn snapshot_zip(&self, team_id: u32, id: &str) -> Result<Vec<u8>> {
        let dir = self.snap_dir(team_id, id);
        let files: Vec<(String, Vec<u8>)> = list_files_rec(&dir).into_iter().filter_map(|f| Some((f.strip_prefix(&dir).ok()?.to_string_lossy().into_owned(), fs::read(&f).ok()?))).collect();
        write_zip(&files)
    }

    /// Zip with the team's original files as the game currently uses them (kit-server folder or CPK textures).
    pub fn original_zip(&self, team_id: u32) -> Result<Vec<u8>> {
        let mut files = vec![];
        let skip: Vec<PathBuf> = self.our_livecpk().ok().into_iter().collect();
        match self.original_kit_folder(team_id).filter(|f| f.exists()) {
            Some(folder) => {
                for f in list_files_rec(&folder) {
                    if let (Ok(rel), Ok(b)) = (f.strip_prefix(&folder), fs::read(&f)) { files.push((format!("kit-server/{}", rel.to_string_lossy()), b)); }
                }
            }
            None => {
                let gi = self.gi.read().unwrap();
                for s in ["p1", "p2", "p3", "p4", "g1", "g2"] {
                    for suf in ["", "_back", "_leg", "_name", "_chest"] {
                        let inner = format!("{KIT_TEX_DIR}{}{suf}.ftex", kit_tex_name(team_id, s));
                        if let Some(b) = gi.read_opts(&inner, &skip) { files.push((inner, b)); }
                    }
                }
            }
        }
        let emb = format!("common/render/symbol/flag/e_{team_id:06}_r.png");
        if let Some(b) = self.gi.read().unwrap().read_opts(&emb, &skip) { files.push((emb, b)); }
        write_zip(&files)
    }
}

pub fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}
