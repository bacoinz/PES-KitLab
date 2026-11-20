//! `.kitlab`: one shareable kit. A ZIP with `kit.json` (the manifest + the kit design, read and checked by the UI)
//! and `assets/<id>.<png|jpg|webp|gif|bmp>`. Reading treats the file as untrusted: only those entry names, size
//! limits everywhere, every image must really be one of the allowed formats, and nothing in it is ever executed.
use crate::store::{b64, write_zip};
use serde_json::{json, Map, Value};
use std::io::{Cursor, Read};

const MAX_JSON: u64 = 8 << 20;
const MAX_ASSET: u64 = 30 << 20;
pub const MAX_TOTAL: u64 = 120 << 20;
const MAX_ENTRIES: usize = 300;
const MAX_DIM: u32 = 4096;
const EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIn { pub id: String, pub data_url: String }

pub fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 { bits -= 8; out.push((acc >> bits) as u8); acc &= (1 << bits) - 1; }
    }
    Some(out)
}

fn ext_of_mime(m: &str) -> Option<&'static str> {
    match m { "image/png" => Some("png"), "image/jpeg" | "image/jpg" => Some("jpg"), "image/webp" => Some("webp"), "image/gif" => Some("gif"), "image/bmp" => Some("bmp"), _ => None }
}
fn mime_of_format(f: image::ImageFormat) -> Option<&'static str> {
    match f { image::ImageFormat::Png => Some("image/png"), image::ImageFormat::Jpeg => Some("image/jpeg"), image::ImageFormat::WebP => Some("image/webp"), image::ImageFormat::Gif => Some("image/gif"), image::ImageFormat::Bmp => Some("image/bmp"), _ => None }
}
fn safe_stem(id: &str) -> bool { !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') }

/// The ZIP for `manifest` (JSON text with `format: "kitlab"`) and its images (`data:` URLs, one per asset id).
pub fn build(manifest: &str, assets: &[AssetIn]) -> Result<Vec<u8>, String> {
    let m: Value = serde_json::from_str(manifest).map_err(|e| format!("kit.json inválido: {e}"))?;
    if m["format"] != "kitlab" { return Err("Manifesto sem format \"kitlab\"".into()); }
    let mut files: Vec<(String, Vec<u8>)> = vec![("kit.json".into(), manifest.as_bytes().to_vec())];
    let mut seen = std::collections::HashSet::new();
    for a in assets {
        if !safe_stem(&a.id) || !seen.insert(a.id.clone()) { return Err(format!("Identificador de imagem inválido: {}", a.id)); }
        let (head, body) = a.data_url.split_once(',').ok_or("Imagem sem dados")?;
        let mime = head.strip_prefix("data:").and_then(|h| h.strip_suffix(";base64")).ok_or("Imagem não está em base64")?;
        let ext = ext_of_mime(mime).ok_or_else(|| format!("Tipo de imagem não suportado: {mime}"))?;
        let bytes = b64_decode(body).ok_or("Imagem corrompida")?;
        files.push((format!("assets/{}.{}", a.id, ext), bytes));
    }
    write_zip(&files).map_err(|e| e.to_string())
}

/// Reads and checks a `.kitlab`: `{ kit: <kit.json>, assets: { <id>: { name, dataUrl, w, h } } }`.
pub fn read(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() as u64 > MAX_TOTAL { return Err("Ficheiro demasiado grande".into()); }
    let mut z = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Não é um ficheiro .kitlab válido (não abre como ZIP).".to_string())?;
    if z.len() > MAX_ENTRIES { return Err("Ficheiro com entradas a mais".into()); }
    let mut kit: Option<Value> = None;
    let mut assets = Map::new();
    let mut total = 0u64;
    for i in 0..z.len() {
        let f = z.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() { continue; }
        let name = f.name().to_string();
        let mut buf = Vec::new();
        if name == "kit.json" {
            f.take(MAX_JSON + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
            if buf.len() as u64 > MAX_JSON { return Err("kit.json demasiado grande".into()); }
            kit = Some(serde_json::from_slice(&buf).map_err(|e| format!("kit.json inválido: {e}"))?);
            continue;
        }
        let file = name.strip_prefix("assets/").filter(|r| !r.contains('/') && !r.contains('\\') && !r.contains(':') && !r.contains(".."));
        let Some((stem, ext)) = file.and_then(|r| r.rsplit_once('.')) else { return Err(format!("Entrada inesperada no ficheiro: {name}")) };
        if !safe_stem(stem) || !EXTS.contains(&ext.to_ascii_lowercase().as_str()) { return Err(format!("Entrada inesperada no ficheiro: {name}")); }
        f.take(MAX_ASSET + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        if buf.len() as u64 > MAX_ASSET { return Err(format!("Imagem demasiado grande: {name}")); }
        total += buf.len() as u64;
        if total > MAX_TOTAL { return Err("Imagens a mais no ficheiro".into()); }
        let rd = image::ImageReader::new(Cursor::new(&buf)).with_guessed_format().map_err(|e| e.to_string())?;
        let mime = rd.format().and_then(mime_of_format).ok_or_else(|| format!("{name} não é uma imagem PNG / JPG / WebP"))?;
        let (w, h) = rd.into_dimensions().map_err(|_| format!("{name} não é uma imagem válida"))?;
        if w == 0 || h == 0 || w > MAX_DIM || h > MAX_DIM { return Err(format!("Imagem com tamanho inválido: {name} ({w}×{h})")); }
        if assets.contains_key(stem) { return Err(format!("Imagem repetida: {stem}")); }
        assets.insert(stem.to_string(), json!({ "name": file.unwrap_or(""), "dataUrl": format!("data:{mime};base64,{}", b64(&buf)), "w": w, "h": h }));
    }
    let kit = kit.ok_or("Falta o kit.json")?;
    Ok(json!({ "kit": kit, "assets": assets }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> String {
        let mut out = Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(3, 2, image::Rgba([200, 10, 10, 255])).write_to(&mut out, image::ImageFormat::Png).unwrap();
        format!("data:image/png;base64,{}", b64(&out.into_inner()))
    }
    const MAN: &str = r#"{"format":"kitlab","formatVersion":1,"kit":{"slot":"p1"}}"#;

    #[test]
    fn round_trip() {
        let z = build(MAN, &[AssetIn { id: "crest".into(), data_url: png() }]).unwrap();
        let r = read(&z).unwrap();
        assert_eq!(r["kit"]["formatVersion"], 1);
        assert_eq!(r["assets"]["crest"]["w"], 3);
        assert_eq!(r["assets"]["crest"]["h"], 2);
        assert!(r["assets"]["crest"]["dataUrl"].as_str().unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn rejects_bad_names() {
        let img = b64_decode(png().split_once(',').unwrap().1).unwrap();
        for bad in ["assets/../x.png", "../x.png", "assets/sub/x.png", "evil.exe", "assets/x.exe", "assets/C:x.png"] {
            let z = write_zip(&[("kit.json".into(), MAN.as_bytes().to_vec()), (bad.into(), img.clone())]).unwrap();
            assert!(read(&z).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn rejects_non_image_and_missing_json() {
        let z = write_zip(&[("kit.json".into(), MAN.as_bytes().to_vec()), ("assets/a.png".into(), b"MZ not an image".to_vec())]).unwrap();
        assert!(read(&z).is_err());
        let z = write_zip(&[("assets/a.png".into(), b64_decode(png().split_once(',').unwrap().1).unwrap())]).unwrap();
        assert!(read(&z).is_err());
        assert!(read(b"not a zip").is_err());
    }

    #[test]
    fn rejects_bad_json_and_manifest() {
        let z = write_zip(&[("kit.json".into(), b"{ nope".to_vec())]).unwrap();
        assert!(read(&z).is_err());
        assert!(build("{\"format\":\"other\"}", &[]).is_err());
        assert!(build(MAN, &[AssetIn { id: "../x".into(), data_url: png() }]).is_err());
        assert!(build(MAN, &[AssetIn { id: "a".into(), data_url: "data:text/html;base64,AAAA".into() }]).is_err());
    }
}
