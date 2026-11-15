//! Konami "WESYS" wrapper: 00 01 01 'WESYS' + u32 compSize + u32 rawSize + zlib stream.
use flate2::read::ZlibDecoder;
use std::io::Read;

pub fn is_wesys(b: &[u8]) -> bool {
    b.len() >= 16 && &b[3..8] == b"WESYS"
}

pub fn unwesys(b: Vec<u8>) -> Vec<u8> {
    if !is_wesys(&b) {
        return b;
    }
    let mut out = Vec::new();
    match ZlibDecoder::new(&b[16..]).read_to_end(&mut out) {
        Ok(_) => out,
        Err(_) => b,
    }
}
