// THROWING CIRCLE + CAGE. 2.5 m ring on a trowelled concrete pad (scuffed, chalky, white-painted rim, 75 cm extension
// lines), and a real U-shaped discus cage: vertical grounded posts, black knotted netting that sags between them,
// top cables, guy wires, hinged mouth gates and a swung-open rear gate. Dimensions follow the usual rules of thumb:
// mouth ~6 m wide and ~4.2 m in front of the circle centre, nets >= 4 m high at the mouth and ~5.5 m at the back.
import * as THREE from 'three';
import { CIRCLE_RADIUS } from '../physics.js';
import { CAGE_LEFT, CAGE_RIGHT, MOUTH_GATES, REAR_GATE, gateEnd } from './cagegeom.js';
import { makeCanvas, toTexture, paintPixels, makeNoise, mulberry32, GeoBuilder, mat4, clamp, lerp, smooth } from './util.js';

const PAD_R = 2.2;

function paintPad(N, noise) {
  const { n2, fbm } = noise;
  const r0 = CIRCLE_RADIUS;
  const { c, g } = paintPixels(N, N, (px, py, o) => {
    const x = ((px + 0.5) / N - 0.5) * PAD_R * 2;
    const z = ((py + 0.5) / N - 0.5) * PAD_R * 2; // canvas top = far (-z)
    const r = Math.hypot(x, z);
    const th = Math.atan2(z, x);
    // trowel: concentric/swirl sweeps with soft breaks + fine pitting
    const swirl = Math.sin(r * 38 + fbm(x * 2.2, z * 2.2, 3) * 9 + th * 1.5) * 0.5 + 0.5;
    const pit = n2(x * 70, z * 70);
    const mott = fbm(x * 1.4 + 9, z * 1.4, 4);
    let v = 168 + (mott - 0.5) * 38 + swirl * 9 + (pit - 0.5) * 22;
    let rr = v;
    let gg = v * 0.985;
    let bb = v * 0.95;
    // scuff ring where the feet pivot, darker rubber smears
    const ring = Math.exp(-(((r - 0.82) / 0.3) ** 2));
    const scuff = smooth(0.55, 0.9, n2(th * 6 + r * 4, r * 14)) * ring;
    rr -= scuff * 30;
    gg -= scuff * 30;
    bb -= scuff * 29;
    // polished, slightly lighter patch under the ball of the foot, and chalky rosin dust near the middle
    const dust = Math.exp(-((x * x + (z - 0.1) ** 2) / 0.35)) * smooth(0.45, 0.8, n2(x * 9 + 2, z * 9));
    rr += dust * 40;
    gg += dust * 40;
    bb += dust * 38;
    // grime toward the outside edge
    const edge = smooth(1.6, 2.2, r);
    rr *= 1 - edge * 0.25;
    gg *= 1 - edge * 0.22;
    bb *= 1 - edge * 0.25;
    // painted rim and extension lines (white)
    const rimIn = r0;
    const rimOut = r0 + 0.07;
    let paint = 0;
    if (r > rimIn - 0.012 && r < rimOut) paint = 1;
    // extension lines: along the +/- x axis (perpendicular to the throwing direction), 75 cm long, starting at the rim
    if (Math.abs(z) < 0.045 && Math.abs(x) > rimOut && Math.abs(x) < rimOut + 0.75) paint = 1;
    if (paint) {
      const chip = n2(x * 38, z * 38) > 0.78 ? 0.5 : 1;
      const dirt = 0.84 + n2(x * 7, z * 7) * 0.2;
      const mixv = 0.95 * chip;
      rr = rr * (1 - mixv) + 236 * dirt * mixv;
      gg = gg * (1 - mixv) + 234 * dirt * mixv;
      bb = bb * (1 - mixv) + 226 * dirt * mixv;
    }
    // dark steel band just inside the paint (the rim's inner lip) and an expansion joint through the pad
    if (Math.abs(r - (rimIn - 0.025)) < 0.012) {
      rr *= 0.55;
      gg *= 0.55;
      bb *= 0.55;
    }
    if (Math.abs(x) < 0.006 && r < PAD_R - 0.05 && r > rimOut) {
      rr *= 0.5;
      gg *= 0.5;
      bb *= 0.5;
    }
    o[0] = rr;
    o[1] = gg;
    o[2] = bb;
  });
  // hairline cracks and a couple of oil stains
  const rnd = mulberry32(17);
  g.lineCap = 'round';
  const px = (m) => ((m + PAD_R) / (PAD_R * 2)) * N;
  for (let i = 0; i < 6; i++) {
    let x = (rnd() - 0.5) * 3.4;
    let z = (rnd() - 0.5) * 3.4;
    g.strokeStyle = 'rgba(30,28,26,0.35)';
    g.lineWidth = Math.max(1, N / 700);
    g.beginPath();
    g.moveTo(px(x), px(z));
    for (let k = 0; k < 5; k++) {
      x += (rnd() - 0.5) * 0.35;
      z += (rnd() - 0.5) * 0.35;
      g.lineTo(px(x), px(z));
    }
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = px((rnd() - 0.5) * 3.6);
    const z = px((rnd() - 0.5) * 3.6);
    const gr = g.createRadialGradient(x, z, 0, x, z, N * 0.04);
    gr.addColorStop(0, 'rgba(50,46,40,0.28)');
    gr.addColorStop(1, 'rgba(50,46,40,0)');
    g.fillStyle = gr;
    g.fillRect(x - N * 0.05, z - N * 0.05, N * 0.1, N * 0.1);
  }
  return c;
}

/** Knotted black netting, ~12 cm mesh: alpha is the cord, so alpha-to-coverage turns it into smoky mesh at range. */
function paintNet(N) {
  const { c, g } = makeCanvas(N, N);
  g.clearRect(0, 0, N, N);
  const cells = 2;
  const cell = N / cells;
  const w = Math.max(3, N * 0.045);
  g.lineCap = 'round';
  // diamond / square weave: slightly diagonal twisted cords read as real netting rather than a grid
  for (let i = 0; i <= cells; i++) {
    for (const [col, lw] of [['rgba(10,12,14,1)', w], ['rgba(70,76,82,0.9)', w * 0.35]]) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(i * cell, 0);
      g.lineTo(i * cell, N);
      g.moveTo(0, i * cell);
      g.lineTo(N, i * cell);
      g.stroke();
    }
  }
  // knots
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      g.fillStyle = 'rgba(34,38,42,1)';
      g.beginPath();
      g.arc(i * cell, j * cell, w * 0.95, 0, Math.PI * 2);
      g.fill();
    }
  return c;
}

export function buildCage(ctx) {
  const { root, tier, S, keep, noise } = ctx;

  // --- pad ------------------------------------------------------------------------------------------------------
  const padTex = toTexture(paintPad(S(1024), noise), { aniso: 8 });
  const padMat = keep(new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.82, metalness: 0 }));
  const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD_R, 72), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.014;
  pad.name = 'pad';
  ctx.refs.padMat = padMat;
  root.add(pad);
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(PAD_R, PAD_R + 0.025, 0.02, 72, 1, true),
    keep(new THREE.MeshStandardMaterial({ color: 0x77746d, roughness: 0.95 })),
  );
  skirt.position.y = 0.006;
  root.add(skirt);

  // --- cage -----------------------------------------------------------------------------------------------------
  // posts and panels come from cagegeom.js (shared with the camera's net-collision test)
  const V = (c) => ({ p: new THREE.Vector3(c.x, 0, c.z), h: c.h });
  const left = CAGE_LEFT.map(V);
  const right = CAGE_RIGHT.map(V);
  const chains = [left, right];
  const ang = (deg) => (deg * Math.PI) / 180;
  const rnd = mulberry32(5);

  const metal = new GeoBuilder();
  const steel = new THREE.Color(0x4a5560);
  const darkSteel = new THREE.Color(0x232930);
  const post = new THREE.CylinderGeometry(0.042, 0.05, 1, 8);
  post.translate(0, 0.5, 0);
  const collar = new THREE.CylinderGeometry(0.085, 0.1, 0.22, 10);
  collar.translate(0, 0.11, 0);
  const plate = new THREE.CylinderGeometry(0.2, 0.2, 0.012, 12);
  plate.translate(0, 0.006, 0);
  const cap = new THREE.SphereGeometry(0.05, 8, 6);
  const pulley = new THREE.BoxGeometry(0.1, 0.16, 0.07);
  const addPost = (v, h) => {
    metal.add(post, mat4(v.x, 0, v.z, 0, 1, h, 1), steel, { jitter: 0.12 });
    metal.add(collar, mat4(v.x, 0, v.z), darkSteel);
    metal.add(plate, mat4(v.x, 0, v.z), darkSteel);
    metal.add(cap, mat4(v.x, h + 0.02, v.z), steel);
    metal.add(pulley, mat4(v.x, h - 0.1, v.z, rnd() * 3), darkSteel);
    ctx.contacts.push([v.x + 0.15, v.z + 0.12, 0.7, 0.55, 0, 0.45]);
  };
  const tube = (pts, r, color, radial = 4) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, Math.max(2, pts.length * 3), r, radial, false);
    metal.add(g, null, color);
    g.dispose();
  };
  const sagPts = (a, b, dip, n = 6) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      out.push(new THREE.Vector3(lerp(a.x, b.x, u), lerp(a.y, b.y, u) - dip * Math.sin(Math.PI * u), lerp(a.z, b.z, u)));
    }
    return out;
  };

  // nets -------------------------------------------------------------------------------------------------------
  const netTex = toTexture(paintNet(S(256)), { wrap: true, aniso: 8 });
  const netMat = keep(
    new THREE.MeshStandardMaterial({ map: netTex, color: 0xcfd6dc, roughness: 0.95, side: THREE.DoubleSide, alphaToCoverage: true, alphaTest: 0.02, transparent: false }),
  );
  const netGeo = new GeoBuilder();
  const MESH = 0.24; // metres per texture repeat (2 cells)
  const panel = (a, b, ha, hb, { dip = 0.12, bulge = 0.1, seed = 1, bottom = 0.22 } = {}) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = Math.max(3, Math.ceil(len / 0.45));
    const ny = Math.max(3, Math.ceil(Math.max(ha, hb) / 0.7));
    const dirx = (b.x - a.x) / len;
    const dirz = (b.z - a.z) / len;
    const nxv = -dirz;
    const nzv = dirx;
    const r = mulberry32(seed * 131 + 7);
    const ph = r() * 6;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const v = j / ny; // 0 top .. 1 bottom
        const top = lerp(ha, hb, u) - dip * Math.sin(Math.PI * u);
        const bot = bottom + 0.07 * Math.sin(u * Math.PI * 3 + ph) * v;
        const y = lerp(top, bot, v);
        const bl = bulge * Math.sin(Math.PI * u) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.1))) + 0.015 * Math.sin(u * 40 + v * 9 + ph);
        pos.push(a.x + dirx * len * u + nxv * bl, y, a.z + dirz * len * u + nzv * bl);
        uv.push((len * u) / MESH, (ha * v) / MESH);
      }
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * (nx + 1) + i;
        idx.push(k, k + 1, k + nx + 1, k + 1, k + nx + 2, k + nx + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    netGeo.add(g, null, null);
    g.dispose();
    // top cable follows the same sag
    const cable = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      cable.push(new THREE.Vector3(a.x + (b.x - a.x) * u, lerp(ha, hb, u) - dip * Math.sin(Math.PI * u) + 0.015, a.z + (b.z - a.z) * u));
    }
    tube(cable, 0.011, darkSteel);
  };

  let seed = 1;
  for (const chain of chains) {
    chain.forEach((c, i) => addPost(c.p, c.h));
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const len = a.p.distanceTo(b.p);
      panel(a.p, b.p, a.h, b.h, { dip: 0.08 + len * 0.03, bulge: (rnd() - 0.4) * 0.22, seed: seed++ });
    }
  }
  // mouth gates: framed panels hinged to the mouth posts and flared outward ~28 degrees
  const gateFrame = (hinge, dirDeg, w, h, hue) => {
    const d = new THREE.Vector3(Math.sin(ang(dirDeg)), 0, -Math.cos(ang(dirDeg)));
    const e = hinge.clone().addScaledVector(d, w);
    const rail = (a, b, r = 0.022) => {
      const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6);
      const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
      m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      m.setPosition(a.clone().add(b).multiplyScalar(0.5));
      metal.add(g, m, steel);
      g.dispose();
    };
    const T = (v, y) => new THREE.Vector3(v.x, y, v.z);
    rail(T(hinge, 0.12), T(e, 0.12));
    rail(T(hinge, h), T(e, h));
    rail(T(hinge, 0.12), T(hinge, h));
    rail(T(e, 0.12), T(e, h));
    rail(T(hinge, 0.12), T(e, h), 0.012);
    metal.add(new THREE.CylinderGeometry(0.035, 0.035, h, 8), mat4(e.x, h / 2, e.z), steel);
    ctx.contacts.push([e.x, e.z, 0.5, 0.4, 0, 0.35]);
    // a small flat wheel at the free end, as on real gates
    metal.add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), mat4(e.x, 0.07, e.z, 0, 1, 1, 1, 0, Math.PI / 2), darkSteel);
    // net inside, mesh pulled taut (no sag)
    const m = new THREE.Vector3().copy(hinge).lerp(e, 0.5);
    void m;
    panel(T(hinge, 0), T(e, 0), h - 0.1, h - 0.1, { dip: 0.015, bulge: 0.03, seed: hue, bottom: 0.2 });
  };
  MOUTH_GATES.forEach((g, i) => gateFrame(new THREE.Vector3(g.hinge.x, 0, g.hinge.z), g.deg, g.w, g.h, 41 + i));
  // rear gate swung open and folded back along the left net (small and low on purpose: the ready shot looks past it)
  {
    const hinge = new THREE.Vector3(REAR_GATE.hinge.x, 0, REAR_GATE.hinge.z);
    const ge = gateEnd(REAR_GATE);
    const e = new THREE.Vector3(ge.x, 0, ge.z);
    const h = REAR_GATE.h;
    const T = (v, y) => new THREE.Vector3(v.x, y, v.z);
    const rail = (a, b, r = 0.02) => {
      const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6);
      const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
      m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      m.setPosition(a.clone().add(b).multiplyScalar(0.5));
      metal.add(g, m, steel);
      g.dispose();
    };
    rail(T(hinge, 0.14), T(e, 0.14));
    rail(T(hinge, h), T(e, h));
    rail(T(e, 0.14), T(e, h));
    metal.add(new THREE.CylinderGeometry(0.035, 0.035, h, 8), mat4(e.x, h / 2, e.z), steel);
    metal.add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), mat4(e.x, 0.07, e.z, 0, 1, 1, 1, 0, Math.PI / 2), darkSteel);
    ctx.contacts.push([e.x, e.z, 0.6, 0.45, 0, 0.35]);
    panel(T(hinge, 0), T(e, 0), h - 0.1, h - 0.1, { dip: 0.02, bulge: 0.05, seed: 43, bottom: 0.2 });
  }

  const metalMesh = new THREE.Mesh(metal.build(), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.25 })));
  metalMesh.name = 'cage-steel';
  root.add(metalMesh);
  const netMesh = new THREE.Mesh(netGeo.build({ colors: false }), netMat);
  netMesh.name = 'cage-net';
  root.add(netMesh);

  // the discus-retrieval gap, a hand-chalked 'camera line' etc. are not needed; keep the interface for later
  return { padTex, netTex };
}
