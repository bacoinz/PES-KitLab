//! Team list: Team.bin (+ livecpk override) joined with the Sider kit-server map and the game's own kit files.
use super::index::GameIndex;
use super::kitserver::{effective_map, parse_map, read_team_folder, read_text};
use anyhow::{anyhow, Result};
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KitSlotInfo {
    pub slot: String,
    pub source: String, // "kitserver" | "game"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<BTreeMap<String, String>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TeamInfo {
    pub id: u32,
    pub name: String,
    pub abbr: String,
    pub league: String,
    pub country: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kit_folder: Option<String>,
    pub managed_by_us: bool,
    pub slots: Vec<KitSlotInfo>,
    pub has_emblem: bool,
}

const REC: usize = 1532;
const NAME_OFF: usize = 368;
const ABBR_OFF: usize = 882;

fn cstr(b: &[u8]) -> String {
    let z = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..z]).into_owned()
}

pub fn parse_team_bin(d: &[u8]) -> Vec<(u32, String, String)> {
    let mut out = vec![];
    let mut o = 0;
    while o + REC <= d.len() {
        let id = u32::from_le_bytes(d[o + 8..o + 12].try_into().unwrap());
        let name = cstr(&d[o + NAME_OFF..o + NAME_OFF + 70]);
        let abbr = cstr(&d[o + ABBR_OFF..o + ABBR_OFF + 4]);
        if !name.is_empty() { out.push((id, name, abbr)); }
        o += REC;
    }
    out
}

pub fn kit_tex_name(id: u32, slot: &str) -> String { format!("u{id:04}{slot}") }
pub const KIT_TEX_DIR: &str = "Asset/model/character/uniform/texture/#windx11/";
pub fn emblem_path(id: u32, suffix: &str) -> String { format!("common/render/symbol/flag/e_{id:06}_r{suffix}.png") }

fn country_key(k: &str) -> Option<&'static str> {
    Some(match k {
        "ENGLAND" => "Inglaterra", "ITALY" => "Itália", "SPAIN" => "Espanha", "FRANCE" => "França", "NETHERLANDS" => "Países Baixos",
        "PORTUGAL" => "Portugal", "BRAZIL" => "Brasil", "ARGENTINA" => "Argentina", "CHILE" => "Chile", "GERMANY" => "Alemanha",
        "US" => "EUA", "JAPAN" => "Japão", "BELGIUM" => "Bélgica", "RUSSIA" => "Rússia", "GREECE" => "Grécia", "TURKEY" => "Turquia",
        "COLOMBIA" => "Colômbia", "CHINA" => "China", "DENMARK" => "Dinamarca", "SCOTLAND" => "Escócia", "KSA" => "Arábia Saudita",
        _ => return None,
    })
}

/// "MÉXICO" / "COREIA DO SUL" → "México" / "Coreia do Sul"
fn title_case(s: &str) -> String {
    s.to_lowercase()
        .split(' ')
        .enumerate()
        .map(|(i, w)| {
            if i > 0 && matches!(w, "de" | "do" | "da" | "dos" | "das" | "e") { return w.to_string(); }
            let mut c = w.chars();
            match c.next() { Some(f) => f.to_uppercase().collect::<String>() + c.as_str(), None => String::new() }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Country.bin: 1420-byte rows, country id = (u64 @0 >> 10) & 0x1ff, Portuguese name @568 (70 bytes).
pub fn parse_countries(d: &[u8]) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    let mut o = 0;
    while o + 1420 <= d.len() {
        let id = ((u64::from_le_bytes(d[o..o + 8].try_into().unwrap()) >> 10) & 0x1ff) as u32;
        let name = cstr(&d[o + 568..o + 638]);
        if !name.is_empty() { out.insert(id, title_case(&name)); }
        o += 1420;
    }
    out
}

#[derive(Clone, Debug)]
struct LeagueInfo { league: String, country: Option<String>, tier: Option<u32> }

fn standard_league(name: &str) -> Option<LeagueInfo> {
    let m = Regex::new(r"^([A-Z]+)_D(\d)_LEAGUE$").unwrap().captures(name)?;
    let country = country_key(&m[1]).map(String::from).unwrap_or_else(|| title_case(&m[1]));
    Some(LeagueInfo { league: format!("{country} — {}ª divisão", &m[2]), country: Some(country), tier: m[2].parse().ok() })
}

/// In-game league names written by FL26 Mod Studio: fl26world.txt in a livecpk root.
fn world_leagues(gi: &GameIndex, countries: &HashMap<u32, String>) -> HashMap<u32, LeagueInfo> {
    let mut out = HashMap::new();
    let num = |line: &str, k: &str| Regex::new(&format!(r"\b{k}=(\d+)")).unwrap().captures(line).and_then(|c| c[1].parse::<u32>().ok());
    let name_re = Regex::new(r"\bname=(.+?)\s*$").unwrap();
    for r in &gi.paths.livecpk_roots {
        let Some(txt) = read_text(&r.join("fl26world.txt")) else { continue };
        for line in txt.lines() {
            if !line.starts_with("league ") { continue; }
            let Some(name) = name_re.captures(line).map(|c| c[1].to_string()) else { continue };
            let Some(cid) = num(line, "cid").filter(|&c| c > 0) else { continue };
            if out.contains_key(&cid) { continue; }
            let country = num(line, "country").and_then(|c| countries.get(&c).cloned());
            out.insert(cid, LeagueInfo { league: name, country, tier: num(line, "tier").filter(|&t| t > 0) });
        }
    }
    out
}

fn leagues_from_competitions(gi: &GameIndex, countries: &HashMap<u32, String>) -> (HashMap<u32, LeagueInfo>, HashMap<String, LeagueInfo>) {
    let mut by_team: HashMap<u32, LeagueInfo> = HashMap::new();
    let mut by_name: HashMap<String, LeagueInfo> = HashMap::new();
    let world = world_leagues(gi, countries);
    for w in world.values() { by_name.insert(w.league.clone(), w.clone()); }
    let (Some(comp), Some(ent)) = (gi.read("common/etc/pesdb/Competition.bin"), gi.read("common/etc/pesdb/CompetitionEntry.bin")) else { return (by_team, by_name) };
    let mut names: HashMap<u8, String> = HashMap::new();
    let mut o = 0;
    while o + 36 <= comp.len() {
        let raw = &comp[o + 8..o + 36];
        let z = raw.iter().position(|&c| c == 0).unwrap_or(28);
        names.insert(comp[o + 5], raw[..z].iter().map(|&c| c as char).collect());
        o += 36;
    }
    let national_re = Regex::new(r"^(FIFA_WORLD_CUP|EURO$|COPA_AMERICA|AFC_ASIA_CUP|AFRICA_NATIONS_CUP)").unwrap();
    let mut national = HashSet::new();
    let mut world_teams = HashSet::new();
    let mut o = 0;
    while o + 12 <= ent.len() {
        let team = u32::from_le_bytes(ent[o..o + 4].try_into().unwrap());
        let cid = ent[o + 8];
        o += 12;
        let Some(n) = names.get(&cid) else { continue };
        if national_re.is_match(n) { national.insert(team); }
        let in_game = world.get(&(cid as u32)).cloned();
        let is_world = in_game.is_some();
        let Some(info) = in_game.or_else(|| standard_league(n)) else { continue };
        if !is_world { by_name.insert(info.league.clone(), info.clone()); }
        let replace = match by_team.get(&team) {
            None => true,
            Some(prev) => (is_world && !world_teams.contains(&team)) || (!is_world && !world_teams.contains(&team) && info.tier.unwrap_or(9) < prev.tier.unwrap_or(9)),
        };
        if replace { by_team.insert(team, info); }
        if is_world { world_teams.insert(team); }
    }
    for t in national {
        by_team.entry(t).or_insert(LeagueInfo { league: "Seleções".into(), country: Some("Seleções".into()), tier: None });
    }
    (by_team, by_name)
}

pub fn load_teams(gi: &GameIndex) -> Result<Vec<TeamInfo>> {
    let tb = gi.read("common/etc/pesdb/Team.bin").ok_or_else(|| anyhow!("Team.bin não encontrado no jogo"))?;
    let teams = parse_team_bin(&tb);
    let kits_root = gi.paths.kits_root.clone();
    let map = kits_root.as_ref().and_then(|k| read_text(&k.join("map.txt"))).map(|t| effective_map(parse_map(&t))).unwrap_or_default();
    let countries = gi.read("common/etc/pesdb/Country.bin").map(|b| parse_countries(&b)).unwrap_or_default();
    let (by_team, by_name) = leagues_from_competitions(gi, &countries);
    let kit_re = Regex::new(r"(?i)uniform/texture/#windx11/u\d+[pg]\d\.ftex$").unwrap();
    let cpk_kits: HashSet<String> = gi.list_cpk(&kit_re).iter().map(|p| p[KIT_TEX_DIR.len()..p.len() - 5].to_lowercase()).collect();
    let mut out = vec![];
    for (id, name, abbr) in teams {
        let m = map.get(&id);
        let parts: Vec<&str> = m.map(|m| m.folder.split(['\\', '/']).filter(|s| !s.is_empty()).collect()).unwrap_or_default();
        let folder_league = if parts.len() >= 3 { parts[parts.len() - 2].to_string() } else if parts.len() == 2 { parts[0].to_string() } else { String::new() };
        let mut slots = vec![];
        if let (Some(m), Some(k)) = (m, &kits_root) {
            for s in read_team_folder(&k.join(&m.folder)) {
                slots.push(KitSlotInfo { slot: s.slot, source: "kitserver".into(), file: s.kit_file.map(|p| p.to_string_lossy().into_owned()), config: Some(s.config) });
            }
        }
        if slots.is_empty() {
            for s in ["p1", "p2", "p3", "p4", "g1", "g2"] {
                let n = kit_tex_name(id, s);
                if cpk_kits.contains(&n) { slots.push(KitSlotInfo { slot: s.into(), source: "game".into(), file: Some(format!("{KIT_TEX_DIR}{n}.ftex")), config: None }); }
            }
        }
        let from_comp = by_team.get(&id);
        let league = if !folder_league.is_empty() { folder_league } else { from_comp.map(|c| c.league.clone()).unwrap_or_else(|| "Outras equipas".into()) };
        let info = by_name.get(&league).or(if Some(&league) == from_comp.map(|c| &c.league) { from_comp } else { None });
        out.push(TeamInfo {
            id, name, abbr,
            country: info.and_then(|i| i.country.clone()).or_else(|| from_comp.and_then(|c| c.country.clone())).unwrap_or_else(|| "Outros".into()),
            tier: info.and_then(|i| i.tier),
            league,
            kit_folder: m.map(|m| m.folder.clone()),
            managed_by_us: m.map(|m| m.ours).unwrap_or(false),
            slots,
            has_emblem: gi.exists(&emblem_path(id, "")),
        });
    }
    Ok(out)
}
