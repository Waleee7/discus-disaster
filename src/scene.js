// Procedural night stadium: sky, pitch, track, sector markings, ad boards, bowl, instanced crowd, floodlights.
// Physics frame -> three.js frame: (x, y, z) -> (z, y, -x), i.e. the throw heads down -Z.
import * as THREE from 'three';
import { CIRCLE_RADIUS, SECTOR_HALF_ANGLE, DEG } from './physics.js';

export const toThree = (x, y, z, out = new THREE.Vector3()) => out.set(z, y, -x);

export const ARENA = { cx: 36, a: 58, b: 40 }; // infield ellipse centre (physics x) and semi-axes (m)

const ellipse = (t, off = 0) => [ARENA.cx + (ARENA.a + off) * Math.cos(t), (ARENA.b + off) * Math.sin(t)];

function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** Loft a surface between two ellipse offsets (inner->outer) rising from y0 to y1. uRepeat/vRepeat set UV tiling. */
function loft(o0, y0, o1, y1, { segs = 200, uRepeat = 1, vRepeat = 1 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    for (const [o, y, v] of [
      [o0, y0, 0],
      [o1, y1, 1],
    ]) {
      const [px, pz] = ellipse(t, o);
      pos.push(pz, y, -px);
      uv.push((i / segs) * uRepeat, v * vRepeat);
    }
    if (i < segs) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const radialSprite = (inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') =>
  canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, inner);
    gr.addColorStop(0.25, 'rgba(255,230,190,0.55)');
    gr.addColorStop(1, outer);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });

export function buildStadium(scene, { reducedMotion = false } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const mats = [];
  const keep = (m) => (mats.push(m), m);

  scene.background = new THREE.Color(0x04060c);
  scene.fog = new THREE.FogExp2(0x070c1a, 0.0052);

  // --- sky dome + stars --------------------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(520, 32, 16),
    keep(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `varying vec3 vP; void main(){
          float h = normalize(vP).y;
          vec3 top = vec3(0.012,0.02,0.055);
          vec3 mid = vec3(0.045,0.07,0.15);
          vec3 hor = vec3(0.24,0.15,0.1);
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.22, h));
          c = mix(c, top, smoothstep(0.2, 0.85, h));
          gl_FragColor = vec4(c,1.0);}`,
      }),
    ),
  );
  root.add(sky);
  const starN = 700;
  const sp = new Float32Array(starN * 3);
  for (let i = 0; i < starN; i++) {
    const th = Math.random() * Math.PI * 2;
    const y = 0.12 + Math.random() * 0.88;
    const r = Math.sqrt(1 - y * y);
    sp.set([Math.cos(th) * r * 500, y * 500, Math.sin(th) * r * 500], i * 3);
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)),
    keep(new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })),
  );
  root.add(stars);

  // --- ground, infield, track --------------------------------------------------------------
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), keep(new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 1 })));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = -0.06;
  root.add(dirt);

  const grassTex = canvasTex(1024, 1024, (g, w, h) => {
    const n = 26;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? '#1c5a2a' : '#226a31';
      g.fillRect(0, (i * h) / n, w, h / n + 1);
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${10 + Math.random() * 30},${60 + Math.random() * 60},${20 + Math.random() * 20},0.18)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  const infield = new THREE.Mesh(new THREE.CircleGeometry(1, 96), keep(new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 })));
  infield.rotation.x = -Math.PI / 2;
  // after rotation.x(-90deg), local y -> world -z; ellipse scale: local x -> world x(three) = physics z (b), local y -> physics x (a)
  infield.scale.set(ARENA.b, ARENA.a, 1);
  infield.position.set(0, 0.005, -ARENA.cx);
  root.add(infield);

  // track ring
  const trackShape = new THREE.Shape();
  trackShape.absellipse(0, 0, ARENA.b + 9, ARENA.a + 9, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, ARENA.b, ARENA.a, 0, Math.PI * 2, true);
  trackShape.holes.push(hole);
  const track = new THREE.Mesh(new THREE.ShapeGeometry(trackShape, 96), keep(new THREE.MeshStandardMaterial({ color: 0x7a2f22, roughness: 0.85 })));
  track.rotation.x = -Math.PI / 2;
  track.position.set(0, 0.008, -ARENA.cx);
  root.add(track);
  const laneMat = keep(new THREE.LineBasicMaterial({ color: 0xe9e2d5, transparent: true, opacity: 0.55 }));
  for (let l = 1; l < 8; l++) {
    const off = (l * 9) / 8;
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * Math.PI * 2;
      const [px, pz] = ellipse(t, off);
      pts.push(new THREE.Vector3(pz, 0.02, -px));
    }
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), laneMat));
  }

  // --- circle, sector lines, distance arcs --------------------------------------------------
  const paint = keep(new THREE.MeshBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0.92, fog: true }));
  const circle = new THREE.Mesh(new THREE.CircleGeometry(CIRCLE_RADIUS, 48), keep(new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.9 })));
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.03;
  root.add(circle);
  const ring = new THREE.Mesh(new THREE.RingGeometry(CIRCLE_RADIUS, CIRCLE_RADIUS + 0.06, 64), paint);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  root.add(ring);
  for (const sgn of [-1, 1]) {
    const L = 105;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.14, L), paint);
    line.rotation.x = -Math.PI / 2;
    // physics heading psi -> three direction (sin psi, -cos psi)
    const psi = sgn * SECTOR_HALF_ANGLE * DEG;
    line.rotation.z = -psi; // after rotation.x the plane's long axis is -Z; rotate about world Y
    line.rotation.order = 'YXZ';
    line.rotation.set(-Math.PI / 2, -psi, 0);
    const dir = new THREE.Vector3(Math.sin(psi), 0, -Math.cos(psi));
    line.position.copy(dir.multiplyScalar(L / 2 + CIRCLE_RADIUS * 0.9)).setY(0.034);
    root.add(line);
  }
  for (let d = 10; d <= 90; d += 10) {
    const r = d + CIRCLE_RADIUS;
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.07, r + 0.07, 80, 1, Math.PI / 2 - SECTOR_HALF_ANGLE * DEG, 2 * SECTOR_HALF_ANGLE * DEG),
      paint,
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = 0.034;
    root.add(arc);
    const lab = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.2),
      keep(
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          map: canvasTex(256, 128, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            g.font = '700 96px Oswald, Impact, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillStyle = 'rgba(244,248,255,0.85)';
            g.fillText(String(d), w / 2, h / 2 + 4);
          }),
        }),
      ),
    );
    lab.rotation.x = -Math.PI / 2;
    lab.position.set(0, 0.036, -(r - 2.4));
    root.add(lab);
  }
  // 74.35 m record mark
  const wr = new THREE.Mesh(
    new THREE.RingGeometry(74.35 + CIRCLE_RADIUS - 0.14, 74.35 + CIRCLE_RADIUS + 0.14, 96, 1, Math.PI / 2 - SECTOR_HALF_ANGLE * DEG, 2 * SECTOR_HALF_ANGLE * DEG),
    keep(new THREE.MeshBasicMaterial({ color: 0xffb020 })),
  );
  wr.rotation.x = -Math.PI / 2;
  wr.position.y = 0.04;
  root.add(wr);
  const wrLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 3.2),
    keep(
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        map: canvasTex(512, 128, (g, w, h) => {
          g.font = '700 70px Oswald, Impact, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = '#ffb020';
          g.fillText('WR 74.35  ALEKNA 2024', w / 2, h / 2);
        }),
      }),
    ),
  );
  wrLabel.rotation.x = -Math.PI / 2;
  wrLabel.position.set(0, 0.042, -(74.35 + CIRCLE_RADIUS - 3));
  root.add(wrLabel);

  // --- discus cage ------------------------------------------------------------------------
  const netTex = canvasTex(
    128,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(190,210,200,0.85)';
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo((i * w) / 4, 0);
        g.lineTo((i * w) / 4, h);
        g.moveTo(0, (i * h) / 4);
        g.lineTo(w, (i * h) / 4);
        g.stroke();
      }
    },
    { repeat: [18, 3] },
  );
  // The net wraps the back and sides; a window is left open toward the broadcast camera so it never blocks the shot.
  const netMat = keep(new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
  const A0 = -Math.PI + 0.62; // cage edge (opening toward the sector is theta = PI)
  const A1 = Math.PI - 0.62;
  const W0 = -0.35; // camera window, theta in radians (z+ is behind the thrower)
  const W1 = 1.15;
  for (const [t0, t1] of [
    [A0, W0],
    [W1, A1],
  ]) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 4.2, 28, 1, true, t0, t1 - t0), netMat);
    seg.position.y = 2.1;
    root.add(seg);
  }
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0x20252f, metalness: 0.6, roughness: 0.4 }));
  for (const th of [A0, A1, -Math.PI / 2, Math.PI / 2, W0, W1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 4.3, 6), poleMat);
    p.position.set(3.6 * Math.sin(th), 2.15, 3.6 * Math.cos(th));
    root.add(p);
  }

  // --- bowl, crowd, boards, facade --------------------------------------------------------
  const seatTex = canvasTex(
    64,
    64,
    (g, w, h) => {
      g.fillStyle = '#12151f';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b2030';
      g.fillRect(0, h - 10, w, 10);
      g.fillStyle = 'rgba(255,140,40,0.06)';
      g.fillRect(0, 0, w, 6);
    },
    { repeat: [1, 1] },
  );
  const O0 = 12;
  const O1 = 50;
  const Y1 = 27;
  const bowl = new THREE.Mesh(
    loft(O0, 1.2, O1, Y1, { uRepeat: 90, vRepeat: 24 }),
    keep(new THREE.MeshStandardMaterial({ map: seatTex, roughness: 0.95, side: THREE.DoubleSide })),
  );
  root.add(bowl);
  const wall = new THREE.Mesh(
    loft(O1, Y1, O1 + 1, Y1 + 20, { uRepeat: 50, vRepeat: 4 }),
    keep(
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        map: canvasTex(
          64,
          64,
          (g, w, h) => {
            g.fillStyle = '#0a0d17';
            g.fillRect(0, 0, w, h);
            for (let i = 0; i < 6; i++) {
              g.fillStyle = Math.random() > 0.6 ? 'rgba(255,196,110,0.45)' : 'rgba(120,150,220,0.18)';
              g.fillRect(6 + (i % 3) * 20, 8 + Math.floor(i / 3) * 28, 12, 14);
            }
          },
          { repeat: [1, 1] },
        ),
      }),
    ),
  );
  root.add(wall);
  const facadeBack = new THREE.Mesh(
    loft(O1 + 1, Y1 + 20, O1 + 6, Y1 + 22, { uRepeat: 1, vRepeat: 1 }),
    keep(new THREE.MeshBasicMaterial({ color: 0x05070d, side: THREE.DoubleSide })),
  );
  root.add(facadeBack);

  // ad boards
  const ads = ['DISC-OUNT TIRE', 'GRIP & RIP CHALK', 'PIGEON INSURANCE', "COACH'S GOLF CARTS", 'SPIN CYCLE LAUNDRY', 'HOT DOGS $9', 'ALEKNA APPROVED*', 'NECK BRACE EMPORIUM'];
  const adTex = canvasTex(2048, 96, (g, w, h) => {
    const cell = w / ads.length;
    ads.forEach((t, i) => {
      g.fillStyle = i % 2 ? '#0c0f18' : '#ff8a1f';
      g.fillRect(i * cell, 0, cell, h);
      g.fillStyle = i % 2 ? '#ff8a1f' : '#0c0f18';
      let fs = 52;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      do {
        g.font = `700 ${fs}px Oswald, Impact, sans-serif`;
        fs -= 2;
      } while (g.measureText(t).width > cell - 28 && fs > 16);
      g.fillText(t, i * cell + cell / 2, h / 2 + 3);
    });
  });
  adTex.wrapS = THREE.RepeatWrapping;
  const adMat = keep(new THREE.MeshBasicMaterial({ map: adTex, side: THREE.DoubleSide, toneMapped: false }));
  const boards = new THREE.Mesh(loft(10.2, 0.0, 10.2, 1.4, { uRepeat: 12, vRepeat: 1 }), adMat);
  // equal offsets => a vertical band; uRepeat keeps each ad ~3.5 m wide (undistorted)
  root.add(boards);

  // crowd - instanced cards with a person silhouette shader
  const rows = 24;
  const crowdPositions = [];
  const perimeter = (off) => 2 * Math.PI * Math.sqrt(((ARENA.a + off) ** 2 + (ARENA.b + off) ** 2) / 2);
  for (let r = 0; r < rows; r++) {
    const u = (r + 0.5) / rows;
    const off = O0 + 1.2 + (O1 - O0 - 2) * u;
    const y = 1.2 + (Y1 - 1.2) * ((off - O0) / (O1 - O0)) + 0.55;
    const n = Math.floor(perimeter(off) / 0.78);
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2 + (r % 2) * (Math.PI / n);
      crowdPositions.push([t, off, y]);
    }
  }
  const count = crowdPositions.length;
  const quad = new THREE.PlaneGeometry(0.78, 1.15);
  quad.translate(0, 0.52, 0);
  const phase = new Float32Array(count);
  const crowdGeo = new THREE.InstancedBufferGeometry().copy(quad);
  const crowdMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uExcite: { value: 0.3 }, uFogColor: { value: new THREE.Color(0x070c1a) }, uFogDensity: { value: 0.0052 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uExcite;
      attribute float aPhase;
      varying vec2 vUv; varying vec3 vCol; varying float vPh; varying float vDepth;
      void main(){
        vUv = uv; vCol = instanceColor; vPh = aPhase;
        vec3 p = position;
        float hop = max(0.0, sin(uTime*(2.4+aPhase*2.2) + aPhase*60.0));
        p.y += hop * hop * (0.06 + 0.32*uExcite) * (0.6 + aPhase);
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uExcite; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec2 vUv; varying vec3 vCol; varying float vPh; varying float vDepth;
      float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p)-b+r; return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r; }
      void main(){
        vec2 p = vUv - vec2(0.5, 0.0);
        float head = length((p - vec2(0.0, 0.76)) * vec2(1.0, 0.82)) - 0.17;
        float body = sdRound(p - vec2(0.0, 0.3), vec2(0.34, 0.27), 0.14);
        float arm = 1.0;
        if (head > 0.0 && body > 0.0) discard;
        vec3 skin = mix(vec3(0.95,0.72,0.55), vec3(0.33,0.2,0.14), fract(vPh*7.31));
        vec3 c = head < 0.0 ? skin : vCol;
        // flood-lit gradient: higher rows catch a bit less light
        c *= 0.82 + 0.3*fract(vPh*13.7);
        // arms up when excited
        float armUp = step(0.55, fract(vPh*3.3)) * uExcite;
        float armL = length((p - vec2(-0.3, 0.62)) * vec2(2.4, 0.8)) - 0.16;
        float armR = length((p - vec2(0.3, 0.62)) * vec2(2.4, 0.8)) - 0.16;
        // camera flashes
        float f = fract(sin(vPh*913.0 + floor(uTime*7.0 + vPh*5.0)*37.1)*43758.5);
        float flash = step(0.9935, f);
        c = mix(c, vec3(1.0,0.97,0.9), flash * smoothstep(0.35, 0.0, length(p - vec2(0.0,0.6))) * 1.3);
        c += flash * vec3(1.0,0.95,0.85) * 0.5;
        float fogF = 1.0 - exp(-uFogDensity*uFogDensity*vDepth*vDepth);
        gl_FragColor = vec4(mix(c, uFogColor, fogF), 1.0);
      }`,
  });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, count);
  crowd.frustumCulled = false;
  const UP = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const palette = [0xff8a1f, 0xf4f8ff, 0x2f6bff, 0xe53a3a, 0x20252f, 0xffd23f, 0x35c27a, 0x9a8cff, 0x8892a6];
  crowdPositions.forEach(([t, off, y], i) => {
    const [px, pz] = ellipse(t, off);
    // card normal (+Z) must point at the pitch centre: three-space direction = (0 - pz, -cx + px)
    q.setFromAxisAngle(UP, Math.atan2(-pz, px - ARENA.cx));
    m4.compose(new THREE.Vector3(pz, y, -px), q, new THREE.Vector3(1, 1, 1));
    crowd.setMatrixAt(i, m4);
    col.setHex(palette[Math.floor(Math.random() * palette.length)]);
    // team colours dominate: bias to orange/white
    if (Math.random() < 0.35) col.setHex(Math.random() < 0.6 ? 0xff8a1f : 0xf4f8ff);
    crowd.setColorAt(i, col);
    phase[i] = Math.random();
  });
  crowdGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  crowd.instanceMatrix.needsUpdate = true;
  crowd.instanceColor.needsUpdate = true;
  root.add(crowd);

  // --- floodlights ------------------------------------------------------------------------
  const lampTex = canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = '#1b1f2a';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6; x++) {
        const gr = g.createRadialGradient(12 + x * 20, 14 + y * 22, 0, 12 + x * 20, 14 + y * 22, 11);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.5, '#fff1d6');
        gr.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = gr;
        g.fillRect(x * 20, y * 22 + 2, 24, 24);
      }
  });
  const glowTex = radialSprite();
  const lampMat = keep(new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false }));
  const glowMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd9a0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const beamGeo = new THREE.ConeGeometry(30, 105, 28, 1, true);
  beamGeo.translate(0, -52.5, 0);
  const beamMat = keep(new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  const towerAngles = [0.62, Math.PI - 0.62, Math.PI + 0.62, -0.62];
  const lights = [];
  towerAngles.forEach((t) => {
    const [px, pz] = ellipse(t, O1 + 4);
    const tower = new THREE.Group();
    tower.position.set(pz, 0, -px);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.4, 56, 8), poleMat);
    mast.position.y = 28;
    tower.add(mast);
    const top = new THREE.Vector3(tower.position.x, 58, tower.position.z);
    const aim = new THREE.Vector3(0, 12, -ARENA.cx).sub(top).normalize();
    const rack = new THREE.Group();
    rack.position.y = 58;
    rack.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), aim);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, 10.5), lampMat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(14.4, 10.9, 0.5), poleMat);
    back.position.z = -0.3;
    rack.add(panel, back);
    tower.add(rack);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(46, 46, 1);
    glow.position.set(0, 58, 0);
    tower.add(glow);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 58, 0);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-top.x, -58, -ARENA.cx - top.z).normalize());
    tower.add(beam);
    root.add(tower);
    const sl = new THREE.SpotLight(0xffe6c4, 3.1, 0, 0.78, 0.6, 0);
    sl.position.copy(top);
    sl.target.position.set(0, 0, -ARENA.cx * 0.85);
    root.add(sl, sl.target);
    lights.push(sl);
  });
  const hemi = new THREE.HemisphereLight(0x7f95d8, 0x241608, 0.55);
  root.add(hemi);
  // warm rim near the circle so the athlete reads in the follow cam
  const key = new THREE.PointLight(0xffb066, 40, 40, 1.6);
  key.position.set(-3, 7, 4);
  root.add(key);

  // --- wind sock --------------------------------------------------------------------------
  const sock = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 8), poleMat);
  pole.position.y = 2.5;
  sock.add(pole);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 2.4, 12, 1, true),
    keep(new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x5a2000, side: THREE.DoubleSide })),
  );
  cone.geometry.rotateX(Math.PI);
  cone.geometry.translate(0, -1.2, 0);
  const sockPivot = new THREE.Group();
  sockPivot.position.y = 5;
  sockPivot.add(cone);
  sock.add(sockPivot);
  sock.position.set(-7, 0, 7);
  root.add(sock);

  const state = { wind: { x: 0, z: 0 }, time: 0 };
  return {
    root,
    crowdMat,
    setWind(w) {
      state.wind = w;
    },
    setExcite(v) {
      crowdMat.uniforms.uExcite.value = v;
    },
    update(t) {
      state.time = t;
      crowdMat.uniforms.uTime.value = reducedMotion ? 0 : t;
      // sock points downwind (three coords: dx = physics z, dz = -physics x)
      const wx = state.wind.z;
      const wz = -state.wind.x;
      const sp = Math.hypot(wx, wz);
      // hang straight down in calm air, stream horizontally by ~4 m/s
      const k = Math.min(1, sp / 4.5);
      const flutter = Math.sin(t * 7 + 1) * 0.06 * k;
      const dir = new THREE.Vector3(sp > 1e-3 ? (wx / sp) * k : 0, -(1 - k) - 0.05 + flutter, sp > 1e-3 ? (wz / sp) * k : 0).normalize();
      sockPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    },
    dispose() {
      mats.forEach((m) => {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      });
      root.traverse((o) => o.geometry && o.geometry.dispose());
      crowdGeo.dispose();
      root.removeFromParent();
    },
  };
}
