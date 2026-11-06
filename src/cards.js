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

const loader = new THREE.TextureLoader();
const textures = {};
const pending = {};
function sheetTexture(sheet) {
  if (!pending[sheet]) {
    pending[sheet] = new Promise((res) => {
      loader.load(
        `art/${sheet}.webp`,
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

/** Resolves true once every sheet has loaded. */
export const artReady = () => Promise.all(Object.keys(ART_ATLAS).map(sheetTexture)).then((all) => all.every(Boolean));

// Shared by every batch, so the weather can grade all the art at once.
const TINT = { value: new THREE.Color(1, 1, 1) };
const GRADES = { clear: [0.95, 0.97, 1.02], breezy: [0.95, 0.97, 1.02], rain: [0.74, 0.78, 0.86], fog: [0.82, 0.86, 0.92], sunset: [1.1, 0.92, 0.78] };
export function setArtWeather(id) {
  const g = GRADES[id] || GRADES.clear;
  TINT.value.setRGB(g[0], g[1], g[2]);
}

const VERT = `
attribute vec3 aCenter; attribute vec2 aOff; attribute float aRot; attribute float aAlpha;
uniform float uFull; varying vec2 vUv; varying float vA;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vA = aAlpha;
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
uniform sampler2D map; uniform vec3 uTint; varying vec2 vUv; varying float vA;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(map, vUv);
  float a = c.a * vA;
  if (a < 0.3) discard;
  gl_FragColor = vec4(c.rgb * uTint, a);
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
  set(i, name, x, y, z, { h, span, anchor = 0, flip = false, rot = 0, alpha = 1, squash = 1 } = {}) {
    const f = CARDS[name];
    const A = ART_ATLAS[this.sheet];
    const aspect = f.w / f.h;
    const H = (span ? span / Math.max(aspect, 1) : h) * squash;
    const W = (span ? (span / Math.max(aspect, 1)) * aspect : h * aspect) / 2;
    const u0 = f.x / A.w;
    const u1 = (f.x + f.w) / A.w;
    const v1 = 1 - f.y / A.h;
    const v0 = 1 - (f.y + f.h) / A.h;
    const [ul, ur] = flip ? [u1, u0] : [u0, u1];
    const yb = -anchor * H;
    const yt = (1 - anchor) * H;
    const b = i * 4;
    this.off.set([-W, yb, W, yb, W, yt, -W, yt], b * 2);
    this.uv.set([ul, v0, ur, v0, ur, v1, ul, v1], b * 2);
    this.center.set([x, y, z, x, y, z, x, y, z, x, y, z], b * 3);
    this.rot.set([rot, rot, rot, rot], b);
    this.alpha.set([alpha, alpha, alpha, alpha], b);
    this.touch();
  }

  hide(i) {
    this.off.set([0, 0, 0, 0, 0, 0, 0, 0], i * 8);
    this.touch();
  }

  touch() {
    this.center.needsUpdate = this.off.needsUpdate = this.uv.needsUpdate = this.rot.needsUpdate = this.alpha.needsUpdate = true;
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
