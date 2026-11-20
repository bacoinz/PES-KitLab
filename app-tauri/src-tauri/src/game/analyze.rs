//! Texture analyser, phase A: takes a kit texture and splits it into flat colour masks, one per colour and kit part
//! (shirt, sleeves, shorts, socks), plus a "detail" cut-out per part for what is not a flat colour (crests, sponsors,
//! gradients, painted shadows). Nothing is vectorised here.
//!
//! Steps: an edge-preserving median filter (takes the fabric grain and the DXT noise out), a colour palette from the
//! sharp (non-blurred) pixels, every pixel snapped to its nearest palette colour, a majority filter on the labels, then
//! masks, and the pixels that are far from any palette colour become the detail layer.
use crate::store::{b64, encode_png};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Opts {
    /// how many colours to look for (None = automatic, up to 12)
    pub colors: Option<usize>,
    /// 0 … 100: how easily two similar colours stay apart, and how easily a pixel counts as detail (default 50)
    pub sensitivity: Option<f32>,
    /// smallest mask worth a layer, in px at 2048 (default 250)
    pub min_area: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalColor { pub hex: String, /** share of the used texture */ pub share: f32 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskOut { pub color: usize, pub area: usize, pub png: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartOut {
    pub part: &'static str,
    /// palette index of the colour that covers most of the part (it becomes the base colour, no layer)
    pub dominant: Option<usize>,
    pub masks: Vec<MaskOut>,
    pub detail: Option<String>,
    pub detail_area: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub width: usize,
    pub palette: Vec<PalColor>,
    pub parts: Vec<PartOut>,
    /// flat colours + detail, and the difference to the original (×4), both small
    pub recomposed: String,
    pub diff: String,
    pub mean_diff: f32,
}

const PARTS: [&str; 4] = ["torso", "sleeves", "shorts", "socks"];

/// Kit part of a texel (coordinates in the 2048 layout); same rules as `partAt` in compositor/uv.ts (collar = torso).
fn part_at(x: i32, y: i32) -> usize {
    if (1866..2034).contains(&y) && (664..1384).contains(&x) { return 0; }
    if (1160..1964).contains(&y) && (x < 672 || x >= 1376) { return 2; }
    if (630..1160).contains(&y) && (x < 400 || x >= 1648) { return 3; }
    if ((684..1218).contains(&y) && ((420..760).contains(&x) || (1288..1628).contains(&x))) || ((128..656).contains(&y) && (x < 700 || x >= 1348)) { return 1; }
    0
}

#[inline]
fn dist(a: [f32; 3], b: [f32; 3]) -> f32 {
    let (r, g, bl) = (a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    (0.3 * r * r + 0.59 * g * g + 0.11 * bl * bl).sqrt()
}

fn median3(src: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h * 3];
    out.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            for c in 0..3 {
                let mut v = [0u8; 9];
                let mut k = 0;
                for dy in -1i32..=1 {
                    let yy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                    for dx in -1i32..=1 {
                        let xx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                        v[k] = src[(yy * w + xx) * 4 + c];
                        k += 1;
                    }
                }
                v.sort_unstable();
                row[x * 3 + c] = v[4];
            }
        }
    });
    out
}

fn nearest(px: [f32; 3], pal: &[[f32; 3]]) -> (usize, f32) {
    let mut best = (0, f32::MAX);
    for (i, p) in pal.iter().enumerate() {
        let d = dist(px, *p);
        if d < best.1 { best = (i, d); }
    }
    best
}

fn erode(m: &[bool], w: usize, h: usize) -> Vec<bool> {
    let mut out = vec![false; w * h];
    out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        if y == 0 || y + 1 >= h { return; }
        for x in 1..w - 1 {
            row[x] = (-1i32..=1).all(|dy| (-1i32..=1).all(|dx| m[((y as i32 + dy) as usize) * w + (x as i32 + dx) as usize]));
        }
    });
    out
}
fn dilate(m: &[bool], w: usize, h: usize) -> Vec<bool> {
    let mut out = vec![false; w * h];
    out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            row[x] = (-1i32..=1).any(|dy| (-1i32..=1).any(|dx| {
                let (yy, xx) = (y as i32 + dy, x as i32 + dx);
                yy >= 0 && xx >= 0 && (yy as usize) < h && (xx as usize) < w && m[yy as usize * w + xx as usize]
            }));
        }
    });
    out
}

fn data_url(png: &[u8]) -> String { format!("data:image/png;base64,{}", b64(png)) }

/// Splits the RGBA texture (square, ≥ 256 px). See the module notes.
pub fn analyze(rgba: &[u8], w: usize, h: usize, o: &Opts) -> Result<Analysis, String> {
    if w != h || !(256..=4096).contains(&w) || rgba.len() < w * h * 4 { return Err("A textura tem de ser quadrada (como as dos kits, 2048×2048).".into()); }
    let n = w * h;
    let sens = o.sensitivity.unwrap_or(50.0).clamp(0.0, 100.0);
    let k = w as f32 / 2048.0;
    let min_area = ((o.min_area.unwrap_or(250) as f32) * k * k).max(16.0) as usize;
    let used: Vec<bool> = (0..n).into_par_iter().map(|i| rgba[i * 4 + 3] >= 128).collect();
    let part_of: Vec<u8> = (0..n).into_par_iter().map(|i| part_at(((i % w) as f32 / k) as i32, ((i / w) as f32 / k) as i32) as u8).collect();
    let flt = median3(rgba, w, h);
    let px = |i: usize| -> [f32; 3] { [flt[i * 3] as f32, flt[i * 3 + 1] as f32, flt[i * 3 + 2] as f32] };

    // sharp pixels: no neighbour differs much (AA edges and gradients are left out of the palette)
    let sharp: Vec<bool> = (0..n).into_par_iter().map(|i| {
        if !used[i] { return false; }
        let (x, y) = (i % w, i / w);
        let nb = [if x > 0 { i - 1 } else { i }, if x + 1 < w { i + 1 } else { i }, if y > 0 { i - w } else { i }, if y + 1 < h { i + w } else { i }];
        nb.iter().all(|&j| (0..3).all(|c| (flt[i * 3 + c] as i32 - flt[j * 3 + c] as i32).abs() <= 12))
    }).collect();
    let total_sharp = sharp.iter().filter(|&&s| s).count();
    if total_sharp == 0 { return Err("Não encontrei zonas de cor lisa nesta textura.".into()); }

    // palette: the most common colours (5 bits per channel), kept apart by a minimum distance
    let mut cnt = vec![0u32; 32768];
    let mut sum = vec![[0u64; 3]; 32768];
    for i in 0..n {
        if !sharp[i] { continue; }
        let (r, g, b) = (flt[i * 3], flt[i * 3 + 1], flt[i * 3 + 2]);
        let key = ((r as usize >> 3) << 10) | ((g as usize >> 3) << 5) | (b as usize >> 3);
        cnt[key] += 1;
        sum[key][0] += r as u64; sum[key][1] += g as u64; sum[key][2] += b as u64;
    }
    let mut bins: Vec<usize> = (0..32768).filter(|&b| cnt[b] > 0).collect();
    bins.sort_unstable_by(|a, b| cnt[*b].cmp(&cnt[*a]));
    let merge = 60.0 - 38.0 * sens / 100.0;
    let max_n = o.colors.unwrap_or(12).clamp(2, 16);
    let mut pal: Vec<[f32; 3]> = vec![];
    for b in bins {
        if pal.len() >= max_n { break; }
        if o.colors.is_none() && (cnt[b] as f32) < 0.004 * total_sharp as f32 { break; }
        let c = cnt[b] as f32;
        let col = [sum[b][0] as f32 / c, sum[b][1] as f32 / c, sum[b][2] as f32 / c];
        if pal.iter().all(|p| dist(col, *p) > merge) { pal.push(col); }
    }
    if pal.is_empty() { return Err("Não encontrei cores nesta textura.".into()); }

    // one refinement: centres = mean of the sharp pixels nearest to each colour
    let assign = |pal: &[[f32; 3]]| -> Vec<(u8, u8)> {
        (0..n).into_par_iter().map(|i| if used[i] { let (l, d) = nearest(px(i), pal); (l as u8, d.min(255.0) as u8) } else { (255, 0) }).collect()
    };
    let first = assign(&pal);
    let mut acc = vec![([0f64; 3], 0u64); pal.len()];
    for i in 0..n {
        if sharp[i] { let (l, _) = first[i]; let a = &mut acc[l as usize]; for c in 0..3 { a.0[c] += flt[i * 3 + c] as f64; } a.1 += 1; }
    }
    for (p, a) in pal.iter_mut().zip(&acc) { if a.1 > 0 { for c in 0..3 { p[c] = (a.0[c] / a.1 as f64) as f32; } } }
    let la = assign(&pal);
    let label0: Vec<u8> = la.iter().map(|x| x.0).collect();
    let err: Vec<u8> = la.iter().map(|x| x.1).collect();

    // majority filter inside the same part: single odd pixels join their neighbours
    let np = pal.len();
    let label: Vec<u8> = (0..n).into_par_iter().map(|i| {
        let l = label0[i];
        if l == 255 { return l; }
        let (x, y) = (i % w, i / w);
        let mut c = [0u8; 16];
        for dy in -1i32..=1 { for dx in -1i32..=1 {
            let (yy, xx) = (y as i32 + dy, x as i32 + dx);
            if yy < 0 || xx < 0 || yy as usize >= h || xx as usize >= w { continue; }
            let j = yy as usize * w + xx as usize;
            if label0[j] != 255 && part_of[j] == part_of[i] { c[label0[j] as usize] += 1; }
        } }
        let mut best = l as usize;
        for q in 0..np { if c[q] > c[best] { best = q; } }
        best as u8
    }).collect();

    // detail: pixels far from every palette colour (they get no flat mask: the detail cut-out covers them) (opened to drop thin lines, then grown by a pixel)
    let t = 64.0 - 38.0 * sens / 100.0;
    let res0: Vec<bool> = (0..n).into_par_iter().map(|i| used[i] && err[i] as f32 > t).collect();
    let mut res = dilate(&dilate(&erode(&res0, w, h), w, h), w, h);
    let min_detail = ((400.0 * k * k) as usize).max(32);
    let mut det_area = [0usize; 4];
    for i in 0..n { if res[i] && used[i] { det_area[part_of[i] as usize] += 1; } }
    for i in 0..n { if res[i] && (!used[i] || det_area[part_of[i] as usize] < min_detail) { res[i] = false; } }
    let det_area: Vec<usize> = (0..4).map(|p| if det_area[p] < min_detail { 0 } else { det_area[p] }).collect();

    // area of every colour in every part: the biggest is the base colour, small ones are dropped
    let mut area = [[0usize; 16]; 4];
    for i in 0..n { if label[i] != 255 && !res[i] { area[part_of[i] as usize][label[i] as usize] += 1; } }
    let dominant: Vec<Option<usize>> = (0..4).map(|p| (0..np).max_by_key(|&c| area[p][c]).filter(|&c| area[p][c] > 0)).collect();
    let keeps = |p: usize, c: usize| -> bool { Some(c) != dominant[p] && area[p][c] >= min_area };
    let eff = |i: usize| -> usize { let (p, l) = (part_of[i] as usize, label[i] as usize); if !res[i] && keeps(p, l) { l } else { dominant[p].unwrap_or(l) } };

    // encode masks and details (in parallel)
    let tasks: Vec<(usize, usize)> = (0..4).flat_map(|p| (0..np).filter(move |&c| keeps(p, c)).map(move |c| (p, c))).collect();
    let masks: Vec<(usize, usize, MaskOut)> = tasks.par_iter().map(|&(p, c)| {
        let mut buf = vec![0u8; n * 4];
        let mut a = 0;
        for i in 0..n { if used[i] && part_of[i] as usize == p && eff(i) == c { buf[i * 4..i * 4 + 4].copy_from_slice(&[255, 255, 255, 255]); a += 1; } }
        let png = encode_png(&buf, w as u32, h as u32).map(|b| data_url(&b)).unwrap_or_default();
        (p, c, MaskOut { color: c, area: a, png })
    }).collect();
    let details: Vec<Option<String>> = (0..4).into_par_iter().map(|p| {
        if det_area[p] == 0 { return None; }
        let mut buf = vec![0u8; n * 4];
        for i in 0..n { if res[i] && part_of[i] as usize == p { buf[i * 4..i * 4 + 4].copy_from_slice(&rgba[i * 4..i * 4 + 4]); buf[i * 4 + 3] = 255; } }
        encode_png(&buf, w as u32, h as u32).ok().map(|b| data_url(&b))
    }).collect();

    // recomposition (small previews) and the mean difference to the original
    let pc: Vec<[f32; 3]> = pal.clone();
    let rec = |i: usize| -> [f32; 3] { if res[i] { [rgba[i * 4] as f32, rgba[i * 4 + 1] as f32, rgba[i * 4 + 2] as f32] } else { pc[eff(i)] } };
    let block = (w / 512).max(1);
    let ps = w / block;
    let (mut sum_d, mut cnt_d) = (0f64, 0u64);
    let mut rp = vec![0u8; ps * ps * 4];
    let mut dp = vec![0u8; ps * ps * 4];
    for by in 0..ps { for bx in 0..ps {
        let (mut r, mut g, mut b, mut d, mut m) = (0f32, 0f32, 0f32, 0f32, 0f32);
        for yy in 0..block { for xx in 0..block {
            let i = (by * block + yy) * w + bx * block + xx;
            if !used[i] { continue; }
            let c = rec(i);
            let dd = ((c[0] - rgba[i * 4] as f32).abs() + (c[1] - rgba[i * 4 + 1] as f32).abs() + (c[2] - rgba[i * 4 + 2] as f32).abs()) / 3.0;
            sum_d += dd as f64; cnt_d += 1;
            r += c[0]; g += c[1]; b += c[2]; d += dd; m += 1.0;
        } }
        let o4 = (by * ps + bx) * 4;
        if m > 0.0 {
            rp[o4..o4 + 4].copy_from_slice(&[(r / m) as u8, (g / m) as u8, (b / m) as u8, 255]);
            let v = ((d / m) * 4.0).min(255.0) as u8;
            dp[o4..o4 + 4].copy_from_slice(&[v, v, v, 255]);
        }
    } }
    let used_total = used.iter().filter(|&&u| u).count().max(1);
    let mut tot = vec![0usize; np];
    for i in 0..n { if used[i] { tot[eff(i)] += 1; } }
    let hex = |c: [f32; 3]| format!("#{:02x}{:02x}{:02x}", c[0].round() as u8, c[1].round() as u8, c[2].round() as u8);
    let parts = (0..4).map(|p| PartOut {
        part: PARTS[p],
        dominant: dominant[p],
        masks: masks.iter().filter(|m| m.0 == p).map(|m| MaskOut { color: m.2.color, area: m.2.area, png: m.2.png.clone() }).collect(),
        detail: details[p].clone(),
        detail_area: det_area[p],
    }).collect();
    Ok(Analysis {
        width: w,
        palette: pal.iter().enumerate().map(|(i, c)| PalColor { hex: hex(*c), share: tot[i] as f32 / used_total as f32 }).collect(),
        parts,
        recomposed: data_url(&encode_png(&rp, ps as u32, ps as u32).map_err(|e| e.to_string())?),
        diff: data_url(&encode_png(&dp, ps as u32, ps as u32).map_err(|e| e.to_string())?),
        mean_diff: (sum_d / cnt_d.max(1) as f64) as f32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A shirt with thin stripes plus fabric noise, grey socks and a gradient "crest".
    fn texture() -> Vec<u8> {
        let w = 2048;
        let mut px = vec![0u8; w * w * 4];
        let mut seed = 12345u32;
        let mut noise = || { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); ((seed >> 24) as i32 % 7) - 3 };
        for y in 0..w { for x in 0..w {
            let i = (y * w + x) * 4;
            let base: [i32; 3] = if (704..1344).contains(&x) && (960..1960).contains(&y) {
                if (x / 40) % 4 == 0 { [250, 250, 250] } else { [41, 89, 66] }
            } else if x < 400 && (630..1160).contains(&y) { [120, 120, 120 ]
            } else if x >= 1648 && (630..1160).contains(&y) { [120, 120, 120] } else { [0, 0, 0] };
            let used = base != [0, 0, 0];
            let (cx, cy) = (1000f32, 1100f32);
            let dd = (((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt()) as f32;
            let c = if dd < 60.0 { let t = (x as f32 - (cx - 60.0)) / 120.0; [(255.0 * (1.0 - t)) as i32, 30, (255.0 * t) as i32] } else { base };
            for k in 0..3 { px[i + k] = (c[k] + if used { noise() } else { 0 }).clamp(0, 255) as u8; }
            px[i + 3] = if used || dd < 60.0 { 255 } else { 0 };
        } }
        px
    }

    fn near(hex: &str, r: i32, g: i32, b: i32) -> bool {
        let v = |s: &str| i32::from_str_radix(s, 16).unwrap();
        (v(&hex[1..3]) - r).abs() < 12 && (v(&hex[3..5]) - g).abs() < 12 && (v(&hex[5..7]) - b).abs() < 12
    }

    #[test]
    fn splits_stripes_and_finds_the_crest() {
        let a = analyze(&texture(), 2048, 2048, &Opts::default()).unwrap();
        assert!(a.palette.iter().any(|p| near(&p.hex, 41, 89, 66)), "green missing: {:?}", a.palette.iter().map(|p| &p.hex).collect::<Vec<_>>());
        assert!(a.palette.iter().any(|p| near(&p.hex, 250, 250, 250)), "white missing");
        let torso = &a.parts[0];
        let dom = torso.dominant.expect("dominant");
        assert!(near(&a.palette[dom].hex, 41, 89, 66), "the green covers most of the shirt");
        // the white stripes are the one layer of the shirt
        assert_eq!(torso.masks.len(), 1, "{:?}", torso.masks.iter().map(|m| (m.color, m.area)).collect::<Vec<_>>());
        assert!(near(&a.palette[torso.masks[0].color].hex, 250, 250, 250));
        // the gradient crest does not become flat colours: it is a detail cut-out
        assert!(torso.detail.is_some(), "crest should be detail");
        assert!(a.mean_diff < 6.0, "mean diff {}", a.mean_diff);
        // masks are real images of the same size
        let png = torso.masks[0].png.split_once(',').unwrap().1;
        let bytes = crate::kitlab::b64_decode(png).unwrap();
        let img = image::load_from_memory(&bytes).unwrap();
        assert_eq!((img.width(), img.height()), (2048, 2048));
        // the grey socks got their own base colour
        assert!(a.parts[3].dominant.is_some());
    }

    #[test]
    fn colour_count_is_respected_and_bad_input_fails() {
        let a = analyze(&texture(), 2048, 2048, &Opts { colors: Some(2), ..Default::default() }).unwrap();
        assert!(a.palette.len() <= 2);
        assert!(analyze(&[0u8; 16], 2, 2, &Opts::default()).is_err());
        assert!(analyze(&vec![0u8; 300 * 256 * 4], 300, 256, &Opts::default()).is_err());
    }
}
