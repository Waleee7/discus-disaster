// Athlete, discus, measuring tape and landing flag.
import * as THREE from 'three';
import { DEG } from './physics.js';

export const DISCUS_VIS_SCALE = 1.7; // broadcast scale: a real 22 cm disc is invisible from the follow cam

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, ...o });

export function buildDiscus() {
  // lathe profile: top surface from centre to rim, then mirrored bottom (metres, real 221 mm diameter / ~44 mm rim)
  const top = [
    [0.0, 0.012],
    [0.04, 0.0125],
    [0.08, 0.017],
    [0.1, 0.0215],
    [0.108, 0.0225],
    [0.1105, 0.015],
    [0.1105, 0.0],
  ];
  const pts = [...top.map(([r, y]) => new THREE.Vector2(r, y)), ...top.slice(0, -1).reverse().map(([r, y]) => new THREE.Vector2(r, -y))];
  const geo = new THREE.LatheGeometry(pts, 40);
  const colors = [];
  const p = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i));
    c.setHex(r > 0.105 ? 0xc9ced4 : r < 0.02 ? 0xe6ebf0 : 0xff7a10);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.32, emissive: 0x2a1204, side: THREE.DoubleSide });
  const body = new THREE.Mesh(geo, mat);
  body.scale.setScalar(DISCUS_VIS_SCALE);
  const g = new THREE.Group();
  g.add(body);
  return { group: g, body, dispose: () => (geo.dispose(), mat.dispose()) };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (k) => 1 - Math.pow(1 - clamp01(k), 3);

function numberTexture(num, fg, outline) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  x.font = '700 104px Oswald, Impact, "Arial Narrow", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 12;
  x.strokeStyle = outline;
  x.lineJoin = 'round';
  x.strokeText(String(num), 64, 70);
  x.fillStyle = fg;
  x.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- athlete -------------------------------------------------------------------------------------------------------
// Profiles for the tapered limbs: [y, radius] from the joint down (lathe, closed at both ends). Real throwers are big:
// heavy thighs, a calf bulge, thick forearms. Lengths match the joints below, so the pose maths is unchanged.
const THIGH = [[0.035, 0], [0.0, 0.096], [-0.1, 0.104], [-0.24, 0.09], [-0.36, 0.074], [-0.42, 0.066], [-0.445, 0]];
const SHIN = [[0.03, 0], [0.0, 0.066], [-0.07, 0.075], [-0.15, 0.072], [-0.27, 0.056], [-0.37, 0.044], [-0.41, 0.043], [-0.43, 0]];
const UPPER_ARM = [[0.03, 0], [0.0, 0.066], [-0.07, 0.07], [-0.17, 0.062], [-0.27, 0.052], [-0.33, 0]];
const FOREARM = [[0.02, 0], [0.0, 0.054], [-0.06, 0.058], [-0.2, 0.043], [-0.27, 0.036], [-0.3, 0]];
const TORSO = [[-0.06, 0], [-0.045, 0.148], [0.05, 0.165], [0.16, 0.172], [0.3, 0.196], [0.42, 0.206], [0.5, 0.19], [0.56, 0.13], [0.6, 0.07], [0.62, 0]];
const TORSO_SX = 1.12;
const TORSO_SZ = 0.7;
// LatheGeometry wants the profile bottom-to-top (outward normals, front-facing winding)
const lathe = (prof, seg = 12) => new THREE.LatheGeometry([...prof].sort((a, b) => a[0] - b[0]).map(([y, r]) => new THREE.Vector2(r, y)), seg);

/**
 * Merges the athlete's parts into ONE skinned mesh: every vertex rides one bone (rigid skinning), the bones mirror the
 * old node hierarchy, so idle / spin / release / walk set rotations exactly as before but the whole body is a single
 * draw call (it was ~45), and a single shadow-map draw. Per-vertex colour plus a per-vertex surface (roughness, glow).
 */
class SkinBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.surf = [];
    this.si = [];
    this.sw = [];
    this.idx = [];
  }

  add(geo, bone, boneIndex, local, color, rough = 0.6, glow = 0) {
    const m = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, local || new THREE.Matrix4());
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      // a touch of baked occlusion: undersides a little darker than tops
      const ao = 0.86 + 0.14 * Math.max(0, Math.min(1, v.y * 0.5 + 0.6));
      this.col.push(c.r * ao, c.g * ao, c.b * ao);
      this.surf.push(rough, glow);
      this.si.push(boneIndex, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    geo.dispose();
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Athlete skin/fabric material: per-vertex roughness + glow, and a rim light the cinematic shots can aim. */
function athleteMaterial() {
  const rim = { col: { value: new THREE.Color(0.32, 0.27, 0.22) }, dir: { value: new THREE.Vector3(-0.5, 0.45, -0.75).normalize() } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimCol = rim.col;
    sh.uniforms.uRimDir = rim.dir;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSurf;\nvarying vec2 vSurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSurf;\nuniform vec3 uRimCol;\nuniform vec3 uRimDir;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurf.x;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSurf.y;')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 rdv = normalize((viewMatrix * vec4(uRimDir, 0.0)).xyz);
          float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
          outgoingLight += uRimCol * fres * clamp(dot(normal, rdv) * 0.7 + 0.45, 0.0, 1.0);
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'dd-athlete-1';
  return { mat, rim };
}

/**
 * The athlete: one skinned mesh on a joint hierarchy (hip, knee, foot, shoulder, elbow, hand), singlet with a number on
 * the chest and back, shorts, socks, throwing shoes, hair / headband / shades per persona. Faces -Z at facing 0 (the
 * throw direction); the throwing arm is the right one (+X). Poses are pure functions of their arguments, so the replay
 * and the live game drive it the same way: idle(t), spin(rot, power), release(k), walk(phase, k).
 */
export function buildThrower(persona = null) {
  const col = persona ? persona.colors : { jersey: 0xff8a1f, trim: 0xffffff, shorts: 0x10131c, skin: 0xc98a5e, hair: 0x15110e, shoes: 0xffffff, accent: 0xffd23f };
  const look = persona ? persona.look : { hair: 'short', headband: true };
  const num = persona ? persona.number : 7;
  const g = new THREE.Group();
  const extraMats = [];
  const bones = [];
  const bone = (parent, x = 0, y = 0, z = 0) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    bones.push(b);
    return b;
  };
  const hips = bone(g, 0, 0.98, 0);
  const leg = (s) => {
    const hip = bone(hips, s * 0.115, -0.04, 0);
    const knee = bone(hip, 0, -0.42, 0);
    const foot = bone(knee, 0, -0.43, 0);
    return { hip, knee, foot };
  };
  const legR = leg(1);
  const legL = leg(-1);
  const torso = bone(hips, 0, 0.06, 0);
  const head = bone(torso, 0, 0.8, 0);
  const arm = (s) => {
    const sh = bone(torso, s * 0.27, 0.5, 0);
    const elbow = bone(sh, s * 0.32, 0, 0);
    const hand = bone(elbow, s * 0.3, 0, 0);
    return { sh, elbow, hand };
  };
  const armR = arm(1);
  const armL = arm(-1);
  g.updateMatrixWorld(true);

  // ---- geometry, baked at the rest pose -------------------------------------------------------------------------
  const B = new SkinBuilder();
  const bi = (b) => bones.indexOf(b);
  const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const put = (geo, b, local, color, rough, glow) => B.add(geo, b, bi(b), local, color, rough, glow);
  const skin = col.skin;
  const jersey = col.jersey;
  const R_SKIN = 0.52; // a sheen of sweat under the floods
  const R_CLOTH = 0.82;

  // pelvis + shorts
  put(new THREE.CapsuleGeometry(0.165, 0.1, 4, 12), hips, M4(0, -0.02, 0, 0, 0, 0, 1.22, 1, 0.82), col.shorts, R_CLOTH);
  for (const L of [legR, legL]) {
    const s = L === legR ? 1 : -1;
    put(lathe(THIGH, 12), L.hip, null, skin, R_SKIN);
    put(new THREE.CylinderGeometry(0.112, 0.104, 0.2, 12), L.hip, M4(0, -0.07, 0), col.shorts, R_CLOTH); // shorts leg
    put(new THREE.SphereGeometry(0.062, 10, 8), L.knee, M4(0, 0, -0.004), skin, R_SKIN); // knee
    put(lathe(SHIN, 12), L.knee, M4(0, 0, 0.008, 0, 0, 0, 1, 1, 1.06), skin, R_SKIN);
    const sockC = look.mismatch && s > 0 ? col.accent : 0xf2f4f8;
    put(new THREE.CylinderGeometry(0.047, 0.044, 0.13, 10), L.knee, M4(0, -0.37, 0), sockC, 0.9);
    // throwing shoe: low, round-toed, flat sole (no spikes in the circle)
    const shoeC = look.mismatch && s < 0 ? 0xf4f8ff : col.shoes;
    put(new THREE.CapsuleGeometry(0.052, 0.15, 4, 10), L.foot, M4(0, -0.035, -0.065, Math.PI / 2, 0, 0, 1, 1, 0.78), shoeC, 0.45);
    put(new THREE.BoxGeometry(0.1, 0.022, 0.25), L.foot, M4(0, -0.072, -0.065), 0x15171c, 0.7);
  }
  // torso: a tapered singlet (V-taper, flattened front to back) with trim at the hem, neck and arm holes
  put(lathe(TORSO, 18), torso, M4(0, 0.02, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ), jersey, R_CLOTH, 0.1);
  const hem = new THREE.TorusGeometry(0.17, 0.016, 6, 22);
  hem.rotateX(Math.PI / 2);
  put(hem, torso, M4(0, -0.01, 0, 0, 0, 0, TORSO_SX * 0.98, 1, TORSO_SZ * 0.98), col.trim, R_CLOTH, 0.1);
  const collar = new THREE.TorusGeometry(0.085, 0.015, 6, 18);
  collar.rotateX(Math.PI / 2);
  put(collar, torso, M4(0, 0.585, 0, 0, 0, 0, 1.1, 1, 0.9), col.trim, R_CLOTH, 0.1);
  put(new THREE.CylinderGeometry(0.062, 0.072, 0.14, 12), torso, M4(0, 0.66, 0.0), skin, R_SKIN); // neck
  // trapezius + deltoids: skin (a singlet leaves the shoulders bare)
  for (const s of [-1, 1]) put(new THREE.SphereGeometry(0.07, 10, 8), torso, M4(s * 0.13, 0.55, 0.012, 0, 0, s * 0.42, 1.3, 0.48, 0.82), skin, R_SKIN);
  for (const A of [armR, armL]) {
    const s = A === armR ? 1 : -1;
    put(new THREE.SphereGeometry(0.071, 12, 10), A.sh, M4(s * 0.012, 0.004, 0, 0, 0, 0, 1.08, 1, 0.96), skin, R_SKIN);
    put(lathe(UPPER_ARM, 10), A.sh, M4(0, 0, 0, 0, 0, s * Math.PI / 2), skin, R_SKIN);
    put(new THREE.SphereGeometry(0.05, 8, 6), A.elbow, null, skin, R_SKIN);
    put(lathe(FOREARM, 10), A.elbow, M4(0, 0, 0, 0, 0, s * Math.PI / 2), skin, R_SKIN);
    put(new THREE.CapsuleGeometry(0.038, 0.07, 4, 8), A.hand, M4(s * 0.03, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.62), skin, R_SKIN); // palm + fingers
    put(new THREE.CapsuleGeometry(0.016, 0.04, 3, 6), A.hand, M4(s * 0.005, 0, -0.04, 0.6, 0, 0), skin, R_SKIN); // thumb
    put(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), A.elbow, M4(s * 0.275, 0, 0, 0, 0, Math.PI / 2), col.accent, 0.8, 0.15); // wristband
  }
  // head: skull, jaw, nose, ears, eyes, brow
  put(new THREE.SphereGeometry(0.118, 18, 14), head, M4(0, 0.01, 0.005, 0, 0, 0, 0.93, 1.06, 1), skin, R_SKIN);
  put(new THREE.SphereGeometry(0.088, 14, 10), head, M4(0, -0.052, -0.022, 0, 0, 0, 1, 0.82, 1), skin, R_SKIN); // jaw
  put(new THREE.ConeGeometry(0.022, 0.06, 8), head, M4(0, -0.01, -0.118, -1.3, 0, 0), skin, R_SKIN);
  for (const s of [-1, 1]) {
    put(new THREE.SphereGeometry(0.026, 8, 6), head, M4(s * 0.11, -0.005, 0.005, 0, 0, 0, 0.6, 1, 1), skin, R_SKIN);
    put(new THREE.SphereGeometry(0.015, 8, 6), head, M4(s * 0.04, 0.018, -0.103), 0x0d0f14, 0.3);
    put(new THREE.BoxGeometry(0.05, 0.012, 0.02), head, M4(s * 0.042, 0.042, -0.104, 0, 0, s * -0.12), col.hair, 0.9);
  }
  put(new THREE.BoxGeometry(0.05, 0.008, 0.012), head, M4(0, -0.058, -0.106), 0x5a2a22, 0.6); // mouth
  const hairC = col.hair;
  if (look.hair === 'spikes') {
    put(new THREE.SphereGeometry(0.121, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), head, M4(0, 0.016, 0.006), hairC, 0.9);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      put(new THREE.ConeGeometry(0.026, 0.085, 6), head, M4(Math.cos(a) * 0.065, 0.12, Math.sin(a) * 0.065 + 0.01, Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55), hairC, 0.9);
    }
    put(new THREE.ConeGeometry(0.03, 0.1, 6), head, M4(0, 0.15, 0.01), hairC, 0.9);
  } else if (look.hair === 'puff') {
    for (const [x, y, z, r] of [[0, 0.13, 0.03, 0.125], [-0.09, 0.09, 0.04, 0.09], [0.09, 0.09, 0.04, 0.09], [0, 0.07, 0.1, 0.1], [0, 0.11, -0.03, 0.09]]) put(new THREE.SphereGeometry(r, 12, 9), head, M4(x, y, z), hairC, 0.95);
  } else {
    put(new THREE.SphereGeometry(0.121, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.47), head, M4(0, 0.018, 0.012), hairC, 0.9);
  }
  if (look.headband) {
    const hb = new THREE.TorusGeometry(0.114, 0.018, 6, 22);
    hb.rotateX(Math.PI / 2);
    put(hb, head, M4(0, 0.06, 0.004, 0, 0, 0, 0.95, 1, 1.02), col.accent, 0.8, 0.2);
  }
  if (look.shades) put(new THREE.BoxGeometry(0.19, 0.04, 0.03), head, M4(0, 0.024, -0.106), 0x0b0c10, 0.12);
  if (look.beard) put(new THREE.SphereGeometry(0.094, 12, 8, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.45), head, M4(0, -0.04, -0.018, 0, 0, 0, 1, 1, 1.04), hairC, 0.95);

  const { mat, rim } = athleteMaterial();
  const body = new THREE.SkinnedMesh(B.build(), mat);
  body.frustumCulled = false;
  body.add(hips); // the root bone lives under the mesh, as glTF rigs do
  g.add(body);
  g.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(bones));

  // chest / back numbers: small decal planes riding the torso bone
  const numFg = '#' + new THREE.Color(col.trim).getHexString();
  const backTex = numberTexture(num, numFg, 'rgba(8,10,16,0.85)');
  const backM = new THREE.MeshBasicMaterial({ map: backTex, transparent: true, depthWrite: false, polygonOffsetFactor: -2, polygonOffset: true });
  backM.color.setScalar(0.8);
  extraMats.push(backM);
  const depth = 0.206 * TORSO_SZ + 0.006; // the singlet's half-depth at chest height, plus a hair
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), backM);
  back.position.set(0, 0.36, depth);
  torso.add(back);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.19), backM);
  front.position.set(0, 0.4, -depth);
  front.rotation.y = Math.PI;
  torso.add(front);
  g.userData = { shoulder: armR.sh, hand: armR.hand };

  const D = DEG;
  // technique pose (techniques.js `pose`); the neutral style reproduces the original animation exactly
  const NEUTRAL = { crouch: 1, spread: 0, lean: 0, arm: 0, bob: 1 };
  let S = NEUTRAL;
  const set = (n, x = 0, y = 0, z = 0) => n.rotation.set(x, y, z);
  const stance = (hipY) => {
    hips.position.y = hipY;
  };
  const rest = (feet = true) => {
    if (feet) {
      set(legR.foot);
      set(legL.foot);
    }
    set(armR.hand);
    set(armL.hand);
  };
  const POSE_BONES = bones;
  const api = {
    group: g,
    body,
    hand: armR.hand,
    shoulder: armR.sh,
    rim,
    /** Bend the athlete for a technique: { crouch, spread, lean, arm, bob } (see techniques.js). No argument = neutral. */
    setStyle(pose) {
      S = { ...NEUTRAL, ...(pose || {}) };
    },
    /** psi = heading in degrees (+ right), physics convention. */
    setFacing(psi) {
      g.rotation.y = -psi * DEG;
    },
    /**
     * Wind-up stance in the circle: breathing, weight shifting foot to foot, and every few seconds a slow
     * preliminary swing of the discus arm (the real pre-spin ritual). The discus stays in view.
     */
    idle(t = 0) {
      const br = Math.sin(t * 2.2);
      const cyc = (t % 5.2) / 5.2;
      const sw = cyc < 0.62 ? Math.sin((cyc / 0.62) * Math.PI) ** 2 : 0; // one swing back and through, then a pause
      const shift = Math.sin(t * 0.7) * 0.5;
      rest();
      stance(0.93 + br * 0.006 - sw * 0.012);
      set(hips, 0, -0.08 * sw, 0.012 * shift);
      set(torso, 0.06 + br * 0.015, -0.32 * sw, -0.01 * shift);
      set(head, -0.04, 0.22 * sw, 0);
      set(legR.hip, 0.3, 0, -0.2);
      set(legR.knee, -0.5 - 0.06 * sw, 0, 0);
      set(legL.hip, 0.3, 0, 0.2);
      set(legL.knee, -0.5, 0, 0);
      set(armR.sh, 0, -0.2 - 0.85 * sw, -0.1 + br * 0.015 + 0.12 * sw);
      set(armR.elbow, 0, -0.1, 0);
      set(armL.sh, 0, -0.55 + 0.25 * sw, -0.35);
      set(armL.elbow, 0, -0.7, 0);
    },
    /**
     * Mid-spin. rot = degrees turned so far (drives the knee bob), p = power 0..1. The hips lead and the shoulders
     * lag, so the discus arm trails behind the body and visibly "whips round" as the whole figure rotates.
     */
    spin(rot, p) {
      const w = rot * D;
      const bob = (Math.sin(w * 2 - 0.6) * 0.5 + 0.5) * S.bob; // two dips per turn
      rest();
      stance(0.93 - 0.08 * S.crouch * (0.3 + 0.7 * p) * bob);
      const crouch = (0.35 + 0.35 * p * bob) * S.crouch;
      set(hips, 0, 0.18 * p, 0);
      set(torso, 0.12 + 0.1 * p + S.lean, -(0.25 + 0.55 * p), -0.12 * p);
      set(head, -0.05, 0.25 + 0.3 * p, 0.0);
      set(legR.hip, crouch, 0, -0.26 - S.spread);
      set(legR.knee, -crouch * 1.5, 0, 0);
      set(legL.hip, crouch * 0.8, 0, 0.26 + S.spread);
      set(legL.knee, -crouch * 1.3, 0, 0);
      // the right foot pivots on the ball through each turn
      set(legR.foot, -0.25 * bob, 0, 0);
      set(armR.sh, 0, -(0.35 + 0.8 * p), 0.05 + 0.2 * p + S.arm);
      set(armR.elbow, 0, -0.08, 0);
      set(armL.sh, 0, -(0.9 + 0.2 * p), -0.15);
      set(armL.elbow, 0, -0.9, 0);
    },
    /** Release + follow-through, k = 0 (the instant of release) .. 1 (settled). Whip forward, back leg lifts. */
    release(k) {
      const e = easeOut(k * 2.4);
      const settle = easeOut((k - 0.35) / 0.65);
      rest();
      stance(0.93 - 0.02 * (1 - e) + 0.05 * Math.sin(Math.PI * clamp01(k * 1.6)));
      set(hips, 0, 0.1 * (1 - e) + 0.3 * e, 0);
      set(torso, 0.1 - 0.12 * e + S.lean * (1 - e * 0.6), -0.85 + 1.5 * e - 0.25 * settle, 0.1 * e);
      set(head, -0.05, 0.3 - 0.5 * e, 0);
      set(armR.sh, 0, -1.15 + 1.9 * e - 0.35 * settle, 0.05 + 0.55 * e + S.arm);
      set(armR.elbow, 0, -0.08 + 0.1 * e, 0);
      set(armL.sh, 0, -1.0 + 1.4 * e, -0.2 - 0.3 * e);
      set(armL.elbow, 0, -0.9 + 0.9 * e, 0);
      set(legL.hip, 0.2 + 0.1 * e, 0, 0.2 + S.spread * 0.5);
      set(legL.knee, -0.3 - 0.2 * e, 0, 0);
      set(legR.hip, -0.1 - 0.7 * e * (1 - settle * 0.6), 0, -0.2 - S.spread * 0.5);
      set(legR.knee, -0.2 - 0.9 * e * (1 - settle * 0.6), 0, 0);
      set(legR.foot, 0.35 * e * (1 - settle), 0, 0);
    },
    /**
     * Walking. phase in strides (1 = right + left step), k = 0 (standing) .. 1 (full stride), carry = the discus hand
     * stays tucked. Hips bob twice a stride, pelvis and shoulders counter-rotate, arms swing against the legs.
     */
    walk(phase, k = 1, carry = true) {
      const w = phase * Math.PI * 2;
      const s = Math.sin(w);
      const c = Math.cos(w);
      stance(0.955 - 0.012 * k + 0.02 * k * Math.cos(2 * w));
      set(hips, 0, 0.11 * s * k, 0.035 * c * k);
      set(torso, 0.045 * k, -0.15 * s * k, -0.025 * c * k);
      set(head, -0.035, 0.06 * s * k, 0.015 * c * k);
      const legPose = (L, ph) => {
        set(L.hip, 0.4 * Math.sin(ph) * k, 0, 0);
        const bend = Math.max(0, Math.cos(ph + 1.0));
        set(L.knee, -(0.05 + 0.75 * bend * bend) * k, 0, 0);
        set(L.foot, (0.3 * Math.max(0, -Math.sin(ph + 0.4)) - 0.12 * Math.max(0, Math.sin(ph))) * k, 0, 0);
      };
      legPose(legR, w);
      legPose(legL, w + Math.PI);
      set(armR.sh, (carry ? -0.12 : -0.32) * s * k + 0.05, 0, -1.3);
      set(armR.elbow, 0, carry ? 0.5 : 0.28, 0);
      set(armL.sh, 0.32 * s * k + 0.05, 0, 1.3);
      set(armL.elbow, 0, -0.3, 0);
      set(armR.hand, 0, 0, carry ? 0.25 : 0);
      set(armL.hand);
    },
    /** Arms loose and shaken out (the last ritual before stepping in), u 0..1. */
    shake(t, u) {
      const a = Math.sin(t * 34) * 0.12 * u;
      set(armR.sh, a, 0, -1.25 + a);
      set(armL.sh, -a, 0, 1.25 - a);
      set(armR.elbow, 0, 0.2, 0);
      set(armL.elbow, 0, -0.2, 0);
    },
    /** Snapshot / restore every joint (the replay renders a past pose into the jumbotron, then puts the live one back). */
    getPose(out = []) {
      let i = 0;
      out[i++] = g.rotation.y;
      out[i++] = hips.position.y;
      for (const b of POSE_BONES) {
        out[i++] = b.quaternion.x;
        out[i++] = b.quaternion.y;
        out[i++] = b.quaternion.z;
        out[i++] = b.quaternion.w;
      }
      return out;
    },
    setPose(p) {
      let i = 0;
      g.rotation.y = p[i++];
      hips.position.y = p[i++];
      for (const b of POSE_BONES) {
        b.quaternion.set(p[i], p[i + 1], p[i + 2], p[i + 3]);
        i += 4;
      }
    },
    dispose() {
      body.geometry.dispose();
      body.skeleton.dispose();
      mat.dispose();
      back.geometry.dispose();
      front.geometry.dispose();
      extraMats.forEach((m) => m.dispose());
      backTex.dispose();
    },
  };
  api.idle(0);
  return api;
}

/** "Beat the rival" target: a coloured line across the sector at the rival's best mark, a flag and a name tag. */
export function buildRivalMarker() {
  const group = new THREE.Group();
  group.visible = false;
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const poleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 512;
  tagCanvas.height = 128;
  const tagTex = new THREE.CanvasTexture(tagCanvas);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  tag.center.set(0.5, 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 5.2, 6), poleMat);
  pole.position.y = 2.6;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(2.2, -0.5);
  shape.lineTo(0, -1.1);
  const pennant = new THREE.Mesh(new THREE.ShapeGeometry(shape), poleMat);
  pennant.position.set(0.05, 5.15, 0);
  const flag = new THREE.Group();
  flag.add(pole, pennant, tag);
  tag.position.y = 5.4;
  group.add(flag);
  let line = null;
  const state = { scale: 1 };
  const api = {
    group,
    /** range = metres from the circle edge (the mark), az = degrees off the centre line where the flag stands. */
    set({ mark, az, color, label }) {
      const R = 1.25 + mark;
      if (line) {
        line.geometry.dispose();
        group.remove(line);
      }
      const half = 17.46 * DEG;
      line = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R + 0.3, 80, 1, Math.PI / 2 - half, half * 2), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.y = 0.075;
      group.add(line);
      const c = '#' + new THREE.Color(color).getHexString();
      lineMat.color.set(color);
      poleMat.color.set(color);
      const x = tagCanvas.getContext('2d');
      x.clearRect(0, 0, 512, 128);
      x.fillStyle = 'rgba(6,8,15,0.88)';
      x.fillRect(0, 14, 512, 100);
      x.fillStyle = c;
      x.fillRect(0, 14, 14, 100);
      x.font = '700 44px Oswald, Impact, "Arial Narrow", sans-serif';
      x.textAlign = 'left';
      x.textBaseline = 'middle';
      x.fillStyle = '#f4f8ff';
      x.fillText(label, 30, 44);
      x.font = '700 40px "JetBrains Mono", ui-monospace, monospace';
      x.fillStyle = c;
      x.fillText(`${mark.toFixed(1)} m`, 30, 88);
      tagTex.needsUpdate = true;
      const a = az * DEG;
      flag.position.set(R * Math.sin(a), 0, -R * Math.cos(a));
      api.setScale(state.scale);
      group.visible = true;
    },
    /** Bigger tag on narrow (portrait) screens where the mark is far away and tiny. */
    setScale(k) {
      state.scale = k;
      tag.scale.set(13 * k, 3.25 * k, 1);
      pennant.scale.setScalar(k);
      pole.scale.set(k, 1, k);
    },
    hide() {
      group.visible = false;
    },
    dispose() {
      if (line) line.geometry.dispose();
      lineMat.dispose();
      poleMat.dispose();
      pole.geometry.dispose();
      pennant.geometry.dispose();
      tag.material.dispose();
      tagTex.dispose();
    },
  };
  return api;
}

/** Measuring tape + flag that grows from the circle edge to the landing mark. */
export function buildTape() {
  const group = new THREE.Group();
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#ffd23f';
    x.fillRect(0, 0, 32, 128);
    x.fillStyle = '#10131c';
    for (let i = 0; i < 4; i++) x.fillRect(0, i * 32, i === 0 ? 32 : 14, i === 0 ? 5 : 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1), mat);
  tape.rotation.x = -Math.PI / 2;
  tape.position.y = 0.06;
  group.add(tape);
  // flag
  const flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 8), M(0xe9e2d5));
  pole.position.y = 1.5;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1.5, -0.35);
  shape.lineTo(0, -0.8);
  const pennant = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffb020, side: THREE.DoubleSide, toneMapped: false }));
  pennant.position.set(0.03, 2.95, 0);
  flag.add(pole, pennant);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  flag.add(ring);
  group.add(flag);
  group.visible = false;
  const state = { len: 0, r0: 1.25 };
  return {
    group,
    flag,
    /** Place along azimuth psi (deg, + right), landing at radius `range` from centre. progress 0..1 */
    set(range, psiDeg, progress, foul = false) {
      const r0 = state.r0;
      const len = Math.max(0.01, (range - r0) * progress);
      group.visible = true;
      group.rotation.y = -psiDeg * DEG;
      tape.visible = !foul;
      pennant.material.color.set(foul ? 0xff4d4d : 0xffb020);
      ringMat.color.set(foul ? 0xff4d4d : 0xffb020);
      // the mark is a long way off on a portrait phone: widen the tape and grow the flag with the throw so it reads
      tape.scale.set(1 + range / 60, len, 1);
      flag.scale.setScalar(1 + range / 45);
      tape.position.z = -(r0 + len / 2);
      tex.repeat.set(1, len / 1.5);
      flag.position.set(0, 0, -(r0 + len));
      flag.visible = progress > 0.02;
      ring.scale.setScalar(1 + (1 - progress) * 0.0 + 0.12 * Math.sin(performance.now() / 160));
    },
    hide() {
      group.visible = false;
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== mat) o.material.dispose();
      });
    },
  };
}

/** Soft blob shadow that follows the discus on the ground. */
export function buildBlobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.045;
  return m;
}

/** A scuffed divot where the discus lands: torn turf and soil, soft edged, along the line of flight. */
export function buildDivot() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(46,34,22,0.95)');
  gr.addColorStop(0.45, 'rgba(58,44,28,0.75)');
  gr.addColorStop(0.75, 'rgba(40,52,24,0.35)');
  gr.addColorStop(1, 'rgba(30,40,20,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  // torn tufts at the leading edge
  x.fillStyle = 'rgba(70,96,40,0.55)';
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 22;
    x.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r * 0.6 - 10, 3, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 1.25),
    new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  m.visible = false;
  m.name = 'divot';
  return m;
}
