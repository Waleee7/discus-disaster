// WORLD CHAMPIONSHIPS STADIUM ("MERIDIAN GAMES", fictional): a modern 360-degree bowl built on the same ring maths as the
// college meet. Two raked tiers with vomitories and a concourse, a cantilever roof ring with a lamp rim and raking struts,
// a packed varied crowd in fan blocks with waving flags, an LED ribbon at the wall and the concourse fascia, two giant
// video boards, an official results board, a broadcast camera rail, and an open ceremonial end with a flame tower.
// Original design: no rings, no real event / sponsor / federation marks. Reuses util.js, field.js (blue track), cage.js.
import * as THREE from 'three';
import { clamp, lerp, smooth, makeNoise, makeCanvas, toTexture, paintPixels, patchGround, GeoBuilder, mat4, sweepRing, ringPoint, ringArc, mulberry32 } from './util.js';
import { buildCrowd } from './stands.js';
import { font } from './field.js';

const O_WALL = 11.7;
const LOWER = { rows: 20, d: 0.86, rise: 0.4, o0: 13.2, y0: 0.55 };
const CONC = 4.2; // concourse depth (m)
const UPPER = { rows: 24, d: 0.82, rise: 0.47 };
const GAP = 0.085; // half-width (rad) of the open ceremonial end at t = 0

// fan blocks: each block wears its own colours (no real flags / crests, just colour families)
const BLOCKS = [
  [0xd62f3a, 0xf2efe6, 0x1b1d22], [0x2c5fd0, 0xf4c73a, 0xf2efe6], [0x1f9d6a, 0xf2efe6, 0x16261d], [0xf08a1c, 0xf2efe6, 0x2a2118],
  [0x7b2cbf, 0xf2efe6, 0xd9c46a], [0x18a8c4, 0x0e1b3a, 0xf2efe6], [0x8c1a2b, 0xe9d3a1, 0x1b1d22], [0xe8d33a, 0x1c3f78, 0x1b1d22],
  [0xd83a8a, 0xf2efe6, 0x2b2b33], [0x3f4a58, 0xf2efe6, 0xd62f3a], [0x3a9bd8, 0xf2efe6, 0x1c3f78], [0x2f7a3a, 0xe8d33a, 0xf2efe6],
];
const FLAG_COLS = [0xd62f3a, 0x2c5fd0, 0xf4c73a, 0x1f9d6a, 0xf2efe6, 0x1b1d22, 0xf08a1c, 0x7b2cbf, 0x18a8c4, 0xd83a8a];

function paintSeats(N, tone, noise) {
  // columns: seat shells every 0.5 m along the arc (8 per tile); rows: tread (68%) then riser. A few shells in accent colours.
  return paintPixels(N, N, (x, y, o) => {
    const seat = Math.floor((x / N) * 8);
    const cell = noise.n2(seat * 3.1, 7.7);
    const tread = y / N < 0.68;
    const gap = ((x / N) * 8) % 1;
    let r = tone[0];
    let g = tone[1];
    let b = tone[2];
    if (cell > 0.82) [r, g, b] = [tone[3], tone[4], tone[5]];
    if (!tread) [r, g, b] = [52, 55, 62];
    const dark = tread && (gap < 0.07 || gap > 0.93) ? 0.55 : 1;
    const sh = 0.92 + noise.n2(x * 0.7, y * 0.7) * 0.16;
    o[0] = r * dark * sh;
    o[1] = g * dark * sh;
    o[2] = b * dark * sh;
  }).c;
}

function paintRibbon(W, H, seed, scheme) {
  const r = mulberry32(seed);
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = '#05070b';
  g.fillRect(0, 0, W, H);
  const words = ['MERIDIAN GAMES', 'WORLD STADIUM', 'TEAM  RESPECT  SPORT', 'MERIDIAN 26', 'THROWS DAY 3', 'MEN’S DISCUS'];
  const cols = scheme === 'wall' ? ['#18a8c4', '#e8d33a', '#d83a8a', '#f4f1e8', '#2c5fd0'] : ['#18a8c4', '#f4f1e8', '#e8d33a'];
  const n = 8;
  const w = W / n;
  for (let i = 0; i < n; i++) {
    const col = cols[Math.floor(r() * cols.length)];
    g.fillStyle = col;
    g.globalAlpha = 0.9;
    g.fillRect(i * w + 6, 6, w - 12, H - 12);
    g.globalAlpha = 1;
    g.fillStyle = col === '#f4f1e8' || col === '#e8d33a' ? '#0b0e14' : '#fff';
    g.font = font(H * 0.46);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(words[Math.floor(r() * words.length)], i * w + w / 2, H * 0.54, w - 28);
  }
  // LED pixel grid
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let x = 0; x < W; x += 5) g.fillRect(x, 0, 1.2, H);
  for (let y = 0; y < H; y += 5) g.fillRect(0, y, W, 1.2);
  return c;
}

function paintVideo(W, H, kind) {
  const { c, g } = makeCanvas(W, H);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0a1630');
  grad.addColorStop(1, '#07304a');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d62f3a';
  g.fillRect(W * 0.03, H * 0.07, W * 0.1, H * 0.12);
  g.fillStyle = '#fff';
  g.font = font(H * 0.1);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('LIVE', W * 0.045, H * 0.133);
  g.fillStyle = '#9fd8e8';
  g.font = font(H * 0.07);
  g.fillText('MERIDIAN GAMES  ·  MEN’S DISCUS THROW  ·  FINAL', W * 0.16, H * 0.135);
  if (kind === 'replay') {
    // a generic replay card: a silhouette thrower on a lit field, distance counter and a ticker
    const fg = g.createLinearGradient(0, H * 0.25, 0, H * 0.82);
    fg.addColorStop(0, '#0d2a2a');
    fg.addColorStop(1, '#1d5a3a');
    g.fillStyle = fg;
    g.fillRect(W * 0.03, H * 0.25, W * 0.58, H * 0.57);
    g.fillStyle = '#05080c';
    g.beginPath();
    g.ellipse(W * 0.2, H * 0.62, W * 0.035, H * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(W * 0.2, H * 0.4, H * 0.055, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#f4f1e8';
    g.lineWidth = H * 0.012;
    g.beginPath();
    g.moveTo(W * 0.24, H * 0.5);
    g.quadraticCurveTo(W * 0.42, H * 0.2, W * 0.58, H * 0.7);
    g.stroke();
    g.fillStyle = '#f4f1e8';
    g.font = font(H * 0.26);
    g.textAlign = 'left';
    g.fillText('67.84', W * 0.66, H * 0.43);
    g.fillStyle = '#e8d33a';
    g.font = font(H * 0.09);
    g.fillText('METRES  ·  SEASON BEST', W * 0.66, H * 0.6);
    g.fillStyle = '#9fd8e8';
    g.fillText('ROUND 2  ·  THROW 4', W * 0.66, H * 0.72);
  } else {
    g.fillStyle = '#f4f1e8';
    g.font = font(H * 0.2);
    g.textAlign = 'center';
    g.fillText('MEN’S DISCUS', W / 2, H * 0.46);
    g.fillStyle = '#18a8c4';
    g.font = font(H * 0.13);
    g.fillText('MERIDIAN GAMES', W / 2, H * 0.68);
  }
  g.fillStyle = '#d62f3a';
  g.fillRect(0, H * 0.88, W, H * 0.12);
  g.fillStyle = '#fff';
  g.font = font(H * 0.07);
  g.textAlign = 'left';
  g.fillText('FINAL  •  FLIGHT 2  •  WIND +0.9  •  SEASON LEADERS  •  BEST MARK 70.12 M  •  NEXT ATHLETE', W * 0.03, H * 0.94);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  return c;
}

function paintResults(W, H) {
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = '#071223';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#18a8c4';
  g.fillRect(0, 0, W, H * 0.14);
  g.fillStyle = '#041018';
  g.font = font(H * 0.1);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('RESULTS  ·  MEN’S DISCUS THROW  ·  FINAL', W * 0.02, H * 0.075);
  const rows = [['1', 'A. VELASQ', 'MRD', '68.42'], ['2', 'T. HOLMGR', 'NRL', '67.91'], ['3', 'K. OSEI', 'TAV', '67.30'], ['4', 'R. DUBOIS', 'ELY', '66.85'], ['5', 'J. NAKAMA', 'SOR', '65.77'], ['6', 'D. PETROV', 'KAL', '65.12'], ['7', 'M. ABARA', 'ZEN', '64.40'], ['8', 'L. FERRO', 'VIA', '63.98']];
  rows.forEach((r, i) => {
    const y = H * (0.2 + i * 0.097);
    if (i % 2) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, y - H * 0.04, W, H * 0.095);
    }
    g.fillStyle = i < 3 ? '#e8d33a' : '#cfe3ee';
    g.font = font(H * 0.08);
    g.textAlign = 'left';
    g.fillText(r[0], W * 0.03, y + H * 0.01);
    g.fillText(r[1], W * 0.09, y + H * 0.01);
    g.fillStyle = '#7fa6b8';
    g.fillText(r[2], W * 0.6, y + H * 0.01);
    g.fillStyle = i < 3 ? '#e8d33a' : '#ffffff';
    g.textAlign = 'right';
    g.fillText(r[3], W * 0.97, y + H * 0.01);
  });
  return c;
}

export function buildBowl(ctx) {
  const { root, tier, S, keep, macroTex, detailTex } = ctx;
  const rnd = mulberry32(4242);
  const noise = makeNoise(21, 64);
  const mk = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    root.add(m);
    return m;
  };
  const arcOf = (o) => ringArc(o, 480);
  const T0 = GAP;
  const T1 = Math.PI * 2 - GAP; // the bowl runs once round, leaving the open end at t = 0 (wrapped through +-PI)
  // ring parameter t spans [-PI, PI]; walk it from GAP to 2PI-GAP and fold back
  const wrap = (t) => (t > Math.PI ? t - Math.PI * 2 : t);
  const rowYL = (k) => LOWER.y0 + LOWER.rise * (k + 1);
  const yConc = rowYL(LOWER.rows - 1);
  const oConc0 = LOWER.o0 + LOWER.rows * LOWER.d;
  const oUp0 = oConc0 + CONC;
  const rowYU = (k) => yConc + 0.5 + UPPER.rise * (k + 1);
  const oBack = oUp0 + UPPER.rows * UPPER.d;
  const yTop = rowYU(UPPER.rows - 1);

  // ---- materials ---------------------------------------------------------------------------------------------
  const seatTexL = toTexture(paintSeats(S(256), [28, 52, 104, 24, 140, 160], noise), { wrap: true, aniso: 4 });
  const seatTexU = toTexture(paintSeats(S(256), [58, 72, 98, 190, 190, 196], noise), { wrap: true, aniso: 4 });
  const seatL = keep(new THREE.MeshLambertMaterial({ map: seatTexL }));
  const seatU = keep(new THREE.MeshLambertMaterial({ map: seatTexU }));
  const concrete = keep(patchGround(new THREE.MeshLambertMaterial({ color: 0x777b82 }), { detail: detailTex, detailScale: 0.8, macro: macroTex, macroScale: 1 / 40, macroAmt: 0.25, detailAmt: 0.1 }));
  const darkMat = keep(new THREE.MeshLambertMaterial({ color: 0x14171d, side: THREE.DoubleSide }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x8e98a2, roughness: 0.4, metalness: 0.5 }));
  const roofTop = keep(new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }));
  const glass = keep(new THREE.MeshStandardMaterial({ color: 0x1a2b3a, roughness: 0.12, metalness: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));

  // ---- terraces ----------------------------------------------------------------------------------------------
  const terraces = (rows, d, rise, o0, rowY, mat, name) => {
    const oMid = o0 + (rows * d) / 2;
    const prof = [[o0, 0]];
    for (let k = 0; k < rows; k++) prof.push([o0 + k * d, rowY(k)], [o0 + (k + 1) * d, rowY(k)]);
    prof.push([o0 + rows * d, 0]);
    const len = arcOf(oMid).total;
    // the terrace is one sweep from GAP round to 2PI-GAP (arc lengths unwrap across the +-PI seam)
    const g = sweepRing(prof, { t0: T0, t1: T1, segs: Math.ceil(len / 3.4), uTile: 4, vTile: d + rise, arcOff: oMid });
    mk(g, mat, name);
  };
  terraces(LOWER.rows, LOWER.d, LOWER.rise, LOWER.o0, rowYL, seatL, 'bowl-lower');
  // concourse deck + glass balustrade + back wall with vomitory openings
  {
    const deck = sweepRing([[oConc0, yConc], [oUp0, yConc], [oUp0, 0]], { t0: T0, t1: T1, segs: 200, uTile: 4, vTile: 4, arcOff: oConc0 });
    mk(deck, concrete, 'concourse');
    const bal = sweepRing([[oConc0 + 0.05, yConc], [oConc0 + 0.05, yConc + 1.1]], { t0: T0, t1: T1, segs: 200, uTile: 4, vTile: 1, arcOff: oConc0 });
    mk(bal, glass, 'balustrade');
    const rail = sweepRing([[oConc0 + 0.02, yConc + 1.1], [oConc0 + 0.1, yConc + 1.1], [oConc0 + 0.1, yConc + 1.16]], { t0: T0, t1: T1, segs: 200, uTile: 4, vTile: 1, arcOff: oConc0 });
    mk(rail, steel, 'concourse-rail');
  }
  terraces(UPPER.rows, UPPER.d, UPPER.rise, oUp0, rowYU, seatU, 'bowl-upper');
  // under-bowl wall (below the lower tier's front edge to the ground) and the ribbon at the hoarding
  const wallMat = keep(patchGround(new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }), { detail: detailTex, macro: macroTex, macroScale: 1 / 40, macroAmt: 0.2, detailAmt: 0.1 }));
  mk(sweepRing([[O_WALL, 0], [O_WALL, 1.05], [O_WALL + 0.2, 1.05], [O_WALL + 0.2, 0]], { t0: T0, t1: T1, segs: 240, uTile: 4, vTile: 4, arcOff: O_WALL }), wallMat, 'hoarding');
  mk(sweepRing([[O_WALL + 0.2, 1.05], [O_WALL + 1.5, 1.05 + 0.1], [LOWER.o0, 0.4]], { t0: T0, t1: T1, segs: 240, uTile: 4, vTile: 4, arcOff: O_WALL }), concrete, 'apron-slope');
  const ribbonTex = toTexture(paintRibbon(S(2048), S(128), 5, 'wall'), { wrap: true, aniso: 8 });
  const ribbonMat = keep(new THREE.MeshBasicMaterial({ map: ribbonTex, color: 0xb8b8b8, toneMapped: true, side: THREE.DoubleSide }));
  const ribLen = arcOf(O_WALL - 0.02).total;
  mk(sweepRing([[O_WALL - 0.02, 0.1], [O_WALL - 0.02, 1.02]], { t0: T0, t1: T1, segs: 240, uTile: ribLen / 14, vTile: 0.92, vOff: 0, arcOff: O_WALL - 0.02 }), ribbonMat, 'ribbon-wall');
  // fascia ribbon on the concourse back wall (upper tier front), and a dark fascia band under the roof
  const fasTex = toTexture(paintRibbon(S(2048), S(96), 9, 'fascia'), { wrap: true, aniso: 8 });
  const fasMat = keep(new THREE.MeshBasicMaterial({ map: fasTex, color: 0x9a9a9a, side: THREE.DoubleSide }));
  const fasLen = arcOf(oUp0 - 0.05).total;
  mk(sweepRing([[oUp0 - 0.05, yConc + 0.45], [oUp0 - 0.05, yConc + 1.45]], { t0: T0, t1: T1, segs: 240, uTile: fasLen / 18, vTile: 1, arcOff: oUp0 - 0.05 }), fasMat, 'ribbon-fascia');

  // ---- aisles + vomitories (radial stair stripes and dark tunnel mouths) -----------------------------------------
  {
    const gb = new GeoBuilder();
    const aisleMat = keep(new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }));
    const nA = 40;
    const arcL = arcOf(LOWER.o0 + (LOWER.rows * LOWER.d) / 2);
    const arcU = arcOf(oUp0 + (UPPER.rows * UPPER.d) / 2);
    const aisles = [];
    for (let i = 0; i < nA; i++) {
      const af = (i + 0.5) / nA; // arc fraction round the bowl (the same on every tier, so the stairs line up)
      aisles.push(af);
      for (const [o0, rows, d, rowY, arc] of [[LOWER.o0, LOWER.rows, LOWER.d, rowYL, arcL], [oUp0, UPPER.rows, UPPER.d, rowYU, arcU]]) {
        const L0 = arc.lenAt(T0);
        const s = L0 + af * (arc.lenAt(T1) - L0);
        const a = arc.tAt(s - 0.6);
        const b = arc.tAt(s + 0.6);
        const prof = [];
        for (let k = 0; k < rows; k++) prof.push([o0 + k * d, rowY(k) + 0.012], [o0 + (k + 1) * d, rowY(k) + 0.012]);
        const g = sweepRing(prof, { t0: a, t1: b, segs: 1, uTile: 4, vTile: 4, arcOff: o0 + (rows * d) / 2 });
        gb.add(g);
        g.dispose();
      }
      if (i % 2 === 0) {
        // vomitory: a dark mouth in the concourse back wall
        const L0 = arcU.lenAt(T0);
        const tt = arcU.tAt(L0 + af * (arcU.lenAt(T1) - L0));
        const p = ringPoint(tt, oUp0 - 0.03, new THREE.Vector3());
        const q = ringPoint(tt, oUp0 + 2.5, new THREE.Vector3());
        const dir = q.clone().sub(p).normalize();
        const m4 = new THREE.Matrix4().lookAt(p, p.clone().add(dir), new THREE.Vector3(0, 1, 0));
        const mouth = new THREE.PlaneGeometry(2.6, 2.4);
        mouth.applyMatrix4(m4);
        mouth.translate(p.x, yConc + 1.3, p.z);
        gb.add(mouth);
        mouth.dispose();
      }
    }
    mk(gb.build({ colors: false }), aisleMat, 'aisles');
    root.userData.aisles = aisles;
  }

  // ---- back wall / facade, roof ring and struts ------------------------------------------------------------------
  const roofIn = 22.5; // inner edge offset
  const roofOut = oBack + 5;
  const yIn = yTop + 7.4;
  const yOut = yTop + 12.5;
  {
    mk(sweepRing([[oBack, 0], [oBack, yTop + 1.2]], { t0: T0, t1: T1, segs: 200, uTile: 6, vTile: 6, arcOff: oBack }), concrete, 'back-wall');
    // cantilever roof: top skin, thin edge, and a dark underside
    mk(sweepRing([[roofIn, yIn + 0.5], [roofIn, yIn - 0.2], [roofOut, yOut - 0.5], [roofOut, yOut + 0.3], [roofIn, yIn + 0.5]], { t0: T0, t1: T1, segs: 200, uTile: 6, vTile: 6, arcOff: oBack }), roofTop, 'roof');
    const under = paintPixels(S(128), S(128), (x, y, o) => {
      const panel = (x / S(128)) * 6 % 1 < 0.04 ? 20 : 0;
      const v = 38 + noise.n2(x * 0.2, y * 0.2) * 14 - panel;
      o[0] = v;
      o[1] = v * 1.02;
      o[2] = v * 1.08;
    }).c;
    const underMat = keep(new THREE.MeshLambertMaterial({ map: toTexture(under, { wrap: true }), side: THREE.DoubleSide }));
    mk(sweepRing([[roofIn, yIn - 0.2], [roofOut, yOut - 0.5]], { t0: T0, t1: T1, segs: 200, uTile: 4, vTile: 6, arcOff: oBack }), underMat, 'roof-under');
    // rim truss (box section) and a second thin lamp rail
    mk(sweepRing([[roofIn - 0.5, yIn - 0.55], [roofIn + 0.3, yIn - 0.55], [roofIn + 0.3, yIn + 0.7], [roofIn - 0.5, yIn + 0.7], [roofIn - 0.5, yIn - 0.55]], { t0: T0, t1: T1, segs: 200, uTile: 3, vTile: 3, arcOff: roofIn }), steel, 'roof-rim');
    // raking struts: instanced beams from the back wall top up to the roof underside, plus vertical back columns
    const n = 72;
    const strut = new THREE.CylinderGeometry(0.28, 0.34, 1, 6);
    strut.translate(0, 0.5, 0);
    const sm = new THREE.InstancedMesh(strut, steel, n * 2);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const arcB = arcOf(oBack);
    let ii = 0;
    for (let i = 0; i < n; i++) {
      const s = arcB.lenAt(T0) + ((arcB.lenAt(T1) - arcB.lenAt(T0)) * (i + 0.5)) / n;
      const t = arcB.tAt(s);
      ringPoint(t, oBack - 0.3, a).setY(0);
      ringPoint(t, oBack - 0.3, b).setY(yTop + 1.2);
      m4.lookAt(a, b, new THREE.Vector3(0, 0, 1));
      // columns (vertical)
      m4.compose(a, new THREE.Quaternion(), new THREE.Vector3(1, b.y, 1));
      sm.setMatrixAt(ii++, m4);
      // struts (from the column head up and inward to the roof underside)
      ringPoint(t, oBack - 0.3, a).setY(yTop + 1.2);
      ringPoint(t, roofIn + 8, b).setY(lerp(yIn, yOut, (roofIn + 8 - roofIn) / (roofOut - roofIn)) - 0.6);
      const dir = b.clone().sub(a);
      const len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m4.compose(a, q, new THREE.Vector3(1, len, 1));
      sm.setMatrixAt(ii++, m4);
    }
    sm.frustumCulled = false;
    root.add(sm);
    // roof-rim lamp bank: the stadium's floodlights, a continuous strip of small hard sources
    const lampG = new THREE.BoxGeometry(0.46, 0.2, 0.36);
    const lamps = new THREE.InstancedMesh(lampG, keep(new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false })), 420);
    const arcR = arcOf(roofIn - 0.6);
    const lt0 = arcR.lenAt(T0);
    const lt1 = arcR.lenAt(T1);
    for (let i = 0; i < 420; i++) {
      const t = arcR.tAt(lt0 + ((lt1 - lt0) * (i + 0.5)) / 420);
      ringPoint(t, roofIn - 0.55, a);
      // lamps face the field: yaw toward the centre, small downward pitch
      const yaw = Math.atan2(-a.x, -a.z - 0);
      m4.compose(a.setY(yIn - 0.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, yaw + Math.PI, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(i, m4);
    }
    lamps.frustumCulled = false;
    root.add(lamps);
    root.userData.lampMat = lamps.material;
  }

  // ---- video boards, results board, camera rail, flame tower ------------------------------------------------------
  const curved = (t0, t1, off, y0, y1, canvas, name, { emissive = 0.9 } = {}) => {
    const tex = toTexture(canvas, { aniso: 8 });
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(emissive, emissive, emissive), side: THREE.DoubleSide }));
    const len = arcOf(off).lenAt(t1) - arcOf(off).lenAt(t0);
    mk(sweepRing([[off, y0], [off, y1]], { t0, t1, segs: 24, uTile: len, vTile: y1 - y0, arcOff: off }), mat, name);
    // thin dark frame behind and around
    const fr = sweepRing([[off + 0.05, y0 - 0.5], [off + 0.05, y1 + 0.5]], { t0: t0 - 0.004, t1: t1 + 0.004, segs: 24, uTile: 4, vTile: 4, arcOff: off });
    mk(fr, darkMat, name + '-frame');
  };
  // giant boards on the upper-tier fascia: the far-right end (replay) and the far-left side (title card)
  curved(0.2, 0.42, oUp0 - 0.12, yConc + 1.9, yConc + 8.4, paintVideo(S(1024), S(512), 'replay'), 'video-board-a');
  curved(-1.2, -0.97, oUp0 - 0.12, yConc + 1.9, yConc + 8.4, paintVideo(S(1024), S(512), 'title'), 'video-board-b');
  // official results board, left of the far end
  curved(-0.62, -0.36, oUp0 - 0.12, yConc + 1.9, yConc + 8.0, paintResults(S(1024), S(512)), 'results-board');

  // broadcast camera rail on the infield (left of the sector): twin rails, sleepers, a dolly with a camera on a boom and an operator
  {
    const gb = new GeoBuilder();
    const railC = new THREE.Color(0x9aa3ab);
    const dark = new THREE.Color(0x1d2026);
    const x = -26;
    const z0 = -16;
    const z1 = -78;
    for (const dx of [-0.35, 0.35]) gb.add(new THREE.BoxGeometry(0.06, 0.07, z0 - z1), mat4(x + dx, 0.07, (z0 + z1) / 2), railC);
    for (let z = z1; z <= z0; z += 2.4) gb.add(new THREE.BoxGeometry(1.1, 0.07, 0.14), mat4(x, 0.02, z), dark);
    const dz = -44;
    gb.add(new THREE.BoxGeometry(1.0, 0.35, 1.5), mat4(x, 0.3, dz), new THREE.Color(0x242830));
    gb.add(new THREE.BoxGeometry(0.16, 1.1, 0.16), mat4(x, 1.0, dz - 0.2), railC);
    gb.add(new THREE.BoxGeometry(0.14, 0.14, 2.6), mat4(x + 0.1, 1.6, dz - 1.1, 0.03), new THREE.Color(0x30353d));
    gb.add(new THREE.BoxGeometry(0.34, 0.3, 0.55), mat4(x + 0.1, 1.55, dz - 2.4), dark);
    gb.add(new THREE.CylinderGeometry(0.1, 0.12, 0.34, 10), mat4(x + 0.1, 1.55, dz - 2.78, 0, 1, 1, 1, Math.PI / 2, 0), new THREE.Color(0x101216));
    gb.add(new THREE.CapsuleGeometry(0.17, 0.55, 3, 8), mat4(x - 0.15, 0.95, dz + 0.55), new THREE.Color(0xe8ecf0)); // operator
    gb.add(new THREE.SphereGeometry(0.12, 8, 6), mat4(x - 0.15, 1.6, dz + 0.55), new THREE.Color(0x8a5a3c));
    mk(gb.build(), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 })), 'camera-rail');
    ctx.contacts.push([x, dz, 1.6, 2.2, 0, 0.5]);
  }

  // flame tower in the open end: tapering shaft, flared bowl, a small living flame (additive cones) and one warm point light
  const flame = new THREE.Group();
  {
    const p = ringPoint(0, 26, new THREE.Vector3());
    const prof = [[0, 0], [2.6, 0], [2.3, 0.7], [1.0, 1.1], [0.62, 12], [0.7, 18], [1.7, 20.2], [2.2, 22.5], [1.9, 22.7], [0.0, 22.7]].map(([r, y]) => new THREE.Vector2(r, y));
    const shaft = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), keep(new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.38, metalness: 0.7, side: THREE.DoubleSide })));
    shaft.position.copy(p);
    root.add(shaft);
    // stepped ceremonial plinth
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(6.5 - i * 1.3, 6.9 - i * 1.3, 0.3, 28), concrete);
      st.position.set(p.x, 0.15 + i * 0.3, p.z);
      root.add(st);
    }
    const cone = (r, h, col, op) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.position.y = h / 2;
      return m;
    };
    const f1 = cone(1.5, 4.2, 0xff7a1a, 0.42);
    const f2 = cone(1.0, 3.3, 0xffb040, 0.5);
    const f3 = cone(0.5, 2.3, 0xfff0c0, 0.55);
    flame.add(f1, f2, f3);
    flame.position.set(p.x, 22.7, p.z);
    root.add(flame);
    const pl = new THREE.PointLight(0xff9a40, 40, 34, 1.6);
    pl.position.set(p.x, 24.5, p.z);
    root.add(pl);
    flame.userData = { f1, f2, f3, pl };
  }

  // ---- crowd: fan blocks, packed lower tier, fuller upper tier --------------------------------------------------------
  const seats = [];
  const flagSeats = [];
  const blocks = BLOCKS.map((pal, i) => ({ id: 'b' + i, pal, school: 0.62, standing: 0.09, cluster: 1, t0: T0 + ((T1 - T0) * i) / BLOCKS.length, t1: T0 + ((T1 - T0) * (i + 1)) / BLOCKS.length }));
  const neutral = { id: 'n', pal: [0x2a2e35], school: 0, standing: 0.04, cluster: 1 };
  const fld = makeNoise(77, 64);
  const aisleT = root.userData.aisles;
  const addTier = (o0, rows, d, rowY, occ, tierId) => {
    for (let k = 0; k < rows; k++) {
      const oc = o0 + k * d + d * 0.5 + 0.15;
      const arc = arcOf(oc);
      const ra = arc.lenAt(T0);
      const rb = arc.lenAt(T1);
      const y = rowY(k) + 0.41;
      const rf = k / rows;
      const sp = 0.54;
      for (let s = ra + 0.5; s < rb - 0.5; s += sp + rnd() * 0.06) {
        const t = arc.tAt(s);
        const f = (s - ra) / (rb - ra);
        if (aisleT.some((a) => Math.abs(a - f) * (rb - ra) < 0.65)) continue;
        const g = fld.fbm(f * 90, k * 0.5 + tierId * 9, 3);
        const base = occ * (0.3 + 1.35 * smooth(0.25, 0.68, g)) * (1.12 - 0.3 * rf);
        if (rnd() > base) continue;
        const blk = blocks[Math.min(blocks.length - 1, Math.floor(f * blocks.length))] || neutral;
        seats.push({ t: wrap(t), off: oc + (rnd() - 0.5) * 0.1, y, sec: blk, k, rf, sp: rnd() });
        if (rnd() < 0.011 && k > 1 && k < rows - 2) flagSeats.push({ t: wrap(t), off: oc, y: y + 1.5, k, blk });
      }
    }
  };
  addTier(LOWER.o0, LOWER.rows, LOWER.d, rowYL, 0.9, 0);
  addTier(oUp0, UPPER.rows, UPPER.d, rowYU, 0.82, 1);
  const crowd = buildCrowd(seats, tier, ctx.onFrame);
  root.add(crowd.mesh);

  // ---- waving flags (one instanced draw; stripes / split / bars from per-instance colours, a vertex-shader wave) -------
  const nF = flagSeats.length;
  const fg = new THREE.PlaneGeometry(1.15, 0.72, 8, 1);
  fg.translate(0.575, 0, 0);
  const col = new Float32Array(nF * 9);
  const pat = new Float32Array(nF);
  const ph = new Float32Array(nF);
  const pole = new GeoBuilder();
  const flagGeo = new THREE.InstancedBufferGeometry().copy(fg);
  const im = new THREE.Matrix4();
  const flagMat = keep(new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0 } },
    vertexShader: `uniform float uTime; attribute vec3 aC1; attribute vec3 aC2; attribute vec3 aC3; attribute float aPat; attribute float aPh; varying vec2 vUv; varying vec3 vC1; varying vec3 vC2; varying vec3 vC3; varying float vPat; varying float vD;
      void main(){ vUv = uv; vC1 = aC1; vC2 = aC2; vC3 = aC3; vPat = aPat;
        vec3 p = position; float w = sin(uTime * 4.0 + aPh + p.x * 5.0) * 0.07 * p.x + sin(uTime * 2.4 + aPh * 1.7 + p.x * 3.0) * 0.04 * p.x; p.z += w; p.y += sin(uTime * 3.0 + aPh + p.x * 4.0) * 0.025 * p.x;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uFogCol; uniform float uFogD; varying vec2 vUv; varying vec3 vC1; varying vec3 vC2; varying vec3 vC3; varying float vPat; varying float vD;
      void main(){ vec3 c; float a = vPat;
        if (a < 0.5) c = vUv.y > 0.66 ? vC1 : vUv.y > 0.33 ? vC2 : vC3;
        else if (a < 1.5) c = vUv.x > 0.66 ? vC1 : vUv.x > 0.33 ? vC2 : vC3;
        else if (a < 2.5) c = (vUv.x + vUv.y) > 1.0 ? vC1 : vC2;
        else c = (abs(vUv.y - 0.5) < 0.12 || abs(vUv.x - 0.4) < 0.09) ? vC2 : vC1;
        c *= 0.72;
        float f = 1.0 - exp(-uFogD * uFogD * vD * vD); c = mix(c, uFogCol, clamp(f, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, nF);
  const cc = new THREE.Color();
  const q0 = new THREE.Quaternion();
  const pv = new THREE.Vector3();
  const poleG = new THREE.CylinderGeometry(0.018, 0.018, 1.7, 5);
  poleG.translate(0, -0.85, 0);
  flagSeats.forEach((f, i) => {
    ringPoint(f.t, f.off, pv);
    const yaw = Math.atan2(-pv.x, -pv.z) + (rnd() - 0.5) * 1.4;
    im.compose(pv.clone().setY(f.y + 0.2), q0.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2), new THREE.Vector3(0.9 + rnd() * 0.5, 0.9 + rnd() * 0.5, 1));
    flags.setMatrixAt(i, im);
    const picks = [f.blk.pal[0], f.blk.pal[1], FLAG_COLS[Math.floor(rnd() * FLAG_COLS.length)]];
    for (let j = 0; j < 3; j++) {
      cc.setHex(picks[(j + (rnd() < 0.5 ? 0 : 1)) % 3]);
      col.set([cc.r, cc.g, cc.b], i * 9 + j * 3);
    }
    pat[i] = Math.floor(rnd() * 4);
    ph[i] = rnd() * 6.28;
    pole.add(poleG, im.clone().compose(pv.clone().setY(f.y + 0.2), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)), new THREE.Color(0xcfd3d8));
  });
  flagGeo.setAttribute('aC1', new THREE.InstancedBufferAttribute(new Float32Array(nF * 3).map((_, k) => col[Math.floor(k / 3) * 9 + (k % 3)]), 3));
  flagGeo.setAttribute('aC2', new THREE.InstancedBufferAttribute(new Float32Array(nF * 3).map((_, k) => col[Math.floor(k / 3) * 9 + 3 + (k % 3)]), 3));
  flagGeo.setAttribute('aC3', new THREE.InstancedBufferAttribute(new Float32Array(nF * 3).map((_, k) => col[Math.floor(k / 3) * 9 + 6 + (k % 3)]), 3));
  flagGeo.setAttribute('aPat', new THREE.InstancedBufferAttribute(pat, 1));
  flagGeo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
  flags.frustumCulled = false;
  root.add(flags);
  mk(pole.build(), keep(new THREE.MeshBasicMaterial({ vertexColors: true })), 'flag-poles');

  // ---- lights: hemisphere + a ground-level fill + spots on the roof rim, aimed across the field ----------------------
  const hemi = new THREE.HemisphereLight(0x6f86c4, 0x251c12, 0.5);
  const key = new THREE.PointLight(0xffd2a0, 14, 26, 1.5);
  key.position.set(-4.5, 5.5, 2.5);
  root.add(hemi, key);
  const AIM = [[12, -6], [58, 5], [30, 8], [66, -7], [38, -4], [4, 9]];
  const TS = [-2.45, -1.55, -0.62, 0.55, 1.5, 2.55];
  const ORDER = [0, 3, 1, 4, 2, 5];
  const spots = [];
  ORDER.slice(0, tier.spots).forEach((idx) => {
    const p = ringPoint(TS[idx], roofIn - 0.5, new THREE.Vector3());
    const aim = new THREE.Vector3(AIM[idx][1], 0, -AIM[idx][0]);
    const dist = Math.hypot(p.x - aim.x, yIn - 0, p.z - aim.z);
    const sl = new THREE.SpotLight(0xffeeda, 380 * (6 / tier.spots) ** 0.75 * (dist / 60) ** 1.1, 0, 0.62, 0.75, 1.1);
    sl.position.set(p.x, yIn - 0.3, p.z);
    sl.target.position.copy(aim);
    root.add(sl, sl.target);
    spots.push(sl);
  });
  const spotBase = spots.map((s) => s.intensity);
  const stub = { uniforms: { uI: { value: 0 } } };
  const lights = {
    beams: [],
    halos: [],
    spots,
    hemi,
    key,
    haloMat: { opacity: 1 },
    beamMat: stub,
    setHaze() {},
    setLevel(k) {
      spots.forEach((s, i) => (s.intensity = spotBase[i] * k));
      root.userData.lampMat.color.setHex(0xfff1d6).multiplyScalar(0.3 + 0.7 * k);
    },
  };

  return {
    crowd,
    lights,
    gaps: [],
    sections: blocks,
    update(t) {
      flagMat.uniforms.uTime.value = t;
      const { f1, f2, f3, pl } = flame.userData;
      const fl = 1 + 0.12 * Math.sin(t * 9) + 0.08 * Math.sin(t * 15 + 1);
      f1.scale.set(1 + 0.08 * Math.sin(t * 7), fl, 1);
      f2.scale.set(1, 1 + 0.15 * Math.sin(t * 11 + 2), 1);
      f3.scale.set(1, 1 + 0.2 * Math.sin(t * 13 + 4), 1);
      pl.intensity = 36 + 6 * Math.sin(t * 10);
    },
    setFog(col, density) {
      flagMat.uniforms.uFogCol.value.copy(col);
      flagMat.uniforms.uFogD.value = density;
    },
    flame,
  };
}
export { clamp };
