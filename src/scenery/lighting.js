// FLOODLIGHTS: masts + lamp banks (instanced lenses), small halo sprites, soft haze cones, and the real SpotLights that
// light the field. Warm-white metal-halide colour, 1/d falloff, towers deliberately unevenly spaced / aimed.
import * as THREE from 'three';
import { ARENA, ringPoint, mat4, GeoBuilder, mulberry32 } from './util.js';

const TOWERS = [
  // t (ring angle), offset (m past the track edge), aim (physics x downrange, lateral m), height
  { t: -2.7, off: 44, aim: [12, -6], h: 42 },
  { t: -1.62, off: 49, aim: [58, 5], h: 45 },
  { t: -0.46, off: 33, aim: [30, 8], h: 40 },
  { t: 0.58, off: 33, aim: [66, -7], h: 43 },
  { t: 1.66, off: 27, aim: [38, -4], h: 41 },
  { t: 2.55, off: 28, aim: [4, 9], h: 40 },
];
const SPOT_ORDER = [0, 3, 1, 4, 2, 5]; // so a smaller tier still lights the field evenly

export function buildLighting(ctx) {
  const { root, tier, keep } = ctx;
  const r = mulberry32(606);
  const steel = new THREE.Color(0x4a525a);
  const dark = new THREE.Color(0x1a1d22);
  const mast = new GeoBuilder();
  const lampDisc = new THREE.CircleGeometry(0.19, 10);
  const lampCount = TOWERS.length * 2 * 20;
  const lamps = new THREE.InstancedMesh(lampDisc, keep(new THREE.MeshBasicMaterial({ color: 0xfff3dc, toneMapped: false, side: THREE.DoubleSide })), lampCount);
  let li = 0;
  const beams = [];
  const halos = [];
  const spots = [];
  const p = new THREE.Vector3();
  const aimV = new THREE.Vector3();
  const haloMat = keep(new THREE.SpriteMaterial({ map: ctx.glowTex, color: 0xffe2b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.8 }));
  const beamMat = keep(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uI: { value: 0.07 }, uCol: { value: new THREE.Color(0xffe0b0) } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vA;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vA = clamp(-position.y/105.0, 0.0, 1.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uI; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying float vA;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float a = uI * f * pow(1.0 - vA, 1.6) * smoothstep(0.0, 0.06, vA);
          gl_FragColor = vec4(uCol * a, a); }`,
    }),
  );
  const beamGeo = new THREE.ConeGeometry(26, 105, 24, 1, true);
  beamGeo.translate(0, -52.5, 0);

  TOWERS.forEach((T, i) => {
    ringPoint(T.t, T.off, p);
    const x = p.x;
    const z = p.z;
    // lattice-ish tapered mast with three cross-braced rings and a catwalk
    mast.add(new THREE.CylinderGeometry(0.45, 0.95, T.h, 10), mat4(x, T.h / 2, z), steel, { jitter: 0.06 });
    mast.add(new THREE.CylinderGeometry(1.5, 1.5, 0.15, 10), mat4(x, T.h * 0.62, z), dark);
    mast.add(new THREE.BoxGeometry(2.4, 0.4, 2.4), mat4(x, 0.2, z), dark);
    ctx.contacts.push([x, z, 5, 5, 0, 0.5]);
    aimV.set(T.aim[1], 0, -(T.aim[0]));
    const top = new THREE.Vector3(x, T.h, z);
    const dir = aimV.clone().sub(top).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    // two banks with slightly different tilt: 5x4 and 4x4
    const banks = [{ y: T.h + 1.4, cols: 5, rows: 4, dy: 0 }, { y: T.h - 2.6, cols: 4, rows: 4, dy: -0.04 }];
    banks.forEach((B, bi) => {
      const bq = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(B.dy + (r() - 0.5) * 0.04, (r() - 0.5) * 0.05, 0)));
      const w = B.cols * 0.7 + 0.5;
      const h = B.rows * 0.7 + 0.5;
      const frame = new THREE.Matrix4().compose(new THREE.Vector3(x, B.y, z), bq, new THREE.Vector3(1, 1, 1));
      mast.add(new THREE.BoxGeometry(w, h, 0.5), frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.3)), dark);
      mast.add(new THREE.BoxGeometry(w + 0.2, 0.12, 0.7), frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, h / 2 + 0.06, -0.2)), steel); // visor
      // stem from the mast to the bank
      mast.add(new THREE.BoxGeometry(0.3, 0.3, 2.2), mat4(x, B.y, z, 0).setPosition(x, B.y, z), dark);
      for (let c = 0; c < B.cols; c++)
        for (let rr = 0; rr < B.rows; rr++) {
          if (r() < 0.035) continue; // a dead lamp or two
          const lm = frame.clone().multiply(new THREE.Matrix4().makeTranslation((c - (B.cols - 1) / 2) * 0.7, (rr - (B.rows - 1) / 2) * 0.7, 0.0));
          lamps.setMatrixAt(li++, lm);
        }
      if (bi === 0) {
        const halo = new THREE.Sprite(haloMat);
        halo.scale.set(15, 15, 1);
        halo.position.set(x, B.y, z).addScaledVector(dir, 1.2);
        halos.push(halo);
        root.add(halo);
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(x, B.y, z);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
        beam.renderOrder = 3;
        beam.frustumCulled = false;
        beams.push(beam);
        root.add(beam);
      }
    });
  });
  lamps.count = li;
  lamps.frustumCulled = false;
  root.add(lamps);
  const mastMesh = new THREE.Mesh(mast.build(), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 })));
  mastMesh.name = 'towers';
  root.add(mastMesh);

  // the actual light: N spots, warm white, falling off ~1/d, aimed at different parts of the field
  SPOT_ORDER.slice(0, tier.spots).forEach((idx) => {
    const T = TOWERS[idx];
    ringPoint(T.t, T.off, p);
    const sl = new THREE.SpotLight(0xffeeda, 380 * (6 / tier.spots) ** 0.75, 0, 0.62, 0.75, 1.1);
    sl.position.set(p.x, T.h, p.z);
    sl.target.position.set(T.aim[1], 0, -T.aim[0]);
    root.add(sl, sl.target);
    spots.push(sl);
  });
  const hemi = new THREE.HemisphereLight(0x6f86c4, 0x251c12, 0.5);
  root.add(hemi);
  // a gentle warm fill close to the circle so the athlete and cage read in the follow cam (a ground-level fixture)
  const key = new THREE.PointLight(0xffd2a0, 14, 26, 1.5);
  key.position.set(-4.5, 5.5, 2.5);
  root.add(key);
  return {
    beams,
    halos,
    spots,
    setHaze(on) {
      beams.forEach((b) => (b.visible = on));
    },
  };
}
