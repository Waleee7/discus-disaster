// Procedural NIGHT college track & field meet. This file is the orchestrator; the venue is built by reusable systems
// in src/scenery/: sky (dome, stars, horizon layers), field (turf, sector paint, markers, track), cage (circle + cage),
// stands (terraces, crowd, banners, scoreboard), lighting (towers, haze, spotlights), props (tents, racks, trees, AO).
// Physics frame -> three.js frame: (x, y, z) -> (z, y, -x), i.e. the throw heads down -Z.
import * as THREE from 'three';
import { ARENA, makeNoise, pickTier, radialTex } from './scenery/util.js';
import { buildSky, FOG_COLOR } from './scenery/sky.js';
import { buildField } from './scenery/field.js';
import { buildCage } from './scenery/cage.js';
import { buildStands } from './scenery/stands.js';
import { buildLighting } from './scenery/lighting.js';
import { buildProps } from './scenery/props.js';
import { StaticCards } from './cards.js';
import { buildWeatherFx } from './scenery/wx.js';
import { buildBowl } from './scenery/bowl.js';
import { gustFactor } from './physics.js';

export { ARENA };
const ORIGIN = new THREE.Vector3();
export const toThree = (x, y, z, out = new THREE.Vector3()) => out.set(z, y, -x);

export function buildStadium(scene, { reducedMotion = false, viewport, quality, venue = 'college', renderer } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const mats = [];
  const keep = (m) => (mats.push(m), m);
  const vp = viewport || { width: typeof innerWidth === 'number' ? innerWidth : 1280, height: typeof innerHeight === 'number' ? innerHeight : 720 };
  const tier = pickTier(vp.width, vp.height, quality);

  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0034);
  if (renderer) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const ctx = {
    root,
    scene,
    tier,
    venue,
    refs: {},
    S: (n) => Math.max(64, Math.round(n * tier.tex)),
    keep,
    noise: makeNoise(7, 256),
    contacts: [],
    cards: new StaticCards(),
    glowTex: radialTex(128, [[0, 'rgba(255,255,255,1)'], [0.07, 'rgba(255,244,225,0.85)'], [0.22, 'rgba(255,225,185,0.22)'], [0.55, 'rgba(255,215,170,0.05)'], [1, 'rgba(255,210,160,0)']]),
  };
  keep({ map: ctx.glowTex, dispose() {} });

  const sky = buildSky(ctx);
  buildField(ctx);
  buildCage(ctx);
  const world = venue === 'world';
  const bowl = world ? buildBowl(ctx) : null;
  const stands = world ? bowl : buildStands(ctx);
  const lights = world ? bowl.lights : buildLighting(ctx);
  // soft multi-direction contact shadow under the athlete: one blob per spotlight, stretched away from its tower
  ctx.contacts.push([0, 0, 1.3, 1.3, 0, 0.26]);
  for (const sl of lights.spots) {
    const dx = -sl.position.x;
    const dz = -sl.position.z;
    const l = Math.hypot(dx, dz) || 1;
    ctx.contacts.push([(dx / l) * 0.9, (dz / l) * 0.9, 0.8, 2.6, Math.atan2(dx, dz), 0.07]);
  }
  const props = buildProps(ctx);
  ctx.cards.build(root, keep);
  const crowd = stands.crowd;
  keep(crowd.mat);

  // --- wind sock: striped, on a guyed pole by the circle -------------------------------------------------------------
  const sock = new THREE.Group();
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0xaab2b8, roughness: 0.5, metalness: 0.25 }));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 5, 8), poleMat);
  pole.position.y = 2.5;
  sock.add(pole);
  const coneGeo = new THREE.ConeGeometry(0.42, 2.4, 14, 5, true);
  coneGeo.rotateX(Math.PI);
  coneGeo.translate(0, -1.2, 0);
  {
    const p = coneGeo.attributes.position;
    const cols = [];
    const o = new THREE.Color(0xe8700a);
    const w = new THREE.Color(0xf1ede2);
    for (let i = 0; i < p.count; i++) {
      const band = Math.floor((-p.getY(i) / 2.4) * 5 - 0.001);
      const c = band % 2 ? w : o;
      cols.push(c.r, c.g, c.b);
    }
    coneGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
  const cone = new THREE.Mesh(coneGeo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.012, 5, 18), poleMat);
  ring.rotation.x = Math.PI / 2;
  const sockPivot = new THREE.Group();
  sockPivot.position.y = 4.95;
  sockPivot.add(cone, ring);
  sock.add(sockPivot);
  sock.position.set(-8.5, 0, -8.5);
  root.add(sock);

  const wx = buildWeatherFx(ctx, { sky, lights, crowd, scene, renderer });
  const state = { wind: { x: 0, z: 0 }, gust: null, time: 0, tier: tier.name, weather: null };
  const apply = (t) => {
    crowd.setDensity(t.crowd);
    lights.setHaze(t.haze && !(state.weather && state.weather.tod === 'sunset'));
  };
  apply(tier);
  const down = { high: 'mid', mid: 'low', low: 'low' };
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return {
    root,
    crowdMat: crowd.mat,
    tier,
    setJudgeCall: props.setJudgeCall,
    setWind(w, gust = null) {
      state.wind = w;
      state.gust = gust;
    },
    /** Weather looks (fog, sky, rain, wet track, sun). `w` is a weather.js preset. */
    setWeather(w) {
      state.weather = w;
      wx.apply(w);
      if (world) bowl.setFog(scene.fog.color, scene.fog.density);
      apply({ high: { crowd: 1, haze: true }, mid: { crowd: 0.7, haze: true }, low: { crowd: 0.42, haze: false } }[state.tier]);
    },
    /** Reactivate this venue's fog / background after another venue was shown. */
    activate() {
      root.visible = true;
    },
    deactivate() {
      root.visible = false;
    },
    addCaster: (o) => wx.addCaster(o),
    info: () => ({ venue, tier: tier.name }),
    setExcite(x) {
      crowd.mat.uniforms.uExcite.value = x;
    },
    /** Runtime quality drop (crowd density, haze). Textures / light count are fixed at build time. */
    degrade() {
      const next = down[state.tier];
      if (next !== state.tier) {
        state.tier = next;
        apply({ high: { crowd: 1, haze: true }, mid: { crowd: 0.7, haze: true }, low: { crowd: 0.42, haze: false } }[next]);
        return true;
      }
      return false;
    },
    update(t, cam) {
      state.time = t;
      if (world) bowl.update(t);
      crowd.mat.uniforms.uTime.value = reducedMotion ? 0 : t;
      sky.update(t);
      const gf = gustFactor(state.gust, t * 1.0);
      const wx0 = state.wind.z * gf;
      const wz = -state.wind.x * gf;
      const sp = Math.hypot(wx0, wz);
      const k = Math.min(1, sp / 4.5);
      const flutter = Math.sin(t * 7 + 1) * 0.06 * k;
      dir.set(sp > 1e-3 ? (wx0 / sp) * k : 0, -(1 - k) - 0.05 + flutter, sp > 1e-3 ? (wz / sp) * k : 0).normalize();
      sockPivot.quaternion.setFromUnitVectors(v.set(0, -1, 0), dir);
      wx.update(t, cam || { position: ORIGIN }, state.wind, reducedMotion);
    },
    dispose() {
      mats.forEach((m) => {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      });
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      root.removeFromParent();
    },
  };
}
