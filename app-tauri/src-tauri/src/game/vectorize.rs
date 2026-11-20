//! Vectorizer (texture analyser, phase B): turns a flat-colour mask into closed Bézier paths in texture px.
//!
//! 1. Boundary tracing along the pixel edges (inside always on the right: outer shapes clockwise, holes counter-
//!    clockwise; touching diagonal pixels are kept apart).
//! 2. Specks (small shapes and small holes) are dropped.
//! 3. Corners are found with a light Douglas-Peucker pass on the traced polygon; between corners the boundary is
//!    resampled, smoothed and fitted with cubic Béziers (Schneider's curve fitting) within the tolerance, or kept as a
//!    straight line when it is straight.
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VOpts {
    /// maximum distance between the mask edge and the curve, px (default 2)
    pub tolerance: Option<f64>,
    /// smallest shape or hole kept, px² (default 120)
    pub min_area: Option<f64>,
    /// turning angle in degrees from which a point is a sharp corner (default 50)
    pub corner: Option<f64>,
}
impl Default for VOpts { fn default() -> Self { VOpts { tolerance: None, min_area: None, corner: None } } }

#[derive(Serialize, Clone, Debug)]
pub struct VPt {
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")] pub ix: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub iy: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub ox: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub oy: Option<f64>,
}
#[derive(Serialize, Clone, Debug)]
pub struct VPath { pub pts: Vec<VPt>, pub closed: bool }

type P = (f64, f64);
fn sub(a: P, b: P) -> P { (a.0 - b.0, a.1 - b.1) }
fn add(a: P, b: P) -> P { (a.0 + b.0, a.1 + b.1) }
fn mul(a: P, k: f64) -> P { (a.0 * k, a.1 * k) }
fn dot(a: P, b: P) -> f64 { a.0 * b.0 + a.1 * b.1 }
fn len(a: P) -> f64 { dot(a, a).sqrt() }
fn dist(a: P, b: P) -> f64 { len(sub(a, b)) }
fn norm(a: P) -> P { let l = len(a); if l < 1e-12 { (0.0, 0.0) } else { (a.0 / l, a.1 / l) } }

// ---------------------------------------------------------------- 1. boundary tracing
const DX: [i32; 4] = [1, 0, -1, 0]; // E S W N (y grows downwards)
const DY: [i32; 4] = [0, 1, 0, -1];

/// Closed boundaries of the mask as lists of pixel-corner vertices (only where the direction changes).
fn trace(mask: &[bool], w: usize, h: usize) -> Vec<Vec<P>> {
    let inside = |x: i32, y: i32| -> bool { x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h && mask[y as usize * w + x as usize] };
    let vw = w + 1;
    let mut out = vec![0u8; vw * (h + 1)];
    for y in 0..h as i32 { for x in 0..w as i32 {
        if !inside(x, y) { continue; }
        if !inside(x, y - 1) { out[y as usize * vw + x as usize] |= 1 << 0; }         // top: (x,y) → (x+1,y)
        if !inside(x + 1, y) { out[y as usize * vw + x as usize + 1] |= 1 << 1; }     // right: (x+1,y) → (x+1,y+1)
        if !inside(x, y + 1) { out[(y as usize + 1) * vw + x as usize + 1] |= 1 << 2; } // bottom: (x+1,y+1) → (x,y+1)
        if !inside(x - 1, y) { out[(y as usize + 1) * vw + x as usize] |= 1 << 3; }   // left: (x,y+1) → (x,y)
    } }
    let mut loops = vec![];
    for vy in 0..=h { for vx in 0..=w {
        while out[vy * vw + vx] != 0 {
            let d0 = (0..4).find(|d| out[vy * vw + vx] & (1 << d) != 0).unwrap();
            let (mut x, mut y, mut d) = (vx as i32, vy as i32, d0);
            let mut pts: Vec<P> = vec![];
            let mut last_dir = usize::MAX;
            loop {
                out[y as usize * vw + x as usize] &= !(1 << d);
                if d != last_dir { pts.push((x as f64, y as f64)); last_dir = d; }
                x += DX[d]; y += DY[d];
                if x == vx as i32 && y == vy as i32 { break; }
                // next edge at this vertex: turn left, else straight, else right (keeps diagonal pixels apart)
                let m = out[y as usize * vw + x as usize];
                let pick = [(d + 3) % 4, d, (d + 1) % 4].into_iter().find(|nd| m & (1 << nd) != 0);
                match pick { Some(nd) => d = nd, None => break }
            }
            if pts.len() >= 3 { loops.push(pts); }
        }
    } }
    loops
}

fn area(p: &[P]) -> f64 {
    let mut s = 0.0;
    for i in 0..p.len() { let (a, b) = (p[i], p[(i + 1) % p.len()]); s += a.0 * b.1 - b.0 * a.1; }
    s / 2.0
}

// ---------------------------------------------------------------- 2. Douglas-Peucker (closed polygon, keeps indices)
fn seg_dist(p: P, a: P, b: P) -> f64 {
    let ab = sub(b, a);
    let l2 = dot(ab, ab);
    if l2 < 1e-12 { return dist(p, a); }
    let t = (dot(sub(p, a), ab) / l2).clamp(0.0, 1.0);
    dist(p, add(a, mul(ab, t)))
}
fn dp_open(p: &[P], lo: usize, hi: usize, eps: f64, keep: &mut Vec<bool>) {
    if hi <= lo + 1 { return; }
    let (mut mi, mut md) = (lo, 0.0);
    for i in lo + 1..hi { let d = seg_dist(p[i], p[lo], p[hi]); if d > md { md = d; mi = i; } }
    if md > eps { keep[mi] = true; dp_open(p, lo, mi, eps, keep); dp_open(p, mi, hi, eps, keep); }
}
/// Indices of the vertices that stay when the closed polygon is simplified within `eps`.
fn dp_closed(p: &[P], eps: f64) -> Vec<usize> {
    let n = p.len();
    // anchor points: the vertex 0 and the one farthest from it
    let far = (0..n).max_by(|&a, &b| dist(p[a], p[0]).partial_cmp(&dist(p[b], p[0])).unwrap()).unwrap_or(0);
    let mut keep = vec![false; n];
    keep[0] = true; keep[far] = true;
    let mut a: Vec<P> = p[..=far].to_vec();
    let mut k1 = vec![false; a.len()];
    dp_open(&a, 0, a.len() - 1, eps, &mut k1);
    for (i, k) in k1.iter().enumerate() { if *k { keep[i] = true; } }
    a = p[far..].iter().cloned().chain(std::iter::once(p[0])).collect();
    let mut k2 = vec![false; a.len()];
    dp_open(&a, 0, a.len() - 1, eps, &mut k2);
    for (i, k) in k2.iter().enumerate() { if *k && far + i < n { keep[far + i] = true; } }
    (0..n).filter(|&i| keep[i]).collect()
}

// ---------------------------------------------------------------- 3. smoothing and Bézier fitting (Schneider)
/// Points every ~1 px along the polyline (the ends stay exactly where they are).
fn resample(p: &[P], step: f64) -> Vec<P> {
    let mut out = vec![p[0]];
    let mut carry = 0.0;
    for w in p.windows(2) {
        let (a, b) = (w[0], w[1]);
        let l = dist(a, b);
        let mut s = step - carry;
        while s < l { out.push(add(a, mul(sub(b, a), s / l))); s += step; }
        carry = l - (s - step);
    }
    if dist(*out.last().unwrap(), *p.last().unwrap()) > 1e-9 { out.push(*p.last().unwrap()); }
    out
}
fn smooth(p: &mut Vec<P>, rounds: usize, closed: bool) {
    let n = p.len();
    if n < 5 { return; }
    for _ in 0..rounds {
        let src = p.clone();
        for i in 0..n {
            if !closed && (i < 2 || i + 2 >= n) { continue; }
            let g = |k: i32| src[((i as i32 + k).rem_euclid(n as i32)) as usize];
            let s = add(add(add(mul(g(0), 3.0), add(g(-1), g(1))), mul(add(g(-2), g(2)), 0.5)), (0.0, 0.0));
            p[i] = mul(s, 1.0 / 6.0);
        }
    }
}

fn bez(c: &[P; 4], t: f64) -> P {
    let m = 1.0 - t;
    add(add(mul(c[0], m * m * m), mul(c[1], 3.0 * m * m * t)), add(mul(c[2], 3.0 * m * t * t), mul(c[3], t * t * t)))
}
fn bez1(c: &[P; 4], t: f64) -> P {
    let m = 1.0 - t;
    add(add(mul(sub(c[1], c[0]), 3.0 * m * m), mul(sub(c[2], c[1]), 6.0 * m * t)), mul(sub(c[3], c[2]), 3.0 * t * t))
}
fn bez2(c: &[P; 4], t: f64) -> P {
    let m = 1.0 - t;
    add(mul(add(sub(c[2], mul(c[1], 2.0)), c[0]), 6.0 * m), mul(add(sub(c[3], mul(c[2], 2.0)), c[1]), 6.0 * t))
}

fn chord_params(d: &[P]) -> Vec<f64> {
    let mut u = vec![0.0];
    for i in 1..d.len() { let l = u[i - 1] + dist(d[i], d[i - 1]); u.push(l); }
    let t = *u.last().unwrap();
    if t > 0.0 { for v in u.iter_mut() { *v /= t; } }
    u
}
fn generate(d: &[P], u: &[f64], t1: P, t2: P) -> [P; 4] {
    let (first, last) = (d[0], *d.last().unwrap());
    let (mut c00, mut c01, mut c11, mut x0, mut x1) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for i in 0..d.len() {
        let t = u[i];
        let (b1, b2) = (3.0 * (1.0 - t) * (1.0 - t) * t, 3.0 * (1.0 - t) * t * t);
        let (a1, a2) = (mul(t1, b1), mul(t2, b2));
        c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
        let (b0, b3) = ((1.0 - t).powi(3), t.powi(3));
        let tmp = sub(d[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
        x0 += dot(a1, tmp); x1 += dot(a2, tmp);
    }
    let det = c00 * c11 - c01 * c01;
    let seg = dist(first, last);
    let eps = 1e-6 * seg;
    let (mut al, mut ar) = if det.abs() > 1e-12 { ((x0 * c11 - x1 * c01) / det, (c00 * x1 - c01 * x0) / det) } else { (0.0, 0.0) };
    if al < eps || ar < eps { al = seg / 3.0; ar = seg / 3.0; }
    [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last]
}
fn reparam(c: &[P; 4], d: &[P], u: &[f64]) -> Vec<f64> {
    d.iter().zip(u).map(|(p, &t)| {
        let diff = sub(bez(c, t), *p);
        let (d1, d2) = (bez1(c, t), bez2(c, t));
        let num = dot(diff, d1);
        let den = dot(d1, d1) + dot(diff, d2);
        if den.abs() < 1e-12 { t } else { (t - num / den).clamp(0.0, 1.0) }
    }).collect()
}
fn max_err(c: &[P; 4], d: &[P], u: &[f64]) -> (f64, usize) {
    let (mut m, mut at) = (0.0, d.len() / 2);
    for i in 1..d.len() - 1 { let e = dist(bez(c, u[i]), d[i]); if e >= m { m = e; at = i; } }
    (m, at)
}
fn fit(d: &[P], t1: P, t2: P, err: f64, out: &mut Vec<[P; 4]>) {
    if d.len() == 2 {
        let l = dist(d[0], d[1]) / 3.0;
        out.push([d[0], add(d[0], mul(t1, l)), add(d[1], mul(t2, l)), d[1]]);
        return;
    }
    let mut u = chord_params(d);
    let mut c = generate(d, &u, t1, t2);
    let (mut e, mut split) = max_err(&c, d, &u);
    if e < err { out.push(c); return; }
    if e < err * 4.0 {
        for _ in 0..4 {
            u = reparam(&c, d, &u);
            c = generate(d, &u, t1, t2);
            let r = max_err(&c, d, &u);
            e = r.0; split = r.1;
            if e < err { out.push(c); return; }
        }
    }
    let split = split.clamp(1, d.len() - 2);
    let tc = norm(sub(d[split - 1], d[split + 1]));
    fit(&d[..=split], t1, tc, err, out);
    fit(&d[split..], mul(tc, -1.0), t2, err, out);
}

/// Anchors (with handles) for an open sequence of dense points; straight runs become plain lines.
fn fit_section(q: &[P], t1: P, t2: P, tol: f64) -> Vec<[P; 4]> {
    let (a, b) = (q[0], *q.last().unwrap());
    let straight = q.iter().all(|&p| seg_dist(p, a, b) < tol * 0.5);
    if straight {
        // a line as a degenerate Bézier (handles on the line, recognised below)
        return vec![[a, a, b, b]];
    }
    let mut out = vec![];
    fit(q, t1, t2, tol, &mut out);
    out
}

fn to_path(segs: &[[P; 4]], closed: bool) -> VPath {
    let r = |v: f64| (v * 10.0).round() / 10.0;
    let mut pts: Vec<VPt> = vec![VPt { x: r(segs[0][0].0), y: r(segs[0][0].1), ix: None, iy: None, ox: None, oy: None }];
    for (k, s) in segs.iter().enumerate() {
        let line = s[1] == s[0] && s[2] == s[3];
        if !line { let last = pts.last_mut().unwrap(); last.ox = Some(r(s[1].0)); last.oy = Some(r(s[1].1)); }
        let mut p = VPt { x: r(s[3].0), y: r(s[3].1), ix: None, iy: None, ox: None, oy: None };
        if !line { p.ix = Some(r(s[2].0)); p.iy = Some(r(s[2].1)); }
        if closed && k + 1 == segs.len() {
            // the last anchor is the first one again: its in-handle goes there
            let f = &mut pts[0];
            f.ix = p.ix; f.iy = p.iy;
            break;
        }
        pts.push(p);
    }
    VPath { pts, closed }
}

fn corner_angle(a: P, b: P, c: P) -> f64 {
    let (u, v) = (norm(sub(b, a)), norm(sub(c, b)));
    dot(u, v).clamp(-1.0, 1.0).acos().to_degrees()
}

fn vectorize_loop(raw: &[P], tol: f64, corner: f64) -> Option<VPath> {
    // simplified polygon: straight lines where the mask edge is straight, corners where it turns sharply
    let idx = dp_closed(raw, (tol * 0.6).max(0.9));
    let m = idx.len();
    if m < 3 { return None; }
    let poly: Vec<P> = idx.iter().map(|&i| raw[i]).collect();
    // sharp corners: angle between the straight lines before and after the vertex
    let sharp: Vec<bool> = (0..m).map(|i| corner_angle(poly[(i + m - 1) % m], poly[i], poly[(i + 1) % m]) > corner && dist(poly[i], poly[(i + m - 1) % m]) > 3.0 && dist(poly[i], poly[(i + 1) % m]) > 3.0).collect();
    let corners: Vec<usize> = (0..m).filter(|&i| sharp[i]).collect();
    let mut segs: Vec<[P; 4]> = vec![];
    let dense = |a: usize, b: usize, closed_wrap: bool| -> Vec<P> {
        // raw points from vertex idx[a] to idx[b] (going forward, wrapping)
        let n = raw.len();
        let (s, e) = (idx[a], idx[b]);
        let mut v = vec![];
        let mut i = s;
        loop { v.push(raw[i]); if i == e && (v.len() > 1 || !closed_wrap) { break; } i = (i + 1) % n; if v.len() > n + 1 { break; } }
        v
    };
    if corners.is_empty() {
        // a smooth closed curve: start anywhere, tangents from the neighbours around the start
        let mut q = resample(&{ let mut c = raw.to_vec(); c.push(raw[0]); c }, 1.0);
        q.pop();
        smooth(&mut q, 3, true);
        let n = q.len();
        if n < 8 { return None; }
        let mut closed = q.clone();
        closed.push(q[0]);
        let t1 = norm(sub(q[1], q[n - 1]));
        let t2 = norm(sub(q[n - 1], q[1]));
        let mut out = vec![];
        fit(&closed, t1, t2, tol, &mut out);
        return Some(to_path(&out, true));
    }
    for k in 0..corners.len() {
        let (a, b) = (corners[k], corners[(k + 1) % corners.len()]);
        let mut pts = dense(a, b, corners.len() == 1);
        if pts.len() < 2 { continue; }
        let straight_poly = (a + 1) % m == b; // no vertex in between: a straight edge
        let mut q = if straight_poly { vec![pts[0], *pts.last().unwrap()] } else { let r = resample(&pts, 1.0); r };
        if !straight_poly { smooth(&mut q, 2, false); pts = q.clone(); }
        let n = q.len();
        if n < 2 { continue; }
        let t1 = norm(sub(q[(1).min(n - 1)], q[0]));
        let t2 = norm(sub(q[n.saturating_sub(2)], q[n - 1]));
        segs.extend(fit_section(&q, t1, t2, tol));
        let _ = &pts;
    }
    if segs.is_empty() { None } else { Some(to_path(&segs, true)) }
}

/// Vectorizes the mask (`true` = inside). Paths are in pixel coordinates; even-odd filling gives the holes.
pub fn vectorize(mask: &[bool], w: usize, h: usize, o: &VOpts) -> Vec<VPath> {
    let tol = o.tolerance.unwrap_or(2.0).clamp(0.3, 12.0);
    let min_area = o.min_area.unwrap_or(120.0).max(4.0);
    let corner = o.corner.unwrap_or(50.0).clamp(15.0, 150.0);
    trace(mask, w, h).into_iter()
        .filter(|l| area(l).abs() >= min_area)
        .filter_map(|l| vectorize_loop(&l, tol, corner))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const N: usize = 512;
    fn grid(f: impl Fn(f64, f64) -> bool) -> Vec<bool> { (0..N * N).map(|i| f((i % N) as f64 + 0.5, (i / N) as f64 + 0.5)).collect() }

    fn flatten(p: &VPath) -> Vec<P> {
        let mut out = vec![];
        let n = p.pts.len();
        for i in 0..n {
            let (a, b) = (&p.pts[i], &p.pts[(i + 1) % n]);
            if a.ox.is_some() || b.ix.is_some() {
                let c = [(a.x, a.y), (a.ox.unwrap_or(a.x), a.oy.unwrap_or(a.y)), (b.ix.unwrap_or(b.x), b.iy.unwrap_or(b.y)), (b.x, b.y)];
                for s in 0..16 { out.push(bez(&c, s as f64 / 16.0)); }
            } else { out.push((a.x, a.y)); }
        }
        out
    }
    /// even-odd raster of the paths, compared with the mask: intersection over union
    fn iou(paths: &[VPath], mask: &[bool]) -> f64 {
        let polys: Vec<Vec<P>> = paths.iter().map(flatten).collect();
        let (mut i, mut u) = (0usize, 0usize);
        for y in 0..N {
            let yy = y as f64 + 0.5;
            let mut xs: Vec<f64> = vec![];
            for p in &polys { for k in 0..p.len() {
                let (a, b) = (p[k], p[(k + 1) % p.len()]);
                if (a.1 <= yy) != (b.1 <= yy) { xs.push(a.0 + (yy - a.1) / (b.1 - a.1) * (b.0 - a.0)); }
            } }
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            for x in 0..N {
                let xx = x as f64 + 0.5;
                let inside = xs.iter().filter(|&&v| v < xx).count() % 2 == 1;
                let m = mask[y * N + x];
                if inside && m { i += 1; }
                if inside || m { u += 1; }
            }
        }
        i as f64 / u.max(1) as f64
    }

    #[test]
    fn circle_is_a_few_curves() {
        let m = grid(|x, y| (x - 256.0).powi(2) + (y - 250.0).powi(2) < 180.0 * 180.0);
        let v = vectorize(&m, N, N, &VOpts::default());
        assert_eq!(v.len(), 1);
        assert!(v[0].pts.len() <= 24, "{} nodes", v[0].pts.len());
        assert!(iou(&v, &m) > 0.985, "iou {}", iou(&v, &m));
        // a tighter tolerance follows the edge closer (with more nodes)
        let t = vectorize(&m, N, N, &VOpts { tolerance: Some(0.7), ..Default::default() });
        assert!(iou(&t, &m) > 0.995, "tight iou {}", iou(&t, &m));
        assert!(t[0].pts.len() > v[0].pts.len());
    }

    #[test]
    fn rectangle_keeps_its_corners() {
        let m = grid(|x, y| (100.0..400.0).contains(&x) && (80.0..300.0).contains(&y));
        let v = vectorize(&m, N, N, &VOpts::default());
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].pts.len(), 4, "{:?}", v[0].pts);
        assert!(v[0].pts.iter().all(|p| p.ox.is_none() && p.ix.is_none()), "straight edges stay lines");
        assert!(iou(&v, &m) > 0.998);
    }

    #[test]
    fn ring_has_a_hole_and_specks_go() {
        let m = grid(|x, y| { let d = ((x - 256.0).powi(2) + (y - 256.0).powi(2)).sqrt(); (90.0..200.0).contains(&d) || ((x - 20.0).abs() < 2.0 && (y - 20.0).abs() < 2.0) });
        let v = vectorize(&m, N, N, &VOpts::default());
        assert_eq!(v.len(), 2, "outer + hole, speck removed");
        assert!(iou(&v, &m) > 0.98, "iou {}", iou(&v, &m));
    }

    #[test]
    fn a_wavy_blob_stays_within_tolerance() {
        let m = grid(|x, y| { let a = (y - 256.0).atan2(x - 256.0); let r = 170.0 + 30.0 * (5.0 * a).sin(); ((x - 256.0).powi(2) + (y - 256.0).powi(2)).sqrt() < r });
        let v = vectorize(&m, N, N, &VOpts::default());
        assert_eq!(v.len(), 1);
        assert!(v[0].pts.len() < 80, "{} nodes", v[0].pts.len());
        assert!(iou(&v, &m) > 0.98, "iou {}", iou(&v, &m));
    }

    #[test]
    fn an_empty_mask_gives_nothing() {
        assert!(vectorize(&vec![false; N * N], N, N, &VOpts::default()).is_empty());
    }
}
