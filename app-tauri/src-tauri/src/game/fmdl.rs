//! Fox Engine FMDL reader – positions, normals, UV0 and triangle indices (what the 3D preview needs).
use anyhow::{bail, Result};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct MeshData {
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u16>,
}

fn half(h: u16) -> f32 {
    let s = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let e = ((h >> 10) & 0x1f) as i32;
    let f = (h & 0x3ff) as f32;
    match e {
        0 => s * 2f32.powi(-14) * (f / 1024.0),
        31 => if f != 0.0 { f32::NAN } else { s * f32::INFINITY },
        _ => s * 2f32.powi(e - 15) * (1.0 + f / 1024.0),
    }
}

pub fn parse_fmdl(d: &[u8]) -> Result<Vec<MeshData>> {
    if d.len() < 0x40 || &d[..4] != b"FMDL" { bail!("not an FMDL model"); }
    let u16_ = |p: usize| u16::from_le_bytes([d[p], d[p + 1]]);
    let u32_ = |p: usize| u32::from_le_bytes(d[p..p + 4].try_into().unwrap());
    let f32_ = |p: usize| f32::from_le_bytes(d[p..p + 4].try_into().unwrap());
    let info = u64::from_le_bytes(d[8..16].try_into().unwrap()) as usize;
    let (s0n, s1n, s0o, s1o) = (u32_(0x20) as usize, u32_(0x24) as usize, u32_(0x28) as usize, u32_(0x30) as usize);
    let mut s0: HashMap<u16, (usize, usize)> = HashMap::new();
    let mut s1: HashMap<u32, usize> = HashMap::new();
    let mut p = info;
    for _ in 0..s0n { s0.insert(u16_(p), (u16_(p + 2) as usize, s0o + u32_(p + 4) as usize)); p += 8; }
    for _ in 0..s1n { s1.insert(u32_(p), s1o + u32_(p + 4) as usize); p += 12; }
    let rows = |id: u16, sz: usize| -> Vec<usize> { s0.get(&id).map(|&(n, o)| (0..n).map(|i| o + i * sz).collect()).unwrap_or_default() };
    let meshes = rows(3, 0x30);
    let mfa = rows(9, 8);
    let mfs = rows(10, 8);
    let vfs = rows(11, 4);
    let bo: Vec<[u32; 4]> = rows(14, 16).into_iter().map(|o| [u32_(o), u32_(o + 4), u32_(o + 8), u32_(o + 12)]).collect();
    let Some(&b) = s1.get(&2) else { return Ok(vec![]) };
    let ib = bo.iter().filter(|x| x[0] == 1).last().or(bo.last()).copied();
    let Some(ib) = ib else { return Ok(vec![]) };
    let mut out = Vec::new();
    for (mi, &m) in meshes.iter().enumerate() {
        let vc = u16_(m + 10) as usize;
        let ff = u32_(m + 16) as usize;
        let fc = u32_(m + 20) as usize;
        let Some(&a) = mfa.get(mi) else { continue };
        let nmf = d[a] as usize;
        let fmf = u16_(a + 4) as usize;
        let mut vi = u16_(a + 6) as usize;
        let (mut pp, mut nn, mut uv) = (None, None, None);
        for k in 0..nmf {
            let Some(&f) = mfs.get(fmf + k) else { break };
            let (bid, cnt, stride, off) = (d[f] as usize, d[f + 1] as usize, d[f + 2] as usize, u32_(f + 4) as usize);
            let base = b + bo[bid][2] as usize + off;
            for _ in 0..cnt {
                let v = vfs[vi];
                vi += 1;
                let (us, dt, vo) = (d[v], d[v + 1], u16_(v + 2) as usize);
                if us == 0 && dt == 1 {
                    pp = Some((0..vc * 3).map(|i| f32_(base + (i / 3) * stride + vo + (i % 3) * 4)).collect::<Vec<_>>());
                } else if us == 2 && dt == 6 {
                    nn = Some((0..vc * 3).map(|i| half(u16_(base + (i / 3) * stride + vo + (i % 3) * 2))).collect::<Vec<_>>());
                } else if us == 8 && dt == 7 {
                    uv = Some((0..vc * 2).map(|i| half(u16_(base + (i / 2) * stride + vo + (i % 2) * 2))).collect::<Vec<_>>());
                }
            }
        }
        let (Some(positions), Some(uvs)) = (pp, uv) else { continue };
        let io = b + ib[2] as usize + ff * 2;
        let indices = (0..fc).map(|i| u16_(io + i * 2)).collect();
        out.push(MeshData { positions, normals: nn, uvs, indices });
    }
    Ok(out)
}
