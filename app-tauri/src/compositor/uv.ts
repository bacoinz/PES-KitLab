/**
 * PES 2021 / Football Life kit texture map (2048 × 2048). Measured on the game's own models (dt35_g4.cpk) and textures:
 *  - torso: x 704..1344. Front is upright below the shoulder seam (y 960 → hem ~1870); the back is the same body
 *    rotated 180° above it (y 960 → 0). Player's left side is texture x > 1024 on both front and back.
 *  - short sleeves: x 420..760 (shoulder at 760, cuff ~490) and mirrored; y 684..1218 around the arm
 *  - long sleeves: top corners, x 7..691 (shoulder ≈690, cuff at 7), tapered, y 134..650
 *  - socks: x 10..370 and 1678..2038, y 640..1150 (top band at the top)
 *  - shorts: x 33..640 (right leg, hem at 33, waist at 640) and 1408..2015 (left leg), y 1167..1946
 *  (re-measured on the CometKITpreviewer models, which share this layout with the game)
 *  - collar: x 664..1384, y 1866..2034   - captain armband: x 0..512, y 0..128
 */
export const S = 2048
export const SEAM = 960
export const TORSO = { x0: 704, x1: 1344, hem: 1960 }
export type Pt = [number, number]
export const mirrorX = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [S - x, y])
export const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

// Comet models (2026-11): shorts island x 33..640, y 1167..1946; the top steps down 1167 → 1254 between x 265 and 345
// bleed up to x 700 (the torso starts at 704) so mip-mapping at the waist never picks up shirt colours
const SHORTS_POLY: Pt[] = [[0, 1160], [265, 1160], [300, 1236], [345, 1250], [700, 1250], [700, 1964], [0, 1964]]
/** Long sleeves are a taper: cuff x≈7 spans y 218..566, shoulder x≈640 spans y 134..647 (socks only use x ≤ 370). */
const LONG_SLEEVE: Pt[] = [[0, 128], [700, 128], [700, 656], [640, 656], [0, 576]]
/** Short sleeve island, measured on the game's sleeve_short_001 UVs: the shoulder end is the curved sleeve cap
 *  that reaches x ≈ 761 (a straight edge at 704 left the cap with the shirt's design: stripes looked short). Only the
 *  part over the top of the arm: towards the armpit those texels show on the side of the shirt. */
const SLEEVE: Pt[] = [[420, 684], [670, 684], [704, 693], [710, 740], [728, 790], [752, 840], [760, 880], [762, 932], [764, 1008], [763, 1050], [754, 1090], [730, 1130], [710, 1170], [704, 1211], [665, 1218], [420, 1218]]
/** Strip shared by the sleeve cap and the torso side (under the arm / shoulder): x 704..760 and 1288..1344. */
/** Raglan shoulders: armpit (side of the torso) → neckline, front (below the seam) and back (above it). */
const RAGLAN_F: Pt[] = [[640, 960], [932, 960], [640, 1240]]
const RAGLAN_B: Pt[] = [[640, 960], [932, 960], [640, 680]]
export const SHOULDER_STRIP: Pt[][] = [RAGLAN_F, mirrorX(RAGLAN_F), RAGLAN_B, mirrorX(RAGLAN_B)]

export const REGIONS: Record<string, Pt[][]> = {
  // long sleeves taper down to y ≈ 650 near the shoulder; the socks (x ≤ 370, y ≥ 640) never meet them
  longSleeves: [LONG_SLEEVE, mirrorX(LONG_SLEEVE)],
  socks: [rect(0, 630, 400, 1160), mirrorX(rect(0, 630, 400, 1160))],
  sockBand: [rect(0, 630, 380, 724), mirrorX(rect(0, 630, 380, 724))],
  sleeves: [SLEEVE, mirrorX(SLEEVE)],
  cuffs: [rect(444, 692, 512, 1210), mirrorX(rect(444, 692, 512, 1210))],
  longCuffs: [rect(0, 128, 60, 636), mirrorX(rect(0, 128, 60, 636))],
  // shorts have a notch at the top: the underside of the short sleeves uses x 420..704, y up to 1218
  shorts: [SHORTS_POLY, mirrorX(SHORTS_POLY)],
  collar: [rect(664, 1866, 1384, 2034)], // some collar models sample down to y ≈2031 (see KIT Template.png)
  armband: [rect(0, 0, 512, 128)]
}

/** Sleeve axes: shoulder→cuff along x. */
export const SLEEVE_AXES = {
  short: [{ a: 762, b: 490, top: 952, y0: 684, y1: 1218 }, { a: 1286, b: 1558, top: 952, y0: 684, y1: 1218 }],
  // top of the arm measured on the game's sleeve models: short v ≈ 947, long v ≈ 400
  // long: where it meets the shirt the long sleeve's v is the shirt's v − 560 (measured on the armhole: 950 → 390)
  long: [{ a: 700, b: 8, top: 392, y0: 128, y1: 656 }, { a: 1348, b: 2040, top: 392, y0: 128, y1: 656 }]
}

/** Shorts legs: hem→waist along x; front of the leg around y≈1750, outer side line y≈1590. */
export const LEGS = [
  { x0: 0, x1: 672, hem: 33, waist: 640, rot: Math.PI / 2, dir: 1 },
  { x0: 1376, x1: 2048, hem: 2015, waist: 1408, rot: -Math.PI / 2, dir: -1 }
]

/**
 * Shorts island frame, measured on the Comet models (same for both legs; x mirrors). x runs along the leg
 * (waist → hem), y runs around it: back ≈1370, outer side ≈1590, front ≈1745. Seams (island edges):
 *  - inner leg: y 1167 / 1946 for x < 265 (the two edges meet on the inside of the thigh)
 *  - back centre (bum) seam: the notch edge y ≈1254, x 345..640 → a back sponsor straddles this edge on both legs
 *  - front centre (fly) seam: bottom edge y ≈1888, x 340..640
 */
export const SHORTS_FRAME = { back: 1370, side: 1590, front: 1745, innerTop: 1167, innerBottom: 1946, bumSeam: 1254, flySeam: 1888, notchX0: 265, notchX1: 345 }

/** Socks: x runs around the leg, y along it (top 640 → foot 1150). Seam at the back-inner edge of each island. */
export const SOCK_FRAME = [
  { front: 264, outer: 178, inner: 350, back: 75, x0: 10, x1: 370 }, // player's right leg
  { front: 1780, outer: 1872, inner: 1705, back: 1966, x0: 1678, x1: 2038 } // player's left leg
]
export const SHORTS_SIDE_Y = 1590
export const SHORTS_FRONT_Y = 1745

/** Default logo spots (centre x, y) and whether they sit on the back (rotated 180°) or a rotated shorts leg. */
export const SPOTS = {
  crest: { x: 1151, y: 1126, rot: 0 },
  brand: { x: 895, y: 1131, rot: 0 },
  sponsor: { x: 1024, y: 1338, rot: 0 },
  backSponsor: { x: 1024, y: 366, rot: Math.PI },
  sleeveBadge: [{ x: 578, y: 975, rot: Math.PI / 2 }, { x: 1470, y: 975, rot: -Math.PI / 2 }],
  shortsCrest: { x: 1898, y: 1745, rot: -Math.PI / 2 },
  shortsBrand: { x: 150, y: 1745, rot: Math.PI / 2 },
  socksBrand: [{ x: 280, y: 935, rot: 0 }, { x: 1768, y: 935, rot: 0 }]
}

/** Rectangles the "clean logos" tool fills when a real game kit is used as base. */
export const CLEAN_RECTS: Record<string, [number, number, number, number][]> = {
  crest: [[1066, 1036, 1236, 1216], [968, 846, 1080, 952], [978, 968, 1092, 1062]],
  brand: [[810, 1046, 980, 1216], [748, 1772, 832, 1828], [1118, 1776, 1204, 1824]],
  sponsor: [[832, 1196, 1216, 1480]],
  sleeves: [[1400, 890, 1540, 1060], [508, 890, 648, 1060], [1448, 330, 1562, 462], [486, 330, 600, 462]],
  back: [[800, 292, 1248, 440]],
  shorts: [[40, 1600, 250, 1800], [1798, 1600, 2008, 1800]],
  socks: [[196, 790, 364, 1080], [1684, 790, 1852, 1080]]
}

export function pathOf(polys: Pt[][]): Path2D {
  const p = new Path2D()
  for (const pl of polys) {
    p.moveTo(pl[0][0], pl[0][1])
    for (const [x, y] of pl.slice(1)) p.lineTo(x, y)
    p.closePath()
  }
  return p
}

/** Which kit part a texel belongs to (used for part-aware recolouring of imported kits). */
export function partAt(x: number, y: number): 'shirt' | 'sleeves' | 'shorts' | 'socks' | 'collar' {
  if (y >= 1866 && y < 2034 && x >= 664 && x < 1384) return 'collar'
  if (y >= 1160 && y < 1964 && (x < 672 || x >= 1376)) return 'shorts'
  if (y >= 630 && y < 1160 && (x < 400 || x >= 1648)) return 'socks'
  if ((y >= 684 && y < 1218 && ((x >= 420 && x < 760) || (x >= 1288 && x < 1628))) || (y >= 128 && y < 656 && (x < 700 || x >= 1348))) return 'sleeves'
  return 'shirt'
}

/**
 * Underarm seam of each sleeve island (measured on the Comet models; the right sleeve mirrors x): the top edge and
 * the bottom edge are the same seam in 3D, so whatever crosses one edge continues from the other.
 * Each entry: [shoulder x, top y, bottom y] and [cuff x, top y, bottom y], linear in between.
 */
export const SLEEVE_SEAMS = {
  short: [[704, 694, 1209], [490, 734, 1170]],
  long: [[634, 134, 649], [8, 222, 562]]
}
export function sleeveSeam(x: number, y: number): { top: number; bottom: number } | null {
  const lx = x > 1024 ? S - x : x
  const s = y < 670 ? SLEEVE_SEAMS.long : SLEEVE_SEAMS.short
  const [[xa, ta, ba], [xb, tb, bb]] = s
  if (lx > xa + 60 || lx < xb - 60) return null
  const t = Math.max(0, Math.min(1, (lx - xa) / (xb - xa)))
  return { top: ta + (tb - ta) * t, bottom: ba + (bb - ba) * t }
}

/**
 * Garment panels (measured on the Comet shirt): the torso's side seam is the island's outer edge, x 704 (and 1344),
 * on both the front (y > 1220) and the back (y < 700); between them the strip x 704..760 is the underarm, shared with
 * the sleeve. The shoulder seam is y = 960 (armhole x ≈760 → neck x ≈888). The neck hole (texels the collar model
 * reuses) is NECK_HOLE. Sleeve tops run along y 952 (short) and 410 (long).
 */
/** armpitF / armpitB: where the side seam meets the armhole on the front (below SEAM) and on the back (above it). */
/**
 * Side seam of the game's shirt (shirt_out.fmdl): a front texel (x, y) touches the back texel (x, BACK_AXIS·2 − y)
 * (measured: v_front + v_back = 1903.5 all the way down, armpit 1228 ↔ 675). The back of a design is mirrored about
 * this line, not about SEAM, so hoops / checks / gradients meet at the sides.
 */
export const BACK_AXIS = 951.75
export const backY = (y: number): number => 2 * BACK_AXIS - y
export const PANEL = { armpitF: 1228, armpitB: 675, side: 704, shoulderY: SEAM, shortTop: 952, longTop: 392, shortCuff: 490, longCuff: 8, shortShoulder: 760, longShoulder: 700 }
export const NECK_HOLE: Pt[] = [[903, 900], [1136, 900], [1151, 920], [1155, 960], [1156, 1070], [889, 1070], [888, 960], [893, 920]]
