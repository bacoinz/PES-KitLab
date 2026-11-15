//! CRI CPK archive reader (PES 2021 / Football Life). Reads only the header and TOC, so multi-GB archives open
//! instantly; files are extracted on demand (CRILAYLA aware).
use anyhow::{anyhow, bail, Result};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum UtfValue {
    Int(i64),
    Float(f32),
    Str(String),
    Data(Vec<u8>),
    Null,
}

impl UtfValue {
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            UtfValue::Int(v) => Some(*v),
            UtfValue::Float(f) => Some(*f as i64),
            _ => None,
        }
    }
    pub fn as_str(&self) -> &str {
        match self {
            UtfValue::Str(s) => s,
            _ => "",
        }
    }
}

pub type UtfRow = HashMap<String, UtfValue>;

fn unxor(b: &[u8]) -> Vec<u8> {
    let mut m: u32 = 0x655f;
    let t: u32 = 0x4115;
    b.iter()
        .map(|x| {
            let o = x ^ (m & 0xff) as u8;
            m = m.wrapping_mul(t);
            o
        })
        .collect()
}

fn be16(t: &[u8], p: usize) -> u16 { u16::from_be_bytes([t[p], t[p + 1]]) }
fn be32(t: &[u8], p: usize) -> u32 { u32::from_be_bytes(t[p..p + 4].try_into().unwrap()) }
fn be64(t: &[u8], p: usize) -> u64 { u64::from_be_bytes(t[p..p + 8].try_into().unwrap()) }

/// Parse an @UTF table (possibly XOR-masked).
pub fn parse_utf(packet: &[u8]) -> Result<Vec<UtfRow>> {
    let owned;
    let packet = if &packet[..4] != b"@UTF" {
        owned = unxor(packet);
        &owned[..]
    } else {
        packet
    };
    if &packet[..4] != b"@UTF" {
        bail!("not a @UTF table");
    }
    let size = be32(packet, 4) as usize;
    let t = &packet[8..(8 + size).min(packet.len())];
    let rows_off = be32(t, 0) as usize;
    let str_off = be32(t, 4) as usize;
    let data_off = be32(t, 8) as usize;
    let ncols = be16(t, 16) as usize;
    let row_len = be16(t, 18) as usize;
    let nrows = be32(t, 20) as usize;
    let s = |o: usize| -> String {
        let st = str_off + o;
        let e = t[st..].iter().position(|&c| c == 0).map(|p| st + p).unwrap_or(t.len());
        String::from_utf8_lossy(&t[st..e]).into_owned()
    };
    let read_val = |p: usize, typ: u8| -> Result<(UtfValue, usize)> {
        Ok(match typ {
            0 => (UtfValue::Int(t[p] as i64), p + 1),
            1 => (UtfValue::Int(t[p] as i8 as i64), p + 1),
            2 => (UtfValue::Int(be16(t, p) as i64), p + 2),
            3 => (UtfValue::Int(be16(t, p) as i16 as i64), p + 2),
            4 => (UtfValue::Int(be32(t, p) as i64), p + 4),
            5 => (UtfValue::Int(be32(t, p) as i32 as i64), p + 4),
            6 | 7 => (UtfValue::Int(be64(t, p) as i64), p + 8),
            8 => (UtfValue::Float(f32::from_bits(be32(t, p))), p + 4),
            0xa => (UtfValue::Str(s(be32(t, p) as usize)), p + 4),
            0xb => {
                let o = be32(t, p) as usize;
                let n = be32(t, p + 4) as usize;
                (UtfValue::Data(t[data_off + o..data_off + o + n].to_vec()), p + 8)
            }
            _ => bail!("utf type {typ:x}"),
        })
    };
    let mut p = 24;
    struct Col { name: String, storage: u8, typ: u8, konst: UtfValue }
    let mut cols = Vec::with_capacity(ncols);
    for _ in 0..ncols {
        let flag = t[p];
        p += 1;
        let name = s(be32(t, p) as usize);
        p += 4;
        let storage = flag & 0xf0;
        let typ = flag & 0x0f;
        let mut konst = UtfValue::Null;
        if storage == 0x30 {
            let (v, np) = read_val(p, typ)?;
            konst = v;
            p = np;
        }
        cols.push(Col { name, storage, typ, konst });
    }
    let mut rows = Vec::with_capacity(nrows);
    for r in 0..nrows {
        let mut q = rows_off + r * row_len;
        let mut row = UtfRow::new();
        for c in &cols {
            let v = match c.storage {
                0x50 => {
                    let (v, nq) = read_val(q, c.typ)?;
                    q = nq;
                    v
                }
                0x30 => c.konst.clone(),
                _ => UtfValue::Null,
            };
            row.insert(c.name.clone(), v);
        }
        rows.push(row);
    }
    Ok(rows)
}

/// CRILAYLA decompression (backwards LZ).
pub fn crilayla(src: &[u8]) -> Vec<u8> {
    let usize_ = u32::from_le_bytes(src[8..12].try_into().unwrap()) as usize;
    let hsize = u32::from_le_bytes(src[12..16].try_into().unwrap()) as usize;
    let prefix = &src[16 + hsize..(16 + hsize + 0x100).min(src.len())];
    let mut out = vec![0u8; usize_ + 0x100];
    let body = &src[16..16 + hsize];
    let mut byte_pos: isize = body.len() as isize - 1;
    let mut bits_left = 0u32;
    let mut cur = 0u32;
    let mut bits = |n: u32| -> u32 {
        let mut n = n;
        let mut v = 0u32;
        while n > 0 {
            if bits_left == 0 {
                cur = if byte_pos >= 0 { body[byte_pos as usize] as u32 } else { 0 };
                byte_pos -= 1;
                bits_left = 8;
            }
            let take = n.min(bits_left);
            v = (v << take) | ((cur >> (bits_left - take)) & ((1 << take) - 1));
            bits_left -= take;
            n -= take;
        }
        v
    };
    let mut w: isize = (usize_ + 0x100) as isize - 1;
    while w >= 0x100 {
        if bits(1) == 1 {
            let off = (bits(13) + 3) as isize;
            let mut ln = 3u32;
            let mut done = false;
            for lv in [2u32, 3, 5, 8] {
                let x = bits(lv);
                ln += x;
                if x != (1 << lv) - 1 {
                    done = true;
                    break;
                }
            }
            if !done {
                loop {
                    let x = bits(8);
                    ln += x;
                    if x != 255 {
                        break;
                    }
                }
            }
            for _ in 0..ln {
                if w < 0 { break; }
                out[w as usize] = out[(w + off) as usize];
                w -= 1;
            }
        } else {
            out[w as usize] = bits(8) as u8;
            w -= 1;
        }
    }
    out[..prefix.len()].copy_from_slice(prefix);
    out
}

#[derive(Debug, Clone)]
pub struct CpkEntry {
    pub name: String,
    pub offset: u64,
    pub size: u64,
}

pub struct Cpk {
    pub path: PathBuf,
    pub files: HashMap<String, CpkEntry>,
}

impl Cpk {
    pub fn open(path: &Path) -> Result<Cpk> {
        let mut f = File::open(path)?;
        let mut head = vec![0u8; 0x800];
        let n = f.read(&mut head)?;
        head.truncate(n);
        if head.len() < 16 || &head[..4] != b"CPK " {
            bail!("not a CPK archive: {}", path.display());
        }
        let hdr_len = u32::from_le_bytes(head[8..12].try_into().unwrap()) as usize;
        let hdr_buf = if 16 + hdr_len <= head.len() {
            head[16..16 + hdr_len].to_vec()
        } else {
            let mut b = vec![0u8; hdr_len];
            f.seek(SeekFrom::Start(16))?;
            f.read_exact(&mut b)?;
            b
        };
        let hdr = parse_utf(&hdr_buf)?.into_iter().next().ok_or_else(|| anyhow!("empty CPK header"))?;
        let content = hdr.get("ContentOffset").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
        let toc_off = hdr.get("TocOffset").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
        let mut cpk = Cpk { path: path.to_path_buf(), files: HashMap::new() };
        if toc_off == 0 {
            return Ok(cpk);
        }
        let mut th = [0u8; 16];
        f.seek(SeekFrom::Start(toc_off))?;
        f.read_exact(&mut th)?;
        if &th[..4] != b"TOC " {
            bail!("CPK without TOC");
        }
        let n = u32::from_le_bytes(th[8..12].try_into().unwrap()) as usize;
        let mut toc = vec![0u8; n];
        f.read_exact(&mut toc)?;
        let base = if content > 0 { content.min(toc_off) } else { toc_off };
        for r in parse_utf(&toc)? {
            let dir = r.get("DirName").map(|v| v.as_str()).unwrap_or("");
            let file = r.get("FileName").map(|v| v.as_str()).unwrap_or("");
            let name = format!("{dir}/{file}").trim_start_matches('/').to_string();
            let off = r.get("FileOffset").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
            let size = r.get("FileSize").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
            cpk.files.insert(name.clone(), CpkEntry { name, offset: base + off, size });
        }
        Ok(cpk)
    }

    pub fn read(&self, name: &str) -> Result<Vec<u8>> {
        let e = self.files.get(name).ok_or_else(|| anyhow!("{name} not in {}", self.path.display()))?;
        let mut f = File::open(&self.path)?;
        f.seek(SeekFrom::Start(e.offset))?;
        let mut raw = vec![0u8; e.size as usize];
        f.read_exact(&mut raw)?;
        Ok(if raw.len() >= 16 && &raw[..8] == b"CRILAYLA" { crilayla(&raw) } else { raw })
    }
}
