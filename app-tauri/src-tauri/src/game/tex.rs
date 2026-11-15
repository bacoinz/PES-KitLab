//! Texture codecs: Fox Engine FTEX and DDS → RGBA8, and RGBA8 → FTEX (BC7 / DXT5 / DXT1 with all mip levels).
//! Layout: 'FTEX' | f32 version | u16 fmt | u16 w | u16 h | u16 depth | u8 mips ... | mip table @0x40 (16 B each);
//! each mip = chunk table (<HHI compSize, decSize, offset>) + zlib/raw chunks of 16 KB.
use anyhow::{bail, Result};
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use rayon::prelude::*;
use std::io::{Read, Write};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TexFormat { Bgra8, Rgba8, Dxt1, Dxt3, Dxt5, Bc7 }

fn ftex_format(code: u16) -> Option<TexFormat> {
    Some(match code {
        0 => TexFormat::Bgra8,
        2 | 0xc => TexFormat::Dxt1,
        4 | 0xe => TexFormat::Dxt5,
        0xb => TexFormat::Bc7,
        0xd => TexFormat::Dxt3,
        _ => return None,
    })
}
fn format_code(f: TexFormat) -> u16 {
    match f { TexFormat::Bgra8 | TexFormat::Rgba8 => 0, TexFormat::Dxt1 => 2, TexFormat::Dxt3 => 0xd, TexFormat::Dxt5 => 4, TexFormat::Bc7 => 0xb }
}

pub fn data_size(f: TexFormat, w: usize, h: usize) -> usize {
    let bw = w.div_ceil(4).max(1);
    let bh = h.div_ceil(4).max(1);
    match f {
        TexFormat::Bgra8 | TexFormat::Rgba8 => w * h * 4,
        TexFormat::Dxt1 => bw * bh * 8,
        _ => bw * bh * 16,
    }
}

pub struct Rgba { pub width: u32, pub height: u32, pub data: Vec<u8> }

/// Block-compressed / raw data → RGBA8.
pub fn decode_texture(f: TexFormat, data: &[u8], w: usize, h: usize) -> Result<Vec<u8>> {
    let mut out = vec![0u8; w * h * 4];
    match f {
        TexFormat::Rgba8 => out.copy_from_slice(&data[..w * h * 4]),
        TexFormat::Bgra8 => {
            for (o, i) in out.chunks_exact_mut(4).zip(data.chunks_exact(4)) {
                o.copy_from_slice(&[i[2], i[1], i[0], i[3]]);
            }
        }
        _ => {
            // decode on padded block size, then crop
            let pw = w.div_ceil(4) * 4;
            let ph = h.div_ceil(4) * 4;
            let mut px = vec![0u32; pw * ph];
            let need = data_size(f, pw, ph);
            let mut buf;
            let src = if data.len() < need { buf = data.to_vec(); buf.resize(need, 0); &buf[..] } else { data };
            let r = match f {
                TexFormat::Dxt1 => texture2ddecoder::decode_bc1(src, pw, ph, &mut px),
                TexFormat::Dxt3 => texture2ddecoder::decode_bc2(src, pw, ph, &mut px),
                TexFormat::Dxt5 => texture2ddecoder::decode_bc3(src, pw, ph, &mut px),
                TexFormat::Bc7 => texture2ddecoder::decode_bc7(src, pw, ph, &mut px),
                _ => unreachable!(),
            };
            if let Err(e) = r { bail!("decode error: {e}"); }
            for y in 0..h {
                for x in 0..w {
                    let v = px[y * pw + x]; // 0xAARRGGBB
                    let o = (y * w + x) * 4;
                    out[o] = (v >> 16) as u8;
                    out[o + 1] = (v >> 8) as u8;
                    out[o + 2] = v as u8;
                    out[o + 3] = (v >> 24) as u8;
                }
            }
        }
    }
    Ok(out)
}

fn le16(d: &[u8], p: usize) -> u16 { u16::from_le_bytes([d[p], d[p + 1]]) }
fn le32(d: &[u8], p: usize) -> u32 { u32::from_le_bytes(d[p..p + 4].try_into().unwrap()) }

pub struct FtexInfo { pub format: TexFormat, pub width: u32, pub height: u32, pub mips: u32 }

pub fn ftex_info(d: &[u8]) -> Result<FtexInfo> {
    if d.len() < 0x40 || &d[..4] != b"FTEX" { bail!("not an FTEX file"); }
    let code = le16(d, 8);
    let Some(format) = ftex_format(code) else { bail!("unsupported FTEX format {code}") };
    Ok(FtexInfo { format, width: le16(d, 10) as u32, height: le16(d, 12) as u32, mips: d[0x10] as u32 })
}

fn ftex_mip(d: &[u8], level: u32) -> Result<(Vec<u8>, u32)> {
    let n = d[0x10] as u32;
    let level = level.min(n.saturating_sub(1));
    let t = 0x40 + 16 * level as usize;
    let off = le32(d, t) as usize;
    let cc = le16(d, t + 14) as usize;
    let mut out = Vec::new();
    for k in 0..cc {
        let mut cs = le16(d, off + 8 * k) as usize;
        let mut ds = le16(d, off + 8 * k + 2) as usize;
        let co = (le32(d, off + 8 * k + 4) & 0x7fff_ffff) as usize;
        if cs == 0 { cs = 0x10000; }
        if ds == 0 { ds = 0x10000; }
        let raw = &d[off + co..(off + co + cs).min(d.len())];
        if cs == ds { out.extend_from_slice(raw); } else { ZlibDecoder::new(raw).read_to_end(&mut out)?; }
    }
    Ok((out, level))
}

/// Decode an FTEX at the requested mip level (0 = full size).
pub fn decode_ftex(d: &[u8], level: u32) -> Result<Rgba> {
    let info = ftex_info(d)?;
    let (data, lv) = ftex_mip(d, level)?;
    let w = (info.width >> lv).max(1) as usize;
    let h = (info.height >> lv).max(1) as usize;
    Ok(Rgba { width: w as u32, height: h as u32, data: decode_texture(info.format, &data, w, h)? })
}

// Header bytes 0x04..0x3F copied from a kit-server FTEX that the game loads fine.
const HEADER_TEMPLATE: [u8; 60] = {
    let mut h = [0u8; 60];
    let pre: [u8; 28] = [0x85, 0xeb, 0x01, 0x40, 0, 0, 0, 0, 0, 0, 0x01, 0x00, 0x01, 0x02, 0x11, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0x03, 0, 0, 0];
    let mut i = 0;
    while i < 28 { h[i] = pre[i]; i += 1; }
    h
};

fn pack_mip(data: &[u8]) -> (Vec<u8>, usize) {
    const CH: usize = 0x4000;
    let parts: Vec<&[u8]> = data.chunks(CH).collect();
    let comp: Vec<Vec<u8>> = parts
        .par_iter()
        .map(|p| {
            let mut e = ZlibEncoder::new(Vec::new(), Compression::best());
            e.write_all(p).unwrap();
            let c = e.finish().unwrap();
            if c.len() >= p.len() { p.to_vec() } else { c }
        })
        .collect();
    let mut table = vec![0u8; 8 * parts.len()];
    let mut off = table.len();
    for (k, (c, p)) in comp.iter().zip(&parts).enumerate() {
        table[8 * k..8 * k + 2].copy_from_slice(&((c.len() & 0xffff) as u16).to_le_bytes());
        table[8 * k + 2..8 * k + 4].copy_from_slice(&((p.len() & 0xffff) as u16).to_le_bytes());
        table[8 * k + 4..8 * k + 8].copy_from_slice(&(off as u32).to_le_bytes());
        off += c.len();
    }
    let mut blob = table;
    for c in comp { blob.extend_from_slice(&c); }
    (blob, parts.len())
}

/// Build an FTEX from already block-compressed mip levels.
pub fn build_ftex(format: TexFormat, width: u32, height: u32, mips: &[Vec<u8>]) -> Vec<u8> {
    let n = mips.len();
    let mut hdr = vec![0u8; 0x40 + 16 * n];
    hdr[..4].copy_from_slice(b"FTEX");
    hdr[4..64].copy_from_slice(&HEADER_TEMPLATE);
    hdr[8..10].copy_from_slice(&format_code(format).to_le_bytes());
    hdr[10..12].copy_from_slice(&(width as u16).to_le_bytes());
    hdr[12..14].copy_from_slice(&(height as u16).to_le_bytes());
    hdr[14..16].copy_from_slice(&1u16.to_le_bytes());
    hdr[0x10] = n as u8;
    let packed: Vec<(Vec<u8>, usize)> = mips.par_iter().map(|m| pack_mip(m)).collect();
    let mut off = hdr.len();
    for (l, ((blob, chunks), m)) in packed.iter().zip(mips).enumerate() {
        let t = 0x40 + 16 * l;
        hdr[t..t + 4].copy_from_slice(&(off as u32).to_le_bytes());
        hdr[t + 4..t + 8].copy_from_slice(&(m.len() as u32).to_le_bytes());
        hdr[t + 8..t + 12].copy_from_slice(&(blob.len() as u32).to_le_bytes());
        hdr[t + 12] = l as u8;
        hdr[t + 13] = 0;
        hdr[t + 14..t + 16].copy_from_slice(&(*chunks as u16).to_le_bytes());
        off += blob.len();
    }
    let mut out = hdr;
    for (b, _) in packed { out.extend_from_slice(&b); }
    out
}

/// 2×2 box downscale (premultiplied by alpha to avoid dark fringes).
pub fn downscale(rgba: &[u8], w: usize, h: usize) -> (Vec<u8>, usize, usize) {
    let nw = (w / 2).max(1);
    let nh = (h / 2).max(1);
    let mut out = vec![0u8; nw * nh * 4];
    out.par_chunks_mut(nw * 4).enumerate().for_each(|(y, row)| {
        for x in 0..nw {
            let mut acc = [0u32; 4];
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let sx = (x * 2 + dx).min(w - 1);
                let sy = (y * 2 + dy).min(h - 1);
                let i = (sy * w + sx) * 4;
                let a = rgba[i + 3] as u32;
                acc[0] += rgba[i] as u32 * a;
                acc[1] += rgba[i + 1] as u32 * a;
                acc[2] += rgba[i + 2] as u32 * a;
                acc[3] += a;
            }
            let o = x * 4;
            if acc[3] > 0 {
                for c in 0..3 { row[o + c] = ((acc[c] + acc[3] / 2) / acc[3]).min(255) as u8; }
            }
            row[o + 3] = ((acc[3] + 2) / 4) as u8;
        }
    });
    (out, nw, nh)
}

/// RGBA8 → block-compressed data. Rows are split into stripes encoded in parallel.
pub fn encode_texture(f: TexFormat, rgba: &[u8], w: usize, h: usize, opaque: bool) -> Vec<u8> {
    if matches!(f, TexFormat::Rgba8) { return rgba.to_vec(); }
    if matches!(f, TexFormat::Bgra8) {
        return rgba.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
    }
    // pad to multiples of 4
    let pw = w.div_ceil(4) * 4;
    let ph = h.div_ceil(4) * 4;
    let padded;
    let src: &[u8] = if pw != w || ph != h {
        let mut p = vec![0u8; pw * ph * 4];
        for y in 0..ph {
            let sy = y.min(h - 1);
            for x in 0..pw {
                let sx = x.min(w - 1);
                p[(y * pw + x) * 4..(y * pw + x) * 4 + 4].copy_from_slice(&rgba[(sy * w + sx) * 4..(sy * w + sx) * 4 + 4]);
            }
        }
        padded = p;
        &padded
    } else {
        rgba
    };
    let stripe = 64usize.min(ph); // rows per job (multiple of 4)
    let stripes: Vec<usize> = (0..ph).step_by(stripe).collect();
    let parts: Vec<Vec<u8>> = stripes
        .par_iter()
        .map(|&y0| {
            let rows = stripe.min(ph - y0);
            let surf = intel_tex_2::RgbaSurface {
                data: &src[y0 * pw * 4..(y0 + rows) * pw * 4],
                width: pw as u32,
                height: rows as u32,
                stride: (pw * 4) as u32,
            };
            match f {
                TexFormat::Dxt1 => intel_tex_2::bc1::compress_blocks(&surf),
                TexFormat::Dxt3 | TexFormat::Dxt5 => intel_tex_2::bc3::compress_blocks(&surf),
                TexFormat::Bc7 => {
                    let s = if opaque { intel_tex_2::bc7::opaque_fast_settings() } else { intel_tex_2::bc7::alpha_fast_settings() };
                    intel_tex_2::bc7::compress_blocks(&s, &surf)
                }
                _ => unreachable!(),
            }
        })
        .collect();
    parts.concat()
}

/// RGBA8 → FTEX with every mip level down to 4×4.
pub fn encode_ftex(rgba: &[u8], width: u32, height: u32, format: TexFormat) -> Vec<u8> {
    let opaque = rgba.chunks_exact(4).all(|p| p[3] == 255);
    let max_mips = ((width.min(height) as f32).log2().floor() as i32 - 1).max(1) as usize;
    let mut levels = Vec::with_capacity(max_mips);
    let (mut cur, mut w, mut h) = (rgba.to_vec(), width as usize, height as usize);
    for l in 0..max_mips {
        levels.push(encode_texture(format, &cur, w, h, opaque));
        if l + 1 < max_mips {
            let (n, nw, nh) = downscale(&cur, w, h);
            cur = n; w = nw; h = nh;
        }
    }
    build_ftex(format, width, height, &levels)
}

// ---------------------------------------------------------------- DDS
pub fn decode_dds(d: &[u8]) -> Result<Rgba> {
    if d.len() < 128 || &d[..4] != b"DDS " { bail!("not a DDS file"); }
    let h = le32(d, 12) as usize;
    let w = le32(d, 16) as usize;
    let pf_flags = le32(d, 80);
    let four = &d[84..88];
    let mut off = 128;
    let format = if four == b"DX10" {
        off = 148;
        match le32(d, 128) {
            98 | 99 => TexFormat::Bc7,
            71 | 72 => TexFormat::Dxt1,
            77 | 78 => TexFormat::Dxt5,
            74 | 75 => TexFormat::Dxt3,
            28 | 29 => TexFormat::Rgba8,
            87 | 91 => TexFormat::Bgra8,
            x => bail!("unsupported DXGI format {x}"),
        }
    } else if pf_flags & 4 != 0 {
        match four {
            b"DXT1" => TexFormat::Dxt1,
            b"DXT3" => TexFormat::Dxt3,
            b"DXT5" => TexFormat::Dxt5,
            _ => bail!("unsupported DDS fourCC"),
        }
    } else if le32(d, 92) == 0xff { TexFormat::Rgba8 } else { TexFormat::Bgra8 };
    let end = (off + data_size(format, w, h)).min(d.len());
    Ok(Rgba { width: w as u32, height: h as u32, data: decode_texture(format, &d[off..end], w, h)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ftex_roundtrip() {
        let (w, h) = (64usize, 32usize);
        let mut px = vec![0u8; w * h * 4];
        for y in 0..h { for x in 0..w { let i = (y * w + x) * 4; px[i] = (x * 4) as u8; px[i + 1] = (y * 8) as u8; px[i + 2] = 128; px[i + 3] = 255; } }
        for f in [TexFormat::Bc7, TexFormat::Dxt5, TexFormat::Dxt1] {
            let ft = encode_ftex(&px, w as u32, h as u32, f);
            let info = ftex_info(&ft).unwrap();
            assert_eq!((info.width, info.height), (64, 32));
            assert!(info.mips >= 3);
            let back = decode_ftex(&ft, 0).unwrap();
            let err: u64 = back.data.iter().zip(&px).map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as u64).sum();
            assert!(err / (px.len() as u64) < 6, "{f:?} mean error too high");
            let m1 = decode_ftex(&ft, 1).unwrap();
            assert_eq!((m1.width, m1.height), (32, 16));
        }
    }

    #[test]
    fn ftex_export_sizes() {
        // the kit export can be 512 … 4096 px: every size must round-trip with a full mip chain
        for n in [512usize, 1024, 4096] {
            let mut px = vec![0u8; n * n * 4];
            for (i, p) in px.chunks_mut(4).enumerate() { p[0] = (i % n) as u8; p[1] = (i / n) as u8; p[2] = 90; p[3] = 255; }
            let ft = encode_ftex(&px, n as u32, n as u32, TexFormat::Dxt5);
            let info = ftex_info(&ft).unwrap();
            assert_eq!((info.width, info.height), (n as u32, n as u32));
            assert!(info.mips >= 8, "{n}: only {} mips", info.mips);
            let back = decode_ftex(&ft, 0).unwrap();
            assert_eq!(back.data.len(), px.len());
        }
    }
}
