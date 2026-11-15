// Particles (GPU points, additive) + physical debris pool (hot dogs, shards, feathers).
import * as THREE from 'three';
import { mulberry32 } from './physics.js';

const ZERO3 = [0, 0, 0];
const ONE3 = [1, 1, 1];

export class Particles {
  /** additive: glowing sparks / trail (default). additive:false = soft, alpha-blended puffs (dust, spray) that do not glow. */
  constructor(scene, max = 3500, { additive = true } = {}) {
    this.additive = additive;
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main(){
          vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 96.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          ${additive ? 'float a = smoothstep(0.5, 0.05, d) * vA;' : 'float a = smoothstep(0.5, 0.0, d); a = a * a * vA;'}
          if (a < 0.01) discard;
          gl_FragColor = ${additive ? 'vec4(vC * a, a)' : 'vec4(vC, a)'};
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.rand = mulberry32(1234);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
  }

  setViewport(heightPx, fovDeg) {
    this.uniforms.uScale.value = (heightPx * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  emit({ p, v = ZERO3, color = ONE3, size = 0.3, life = 1, gravity = 0, drag = 0 }) {
    this.spawn(p[0], p[1], p[2], v[0], v[1], v[2], color[0], color[1], color[2], size, life, gravity, drag);
  }

  /** Positional form of emit (no option object, no arrays): for emitters that run every frame. */
  spawn(px, py, pz, vx, vy, vz, r, g, b, size = 0.3, life = 1, gravity = 0, drag = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const k = i * 3;
    this.pos[k] = px;
    this.pos[k + 1] = py;
    this.pos[k + 2] = pz;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.col[k] = r;
    this.col[k + 1] = g;
    this.col[k + 2] = b;
    this.size0[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.age[i] = 0;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.alpha[i] = 1;
    this.live = true;
  }

  /** Radial burst. */
  burst(p, { count = 30, speed = 6, color = [1, 1, 1], size = 0.35, life = 1, gravity = 9.8, drag = 0.5, up = 0 }) {
    const r = this.rand;
    for (let k = 0; k < count; k++) {
      const th = r() * Math.PI * 2;
      const ph = Math.acos(2 * r() - 1);
      const s = speed * (0.3 + r() * 0.7);
      this.emit({
        p,
        v: [Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s + up, Math.sin(ph) * Math.sin(th) * s],
        color,
        size: size * (0.5 + r()),
        life: life * (0.6 + r() * 0.6),
        gravity,
        drag,
      });
    }
  }

  update(dt) {
    const { pos, vel, life, age, grav, drag, alpha, size, size0 } = this;
    if (!this.live && !this.dirty) {
      this.points.visible = false; // nothing alive: no upload, no draw call
      return;
    }
    let lo = this.max;
    let hi = -1;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      if (i < lo) lo = i;
      if (i > hi) hi = i;
      age[i] += dt;
      if (age[i] >= life[i]) {
        life[i] = 0;
        pos[i * 3 + 1] = -999;
        alpha[i] = 0;
        continue;
      }
      const k = 1 - drag[i] * dt;
      vel[i * 3] *= k;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt;
      vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.02 && grav[i] > 0) {
        pos[i * 3 + 1] = 0.02;
        vel[i * 3 + 1] *= -0.25;
      }
      const f = age[i] / life[i];
      alpha[i] = (1 - f) * (1 - f);
      size[i] = size0[i] * (1 - 0.4 * f);
    }
    // upload only the span that holds live (or just-expired) particles, not all 3500 every frame
    const A = this.geo.attributes;
    if (this.fullUpload) {
      // after clear(): the GPU copy still holds the old particles, so send the whole buffer once
      A.position.needsUpdate = A.aColor.needsUpdate = A.aSize.needsUpdate = A.aAlpha.needsUpdate = true;
      this.fullUpload = false;
    } else if (hi >= lo) {
      const n = hi - lo + 1;
      A.position.addUpdateRange(lo * 3, n * 3);
      A.aColor.addUpdateRange(lo * 3, n * 3);
      A.aSize.addUpdateRange(lo, n);
      A.aAlpha.addUpdateRange(lo, n);
      A.position.needsUpdate = A.aColor.needsUpdate = A.aSize.needsUpdate = A.aAlpha.needsUpdate = true;
    }
    this.points.visible = hi >= lo;
    this.live = hi >= lo;
    this.dirty = false;
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.max; i++) {
      this.pos[i * 3 + 1] = -999;
      this.alpha[i] = 0;
    }
    this.live = false;
    this.dirty = true;
    this.fullUpload = true;
    this.points.visible = false;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}

/** Little physical bits that tumble: hot dogs, shards, feathers. */
export class Debris {
  constructor(scene, n = 48) {
    this.items = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geos = {
      dog: new THREE.CapsuleGeometry(0.07, 0.3, 3, 6),
      bun: new THREE.CapsuleGeometry(0.1, 0.32, 3, 6),
      shard: new THREE.TetrahedronGeometry(0.25),
      feather: new THREE.PlaneGeometry(0.14, 0.4),
    };
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geos.dog, new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }));
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, age: 0, floor: 0.05 });
    }
    this.i = 0;
    this.rand = mulberry32(99);
  }

  spawn(kind, p, color, speed = 6, count = 1, scale = 1) {
    for (let k = 0; k < count; k++) {
      const it = this.items[this.i];
      this.i = (this.i + 1) % this.items.length;
      it.m.geometry = this.geos[kind];
      it.m.material.color.set(color);
      it.m.material.emissive.set(kind === 'shard' ? 0x224466 : 0x000000);
      it.m.scale.setScalar(scale);
      it.m.position.set(p[0], p[1], p[2]);
      const r = this.rand;
      it.v.set((r() - 0.5) * speed, 2 + r() * speed * 0.7, (r() - 0.5) * speed);
      it.w.set((r() - 0.5) * 14, (r() - 0.5) * 14, (r() - 0.5) * 14);
      it.life = it.age = 0;
      it.life = 3.5 + r() * 1.5;
      it.floor = kind === 'feather' ? 0.02 : 0.1;
      it.drag = kind === 'feather' ? 3 : 0.2;
      it.g = kind === 'feather' ? 1.6 : 9.8;
      it.m.visible = true;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.age += dt;
      if (it.age > it.life) {
        it.m.visible = false;
        continue;
      }
      it.v.y -= it.g * dt;
      it.v.multiplyScalar(1 - it.drag * dt);
      it.m.position.addScaledVector(it.v, dt);
      if (it.m.position.y < it.floor) {
        it.m.position.y = it.floor;
        it.v.y *= -0.3;
        it.v.x *= 0.7;
        it.v.z *= 0.7;
        it.w.multiplyScalar(0.6);
      }
      it.m.rotation.x += it.w.x * dt;
      it.m.rotation.y += it.w.y * dt;
      it.m.rotation.z += it.w.z * dt;
      const fade = it.life - it.age;
      if (fade < 0.6) it.m.scale.setScalar(Math.max(0.01, fade / 0.6));
    }
  }

  clear() {
    for (const it of this.items) it.m.visible = false;
  }

  dispose() {
    Object.values(this.geos).forEach((g) => g.dispose());
    this.items.forEach((it) => it.m.material.dispose());
    this.group.removeFromParent();
  }
}

/** Dispose every geometry/material/texture below an object. */
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
  });
}
