//! Sider kit-server (kits.lua) files: map.txt, order.ini / gk_order.ini, per-kit config.txt.
//! kits.lua reads map.txt top to bottom and the LAST entry for a team id wins, so KitCreator appends its own section
//! at the end and never edits lines written by other tools.
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn read_text(p: &Path) -> Option<String> {
    fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

// ---------------------------------------------------------------- config.txt
#[derive(Clone, Debug)]
pub struct ConfigLine { pub key: Option<String>, pub value: Option<String>, pub comment: Option<String>, pub raw: String }

#[derive(Clone, Debug, Default)]
pub struct KitConfig { pub lines: Vec<ConfigLine> }

static LINE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*([A-Za-z0-9_]+)\s*=\s*([^;]*?)\s*(;.*)?$").unwrap());

fn format_line(key: &str, value: &str, comment: Option<&str>) -> String {
    let kv = format!("{key}={value}");
    match comment { Some(c) => format!("{kv:<50}{c}"), None => kv }
}

impl KitConfig {
    pub fn parse(text: &str) -> KitConfig {
        let mut c = KitConfig::default();
        for raw in text.replace('\r', "").split('\n') {
            if let Some(m) = LINE_RE.captures(raw) {
                c.lines.push(ConfigLine { key: Some(m[1].to_string()), value: Some(m[2].to_string()), comment: m.get(3).map(|x| x.as_str().to_string()), raw: raw.to_string() });
            } else {
                c.lines.push(ConfigLine { key: None, value: None, comment: None, raw: raw.to_string() });
            }
        }
        while c.lines.last().map(|l| l.raw.is_empty()).unwrap_or(false) { c.lines.pop(); }
        c
    }
    pub fn get(&self, key: &str) -> Option<&str> {
        self.lines.iter().find(|l| l.key.as_deref() == Some(key)).and_then(|l| l.value.as_deref())
    }
    pub fn set(&mut self, key: &str, value: &str) {
        if let Some(l) = self.lines.iter_mut().find(|l| l.key.as_deref() == Some(key)) {
            l.value = Some(value.to_string());
            l.raw = format_line(key, value, l.comment.as_deref());
        } else {
            self.lines.push(ConfigLine { key: Some(key.into()), value: Some(value.into()), comment: None, raw: format_line(key, value, None) });
        }
    }
    pub fn to_map(&self) -> BTreeMap<String, String> {
        self.lines.iter().filter_map(|l| Some((l.key.clone()?, l.value.clone().unwrap_or_default()))).collect()
    }
    pub fn to_text(&self) -> String {
        self.lines.iter().map(|l| l.raw.as_str()).collect::<Vec<_>>().join("\r\n") + "\r\n"
    }
}

/// Default config for a newly created kit (values taken from a working kit-server kit).
pub fn default_kit_config(file: &str, is_gk: bool) -> KitConfig {
    let chest = if is_gk { 0 } else { 14 };
    KitConfig::parse(&format!(
        "; shirt parameters
ShortSleevesModel=1                               ; 1=Normal (players), 2=Kappa (players), 3=Referee kits only
ShirtModel=144                                    ; 144, 151=Semi-long short sleeves, 160, 176=Legacy
Collar=66                                         ; 1 to 130
TightKit=1                                        ; 0=Off, 1=On
ShirtPattern=1                                    ; 0 to 6
WinterCollar=66                                   ; 1 to 130
LongSleevesType=62                                ; 62=Normal & Undershirt, 187=Only Undershirt

; shirt - back side
Name=0                                            ; 0=On, 1=Off
NameShape=1                                       ; 0=Straight, 1=Light curve, 2=Medium curve, 3=Extreme curve
NameY=29                                          ; 0 to 39
NameSize=6                                        ; 0 to 20
NameStretch=2                                     ; 0 to 3
BackNumberY=8                                     ; 0 to 29
BackNumberSize=24                                 ; 0 to 28
BackNumberSpacing=10                              ; 0 to 14
BackNumberType=0                                  ; 0=Normal, 1=Forced two-digit

; shirt - front side
ChestNumberX=15                                   ; 0 to 29
ChestNumberY=15                                   ; 0 to 29
ChestNumberSize={chest}                                ; 0 to 28

; shorts parameters
ShortsModel=1                                     ; 1 to 16
ShortsNumberSide=0                                ; 0=Left, 1=Right
ShortsNumberX=16                                  ; 0 to 14
ShortsNumberY=7                                   ; 0 to 15
ShortsNumberSize=14                               ; 0 to 28

; texture files
KitFile={file}
BackNumbersFile={file}_back
ChestNumbersFile=
LegNumbersFile={file}_leg
NameFontFile={file}_name

; kit colors
ShirtColor1=#ffffff
ShirtColor2=#000000
UndershirtColor=#ffffff
ShortsColor=#ffffff
SocksColor=#ffffff

; sleeve badge positions
RightShortX=14                                    ; 0 to 31
RightShortY=12                                    ; 0 to 31
RightLongX=14                                     ; 0 to 31
RightLongY=12                                     ; 0 to 31
LeftShortX=0                                      ; 0 to 31
LeftShortY=31                                     ; 0 to 31
LeftLongX=0                                       ; 0 to 31
LeftLongY=31                                      ; 0 to 31

; kit colors from UniColor.bin
UniColor_Color1=#ffffff
UniColor_Color2=#000000
"
    ))
}

// ---------------------------------------------------------------- map.txt
#[derive(Clone, Debug)]
pub struct MapEntry { pub id: u32, pub folder: String, pub ours: bool }

pub const KC_BEGIN: &str = "# ---- KitCreator (do not edit by hand) ----";
pub const KC_END: &str = "# ---- end KitCreator ----";
static MAP_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"^\s*(\d+)\s*,\s*"?([^"]*)"#).unwrap());

pub fn parse_map(text: &str) -> Vec<MapEntry> {
    let mut out = vec![];
    let mut ours = false;
    for raw in text.replace('\r', "").split('\n') {
        if raw.starts_with(KC_BEGIN) { ours = true; } else if raw.starts_with(KC_END) { ours = false; }
        let line = raw.split('#').next().unwrap_or("");
        if let Some(m) = MAP_RE.captures(line) {
            if let Ok(id) = m[1].parse() { out.push(MapEntry { id, folder: m[2].trim().to_string(), ours }); }
        }
    }
    out
}

/// Effective map (last entry wins, like kits.lua).
pub fn effective_map(entries: Vec<MapEntry>) -> std::collections::HashMap<u32, MapEntry> {
    entries.into_iter().map(|e| (e.id, e)).collect()
}

/// Replace KitCreator's own section with the given entries (others untouched).
pub fn write_our_section(text: &str, ours: &BTreeMap<u32, String>) -> String {
    let mut kept: Vec<String> = vec![];
    let mut skip = false;
    for l in text.replace('\r', "").split('\n') {
        if l.starts_with(KC_BEGIN) { skip = true; continue; }
        if l.starts_with(KC_END) { skip = false; continue; }
        if !skip { kept.push(l.to_string()); }
    }
    while kept.last().map(|s| s.is_empty()).unwrap_or(false) { kept.pop(); }
    if !ours.is_empty() {
        kept.push(String::new());
        kept.push(KC_BEGIN.into());
        for (id, folder) in ours { kept.push(format!("{id}, \"{folder}\"")); }
        kept.push(KC_END.into());
    }
    kept.join("\r\n") + "\r\n"
}

// ---------------------------------------------------------------- team folder
#[derive(Clone, Debug)]
pub struct KitSlotFiles {
    pub slot: String,
    pub dir: PathBuf,
    pub config: BTreeMap<String, String>,
    pub kit_file: Option<PathBuf>,
    pub back_file: Option<PathBuf>,
    pub leg_file: Option<PathBuf>,
    pub name_file: Option<PathBuf>,
    pub chest_file: Option<PathBuf>,
}

fn read_list(p: &Path) -> Vec<String> {
    read_text(p).map(|t| t.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && !s.starts_with('#') && !s.starts_with(';')).collect()).unwrap_or_default()
}

pub fn read_team_folder(team_dir: &Path) -> Vec<KitSlotFiles> {
    let mut names: Vec<String> = vec![];
    for n in read_list(&team_dir.join("order.ini")).into_iter().chain(read_list(&team_dir.join("gk_order.ini"))) {
        if !names.contains(&n) { names.push(n); }
    }
    if names.is_empty() {
        let re = Regex::new(r"^[pgPG]\d+$").unwrap();
        if let Ok(rd) = fs::read_dir(team_dir) {
            let mut v: Vec<String> = rd.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| re.is_match(n)).collect();
            v.sort_by_key(|n| (n.to_lowercase().starts_with('g'), n[1..].parse::<u32>().unwrap_or(0)));
            names = v;
        }
    }
    let mut slots = vec![];
    for slot in names {
        let dir = team_dir.join(&slot);
        let Some(txt) = read_text(&dir.join("config.txt")) else { continue };
        let cfg = KitConfig::parse(&txt);
        let f = |k: &str| cfg.get(k).filter(|v| !v.is_empty()).map(|v| dir.join(format!("{v}.ftex")));
        slots.push(KitSlotFiles {
            kit_file: f("KitFile"), back_file: f("BackNumbersFile"), leg_file: f("LegNumbersFile"), name_file: f("NameFontFile"), chest_file: f("ChestNumbersFile"),
            config: cfg.to_map(), slot, dir: dir.clone(),
        });
    }
    slots
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn map_section_roundtrip() {
        let base = "# map\r\n100, \"A\\B\"\r\n200, \"X\"\r\n";
        let mut ours = BTreeMap::new();
        ours.insert(100u32, "KitCreator\\L\\T".to_string());
        let t = write_our_section(base, &ours);
        let m = effective_map(parse_map(&t));
        assert_eq!(m[&100].folder, "KitCreator\\L\\T");
        assert!(m[&100].ours);
        assert_eq!(m[&200].folder, "X");
        let back = write_our_section(&t, &BTreeMap::new());
        assert_eq!(back, base);
    }
    #[test]
    fn config_set_keeps_comment() {
        let mut c = default_kit_config("u0001p1", false);
        c.set("Collar", "12");
        assert_eq!(c.get("Collar"), Some("12"));
        assert!(c.to_text().contains("Collar=12"));
        assert!(c.to_text().contains("; 1 to 130"));
    }
}
