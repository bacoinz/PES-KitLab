//! Integration tests against the real game install (skipped when it isn't present). The export test works in a
//! scratch copy of the Sider folders and never touches the real install.
use kitcreator_lib::game::index::GameIndex;
use kitcreator_lib::game::kitserver::{effective_map, parse_map, read_text, KitConfig};
use kitcreator_lib::game::teams::load_teams;
use kitcreator_lib::game::tex::{decode_ftex, encode_ftex, ftex_info, TexFormat};
use kitcreator_lib::store::{Store, TeamExport};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Instant;

const GAME: &str = "D:/Games/SP Football Life 2027";
fn out() -> PathBuf {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join("testout");
    fs::create_dir_all(&p).unwrap();
    p
}
fn has_game() -> bool { Path::new(GAME).join("Data").join("dt34_g4.cpk").exists() }

#[test]
fn teams_and_kits_from_game() {
    if !has_game() { return; }
    let t0 = Instant::now();
    let gi = GameIndex::build(Path::new(GAME), &out().join("index.json"), &|m| println!("{m}")).unwrap();
    println!("index {:?}", t0.elapsed());
    let teams = load_teams(&gi).unwrap();
    println!("teams {} in {:?}", teams.len(), t0.elapsed());
    assert!(teams.len() > 500);
    let tondela = teams.iter().find(|t| t.id == 71589);
    println!("71589 = {:?}", tondela.map(|t| (&t.name, &t.league, &t.country, t.slots.len())));
    let benfica = teams.iter().find(|t| t.id == 191).expect("team 191");
    assert!(!benfica.slots.is_empty());
    let b = gi.read("Asset/model/character/uniform/texture/#windx11/u0191p1.ftex").or_else(|| {
        benfica.slots[0].file.as_ref().and_then(|f| fs::read(f).ok())
    }).expect("kit file");
    let img = decode_ftex(&b, 0).unwrap();
    assert!(img.width >= 1024);
    let t1 = Instant::now();
    let enc = encode_ftex(&img.data, img.width, img.height, TexFormat::Bc7);
    println!("BC7 encode {}x{} in {:?}, {} bytes, mips {}", img.width, img.height, t1.elapsed(), enc.len(), ftex_info(&enc).unwrap().mips);
    let back = decode_ftex(&enc, 0).unwrap();
    let mae: f64 = back.data.iter().zip(&img.data).map(|(a, b)| (*a as i32 - *b as i32).abs() as f64).sum::<f64>() / back.data.len() as f64;
    println!("BC7 MAE {mae:.2}");
    assert!(mae < 4.0);
}

fn copy(src: &str, dst: &Path) {
    fs::create_dir_all(dst.parent().unwrap()).unwrap();
    fs::copy(Path::new(GAME).join(src), dst).unwrap();
}

#[test]
fn export_snapshot_restore() {
    if !has_game() { return; }
    let scr = out().join("fakegame");
    let _ = fs::remove_dir_all(&scr);
    let sider = scr.join("SiderAddons");
    copy("SiderAddons/sider.ini", &sider.join("sider.ini"));
    copy("SiderAddons/content/kits/map.txt", &sider.join("content/kits/map.txt"));
    let mut gi = GameIndex::build(Path::new(GAME), &out().join("index.json"), &|_| {}).unwrap();
    gi.paths.sider_dir = Some(sider.clone());
    gi.paths.kits_root = Some(sider.join("content/kits"));
    let store = Store { data_dir: scr.join("data"), gi: Arc::new(RwLock::new(gi)) };

    let w = 2048u32;
    let kit: Vec<u8> = (0..w * w).flat_map(|_| [200u8, 30, 40, 255]).collect();
    let emb = vec![255u8; 512 * 512 * 4];
    let t: TeamExport = serde_json::from_value(serde_json::json!({
        "teamId": 191, "teamName": "SL Benfica", "league": "Liga Portugal",
        "kits": [
            { "slot": "p1", "kit": { "width": w, "height": w, "blob": 0 }, "config": { "Collar": 12, "ShirtColor1": "#c81e28" } },
            { "slot": "g1", "kit": { "width": w, "height": w, "blob": 0 }, "config": {} }
        ],
        "emblem": { "width": 512, "height": 512, "blob": 1 }
    })).unwrap();
    let t0 = Instant::now();
    let r = store.export_team(&t, &[&kit, &emb], "{\"test\":1}", None, "DXT5", &|m| println!("{m}")).unwrap();
    println!("export 2 kits in {:?}", t0.elapsed());
    assert!(r.ok);
    let dest = sider.join("content/kits/KitCreator/Liga Portugal/SL Benfica");
    let cfg = KitConfig::parse(&read_text(&dest.join("p1/config.txt")).unwrap());
    assert_eq!(cfg.get("Collar"), Some("12"));
    assert_eq!(cfg.get("KitFile"), Some("u0191p1"));
    assert_eq!(cfg.get("BackNumbersFile"), Some("u0191p1_back"));
    let img = decode_ftex(&fs::read(dest.join("p1/u0191p1.ftex")).unwrap(), 0).unwrap();
    assert!(img.data[0] > 190);
    let map = effective_map(parse_map(&read_text(&sider.join("content/kits/map.txt")).unwrap()));
    assert_eq!(map[&191].folder, "KitCreator\\Liga Portugal\\SL Benfica");
    assert!(map[&191].ours);
    assert!(read_text(&sider.join("sider.ini")).unwrap().contains("livecpk\\KitCreator"));
    assert!(sider.join("livecpk/KitCreator/common/render/symbol/flag/e_000191_r_ll.png").exists());

    let snaps = store.list_snapshots(191);
    assert_eq!(snaps.len(), 2);
    assert!(snaps[1].active);
    let dup = store.duplicate_snapshot(191, &snaps[1].id, "Retro").unwrap();
    assert_eq!(dup.name, "Retro");

    store.restore_original(191).unwrap();
    assert!(!dest.exists());
    let orig = read_text(&Path::new(GAME).join("SiderAddons/content/kits/map.txt")).unwrap();
    let now = read_text(&sider.join("content/kits/map.txt")).unwrap();
    assert!(effective_map(parse_map(&now)).get(&191).map(|e| !e.ours).unwrap_or(true));
    assert_eq!(now.replace("\r\n", "\n").trim_end(), orig.replace("\r\n", "\n").trim_end());
    assert!(!sider.join("livecpk/KitCreator/common/render/symbol/flag/e_000191_r.png").exists());

    store.activate_snapshot(191, &dup.id).unwrap();
    assert!(dest.join("g1/u0191g1.ftex").exists());
    let zip = store.original_zip(71609).unwrap();
    println!("original zip bytes {}", zip.len());
    assert!(zip.len() > 1000);
}
