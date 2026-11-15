// Shared helpers for the procedural venue: seeded noise, canvas painting, ellipse-ring maths, a tiny geometry merger
// (no addons are vendored, so no BufferGeometryUtils) and the shared quality tier.
import * as THREE from 'three';
import { mulberry32 } from '../physics.js';

export { mulberry32 };

/** Infield ellipse centre (physics x, metres) and semi-axes. Physics (x, z) -> three (z, -x). */
export const ARENA = { cx: 36, a: 58, b: 40 };
export const LANE_W = 1.22; // m, a real lane
export const LANES = 8;
export const TRACK_W = LANE_W * LANES; // 9.76 m

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A point on the infield ellipse grown by `off` metres, in THREE space (x right, z towards the thrower's back). */
export function ringPoint(t, off = 0, out = new THREE.Vector3()) {
  const px = ARENA.cx + (ARENA.a + off) * Math.cos(t);
  const pz = (ARENA.b + off) * Math.sin(t);
  return out.set(pz, 0, -px);
}

/** Outward unit normal of the ring at t (three space, xz). */
export function ringNormal(t, off = 0, out = new THREE.Vector3()) {
  const A = ARENA.a + off;
  const B = ARENA.b + off;
  const nx = Math.cos(t) / A;
  const nz = Math.sin(t) / B;
  const l = Math.hypot(nx, nz) || 1;
  return out.set(nz / l, 0, -nx / l);
}

/** Equal-arc-length sampler of the ring at an offset: returns t for a distance s along it (s wraps). */
export function ringArc(off, n = 720) {
  const ts = new Float32Array(n + 1);
  const ls = new Float32Array(n + 1);
  const p = new THREE.Vector3();
  let prevX = 0;
  let prevZ = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI;
    ringPoint(t, off, p);
    ts[i] = t;
    ls[i] = i === 0 ? 0 : ls[i - 1] + Math.hypot(p.x - prevX, p.z - prevZ);
    prevX = p.x;
    prevZ = p.z;
  }
  const total = ls[n];
  const lenAt = (t) => {
    const k = Math.floor((t + Math.PI) / (Math.PI * 2)); // unwrap: sections may cross the seam at t = +-PI
    const f = ((t - k * Math.PI * 2 + Math.PI) / (Math.PI * 2)) * n;
    const i = clamp(Math.floor(f), 0, n - 1);
    return lerp(ls[i], ls[i + 1], f - i) + k * total;
  };
  const tAt = (s) => {
    s = ((s % total) + total) % total;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ls[m] <= s) lo = m;
      else hi = m;
    }
    return lerp(ts[lo], ts[hi], (s - ls[lo]) / Math.max(1e-6, ls[hi] - ls[lo]));
  };
  return { total, lenAt, tAt };
}

// --- noise -----------------------------------------------------------------------------------------------------
/** Tileable value noise on an N x N lattice (N power of two). */
export function makeNoise(seed = 7, N = 256) {
  const r = mulberry32(seed);
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const M = N - 1;
  const n2 = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = xi & M;
    const x1 = (xi + 1) & M;
    const y0 = (yi & M) * N;
    const y1 = ((yi + 1) & M) * N;
    const a = g[y0 + x0] + (g[y0 + x1] - g[y0 + x0]) * fx;
    const b = g[y1 + x0] + (g[y1 + x1] - g[y1 + x0]) * fx;
    return a + (b - a) * fy;
  };
  const fbm = (x, y, oct = 4) => {
    let a = 0.5;
    let f = 1;
    let s = 0;
    let norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * n2(x * f, y * f);
      norm += a;
      f *= 2;
      a *= 0.5;
    }
    return s / norm;
  };
  return { n2, fbm };
}

// --- canvas / textures -----------------------------------------------------------------------------------------
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: false }) };
}

export function toTexture(c, { repeat, srgb = true, aniso = 4, mip = true, wrap = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (repeat || wrap) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** Fill a canvas pixel-by-pixel: fn(x, y, out:[r,g,b,a]) with values 0..255. */
export function paintPixels(w, h, fn) {
  const { c, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  const o = [0, 0, 0, 255];
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      o[3] = 255;
      fn(x, y, o);
      d[k++] = o[0];
      d[k++] = o[1];
      d[k++] = o[2];
      d[k++] = o[3];
    }
  }
  g.putImageData(img, 0, 0);
  return { c, g };
}

/**
 * Patch a standard/lambert material so a tiling detail texture and a world-space macro-variation texture modulate the
 * albedo. Gives close-up grain AND large-scale patchiness without needing UVs on the big surfaces.
 */
export function patchGround(mat, { detail, detailScale = 1, macro, macroScale = 1 / 90, macroAmt = 0.3, detailAmt = 0.35 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detail || null };
    sh.uniforms.uMacro = { value: macro || null };
    sh.uniforms.uK = { value: new THREE.Vector4(detailScale, macroScale, macroAmt, detailAmt) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform sampler2D uDetail; uniform sampler2D uMacro; uniform vec4 uK;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float m = texture2D(uMacro, vWp.xz * uK.y).r;
          float m2 = texture2D(uMacro, vWp.xz * uK.y * 3.7 + 0.31).g;
          float d = texture2D(uDetail, vWp.xz * uK.x).r;
          float d2 = texture2D(uDetail, vWp.xz * uK.x * 0.27 + 0.5).r;
          float fade = 1.0 - smoothstep(18.0, 70.0, length(vWp - cameraPosition));
          diffuseColor.rgb *= 1.0 + (m - 0.5) * 2.0 * uK.z + (m2 - 0.5) * uK.z * 0.8;
          diffuseColor.rgb *= 1.0 + ((d - 0.5) * 2.0 * uK.w + (d2 - 0.5) * uK.w) * fade;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ground-' + (detail ? 1 : 0) + (macro ? 1 : 0);
  return mat;
}

/**
 * three.js draws a transparent DoubleSide material in two passes (back faces, then front) and flags it needsUpdate
 * twice a frame to do it, so every such material costs two draws plus two program re-checks per frame. Additive glows,
 * depthWrite:false nets and flat decals do not need the back-to-front split: draw them in one pass.
 */
export function singlePassTransparent(root) {
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true;
  });
}

// --- tiny geometry merger --------------------------------------------------------------------------------------
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/**
 * Collects transformed copies of primitive geometries into ONE indexed BufferGeometry (position, normal, uv, color).
 * `color` bakes a vertex colour (with optional per-instance jitter) so one material can serve a varied set of parts.
 */
export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.rand = mulberry32(99);
  }

  add(geo, matrix = null, color = null, { jitter = 0, uvRect = null, alpha = null } = {}) {
    const base = this.pos.length / 3;
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const uv = geo.attributes.uv;
    if (matrix) _nm.getNormalMatrix(matrix);
    const j = jitter ? 1 + (this.rand() - 0.5) * 2 * jitter : 1;
    const jc = color ? [clamp(color.r * j, 0, 4), clamp(color.g * j, 0, 4), clamp(color.b * j, 0, 4)] : null;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      if (matrix) _v.applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) {
        _n.fromBufferAttribute(n, i);
        if (matrix) _n.applyMatrix3(_nm).normalize();
        this.nor.push(_n.x, _n.y, _n.z);
      } else this.nor.push(0, 1, 0);
      if (uv) {
        let u = uv.getX(i);
        let v = uv.getY(i);
        if (uvRect) {
          u = uvRect[0] + u * uvRect[2];
          v = uvRect[1] + v * uvRect[3];
        }
        this.uv.push(u, v);
      } else this.uv.push(0, 0);
      if (jc) this.col.push(jc[0], jc[1], jc[2], alpha === null ? 1 : alpha);
      else this.col.push(1, 1, 1, alpha === null ? 1 : alpha);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    return this;
  }

  /** Raw triangle strip / quad: four corner positions (ccw seen from the normal side). */
  quad(p0, p1, p2, p3, uv = [0, 0, 1, 0, 1, 1, 0, 1], color = null, alpha = 1) {
    const base = this.pos.length / 3;
    const nrm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize();
    for (const [i, p] of [p0, p1, p2, p3].entries()) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(nrm.x, nrm.y, nrm.z);
      this.uv.push(uv[i * 2], uv[i * 2 + 1]);
      if (color) this.col.push(color.r, color.g, color.b, alpha);
      else this.col.push(1, 1, 1, alpha);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  build({ colors = true, alphaColors = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (colors) {
      if (alphaColors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
      else {
        const c3 = new Float32Array((this.col.length / 4) * 3);
        for (let i = 0, k = 0; i < this.col.length; i += 4) {
          c3[k++] = this.col[i];
          c3[k++] = this.col[i + 1];
          c3[k++] = this.col[i + 2];
        }
        g.setAttribute('color', new THREE.BufferAttribute(c3, 3));
      }
    }
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
/** Compose a matrix from position + yaw/pitch/roll + scale (all numbers). */
export function mat4(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0, out = new THREE.Matrix4()) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}
export { _m as tmpMat };

/**
 * A flat ribbon along a polyline, lying on y. width in metres, u runs along length (tileLen metres per repeat), v 0..1.
 * `wobble` jitters the lateral position a few cm so hand-painted lines are not ruler straight.
 */
export function ribbonGeo(points, width, y, { tileLen = 4, wobble = 0, seed = 3, closed = false } = {}) {
  const r = mulberry32(seed);
  const n = points.length;
  const pos = [];
  const uv = [];
  const idx = [];
  const nor = [];
  let len = 0;
  let w0 = 0;
  let w1 = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    if (i > 0) len += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    if (wobble) {
      w0 += (r() - 0.5) * wobble * 0.6;
      w0 *= 0.92;
      w1 = w0;
    }
    const lx = -tz;
    const lz = tx;
    const hw = width / 2;
    pos.push(p.x + lx * (hw + w1), y, p.z + lz * (hw + w1), p.x - lx * (hw - w1), y, p.z - lz * (hw - w1));
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(len / tileLen, 0, len / tileLen, 1);
    if (i < n - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  void closed;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Soft radial gradient used for blob shadows and glows. */
export function radialTex(size = 64, stops = [[0, 'rgba(0,0,0,0.8)'], [1, 'rgba(0,0,0,0)']]) {
  const { c, g } = makeCanvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return toTexture(c);
}

// --- quality tier ----------------------------------------------------------------------------------------------
export const TIERS = {
  high: { name: 'high', tex: 1, crowd: 1, spots: 6, haze: true, netSegs: 14, trees: 1 },
  mid: { name: 'mid', tex: 1, crowd: 0.7, spots: 5, haze: true, netSegs: 10, trees: 0.7 },
  low: { name: 'low', tex: 0.5, crowd: 0.42, spots: 4, haze: false, netSegs: 7, trees: 0.45 },
};

/** `?q=low|mid|high` in the page URL forces a tier (testing and perf runs). */
export function urlTier() {
  try {
    const q = new URLSearchParams(location.search).get('q');
    return TIERS[q] ? q : null;
  } catch {
    return null;
  }
}

/** Pick a tier from viewport size and device hints. Phones and small windows get 'low'; weak laptops 'mid'. */
export function pickTier(width, height, hint) {
  if (hint && TIERS[hint]) return TIERS[hint];
  const forced = urlTier();
  if (forced) return TIERS[forced];
  const small = Math.min(width, height) < 520;
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const weak = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (small || (coarse && Math.min(width, height) < 700)) return TIERS.low;
  if (weak || Math.min(width, height) < 700 || (coarse && width < 1100)) return TIERS.mid;
  return TIERS.high;
}

/**
 * Sweep a (offset, height) profile around part of the ring. Each profile segment becomes its own strip (flat shading
 * across the profile, smooth along the ring). Traverse the profile in increasing offset: horizontal strips face up,
 * rising strips face the infield, falling strips face outward. uv.x = distance along the ring / uTile,
 * uv.y = distance along the profile / vTile (+ vOff).
 */
export function sweepRing(profile, { t0 = -Math.PI, t1 = Math.PI, segs = 160, uTile = 4, vTile = 4, uOff = 0, vOff = 0, arcOff = 0 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  const arc = ringArc(arcOff, 360);
  const sBase = arc.lenAt(t0);
  const p = new THREE.Vector3();
  let vAcc = 0;
  for (let k = 0; k < profile.length - 1; k++) {
    if (!profile[k] || !profile[k + 1]) continue; // a null entry breaks the polyline
    const [o0, y0] = profile[k];
    const [o1, y1] = profile[k + 1];
    const seg = Math.hypot(o1 - o0, y1 - y0);
    if (seg < 1e-5) continue;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = t0 + ((t1 - t0) * i) / segs;
      const u = (arc.lenAt(t) - sBase) / uTile + uOff;
      ringPoint(t, o0, p);
      pos.push(p.x, y0, p.z);
      uv.push(u, vOff + vAcc / vTile);
      ringPoint(t, o1, p);
      pos.push(p.x, y1, p.z);
      uv.push(u, vOff + (vAcc + seg) / vTile);
      if (i < segs) {
        const q = base + i * 2;
        idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
    }
    vAcc += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}
