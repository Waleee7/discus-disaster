// SKY + HORIZON: gradient dome with a light-pollution glow that peaks over the treeline, sparse stars, and two
// silhouette cylinders (far city / near trees+buildings) so the background is never a void. All procedural.
import * as THREE from 'three';
import { ARENA, makeCanvas, toTexture, mulberry32, makeNoise } from './util.js';

export const FOG_COLOR = 0x0c1018;

function paintSkyline(W, H, seed, far) {
  const r = mulberry32(seed);
  const { c, g } = makeCanvas(W, H);
  g.clearRect(0, 0, W, H);
  const noise = makeNoise(seed, 64);
  g.fillStyle = '#fff';
  // city blocks (far layer only) with lit windows; the near layer is trees, roofs, poles
  if (far) {
    let x = 0;
    while (x < W) {
      const w = 14 + r() * 46;
      const tall = r() < 0.12;
      const h = (tall ? 0.45 + r() * 0.35 : 0.1 + r() * 0.26) * H;
      g.fillStyle = '#fff';
      g.fillRect(x, H - h, w, h);
      // roof clutter
      if (r() < 0.5) g.fillRect(x + w * 0.3, H - h - 6 - r() * 8, w * 0.2, 12);
      g.globalCompositeOperation = 'source-atop';
      g.globalCompositeOperation = 'source-over';
      x += w + (r() < 0.3 ? r() * 20 : 0);
    }
  }
  // tree masses: lumpy noise along the bottom
  for (let x = 0; x < W; x++) {
    const n = noise.fbm((x / W) * 64, far ? 3 : 8, 3);
    const base = far ? 0.07 : 0.17;
    const h = (base + n * (far ? 0.1 : 0.28)) * H;
    g.fillRect(x, H - h, 1.2, h);
  }
  // a few poles, a water tower and a cell mast on the near layer
  if (!far) {
    for (let i = 0; i < 9; i++) {
      const x = r() * W;
      g.fillRect(x, H * 0.18, 2.5, H * 0.82);
      g.fillRect(x - 10, H * 0.2, 22, 3);
    }
    const wx = W * 0.62;
    g.fillRect(wx - 3, H * 0.35, 6, H * 0.65);
    g.beginPath();
    g.ellipse(wx, H * 0.33, 24, 14, 0, 0, Math.PI * 2);
    g.fill();
  }
  // lit windows and lamp dots punched in as warm / cool lights (drawn with a colour, so they survive tinting)
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const lights = far ? 1100 : 160;
  for (let i = 0; i < lights; i++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(H * (far ? 0.25 + r() * 0.75 : 0.5 + r() * 0.5));
    const k = (y * W + x) * 4;
    if (d[k + 3] > 200) {
      const warm = r() < 0.7;
      d[k] = warm ? 255 : 170;
      d[k + 1] = warm ? 205 : 205;
      d[k + 2] = warm ? 120 : 255;
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function buildSky(ctx) {
  const { root, tier, S, keep } = ctx;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(520, 40, 20),
    keep(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uFog: { value: new THREE.Color(FOG_COLOR) },
          uTop: { value: new THREE.Color(0.0016, 0.0028, 0.0085) },
          uMid: { value: new THREE.Color(0.006, 0.0105, 0.026) },
          uGlowCol: { value: new THREE.Color(0.075, 0.042, 0.02) },
          uGlowAmt: { value: 1 },
          uSunDir: { value: new THREE.Vector3(0, -1, 0) },
          uSunCol: { value: new THREE.Color(1, 0.55, 0.22) },
          uSunAmt: { value: 0 },
          uCloud: { value: 1 },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `varying vec3 vP; uniform vec3 uFog; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uGlowCol; uniform float uGlowAmt; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunAmt; uniform float uCloud;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
          void main(){
            vec3 d = normalize(vP);
            float h = d.y;
            float az = atan(d.x, d.z);
            vec3 fogc = uFog;
            vec3 top = uTop;
            vec3 mid = uMid;
            // city glow: sodium-warm domes at a few azimuths, strongest right above the treeline
            float dome = 0.5 + 0.5 * sin(az * 2.0 + 0.7) * sin(az * 3.3 - 1.1) + 0.25 * sin(az * 7.0);
            float glow = exp(-max(h, 0.0) * 11.0) * (0.45 + 0.75 * clamp(dome, 0.0, 1.0));
            vec3 c = mix(fogc, mid, smoothstep(0.0, 0.3, h));
            c = mix(c, top, smoothstep(0.25, 0.9, h));
            c += uGlowCol * uGlowAmt * glow * smoothstep(-0.02, 0.03, h);
            // streaky high cloud catching the glow
            float cl = vn(vec2(az * 3.0, h * 14.0) + vec2(0.0, 2.0)) * vn(vec2(az * 7.0 + 3.0, h * 30.0));
            c += (uGlowCol * 0.3 + vec3(0.004)) * uCloud * smoothstep(0.35, 0.8, cl) * exp(-h * 5.0) * step(0.02, h);
            // the sun: a small hard disc, a tight warm halo, and a wide faint band along the horizon on its side
            float sd = max(dot(d, normalize(uSunDir)), 0.0);
            float disc = smoothstep(0.99955, 0.99985, sd);
            c += uSunAmt * uSunCol * (disc * 14.0 + pow(sd, 90.0) * 1.1 + pow(sd, 7.0) * 0.28 * exp(-max(h, 0.0) * 4.0));
            // cloud streaks lit from below by the sun
            c += uSunAmt * uSunCol * 0.5 * smoothstep(0.4, 0.85, cl) * smoothstep(0.02, 0.2, h) * smoothstep(0.65, 0.0, h) * pow(sd, 2.0);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    ),
  );
  dome.renderOrder = -10;
  root.add(dome);

  // stars: sparse, varied, kept above the glow
  const n = 190;
  const sp = new Float32Array(n * 3);
  const sc = new Float32Array(n * 3);
  const r = mulberry32(55);
  for (let i = 0; i < n; i++) {
    const th = r() * Math.PI * 2;
    const y = 0.2 + Math.pow(r(), 0.7) * 0.8;
    const rr = Math.sqrt(1 - y * y);
    sp.set([Math.cos(th) * rr * 500, y * 500, Math.sin(th) * rr * 500], i * 3);
    const b = 0.25 + Math.pow(r(), 3) * 0.75;
    sc.set([b * (0.85 + r() * 0.15), b * 0.92, b], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, keep(new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.6, depthWrite: false })));
  stars.renderOrder = -9;
  root.add(stars);

  // horizon layers
  const layers = [
    { R: 400, h: 120, tint: 0x0b0f17, seed: 4, far: true, rep: 3 },
    { R: 290, h: 70, tint: 0x040608, seed: 9, far: false, rep: 4 },
  ];
  layers.forEach((L) => {
    const tex = toTexture(paintSkyline(S(1024), S(256), L.seed, L.far), { wrap: true, repeat: [L.rep, 1], aniso: 4 });
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, color: L.tint, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    // lit-window texels are bright in the texture; multiplying by a very dark tint would kill them, so lift via emissive map trick:
    mat.color.setHex(0xffffff);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTint = { value: new THREE.Color(L.tint) };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTint;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          // silhouettes are white in the map, lights are coloured: tint the white, keep the coloured
          float sat = max(max(sampledDiffuseColor.r, sampledDiffuseColor.g), sampledDiffuseColor.b) - min(min(sampledDiffuseColor.r, sampledDiffuseColor.g), sampledDiffuseColor.b);
          diffuseColor.rgb = mix(uTint, sampledDiffuseColor.rgb * 1.6, step(0.12, sat));`);
    };
    mat.customProgramCacheKey = () => 'skyline';
    const m = new THREE.Mesh(new THREE.CylinderGeometry(L.R, L.R, L.h, 96, 1, true), mat);
    m.position.set(0, L.h / 2 - 3, -ARENA.cx);
    m.renderOrder = -8;
    root.add(m);
  });

  // a distant mast with a blinking aviation light
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.6, 120, 5), keep(new THREE.MeshBasicMaterial({ color: 0x06080c, fog: false })));
  mast.position.set(-120, 57, -330);
  root.add(mast);
  const beacon = new THREE.Sprite(keep(new THREE.SpriteMaterial({ color: 0xff3a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, map: ctx.glowTex })));
  beacon.scale.set(7, 7, 1);
  beacon.position.set(-120, 118, -330);
  root.add(beacon);
  return {
    dome,
    stars,
    beacon,
    layers: [],
    update(t) {
      beacon.material.opacity = 0.2 + 0.8 * Math.max(0, Math.sin(t * 2.4)) ** 4;
    },
  };
}
