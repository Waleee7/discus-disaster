// PROPS: team tents + benches + chairs + people, implement rack with discs, equipment carts, coach's tripod, officials,
// pole-vault and steeple/hurdle silhouettes, tree line (instanced), and the grounding contact-shadow layer.
import * as THREE from 'three';
import { ARENA, makeNoise, toTexture, radialTex, GeoBuilder, mat4, ringPoint, ringArc, mulberry32, clamp } from './util.js';
import { SECTIONS } from './stands.js';
import { CardBatch } from '../cards.js';

const C = (h) => new THREE.Color(h);

export function buildProps(ctx) {
  const { root, tier, keep } = ctx;
  const world = ctx.venue === 'world'; // the championship bowl keeps only the neutral kit (rack, carts, officials)
  const r = mulberry32(8080);
  const hard = new GeoBuilder();
  const fab = new GeoBuilder();
  const box = (b, w, h, d, x, y, z, ry, col, jit = 0.08) => b.add(new THREE.BoxGeometry(w, h, d), mat4(x, y + h / 2, z, ry), C(col), { jitter: jit });
  const cyl = (b, rt, rb, h, x, y, z, col, seg = 8, rx = 0, rz = 0) => b.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat4(x, y + h / 2, z, 0, 1, 1, 1, rx, rz), C(col), { jitter: 0.06 });
  const geos = [];
  const G = (g) => (geos.push(g), g);

  // --- people (static low-poly figures, merged) ------------------------------------------------------------------
  const cap = G(new THREE.CapsuleGeometry(1, 1, 3, 6));
  const sph = G(new THREE.SphereGeometry(1, 8, 6));
  const limb = (x, y, z, rad, len, rx, rz, col, ry = 0) => fab.add(cap, mat4(x, y, z, ry, rad, len, rad, rx, rz), C(col), { jitter: 0.05 });
  const person = ({ x, z, yaw = 0, pose = 'stand', top, bottom, skin, hair = 0x16110d }) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const L = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c]; // local (x right, z back) -> world
    const part = (lx, ly, lz, rad, len, rx, rz, col) => {
      const [px, py, pz] = L(lx, ly, lz);
      limb(px, py, pz, rad, len * 0.5, rx, rz, col, yaw);
    };
    if (pose === 'sit') {
      for (const sx of [-0.1, 0.1]) {
        part(sx, 0.47, -0.2, 0.085, 0.4, Math.PI / 2, 0, bottom); // thigh forward
        part(sx, 0.24, -0.4, 0.07, 0.4, 0, 0, bottom); // shin down
        const [px, , pz] = L(sx, 0, -0.45);
        fab.add(sph, mat4(px, 0.04, pz, yaw, 0.075, 0.05, 0.14), C(0xe8e8e2));
      }
      part(0, 0.8, 0.0, 0.17, 0.36, 0.12, 0, top);
      const [hx, hy, hz] = L(0, 1.25, -0.04);
      fab.add(sph, mat4(hx, hy, hz, yaw, 0.11, 0.125, 0.11), C(skin));
      fab.add(sph, mat4(hx, hy + 0.04, hz + 0.0, yaw, 0.115, 0.1, 0.115), C(hair), { jitter: 0.1 });
      for (const sx of [-0.23, 0.23]) part(sx, 0.78, -0.12, 0.05, 0.34, 0.8, 0, skin);
    } else {
      for (const sx of [-0.1, 0.1]) {
        part(sx, 0.42, 0, 0.075, 0.74, 0, 0, bottom);
        const [px, , pz] = L(sx, 0, -0.06);
        fab.add(sph, mat4(px, 0.04, pz, yaw, 0.075, 0.05, 0.14), C(0xe8e8e2));
      }
      part(0, 1.12, 0, 0.17, 0.5, 0.04, 0, top);
      const [hx, hy, hz] = L(0, 1.66, 0);
      fab.add(sph, mat4(hx, hy, hz, yaw, 0.105, 0.12, 0.105), C(skin));
      fab.add(sph, mat4(hx, hy + 0.04, hz + 0.01, yaw, 0.11, 0.095, 0.11), C(hair), { jitter: 0.1 });
      for (const sx of [-0.24, 0.24]) part(sx, 1.1, 0, 0.045, 0.5, 0, sx > 0 ? -0.1 : 0.1, skin);
    }
  };
  const skins = [0xd9a67e, 0xb98259, 0x8a5a3c, 0xf0c4a0, 0x5e3b27];
  const sk = () => skins[Math.floor(r() * skins.length)];

  // --- tents ------------------------------------------------------------------------------------------------------
  const tents = [
    { x: 14.2, z: -9.5, yaw: 0.12, a: 0xe8700a, b: 0xf1ede2, people: 3 },
    { x: 15.6, z: -16.8, yaw: -0.05, a: 0x16346a, b: 0xe3b32a, people: 2 },
    { x: 13.6, z: -24.6, yaw: 0.18, a: 0x6a1822, b: 0xe9e2d6, people: 1 },
  ];
  const pyr = (cx, cz, y, hw, h, ca, cb, yaw) => {
    const co = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]].map(([ax, az]) => new THREE.Vector3(cx + ax * Math.cos(yaw) + az * Math.sin(yaw), y, cz - ax * Math.sin(yaw) + az * Math.cos(yaw)));
    const apex = new THREE.Vector3(cx, y + h, cz);
    for (let i = 0; i < 4; i++) fab.quad(co[i], co[(i + 1) % 4], apex, apex.clone(), undefined, i % 2 ? cb : ca);
    for (let i = 0; i < 4; i++) fab.quad(co[(i + 1) % 4], co[i], apex.clone(), apex.clone(), undefined, i % 2 ? cb : ca); // underside
  };
  for (const t of world ? [] : tents) {
    const hw = 1.5;
    for (const [ax, az] of [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]]) {
      const px = t.x + ax * Math.cos(t.yaw) + az * Math.sin(t.yaw);
      const pz = t.z - ax * Math.sin(t.yaw) + az * Math.cos(t.yaw);
      cyl(hard, 0.022, 0.022, 2.25, px, 0, pz, 0xc9ced2, 6);
      ctx.contacts.push([px, pz, 0.35, 0.35, 0, 0.45]);
    }
    pyr(t.x, t.z, 2.25, hw + 0.15, 0.7, C(t.a), C(t.b), t.yaw);
    // valance
    for (let i = 0; i < 4; i++) {
      const ang = t.yaw + (i * Math.PI) / 2;
      const vx = t.x + Math.sin(ang) * (hw + 0.15);
      const vz = t.z + Math.cos(ang) * (hw + 0.15);
      fab.add(new THREE.BoxGeometry(2 * hw + 0.3, 0.26, 0.015), mat4(vx, 2.12, vz, ang), C(i % 2 ? t.b : t.a), { jitter: 0.04 });
    }
    // back wall on the side away from the field, bench, bags, cooler, chairs
    fab.add(new THREE.BoxGeometry(2 * hw, 2.0, 0.015), mat4(t.x + 1.5 * Math.sin(t.yaw + Math.PI / 2 * 0) * 0, 1.15, t.z + hw * Math.cos(t.yaw), t.yaw), C(t.a), { jitter: 0.05 });
    ctx.contacts.push([t.x, t.z, 2.6, 2.6, t.yaw, 0.55]);
    box(hard, 2.4, 0.04, 0.34, t.x, 0.42, t.z + 0.6, t.yaw, 0x8a6b45, 0.1);
    for (const lx of [-1.0, 1.0]) box(hard, 0.05, 0.42, 0.3, t.x + lx, 0, t.z + 0.6, t.yaw, 0x3a3f44);
    box(fab, 0.7, 0.3, 0.32, t.x - 0.6 + r() * 0.3, 0, t.z + 1.0, t.yaw + r(), 0x16181c, 0.3);
    box(fab, 0.6, 0.28, 0.3, t.x + 0.5, 0, t.z + 1.05, t.yaw - 0.3, [0x2a3a5a, 0x5a2a2a, 0x1c1c1c][Math.floor(r() * 3)], 0.2);
    box(hard, 0.5, 0.36, 0.34, t.x + 0.1, 0, t.z - 0.5, t.yaw + 0.2, 0xe8700a, 0.1); // water cooler
    box(hard, 0.52, 0.04, 0.36, t.x + 0.1, 0.36, t.z - 0.5, t.yaw + 0.2, 0xf1ede2, 0.05);
    for (let i = 0; i < t.people; i++) {
      const px = t.x - 0.9 + i * 0.85 + (r() - 0.5) * 0.2;
      person({ x: px, z: t.z + 0.62, yaw: Math.PI + (r() - 0.5) * 0.5 + t.yaw, pose: 'sit', top: i % 2 ? t.a : t.b, bottom: 0x1b1d22, skin: sk() });
    }
  }
  // folding chairs scattered along the left of the tents
  const chairAt = (x, z, yaw, col) => {
    box(hard, 0.4, 0.03, 0.4, x, 0.44, z, yaw, col, 0.06);
    box(hard, 0.4, 0.4, 0.025, x + Math.sin(yaw) * 0.19, 0.46, z + Math.cos(yaw) * 0.19, yaw, col, 0.06);
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) cyl(hard, 0.012, 0.012, 0.44, x + lx * Math.cos(yaw) + lz * Math.sin(yaw), 0, z - lx * Math.sin(yaw) + lz * Math.cos(yaw), 0x6d747a, 5);
  };
  (world ? [] : [[11.2, -13.2, 0.4], [11.8, -14.1, 0.1], [10.4, -20.5, -0.3], [11.0, -28.3, 0.2]]).forEach(([x, z, y], i) => chairAt(x, z, y + r() * 0.3, [0x24282d, 0xe8700a, 0x16346a][i % 3]));
  if (!world) person({ x: 11.5, z: -13.6, yaw: -1.3, pose: 'sit', top: 0xe8700a, bottom: 0x16181c, skin: sk() });
  if (!world) person({ x: 9.4, z: -17.8, yaw: -1.4, pose: 'stand', top: 0x16346a, bottom: 0x202228, skin: sk() });
  if (!world) person({ x: 8.6, z: -18.4, yaw: -1.2, pose: 'stand', top: 0xd7d8d2, bottom: 0x1a1c20, skin: sk() });

  // --- left of the circle: implement rack + discs, carts, coach with a tripod ---------------------------------------
  {
    const x0 = -7.6;
    const z0 = -3.0;
    for (const lx of [-0.8, 0.8]) for (const lz of [-0.28, 0.28]) cyl(hard, 0.018, 0.018, 0.95, x0 + lx, 0.08, z0 + lz, 0x60686f, 6);
    for (const y of [0.35, 0.82]) box(hard, 1.7, 0.03, 0.62, x0, y, z0, 0, 0x4a5159, 0.04);
    for (const lx of [-0.8, 0.8]) cyl(hard, 0.05, 0.05, 0.05, x0 + lx, 0, z0 + 0.3, 0x15171a, 10, 0, Math.PI / 2);
    const disc = G(new THREE.CylinderGeometry(0.11, 0.11, 0.045, 14));
    const dc = [0xf1ede2, 0xe8700a, 0x15171a, 0xc8c8c2, 0x16346a];
    for (const y of [0.37, 0.84]) for (let i = 0; i < 9; i++) hard.add(disc, mat4(x0 - 0.7 + i * 0.175, y + 0.115, z0 + (r() - 0.5) * 0.03, 0, 1, 1, 1, 0, Math.PI / 2 + (r() - 0.5) * 0.1), C(dc[Math.floor(r() * dc.length)]), { jitter: 0.1 });
    ctx.contacts.push([x0, z0, 1.9, 1.0, 0, 0.5]);
    // discus retrieval cart: flat bed, orange bin, handle
    const cx = -9.4;
    const cz = 3.2;
    box(hard, 0.9, 0.05, 1.5, cx, 0.22, cz, 0.35, 0x30363c);
    box(fab, 0.8, 0.35, 0.6, cx, 0.27, cz - 0.3, 0.35, 0xe8700a, 0.1);
    for (const [wx, wz] of [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0.55], [0.5, 0.55]]) cyl(hard, 0.11, 0.11, 0.06, cx + wx * Math.cos(0.35) + wz * Math.sin(0.35), 0.0, cz - wx * Math.sin(0.35) + wz * Math.cos(0.35), 0x141517, 10, 0, Math.PI / 2);
    cyl(hard, 0.016, 0.016, 1.0, cx + 0.3, 0.3, cz + 0.8, 0x80878c, 6, 0.7, 0);
    ctx.contacts.push([cx, cz, 1.2, 1.6, 0.35, 0.45]);
    // second, smaller hand-truck with towels and a bucket
    box(hard, 0.5, 0.03, 0.4, -6.6, 0.35, 2.1, -0.6, 0x3a4046);
    cyl(hard, 0.012, 0.012, 1.1, -6.35, 0.3, 2.3, 0x777e84, 5);
    cyl(hard, 0.13, 0.11, 0.3, -6.6, 0.38, 2.1, 0xb6bcc0, 10);
    box(fab, 0.4, 0.1, 0.3, -6.6, 0.38, 2.1, 0.3, 0xe9e2d6, 0.1);
    cyl(hard, 0.1, 0.1, 0.03, -6.6, 0.0, 2.1, 0x141517, 8, 0, Math.PI / 2);
    // tripod + phone: the coach filming the thrower
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      cyl(hard, 0.012, 0.01, 1.5, -5.6 + Math.sin(a) * 0.25, 0, -6.5 + Math.cos(a) * 0.25, 0x1a1c20, 5, Math.cos(a) * 0.17, -Math.sin(a) * 0.17);
    }
    box(hard, 0.07, 0.14, 0.01, -5.6, 1.5, -6.5, -0.4, 0x0e0f12);
    person({ x: -5.1, z: -6.0, yaw: 2.6, pose: 'stand', top: 0x16181c, bottom: 0x3a3f46, skin: sk() });
    ctx.contacts.push([-5.6, -6.5, 0.9, 0.9, 0, 0.4]);
  }

  let flagX = 0;
  let flagZ = 0;
  // --- officials by the sector (white polos, khaki), a clipboard table -----------------------------------------------
  {
    const A = 17.46 * (Math.PI / 180);
    const at = (d, side, off) => {
      const rad = d + 1.25;
      return [side * (rad * Math.sin(A) + off * Math.cos(A)), -rad * Math.cos(A) + off * Math.sin(A)];
    };
    const [ox, oz] = at(46, 1, 3.2);
    person({ x: ox, z: oz, yaw: Math.atan2(-ox, -oz) + 0.4, pose: 'stand', top: 0xefece4, bottom: 0x8a7a5a, skin: sk() });
    const [px, pz] = at(58, -1, 3.0);
    person({ x: px, z: pz, yaw: Math.atan2(-px, -pz) - 0.3, pose: 'stand', top: 0xefece4, bottom: 0x8a7a5a, skin: sk() });
    box(hard, 1.5, 0.04, 0.6, -9.6, 0.74, -10.5, 0.3, 0xcdd2d6);
    for (const [lx, lz] of [[-0.65, -0.25], [0.65, -0.25], [-0.65, 0.25], [0.65, 0.25]]) cyl(hard, 0.02, 0.02, 0.74, -9.6 + lx * Math.cos(0.3) + lz * Math.sin(0.3), 0, -10.5 - lx * Math.sin(0.3) + lz * Math.cos(0.3), 0x6d747a, 5);
    chairAt(-9.4, -9.7, 3.4, 0x24282d);
    person({ x: -9.4, z: -9.75, yaw: 0.3, pose: 'sit', top: 0xefece4, bottom: 0x6a5f48, skin: sk() });
    ctx.contacts.push([-9.6, -10.5, 1.8, 1.0, 0.3, 0.4]);
    // real judging kit around the sector
    const kit = (name, x, z, h, o) => {
      ctx.cards.add(name, x, z, h, o);
      ctx.contacts.push([x, z, h * 0.7, h * 0.5, 0, 0.35]);
    };
    kit('station', -12.5, -24, 1.75);
    const [sx, sz] = at(46, 1, 2.3);
    kit('prism', sx, sz, 2.1);
    ctx.cards.add('reel', -9.75, -10.5, 0.32, { y: 0.78 });
    kit('attempt', -11.6, -11.4, 1.35);
    kit('chair', 7.4, -9.2, 1.0);
    kit('rake', -8.2, -7.4, 0.95);
    kit('broom', -7.2, -7.9, 0.95);
    // the pigeons that stayed on the ground, and know what they did
    for (const [name, d, off, h] of [['pigeonPeck', 19, -2.4, 0.3], ['pigeonFat', 27, 2.1, 0.42], ['pigeonPeck', 36, 1.2, 0.3], ['pigeonFat', 13, 3, 0.42]]) {
      const [gx, gz] = at(d, off < 0 ? -1 : 1, -Math.abs(off));
      kit(name, gx, gz, h);
    }
    // flag judge at the cage mouth: white flag for a fair throw, red for a foul
    [flagX, flagZ] = at(11, 1, 2.0);
    person({ x: flagX, z: flagZ, yaw: Math.atan2(-flagX, -flagZ) + Math.PI, pose: 'stand', top: 0xefece4, bottom: 0x1f2740, skin: sk() });
    ctx.contacts.push([flagX, flagZ, 1.1, 1.1, 0, 0.45]);
  }

  // --- pole vault (right) -------------------------------------------------------------------------------------------
  if (!world) {
    const x = 21.5;
    box(hard, 1.22, 0.02, 38, x, 0, -25.5, 0, 0x7a4636, 0.06);
    box(hard, 0.05, 0.022, 38, x - 0.6, 0.001, -25.5, 0, 0xe6e2d6, 0.05);
    box(hard, 0.05, 0.022, 38, x + 0.6, 0.001, -25.5, 0, 0xe6e2d6, 0.05);
    box(hard, 1.0, 0.1, 0.6, x, 0, -44.4, 0, 0x2a2e33); // plant box
    box(fab, 5.4, 0.8, 5.2, x, 0, -47.4, 0, 0x14285a, 0.05); // landing mat
    box(fab, 5.5, 0.04, 5.3, x, 0.8, -47.4, 0, 0x1a3470, 0.05);
    for (const sx of [-1, 1]) {
      cyl(hard, 0.03, 0.04, 5.6, x + sx * 3.2, 0, -44.6, 0x2c3238, 8);
      box(hard, 0.5, 0.04, 0.5, x + sx * 3.2, 0, -44.6, 0, 0x1a1c20);
      ctx.contacts.push([x + sx * 3.2, -44.6, 0.6, 0.6, 0, 0.4]);
    }
    cyl(hard, 0.014, 0.014, 6.4, x, 4.7, -44.6, 0xe9e5d8, 6, 0, Math.PI / 2);
    // poles lying on a rack
    for (let i = 0; i < 4; i++) cyl(hard, 0.016, 0.016, 4.6, x + 3.8 + i * 0.07, 0.1 + i * 0.01, -40 - i * 0.05, [0x2a8a5a, 0xc8a02a, 0x2a5a8a, 0x8a2a2a][i], 5, Math.PI / 2, 0);
    ctx.contacts.push([x, -47.4, 6.5, 6.2, 0, 0.55]);
  }
  // --- steeple barriers + hurdle stacks (left) ----------------------------------------------------------------------
  if (!world) {
    for (let i = 0; i < 3; i++) {
      const x = -25.5 - i * 0.2;
      const z = -26 - i * 4.4;
      box(hard, 3.96, 0.13, 0.13, x, 0.78, z, 0.05, i === 1 ? 0xe8e4d6 : 0x1b1d20);
      for (const sx of [-1.7, 1.7]) {
        box(hard, 0.08, 0.9, 0.5, x + sx, 0, z, 0.05, 0x2a2e34);
        ctx.contacts.push([x + sx, z, 0.6, 0.9, 0, 0.4]);
      }
    }
    for (let i = 0; i < 8; i++) {
      const x = -22.2 + (i % 4) * 0.55 + r() * 0.1;
      const z = -9 - Math.floor(i / 4) * 0.7;
      box(hard, 1.2, 0.04, 0.04, x, 1.0, z, 0.1, i % 2 ? 0xe8e4d6 : 0x1b1d20);
      for (const sx of [-0.55, 0.55]) box(hard, 0.04, 1.0, 0.3, x + sx, 0, z, 0.1, 0x2a2e34);
    }
  }
  geos.forEach((g) => g.dispose());

  const m1 = new THREE.Mesh(hard.build(), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 })));
  const m2 = new THREE.Mesh(fab.build(), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide })));
  m1.name = 'props-hard';
  m2.name = 'props-fabric';
  root.add(m1, m2);

  // --- tree line behind the stands: instanced blobs, varied hue / height / lean --------------------------------------
  if (!world) {
    const mkBlob = (detail, sy) => {
      const g = new THREE.IcosahedronGeometry(1, detail);
      const p = g.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const k = 0.82 + (Math.sin(v.x * 7.1 + v.y * 3.3) * 0.5 + 0.5) * 0.3 + (Math.sin(v.z * 9.7) * 0.5 + 0.5) * 0.1;
        p.setXYZ(i, v.x * k, v.y * k * sy, v.z * k);
      }
      return g;
    };
    const decid = new GeoBuilder();
    decid.add(new THREE.CylinderGeometry(0.25, 0.4, 5, 5), mat4(0, 2.5, 0), C(0x241a12));
    decid.add(mkBlob(0, 0.9), mat4(0, 7.5, 0, 0, 5, 5, 5), C(0x1f3a22), { jitter: 0.1 });
    decid.add(mkBlob(0, 0.8), mat4(1.7, 10, 0.6, 1, 3.4, 3.4, 3.4), C(0x26462a), { jitter: 0.1 });
    decid.add(mkBlob(0, 0.8), mat4(-1.6, 9.2, -0.8, 2, 3.2, 3.2, 3.2), C(0x1b3320), { jitter: 0.1 });
    const pine = new GeoBuilder();
    pine.add(new THREE.CylinderGeometry(0.2, 0.3, 3, 5), mat4(0, 1.5, 0), C(0x21170f));
    for (let i = 0; i < 4; i++) pine.add(new THREE.ConeGeometry(3 - i * 0.6, 4.6, 7), mat4(0, 4 + i * 3.1, 0, i), C(0x1a3326), { jitter: 0.12 });
    const lamb = (name, geo, n) => {
      const mesh = new THREE.InstancedMesh(geo, keep(new THREE.MeshLambertMaterial({ vertexColors: true })), n);
      mesh.name = name;
      mesh.frustumCulled = false;
      return mesh;
    };
    const total = Math.round(230 * tier.trees);
    const dMesh = lamb('trees-decid', decid.build(), total);
    const pMesh = lamb('trees-pine', pine.build(), total);
    let nd = 0;
    let np = 0;
    const p = new THREE.Vector3();
    const tmp = new THREE.Color();
    const sections = SECTIONS;
    const backOf = (t) => {
      // how far the stand structure reaches at ring angle t (a tree must sit behind it)
      let best = 14;
      for (const s of sections) {
        const tt = ((t - s.t0 + Math.PI * 8) % (Math.PI * 2));
        const span = s.t1 - s.t0;
        if (tt < span + 0.12 || tt > Math.PI * 2 - 0.12) best = Math.max(best, (s.oBack || 30) + (s.id === 'home' ? 8 : 4.5));
      }
      return best;
    };
    let tries = 0;
    while (nd + np < total && tries++ < total * 12) {
      const t = r() * Math.PI * 2 - Math.PI;
      const off = backOf(t) + 3 + Math.pow(r(), 1.7) * 60;
      ringPoint(t, off, p);
      const h = 0.7 + r() * 0.9;
      const dec = r() < 0.6;
      const m = mat4(p.x, -0.2, p.z, r() * 6.28, h * (0.8 + r() * 0.5), h, h * (0.8 + r() * 0.5), (r() - 0.5) * 0.06, (r() - 0.5) * 0.06);
      // day-to-day hue drift between neighbours: yellower oaks, bluer pines
      tmp.setRGB(0.75 + r() * 0.5, 0.85 + r() * 0.35, 0.7 + r() * 0.4);
      if (dec) {
        dMesh.setMatrixAt(nd, m);
        dMesh.setColorAt(nd++, tmp);
      } else {
        pMesh.setMatrixAt(np, m);
        pMesh.setColorAt(np++, tmp);
      }
    }
    dMesh.count = nd;
    pMesh.count = np;
    root.add(dMesh, pMesh);
  }

  // --- contact shadows / ambient occlusion: ONE mesh, black blobs with per-vertex alpha ---------------------------------
  {
    const gb = new GeoBuilder();
    const q = new THREE.PlaneGeometry(1, 1);
    q.rotateX(-Math.PI / 2);
    const col = new THREE.Color(0, 0, 0);
    for (const [x, z, sx, sz, ry, a] of ctx.contacts) gb.add(q, mat4(x, 0.012, z, ry, sx, 1, sz), col, { alpha: a });
    const tex = radialTex(64, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }));
    const m = new THREE.Mesh(gb.build({ alphaColors: true }), mat);
    m.name = 'contact-shadows';
    m.renderOrder = 2;
    root.add(m);
  }
  const flags = new CardBatch('kit-a', 1);
  flags.mesh.name = 'judge-flag';
  root.add(flags.mesh);
  keep(flags.mesh.geometry);
  keep(flags.mesh.material);
  return {
    /** 'fair', 'foul' or null to lower the flag. */
    setJudgeCall(call) {
      if (call) flags.set(0, call === 'foul' ? 'flagRed' : 'flagWhite', flagX, 1.42, flagZ, { h: 0.95 });
      else flags.hide(0);
    },
  };
}
