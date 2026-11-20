//! Installed fonts: family names read from the `name` table of every font file in the Windows font folders
//! (system and per-user). Results are cached per file (path, size, mtime) so asking again is cheap and a newly
//! installed font shows up on the next call.
use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

type Key = (u64, SystemTime);
static CACHE: Mutex<Option<HashMap<PathBuf, (Key, Vec<String>)>>> = Mutex::new(None);

fn be16(b: &[u8], p: usize) -> usize { b.get(p..p + 2).map(|s| u16::from_be_bytes([s[0], s[1]]) as usize).unwrap_or(0) }
fn be32(b: &[u8], p: usize) -> usize { b.get(p..p + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]) as usize).unwrap_or(0) }

fn read_at(f: &mut File, off: u64, len: usize) -> Option<Vec<u8>> {
    f.seek(SeekFrom::Start(off)).ok()?;
    let mut v = vec![0u8; len];
    let mut n = 0;
    while n < len { let k = f.read(&mut v[n..]).ok()?; if k == 0 { break } n += k; }
    v.truncate(n);
    Some(v)
}

/// Family names (name ids 1 and 16) of one font inside the file (`base` = its offset table).
fn font_families(f: &mut File, base: u64, out: &mut BTreeSet<String>) -> Option<()> {
    let head = read_at(f, base, 12)?;
    let n = be16(&head, 4);
    if n == 0 || n > 200 { return None; }
    let dir = read_at(f, base + 12, n * 16)?;
    let (mut off, mut len) = (0usize, 0usize);
    for i in 0..n {
        if dir.get(i * 16..i * 16 + 4)? == b"name" { off = be32(&dir, i * 16 + 8); len = be32(&dir, i * 16 + 12); }
    }
    if off == 0 || len < 6 { return None; }
    let t = read_at(f, off as u64, len.min(1 << 20))?;
    let count = be16(&t, 2);
    let str_off = be16(&t, 4);
    for id in [1usize, 16] {
        let mut best: Option<(u8, String)> = None;
        for r in 0..count {
            let p = 6 + r * 12;
            if t.len() < p + 12 || be16(&t, p + 6) != id { continue; }
            let (plat, lang, l, o) = (be16(&t, p), be16(&t, p + 4), be16(&t, p + 8), be16(&t, p + 10));
            let Some(raw) = t.get(str_off + o..str_off + o + l) else { continue };
            let (rank, s) = match plat {
                3 | 0 => (if lang == 0x409 { 0 } else { 2 }, String::from_utf16_lossy(&raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect::<Vec<_>>())),
                1 => (1, raw.iter().map(|&c| c as char).collect()),
                _ => continue,
            };
            if best.as_ref().map(|b| rank < b.0).unwrap_or(true) { best = Some((rank, s)); }
        }
        if let Some((_, s)) = best {
            let s = s.trim().to_string();
            if !s.is_empty() && !s.starts_with('@') { out.insert(s); }
        }
    }
    Some(())
}

fn file_families(path: &PathBuf) -> Vec<String> {
    let Ok(mut f) = File::open(path) else { return vec![] };
    let Some(h) = read_at(&mut f, 0, 12) else { return vec![] };
    let mut set = BTreeSet::new();
    if &h[..4] == b"ttcf" {
        let n = be32(&h, 8).min(64);
        if let Some(offs) = read_at(&mut f, 12, n * 4) { for i in 0..n { let _ = font_families(&mut f, be32(&offs, i * 4) as u64, &mut set); } }
    } else {
        let _ = font_families(&mut f, 0, &mut set);
    }
    set.into_iter().collect()
}

pub fn list_fonts() -> Vec<String> {
    let mut dirs = vec![];
    dirs.push(PathBuf::from(std::env::var("WINDIR").or_else(|_| std::env::var("SystemRoot")).unwrap_or_else(|_| "C:\\Windows".into())).join("Fonts"));
    if let Ok(l) = std::env::var("LOCALAPPDATA") { dirs.push(PathBuf::from(l).join("Microsoft").join("Windows").join("Fonts")); }
    let mut guard = CACHE.lock().unwrap();
    let cache = guard.get_or_insert_with(HashMap::new);
    let mut seen = std::collections::HashSet::new();
    let mut all = BTreeSet::new();
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") { continue; }
            let Ok(m) = e.metadata() else { continue };
            let key: Key = (m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH));
            let fams = match cache.get(&p) {
                Some((k, v)) if *k == key => v.clone(),
                _ => { let v = file_families(&p); cache.insert(p.clone(), (key, v.clone())); v }
            };
            seen.insert(p);
            all.extend(fams);
        }
    }
    cache.retain(|p, _| seen.contains(p)); // uninstalled fonts leave the list
    let mut v: Vec<String> = all.into_iter().collect();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists_system_fonts() {
        let f = super::list_fonts();
        println!("{} fonts", f.len());
        assert!(f.iter().any(|x| x == "Arial Black" || x == "Arial"), "{f:?}");
    }
}
