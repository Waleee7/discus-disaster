// WEATHER LOOKS: fog density + colour, sky palette (night / golden hour with a real sun), falling rain (one shader, one draw),
// a wet track (lower roughness + a small reflection environment) with puddles, and the sun's long shadows.
// The numbers that change the THROW live in src/weather.js; this file is only what you see.
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { FOG_COLOR } from './sky.js';

const NIGHT = { top: [0.0016, 0.0028, 0.0085], mid: [0.006, 0.0105, 0.026], glow: [0.075, 0.042, 0.02], glowAmt: 1, sun: 0, fog: FOG_COLOR };
const SUNSET = { top: [0.045, 0.085, 0.24], mid: [0.5, 0.2, 0.2], glow: [0.9, 0.36, 0.1], glowAmt: 0.55, sun: 1, fog: 0x6b4540 };
const SUN_DIR = new THREE.Vector3(-0.66, 0.2, -0.72).normalize(); // low, left-front: shadows run long to the right and toward the camera

/** A tiny reflection environment (dark dome + a ring of warm lamps + a lit stand band) so wet surfaces have something to mirror. */
function makeWetEnv(renderer) {
  const sc = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pos = dome.geometry.attributes.position;
  const cols = [];
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 50;
    const c = new THREE.Color().setRGB(0.02 + 0.03 * (1 - Math.abs(h)), 0.03 + 0.04 * (1 - Math.abs(h)), 0.06 + 0.05 * (1 - Math.abs(h)));
    if (h > -0.05 && h < 0.2) c.lerp(new THREE.Color(1.0, 0.62, 0.3), 0.75 * (1 - Math.abs(h - 0.07) / 0.13)); // lit stands band
    cols.push(c.r, c.g, c.b);
  }
  dome.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  sc.add(dome);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 11, 8) });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), lampMat);
    q.position.set(Math.cos(a) * 36, 30, Math.sin(a) * 36);
    q.lookAt(0, 0, 0);
    sc.add(q);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0.02);
  pm.dispose();
  dome.geometry.dispose();
  dome.material.dispose();
  lampMat.dispose();
  return rt;
}

function makeRain(ctx) {
  const N = ctx.tier.name === 'high' ? 3200 : ctx.tier.name === 'mid' ? 1800 : 900;
  const W = 70;
  const H = 30;
  const r = mulberry32(404);
  const pos = new Float32Array(N * 2 * 3);
  const end = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = r() * W;
    const y = r() * H;
    const z = r() * W;
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2] = 0;
    end[i * 2 + 1] = 0.55 + r() * 0.5; // streak length factor
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSlant: { value: new THREE.Vector2(0.2, 0) }, uAmt: { value: 1 } },
    vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec2 uSlant; attribute float aEnd; varying float vA;
      void main(){
        float W = ${W.toFixed(1)}; float H = ${H.toFixed(1)};
        vec3 p = position;
        p.y = mod(p.y - uTime * 17.0, H);
        p.xz += uSlant * (H - p.y);
        vec3 w;
        w.x = uCam.x + mod(p.x - uCam.x + W * 0.5, W) - W * 0.5;
        w.z = uCam.z + mod(p.z - uCam.z + W * 0.5, W) - W * 0.5;
        w.y = p.y;
        w += vec3(-uSlant.x, 1.0, -uSlant.y) * aEnd * 0.9;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        float d = length(mv.xyz);
        vA = smoothstep(0.6, 3.0, d) * (1.0 - smoothstep(H * 0.8, H * 1.25, d)) * (0.5 + 0.5 * step(0.5, aEnd));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uAmt; varying float vA; void main(){ gl_FragColor = vec4(0.72, 0.8, 0.92, vA * 0.4 * uAmt); }`,
  });
  const m = new THREE.LineSegments(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 6;
  m.visible = false;
  return { mesh: m, mat, dispose: () => (g.dispose(), mat.dispose()) };
}

function makePuddles(ctx, env) {
  const r = mulberry32(777);
  const geo = new THREE.CircleGeometry(1, 28);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x26364a, roughness: 0.03, metalness: 0, envMap: env.texture, envMapIntensity: 2.2, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const spots = [];
  // on the track straights and bends nearest the circle, in the landing area, and at the cage mouth / pad edge
  for (let i = 0; i < 9; i++) spots.push([-4 + r() * 8, 0.02, -6 - r() * 4 - i * 0.0]); // placeholder, replaced below
  spots.length = 0;
  const add = (x, z, sx, sz) => spots.push([x, z, sx, sz]);
  add(5.6, -9.5, 1.3, 0.8);
  add(0.4, -34, 2.2, 1.2);
  add(-6, -47, 1.7, 2.6);
  add(6.5, -55, 2.4, 1.3);
  add(1.2, -63, 1.8, 2.2);
  add(-3.5, -29, 1.2, 1.9);
  add(8.3, -39, 1.4, 1.0);
  add(-1, 17, 2.6, 1.2); // near-side track bend
  add(-4.5, 21.5, 2.0, 1.0);
  const m = new THREE.InstancedMesh(geo, mat, spots.length);
  const q = new THREE.Matrix4();
  const s = new THREE.Matrix4();
  const ry = new THREE.Matrix4();
  spots.forEach(([x, z, sx, sz], i) => {
    q.makeTranslation(x, 0.03, z);
    s.makeScale(sx * 0.6, 1, sz * 0.6);
    ry.makeRotationY(r() * 3);
    m.setMatrixAt(i, q.multiply(ry).multiply(s));
  });
  m.visible = false;
  m.renderOrder = 2;
  m.frustumCulled = false;
  return { mesh: m, dispose: () => (geo.dispose(), mat.dispose()) };
}

export function buildWeatherFx(ctx, { sky, lights, crowd, scene, renderer }) {
  const { root, refs } = ctx;
  const fogCol = new THREE.Color(FOG_COLOR);
  let env = null;
  let puddles = null;
  const rain = makeRain(ctx);
  root.add(rain.mesh);

  // the sun: ONE shadow-casting directional light, only on while it is up; covers the circle, cage and first ~30 m
  const sun = new THREE.DirectionalLight(0xffb070, 0);
  sun.visible = false;
  const shadowOn = !!renderer;
  sun.castShadow = shadowOn;
  if (shadowOn) {
    sun.shadow.mapSize.set(ctx.tier.name === 'high' ? 2048 : 1024, ctx.tier.name === 'high' ? 2048 : 1024);
    const sc = sun.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
  }
  sun.position.copy(SUN_DIR).multiplyScalar(70).add(new THREE.Vector3(0, 0, -8));
  sun.target.position.set(0, 0, -8);
  root.add(sun, sun.target);

  const casters = [];
  const receivers = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (['cage-steel', 'cage-net'].includes(o.name)) casters.push(o);
    if (['turf', 'pad', 'track', 'apron'].includes(o.name)) receivers.push(o);
  });
  receivers.forEach((m) => (m.receiveShadow = true));

  const setPalette = (P) => {
    const u = sky.dome.material.uniforms;
    u.uTop.value.setRGB(...P.top);
    u.uMid.value.setRGB(...P.mid);
    u.uGlowCol.value.setRGB(...P.glow);
    u.uGlowAmt.value = P.glowAmt;
    u.uSunAmt.value = P.sun;
    u.uSunDir.value.copy(SUN_DIR);
    u.uFog.value.set(P.fog);
    sky.stars.visible = P.sun === 0;
    sky.beacon.visible = P.sun === 0;
  };

  let current = null;
  return {
    sun,
    rain,
    /** Make a thrower (or any group) cast the sun's shadow. */
    addCaster(obj) {
      obj.traverse((o) => o.isMesh && (o.castShadow = true));
    },
    removeCaster() {},
    apply(w) {
      current = w;
      const sunset = w.tod === 'sunset';
      const P = sunset ? SUNSET : NIGHT;
      setPalette(P);
      fogCol.set(sunset ? 0x6b4540 : w.id === 'fog' ? 0x1b222b : w.id === 'rain' ? 0x10161f : FOG_COLOR);
      if (w.id === 'fog') sky.dome.material.uniforms.uFog.value.copy(fogCol);
      else if (w.id === 'rain') sky.dome.material.uniforms.uFog.value.copy(fogCol);
      scene.background = fogCol.clone();
      scene.fog = scene.fog || new THREE.FogExp2(fogCol, w.fog);
      scene.fog.color.copy(fogCol);
      scene.fog.density = w.fog;
      // light level: floods are the key at night; at golden hour the sun is, and they sit dim
      lights.setLevel(sunset ? 0.1 : 1, w.id === 'fog' ? 0.2 : 0.1);
      lights.hemi.intensity = sunset ? 1.5 : 0.5;
      lights.hemi.color.set(sunset ? 0xffc59a : 0x6f86c4);
      lights.hemi.groundColor.set(sunset ? 0x4a3a2a : 0x251c12);
      lights.key.intensity = sunset ? 4 : 14;
      lights.setHaze(!sunset);
      sun.visible = sunset;
      sun.intensity = sunset ? 5 : 0;
      if (shadowOn) {
        casters.forEach((m) => (m.castShadow = sunset));
        if (renderer) renderer.shadowMap.enabled = true;
      }
      crowd.mat.uniforms.uBright.value = sunset ? 1.55 : 1;
      crowd.mat.uniforms.uTint.value.set(sunset ? 1.0 : 1, sunset ? 0.82 : 1, sunset ? 0.66 : 1);
      // rain: streaks + a wet, mirror-ish track + puddles
      const wet = w.rain > 0;
      rain.mesh.visible = wet;
      if (wet && renderer && !env) {
        env = makeWetEnv(renderer);
        puddles = makePuddles(ctx, env);
        root.add(puddles.mesh);
      }
      if (puddles) puddles.mesh.visible = wet;
      const track = refs.trackMat;
      const pad = refs.padMat;
      const turf = refs.turfMat;
      if (track) {
        track.roughness = wet ? 0.26 : 0.62;
        track.envMap = wet ? env.texture : null;
        track.envMapIntensity = wet ? 0.85 : 1;
        track.needsUpdate = true;
      }
      if (pad) {
        pad.roughness = wet ? 0.35 : 0.82;
        pad.envMap = wet ? env.texture : null;
        pad.envMapIntensity = wet ? 0.7 : 1;
        pad.needsUpdate = true;
      }
    },
    update(t, cam, wind, reduced) {
      if (!current) return;
      if (rain.mesh.visible) {
        rain.mat.uniforms.uTime.value = reduced ? 0 : t;
        rain.mat.uniforms.uCam.value.copy(cam.position);
        // streaks lean with the wind (three space: x = cross-range, z = -downrange)
        rain.mat.uniforms.uSlant.value.set(clamp(wind.z * 0.03, -0.35, 0.35), clamp(-wind.x * 0.03, -0.35, 0.35));
      }
    },
    dispose() {
      rain.dispose();
      if (puddles) puddles.dispose();
      if (env) env.dispose();
      sun.dispose && sun.dispose();
    },
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
