// CARDS: painted art from art/ (keyed by scripts/build-art.mjs) drawn as camera-facing cards. One batch is one draw call,
// however many cards it holds, so swapping low-poly props and birds for art makes the scene cheaper, not dearer.
import * as THREE from 'three';
import { ART_ATLAS } from './artAtlas.js';

const item = (sheet, i) => ({ sheet, ...ART_ATLAS[sheet].items[i] });
const union = (sheet, ids) => {
  const r = ids.map((i) => ART_ATLAS[sheet].items[i]);
  const x = Math.min(...r.map((a) => a.x));
  const y = Math.min(...r.map((a) => a.y));
  return { sheet, x, y, w: Math.max(...r.map((a) => a.x + a.w)) - x, h: Math.max(...r.map((a) => a.y + a.h)) - y };
};

// Indexes follow the order build-art.mjs finds each sheet's items in.
export const CARDS = {
  flagWhite: item('kit-a', 5),
  flagRed: item('kit-a', 6),
  marker: item('kit-a', 0),
  cone: item('kit-a', 3),
  reel: item('kit-a', 2),
  prism: item('kit-a', 1),
  station: item('kit-a', 7),
  attempt: item('kit-a', 11),
  rake: item('kit-a', 13),
  broom: item('kit-a', 12),
  chair: item('kit-a', 10),
  pigeonPeck: item('kit-a', 21),
  pigeonFat: item('kit-a', 27),
  flapUp: item('kit-b', 19),
  flapMid: item('kit-b', 18),
  flapDown: item('kit-b', 21),
  glide: item('kit-b', 20),
  birdFront: item('kit-b', 26),
  birdBelow: item('kit-b', 25),
  feathers: union('kit-b', [22, 23]),
  cartSide: item('hotdog-a', 11),
  cartFront: item('hotdog-a', 12),
  cartQuarter: item('hotdog-a', 10),
  cartWreck: { sheet: 'hotdog-a', x: 1672, y: 274, w: 640, h: 994 }, // by hand: the auto cut catches the neighbour's umbrella
  dog1: item('hotdog-a', 0),
  dog2: item('hotdog-a', 1),
  dog3: item('hotdog-a', 13),
  dog4: item('hotdog-a', 17),
  sausage: item('hotdog-a', 2),
};

const NO_OPT = {};
const loader = new THREE.TextureLoader();
const textures = {};
const pending = {};
// Phones (the low tier) load half-size copies of the sheets: same layout, so the same UVs, at a quarter of the memory.
// A 2752x1536 sheet is ~21 MB of GPU memory with mips; the half copy is ~5 MB, and a card is never that big on a phone.
let half = false;
export function setArtQuality(tier) {
  half = tier === 'low';
}
export const artUrl = (sheet) => `art/${sheet}${half ? '-half' : ''}.webp`;
function sheetTexture(sheet) {
  if (!pending[sheet]) {
    pending[sheet] = new Promise((res) => {
      loader.load(
        artUrl(sheet),
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          textures[sheet] = t;
          res(t);
        },
        undefined,
        () => res(null), // a missing sheet leaves its cards hidden; the game itself never depends on art
      );
    });
  }
  return pending[sheet];
}

/** The sheets the game actually draws (a sheet nobody references is never downloaded or decoded). */
export const usedSheets = () => [...new Set(Object.values(CARDS).map((c) => c.sheet))];
/** Resolves true once every sheet in use has loaded. */
export const artReady = () => Promise.all(usedSheets().map(sheetTexture)).then((all) => all.every(Boolean));

// Shared by every batch, so the weather can grade all the art at once.
const TINT = { value: new THREE.Color(1, 1, 1) };
const GRADES = { clear: [0.95, 0.97, 1.02], breezy: [0.95, 0.97, 1.02], rain: [0.74, 0.78, 0.86], fog: [0.82, 0.86, 0.92], sunset: [1.1, 0.92, 0.78] };
export function setArtWeather(id) {
  const g = GRADES[id] || GRADES.clear;
  TINT.value.setRGB(g[0], g[1], g[2]);
}

const VERT = `
attribute vec3 aCenter; attribute vec2 aOff; attribute float aRot; attribute float aAlpha; attribute float aShade;
uniform float uFull; varying vec2 vUv; varying float vA; varying float vS;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vA = aAlpha; vS = aShade;
  float c = cos(aRot), s = sin(aRot);
  vec2 o = vec2(aOff.x * c - aOff.y * s, aOff.x * s + aOff.y * c);
  vec3 R, U;
  if (uFull > 0.5) {
    R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    U = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  } else {
    vec3 t = cameraPosition - aCenter; t.y = 0.0;
    R = normalize(vec3(t.z, 0.0, -t.x) + vec3(1e-5));
    U = vec3(0.0, 1.0, 0.0);
  }
  vec4 mvPosition = viewMatrix * vec4(aCenter + R * o.x + U * o.y, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `
uniform sampler2D map; uniform vec3 uTint; varying vec2 vUv; varying float vA; varying float vS;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(map, vUv);
  float a = c.a * vA;
  if (a < 0.3) discard;
  gl_FragColor = vec4(c.rgb * uTint * vS, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** A fixed pool of cards from one sheet. full = faces the camera completely (birds); otherwise stands upright (props). */
export class CardBatch {
  constructor(sheet, capacity, { full = false } = {}) {
    this.sheet = sheet;
    this.capacity = capacity;
    const geo = new THREE.BufferGeometry();
    const attr = (name, n) => {
      const a = new THREE.BufferAttribute(new Float32Array(capacity * 4 * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.center = attr('aCenter', 3);
    this.off = attr('aOff', 2);
    this.uv = attr('uv', 2);
    this.rot = attr('aRot', 1);
    this.alpha = attr('aAlpha', 1);
    this.shade = attr('aShade', 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 12), 3)); // unused: three expects it
    const idx = [];
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uFull: { value: full ? 1 : 0 }, uTint: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      side: THREE.DoubleSide,
      alphaToCoverage: true,
    });
    mat.uniforms.uTint = TINT;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.ready = sheetTexture(sheet).then((t) => {
      if (t) {
        mat.uniforms.map.value = t;
        mat.needsUpdate = true;
        this.mesh.visible = true;
      }
      return !!t;
    });
    for (let i = 0; i < capacity; i++) this.hide(i);
  }

  /** Place card i. Height in metres (or span: the longer side). anchor 0 = stands on y, 0.5 = centred on y. */
  /** Allocation-free: birds and carts are re-placed every frame. `widen` scales the width only (foreshortening). */
  set(i, name, x, y, z, o = NO_OPT) {
    const f = CARDS[name];
    const A = ART_ATLAS[this.sheet];
    const h = o.h;
    const span = o.span;
    const anchor = o.anchor || 0;
    const rot = o.rot || 0;
    const alpha = o.alpha ?? 1;
    const shade = o.shade ?? 1;
    const squash = o.squash ?? 1;
    const aspect = f.w / f.h;
    const H = (span ? span / Math.max(aspect, 1) : h) * squash;
    const W = ((span ? (span / Math.max(aspect, 1)) * aspect : h * aspect) / 2) * (o.widen ?? 1);
    const u0 = f.x / A.w;
    const u1 = (f.x + f.w) / A.w;
    const v1 = 1 - f.y / A.h;
    const v0 = 1 - (f.y + f.h) / A.h;
    const ul = o.flip ? u1 : u0;
    const ur = o.flip ? u0 : u1;
    const yb = -anchor * H;
    const yt = (1 - anchor) * H;
    const b = i * 4;
    const off = this.off.array;
    const uv = this.uv.array;
    const c = this.center.array;
    let k = b * 2;
    off[k] = -W; off[k + 1] = yb; off[k + 2] = W; off[k + 3] = yb; off[k + 4] = W; off[k + 5] = yt; off[k + 6] = -W; off[k + 7] = yt;
    uv[k] = ul; uv[k + 1] = v0; uv[k + 2] = ur; uv[k + 3] = v0; uv[k + 4] = ur; uv[k + 5] = v1; uv[k + 6] = ul; uv[k + 7] = v1;
    k = b * 3;
    for (let j = 0; j < 4; j++, k += 3) {
      c[k] = x;
      c[k + 1] = y;
      c[k + 2] = z;
    }
    const r = this.rot.array;
    const a = this.alpha.array;
    const sh = this.shade.array;
    for (let j = b; j < b + 4; j++) {
      r[j] = rot;
      a[j] = alpha;
      sh[j] = shade;
    }
    this.touch();
  }

  hide(i) {
    this.off.array.fill(0, i * 8, i * 8 + 8);
    this.touch();
  }

  touch() {
    this.center.needsUpdate = this.off.needsUpdate = this.uv.needsUpdate = this.rot.needsUpdate = this.alpha.needsUpdate = this.shade.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Props that never move: collect them while the venue builds, then one batch per sheet. */
export class StaticCards {
  constructor() {
    this.list = [];
  }

  add(name, x, z, h, o = {}) {
    this.list.push({ name, x, y: o.y || 0, z, opt: { h, ...o } });
  }

  build(root, keep) {
    for (const sheet of new Set(this.list.map((c) => CARDS[c.name].sheet))) {
      const cards = this.list.filter((c) => CARDS[c.name].sheet === sheet);
      const batch = new CardBatch(sheet, cards.length);
      cards.forEach((c, i) => batch.set(i, c.name, c.x, c.y, c.z, c.opt));
      batch.mesh.name = 'cards-' + sheet;
      root.add(batch.mesh);
      keep(batch.mesh.geometry);
      keep(batch.mesh.material);
    }
  }
}
