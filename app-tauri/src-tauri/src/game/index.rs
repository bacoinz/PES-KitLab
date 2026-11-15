//! Locates the game, Sider and its livecpk roots, and indexes the interesting files inside the CPKs (kit textures,
//! kit models, team database, emblems). Resolution order mirrors the game: Sider livecpk roots (sider.ini order) >
//! download/*.cpk > Data/*.cpk (higher dt number wins).
use super::cpk::Cpk;
use super::wesys::unwesys;
use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug, Default)]
pub struct GamePaths {
    pub root: PathBuf,
    pub exe: Option<PathBuf>,
    pub sider_dir: Option<PathBuf>,
    pub kits_root: Option<PathBuf>,
    pub livecpk_roots: Vec<PathBuf>,
}

static INTERESTING: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"^Asset/model/character/uniform/",
        r"^common/character0/model/character/uniform/team/(UniColor|UniformParameter)\.bin$",
        r"^common/etc/pesdb/[^/]+\.bin$",
        r"^common/render/symbol/(flag|emblemLc)/",
        r"character/common/(socks_\w+|arm\w*)\.fmdl$",
        r"^Asset/model/character/parts/(naked|torso)/.*\.fmdl$",
    ]
    .iter()
    .map(|r| Regex::new(r).unwrap())
    .collect()
});

pub fn detect_game(root: &Path) -> GamePaths {
    let root = root.to_path_buf();
    let exe = ["FL_2027.exe", "FL_2026.exe", "PES2021.exe"].iter().map(|e| root.join(e)).find(|p| p.exists());
    let sider_dir = [root.join("SiderAddons"), root.join("sider"), root.clone()].into_iter().find(|d| d.join("sider.ini").exists());
    let mut kits_root = None;
    if let Some(s) = &sider_dir {
        for k in ["content/kits", "content/kit-server"] {
            if kits_root.is_none() && s.join(k).join("map.txt").exists() {
                kits_root = Some(s.join(k));
            }
        }
        if kits_root.is_none() { kits_root = Some(s.join("content").join("kits")); }
    }
    GamePaths { root, exe, sider_dir, kits_root, livecpk_roots: vec![] }
}

pub fn read_sider_roots(sider_dir: &Path) -> Vec<PathBuf> {
    let re = Regex::new(r#"^cpk\.root\s*=\s*"?([^"]+)"?"#).unwrap();
    let Ok(txt) = fs::read(sider_dir.join("sider.ini")) else { return vec![] };
    let txt = String::from_utf8_lossy(&txt);
    let mut out = vec![];
    for raw in txt.lines() {
        let line = raw.split(';').next().unwrap_or("").trim();
        if let Some(c) = re.captures(line) {
            let rel = c[1].trim().replace('\\', "/");
            let p = sider_dir.join(rel.trim_start_matches("./"));
            if p.exists() { out.push(p); }
        }
    }
    out
}

#[derive(Serialize, Deserialize)]
struct IndexEntry { path: String, size: u64, mtime: u64, files: Vec<String> }
#[derive(Serialize, Deserialize)]
struct IndexFile { version: u32, cpks: Vec<IndexEntry> }
const VERSION: u32 = 3;

pub struct GameIndex {
    pub paths: GamePaths,
    cpk_files: HashMap<String, (PathBuf, String)>, // lower-case inner path → (cpk, real name)
    cpks: Mutex<HashMap<PathBuf, std::sync::Arc<Cpk>>>,
}

fn dt_order(p: &Path) -> i64 {
    let s = p.to_string_lossy().to_lowercase();
    let n = Regex::new(r"dt(\d+)").unwrap().captures(&p.file_name().unwrap_or_default().to_string_lossy().to_lowercase()).and_then(|c| c[1].parse::<i64>().ok()).unwrap_or(0);
    (if s.contains("download") { 1000 } else { 0 }) + n
}

impl GameIndex {
    pub fn build(root: &Path, cache_file: &Path, progress: &dyn Fn(&str)) -> Result<GameIndex> {
        let mut paths = detect_game(root);
        if let Some(s) = &paths.sider_dir { paths.livecpk_roots = read_sider_roots(s); }
        let cache: IndexFile = fs::read(cache_file).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(|c: &IndexFile| c.version == VERSION).unwrap_or(IndexFile { version: VERSION, cpks: vec![] });
        let mut list = vec![];
        for sub in ["Data", "download"] {
            let d = paths.root.join(sub);
            let Ok(rd) = fs::read_dir(&d) else { continue };
            let mut v: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("cpk")).unwrap_or(false)).collect();
            v.sort();
            list.extend(v);
        }
        let mut cpks = HashMap::new();
        let mut fresh = IndexFile { version: VERSION, cpks: vec![] };
        for p in list {
            let Ok(md) = fs::metadata(&p) else { continue };
            if md.len() < 10000 { continue; }
            let mtime = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
            let ps = p.to_string_lossy().to_string();
            if let Some(e) = cache.cpks.iter().find(|c| c.path == ps && c.size == md.len() && c.mtime == mtime) {
                fresh.cpks.push(IndexEntry { path: ps, size: md.len(), mtime, files: e.files.clone() });
                continue;
            }
            progress(&format!("A indexar {}", p.file_name().unwrap_or_default().to_string_lossy()));
            let files = match Cpk::open(&p) {
                Ok(c) => {
                    let f = c.files.keys().filter(|n| INTERESTING.iter().any(|r| r.is_match(n))).cloned().collect();
                    cpks.insert(p.clone(), std::sync::Arc::new(c));
                    f
                }
                Err(_) => vec![],
            };
            fresh.cpks.push(IndexEntry { path: ps, size: md.len(), mtime, files });
        }
        let mut order: Vec<&IndexEntry> = fresh.cpks.iter().collect();
        order.sort_by_key(|e| dt_order(Path::new(&e.path)));
        let mut cpk_files = HashMap::new();
        for c in order {
            for f in &c.files { cpk_files.insert(f.to_lowercase(), (PathBuf::from(&c.path), f.clone())); }
        }
        let _ = fs::write(cache_file, serde_json::to_vec(&fresh)?);
        Ok(GameIndex { paths, cpk_files, cpks: Mutex::new(cpks) })
    }

    /// Inner CPK paths matching a regex.
    pub fn list_cpk(&self, re: &Regex) -> Vec<String> {
        self.cpk_files.values().map(|v| v.1.clone()).filter(|k| re.is_match(k)).collect()
    }

    fn cpk(&self, p: &Path) -> Result<std::sync::Arc<Cpk>> {
        if let Some(c) = self.cpks.lock().unwrap().get(p) { return Ok(c.clone()); }
        let c = std::sync::Arc::new(Cpk::open(p)?);
        self.cpks.lock().unwrap().insert(p.to_path_buf(), c.clone());
        Ok(c)
    }

    /// Read a game file, honouring livecpk overrides. WESYS wrappers are removed.
    pub fn read(&self, inner: &str) -> Option<Vec<u8>> { self.read_opts(inner, &[]) }

    pub fn read_opts(&self, inner: &str, skip_roots: &[PathBuf]) -> Option<Vec<u8>> {
        for r in &self.paths.livecpk_roots {
            if skip_roots.contains(r) { continue; }
            let p = r.join(inner);
            if p.exists() { return fs::read(p).ok().map(unwesys); }
        }
        let (cpk, name) = self.cpk_files.get(&inner.to_lowercase())?;
        self.cpk(cpk).ok()?.read(name).ok().map(unwesys)
    }

    pub fn exists(&self, inner: &str) -> bool {
        self.paths.livecpk_roots.iter().any(|r| r.join(inner).exists()) || self.cpk_files.contains_key(&inner.to_lowercase())
    }
}
