// STANDS: a grandstand with roof + press box (left), aluminium visitor bleachers (right), a student-section end stand
// with scoreboard (far end) and a few rows behind the circle. Tiered terraces, benches, aisles with handrails, front
// banner wall + rail, plus a chain-link fence in the gaps. Spectators are one InstancedMesh of lit, fogged figures that
// are deliberately NOT a full house: clusters, empty seats, aisles, a few standing, school colours by section.
import * as THREE from 'three';
import {
  ARENA, clamp, lerp, smooth, makeNoise, makeCanvas, toTexture, paintPixels, patchGround, GeoBuilder, mat4, sweepRing, ringPoint, ringNormal,
  ringArc, mulberry32,
} from './util.js';
import { font } from './field.js';

const O_WALL = 11.7; // banner wall offset (track ends at 9.76, apron to 11.66)
const O_START = 12.7; // first tread

export const SECTIONS = [
  { id: 'home', t0: -2.62, t1: -0.6, rows: 27, depth: 0.88, rise: 0.42, kind: 'grand', occ: 0.55, aisle: 12.5, school: 0.5, standing: 0.07, cluster: 1 },
  { id: 'visitors', t0: 0.74, t1: 2.34, rows: 12, depth: 0.78, rise: 0.4, kind: 'bleacher', occ: 0.17, aisle: 16, school: 0.08, standing: 0.04, cluster: 1.2 },
  { id: 'end', t0: -0.52, t1: 0.58, rows: 20, depth: 0.8, rise: 0.4, kind: 'grand', occ: 0.4, aisle: 11, school: 0.7, standing: 0.2, cluster: 0.8 },
  { id: 'near', t0: 2.7, t1: 3.58, rows: 8, depth: 0.8, rise: 0.4, kind: 'bleacher', occ: 0.1, aisle: 18, school: 0.3, standing: 0.03, cluster: 1.4 },
];

function paintConcrete(N, noise) {
  return paintPixels(N, N, (x, y, o) => {
    const n = noise.fbm((x / N) * 12, (y / N) * 12, 4);
    const p = noise.n2(x * 0.9, y * 0.9);
    const v = 70 + n * 36 + p * 14;
    // faint stain streaks running down the risers
    const streak = noise.n2(x * 0.18, y * 0.02) > 0.72 ? 10 : 0;
    o[0] = v - streak * 0.5;
    o[1] = v - streak * 0.5;
    o[2] = v * 0.96 - streak * 0.5;
  }).c;
}

function paintAluminium(N) {
  const { c, g } = paintPixels(N, N, (x, y, o) => {
    const rib = Math.abs(((y / N) * 5) % 1 - 0.5) * 2; // 5 raised ribs across the plank
    const v = 150 + rib * 20 - 12 + Math.random() * 12;
    o[0] = v * 0.97;
    o[1] = v;
    o[2] = v * 1.04;
  });
  g.fillStyle = 'rgba(25,28,32,0.5)';
  g.fillRect(0, 0, N, 3); // seam between planks
  return c;
}

function paintBackWall(W, H, seed) {
  const r = mulberry32(seed);
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = '#23262c';
  g.fillRect(0, 0, W, H);
  // pilasters and a concourse band of openings, each lit differently (some dark, some warm, a few cool)
  const bays = 4;
  const bw = W / bays;
  for (let i = 0; i < bays; i++) {
    g.fillStyle = '#2d3138';
    g.fillRect(i * bw, 0, bw * 0.12, H);
    const lit = r();
    const x0 = i * bw + bw * 0.2;
    const w = bw * 0.62;
    const y0 = H * 0.3;
    const h = H * 0.46;
    const gr = g.createLinearGradient(0, y0, 0, y0 + h);
    if (lit < 0.62) {
      gr.addColorStop(0, '#f0b45a');
      gr.addColorStop(1, '#a8651f');
    } else if (lit < 0.82) {
      gr.addColorStop(0, '#9fb4c8');
      gr.addColorStop(1, '#4b6178');
    } else {
      gr.addColorStop(0, '#15181d');
      gr.addColorStop(1, '#0c0e11');
    }
    g.fillStyle = gr;
    g.fillRect(x0, y0, w, h);
    g.fillStyle = '#1b1e23';
    for (let k = 1; k < 3; k++) g.fillRect(x0 + (w * k) / 3 - 1.5, y0, 3, h);
    g.fillRect(x0, y0 + h * 0.5 - 1.5, w, 3);
  }
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, W, H * 0.12);
  return c;
}

function paintPressBox(W, H) {
  const r = mulberry32(13);
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = '#14171c';
  g.fillRect(0, 0, W, H);
  const bays = 16;
  const bw = W / bays;
  for (let i = 0; i < bays; i++) {
    const gr = g.createLinearGradient(0, H * 0.18, 0, H * 0.86);
    gr.addColorStop(0, '#ffd89a');
    gr.addColorStop(1, '#c98a3c');
    g.fillStyle = gr;
    g.fillRect(i * bw + 3, H * 0.18, bw - 6, H * 0.66);
    // people at desks, monitors
    if (r() < 0.8) {
      g.fillStyle = 'rgba(30,24,20,0.85)';
      g.beginPath();
      g.arc(i * bw + bw * (0.3 + r() * 0.4), H * 0.52, H * 0.075, 0, 7);
      g.fill();
      g.fillRect(i * bw + bw * 0.22, H * 0.58, bw * 0.5, H * 0.3);
    }
    if (r() < 0.55) {
      g.fillStyle = '#7fb4e8';
      g.fillRect(i * bw + bw * 0.55, H * 0.62, bw * 0.28, H * 0.12);
    }
  }
  g.fillStyle = '#0e1013';
  g.fillRect(0, H * 0.82, W, H * 0.18);
  g.fillRect(0, 0, W, H * 0.14);
  return c;
}

function paintBanners(S, cols = 4, rows = 4) {
  const cw = S(256);
  const ch = S(64);
  const { c, g } = makeCanvas(cw * cols, ch * rows);
  const items = [
    ['KESTREL STATE', 'TRACK & FIELD', '#e8700a', '#121316'],
    ['KESTREL STATE', 'ATHLETICS', '#15171b', '#f08a1c'],
    ['GO KESTRELS', '', '#f08a1c', '#15171b'],
    ['CONFERENCE', 'CHAMPIONSHIPS', '#1c2a4a', '#e9e4d4'],
    ['HALVERSON COLLEGE', 'FALCONS', '#12365e', '#e8b92f'],
    ['MARLOWE UNIVERSITY', '', '#6a1822', '#efe9dd'],
    ['CEDAR RIDGE', 'COLLEGE', '#1b4a30', '#efe9dd'],
    ['NORTH VALLEY', 'ATHLETICS', '#e9e4d4', '#1c2a4a'],
    ['FRIENDS OF', 'TRACK & FIELD', '#15171b', '#e9e4d4'],
    ['ALUMNI', 'ASSOCIATION', '#e8700a', '#fff4e4'],
    ['STUDENT-ATHLETE', 'ADVISORY BOARD', '#2c3036', '#e9e4d4'],
    ['FIGHT ON, STATE', '', '#121316', '#e8700a'],
    ['KESTREL STATE', 'UNIVERSITY', '#f4efe2', '#c4570a'],
    ['TRAINING STAFF', '& SPORTS MEDICINE', '#1d5a7a', '#f1f4f4'],
    ['BOOSTER CLUB', 'EST. 1974', '#3a2a1c', '#f0c46a'],
    ['TRACK & FIELD', 'OPEN MEET', '#c4570a', '#15171b'],
  ];
  items.forEach(([a, b, bg, fg], i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    g.fillStyle = bg;
    g.fillRect(x, y, cw, ch);
    g.fillStyle = fg;
    g.fillRect(x, y + ch * 0.06, cw, ch * 0.05);
    g.fillRect(x, y + ch * 0.89, cw, ch * 0.05);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fit = (txt, px) => {
      let s = px;
      do {
        g.font = font(s);
        s -= 2;
      } while (g.measureText(txt).width > cw * 0.9 && s > 10);
    };
    if (b) {
      fit(a, ch * 0.4);
      g.fillText(a, x + cw / 2, y + ch * 0.35);
      fit(b, ch * 0.3);
      g.fillText(b, x + cw / 2, y + ch * 0.7);
    } else {
      fit(a, ch * 0.55);
      g.fillText(a, x + cw / 2, y + ch * 0.52);
    }
  });
  return { c, cols, rows };
}

function paintScoreboard(W, H) {
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8700a';
  g.fillRect(0, 0, W, H * 0.2);
  g.fillStyle = '#05070a';
  g.font = font(H * 0.15);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText("MEN'S DISCUS THROW  FLIGHT 2", W * 0.03, H * 0.105);
  g.textAlign = 'right';
  g.fillText('FINAL', W * 0.97, H * 0.105);
  const rows = [
    ['1', 'T. BRANNOCK', 'HALVERSON', '61.88'],
    ['2', 'D. OKONKWO', 'KESTREL ST', '60.42'],
    ['3', 'M. VESTERGAARD', 'MARLOWE', '59.77'],
    ['4', 'J. ALDERETE', 'CEDAR RIDGE', '57.10'],
    ['5', 'R. PETROV', 'KESTREL ST', '55.96'],
  ];
  g.font = font(H * 0.115);
  rows.forEach((r, i) => {
    const y = H * (0.31 + i * 0.135);
    g.fillStyle = i === 1 || i === 4 ? '#ffb347' : '#e6e9ea';
    g.textAlign = 'left';
    g.fillText(r[0], W * 0.04, y);
    g.fillText(r[1], W * 0.09, y);
    g.fillStyle = '#9fb3c4';
    g.fillText(r[2], W * 0.47, y);
    g.fillStyle = i === 1 || i === 4 ? '#ffb347' : '#e6e9ea';
    g.textAlign = 'right';
    g.fillText(r[3], W * 0.96, y);
  });
  // LED matrix: a dark grid over everything keeps it a screen, not a poster
  g.fillStyle = 'rgba(0,0,0,0.38)';
  const px = Math.max(3, Math.round(W / 170));
  for (let x = 0; x < W; x += px) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += px) g.fillRect(0, y, W, 1);
  return c;
}

function paintFascia(W, H, text, sub, bg = '#15171b', fg = '#f08a1c') {
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let s = H * 0.62;
  do {
    g.font = font(s);
    s -= 3;
  } while (g.measureText(text).width > W * 0.9 && s > 8);
  g.fillText(text, W / 2, H * (sub ? 0.4 : 0.52));
  if (sub) {
    g.font = font(H * 0.22);
    g.fillStyle = '#e9e4d4';
    g.fillText(sub, W / 2, H * 0.8);
  }
  return c;
}

function paintChain(N) {
  const { c, g } = makeCanvas(N, N);
  g.strokeStyle = 'rgba(168,176,184,0.95)';
  g.lineWidth = Math.max(2, N / 40);
  const k = 4;
  for (let i = -k; i <= k * 2; i++) {
    g.beginPath();
    g.moveTo((i * N) / k, 0);
    g.lineTo((i * N) / k + N, N);
    g.moveTo((i * N) / k + N, 0);
    g.lineTo((i * N) / k, N);
    g.stroke();
  }
  return c;
}

export function buildStands(ctx) {
  const { root, tier, S, keep, noise, macroTex, detailTex, onFrame } = ctx;
  const rnd = mulberry32(2718);
  const mk = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    root.add(m);
    return m;
  };

  // --- materials -------------------------------------------------------------------------------------------------
  const concreteTex = toTexture(paintConcrete(S(256), makeNoise(5, 16)), { wrap: true, aniso: 4 });
  const concreteMat = keep(patchGround(new THREE.MeshLambertMaterial({ map: concreteTex }), { detail: detailTex, detailScale: 0.8, macro: macroTex, macroScale: 1 / 40, macroAmt: 0.28, detailAmt: 0.12 }));
  const alumTex = toTexture(paintAluminium(S(256)), { wrap: true, aniso: 8 });
  const alumMat = keep(new THREE.MeshStandardMaterial({ map: alumTex, roughness: 0.42, metalness: 0.28 }));
  const benchMat = keep(new THREE.MeshStandardMaterial({ map: alumTex, color: 0xbec6cc, roughness: 0.4, metalness: 0.3 }));
  const darkMat = keep(new THREE.MeshLambertMaterial({ color: 0x1a1d22 }));
  const railMat = keep(new THREE.MeshStandardMaterial({ color: 0x8a949c, roughness: 0.45, metalness: 0.35 }));
  const roofMat = keep(new THREE.MeshLambertMaterial({ color: 0x30343b }));

  const tread = (sec) => (sec.kind === 'grand' ? concreteMat : alumMat);

  // --- terraces, benches, aisles, back structures, per section ---------------------------------------------------
  const benchGB = new GeoBuilder();
  const railGB = new GeoBuilder();
  const seats = []; // crowd placements
  const gaps = [];
  const rowY = (sec, k) => 0.55 + sec.rise * (k + 1);
  const post = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
  post.translate(0, 0.5, 0);
  const steelC = new THREE.Color(0x858f98);

  for (const sec of SECTIONS) {
    const { rows, depth: d, rise: rs, t0, t1 } = sec;
    const oMid = O_START + (rows * d) / 2;
    const arcMid = ringArc(oMid, 360);
    const s0 = arcMid.lenAt(t0);
    const s1 = arcMid.lenAt(t1);
    const len = s1 - s0;
    const segs = Math.max(8, Math.ceil(len / 3.2));

    // terrace: riser/tread staircase, closed down to the ground at the back
    const prof = [[O_START, 0]];
    for (let k = 0; k < rows; k++) {
      const y = rowY(sec, k);
      prof.push([O_START + k * d, y], [O_START + (k + 1) * d, y]);
    }
    const oBack = O_START + rows * d;
    const yTop = rowY(sec, rows - 1);
    prof.push([oBack, 0]);
    const terrace = sweepRing(prof, { t0, t1, segs, uTile: 2, vTile: sec.kind === 'grand' ? 2 : 1.2, arcOff: oMid });
    mk(terrace, tread(sec), `terrace-${sec.id}`);
    sec.oBack = oBack;
    sec.yTop = yTop;

    // aisles: radial stair gaps at fixed t
    const nA = Math.max(2, Math.round(len / sec.aisle));
    const aisleT = [];
    for (let i = 0; i < nA; i++) {
      const sA = s0 + (len * (i + 0.5 + (rnd() - 0.5) * 0.25)) / nA;
      aisleT.push([arcMid.tAt(sA - 0.7), arcMid.tAt(sA + 0.7)]);
    }
    // benches between aisles (one sweep per interval, all rows)
    const edges = [t0, ...aisleT.flat(), t1];
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i];
      const b = edges[i + 1];
      if (b - a < 0.002) continue;
      const bp = [];
      for (let k = 0; k < rows; k++) {
        const y = rowY(sec, k);
        const o = O_START + k * d + d * 0.5;
        bp.push([o, y], [o, y + 0.41], [o + 0.3, y + 0.41], null);
      }
      const bg = sweepRing(bp, { t0: a, t1: b, segs: Math.max(2, Math.ceil(((b - a) / (t1 - t0)) * segs)), uTile: 1.2, vTile: 1, arcOff: oMid });
      benchGB.add(bg);
      bg.dispose();
    }
    // handrails on both sides of every aisle: posts every 2nd row + a sloped rail
    for (const [ta, tb] of aisleT) {
      for (const t of [ta, tb]) {
        const p = new THREE.Vector3();
        const q = new THREE.Vector3();
        for (let k = 0; k < rows; k += 2) {
          ringPoint(t, O_START + k * d + d * 0.5, p);
          railGB.add(post, mat4(p.x, rowY(sec, k), p.z, 0, 1, 0.95, 1), steelC);
        }
        ringPoint(t, O_START + d * 0.5, p);
        ringPoint(t, O_START + (rows - 0.5) * d, q);
        const a = new THREE.Vector3(p.x, rowY(sec, 0) + 0.95, p.z);
        const b = new THREE.Vector3(q.x, rowY(sec, rows - 1) + 0.95, q.z);
        const g = new THREE.CylinderGeometry(0.02, 0.02, a.distanceTo(b), 6);
        const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
        m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        m.setPosition(a.clone().add(b).multiplyScalar(0.5));
        railGB.add(g, m, steelC);
        g.dispose();
      }
    }
    // side caps of the staircase so the ends are not hollow
    for (const [t, flip] of [[t0, false], [t1, true]]) {
      const sh = new THREE.Shape();
      sh.moveTo(O_START, 0);
      prof.slice(1, -1).forEach(([o, y]) => sh.lineTo(o, y));
      sh.lineTo(oBack, rowY(sec, rows - 1));
      sh.lineTo(oBack, 0);
      const sg = new THREE.ShapeGeometry(sh);
      const p = sg.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        ringPoint(t, p.getX(i), v);
        p.setXYZ(i, v.x, p.getY(i), v.z);
      }
      sg.computeVertexNormals();
      void flip;
      const cm = keep(sec.kind === 'grand' ? new THREE.MeshLambertMaterial({ color: 0x25282e, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ color: 0x3a4046, side: THREE.DoubleSide }));
      mk(sg, cm, 'cap');
    }

    // seats -> crowd placements (one pass per row on that row's own arc so spacing stays even)
    const fld = makeNoise(sec.id.charCodeAt(0) * 17, 64);
    const pressT = sec.id === 'home' ? [-1.78, -1.43] : null;
    for (let k = 0; k < rows; k++) {
      const oc = O_START + k * d + d * 0.5 + 0.15;
      const arc = ringArc(oc, 360);
      const ra = arc.lenAt(t0);
      const rb = arc.lenAt(t1);
      const y = rowY(sec, k) + 0.41;
      const rf = k / rows;
      for (let s = ra + 0.5; s < rb - 0.5; s += 0.5 + rnd() * 0.07) {
        const t = arc.tAt(s);
        if (aisleT.some(([a, b]) => t > a - 0.003 && t < b + 0.003)) continue;
        if (pressT && k >= rows - 5 && t > pressT[0] && t < pressT[1]) continue; // behind the press box
        // friends sit in clumps: low-frequency noise gates occupancy; front rows fill first
        const g = fld.fbm(t * 26 * sec.cluster, k * 0.55 + 3, 3);
        const base = sec.occ * (0.25 + 1.5 * smooth(0.28, 0.7, g)) * (1.15 - 0.45 * rf);
        if (rnd() > base) continue;
        seats.push({ t, off: oc + (rnd() - 0.5) * 0.12, y, sec, k, rf, sp: rnd() });
      }
    }
  }
  mk(benchGB.build({ colors: false }), benchMat, 'benches');
  mk(railGB.build(), railMat, 'aisle-rails');

  // --- home: back wall, roof, fascia, columns, press box ---------------------------------------------------------
  {
    const sec = SECTIONS[0];
    const oMid = O_START + (sec.rows * sec.depth) / 2;
    const arcMid = ringArc(oMid, 360);
    const lenH = arcMid.lenAt(sec.t1) - arcMid.lenAt(sec.t0);
    const yRoof = sec.yTop + 3.4;
    const wallTex = toTexture(paintBackWall(S(512), S(256), 3), { wrap: true });
    const wallMat = keep(new THREE.MeshLambertMaterial({ map: wallTex, emissiveMap: wallTex, emissive: 0xffffff, emissiveIntensity: 0.55 }));
    mk(
      sweepRing(
        [[sec.oBack, sec.yTop - 0.1], [sec.oBack, yRoof]],
        { t0: sec.t0, t1: sec.t1, segs: 60, uTile: 12, vTile: yRoof - sec.yTop + 0.1, arcOff: oMid },
      ),
      wallMat,
      'home-back-wall',
    );
    // cantilever roof slab: underside (lit warm by fixtures), front edge, top
    const roofFront = sec.oBack - 14;
    const y0 = yRoof - 0.3;
    mk(
      sweepRing(
        [[roofFront, y0 - 0.35], [sec.oBack + 3, y0 + 0.2], [sec.oBack + 3, y0 + 0.6], [roofFront, y0 + 0.3], [roofFront, y0 - 0.35]].reverse(),
        { t0: sec.t0, t1: sec.t1, segs: 60, uTile: 6, vTile: 6, arcOff: oMid },
      ),
      roofMat,
      'home-roof',
    );
    // underside: emissive strip lights (instanced boxes)
    const lampG = new THREE.BoxGeometry(0.9, 0.06, 0.25);
    const nL = Math.floor(lenH / 3.2);
    const lamps = new THREE.InstancedMesh(lampG, keep(new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false })), nL * 3);
    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    let li = 0;
    for (let i = 0; i < nL; i++) {
      const t = arcMid.tAt(arcMid.lenAt(sec.t0) + (i + 0.5) * (lenH / nL));
      ringNormal(t, 0, n);
      const yaw = Math.atan2(n.x, n.z) + Math.PI / 2;
      for (let r = 0; r < 3; r++) {
        ringPoint(t, roofFront + 3 + r * 3.6, p);
        m4.compose(new THREE.Vector3(p.x, y0 - 0.38, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
        lamps.setMatrixAt(li++, m4);
      }
    }
    lamps.count = li;
    lamps.frustumCulled = false;
    root.add(lamps);
    // roof edge fascia with the school name
    const fas = toTexture(paintFascia(S(1024), S(96), 'KESTREL STATE UNIVERSITY  -  ATHLETICS', '', '#101216', '#f08a1c'), { aniso: 8 });
    const fm = keep(new THREE.MeshBasicMaterial({ map: fas, toneMapped: false, color: 0xcccccc }));
    const tMid = (sec.t0 + sec.t1) / 2;
    const sM = arcMid.lenAt(tMid);
    mk(
      sweepRing([[roofFront - 0.02, y0 - 0.35], [roofFront - 0.02, y0 + 0.3]].reverse().reverse(), {
        t0: arcMid.tAt(sM - 15),
        t1: arcMid.tAt(sM + 15),
        segs: 20,
        uTile: 30,
        vTile: 0.65,
        arcOff: oMid,
      }),
      fm,
      'home-fascia',
    );
    // press box: glazed box under the roof, in front of the back wall, with a lit window band
    {
      const pbTex = toTexture(paintPressBox(S(1024), S(128)), { aniso: 8 });
      const pbMat = keep(new THREE.MeshBasicMaterial({ map: pbTex, toneMapped: false, color: 0xe0d6c8 }));
      const [pa, pb] = [-1.78, -1.43];
      const oF = sec.oBack - 3.4;
      const yb = sec.yTop - 3.7;
      // body (dark), then the window band on its front
      mk(
        sweepRing([[oF, yb], [oF, yb + 3.1], [oF + 3.2, yb + 3.1]], { t0: pa, t1: pb, segs: 10, uTile: 8, vTile: 3, arcOff: oMid }),
        darkMat,
        'pressbox-body',
      );
      const sa = arcMid.lenAt(pa);
      const sb = arcMid.lenAt(pb);
      void sa;
      void sb;
      mk(
        sweepRing([[oF - 0.03, yb + 0.15], [oF - 0.03, yb + 2.95]], { t0: pa, t1: pb, segs: 10, uTile: arcMid.lenAt(pb) - arcMid.lenAt(pa), vTile: 2.8, arcOff: oMid }),
        pbMat,
        'pressbox-glass',
      );
      mk(
        sweepRing([[oF - 0.2, yb + 0.1], [oF - 0.2, yb + 0.5]], { t0: pa, t1: pb, segs: 10, uTile: 4, vTile: 1, arcOff: oMid }),
        darkMat,
        'pressbox-sill',
      );
    }
  }

  // --- end: back facade + sign + scoreboard ---------------------------------------------------------------------
  {
    const sec = SECTIONS[2];
    const oMid = O_START + (sec.rows * sec.depth) / 2;
    const arcMid = ringArc(oMid, 360);
    const yB = sec.yTop + 4.2;
    const wallTex = toTexture(paintBackWall(S(512), S(256), 11), { wrap: true });
    const wallMat = keep(new THREE.MeshLambertMaterial({ map: wallTex, emissiveMap: wallTex, emissive: 0xffffff, emissiveIntensity: 0.5 }));
    mk(
      sweepRing([[sec.oBack, sec.yTop - 0.1], [sec.oBack, yB], [sec.oBack + 1.2, yB], [sec.oBack + 1.2, yB + 0.4]], {
        t0: sec.t0,
        t1: sec.t1,
        segs: 40,
        uTile: 10,
        vTile: yB - sec.yTop + 0.1,
        arcOff: oMid,
      }),
      wallMat,
      'end-facade',
    );
    // illuminated sign on the facade
    const sg = toTexture(paintFascia(S(1024), S(160), 'KESTREL STATE', 'TRACK & FIELD', '#14161a', '#f08a1c'), { aniso: 8 });
    const tm = 0.1;
    const sm = arcMid.lenAt(tm);
    mk(
      sweepRing([[sec.oBack - 0.04, yB - 3.0], [sec.oBack - 0.04, yB - 0.4]], { t0: arcMid.tAt(sm - 8), t1: arcMid.tAt(sm + 8), segs: 12, uTile: 16, vTile: 2.6, arcOff: oMid }),
      keep(new THREE.MeshBasicMaterial({ map: sg, toneMapped: false, color: 0xd8d0c4 })),
      'end-sign',
    );
    // scoreboard: lattice legs + housing + LED face, perched on the facade
    const sbT = 0.34;
    const p = ringPoint(sbT, sec.oBack + 0.6, new THREE.Vector3());
    const nrm = ringNormal(sbT, 0, new THREE.Vector3());
    const yaw = Math.atan2(-nrm.x, -nrm.z); // faces the circle
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = yaw;
    const sbW = 15.4;
    const sbH = 5.8;
    const baseY = yB + 0.2;
    const dm = keep(new THREE.MeshStandardMaterial({ color: 0x1b1f25, roughness: 0.6, metalness: 0.3 }));
    const housing = new THREE.Mesh(new THREE.BoxGeometry(sbW + 0.6, sbH + 0.6, 0.9), dm);
    housing.position.set(0, baseY + 3.8 + sbH / 2, -0.5);
    g.add(housing);
    const faceTex = toTexture(paintScoreboard(S(512), S(192)), { aniso: 8 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(sbW, sbH), keep(new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false, color: 0xe0e0e0 })));
    face.position.set(0, baseY + 3.8 + sbH / 2, 0.0);
    g.add(face);
    for (const x of [-5.4, 5.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, baseY + 4, 0.5), dm);
      leg.position.set(x, (baseY + 4) / 2 - 1.0, -0.55);
      g.add(leg);
    }
    // visor over the top and a pair of small floods, as on real boards
    const visor = new THREE.Mesh(new THREE.BoxGeometry(sbW + 0.8, 0.12, 1.1), dm);
    visor.position.set(0, baseY + 3.8 + sbH + 0.65, -0.2);
    g.add(visor);
    root.add(g);
    ctx.scoreboard = { group: g, tex: faceTex };
  }

  // --- banner wall + rails + fence ------------------------------------------------------------------------------
  {
    const arc = ringArc(O_WALL, 720);
    const wall = sweepRing([[O_WALL, 0], [O_WALL, 1.1], [O_WALL + 0.25, 1.1], [O_WALL + 0.25, 0]], { segs: 220, uTile: 4, vTile: 4, arcOff: O_WALL });
    mk(wall, keep(patchGround(new THREE.MeshLambertMaterial({ map: concreteTex, color: 0x9aa0a6 }), { detail: detailTex, macro: macroTex, macroScale: 1 / 40, macroAmt: 0.2, detailAmt: 0.1 })), 'wall');
    const bn = paintBanners(S);
    const bannerTex = toTexture(bn.c, { aniso: 8 });
    const bannerMat = keep(new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.78, metalness: 0 }));
    const bg = new GeoBuilder();
    const bw = 3.6;
    const cnt = Math.floor(arc.total / bw);
    const order = [];
    for (let i = 0; i < cnt; i++) {
      // the home side gets more KESTREL STATE panels; no two neighbours repeat
      let cell;
      do cell = Math.floor(rnd() * 16);
      while (cell === order[i - 1] || cell === order[i - 2]);
      order.push(cell);
    }
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    for (let i = 0; i < cnt; i++) {
      const s0 = (i / cnt) * arc.total;
      const s1 = ((i + 1) / cnt) * arc.total - 0.06;
      ringPoint(arc.tAt(s0), O_WALL - 0.015, p0);
      ringPoint(arc.tAt(s1), O_WALL - 0.015, p1);
      const cx = (order[i] % bn.cols) / bn.cols;
      const cy = 1 - (Math.floor(order[i] / bn.cols) + 1) / bn.rows;
      const y0 = 0.1 + rnd() * 0.02;
      const y1 = 1.04;
      // slight sag in the middle of every banner, hung from top eyelets
      const mid = p0.clone().lerp(p1, 0.5);
      const nm = ringNormal(arc.tAt((s0 + s1) / 2), 0, new THREE.Vector3()).multiplyScalar(-0.012);
      const m = mid.add(nm);
      const A0 = new THREE.Vector3(p0.x, y0, p0.z);
      const A1 = new THREE.Vector3(m.x, y0, m.z);
      const A2 = new THREE.Vector3(p1.x, y0, p1.z);
      const B0 = new THREE.Vector3(p0.x, y1, p0.z);
      const B1 = new THREE.Vector3(m.x, y1 - 0.02, m.z);
      const B2 = new THREE.Vector3(p1.x, y1, p1.z);
      const u0 = cx;
      const u1 = cx + 0.5 / bn.cols;
      const u2 = cx + 1 / bn.cols;
      const v0 = cy;
      const v1 = cy + 1 / bn.rows;
      // quads are wound so the normal faces the infield; the ring runs clockwise from above
      bg.quad(A0, A1, B1, B0, [u0, v0, u1, v0, u1, v1, u0, v1]);
      bg.quad(A1, A2, B2, B1, [u1, v0, u2, v0, u2, v1, u1, v1]);
    }
    mk(bg.build({ colors: false }), bannerMat, 'banners');
    // top rail + posts (guard rail above the wall)
    const rail = sweepRing([[O_WALL + 0.05, 1.1], [O_WALL + 0.05, 1.18], [O_WALL + 0.09, 1.18]], { segs: 220, uTile: 4, vTile: 1, arcOff: O_WALL });
    mk(rail, railMat, 'wall-rail');
    const postG = new THREE.BoxGeometry(0.04, 0.9, 0.04);
    postG.translate(0, 0.45, 0);
    const nP = Math.floor(arc.total / 2.4);
    const posts = new THREE.InstancedMesh(postG, keep(railMat.clone()), nP); // own material: sharing one with plain meshes flips the program every frame
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < nP; i++) {
      ringPoint(arc.tAt((i / nP) * arc.total), O_WALL + 0.07, p0);
      m4.makeTranslation(p0.x, 1.1, p0.z);
      posts.setMatrixAt(i, m4);
    }
    posts.frustumCulled = false;
    root.add(posts);

    // chain-link fence across the gaps between stands (alpha-to-coverage: reads as mesh, not as a card)
    const chainTex = toTexture(paintChain(S(128)), { wrap: true, aniso: 8 });
    const chainMat = keep(new THREE.MeshStandardMaterial({ map: chainTex, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide, alphaToCoverage: true, alphaTest: 0.02 }));
    const spans = [];
    const sorted = SECTIONS.map((s) => [s.t0, s.t1]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i][1];
      let b = i + 1 < sorted.length ? sorted[i + 1][0] : sorted[0][0] + Math.PI * 2;
      spans.push([a, b]);
    }
    for (const [a, b] of spans) {
      if (b - a < 0.01) continue;
      const g = sweepRing([[O_WALL + 0.8, 0.0], [O_WALL + 0.8, 2.6]], { t0: a, t1: b, segs: Math.max(3, Math.round((b - a) * 40)), uTile: 1.4, vTile: 1.4, arcOff: O_WALL });
      mk(g, chainMat, 'fence');
      gaps.push([a, b]);
    }
  }

  // --- crowd ---------------------------------------------------------------------------------------------------
  const crowd = buildCrowd(seats, tier, onFrame);
  root.add(crowd.mesh);
  return { crowd, gaps, sections: SECTIONS };
}

// ---------------------------------------------------------------------------------------------------------------
const CLOTH = [
  [0x16181c, 5], [0x2a2e35, 5], [0x1f2b45, 3.5], [0x3d4450, 3], [0x5b6470, 2], [0x2f3f2a, 1.6], [0x4a2f2a, 1.6], [0x6a7f98, 2.4],
  [0x8a7a62, 1.6], [0xd8d3c6, 2.2], [0x7a1f2b, 1.2], [0x24506b, 1.2],
];
const HOME_C = [0xe8700a, 0xf08a1c, 0xf2ede0, 0x1a1c20, 0xd35a05];
const AWAY_C = [0x1c3f78, 0xe3b32a, 0xe9e4d4, 0x7a1b27];

function pickWeighted(list, r) {
  let tot = 0;
  for (const [, w] of list) tot += w;
  let x = r * tot;
  for (const [c, w] of list) {
    x -= w;
    if (x <= 0) return c;
  }
  return list[0][0];
}

export function buildCrowd(seats, tier, onFrame) {
  const r = mulberry32(31337);
  // shuffle so truncating `count` thins the whole crowd evenly (quality tier)
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  const n = seats.length;
  const quad = new THREE.PlaneGeometry(0.78, 1.12);
  quad.translate(0, 0.56, 0);
  const geo = new THREE.InstancedBufferGeometry().copy(quad);
  const misc = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(geo, null, n);
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const p = new THREE.Vector3();
  const home = new THREE.Vector3();
  seats.forEach((s, i) => {
    ringPoint(s.t, s.off, p);
    // face the throwing circle, with a little individual head-turn
    const yaw = Math.atan2(-p.x, -p.z - 0.0) + (r() - 0.5) * 0.5;
    q.setFromAxisAngle(UP, yaw);
    const standing = r() < s.sec.standing;
    const child = !standing && r() < 0.04;
    const sc = standing ? 1.38 + r() * 0.12 : child ? 0.72 : 0.92 + r() * 0.16;
    const y = s.y - (standing ? 0.3 : 0.2);
    m4.compose(home.set(p.x, y, p.z), q, new THREE.Vector3(sc, sc, sc));
    mesh.setMatrixAt(i, m4);
    // clothing colour: school colours in the home sections, rival colours in the visitor stand, civvies otherwise
    const rr = r();
    let c;
    const pal = s.sec.pal || (s.sec.id === 'visitors' ? AWAY_C : HOME_C);
    if (rr < s.sec.school) c = pal[Math.floor(r() * pal.length)];
    else c = pickWeighted(CLOTH, r());
    col.setHex(c);
    const v = 0.78 + r() * 0.4;
    col.multiplyScalar(v);
    mesh.setColorAt(i, col);
    // aMisc: x phase, y skin, z hair/hat style, w baked light (front rows + near the floods brighter, high rows dimmer)
    const lit = clamp(0.5 + 0.55 * (1 - s.rf * (s.sec.id === 'home' ? 0.7 : 0.4)) + (r() - 0.5) * 0.2, 0.3, 1.1);
    misc[i * 4] = r();
    misc[i * 4 + 1] = r();
    misc[i * 4 + 2] = r() + (standing ? 2 : 0) + (child ? 4 : 0);
    misc[i * 4 + 3] = lit;
  });
  geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uExcite: { value: 0.3 }, uCalm: { value: 1 }, uBright: { value: 1 }, uDim: { value: 1 }, uFlash: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } }]);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime; uniform float uExcite; uniform float uCalm;
      attribute vec4 aMisc;
      varying vec2 vUv; varying vec3 vCol; varying vec4 vM; varying float vSc;
      void main(){
        vUv = uv; vCol = instanceColor; vM = aMisc;
        vec3 p = position;
        float ph = aMisc.x * 40.0;
        float st = step(2.0, aMisc.z) * (1.0 - step(4.0, aMisc.z));
        // idle: slow breathing + a slight sway, standing fans shift weight and cheer with the excitement level
        p.x += sin(uTime * 0.9 + ph) * 0.012 * uCalm;
        p.y += (0.5 + 0.5 * sin(uTime * 1.7 + ph * 1.3)) * 0.012 * uCalm;
        float hop = max(0.0, sin(uTime * (2.2 + aMisc.x * 2.0) + ph));
        p.y += hop * hop * (0.02 + 0.22 * uExcite) * (0.35 + 0.65 * st) * uCalm;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        vSc = length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform float uExcite; uniform float uBright; uniform float uDim; uniform float uFlash; uniform vec3 uTint;
      varying vec2 vUv; varying vec3 vCol; varying vec4 vM; varying float vSc;
      float sdEll(vec2 p, vec2 r){ return (length(p / r) - 1.0) * min(r.x, r.y); }
      float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
      void main(){
        vec2 p = vec2((vUv.x - 0.5) * 0.78, vUv.y * 1.12);
        bool standing = vM.z >= 2.0 && vM.z < 4.0;
        bool child = vM.z >= 4.0;
        float hairSel = fract(vM.z);
        // body, head, optional raised arm
        float body = sdRound(p - vec2(0.0, 0.36), vec2(0.27, 0.3), 0.12);
        vec2 hc = vec2(0.0, 0.8);
        float head = sdEll(p - hc, vec2(0.1, 0.115));
        float neck = sdRound(p - vec2(0.0, 0.66), vec2(0.045, 0.06), 0.02);
        float arm = 1e3;
        float cheer = step(0.55, fract(vM.x * 3.3)) * uExcite * (standing ? 1.0 : 0.35);
        if (cheer > 0.15) {
          float side = vM.x > 0.5 ? 1.0 : -1.0;
          vec2 a = p - vec2(side * 0.27, 0.78);
          arm = sdRound(a - vec2(side * 0.02, 0.12), vec2(0.045, 0.19), 0.04);
        }
        float d = min(min(body, head), min(neck, arm));
        float aa = fwidth(d) * 1.2 + 1e-4;
        float alpha = 1.0 - smoothstep(-aa, aa, d);
        if (alpha < 0.02) discard;
        // skin tone palette, hair/hat
        float sk = vM.y;
        vec3 skin = sk < 0.18 ? vec3(0.96,0.78,0.64) : sk < 0.42 ? vec3(0.83,0.6,0.45) : sk < 0.62 ? vec3(0.66,0.45,0.32) : sk < 0.82 ? vec3(0.45,0.3,0.21) : vec3(0.3,0.19,0.14);
        vec3 hair = hairSel < 0.3 ? vec3(0.06,0.05,0.045) : hairSel < 0.55 ? vec3(0.2,0.12,0.07) : hairSel < 0.75 ? vec3(0.45,0.3,0.14) : hairSel < 0.9 ? vec3(0.62,0.62,0.6) : vec3(0.7,0.5,0.2);
        float isHead = (head < 0.0 || arm < 0.0) ? 1.0 : 0.0;
        vec3 c = vCol;
        // lit side vs shade: top-down floodlight + a darker lower torso (lap, shadow of the row above)
        float shade = 0.55 + 0.45 * smoothstep(0.05, 0.62, p.y);
        c *= shade;
        if (neck < 0.0 && body > 0.0) c = skin * 0.8;
        if (head < 0.0) {
          c = skin * (0.65 + 0.35 * smoothstep(0.62, 0.92, p.y));
          float cap = smoothstep(0.0, -0.012, p.y - 0.84 - hairSel * 0.02 + 0.0) ;
          // hair on the upper part of the head; some wear a cap in their body colour
          float top = smoothstep(0.805, 0.84, p.y);
          bool hat = fract(vM.z * 7.3) > 0.72;
          c = mix(c, hat ? vCol * 0.85 : hair, top * (hat ? 0.95 : 0.9));
          c = mix(c, hair, smoothstep(0.1, 0.0, p.x * (hat ? 8.0 : 1.0)) * 0.0);
        }
        if (arm < 0.0 && head > 0.0 && body > 0.0) c = mix(vCol * shade, skin * 0.8, step(0.9, p.y));
        // baked light level + a darker rim at the card's lower edge hides the cutout look
        c *= vM.w * 1.08;
        // occasional phone / camera flash
        float f = fract(sin(vM.x * 913.0 + floor(uTime * 5.0 + vM.x * 7.0) * 37.1) * 43758.5);
        float flash = step(0.9985 - 0.012 * uFlash, f);
        c += flash * vec3(1.0, 0.96, 0.88) * 1.4 * smoothstep(0.2, 0.0, length(p - vec2(0.05, 0.62)));
        // phone screens: a few faces lit from below
        float phone = step(0.93, fract(vM.x * 19.7)) * step(vM.w, 0.9);
        c += phone * vec3(0.55, 0.62, 0.75) * smoothstep(0.1, 0.0, length(p - vec2(0.0, 0.62))) * 0.5;
        c *= uBright * uTint;
        // floods dimmed (walk-out): the stands go dark but the phone screens and flashes do not
        c = c * uDim + flash * vec3(1.0, 0.96, 0.88) * 1.4 * smoothstep(0.2, 0.0, length(p - vec2(0.05, 0.62))) * (1.0 - uDim) + phone * vec3(0.55, 0.62, 0.75) * smoothstep(0.1, 0.0, length(p - vec2(0.0, 0.62))) * 0.5 * (1.0 - uDim);
        gl_FragColor = vec4(c, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mesh.material = mat;
  const total = n;
  return {
    mesh,
    mat,
    total,
    setDensity(f) {
      mesh.count = Math.max(0, Math.floor(total * clamp(f, 0, 1)));
    },
  };
}
