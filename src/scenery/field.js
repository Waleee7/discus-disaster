// FIELD: infield turf (mowing stripes, border laps, wear, divots), sector paint, distance arcs + markers, the
// polyurethane track with lane lines / curb / numbers, plus the dark ground that fills the world beyond the stands.
import * as THREE from 'three';
import { CIRCLE_RADIUS, SECTOR_HALF_ANGLE, DEG } from '../physics.js';
import {
  ARENA, TRACK_W, LANE_W, LANES, clamp, lerp, smooth, makeNoise, makeCanvas, toTexture, paintPixels, patchGround, GeoBuilder, mat4,
  ribbonGeo, sweepRing, ringPoint, ringNormal, ringArc, mulberry32,
} from './util.js';

// Signage uses the page's Oswald; main.js waits for document.fonts before the stadium is painted (Impact only as a fallback)
const FONT = '700 {S}px Oswald, Impact, "Arial Black", "Arial Narrow", sans-serif';
export const font = (px) => FONT.replace('{S}', px);

const INFIELD = { x0: -ARENA.b, w: ARENA.b * 2, z0: -(ARENA.cx + ARENA.a), d: ARENA.a * 2 };

/** Landing-zone wear clusters (three xz): where a college thrower's discs actually come down. [x, z, sx, sz, amp] */
const WEAR = [
  [0.8, -53, 5.5, 8.5, 0.95],
  [-3.6, -60, 4.2, 6.5, 0.75],
  [4.6, -47, 4, 5, 0.7],
  [1.5, -67, 4, 6, 0.55],
  [-1.2, -41, 5, 6, 0.5],
  [6.8, -57, 2.6, 4, 0.4],
];

function paintTurf(W, H, noise) {
  const { fbm, n2 } = noise;
  return paintPixels(W, H, (px, py, o) => {
    const x = INFIELD.x0 + ((px + 0.5) / W) * INFIELD.w;
    const z = INFIELD.z0 + ((py + 0.5) / H) * INFIELD.d;
    const rho = Math.hypot(x / ARENA.b, (z + ARENA.cx) / ARENA.a);
    if (rho > 1.03) {
      o[0] = 18;
      o[1] = 34;
      o[2] = 20;
      return;
    }
    const d = (1 - rho) * 44; // metres to the track edge, near enough
    let s;
    if (d < 3.3) {
      s = Math.floor(d / 1.65) & 1 ? 1 : -1; // border laps follow the curb
      if (d < 0.32) s = -1.8; // trimmed edge
    } else {
      const u = (x + ARENA.b) / 2.2;
      const f = u - Math.floor(u / 2) * 2;
      s = f < 1 ? 1 : -1;
      // nap shading: each stripe is a touch lighter at one edge, like a real roller finish
      s *= 0.75 + 0.5 * (f - Math.floor(f));
    }
    const m = fbm(x * 0.045 + 11, z * 0.045 + 5, 3); // big dry / lush patches
    const m2 = n2(x * 0.7, z * 0.7); // finer mottling
    const m3 = n2(x * 5.1 + 3, z * 5.1); // blade-scale grain at this res
    let r = 40;
    let g = 92;
    let b = 38;
    const k = 1 + s * 0.075 + (m - 0.5) * 0.28 + (m2 - 0.5) * 0.1 + (m3 - 0.5) * 0.07;
    r *= k * (1 + (m - 0.5) * 0.5);
    g *= k;
    b *= k * (1 - (m - 0.5) * 0.3);
    // thin, yellowing patches
    const thin = smooth(0.62, 0.8, fbm(x * 0.12 + 40, z * 0.12 + 9, 3));
    r = lerp(r, 86, thin * 0.5);
    g = lerp(g, 108, thin * 0.35);
    b = lerp(b, 48, thin * 0.3);
    // landing-zone wear
    let w = 0;
    for (let i = 0; i < WEAR.length; i++) {
      const [cx, cz, sx, sz, a] = WEAR[i];
      const dx = (x - cx) / sx;
      const dz = (z - cz) / sz;
      w += a * Math.exp(-0.5 * (dx * dx + dz * dz));
    }
    // the trampled apron around the circle and the walk to the sector
    const rc = Math.hypot(x, z);
    w += 0.9 * smooth(7.5, 2.4, rc) + 0.45 * Math.exp(-0.5 * (((x - 5.5) / 1.4) ** 2 + ((z - 4) / 3) ** 2));
    const nz = fbm(x * 0.9 + 70, z * 0.9, 3);
    const ww = smooth(0.32, 0.95, w * (0.45 + 1.1 * nz));
    r = lerp(r, 100, ww * 0.55);
    g = lerp(g, 96, ww * 0.5);
    b = lerp(b, 54, ww * 0.4);
    o[0] = r;
    o[1] = g;
    o[2] = b;
  });
}

function paintDetail(N, seed) {
  const noise = makeNoise(seed, 32);
  const { c, g } = paintPixels(N, N, (x, y, o) => {
    const v = noise.fbm((x / N) * 32, (y / N) * 32, 3) * 0.55 + Math.random() * 0.45;
    const l = 70 + v * 120;
    o[0] = o[1] = o[2] = l;
  });
  // blade strokes, wrapped so the tile stays seamless
  const r = mulberry32(seed + 1);
  g.lineCap = 'round';
  for (let i = 0; i < N * 7; i++) {
    const x = r() * N;
    const y = r() * N;
    const a = -Math.PI / 2 + (r() - 0.5) * 1.1;
    const l = 3 + r() * 6;
    g.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.18)';
    g.lineWidth = 0.8 + r() * 0.8;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
      g.stroke();
    }
  }
  return c;
}

/** World-space low-frequency variation (R, G independent) used by every ground material. */
function paintMacro(N) {
  const a = makeNoise(21, 16);
  const b = makeNoise(34, 16);
  return paintPixels(N, N, (x, y, o) => {
    o[0] = a.fbm((x / N) * 16, (y / N) * 16, 3) * 255;
    o[1] = b.fbm((x / N) * 16, (y / N) * 16, 3) * 255;
    o[2] = 128;
  }).c;
}

function paintTrackTile(W, H, noise, tileM, base = [150, 62, 44]) {
  const { n2, fbm } = noise;
  const lineW = 0.055; // metres
  const { c, g } = paintPixels(W, H, (px, py, o) => {
    const u = px / W; // along 0..1 (tileM metres)
    const v = 1 - py / H; // across 0..1 (TRACK_W metres); canvas row 0 is the OUTER edge (flipY)
    const across = v * TRACK_W;
    const lane = Math.min(LANES - 1, Math.floor(across / LANE_W));
    const x = u * tileM;
    // per-lane tint (older rubber in the inner lanes), granulate speckle, soft low-frequency mottling
    const mot = fbm(x * 0.35, across * 0.8, 3);
    const gran = n2(x * 38, across * 38);
    const gran2 = n2(x * 11 + 5, across * 11);
    const laneTint = 1 + (lane % 3 === 1 ? -0.03 : lane === 0 ? 0.045 : 0.01) + ((lane * 37) % 7) * 0.004;
    const k = laneTint * (0.9 + mot * 0.22) * (0.9 + gran * 0.16 + gran2 * 0.06);
    let r = base[0] * k;
    let gg = base[1] * k;
    let b = base[2] * k;
    // darker wear lanes: footfall polishes the inside of each lane's running line
    const within = (across % LANE_W) / LANE_W;
    const run = Math.exp(-(((within - 0.5) / 0.22) ** 2));
    const polish = run * (lane < 3 ? 0.07 : 0.03);
    r *= 1 - polish * 0.6;
    gg *= 1 - polish * 0.2;
    b *= 1 - polish * 0.1;
    // lane lines (right edge of each lane; the first sits on the curb)
    const dl = across - Math.round(across / LANE_W) * LANE_W;
    const onLine = Math.abs(dl) < lineW / 2 && across > 0.01 && across < TRACK_W - 0.01;
    if (onLine) {
      const chip = n2(x * 9 + 2, across * 40) > 0.77 ? 0.55 : 1; // chipped paint
      const dirty = 0.84 + n2(x * 3, across * 3) * 0.2;
      const a = chip * (1 - smooth(lineW * 0.32, lineW * 0.55, Math.abs(dl)));
      r = lerp(r, 236 * dirty, a);
      gg = lerp(gg, 232 * dirty, a);
      b = lerp(b, 222 * dirty, a);
    }
    o[0] = r;
    o[1] = gg;
    o[2] = b;
  });
  // black rubber skid marks and a few dark spots, painted as soft strokes
  const rr = mulberry32(5);
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 20; i++) {
    const y = rr() * H;
    const x = rr() * W;
    g.strokeStyle = `rgba(50,30,28,${0.1 + rr() * 0.12})`;
    g.lineWidth = 1.5 + rr() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 40 + rr() * 120, y + (rr() - 0.5) * 6);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** Hand-painted white: tiling strip with ragged edges + chips, used on every ribbon (sector lines, arcs). */
function paintPaint(W, H) {
  const noise = makeNoise(77, 64);
  return paintPixels(W, H, (px, py, o) => {
    const u = px / W;
    const v = py / H;
    const edge = Math.abs(v - 0.5) * 2; // 0 centre .. 1 edge
    const rag = 0.86 + (noise.n2(u * 64, v * 6) - 0.5) * 0.35;
    const chip = noise.n2(u * 30 + 3, v * 3) > 0.8 ? 0.55 : 1;
    const a = clamp((1 - smooth(rag - 0.12, rag, edge)) * chip * (0.86 + noise.n2(u * 20, v * 20) * 0.2));
    o[0] = 236;
    o[1] = 238;
    o[2] = 232;
    o[3] = a * 255;
  }).c;
}

function digitsAtlas(S) {
  const { c, g } = makeCanvas(S * 8, S);
  g.font = font(S * 0.78);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f2efe6';
  for (let i = 0; i < 8; i++) g.fillText(String(i + 1), S * i + S / 2, S * 0.54);
  return c;
}

export function buildField(ctx) {
  const { root, tier, S, keep, noise } = ctx;
  const mk = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name || '';
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
    return m;
  };
  const detailTex = toTexture(paintDetail(S(256), 11), { wrap: true, aniso: 8 });
  const macroTex = toTexture(paintMacro(S(256)), { wrap: true, srgb: false });
  ctx.macroTex = macroTex;
  ctx.detailTex = detailTex;
  keep({ map: detailTex, dispose() {} });
  keep({ map: macroTex, dispose() {} });

  // --- world floor beyond the stadium: dark turf/dirt so nothing reads as a void ------------------------------
  const floorMat = keep(patchGround(new THREE.MeshStandardMaterial({ color: 0x131b14, roughness: 1 }), { detail: detailTex, detailScale: 0.4, macro: macroTex, macroScale: 1 / 220, macroAmt: 0.5 }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  root.add(floor);

  // --- infield turf -------------------------------------------------------------------------------------------
  const tW = S(1024);
  const tH = S(1024);
  const turfTex = toTexture(paintTurf(tW, tH, noise).c, { aniso: 8 });
  const turfMat = keep(
    patchGround(new THREE.MeshStandardMaterial({ map: turfTex, roughness: 0.96, metalness: 0 }), { detail: detailTex, detailScale: 2.2, macro: macroTex, macroScale: 1 / 90, macroAmt: 0.12, detailAmt: 0.42 }),
  );
  {
    const segs = 128;
    const pos = [0, 0, -ARENA.cx];
    const uv = [(0 - INFIELD.x0) / INFIELD.w, 1 - (-ARENA.cx - INFIELD.z0) / INFIELD.d];
    const idx = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      ringPoint((i / segs) * Math.PI * 2, -0.02, p);
      pos.push(p.x, 0, p.z);
      uv.push((p.x - INFIELD.x0) / INFIELD.w, 1 - (p.z - INFIELD.z0) / INFIELD.d);
      if (i < segs) idx.push(0, i + 2, i + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(idx);
    mk(geo, turfMat, 'turf');
    ctx.refs.turfMat = turfMat;
  }

  // --- landing zone: divots, scuffs, skid scars (alpha decal over the turf) -----------------------------------
  {
    const Wm = 32;
    const Dm = 50;
    const cz = -53;
    const cw = S(768);
    const ch = S(1024);
    const { c, g } = makeCanvas(cw, ch);
    g.setTransform(cw / Wm, 0, 0, ch / Dm, (Wm / 2) * (cw / Wm), (Dm / 2 - cz) * (ch / Dm));
    const r = mulberry32(2024);
    const pick = () => {
      const [x, z, sx, sz] = WEAR[Math.floor(Math.pow(r(), 1.4) * WEAR.length)];
      const gx = (r() + r() + r() - 1.5) * 1.6;
      const gz = (r() + r() + r() - 1.5) * 1.6;
      return [x + gx * sx, z + gz * sz];
    };
    // scuff clouds: soft brown bruising where discs have landed
    for (let i = 0; i < 70; i++) {
      const [x, z] = pick();
      const rad = 0.5 + r() * 1.6;
      const gr = g.createRadialGradient(x, z, 0, x, z, rad);
      gr.addColorStop(0, `rgba(88,70,42,${0.16 + r() * 0.18})`);
      gr.addColorStop(1, 'rgba(88,70,42,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, z - rad, rad * 2, rad * 2);
    }
    // divots: dark soil crescent + torn lighter rim + a flap of turf
    for (let i = 0; i < 38; i++) {
      const [x, z] = pick();
      const L = 0.2 + r() * 0.5;
      const Wd = L * (0.35 + r() * 0.3);
      const a = (r() - 0.5) * 0.7 + Math.PI / 2; // long axis roughly along the throw
      g.save();
      g.translate(x, z);
      g.rotate(a);
      g.fillStyle = 'rgba(30,22,14,0.12)';
      g.beginPath();
      g.ellipse(0.02, 0.02, L * 0.62, Wd * 0.62, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgba(${54 + r() * 14},${44 + r() * 8},${28 + r() * 6},0.46)`;
      g.beginPath();
      g.ellipse(0, 0, L * 0.5, Wd * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(96,108,62,0.2)';
      g.lineWidth = 0.025;
      g.stroke();
      g.fillStyle = `rgba(${40 + r() * 8},${62 + r() * 8},${34},0.3)`;
      g.beginPath();
      g.ellipse(L * 0.5, 0, L * 0.26, Wd * 0.36, 0.3, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // skid scars, thin and long
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const [x, z] = pick();
      g.strokeStyle = `rgba(52,40,26,${0.25 + r() * 0.2})`;
      g.lineWidth = 0.05 + r() * 0.06;
      g.beginPath();
      g.moveTo(x, z);
      g.quadraticCurveTo(x + (r() - 0.5) * 0.8, z + 1 + r(), x + (r() - 0.5), z + 2 + r() * 2.5);
      g.stroke();
    }
    const tex = toTexture(c, { aniso: 8 });
    const mat = keep(new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Wm, Dm), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.006, cz);
    m.renderOrder = 1;
    root.add(m);
  }

  // --- paint: sector lines, 5 m arcs --------------------------------------------------------------------------
  const paintTex = toTexture(paintPaint(S(512), S(64)), { wrap: true, aniso: 8 });
  const paintMat = keep(
    new THREE.MeshStandardMaterial({ map: paintTex, color: 0xf4f1e8, roughness: 0.82, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  const paintGeo = new GeoBuilder();
  const A = SECTOR_HALF_ANGLE * DEG;
  const R0 = CIRCLE_RADIUS;
  const pointsOnArc = (r, a0, a1, n) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      out.push(new THREE.Vector3(r * Math.sin(a), 0, -r * Math.cos(a)));
    }
    return out;
  };
  const addRibbon = (g) => paintGeo.add(g);
  for (const s of [-1, 1]) {
    const dir = new THREE.Vector3(s * Math.sin(A), 0, -Math.cos(A));
    const pts = [];
    for (let i = 0; i <= 60; i++) pts.push(dir.clone().multiplyScalar(R0 + 0.8 + (i / 60) * 98));
    addRibbon(ribbonGeo(pts, 0.1, 0.014, { tileLen: 3, wobble: 0.02, seed: 4 + s }));
  }
  for (let d = 10; d <= 90; d += 5) {
    const r = d + R0;
    const main = d % 10 === 0;
    addRibbon(ribbonGeo(pointsOnArc(r, -A, A, Math.max(18, Math.round(r * 0.9))), main ? 0.085 : 0.06, 0.014, { tileLen: 3, wobble: 0.012, seed: d }));
  }
  // the world-record arc is a warm yellow paint stripe rather than white
  const wrGeo = ribbonGeo(pointsOnArc(74.35 + R0, -A, A, 90), 0.12, 0.016, { tileLen: 3, wobble: 0.01, seed: 9 });
  mk(paintGeo.build({ colors: false }), paintMat, 'sector-paint');
  mk(wrGeo, keep(new THREE.MeshStandardMaterial({ map: paintTex, color: 0xffb020, roughness: 0.8, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })), 'wr-arc');

  // --- distance markers: cones (5 m), flags (10 m), numbered boards (20..70) --------------------------------
  {
    const r = mulberry32(41);
    for (const s of [-1, 1]) {
      for (let d = 15; d <= 85; d += 5) {
        const rad = d + R0;
        const perp = new THREE.Vector3(s * Math.cos(A), 0, Math.sin(A));
        const p = new THREE.Vector3(s * rad * Math.sin(A), 0, -rad * Math.cos(A)).addScaledVector(perp, 0.55 + (r() - 0.5) * 0.2);
        if (d % 10 === 5) {
          ctx.cards.add('cone', p.x, p.z, 0.42);
        } else {
          ctx.cards.add('marker', p.x, p.z, 1.15);
        }
      }
    }

    // numbered boards
    const nums = [20, 30, 40, 50, 60, 70];
    const cell = S(170);
    const { c, g } = makeCanvas(cell * 3, Math.round(cell * 0.7) * 2);
    const ch = c.height / 2;
    nums.forEach((n, i) => {
      const x0 = (i % 3) * cell;
      const y0 = Math.floor(i / 3) * ch;
      g.fillStyle = '#f3efe4';
      g.fillRect(x0, y0, cell, ch);
      g.fillStyle = '#e8700a';
      g.fillRect(x0, y0, cell, ch * 0.1);
      g.fillRect(x0, y0 + ch * 0.9, cell, ch * 0.1);
      g.fillStyle = '#16181c';
      g.font = font(ch * 0.6);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), x0 + cell / 2, y0 + ch * 0.54);
    });
    const boardTex = toTexture(c, { aniso: 8 });
    const boardMat = keep(new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6, color: 0xe6e2d8 }));
    const bb = new GeoBuilder();
    const face = new THREE.PlaneGeometry(0.8, 0.52);
    const frame = new THREE.BoxGeometry(0.84, 0.56, 0.025);
    const stakeG = new THREE.CylinderGeometry(0.014, 0.014, 0.6, 6);
    stakeG.translate(0, 0.3, 0);
    const darkC = new THREE.Color(0x24272c);
    for (const s of [-1, 1]) {
      nums.forEach((n, i) => {
        const rad = n + R0;
        const perp = new THREE.Vector3(s * Math.cos(A), 0, Math.sin(A));
        const p = new THREE.Vector3(s * rad * Math.sin(A), 0, -rad * Math.cos(A)).addScaledVector(perp, 1.35 + (r() - 0.5) * 0.3);
        const yaw = Math.atan2(-p.x, -p.z) + (r() - 0.5) * 0.12;
        const ux = (i % 3) / 3;
        const uy = 1 - (Math.floor(i / 3) + 1) / 2;
        bb.add(face, mat4(p.x, 0.62, p.z, yaw).multiply(mat4(0, 0, 0.014)), null, { uvRect: [ux, uy, 1 / 3, 0.5] });
        bb.add(frame, mat4(p.x, 0.62, p.z, yaw), darkC, { uvRect: [0.99, 0.99, 0.001, 0.001] });
        for (const sx of [-0.28, 0.28]) bb.add(stakeG, mat4(p.x, 0, p.z, yaw).multiply(mat4(sx, 0, -0.02)), darkC);
      });
    }
    mk(bb.build(), (boardMat.vertexColors = true, boardMat), 'boards');
  }

  // --- track ----------------------------------------------------------------------------------------------------
  const tileM = 12.5;
  const trTex = toTexture(paintTrackTile(S(1024), S(512), makeNoise(63, 256), tileM, ctx.venue === 'world' ? [30, 92, 172] : undefined), { wrap: true, aniso: 8 });
  const trackMat = keep(
    patchGround(new THREE.MeshStandardMaterial({ map: trTex, roughness: 0.62, metalness: 0 }), { detail: detailTex, detailScale: 3, macro: macroTex, macroScale: 1 / 70, macroAmt: 0.22, detailAmt: 0.2 }),
  );
  ctx.refs.trackMat = trackMat;
  const arcMid = ringArc(TRACK_W / 2, 480);
  const tileCount = Math.round(arcMid.total / tileM);
  // a loft of the surface with v across the width
  {
    const g = sweepRing(
      [
        [0, 0.012],
        [TRACK_W, 0.012],
      ],
      { segs: 240, uTile: arcMid.total / tileCount, vTile: TRACK_W, arcOff: TRACK_W / 2 },
    );
    mk(g, trackMat, 'track');
  }
  // curb (white, raised) and the concrete / asphalt apron on the outside
  {
    const curbMat = keep(new THREE.MeshStandardMaterial({ color: 0xdedbd0, roughness: 0.7 }));
    const g = sweepRing(
      [
        [-0.07, 0.0],
        [-0.07, 0.072],
        [0.0, 0.072],
        [0.0, 0.012],
      ],
      { segs: 240, uTile: 3, vTile: 3 },
    );
    mk(g, curbMat, 'curb');
    const apronTex = toTexture(
      paintPixels(S(256), S(256), (x, y, o) => {
        const n = noise.n2(x * 0.5, y * 0.5);
        const v = 78 + n * 26 + Math.random() * 12;
        o[0] = v;
        o[1] = v * 0.99;
        o[2] = v * 0.96;
      }).c,
      { wrap: true },
    );
    const apronMat = keep(patchGround(new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.9 }), { detail: detailTex, detailScale: 1.2, macro: macroTex, macroScale: 1 / 60, macroAmt: 0.3 }));
    const ag = sweepRing(
      [
        [TRACK_W, 0.012],
        [TRACK_W + 0.12, 0.012],
        [TRACK_W + 0.12, 0.05],
        [TRACK_W + 0.2, 0.05],
        [TRACK_W + 1.9, 0.05],
      ],
      { segs: 240, uTile: 6, vTile: 6 },
    );
    mk(ag, apronMat, 'apron');
  }
  // lane numbers + finish line + start lines + hurdle ticks: one merged decal mesh with a digit atlas
  {
    const dA = digitsAtlas(S(128));
    const numTex = toTexture(dA, { aniso: 8 });
    const numMat = keep(new THREE.MeshStandardMaterial({ map: numTex, transparent: true, depthWrite: false, roughness: 0.75, color: 0xeeeadf, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const gb = new GeoBuilder();
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const tang = new THREE.Vector3();
    const P = (v) => v.clone();
    const spots = [-0.78, 2.46, -2.4];
    for (const t of spots) {
      for (let l = 0; l < LANES; l++) {
        const off = (l + 0.5) * LANE_W;
        ringPoint(t, off, p);
        ringNormal(t, off, n);
        tang.set(-n.z, 0, n.x).multiplyScalar(-1); // running direction (counter-clockwise = -t)
        const sz = 0.62;
        const up = tang.clone().multiplyScalar(sz / 2);
        const rt = new THREE.Vector3(-tang.z, 0, tang.x).multiplyScalar(sz / 2 * 0.72);
        const c0 = p.clone().addScaledVector(up, -1).addScaledVector(rt, -1).setY(0.016);
        const c1 = p.clone().addScaledVector(up, -1).addScaledVector(rt, 1).setY(0.016);
        const c2 = p.clone().addScaledVector(up, 1).addScaledVector(rt, 1).setY(0.016);
        const c3 = p.clone().addScaledVector(up, 1).addScaledVector(rt, -1).setY(0.016);
        const u0 = l / 8;
        gb.quad(c0, c1, c2, c3, [u0, 0, u0 + 1 / 8, 0, u0 + 1 / 8, 1, u0, 1]);
      }
    }
    // finish line (white with a black edge) on the left straight in front of the home stand
    const tf = -1.52;
    const solid = new THREE.Color(0xf0eee6);
    const blk = new THREE.Color(0x15161a);
    const fb = new GeoBuilder();
    const strip = (t, w, col, y = 0.017) => {
      ringPoint(t, 0, p);
      ringNormal(t, 0, n);
      tang.set(-n.z, 0, n.x);
      const i0 = p.clone();
      ringPoint(t, TRACK_W, q);
      const o0 = q.clone();
      const hx = tang.clone().multiplyScalar(w / 2);
      fb.quad(i0.clone().sub(hx).setY(y), i0.clone().add(hx).setY(y), o0.clone().add(hx).setY(y), o0.clone().sub(hx).setY(y), undefined, col);
    };
    strip(tf, 0.06, solid);
    strip(tf + 0.012, 0.03, blk, 0.0172);
    strip(tf - 0.012, 0.03, blk, 0.0172);
    void P;
    mk(gb.build({ colors: false }), numMat, 'lane-numbers');
    mk(
      fb.build(),
      keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      'finish-line',
    );
  }

  return { turfTex, trackMat, tileCount };
}
