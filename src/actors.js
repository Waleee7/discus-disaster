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

export function buildThrower() {
  const g = new THREE.Group();
  const skin = M(0xc98a5e);
  const singlet = M(0xff8a1f, { emissive: 0x3a1600 });
  const dark = M(0x10131c);
  const white = M(0xf4f8ff);
  const add = (geo, mat, x, y, z, rx = 0, rz = 0, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    parent.add(m);
    return m;
  };
  // legs in a wide throwing stance
  add(new THREE.CapsuleGeometry(0.095, 0.62, 3, 8), dark, -0.17, 0.5, 0, 0, 0.12);
  add(new THREE.CapsuleGeometry(0.095, 0.62, 3, 8), dark, 0.17, 0.5, 0, 0, -0.12);
  add(new THREE.BoxGeometry(0.16, 0.09, 0.3), white, -0.22, 0.045, -0.04);
  add(new THREE.BoxGeometry(0.16, 0.09, 0.3), white, 0.22, 0.045, -0.04);
  const torso = add(new THREE.CapsuleGeometry(0.2, 0.46, 4, 10), singlet, 0, 1.22, 0);
  torso.scale.set(1.15, 1, 0.68);
  add(new THREE.SphereGeometry(0.115, 14, 10), skin, 0, 1.76, 0);
  const band = add(new THREE.TorusGeometry(0.118, 0.022, 6, 16), white, 0, 1.8, 0, Math.PI / 2);
  band.rotation.x = Math.PI / 2;
  // left arm tucked across, right (throwing) arm out with the discus
  add(new THREE.CapsuleGeometry(0.058, 0.42, 3, 8), skin, -0.3, 1.32, -0.12, 0, 0.9);
  const shoulder = new THREE.Group();
  shoulder.position.set(0.27, 1.43, 0);
  g.add(shoulder);
  const arm = add(new THREE.CapsuleGeometry(0.058, 0.62, 3, 8), skin, 0.38, -0.02, 0, 0, Math.PI / 2, shoulder);
  const hand = new THREE.Group();
  hand.position.set(0.78, -0.02, 0);
  shoulder.add(hand);
  g.userData = { shoulder, hand, arm };
  return {
    group: g,
    hand,
    shoulder,
    /** psi = heading in degrees (+ right), physics convention. */
    setFacing(psi) {
      g.rotation.y = -psi * DEG;
    },
    dispose() {
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
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
      tape.scale.set(1, len, 1);
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
