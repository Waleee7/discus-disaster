// Athlete, discus, measuring tape and landing flag.
import * as THREE from 'three';
import { DEG } from './physics.js';

export const DISCUS_VIS_SCALE = 2.4; // broadcast scale: a real 22 cm disc is invisible from the follow cam

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
    c.setHex(r > 0.099 ? 0xff7a10 : r < 0.045 ? 0xf4f8ff : 0x303744);
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

/**
 * Stylised athlete built from primitives: capsule limbs on real joints (hip, knee, shoulder, elbow), jersey with a
 * number on the chest and back, shorts, socks, shoes, hair / headband / shades per persona. Faces -Z at facing 0
 * (the throw direction); the throwing arm is the right one (+X). Poses are pure functions of their arguments, so
 * the replay and the live game drive it the same way: idle(t), spin(rot, power), release(k).
 */
export function buildThrower(persona = null) {
  const col = persona ? persona.colors : { jersey: 0xff8a1f, trim: 0xffffff, shorts: 0x10131c, skin: 0xc98a5e, hair: 0x15110e, shoes: 0xffffff, accent: 0xffd23f };
  const look = persona ? persona.look : { hair: 'short', headband: true };
  const num = persona ? persona.number : 7;
  const g = new THREE.Group();
  const mats = [];
  const mat = (color, o = {}) => {
    const m = M(color, o);
    mats.push(m);
    return m;
  };
  const skin = mat(col.skin);
  const jersey = mat(col.jersey, { emissive: new THREE.Color(col.jersey).multiplyScalar(0.18) });
  const trim = mat(col.trim);
  const shorts = mat(col.shorts);
  const hairM = mat(col.hair, { roughness: 0.9 });
  const dark = mat(0x10131c);
  const white = mat(0xf4f8ff);
  const shoeM = mat(col.shoes);
  const accentM = mat(col.accent, { emissive: new THREE.Color(col.accent).multiplyScalar(0.25) });
  const node = (parent, x = 0, y = 0, z = 0) => {
    const n = new THREE.Group();
    n.position.set(x, y, z);
    parent.add(n);
    return n;
  };
  const mesh = (parent, geo, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  const hips = node(g, 0, 0.98, 0);
  const pelvis = mesh(hips, new THREE.CapsuleGeometry(0.16, 0.08, 4, 10), shorts, 0, -0.02, 0);
  pelvis.scale.set(1.25, 1, 0.85);

  const leg = (s, sockM, shoe) => {
    const hip = node(hips, s * 0.12, -0.04, 0);
    mesh(hip, new THREE.CapsuleGeometry(0.1, 0.1, 4, 8), shorts, 0, -0.06, 0); // short leg of the shorts
    mesh(hip, new THREE.CapsuleGeometry(0.088, 0.26, 4, 8), skin, 0, -0.24, 0); // thigh
    const knee = node(hip, 0, -0.42, 0);
    mesh(knee, new THREE.SphereGeometry(0.075, 10, 8), skin);
    mesh(knee, new THREE.CapsuleGeometry(0.072, 0.28, 4, 8), skin, 0, -0.2, 0); // shin
    mesh(knee, new THREE.CylinderGeometry(0.07, 0.066, 0.17, 10), sockM, 0, -0.33, 0); // sock
    const foot = node(knee, 0, -0.43, 0);
    const shoeBody = mesh(foot, new THREE.CapsuleGeometry(0.058, 0.13, 4, 8), shoe, 0, -0.03, -0.07);
    shoeBody.rotation.x = Math.PI / 2;
    shoeBody.scale.set(1, 1, 0.8);
    mesh(foot, new THREE.BoxGeometry(0.1, 0.02, 0.2), dark, 0, -0.075, -0.075); // sole
    return { hip, knee };
  };
  const legR = leg(1, look.mismatch ? accentM : white, shoeM);
  const legL = leg(-1, white, look.mismatch ? white : shoeM);

  const torso = node(hips, 0, 0.06, 0);
  const body = mesh(torso, new THREE.CapsuleGeometry(0.2, 0.4, 5, 12), jersey, 0, 0.3, 0);
  body.scale.set(1.18, 1, 0.7);
  const hem = mesh(torso, new THREE.TorusGeometry(0.205, 0.02, 6, 20), trim, 0, 0.02, 0);
  hem.rotation.x = Math.PI / 2;
  hem.scale.set(1.18, 0.7, 1);
  const collar = mesh(torso, new THREE.TorusGeometry(0.1, 0.02, 6, 16), trim, 0, 0.58, 0);
  collar.rotation.x = Math.PI / 2;
  const numFg = '#' + new THREE.Color(col.trim).getHexString();
  const backTex = numberTexture(num, numFg, 'rgba(8,10,16,0.85)');
  const backM = new THREE.MeshBasicMaterial({ map: backTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffsetFactor: -2, polygonOffset: true });
  mats.push(backM);
  const back = mesh(torso, new THREE.PlaneGeometry(0.26, 0.26), backM, 0, 0.34, 0.148);
  const front = mesh(torso, new THREE.PlaneGeometry(0.2, 0.2), backM, 0, 0.4, -0.148);
  front.rotation.y = Math.PI;
  void back;
  mesh(torso, new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin, 0, 0.64, 0); // neck

  // head
  const head = node(torso, 0, 0.8, 0);
  mesh(head, new THREE.SphereGeometry(0.125, 16, 12), skin);
  mesh(head, new THREE.SphereGeometry(0.03, 8, 6), skin, 0, -0.01, -0.11); // nose
  for (const s of [-1, 1]) {
    mesh(head, new THREE.SphereGeometry(0.02, 6, 6), dark, s * 0.045, 0.02, -0.103);
    mesh(head, new THREE.SphereGeometry(0.026, 6, 6), skin, s * 0.115, -0.005, 0.0); // ears
  }
  const mouth = mesh(head, new THREE.TorusGeometry(0.03, 0.006, 4, 10, Math.PI), dark, 0, -0.045, -0.104);
  mouth.rotation.z = Math.PI;
  if (look.hair === 'spikes') {
    const cap = mesh(head, new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), hairM, 0, 0.012, 0.004);
    void cap;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const sp = mesh(head, new THREE.ConeGeometry(0.03, 0.1, 6), hairM, Math.cos(a) * 0.07, 0.13, Math.sin(a) * 0.07);
      sp.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    }
    mesh(head, new THREE.ConeGeometry(0.034, 0.12, 6), hairM, 0, 0.17, 0);
  } else if (look.hair === 'puff') {
    for (const [x, y, z, r] of [[0, 0.16, 0.02, 0.13], [-0.1, 0.12, 0.03, 0.09], [0.1, 0.12, 0.03, 0.09], [0, 0.1, 0.1, 0.09]]) mesh(head, new THREE.SphereGeometry(r, 10, 8), hairM, x, y, z);
  } else {
    mesh(head, new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM, 0, 0.012, 0.01);
  }
  if (look.headband) {
    const hb = mesh(head, new THREE.TorusGeometry(0.118, 0.02, 6, 20), accentM, 0, 0.055, 0);
    hb.rotation.x = Math.PI / 2;
  }
  if (look.shades) mesh(head, new THREE.BoxGeometry(0.2, 0.045, 0.03), dark, 0, 0.025, -0.108);
  if (look.beard) {
    const b = mesh(head, new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4), hairM, 0, -0.04, -0.02);
    b.scale.set(1, 1, 1.02);
  }

  // arms: capsules along +X (right, throwing) and -X (left), pivoting at the shoulder; the elbow is a second pivot
  const arm = (s) => {
    const sh = node(torso, s * 0.27, 0.52, 0);
    mesh(sh, new THREE.SphereGeometry(0.075, 10, 8), jersey);
    const upper = mesh(sh, new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), skin, s * 0.17, 0, 0);
    upper.rotation.z = Math.PI / 2;
    const elbow = node(sh, s * 0.32, 0, 0);
    mesh(elbow, new THREE.SphereGeometry(0.055, 8, 6), skin);
    const fore = mesh(elbow, new THREE.CapsuleGeometry(0.047, 0.2, 4, 8), skin, s * 0.14, 0, 0);
    fore.rotation.z = Math.PI / 2;
    const hand = node(elbow, s * 0.3, 0, 0);
    mesh(hand, new THREE.SphereGeometry(0.056, 8, 6), skin);
    return { sh, elbow, hand };
  };
  const armR = arm(1);
  const armL = arm(-1);
  g.userData = { shoulder: armR.sh, hand: armR.hand };

  const D = DEG;
  // technique pose (techniques.js `pose`); the neutral style reproduces the original animation exactly
  const NEUTRAL = { crouch: 1, spread: 0, lean: 0, arm: 0, bob: 1 };
  let S = NEUTRAL;
  const set = (n, x = 0, y = 0, z = 0) => n.rotation.set(x, y, z);
  const stance = (hipY) => {
    hips.position.y = hipY;
  };
  const api = {
    group: g,
    hand: armR.hand,
    shoulder: armR.sh,
    /** Bend the athlete for a technique: { crouch, spread, lean, arm, bob } (see techniques.js). No argument = neutral. */
    setStyle(pose) {
      S = { ...NEUTRAL, ...(pose || {}) };
    },
    /** psi = heading in degrees (+ right), physics convention. */
    setFacing(psi) {
      g.rotation.y = -psi * DEG;
    },
    /** Wind-up stance in the circle: breathing, throwing arm out and low, discus visible. */
    idle(t = 0) {
      const br = Math.sin(t * 2.2);
      stance(0.93 + br * 0.006);
      set(hips, 0, 0, 0);
      set(torso, 0.06 + br * 0.015, 0, 0);
      set(head, -0.04, 0, 0);
      set(legR.hip, 0.3, 0, -0.2);
      set(legR.knee, -0.5, 0, 0);
      set(legL.hip, 0.3, 0, 0.2);
      set(legL.knee, -0.5, 0, 0);
      set(armR.sh, 0, -0.2, -0.1 + br * 0.015);
      set(armR.elbow, 0, -0.1, 0);
      set(armL.sh, 0, -0.55, -0.35);
      set(armL.elbow, 0, -0.7, 0);
    },
    /**
     * Mid-spin. rot = degrees turned so far (drives the knee bob), p = power 0..1. The hips lead and the shoulders
     * lag, so the discus arm trails behind the body and visibly "whips round" as the whole figure rotates.
     */
    spin(rot, p) {
      const w = rot * D;
      const bob = (Math.sin(w * 2 - 0.6) * 0.5 + 0.5) * S.bob; // two dips per turn
      stance(0.93 - 0.08 * S.crouch * (0.3 + 0.7 * p) * bob);
      const crouch = (0.35 + 0.35 * p * bob) * S.crouch;
      set(hips, 0, 0.18 * p, 0);
      set(torso, 0.12 + 0.1 * p + S.lean, -(0.25 + 0.55 * p), -0.12 * p);
      set(head, -0.05, 0.25 + 0.3 * p, 0.0);
      set(legR.hip, crouch, 0, -0.26 - S.spread);
      set(legR.knee, -crouch * 1.5, 0, 0);
      set(legL.hip, crouch * 0.8, 0, 0.26 + S.spread);
      set(legL.knee, -crouch * 1.3, 0, 0);
      set(armR.sh, 0, -(0.35 + 0.8 * p), 0.05 + 0.2 * p + S.arm);
      set(armR.elbow, 0, -0.08, 0);
      set(armL.sh, 0, -(0.9 + 0.2 * p), -0.15);
      set(armL.elbow, 0, -0.9, 0);
    },
    /** Release + follow-through, k = 0 (the instant of release) .. 1 (settled). Whip forward, back leg lifts. */
    release(k) {
      const e = easeOut(k * 2.4);
      const settle = easeOut((k - 0.35) / 0.65);
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
    },
    dispose() {
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      mats.forEach((m) => m.dispose());
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
