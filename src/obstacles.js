// The absurd cast: pigeon flock, coach's golf cart, hot-dog vendor, sprinkler, jumbotron.
// Motion is a pure function of "obstacle time" tO so a recorded throw can be replayed exactly.
import * as THREE from 'three';
import { weatherOf, windFor, gustFor, densityOf } from './weather.js';
import { mulberry32 } from './physics.js';
import { toThree } from './scene.js';
import { CardBatch } from './cards.js';
import { buildBlobShadow } from './actors.js';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
const tri = (u) => 1 - 4 * Math.abs((((u % 1) + 1) % 1) - 0.5); // triangle wave -1..1 (u=0 -> -1)
const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function makeLayout(seed, weather = 'clear') {
  const r = mulberry32(seed * 7919 + 13);
  // the draw order is fixed, so a Clear Night layout is exactly the original one for every seed
  const w1 = r();
  const w2 = r();
  const wx = weatherOf(weather);
  const layout = {
    seed,
    weather: wx.id,
    wind: windFor(wx, w1, w2),
    flockPhase: r() * 20,
    cartX: 31 + r() * 22,
    cartPhase: r(),
    vendorPhase: r(),
    sprinklerX: 46 + r() * 14,
    sprinklerZ: -6 + r() * 12,
  };
  layout.gust = gustFor(wx, r);
  layout.rho = densityOf(wx);
  layout.temp = wx.temp;
  return layout;
}

function label(text, w = 256, h = 128, bg = '#ffffff', fg = '#c0151f') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(4, 4, w - 8, h - 8);
  g.fillStyle = fg;
  g.font = '700 58px Oswald, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  text.split('\n').forEach((t, i, a) => g.fillText(t, w / 2, h / 2 + (i - (a.length - 1) / 2) * 56));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildObstacles(scene, fx) {
  const root = new THREE.Group();
  scene.add(root);
  const disposables = [];
  let L = makeLayout(1);
  const P = { x: 0, y: 0, z: 0 };
  let cam = null;
  const camRight = new THREE.Vector3();
  const wings = ['flapUp', 'flapMid', 'flapDown', 'flapMid'];

  // ---------------------------------------------------------------- PIGEONS
  const flock = (() => {
    const g = new THREE.Group();
    root.add(g);
    const N = 16;
    // Pigeon: grey-blue body, paler breast, small head with an orange eye, iridescent green/magenta neck patch,
    // a dark-tipped leaf-shaped wing on a hinge (these are what flap), and a fan tail. Faces -Z.
    const bodyGeo = new THREE.SphereGeometry(0.2, 14, 10);
    const breastGeo = new THREE.SphereGeometry(0.15, 12, 8);
    const headGeo = new THREE.SphereGeometry(0.075, 12, 8);
    const eyeGeo = new THREE.SphereGeometry(0.016, 6, 6);
    const beakGeo = new THREE.ConeGeometry(0.02, 0.07, 6);
    const neckGeo = new THREE.SphereGeometry(0.1, 14, 10);
    {
      // iridescent neck patch: teal-green on top fading to magenta-violet underneath, via vertex colours
      const pos = neckGeo.attributes.position;
      const cols = [];
      const top = new THREE.Color(0x19d6a0);
      const bot = new THREE.Color(0xc43bd0);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        c.copy(top).lerp(bot, Math.min(1, Math.max(0, (0.1 - pos.getY(i)) / 0.2 + (pos.getX(i) / 0.1) * 0.15)));
        cols.push(c.r, c.g, c.b);
      }
      neckGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    }
    const wingGeo = (() => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.14);
      sh.bezierCurveTo(0.14, 0.3, 0.42, 0.24, 0.58, 0.02);
      sh.bezierCurveTo(0.42, -0.1, 0.26, -0.3, 0, -0.26);
      sh.closePath();
      const geo = new THREE.ShapeGeometry(sh, 10);
      geo.rotateX(-Math.PI / 2); // lay flat: shape +y becomes forward (-Z)
      const pos = geo.attributes.position;
      const cols = [];
      const root = new THREE.Color(0x7684a6);
      const tip = new THREE.Color(0x2c3347);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        c.copy(root).lerp(tip, Math.min(1, Math.max(0, (pos.getX(i) - 0.12) / 0.45)));
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      return geo;
    })();
    const tailGeo = (() => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.05, 0);
      sh.lineTo(0.05, 0);
      sh.lineTo(0.13, 0.3);
      sh.lineTo(-0.13, 0.3);
      sh.closePath();
      const geo = new THREE.ShapeGeometry(sh);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0, 0.0); // rotate: shape +y -> -z, so flip to trail behind (+z)
      geo.scale(1, 1, -1);
      return geo;
    })();
    disposables.push(bodyGeo, breastGeo, headGeo, eyeGeo, beakGeo, neckGeo, wingGeo, tailGeo);
    const bodyMat = M(0x65759a, { roughness: 0.85 });
    const breastMat = M(0x8795b3, { roughness: 0.85 });
    const headMat = M(0x7584a5, { roughness: 0.85 });
    const neckMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.28, emissive: 0x0b2a2a });
    const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x4a5368, roughness: 0.8, side: THREE.DoubleSide });
    const beakMat = M(0xd8c3a3);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a });
    disposables.push(bodyMat, breastMat, headMat, neckMat, wingMat, tailMat, beakMat, eyeMat);
    const rnd = mulberry32(777);
    const birds = [];
    for (let i = 0; i < N; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.scale.set(0.85, 0.78, 1.55);
      const breast = new THREE.Mesh(breastGeo, breastMat);
      breast.scale.set(0.9, 0.9, 1.0);
      breast.position.set(0, -0.02, -0.17);
      const neck = new THREE.Mesh(neckGeo, neckMat);
      neck.scale.set(1, 0.85, 0.95);
      neck.position.set(0, 0.1, -0.25);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 0.16, -0.31);
      const beak = new THREE.Mesh(beakGeo, beakMat);
      beak.rotation.x = -Math.PI / 2;
      beak.position.set(0, 0.15, -0.385);
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.position.set(0, 0.0, 0.28);
      tail.rotation.x = 0.1;
      b.add(body, breast, neck, head, beak, tail);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(s * 0.055, 0.175, -0.335);
        b.add(eye);
      }
      const wl = new THREE.Group();
      const wr = new THREE.Group();
      const wlm = new THREE.Mesh(wingGeo, wingMat);
      wlm.scale.x = -1; // mirrored (left) wing
      const wrm = new THREE.Mesh(wingGeo, wingMat);
      wl.add(wlm);
      wr.add(wrm);
      wl.position.set(-0.1, 0.1, -0.05);
      wr.position.set(0.1, 0.1, -0.05);
      b.add(wl, wr);
      b.scale.setScalar(1.9);
      g.add(b);
      birds.push({
        g: b,
        wl,
        wr,
        a0: rnd() * 6.28,
        w: 0.8 + rnd() * 0.9,
        r: 0.4 + rnd() * 0.6,
        flee: [(rnd() - 0.5) * 16, 4 + rnd() * 7, (rnd() - 0.5) * 16],
        pos: [0, 0, 0],
      });
    }
    const center = (t) => [
      25 + 3.5 * Math.sin(0.42 * t + L.flockPhase),
      11 + 1.6 * Math.sin(0.61 * t + L.flockPhase * 2),
      7.5 * Math.sin(0.31 * t + L.flockPhase * 1.7),
    ];
    const birdPos = (b, t) => {
      const c = center(t);
      const a = b.a0 + b.w * t;
      return [c[0] + Math.cos(a) * 3.2 * b.r, c[1] + Math.sin(a * 1.3) * 1.5, c[2] + Math.sin(a) * 3.2 * b.r];
    };
    // Real pigeon art: one card per bird plus the feather burst. The primitives above only show if the art fails to load.
    const cards = new CardBatch('kit-b', N + 1, { full: true });
    cards.mesh.name = 'pigeon-cards';
    root.add(cards.mesh);
    disposables.push(cards);
    cards.ready.then((ok) => {
      if (ok) g.visible = false;
    });
    const drawBird = (b, i, t, q) => {
      const hx = q.x - (b.lx ?? q.x);
      const hz = q.z - (b.lz ?? q.z);
      if (Math.abs(hx) + Math.abs(hz) > 1e-4) {
        const l = Math.hypot(hx, hz);
        b.hx = hx / l;
        b.hz = hz / l;
      }
      b.lx = q.x;
      b.lz = q.z;
      if (!cam) return;
      if (i === o.hitIdx && o.hitAt !== null && t >= o.hitAt) {
        cards.set(i, 'flapDown', q.x, q.y, q.z, { span: 1.5, anchor: 0.5, rot: (t - o.hitAt) * 9 });
        return;
      }
      const dx = cam.position.x - q.x;
      const dz = cam.position.z - q.z;
      const l = Math.hypot(dx, dz) || 1;
      const along = ((b.hx || 0) * dx + (b.hz || 0) * dz) / l;
      const beat = Math.sin(t * 16 + i);
      if (along > 0.72) cards.set(i, 'birdFront', q.x, q.y, q.z, { span: 1.9, anchor: 0.5, squash: 0.8 + 0.2 * beat });
      else if (along < -0.72) cards.set(i, 'birdBelow', q.x, q.y, q.z, { span: 1.9, anchor: 0.5, squash: 0.85 + 0.15 * beat });
      else {
        camRight.setFromMatrixColumn(cam.matrixWorld, 0);
        const frame = (t * 0.7 + i * 0.37) % 3 < 0.5 ? 'glide' : wings[Math.floor(t * 10 + i * 1.7) & 3];
        cards.set(i, frame, q.x, q.y, q.z, { span: 1.5, anchor: 0.5, flip: (b.hx || 0) * camRight.x + (b.hz || 0) * camRight.z < 0 });
      }
    };
    const o = {
      key: 'pigeon',
      hitAt: null,
      hitIdx: -1,
      meta: { label: 'PIGEON STRIKE', mult: 1.5, speedMul: 0.9, kick: 1.5 },
      update(t, dt) {
        birds.forEach((b, i) => {
          let p = birdPos(b, t);
          let yaw;
          if (this.hitAt !== null && t >= this.hitAt) {
            const d = t - this.hitAt;
            const p0 = birdPos(b, this.hitAt);
            if (i === this.hitIdx) {
              p = [p0[0] + 2 * d, Math.max(0.35, p0[1] - 4.9 * d * d + 1.5 * d), p0[2] + 0.5 * d];
              b.g.rotation.set(d * 9, d * 6, d * 11);
              b.wl.rotation.z = -0.3;
              b.wr.rotation.z = 0.3;
              toThree(p[0], p[1], p[2], b.g.position);
              b.pos = p;
              drawBird(b, i, t, b.g.position);
              return;
            }
            p = [p0[0] + b.flee[0] * d, p0[1] + b.flee[1] * d - 1.2 * d * d, p0[2] + b.flee[2] * d];
            yaw = Math.atan2(-b.flee[2], b.flee[0]); // phys velocity (fx, fz) -> three (fz, -fx)
          } else {
            const p1 = birdPos(b, t + 0.1);
            yaw = Math.atan2(-(p1[2] - p[2]), p1[0] - p[0]);
          }
          b.g.rotation.set(0, yaw, 0);
          b.pos = p;
          toThree(p[0], p[1], p[2], b.g.position);
          // flap: both wing tips rise and fall together (right +z lifts, left -z lifts), body bobs against the beat
          const f = Math.sin(t * 22 + i) * 0.85 + 0.15;
          b.wl.rotation.z = -f;
          b.wr.rotation.z = f;
          b.g.position.y += Math.cos(t * 22 + i) * 0.05;
          drawBird(b, i, t, b.g.position);
        });
        const d = this.hitAt === null ? -1 : t - this.hitAt;
        if (d >= 0 && d < 1.6) cards.set(N, 'feathers', this.bx, this.by, this.bz, { span: 1.6 + d * 3, anchor: 0.5, rot: d * 0.6, alpha: 1 - d / 1.6 });
        else cards.hide(N);
      },
      test(x, y, z) {
        for (let i = 0; i < birds.length; i++) {
          const q = birds[i].pos;
          if ((q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < 1.1 * 1.1) {
            this.hitIdx = i;
            return true;
          }
        }
        return false;
      },
      onHit(t, x, y, z) {
        this.hitAt = t;
        const q = toThree(x, y, z);
        this.bx = q.x;
        this.by = q.y;
        this.bz = q.z;
        fx.particles.burst([q.x, q.y, q.z], { count: 40, speed: 7, color: [0.9, 0.95, 1], size: 0.4, life: 1.6, gravity: 2, drag: 1.2 });
        fx.debris.spawn('feather', [q.x, q.y, q.z], 0xf4f8ff, 5, 14, 1.8);
      },
      reset() {
        this.hitAt = null;
        this.hitIdx = -1;
      },
      group: g,
    };
    return o;
  })();

  // ---------------------------------------------------------------- GOLF CART
  const cart = (() => {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(1.3);
    g.add(inner);
    root.add(g);
    const white = M(0xf2f4f8, { emissive: 0x15171c });
    const orange = M(0xff8a1f, { emissive: 0x401a00 });
    const dark = M(0x15171e);
    const add = (geo, mat, x, y, z, p = inner) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      p.add(m);
      disposables.push(geo);
      return m;
    };
    add(new THREE.BoxGeometry(1.15, 0.38, 2.2), white, 0, 0.5, 0);
    add(new THREE.BoxGeometry(1.17, 0.1, 2.0), orange, 0, 0.55, 0);
    add(new THREE.BoxGeometry(1.0, 0.25, 0.7), white, 0, 0.62, -0.95);
    add(new THREE.BoxGeometry(0.95, 0.14, 0.5), dark, 0, 0.78, 0.5);
    for (const [x, z] of [
      [-0.55, -0.45],
      [0.55, -0.45],
      [-0.55, 0.95],
      [0.55, 0.95],
    ])
      add(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), dark, x, 1.25, z);
    add(new THREE.BoxGeometry(1.35, 0.06, 2.0), orange, 0, 2.0, 0.25);
    for (const [x, z] of [
      [-0.62, -0.7],
      [0.62, -0.7],
      [-0.62, 0.8],
      [0.62, 0.8],
    ]) {
      const w = add(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 14), dark, x, 0.26, z);
      w.rotation.z = Math.PI / 2;
    }
    // coach at the wheel
    const skin = M(0xb97a52);
    add(new THREE.SphereGeometry(0.15, 10, 8), skin, 0, 1.32, -0.05);
    add(new THREE.CylinderGeometry(0.16, 0.17, 0.09, 12), M(0x2f6bff), 0, 1.47, -0.05);
    add(new THREE.CapsuleGeometry(0.17, 0.3, 3, 8), M(0x2f6bff), 0, 0.98, 0.0);
    add(new THREE.BoxGeometry(0.46, 0.12, 0.08), M(0xff3e3e), 0, 1.0, -0.2); // clipboard
    // headlights, antenna pennant, cap brim and a face so the coach reads as a person, not a cylinder
    for (const x of [-0.38, 0.38]) add(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1b0 }), x, 0.62, -1.12);
    add(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 5), dark, 0.6, 1.2, 0.9);
    add(new THREE.BoxGeometry(0.3, 0.16, 0.02), M(0xff3e3e), 0.75, 1.82, 0.9);
    add(new THREE.BoxGeometry(0.2, 0.025, 0.14), M(0x2f6bff), 0, 1.44, -0.2);
    for (const x of [-0.05, 0.05]) add(new THREE.SphereGeometry(0.018, 6, 6), dark, x, 1.34, -0.19);
    add(new THREE.BoxGeometry(0.1, 0.014, 0.02), dark, 0, 1.27, -0.19);
    const o = {
      key: 'cart',
      hitAt: null,
      meta: { label: "COACH'S CART", mult: 2.5, speedMul: 0.5, kick: 6 },
      posAt(t) {
        const u = t * 5.5 / 88 + L.cartPhase;
        return [L.cartX, 0, 22 * tri(u)];
      },
      update(t) {
        let p = this.posAt(t);
        const p1 = this.posAt(t + 0.1);
        let yaw = p1[2] > p[2] ? -Math.PI / 2 : Math.PI / 2;
        let hop = 0;
        let spin = 0;
        if (this.hitAt !== null && t >= this.hitAt) {
          const d = t - this.hitAt;
          p = this.posAt(this.hitAt);
          spin = 10 * (1 - Math.exp(-d * 1.4));
          hop = Math.max(0, Math.sin(d * 9)) * 0.5 * Math.exp(-d * 1.2);
          if (d > 6) {
            // coach recovers and drives off again
            p = this.posAt(t);
            spin = 0;
          }
        }
        toThree(p[0], p[1] + hop, p[2], g.position);
        g.rotation.y = yaw + spin;
        this.cur = p;
      },
      test(x, y, z) {
        const c = this.cur;
        if (!c) return false;
        const hit = Math.abs(x - c[0]) < 1.3 && Math.abs(z - c[2]) < 1.9 && y < 2.9;
        return hit;
      },
      onHit(t, x, y, z) {
        this.hitAt = t;
        const q = toThree(x, y, z);
        fx.particles.burst([q.x, q.y + 0.5, q.z], { count: 36, speed: 6, color: [1, 0.7, 0.2], size: 0.4, life: 1, gravity: 9 });
        fx.debris.spawn('shard', [q.x, q.y + 0.5, q.z], 0xffffff, 6, 6, 0.8);
      },
      reset() {
        this.hitAt = null;
      },
      group: g,
    };
    return o;
  })();

  // ---------------------------------------------------------------- VENDOR
  const vendor = (() => {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(1.08);
    inner.position.z = 1.45; // walks behind the cart, pushing it
    g.add(inner);
    root.add(g);
    const skin = M(0xc98a5e);
    const add = (geo, mat, x, y, z, p = inner) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      p.add(m);
      disposables.push(geo);
      return m;
    };
    add(new THREE.CapsuleGeometry(0.09, 0.6, 3, 8), M(0x20252f), -0.13, 0.45, 0);
    add(new THREE.CapsuleGeometry(0.09, 0.6, 3, 8), M(0x20252f), 0.13, 0.45, 0);
    const torso = add(new THREE.CapsuleGeometry(0.2, 0.44, 4, 10), M(0xe53a3a, { emissive: 0x300808 }), 0, 1.15, 0);
    torso.scale.set(1.2, 1, 0.8);
    add(new THREE.SphereGeometry(0.12, 12, 8), skin, 0, 1.65, 0);
    add(new THREE.CylinderGeometry(0.1, 0.13, 0.2, 10), M(0xf4f8ff, { emissive: 0x303030 }), 0, 1.86, 0);
    for (const x of [-0.27, 0.27]) {
      const arm = add(new THREE.CapsuleGeometry(0.05, 0.5, 3, 6), skin, x, 1.08, -0.28);
      arm.rotation.x = 1.15;
    }
    add(new THREE.BoxGeometry(0.36, 0.5, 0.03), M(0xf4f8ff), 0, 1.02, -0.215); // apron
    add(new THREE.BoxGeometry(0.36, 0.06, 0.035), M(0xffd23f), 0, 1.1, -0.22); // mustard stripe
    for (const x of [-0.05, 0.05]) add(new THREE.SphereGeometry(0.016, 6, 6), M(0x10131c), x, 1.67, -0.115);
    add(new THREE.BoxGeometry(0.09, 0.014, 0.02), M(0x10131c), 0, 1.6, -0.115);
    // The real cart: three views, a wrecked state, and hot dogs thrown clear on impact.
    const DOGS = ['dog1', 'sausage', 'dog2', 'dog3', 'sausage', 'dog4', 'dog1', 'sausage'];
    const cart = new CardBatch('hotdog-a', 1 + DOGS.length);
    cart.mesh.name = 'cart-cards';
    root.add(cart.mesh);
    disposables.push(cart);
    const cartShadow = buildBlobShadow();
    cartShadow.scale.set(3.6, 2.2, 1);
    root.add(cartShadow);
    const drawCart = (t, q, walk, hitAt) => {
      const px = g.position.x;
      const pz = g.position.z;
      cartShadow.position.x = px;
      cartShadow.position.z = pz;
      if (!cam) return;
      if (hitAt !== null && t >= hitAt) {
        const d = t - hitAt;
        cart.set(0, 'cartWreck', px, 0, pz, { h: 2.7 });
        DOGS.forEach((name, i) => {
          const a = i * 0.785 + 0.4;
          const sp = 2.2 + (i % 3) * 1.1;
          const y = Math.max(0.12, 1.1 + (5.5 + (i % 4)) * d - 4.9 * d * d);
          const k = y > 0.12 ? d : (5.5 + (i % 4) + Math.sqrt((5.5 + (i % 4)) ** 2 + 19.6 * 0.98)) / 9.8;
          cart.set(1 + i, name, px + Math.cos(a) * sp * k, y, pz + Math.sin(a) * sp * k, { span: name === 'sausage' ? 0.3 : 0.42, anchor: 0.5, rot: y > 0.12 ? d * (4 + i) : i });
        });
        return;
      }
      for (let i = 0; i < DOGS.length; i++) cart.hide(1 + i);
      const dx = cam.position.x - px;
      const dz = cam.position.z - pz;
      const along = Math.abs(dx) / (Math.hypot(dx, dz) || 1); // the cart rolls along three.js x
      camRight.setFromMatrixColumn(cam.matrixWorld, 0);
      const flip = walk * camRight.x < 0;
      if (along > 0.9) cart.set(0, 'cartFront', px, 0, pz, { h: 2.55 });
      else if (along > 0.5) cart.set(0, 'cartQuarter', px, 0, pz, { h: 2.55, flip });
      else cart.set(0, 'cartSide', px, 0, pz, { h: 2.55, flip });
    };
    const o = {
      key: 'vendor',
      hitAt: null,
      meta: { label: 'HOT DOG HAVOC', mult: 2, speedMul: 0.55, kick: 5 },
      posAt(t) {
        return [15.5, 0, 8 * tri((t * 1.6) / 32 + L.vendorPhase)];
      },
      update(t) {
        const p = this.posAt(t);
        const p1 = this.posAt(t + 0.1);
        let roll = 0;
        let q = p;
        if (this.hitAt !== null && t >= this.hitAt) {
          const d = t - this.hitAt;
          q = this.posAt(this.hitAt);
          roll = smooth(d / 0.35) * 1.5 - smooth((d - 3) / 0.6) * 1.5;
          q = [q[0] + 1.5 * smooth(d / 0.5), 0, q[2]];
        }
        toThree(q[0], q[1], q[2], g.position);
        g.rotation.set(0, p1[2] > p[2] ? -Math.PI / 2 : Math.PI / 2, 0);
        drawCart(t, q, p1[2] > p[2] ? 1 : -1, this.hitAt);
        inner.rotation.set(roll * 1.0, 0, 0);
        inner.position.y = roll * 0.0;
        this.cur = q;
        this.down = roll > 0.6;
      },
      test(x, y, z) {
        const c = this.cur;
        if (!c || this.down) return false;
        return (x - c[0]) ** 2 + (z - c[2]) ** 2 < 1.2 * 1.2 && y < 3.3;
      },
      onHit(t, x, y, z) {
        this.hitAt = t;
        const q = toThree(x, y, z);
        fx.particles.burst([q.x, q.y + 0.5, q.z], { count: 30, speed: 5, color: [1, 0.85, 0.1], size: 0.35, life: 1.2, gravity: 8 });
      },
      reset() {
        this.hitAt = null;
        this.down = false;
      },
      group: g,
    };
    return o;
  })();

  // ---------------------------------------------------------------- SPRINKLER
  const sprinkler = (() => {
    const g = new THREE.Group();
    root.add(g);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.18, 14), M(0x2a2f3a));
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10), M(0xe9e2d5, { metalness: 0.6, roughness: 0.3 }));
    riser.position.y = 0.4;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.1), M(0xff8a1f));
    head.position.y = 0.78;
    g.add(base, riser, head);
    disposables.push(base.geometry, riser.geometry, head.geometry);
    const o = {
      key: 'sprinkler',
      hitAt: null,
      meta: { label: 'SPRINKLER SURPRISE', mult: 1.25, speedMul: 1, kick: 0 },
      update(t, dt) {
        toThree(L.sprinklerX, 0, L.sprinklerZ, g.position);
        head.rotation.y = t * 4;
        const jets = this.hitAt !== null && t - this.hitAt < 2.5 ? 7 : 2;
        const a = t * 4;
        for (let i = 0; i < jets && dt > 0; i++) {
          const spd = this.hitAt !== null && t - this.hitAt < 2.5 ? 17 : 9;
          const aa = a + (i / jets) * 6.28 + Math.random() * 0.3;
          fx.particles.emit({
            p: [g.position.x, 0.85, g.position.z],
            v: [Math.cos(aa) * spd * 0.55, spd * (0.75 + Math.random() * 0.3), Math.sin(aa) * spd * 0.55],
            color: [0.45, 0.7, 1],
            size: 0.2,
            life: 1.3,
            gravity: 12,
            drag: 0.1,
          });
        }
        this.cur = [L.sprinklerX, 0, L.sprinklerZ];
      },
      test(x, y, z) {
        const c = this.cur;
        return !!c && y < 1.2 && (x - c[0]) ** 2 + (z - c[2]) ** 2 < 2.4 * 2.4;
      },
      onHit(t, x, y, z) {
        this.hitAt = t;
        const q = toThree(x, 0.5, z);
        fx.particles.burst([q.x, q.y, q.z], { count: 50, speed: 8, color: [0.6, 0.8, 1], size: 0.4, life: 1.2, gravity: 10, up: 6 });
      },
      reset() {
        this.hitAt = null;
      },
      group: g,
    };
    return o;
  })();

  // ---------------------------------------------------------------- JUMBOTRON
  const jumbo = (() => {
    const g = new THREE.Group();
    root.add(g);
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 288;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    disposables.push(tex);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(13.3, 7.5), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(14, 8.2, 0.8), M(0x0c0f18, { metalness: 0.6, roughness: 0.4 }));
    frame.position.z = -0.45;
    screen.position.y = 0;
    const board = new THREE.Group();
    board.add(frame, screen);
    board.position.y = 19.5;
    g.add(board);
    for (const x of [-7.4, 7.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 19, 0.5), M(0x151923, { metalness: 0.5 }));
      leg.position.set(x, 9.5, -0.45);
      g.add(leg);
      disposables.push(leg.geometry);
    }
    disposables.push(screen.geometry, frame.geometry);
    // jumbotron faces the thrower: +Z in three coords is toward the camera
    toThree(44, 0, 0, g.position);
    const frames = [
      ['LIVE: DISCUS DISASTER', '#ff8a1f', 'NOW THROWING: YOU'],
      ['KISS CAM', '#ff3e8a', 'AWKWARD COUSINS DETECTED'],
      ['WIND CHECK', '#35c27a', 'THE WIND IS DOING A THING'],
      ['DISC-OUNT TIRE', '#2f6bff', 'ROUND THINGS. FLAT PRICES.'],
    ];
    let last = -1;
    const draw = (t, broken) => {
      const idx = Math.floor(t / 2.4) % frames.length;
      const blink = broken ? Math.floor(t * 4) % 2 : 0;
      const key = broken ? 100 + blink : idx;
      if (key === last) return;
      last = key;
      ctx.fillStyle = broken ? '#05060a' : '#0a0d18';
      ctx.fillRect(0, 0, 512, 288);
      if (!broken) {
        const [title, c, sub] = frames[idx];
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 512, 70);
        ctx.fillStyle = '#05060a';
        ctx.font = '700 46px Oswald, Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(title, 256, 52);
        ctx.fillStyle = '#f4f8ff';
        ctx.font = '700 30px "JetBrains Mono", monospace';
        ctx.fillText(sub, 256, 190);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(256, 140, 22 + (idx % 2) * 6, 0, 7);
        ctx.fill();
      } else {
        ctx.fillStyle = blink ? '#ff3e3e' : '#6b1c1c';
        ctx.font = '700 64px Oswald, Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NO SIGNAL', 256, 130);
        ctx.font = '700 26px "JetBrains Mono", monospace';
        ctx.fillStyle = '#f4f8ff';
        ctx.fillText('COACH IS ON THE PHONE', 256, 190);
        ctx.strokeStyle = '#f4f8ff';
        ctx.lineWidth = 3;
        for (const [x0, y0, x1, y1] of [
          [330, 0, 280, 120],
          [280, 120, 340, 210],
          [340, 210, 300, 288],
          [280, 120, 200, 160],
          [200, 160, 150, 288],
        ]) {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
      tex.needsUpdate = true;
    };
    draw(0, false);
    const o = {
      key: 'jumbotron',
      hitAt: null,
      meta: { label: 'JUMBOTRON SHATTER', mult: 3, speedMul: 0.8, kick: 2 },
      update(t, dt) {
        const broken = this.hitAt !== null && t >= this.hitAt;
        draw(t, broken);
        if (broken && t - this.hitAt < 2.2 && dt > 0) {
          const w = g.position;
          fx.particles.emit({
            p: [w.x + (Math.random() - 0.5) * 11, 18 + Math.random() * 4, w.z + 0.6],
            v: [(Math.random() - 0.5) * 4, -3 - Math.random() * 3, 2 + Math.random() * 3],
            color: [1, 0.9, 0.5],
            size: 0.35,
            life: 0.9,
            gravity: 9,
          });
        }
      },
      test(x, y, z) {
        return this.hitAt === null && Math.abs(x - 44) < 0.8 && Math.abs(z) < 7 && y > 15.6 && y < 23.4;
      },
      onHit(t, x, y, z) {
        this.hitAt = t;
        const q = toThree(x, y, z);
        fx.particles.burst([q.x, q.y, q.z], { count: 90, speed: 14, color: [0.7, 0.85, 1], size: 0.5, life: 1.6, gravity: 7 });
        fx.debris.spawn('shard', [q.x, q.y, q.z], 0xaad4ff, 9, 12, 1.2);
      },
      reset() {
        this.hitAt = null;
        last = -1;
      },
      group: g,
    };
    return o;
  })();

  const list = [flock, cart, vendor, sprinkler, jumbo];
  return {
    root,
    list,
    layout: () => L,
    setLayout(l) {
      L = l;
      list.forEach((o) => o.reset());
    },
    setCamera(c) {
      cam = c;
    },
    update(t, dt) {
      list.forEach((o) => o.update(t, dt));
    },
    resetAll() {
      list.forEach((o) => o.reset());
    },
    dispose() {
      disposables.forEach((d) => d.dispose && d.dispose());
      root.traverse((o) => {
        if (o.material) {
          for (const k in o.material) if (o.material[k] && o.material[k].isTexture) o.material[k].dispose();
          o.material.dispose();
        }
      });
      root.removeFromParent();
    },
    P,
  };
}
