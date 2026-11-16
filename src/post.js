// POST: the film look, in quality tiers.
//   Full path (mid / high tiers): the scene renders linear HDR into a multisampled half-float target with a depth
//   texture; bloom is a threshold + dual-filter mip chain; one composite pass does exposure, ACES, the grade (cool
//   shadows / warm highlights, saturation, a soft S-curve), depth of field on cinematic shots only, vignette and grain.
//   Phone path (low tier): NO extra passes. The same ACES + grade runs inside every material through CustomToneMapping,
//   and the vignette / letterbox are CSS. Bloom on phones is the additive halo sprites the floodlights already have.
import * as THREE from 'three';

/** The grade, shared by both paths so a phone and a laptop see the same picture. Input: ACES output (display linear). */
export const GRADE_GLSL = /* glsl */ `
vec3 ddGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // split tone: night-blue shadows, metal-halide warm highlights
  c *= mix(vec3(0.9, 0.985, 1.1), vec3(1.06, 1.0, 0.92), smoothstep(0.04, 0.55, l));
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.1), 0.0);
  // gentle S-curve in a perceptual space, black point kept off pure zero
  vec3 p = sqrt(c);
  p = p + 0.12 * (p - 0.5) * (1.0 - abs(2.0 * p - 1.0));
  c = p * p;
  return clamp(c * 0.985 + 0.004, 0.0, 1.0);
}`;

// Patch three's CustomToneMapping once, before any program compiles: ACES then the grade. The low tier sets
// renderer.toneMapping = CustomToneMapping; the full path tone maps in its own composite instead.
if (!THREE.ShaderChunk.tonemapping_pars_fragment.includes('ddGrade')) {
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    `${GRADE_GLSL}\nvec3 CustomToneMapping( vec3 color ) { return ddGrade( ACESFilmicToneMapping( color ) ); }`,
  );
}

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 13-tap "dual filter" style downsample (Jimenez 2014, COD:AW), with a soft-knee threshold on the first level
const BAD_GLSL = /* glsl */ `
bool badf(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
bool bad(vec3 c) { return badf(c.r) || badf(c.g) || badf(c.b); }`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; uniform float uFirst;
varying vec2 vUv;
${BAD_GLSL}
vec3 pre(vec3 c) {
  if (uFirst < 0.5) return c;
  // a NaN or Inf from any shader must not become a frame-wide glow: drop it before it is blurred
  if (bad(c)) return vec3(0.0);
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-4);
  return c * max(rq, br - uThreshold) / max(br, 1e-4);
}
void main(){
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2( 0.0, -2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2( 2.0, -2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 e = texture2D(tSrc, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2(-2.0,  0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2( 2.0,  0.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2( 1.0,  1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2(-2.0,  2.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2( 0.0,  2.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2( 2.0,  2.0)).rgb;
  vec3 o = (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
  // clamp fireflies (a single hot pixel must not become a disc of light)
  o = min(pre(o), vec3(60.0));
  gl_FragColor = vec4(o, 1.0);
}`;

// 9-tap tent upsample, added onto the next larger level (additive blending)
const UP = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScatter;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 s = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + t * vec2(0.0, -1.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + t * vec2(-1.0, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + t * vec2(1.0, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  s += texture2D(tSrc, vUv + t * vec2(0.0, 1.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(s * (uScatter / 16.0), 1.0);
}`;

// separable gaussian (9 taps via linear sampling) for the depth-of-field blur
const BLUR = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBlur; uniform sampler2D tDepth;
uniform float uBloom; uniform float uExposure; uniform float uVignette; uniform float uGrain; uniform float uTime;
uniform float uDof; uniform float uFocus; uniform float uRange; uniform float uNear; uniform float uFar; uniform float uAspect;
uniform float uLift;
varying vec2 vUv;
${GRADE_GLSL}
${BAD_GLSL}
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color){
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = I * (color / 0.6);
  color = RRTAndODTFit(color);
  return clamp(O * color, 0.0, 1.0);
}
float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  if (bad(c)) c = vec3(0.0);
  c = min(c, vec3(6e4));
  if (uDof > 0.001) {
    float z = -viewZ(texture2D(tDepth, vUv).r);
    float coc = clamp(abs(z - uFocus) / uRange, 0.0, 1.0);
    vec3 b = texture2D(tBlur, vUv).rgb;
    c = mix(c, b, smoothstep(0.08, 1.0, coc) * uDof);
  }
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c = ddGrade(aces(c * uExposure));
  vec2 q = vUv - 0.5;
  q.x *= uAspect;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.95, length(q));
  c = toSRGB(c);
  c += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
  gl_FragColor = vec4(max(c + uLift, 0.0), 1.0);
}`;

const COPY = /* glsl */ `uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`;

export const POST_TIERS = {
  high: { path: 'full', samples: 4, levels: 6, grain: 0.035 },
  mid: { path: 'full', samples: 4, levels: 5, grain: 0.03 },
  low: { path: 'direct' },
};

/** Can this renderer do the full path (half-float colour targets)? */
export function canFullPost(renderer) {
  const caps = renderer.capabilities;
  if (!caps.isWebGL2) return false;
  return !!(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
}

export class Post {
  constructor(renderer, tierName = 'high') {
    this.renderer = renderer;
    const cfg = POST_TIERS[tierName] || POST_TIERS.high;
    this.full = cfg.path === 'full' && canFullPost(renderer);
    this.cfg = cfg;
    this.tier = tierName;
    // what the director asks for this frame (eased toward)
    this.want = { exposure: 1, bloom: 0.9, dof: 0, focus: 10, range: 6, vignette: 0.34 };
    this.cur = { ...this.want };
    this.time = 0;
    if (!this.full) {
      renderer.toneMapping = THREE.CustomToneMapping;
      renderer.toneMappingExposure = 1.0;
      return;
    }
    renderer.toneMapping = THREE.NoToneMapping; // the composite does it
    const half = THREE.HalfFloatType;
    this.depthTex = new THREE.DepthTexture(1, 1);
    this.depthTex.type = THREE.UnsignedIntType;
    // retina screens: the HDR scene renders at up to 1.5x with 2x MSAA (4x MSAA at 2x was ~290 MB of targets and twice
    // the GPU time for no visible gain once the composite resolves it)
    this.hiDpi = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) >= 1.5;
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: half, samples: this.hiDpi ? 2 : cfg.samples, depthTexture: this.depthTex, depthBuffer: true });
    this.rtScene.texture.name = 'post-scene';
    const mk = () => {
      const t = new THREE.WebGLRenderTarget(1, 1, { type: half, depthBuffer: false });
      t.texture.minFilter = THREE.LinearFilter;
      t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
      return t;
    };
    this.down = [];
    for (let i = 0; i < cfg.levels; i++) this.down.push(mk());
    this.blurA = mk();
    this.blurB = mk();
    const quadGeo = new THREE.BufferGeometry();
    quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    quadGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(quadGeo);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const sm = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
    // only true light sources bloom (lamp lenses, screens, lit signs): broad mid-bright haze must not, or it fogs the sky
    this.mDown = sm(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.55 }, uKnee: { value: 0.45 }, uFirst: { value: 0 } });
    this.mUp = sm(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.85 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.mBlur = sm(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mCopy = sm(COPY, { tSrc: { value: null } });
    this.mComp = sm(COMPOSITE, {
      tScene: { value: this.rtScene.texture },
      tBloom: { value: this.down[0].texture },
      tBlur: { value: this.blurB.texture },
      tDepth: { value: this.depthTex },
      uBloom: { value: 0.9 },
      uExposure: { value: 1 },
      uVignette: { value: 0.34 },
      uGrain: { value: cfg.grain },
      uTime: { value: 0 },
      uDof: { value: 0 },
      uFocus: { value: 10 },
      uRange: { value: 6 },
      uNear: { value: 0.1 },
      uFar: { value: 800 },
      uAspect: { value: 1 },
      uLift: { value: 0 },
    });
  }

  describe() {
    return this.full ? `full (HDR ${this.rtScene.width}x${this.rtScene.height} x${this.rtScene.samples} MSAA, bloom ${this.cfg.levels} levels, DoF)` : 'direct (in-material ACES + grade)';
  }

  targets() {
    if (!this.full) return {};
    const o = { scene: this.rtScene, blurA: this.blurA, blurB: this.blurB };
    this.down.forEach((t, i) => (o['bloom' + i] = t));
    return o;
  }

  setSize(w, h, dpr) {
    if (!this.full) return;
    const d = Math.min(dpr, 1.5);
    const W = Math.max(1, Math.round(w * d));
    const H = Math.max(1, Math.round(h * d));
    this.rtScene.setSize(W, H);
    let bw = Math.max(1, W >> 1);
    let bh = Math.max(1, H >> 1);
    for (const t of this.down) {
      t.setSize(bw, bh);
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    this.blurA.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.blurB.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.mComp.uniforms.uAspect.value = w / h;
  }

  /** Director input: { exposure, bloom, dof 0..1, focus (m), range (m), vignette }. Eased per frame. */
  set(o) {
    Object.assign(this.want, o);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  /** Ease the director's settings toward their targets (game time, so stepped captures behave like real play). */
  tick(dt) {
    const k = 1 - Math.exp(-6 * dt);
    for (const key in this.want) this.cur[key] += (this.want[key] - this.cur[key]) * k;
    this.time += dt;
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.full) {
      r.toneMappingExposure = this.cur.exposure;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    // bloom: threshold + downsample chain, then tent upsample back up (added onto each larger level)
    const D = this.mDown.uniforms;
    let src = this.rtScene.texture;
    let sw = this.rtScene.width;
    let sh = this.rtScene.height;
    for (let i = 0; i < this.down.length; i++) {
      D.tSrc.value = src;
      D.uTexel.value.set(1 / sw, 1 / sh);
      D.uFirst.value = i === 0 ? 1 : 0;
      this.pass(this.mDown, this.down[i]);
      src = this.down[i].texture;
      sw = this.down[i].width;
      sh = this.down[i].height;
    }
    const U = this.mUp.uniforms;
    for (let i = this.down.length - 1; i > 0; i--) {
      U.tSrc.value = this.down[i].texture;
      U.uTexel.value.set(1 / this.down[i].width, 1 / this.down[i].height);
      this.pass(this.mUp, this.down[i - 1]);
    }
    const C = this.mComp.uniforms;
    const dof = this.cur.dof;
    if (dof > 0.01) {
      // half-res copy of the frame, blurred twice (horizontal + vertical)
      this.mCopy.uniforms.tSrc.value = this.rtScene.texture;
      this.pass(this.mCopy, this.blurA);
      const B = this.mBlur.uniforms;
      for (let n = 0; n < 2; n++) {
        B.tSrc.value = this.blurA.texture;
        B.uDir.value.set((1.6 + n) / this.blurA.width, 0);
        this.pass(this.mBlur, this.blurB);
        B.tSrc.value = this.blurB.texture;
        B.uDir.value.set(0, (1.6 + n) / this.blurA.height);
        this.pass(this.mBlur, this.blurA);
      }
      this.mCopy.uniforms.tSrc.value = this.blurA.texture;
      this.pass(this.mCopy, this.blurB);
    }
    C.uDof.value = dof;
    C.uFocus.value = this.cur.focus;
    C.uRange.value = Math.max(0.5, this.cur.range);
    C.uNear.value = camera.near;
    C.uFar.value = camera.far;
    C.uBloom.value = this.cur.bloom * 0.06;
    C.uExposure.value = this.cur.exposure;
    C.uVignette.value = this.cur.vignette;
    C.uTime.value = this.time;
    this.pass(this.mComp, null);
  }

  dispose() {
    if (!this.full) return;
    [this.rtScene, this.blurA, this.blurB, ...this.down].forEach((t) => t.dispose());
    this.depthTex.dispose();
    [this.mDown, this.mUp, this.mBlur, this.mCopy, this.mComp].forEach((m) => m.dispose());
    this.quad.geometry.dispose();
  }
}
