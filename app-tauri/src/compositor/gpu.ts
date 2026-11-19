/**
 * WebGL2 kit compositor. A kit texture is a list of passes drawn into a 2048² render target:
 *  - fill:  solid or gradient colour, optionally through a cached mask (patterns, shapes, text…)
 *  - image: an image/logo placed with an affine transform (tint, black & white, outline in the shader)
 *  - rgba:  a full-texture RGBA overlay (imported kit, fabric seams, preview names…)
 *  - tile:  a repeating fabric tile
 * Every pass is clipped to a kit region using a per-texel region map. Colour math happens in sRGB like Canvas2D,
 * so the result matches the old CPU compositor. Masks/images are cached on the GPU: changing a colour or moving a
 * logo only re-runs the passes (a few ms), with no CPU raster work.
 */
import type { Fill } from '../model/design'
import { hexToRgb } from '../model/design'
import { S, SEAM, TORSO, REGIONS, SHOULDER_STRIP, pathOf } from './uv'

// ---------------------------------------------------------------- public pass description
export type Clip = 'all' | 'torso' | 'front' | 'back' | 'sleeves' | 'shorts' | 'socks' | 'collar' | 'armband' | 'cuffs' | 'zones'
export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'darken' | 'lighten' | 'difference' | string

export interface MaskSrc { key: string; draw: (g: OffscreenCanvasRenderingContext2D) => void; zones?: boolean }
export type ImageSource = ImageBitmap | OffscreenCanvas | HTMLCanvasElement
export interface ImagePlacement {
  img: ImageSource
  /** texture px → image px affine: centre, size (px in texture), rotation (rad) */
  cx: number; cy: number; w: number; h: number; rot: number
  tint?: 'original' | 'color' | 'bw'
  color?: string
  outlineColor?: string
  outlineWidth?: number // texture px
}

export type Pass =
  | { t: 'fill'; fill: Fill; mask?: MaskSrc; mask2?: MaskSrc; mask2Invert?: boolean; clip: Clip; zoneSel?: [number, number, number]; opacity?: number; blend?: Blend; s2s?: boolean }
  | { t: 'image'; place: ImagePlacement; clip: Clip; zoneSel?: [number, number, number]; opacity?: number; blend?: Blend }
  | { t: 'rgba'; key: string; img: ImageSource | (() => ImageSource); clip: Clip; zoneSel?: [number, number, number]; opacity?: number; blend?: Blend; mask2?: MaskSrc; mask2Invert?: boolean }
  | { t: 'remap'; key: string; data: Uint8Array; clip: Clip; zoneSel?: [number, number, number]; opacity?: number; blend?: Blend }
  | { t: 'tile'; key: string; img: ImageSource; scale: number; clip: Clip; zoneSel?: [number, number, number]; opacity?: number; blend?: Blend }

// ---------------------------------------------------------------- GL plumbing
const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D u_map, u_dst, u_src, u_mask2;
uniform int u_mask2Mode;     // 0 none, 1 clip to another layer's mask, 2 inverted
uniform bool u_mask2Zones;
uniform vec2 u_size;          // target size in px
uniform int u_type;           // 0 fill, 1 image, 2 rgba, 3 tile, 9 copy
uniform int u_clip;
uniform vec3 u_zoneSel;
uniform bool u_s2s;           // sleeve design continues over the shoulder (raglan)
uniform int u_maskMode;       // 0 none, 1 red, 2 zone channels
uniform float u_opacity;
uniform int u_blend;
// fill
uniform bool u_grad; uniform vec3 u_color; uniform int u_nStops; uniform vec3 u_stopC[8]; uniform float u_stopAt[8]; uniform vec2 u_dir;
uniform vec3 u_frA[12]; uniform vec3 u_frB[12]; uniform vec2 u_frS[12];
// image
uniform vec3 u_imA; uniform vec3 u_imB; uniform int u_tint; uniform vec3 u_tintC; uniform vec2 u_olR; uniform vec3 u_olC; uniform bool u_ol;
// tile
uniform float u_tileScale; uniform vec2 u_tileSize;
out vec4 o;

float has(uint bits, uint b) { return (bits & b) != 0u ? 1.0 : 0.0; }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float aAt(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture(u_src, uv).a; }

// non-separable modes (W3C compositing): hue, saturation, color, luminosity
float lumW(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipC(vec3 c) {
  float l = lumW(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipC(c + (l - lumW(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  return x > n ? (c - n) * s / (x - n) : vec3(0.0);
}
vec3 nonSep(vec3 b, vec3 s) {
  if (u_blend == 12) return setLum(setSat(s, sat(b)), lumW(b));
  if (u_blend == 13) return setLum(setSat(b, sat(s)), lumW(b));
  if (u_blend == 14) return setLum(s, lumW(b));
  return setLum(b, lumW(s));
}

vec3 blendC(vec3 b, vec3 s) {
  if (u_blend == 1) return b * s;
  if (u_blend == 2) return b + s - b * s;
  if (u_blend == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));          // overlay
  if (u_blend == 4) {                                                                                 // soft-light (W3C)
    vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  if (u_blend == 5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));          // hard-light
  if (u_blend == 6) return min(b, s);
  if (u_blend == 7) return max(b, s);
  if (u_blend == 8) return abs(b - s);
  if (u_blend == 9) return mix(min(vec3(1.0), b / max(1.0 - s, vec3(1e-5))), vec3(1.0), step(1.0, s)) * step(1e-5, b); // color-dodge
  if (u_blend == 10) return mix(1.0 - min(vec3(1.0), (1.0 - b) / max(s, vec3(1e-5))), vec3(0.0), step(s, vec3(0.0))) * (1.0 - step(1.0 - 1e-5, b)) + step(1.0 - 1e-5, b); // color-burn
  if (u_blend == 11) return b + s - 2.0 * b * s;                                                       // exclusion
  if (u_blend >= 12) return nonSep(b, s);
  return s;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) * (${S}.0 / u_size); // texture px, y down
  vec2 uv = px / ${S}.0;
  if (u_type == 9) { o = texture(u_dst, vec2(gl_FragCoord.xy / u_size)); return; }
  vec4 m = texture(u_map, uv);
  uint bits = uint(m.r * 255.0 + 0.5);
  float isSleeve = max(has(bits, 4u), u_s2s ? has(bits, 8u) : 0.0);
  vec3 zoneW = vec3(has(bits, 1u) * (1.0 - isSleeve), has(bits, 2u) * (1.0 - isSleeve), isSleeve);
  float w = 1.0;
  if (u_clip == 1) w = zoneW.x + zoneW.y;
  else if (u_clip == 2) w = zoneW.x;
  else if (u_clip == 3) w = zoneW.y;
  else if (u_clip == 4) w = zoneW.z;
  else if (u_clip == 5) w = has(bits, 16u);
  else if (u_clip == 6) w = has(bits, 32u);
  else if (u_clip == 7) w = has(bits, 64u);
  else if (u_clip == 8) w = has(bits, 128u);
  else if (u_clip == 9) w = m.g > 0.5 ? 1.0 : 0.0;
  else if (u_clip == 10) w = dot(zoneW, u_zoneSel);
  if (w <= 0.0) discard;

  vec4 src = vec4(0.0);
  if (u_type == 0) {
    float mk = 1.0;
    if (u_maskMode == 1) mk = texture(u_src, uv).r;
    else if (u_maskMode == 2) mk = clamp(dot(texture(u_src, uv).rgb, zoneW), 0.0, 1.0);
    if (u_mask2Mode > 0) { vec4 q = texture(u_mask2, uv); float m2 = u_mask2Zones ? clamp(dot(q.rgb, zoneW), 0.0, 1.0) : q.r; mk *= u_mask2Mode == 2 ? 1.0 - m2 : m2; }
    if (mk <= 0.0) discard;
    vec3 c = u_color;
    if (u_grad) {
      int f = int(((u_s2s && has(bits, 8u) > 0.5) ? m.a : m.b) * 255.0 + 0.5);
      vec2 l = vec2(dot(u_frA[f], vec3(px, 1.0)), dot(u_frB[f], vec3(px, 1.0)));
      vec2 sz = u_frS[f];
      float L = abs(sz.x * u_dir.x) + abs(sz.y * u_dir.y);
      float t = clamp(dot(l - sz * 0.5, u_dir) / max(L, 1.0) + 0.5, 0.0, 1.0);
      c = u_stopC[0];
      for (int i = 1; i < 8; i++) {
        if (i >= u_nStops) break;
        float a0 = u_stopAt[i - 1], a1 = u_stopAt[i];
        if (t >= a0) c = mix(u_stopC[i - 1], u_stopC[i], clamp((t - a0) / max(a1 - a0, 1e-5), 0.0, 1.0));
      }
    }
    src = vec4(c, mk);
  } else if (u_type == 1) {
    vec2 iuv = vec2(dot(u_imA, vec3(px, 1.0)), dot(u_imB, vec3(px, 1.0)));
    vec4 im = (iuv.x < 0.0 || iuv.y < 0.0 || iuv.x > 1.0 || iuv.y > 1.0) ? vec4(0.0) : texture(u_src, iuv);
    if (im.a > 0.0) im.rgb /= im.a; // textures are premultiplied
    if (u_tint == 1) im.rgb = u_tintC; else if (u_tint == 2) im.rgb = vec3(lum(im.rgb));
    if (u_ol) {
      float a = 0.0;
      for (int i = 0; i < 24; i++) {
        float ang = float(i) * 0.2617994;
        vec2 d = vec2(cos(ang), sin(ang)) * u_olR;
        a = max(a, max(aAt(iuv + d), aAt(iuv + d * 0.5)));
      }
      im = vec4(mix(u_olC, im.rgb, im.a), max(a, im.a));
    }
    if (im.a <= 0.0) discard;
    src = im;
  } else if (u_type == 2) {
    src = texture(u_src, uv);
    if (src.a > 0.0) src.rgb /= src.a;
    if (u_mask2Mode > 0) { vec4 q = texture(u_mask2, uv); float m2 = u_mask2Zones ? clamp(dot(q.rgb, zoneW), 0.0, 1.0) : q.r; src.a *= u_mask2Mode == 2 ? 1.0 - m2 : m2; }
  } else if (u_type == 4) {
    // remap: copy the texel the map points at (u16, v16) — continues the shirt design onto collar flaps
    vec4 r = texture(u_src, uv);
    if (r.r + r.g + r.b + r.a <= 0.0) discard;
    vec2 q = vec2(r.r * 65280.0 + r.g * 255.0, r.b * 65280.0 + r.a * 255.0) / 65535.0;
    src = vec4(texture(u_dst, q).rgb, 1.0);
  } else if (u_type == 3) {
    src = texture(u_src, px / (u_tileSize * u_tileScale));
    if (src.a > 0.0) src.rgb /= src.a;
  }
  float a = src.a * u_opacity * w;
  if (a <= 0.0) discard;
  if (u_blend == 0) { o = vec4(src.rgb, a); return; }   // hardware source-over
  vec3 b = texture(u_dst, vec2(gl_FragCoord.xy / u_size)).rgb;
  o = vec4(mix(b, blendC(b, src.rgb), a), 1.0);
}`

const BLENDS: Record<string, number> = {
  'source-over': 0, multiply: 1, screen: 2, overlay: 3, 'soft-light': 4, 'hard-light': 5, darken: 6, lighten: 7, difference: 8,
  'color-dodge': 9, 'color-burn': 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15
}
const CLIPS: Record<Clip, number> = { all: 0, torso: 1, front: 2, back: 3, sleeves: 4, shorts: 5, socks: 6, collar: 7, armband: 8, cuffs: 9, zones: 10 }

/** Fill frames (texture px → local frame) – same layout as fill.ts so gradients run along each part. */
type Frame = { m: [number, number, number, number, number, number]; w: number; h: number }
const FRAMES: Frame[] = [
  { m: [1, 0, 0, 1, TORSO.x0 - 60, SEAM], w: TORSO.x1 - TORSO.x0 + 120, h: 1000 }, // 0 torso front
  { m: [-1, 0, 0, -1, TORSO.x1 + 60, SEAM], w: TORSO.x1 - TORSO.x0 + 120, h: 960 }, // 1 torso back
  { m: [0, 1, -1, 0, 704, 684], w: 534, h: 284 }, // 2 short sleeve L
  { m: [0, 1, 1, 0, 1344, 684], w: 534, h: 284 }, // 3 short sleeve R
  { m: [0, 1, -1, 0, 700, 128], w: 528, h: 700 }, // 4 long sleeve L
  { m: [0, 1, 1, 0, 1348, 128], w: 528, h: 700 }, // 5 long sleeve R
  { m: [0, 1, -1, 0, 640, 1160], w: 804, h: 640 }, // 6 shorts L (waist → hem)
  { m: [0, 1, 1, 0, 1408, 1160], w: 804, h: 640 }, // 7 shorts R
  { m: [1, 0, 0, 1, 0, 630], w: 400, h: 530 }, // 8 socks L
  { m: [1, 0, 0, 1, 1648, 630], w: 400, h: 530 }, // 9 socks R
  { m: [1, 0, 0, 1, 664, 1866], w: 720, h: 134 }, // 10 collar
  { m: [1, 0, 0, 1, 0, 0], w: 512, h: 128 } // 11 armband
]
function invAffine([a, b, c, d, e, f]: number[]): [number[], number[]] {
  const det = a * d - b * c
  // inverse of [a c e; b d f]
  return [[d / det, -c / det, (c * f - d * e) / det], [-b / det, a / det, (b * e - a * f) / det]]
}
const FR_INV = FRAMES.map((f) => invAffine(f.m))

// ---------------------------------------------------------------- contexts
// The compositor has its own WebGL context (2D view, exports) and, while the 3D view is open, also works inside the 3D
// view's own context: its result is then a texture the 3D model samples directly (copying a 2048² canvas from one
// context into another took ~40 ms on every change). Each context keeps its own program and caches.
interface Ctx {
  gl: WebGL2RenderingContext; canvas: HTMLCanvasElement | null; prog: WebGLProgram; U: Record<string, WebGLUniformLocation | null>
  mapTex: WebGLTexture; vbo: WebGLBuffer; loc: number; targets: Map<number, Target>; masks: Lru<WebGLTexture>; rgbas: Lru<WebGLTexture>
  images: WeakMap<object, WebGLTexture>; prefix: Map<number, { last: string[]; cp?: Checkpoint }>; out?: { tex: WebGLTexture; fb: WebGLFramebuffer }
}
let gl: WebGL2RenderingContext | null = null
let glCanvas: HTMLCanvasElement | null = null
let prog: WebGLProgram | null = null
let U: Record<string, WebGLUniformLocation | null> = {}
let mapTex: WebGLTexture | null = null
let cur: Ctx | null = null
let own: Ctx | null = null
let shared: Ctx | null = null
let sharedTouched = false
type Target = { size: number; tex: [WebGLTexture, WebGLTexture]; fb: [WebGLFramebuffer, WebGLFramebuffer]; cur: 0 | 1 }
let targets = new Map<number, Target>()

function compile(g: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = g.createShader(type)!
  g.shaderSource(s, src)
  g.compileShader(s)
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error('shader: ' + g.getShaderInfoLog(s))
  return s
}

function newTex(w: number, h: number, data: ArrayBufferView | null, filter: number): WebGLTexture {
  const t = gl!.createTexture()!
  gl!.bindTexture(gl!.TEXTURE_2D, t)
  gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, data)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter === gl!.LINEAR_MIPMAP_LINEAR ? gl!.LINEAR : filter)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
  return t
}

/** Region map: R = region bits, G = cuffs, B = fill frame, A = sleeve frame used for the raglan shoulder. */
function buildMap(): Uint8Array {
  const c = new OffscreenCanvas(S, S), g = c.getContext('2d', { willReadFrequently: true })!
  const read = (polys: Path2D | ((g: OffscreenCanvasRenderingContext2D) => void)): Uint8ClampedArray => {
    g.clearRect(0, 0, S, S)
    g.fillStyle = '#fff'
    if (polys instanceof Path2D) g.fill(polys); else polys(g)
    return g.getImageData(0, 0, S, S).data
  }
  const out = new Uint8Array(S * S * 4)
  const shortL = (x: number): boolean => x < 1024
  const sleeves = read(pathOf(REGIONS.sleeves)), long = read(pathOf(REGIONS.longSleeves)), shoulder = read(pathOf(SHOULDER_STRIP))
  const shorts = read(pathOf(REGIONS.shorts)), socks = read(pathOf(REGIONS.socks)), collar = read(pathOf(REGIONS.collar)), armband = read(pathOf(REGIONS.armband))
  const cuffs = read(pathOf([...REGIONS.cuffs, ...REGIONS.longCuffs]))
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, a = i + 3
    let bits = 0, frame = y >= SEAM ? 0 : 1
    if (armband[a] > 127) { bits |= 128; frame = 11 }
    else if (collar[a] > 127) { bits |= 64; frame = 10 }
    else if (long[a] > 127) { bits |= 4; frame = shortL(x) ? 4 : 5 }
    else if (sleeves[a] > 127) { bits |= 4; frame = shortL(x) ? 2 : 3 }
    else if (shorts[a] > 127) { bits |= 16; frame = shortL(x) ? 6 : 7 }
    else if (socks[a] > 127) { bits |= 32; frame = shortL(x) ? 8 : 9 }
    else bits |= y >= SEAM ? 1 : 2
    if (shoulder[a] > 127 && (bits & (1 | 2))) bits |= 8
    out[i] = bits
    out[i + 1] = cuffs[a] > 127 ? 255 : 0
    out[i + 2] = frame
    out[i + 3] = bits & 8 ? (shortL(x) ? 2 : 3) : frame
  }
  return out
}

function makeCtx(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement | null): Ctx {
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  gl.bindVertexArray(null)
  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const U: Record<string, WebGLUniformLocation | null> = {}
  for (const n of ['u_map', 'u_dst', 'u_src', 'u_size', 'u_type', 'u_clip', 'u_zoneSel', 'u_s2s', 'u_maskMode', 'u_opacity', 'u_blend', 'u_grad', 'u_color', 'u_nStops', 'u_stopC', 'u_stopAt', 'u_dir', 'u_frA', 'u_frB', 'u_frS', 'u_imA', 'u_imB', 'u_tint', 'u_tintC', 'u_olR', 'u_olC', 'u_ol', 'u_tileScale', 'u_tileSize', 'u_mask2', 'u_mask2Mode', 'u_mask2Zones'])
    U[n] = gl.getUniformLocation(prog, n)
  gl.uniform1i(U.u_map, 0); gl.uniform1i(U.u_dst, 1); gl.uniform1i(U.u_src, 2); gl.uniform1i(U.u_mask2, 3)
  gl.uniform3fv(U.u_frA, FR_INV.flatMap((f) => f[0]))
  gl.uniform3fv(U.u_frB, FR_INV.flatMap((f) => f[1]))
  gl.uniform2fv(U.u_frS, FRAMES.flatMap((f) => [f.w, f.h]))
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  const mt = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, mt)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildMap())
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  const c: Ctx = {
    gl, canvas, prog, U, mapTex: mt, vbo: buf, loc, targets: new Map(), images: new WeakMap(), prefix: new Map(),
    masks: new Lru<WebGLTexture>(28, (t) => gl.deleteTexture(t)), rgbas: new Lru<WebGLTexture>(40, (t) => gl.deleteTexture(t))
  }
  return c
}

/** Make a context current, and put back the GL state the compositor relies on (the 3D view changes it). */
function use(c: Ctx): WebGL2RenderingContext {
  if (cur !== c) {
    cur = c; gl = c.gl; glCanvas = c.canvas; prog = c.prog; U = c.U; mapTex = c.mapTex
    targets = c.targets; masks = c.masks; rgbas = c.rgbas; images = c.images; prefix = c.prefix
  }
  const g = c.gl
  g.bindVertexArray(null)
  g.useProgram(c.prog)
  g.bindBuffer(g.ARRAY_BUFFER, c.vbo)
  g.enableVertexAttribArray(c.loc)
  g.vertexAttribPointer(c.loc, 2, g.FLOAT, false, 0, 0)
  g.disable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.disable(g.STENCIL_TEST); g.disable(g.SCISSOR_TEST); g.disable(g.BLEND)
  g.colorMask(true, true, true, true)
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
  g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE)
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  g.pixelStorei(g.UNPACK_ALIGNMENT, 4)
  if (c === shared) sharedTouched = true
  return g
}

/** The compositor's own context (its canvas is what the 2D view shows). */
function init(): WebGL2RenderingContext {
  if (!own) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const g = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!g) throw new Error('WebGL2 indisponível')
    own = makeCtx(g, canvas)
  }
  return use(own)
}
/** For read-backs (exports, thumbnails, shininess): the 3D view's context when it is open (its caches are warm). */
function active(): WebGL2RenderingContext { return shared ? use(shared) : init() }

/** The 3D view hands its WebGL2 context over (null when it closes). */
export function attachSharedContext(g: WebGL2RenderingContext | null): void {
  if (shared && shared.gl !== g) { flush(shared); if (cur === shared) cur = null; shared = null }
  if (g && !shared) { shared = makeCtx(g, null); sharedTouched = true }
}
/** True once after the compositor used the 3D view's context: the 3D renderer must forget its cached GL state. */
export function consumeSharedTouched(): boolean { const t = sharedTouched; sharedTouched = false; return t }
function flush(c: Ctx): void {
  c.masks.clear(); c.rgbas.clear(); c.prefix.clear()
}

function target(size: number): Target {
  let t = targets.get(size)
  if (t) return t
  const g = gl!
  const mk = (): [WebGLTexture, WebGLFramebuffer] => {
    const tex = newTex(size, size, null, g.LINEAR)
    const fb = g.createFramebuffer()!
    g.bindFramebuffer(g.FRAMEBUFFER, fb)
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0)
    return [tex, fb]
  }
  const a = mk(), b = mk()
  t = { size, tex: [a[0], b[0]], fb: [a[1], b[1]], cur: 0 }
  targets.set(size, t)
  return t
}

// ---------------------------------------------------------------- texture caches
class Lru<V> {
  private m = new Map<string, V>()
  constructor(private max: number, private drop: (v: V) => void) {}
  get(k: string): V | undefined { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v) } return v }
  peek(k: string): V | undefined { return this.m.get(k) }
  clear(): void { for (const v of this.m.values()) this.drop(v); this.m.clear() }
  set(k: string, v: V): void {
    this.m.set(k, v)
    while (this.m.size > this.max) { const [ok, ov] = this.m.entries().next().value!; this.m.delete(ok); this.drop(ov) }
  }
}
let masks = new Lru<WebGLTexture>(28, (t) => gl?.deleteTexture(t))
// painted canvases (designs, stitching, fabrics, shadows…): a kit with many of them must not push its own out on every
// render (they would all be painted again, the slow part of moving a slider)
let rgbas = new Lru<WebGLTexture>(40, (t) => gl?.deleteTexture(t))
let images = new WeakMap<object, WebGLTexture>()

function uploadImage(src: TexImageSource, mip: boolean): WebGLTexture {
  const g = gl!
  const t = g.createTexture()!
  g.bindTexture(g.TEXTURE_2D, t)
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, src)
  if (mip) g.generateMipmap(g.TEXTURE_2D)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, mip ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
  return t
}

/** Masks are drawn white on black; zone masks put front / back / sleeves content in R / G / B. */
function maskTex(m: MaskSrc): WebGLTexture {
  const hit = masks.get(m.key)
  if (hit) return hit
  const c = new OffscreenCanvas(S, S), g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S)
  g.fillStyle = g.strokeStyle = '#fff'
  m.draw(g)
  const t = uploadImage(c, false)
  masks.set(m.key, t)
  return t
}

function imageTex(img: ImageSource): WebGLTexture {
  let t = images.get(img)
  if (!t) {
    // ImageBitmaps ignore the WebGL unpack flags; go through a canvas so every image is uploaded premultiplied
    let src: TexImageSource = img as TexImageSource
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
      const c = new OffscreenCanvas(img.width, img.height)
      c.getContext('2d')!.drawImage(img, 0, 0)
      src = c
    }
    t = uploadImage(src, true)
    images.set(img, t)
  }
  return t
}

function tileTex(key: string, img: ImageSource): WebGLTexture {
  let t = rgbas.get('tile:' + key)
  if (!t) {
    t = uploadImage(img as TexImageSource, false)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.REPEAT)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.REPEAT)
    rgbas.set('tile:' + key, t)
  }
  return t
}

const rgb = (h: string): number[] => hexToRgb(h).map((v) => v / 255)
const hexAlpha = (h: string): number => (/^#[0-9a-f]{8}$/i.test(h) ? parseInt(h.slice(7, 9), 16) / 255 : 1)

// ---------------------------------------------------------------- render
export interface RenderOptions { size?: number; s2s?: boolean }

// ---------------------------------------------------------------- prefix cache
// While a slider moves, only one layer changes: the passes before it give the same picture every time. The result
// just before the first pass that changed is kept (one texture per size) and the next render starts from there.
const imgIds = new WeakMap<object, number>()
let nextImgId = 1
const imgId = (o: object): number => { let i = imgIds.get(o); if (!i) { i = nextImgId++; imgIds.set(o, i) } return i }
function passSig(p: Pass): string {
  const common = [p.t, p.clip, p.opacity ?? 1, p.blend ?? '', p.zoneSel?.join(',') ?? '']
  if (p.t === 'fill') return JSON.stringify([...common, p.fill, p.mask?.key ?? '', p.mask2?.key ?? '', !!p.mask2Invert, p.s2s ?? ''])
  if (p.t === 'image') { const q = p.place; return JSON.stringify([...common, imgId(q.img as object), q.cx, q.cy, q.w, q.h, q.rot, q.tint ?? '', q.color ?? '', q.outlineColor ?? '', q.outlineWidth ?? 0]) }
  if (p.t === 'rgba') return JSON.stringify([...common, p.key, p.mask2?.key ?? '', !!p.mask2Invert])
  if (p.t === 'remap') return JSON.stringify([...common, p.key])
  return JSON.stringify([...common, p.key, p.scale, imgId(p.img as object)])
}
type Checkpoint = { tex: WebGLTexture; fb: WebGLFramebuffer; n: number; sigs: string[] }
let prefix = new Map<number, { last: string[]; cp?: Checkpoint }>()
function blit(g: WebGL2RenderingContext, from: WebGLFramebuffer, to: WebGLFramebuffer, size: number): void {
  g.bindFramebuffer(g.READ_FRAMEBUFFER, from)
  g.bindFramebuffer(g.DRAW_FRAMEBUFFER, to)
  g.blitFramebuffer(0, 0, size, size, 0, 0, size, size, g.COLOR_BUFFER_BIT, g.NEAREST)
  g.bindFramebuffer(g.READ_FRAMEBUFFER, null); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null)
}

/**
 * Box (texture px: x0, y0, x1, y1) a source-over pass can touch, or null for the whole texture: a logo / image (its
 * turned box plus outline) or a part with its own small area (collar, armband, cuffs, socks, shorts). Drawing only
 * there (scissor) saves full-texture passes for every small logo.
 */
const regionBox = (polys: [number, number][][]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0 - 4, y0 - 4, x1 + 4, y1 + 4]
}
const CLIP_BOX: Partial<Record<Clip, [number, number, number, number]>> = {
  collar: regionBox(REGIONS.collar), armband: regionBox(REGIONS.armband), cuffs: regionBox([...REGIONS.cuffs, ...REGIONS.longCuffs]),
  socks: regionBox(REGIONS.socks), shorts: regionBox(REGIONS.shorts)
}
function passBox(p: Pass): [number, number, number, number] | null {
  if (p.t === 'image') {
    const q = p.place, r = 0.5 * Math.hypot(q.w, q.h) + (q.outlineWidth ?? 0) + 4
    return [q.cx - r, q.cy - r, q.cx + r, q.cy + r]
  }
  return CLIP_BOX[p.clip] ?? null
}

/** Whether a painted canvas with this key is already on the GPU (so a pass can reuse it without drawing it again). */
export function hasRgba(key: string): boolean { return !!rgbas.peek(key) }

function runPasses(passes: Pass[], opt: RenderOptions): Target {
  const g = gl!
  const size = opt.size ?? S
  const T = target(size)
  g.useProgram(prog)
  g.viewport(0, 0, size, size)
  g.uniform2f(U.u_size, size, size)
  g.uniform1i(U.u_s2s, opt.s2s ? 1 : 0)
  g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, mapTex)
  const head = 's2s:' + !!opt.s2s
  const sigs = passes.map((p) => head + passSig(p))
  let st = prefix.get(size)
  if (!st) { st = { last: [] }; prefix.set(size, st) }
  // first pass that differs from the last render: the checkpoint goes just before it
  let diff = 0
  while (diff < sigs.length && diff < st.last.length && sigs[diff] === st.last[diff]) diff++
  const cp = st.cp
  let start = 0
  if (cp && cp.n > 0 && cp.n <= sigs.length && cp.sigs.every((x, i) => x === sigs[i])) {
    blit(g, cp.fb, T.fb[T.cur], size)
    start = cp.n
  } else {
    // start from black
    g.bindFramebuffer(g.FRAMEBUFFER, T.fb[T.cur])
    g.clearColor(0, 0, 0, 1)
    g.clear(g.COLOR_BUFFER_BIT)
  }
  st.last = sigs
  // worth keeping only when the change is not at the very start, and differs from the checkpoint already held
  const keepAt = diff > 0 && diff < sigs.length && !(cp && cp.n === diff && start === diff) ? diff : -1
  for (let i = start; i < passes.length; i++) {
    const p = passes[i]
    if (i === keepAt) {
      let c = st.cp
      if (!c) {
        const tex = newTex(size, size, null, g.LINEAR), fb = g.createFramebuffer()!
        g.bindFramebuffer(g.FRAMEBUFFER, fb)
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0)
        c = st.cp = { tex, fb, n: 0, sigs: [] }
      }
      blit(g, T.fb[T.cur], c.fb, size)
      c.n = i; c.sigs = sigs.slice(0, i)
      g.useProgram(prog)
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, mapTex)
    }
    const blend = BLENDS[p.blend ?? 'source-over'] ?? 0
    g.uniform1i(U.u_clip, CLIPS[p.clip])
    g.uniform1i(U.u_s2s, (p.t === 'fill' && p.s2s !== undefined ? p.s2s : opt.s2s) ? 1 : 0)
    g.uniform3fv(U.u_zoneSel, p.zoneSel ?? [1, 1, 1])
    g.uniform1f(U.u_opacity, p.opacity ?? 1)
    g.uniform1i(U.u_blend, blend)
    g.uniform1i(U.u_maskMode, 0)
    g.uniform1i(U.u_mask2Mode, 0)
    if ((p.t === 'fill' || p.t === 'rgba') && p.mask2) {
      g.activeTexture(g.TEXTURE3); g.bindTexture(g.TEXTURE_2D, maskTex(p.mask2))
      g.uniform1i(U.u_mask2Mode, p.mask2Invert ? 2 : 1)
      g.uniform1i(U.u_mask2Zones, p.mask2.zones ? 1 : 0)
    }
    g.activeTexture(g.TEXTURE2)
    if (p.t === 'fill') {
      g.uniform1i(U.u_type, 0)
      if (p.mask) { g.bindTexture(g.TEXTURE_2D, maskTex(p.mask)); g.uniform1i(U.u_maskMode, p.mask.zones ? 2 : 1) }
      const f = p.fill
      // colours may carry transparency (#rrggbbaa): it multiplies the pass opacity
      if (f.kind === 'solid') { g.uniform1i(U.u_grad, 0); g.uniform3fv(U.u_color, rgb(f.color)); const al = hexAlpha(f.color); if (al < 1) g.uniform1f(U.u_opacity, (p.opacity ?? 1) * al) }
      else {
        const stops = [...f.stops].sort((a, b) => a.at - b.at).slice(0, 8)
        g.uniform1i(U.u_grad, 1)
        g.uniform1i(U.u_nStops, stops.length)
        const cs = stops.flatMap((s) => rgb(s.color)), at = stops.map((s) => Math.max(0, Math.min(1, s.at)))
        while (cs.length < 24) cs.push(0)
        while (at.length < 8) at.push(1)
        g.uniform3fv(U.u_stopC, cs)
        g.uniform1fv(U.u_stopAt, at)
        const a = (f.angle * Math.PI) / 180
        g.uniform2f(U.u_dir, Math.cos(a), Math.sin(a))
        g.uniform3fv(U.u_color, rgb(stops[0]?.color ?? '#000000'))
      }
    } else if (p.t === 'image') {
      const pl = p.place
      g.uniform1i(U.u_type, 1)
      g.bindTexture(g.TEXTURE_2D, imageTex(pl.img))
      // texture px → image uv: rotate by -rot around the centre, then scale
      const c = Math.cos(pl.rot), s = Math.sin(pl.rot)
      const ax = c / pl.w, ay = s / pl.w, bx = -s / pl.h, by = c / pl.h
      g.uniform3f(U.u_imA, ax, ay, 0.5 - ax * pl.cx - ay * pl.cy)
      g.uniform3f(U.u_imB, bx, by, 0.5 - bx * pl.cx - by * pl.cy)
      g.uniform1i(U.u_tint, pl.tint === 'color' ? 1 : pl.tint === 'bw' ? 2 : 0)
      g.uniform3fv(U.u_tintC, rgb(pl.color ?? '#ffffff'))
      const ow = pl.outlineWidth ?? 0
      g.uniform1i(U.u_ol, ow > 0 ? 1 : 0)
      g.uniform2f(U.u_olR, ow / Math.max(1, Math.abs(pl.w)), ow / Math.max(1, Math.abs(pl.h)))
      g.uniform3fv(U.u_olC, rgb(pl.outlineColor ?? '#ffffff'))
    } else if (p.t === 'remap') {
      g.uniform1i(U.u_type, 4)
      let t = rgbas.get(p.key)
      if (!t) {
        g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        t = newTex(S, S, p.data, g.NEAREST)
        g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        rgbas.set(p.key, t)
      }
      g.bindTexture(g.TEXTURE_2D, t)
    } else if (p.t === 'rgba') {
      g.uniform1i(U.u_type, 2)
      let t = rgbas.get(p.key)
      if (!t) { t = uploadImage((typeof p.img === 'function' ? p.img() : p.img) as TexImageSource, false); rgbas.set(p.key, t) }
      g.bindTexture(g.TEXTURE_2D, t)
    } else {
      g.uniform1i(U.u_type, 3)
      g.bindTexture(g.TEXTURE_2D, tileTex(p.key, p.img))
      g.uniform1f(U.u_tileScale, Math.max(0.1, p.scale))
      g.uniform2f(U.u_tileSize, (p.img as { width: number }).width, (p.img as { height: number }).height)
    }
    if (blend === 0 && p.t !== 'remap') {
      // plain source-over: hardware blending into the current target (only over the pass's own box when it has one)
      g.bindFramebuffer(g.FRAMEBUFFER, T.fb[T.cur])
      const box = passBox(p)
      if (box) {
        const k = size / S, x0 = Math.max(0, Math.floor(box[0] * k)), x1 = Math.min(size, Math.ceil(box[2] * k)), y0 = Math.max(0, Math.floor(box[1] * k)), y1 = Math.min(size, Math.ceil(box[3] * k))
        g.enable(g.SCISSOR_TEST); g.scissor(x0, size - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0))
      }
      g.enable(g.BLEND)
      g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ZERO, g.ONE)
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
      g.disable(g.BLEND)
      if (box) g.disable(g.SCISSOR_TEST)
    } else {
      // other blend modes read the current target and write the other one
      const nxt = (1 - T.cur) as 0 | 1
      g.bindFramebuffer(g.FRAMEBUFFER, T.fb[nxt])
      g.uniform1i(U.u_type, 9)
      g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, T.tex[T.cur])
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4) // copy, so texels the pass discards stay
      g.uniform1i(U.u_type, p.t === 'fill' ? 0 : p.t === 'image' ? 1 : p.t === 'rgba' ? 2 : p.t === 'remap' ? 4 : 3)
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
      g.bindTexture(g.TEXTURE_2D, null)
      T.cur = nxt
    }
  }
  return T
}

/** Render and show the result on the shared GL canvas (used directly as the 3D texture). */
export function renderToCanvas(passes: Pass[], opt: RenderOptions = {}): HTMLCanvasElement {
  const g = init()
  // `size` < 2048: a draft for fast previews (while a slider is moving); the canvas takes that size
  const size = opt.size ?? S
  if (glCanvas!.width !== size) { glCanvas!.width = size; glCanvas!.height = size }
  const T = runPasses(passes, { ...opt, size })
  g.bindFramebuffer(g.READ_FRAMEBUFFER, T.fb[T.cur])
  g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null)
  g.blitFramebuffer(0, 0, size, size, 0, 0, size, size, g.COLOR_BUFFER_BIT, g.NEAREST)
  g.bindFramebuffer(g.FRAMEBUFFER, null)
  return glCanvas!
}

/**
 * Render inside the 3D view's context and return the result as a mip-mapped texture of that context (null when the 3D
 * view is not open): the 3D model samples it directly.
 */
export function renderToShared(passes: Pass[], opt: RenderOptions = {}): WebGLTexture | null {
  if (!shared) return null
  const g = use(shared)
  const T = runPasses(passes, { ...opt, size: S })
  const c = shared
  if (!c.out) {
    const tex = g.createTexture()!
    g.bindTexture(g.TEXTURE_2D, tex)
    g.texStorage2D(g.TEXTURE_2D, Math.floor(Math.log2(S)) + 1, g.RGBA8, S, S)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    const ext = g.getExtension('EXT_texture_filter_anisotropic')
    if (ext) g.texParameterf(g.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8)
    const fb = g.createFramebuffer()!
    g.bindFramebuffer(g.FRAMEBUFFER, fb)
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0)
    c.out = { tex, fb }
  }
  // the compositor's rows run bottom-up (GL): flip while copying, so the texture reads like the canvas (flipY off)
  g.bindFramebuffer(g.READ_FRAMEBUFFER, T.fb[T.cur])
  g.bindFramebuffer(g.DRAW_FRAMEBUFFER, c.out.fb)
  g.blitFramebuffer(0, 0, S, S, 0, S, S, 0, g.COLOR_BUFFER_BIT, g.NEAREST)
  g.bindFramebuffer(g.READ_FRAMEBUFFER, null); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null)
  g.bindTexture(g.TEXTURE_2D, c.out.tex)
  g.generateMipmap(g.TEXTURE_2D)
  g.bindTexture(g.TEXTURE_2D, null)
  return c.out.tex
}

/** Render and read back RGBA (top row first), e.g. for export or small previews. */
export function renderToRgba(passes: Pass[], opt: RenderOptions = {}): { width: number; height: number; data: Uint8Array } {
  const g = active()
  const size = opt.size ?? S
  const T = runPasses(passes, opt)
  g.bindFramebuffer(g.FRAMEBUFFER, T.fb[T.cur])
  const raw = new Uint8Array(size * size * 4)
  g.readPixels(0, 0, size, size, g.RGBA, g.UNSIGNED_BYTE, raw)
  g.bindFramebuffer(g.FRAMEBUFFER, null)
  // GL rows are bottom-up
  const out = new Uint8Array(raw.length), row = size * 4
  for (let y = 0; y < size; y++) out.set(raw.subarray((size - 1 - y) * row, (size - y) * row), y * row)
  return { width: size, height: size, data: out }
}

export function gpuAvailable(): boolean {
  try { init(); return true } catch { return false }
}
