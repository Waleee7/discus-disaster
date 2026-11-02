// DISCUS DISASTER - game orchestration: state machine, rules, camera, HUD, replay.
import * as THREE from 'three';
import {
  CIRCLE_RADIUS,
  SECTOR_HALF_ANGLE,
  WORLD_RECORD_M,
  DEG,
  createFlight,
  stepFlight,
  simulate,
  optimalAttitude,
  formatFeetInches,
  mulberry32,
} from './physics.js';
import { buildStadium, toThree } from './scene.js';
import { buildDiscus, buildThrower, buildTape, buildBlobShadow } from './actors.js';
import { Particles, Debris, disposeTree } from './fx.js';
import { buildObstacles, makeLayout } from './obstacles.js';
import { Announcer, rankFor } from './announcer.js';
import { Haptics } from './haptics.js';
import { Input } from './input.js';
import { FULL_TURNS, DIZZY_TURNS, STEPOUT_TURNS, V_MIN, powerOf, speedOf, releaseAngleOf } from './tuning.js';

export { powerOf, speedOf, releaseAngleOf };

// ---- tuning -------------------------------------------------------------------------------
const STEP = 1 / 240; // fixed physics step
const REC_EVERY = 2; // record trajectory at 120 Hz
// Post-landing beat (simulated seconds): the discus sits, then the tape runs out and the card counts up.
// Slow-mo is limited to the last ~0.26 s of descent + the first 0.2 s after touchdown (~1.5 s of real time).
const TAPE_START = 0.6;
const TAPE_DUR = 1.1;
const SLOW_SCALE = 0.3;
const SKIP_GRACE = 0.35; // a press this soon after release is the release itself (key bounce), not a skip
const WINDOW_HALF = 40; // deg: dial window half-width
const HEAD_FACTOR = SECTOR_HALF_ANGLE / WINDOW_HALF; // dial angle -> throw heading (window edge == sector edge)
const MULT_CAP = 9;
const NOSE_MIN = -5;
const NOSE_MAX = 50;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => v.toFixed(d);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,230,170,1)');
  gr.addColorStop(0.3, 'rgba(255,150,50,0.45)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.manual = false;
    this.clock = 0;
    this.state = 'howto';
    this.prevState = 'ready';
    this.attempt = 0;
    this.attempts = [];
    this.score = 0;
    this.best = null; // { distance, rec }
    this.attitude = 25;
    this.timeScale = 1;
    this.shake = 0;
    this.tO = 0; // obstacle clock
    this.seedBase = (Math.random() * 1e6) | 0;
    this.resolvers = [];
    this.rt = null;
    this.cur = null;
    this.camPos = new THREE.Vector3(4.6, 2.5, 7.2);
    this.camLook = new THREE.Vector3(-1, 1.7, -12);
    this.hdir = new THREE.Vector3(0, 0, -1);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.slowFrames = 0;
    this.skipUntil = 0;

    // renderer / scene / camera
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 800);
    this.baseFov = 55;

    this.stadium = buildStadium(this.scene, { reducedMotion: this.reducedMotion });
    this.particles = new Particles(this.scene);
    this.debris = new Debris(this.scene);
    this.obstacles = buildObstacles(this.scene, { particles: this.particles, debris: this.debris });
    this.thrower = buildThrower();
    this.scene.add(this.thrower.group);
    this.discus = buildDiscus();
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.glow.scale.set(1.6, 1.6, 1);
    this.discus.group.add(this.glow);
    this.scene.add(this.discus.group);
    this.shadow = buildBlobShadow();
    this.scene.add(this.shadow);
    this.tape = buildTape();
    this.scene.add(this.tape.group);

    // DOM
    this.dom = {
      pips: $('pips'),
      attemptTxt: $('attemptTxt'),
      bestDist: $('bestDist'),
      score: $('score'),
      windArrow: $('windArrow'),
      windKind: $('windKind'),
      windVal: $('windVal'),
      windCross: $('windCross'),
      powerFill: $('powerFill'),
      powerBar: $('powerBar'),
      powerTxt: $('powerTxt'),
      speedTxt: $('speedTxt'),
      spinTxt: $('spinTxt'),
      dizzyTxt: $('dizzyTxt'),
      noseRot: $('noseRot'),
      nose: $('nose'),
      noseTxt: $('noseTxt'),
      aoaTxt: $('aoaTxt'),
      needle: $('needle'),
      dialState: $('dialState'),
      hint: $('hint'),
      flash: $('flash'),
      result: $('result'),
      resTag: $('resTag'),
      resRank: $('resRank'),
      resDist: $('resDist'),
      resFeet: $('resFeet'),
      resChips: $('resChips'),
      resStats: $('resStats'),
      resNote: $('resNote'),
      btnNext: $('btnNext'),
      btnDetails: $('btnDetails'),
      btnReplay: $('btnReplay'),
      btnDetails: $('btnDetails'),
      btnReplay2: $('btnReplay2'),
      btnVoice: $('btnVoice'),
      btnHaptics: $('btnHaptics'),
      replayTag: $('replayTag'),
      replayInfo: $('replayInfo'),
      howto: $('howto'),
    };
    const arc = (a0, a1, r = 54) => {
      const p = (a) => `${(r * Math.sin(a * DEG)).toFixed(2)} ${(-r * Math.cos(a * DEG)).toFixed(2)}`;
      return `M0 0 L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`;
    };
    $('dialWindow').setAttribute('d', arc(-WINDOW_HALF, WINDOW_HALF));
    $('dialSector').setAttribute('d', 'M0 -54 L0 -40');

    this.announcer = new Announcer({ root: $('lt'), textEl: $('ltText'), tagEl: $('ltTag') });
    this.input = new Input(canvas.parentElement, {
      press: () => this.onPress(),
      release: () => this.onRelease(),
      nose: (d) => this.adjustNose(d),
      action: (a, data) => this.onAction(a, data),
    });
    this.haptics = new Haptics(() => this.input.pad);
    this.bindButtons();

    this.layout = makeLayout(this.seedBase);
    this.applyLayout(this.layout);
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      if (document.hidden && this.announcer.supportsSpeech) speechSynthesis.cancel();
    });
    this.updatePips();
    this.updateNose();
    this.setReadyVisuals();
    this.updateHudStatic();
    try {
      if (localStorage.getItem('dd-howto-seen')) this.closeHowTo(true);
    } catch {
      /* private mode */
    }
  }

  // ------------------------------------------------------------------ plumbing
  bindButtons() {
    const d = this.dom;
    const click = (el, fn) =>
      el.addEventListener('click', (e) => {
        fn();
        if (e.detail > 0) el.blur(); // mouse click: give Space back to the game
      });
    click(d.btnVoice, () => this.onAction('voice'));
    click(d.btnHaptics, () => this.onAction('haptics'));
    click(d.btnReplay, () => this.onAction('replay'));
    click(d.btnReplay2, () => this.onAction('replay'));
    click($('btnHelp'), () => this.onAction('help'));
    click(d.btnNext, () => this.onAction('next'));
    click(d.btnDetails, () => this.setDetails(!d.result.classList.contains('open')));
    click($('btnStart'), () => this.closeHowTo());
    if (!this.announcer.supportsSpeech) {
      d.btnVoice.disabled = true;
      d.btnVoice.querySelector('b').textContent = 'N/A';
    }
    d.btnHaptics.querySelector('b').textContent = this.haptics.available ? 'ON' : 'ON*';
    d.btnHaptics.title = this.haptics.canVibrate ? 'Haptics (H)' : 'Haptics (H) - vibration not supported on this device; controller rumble still works';
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.baseFov = w / h < 0.9 ? 72 : w / h < 1.3 ? 62 : 54;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(h * this.dpr, this.baseFov);
  }

  applyLayout(l) {
    this.layout = l;
    this.obstacles.setLayout(l);
    this.stadium.setWind(l.wind);
    const hw = -l.wind.x;
    const d = this.dom;
    d.windKind.textContent = hw >= 0 ? 'HEADWIND' : 'TAILWIND';
    d.windKind.className = 'kind ' + (hw >= 0 ? 'head' : 'tail');
    d.windVal.textContent = `${Math.abs(hw).toFixed(1)} m/s`;
    d.windCross.textContent = `CROSS ${Math.abs(l.wind.z).toFixed(1)} ${l.wind.z >= 0 ? '→' : '←'}`;
    d.windArrow.querySelector('.arrow').style.transform = `rotate(${Math.atan2(l.wind.z, l.wind.x) / DEG}deg)`;
  }

  setState(s) {
    this.state = s;
    document.body.dataset.state = s;
    document.body.classList.toggle('hint-on', s === 'ready');
    this.dom.hint.classList.toggle('off', s !== 'ready');
  }

  // ------------------------------------------------------------------ input handlers
  onPress() {
    switch (this.state) {
      case 'howto':
        this.closeHowTo();
        break;
      case 'ready':
        this.startSpin();
        break;
      case 'result':
      case 'final':
        if (this.clock >= (this.skipUntil || 0)) this.next();
        break;
      case 'flight':
        this.skipToResult();
        break;
      case 'replay':
        this.endReplay();
        break;
      default:
    }
  }

  onRelease() {
    if (this.state === 'spin') this.doRelease();
  }

  adjustNose(d) {
    if (this.state === 'flight' || this.state === 'landed' || this.state === 'replay' || this.state === 'howto') return;
    this.attitude = clamp(this.attitude + d, NOSE_MIN, NOSE_MAX);
    this.updateNose();
  }

  onAction(a, data) {
    switch (a) {
      case 'voice': {
        const on = this.announcer.setVoice(!this.announcer.voiceOn);
        this.dom.btnVoice.setAttribute('aria-pressed', String(on));
        this.dom.btnVoice.querySelector('b').textContent = on ? 'ON' : 'OFF';
        if (on) this.announcer.show('Announcer voice online. Please hold your applause.', 'STADIUM ANNOUNCER', 3, 2500);
        break;
      }
      case 'haptics': {
        this.haptics.enabled = !this.haptics.enabled;
        this.dom.btnHaptics.setAttribute('aria-pressed', String(this.haptics.enabled));
        this.dom.btnHaptics.querySelector('b').textContent = this.haptics.enabled ? (this.haptics.available ? 'ON' : 'ON*') : 'OFF';
        if (this.haptics.enabled) this.haptics.hit();
        break;
      }
      case 'replay':
        if (this.best && ['ready', 'result', 'final'].includes(this.state)) this.startReplay(this.best.rec);
        else if (this.state === 'replay') this.endReplay();
        break;
      case 'next':
        if (this.state === 'result' || this.state === 'final') this.next();
        else if (this.state === 'howto') this.closeHowTo();
        break;
      case 'help':
        if (this.state === 'howto') this.closeHowTo();
        else if (this.state === 'ready' || this.state === 'result') this.openHowTo();
        break;
      case 'close':
        if (this.state === 'howto') this.closeHowTo();
        else if (this.state === 'replay') this.endReplay();
        break;
      case 'padconnected':
        this.announcer.show(`Controller connected: ${(data && data.id ? data.id : 'gamepad').slice(0, 40)}. Hold A or RT to spin, stick for nose.`, 'CONTROLLER', 2, 3500);
        this.haptics.hit();
        break;
      case 'paddisconnected':
        this.announcer.show('Controller disconnected. Keyboard and touch still work.', 'CONTROLLER', 2, 2500);
        break;
      default:
    }
  }

  openHowTo() {
    this.prevState = this.state;
    this.dom.howto.hidden = false;
    this.setState('howto');
    $('btnStart').focus({ preventScroll: true });
  }

  closeHowTo(silent = false) {
    this.dom.howto.hidden = true;
    try {
      localStorage.setItem('dd-howto-seen', '1');
    } catch {
      /* ignore */
    }
    const back = this.prevState === 'result' && this.attempts.length ? 'result' : 'ready';
    this.setState(back);
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    if (back === 'ready' && !silent) this.announcer.say('ready', {}, { priority: 1 });
    if (back === 'ready' && silent) this.announcer.say('intro', {}, { priority: 1 });
    this.prevState = 'ready';
  }

  // ------------------------------------------------------------------ attempt lifecycle
  updatePips() {
    const pips = this.dom.pips.children;
    for (let i = 0; i < 3; i++) {
      const r = this.attempts[i];
      pips[i].className = r ? (r.foul ? 'foul' : 'done') : i === this.attempt ? 'on' : '';
    }
    this.dom.attemptTxt.textContent = `${Math.min(this.attempt + 1, 3)}/3`;
  }

  updateHudStatic() {
    this.dom.bestDist.textContent = this.best ? fmt(this.best.distance) : '--.--';
    this.dom.score.textContent = String(this.score);
    this.dom.btnReplay.disabled = !this.best;
  }

  setReadyVisuals() {
    this.thrower.setFacing(180);
    this.thrower.shoulder.rotation.set(0, 0, -0.08);
    this.discus.group.removeFromParent();
    this.thrower.hand.add(this.discus.group);
    this.discus.group.position.set(0, 0, 0);
    this.discus.group.quaternion.identity();
    this.discus.group.rotation.set(this.attitude * DEG, 0, 0);
    this.glow.visible = false;
    this.shadow.visible = false;
    this.tape.hide();
    this.dom.result.hidden = true;
  }

  next() {
    if (this.state === 'final') {
      this.attempt = 0;
      this.attempts = [];
      this.score = 0;
      this.best = null;
      this.updateHudStatic();
    } else if (this.attempt < 2) {
      this.attempt++;
    } else {
      this.showFinal();
      return;
    }
    this.startAttempt();
  }

  startAttempt(seed) {
    this.cancelFx();
    this.applyLayout(makeLayout(seed ?? ++this.seedBase));
    this.setReadyVisuals();
    this.updatePips();
    this.setState('ready');
    this.timeScale = 1;
    this.flashNow(null);
    this.announcer.say('ready', {}, { priority: 1 });
  }

  /** Portrait result sheet: collapsed to a stat row by default, "details" opens the full breakdown. */
  setDetails(open) {
    this.dom.result.classList.toggle('open', open);
    this.dom.btnDetails.setAttribute('aria-expanded', String(open));
  }

  cancelFx() {
    this.setDetails(false);
    this.particles.clear();
    this.debris.clear();
    this.dom.result.hidden = true;
    this.dom.replayTag.hidden = true;
    this.tape.hide();
  }

  flashNow(text, sub = '', cls = '') {
    const f = this.dom.flash;
    if (!text) {
      f.hidden = true;
      return;
    }
    f.hidden = false;
    f.className = cls;
    f.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
  }

  // ------------------------------------------------------------------ spin
  startSpin() {
    this.setState('spin');
    this.spin = { rot: 0, t: 0, tickN: 0, psi: 180, psiVis: 180, power: 0, dizzy: 0, announced: new Set() };
    this.dom.hint.classList.add('off');
    this.flashNow(null);
    this.announcer.say('spin', {}, { priority: 1, ms: 2200 });
    this.haptics.tick(0);
  }

  updateSpin(dt) {
    const s = this.spin;
    const p = powerOf(s.rot);
    s.rot += (260 + 240 * p) * dt;
    s.t += dt;
    const dizzyK = smooth((s.rot / 360 - DIZZY_TURNS) / (STEPOUT_TURNS - DIZZY_TURNS));
    const wobble = dizzyK * 14 * Math.sin(s.t * 19);
    s.psi = wrap180(180 - s.rot);
    s.psiVis = s.psi + wobble;
    s.power = powerOf(s.rot);
    s.dizzy = dizzyK;
    const half = Math.floor(s.rot / 180);
    if (half > s.tickN) {
      s.tickN = half;
      this.haptics.tick(s.power);
    }
    if (s.rot / 360 >= FULL_TURNS && !s.announced.has('sweet')) {
      s.announced.add('sweet');
      this.announcer.say('sweet', {}, { priority: 2, ms: 2000 });
      this.haptics.perfect();
    }
    if (s.rot / 360 >= DIZZY_TURNS && !s.announced.has('dizzy')) {
      s.announced.add('dizzy');
      this.announcer.say('dizzy', {}, { priority: 2, ms: 2000 });
    }
    this.thrower.setFacing(s.psiVis);
    this.shake = Math.max(this.shake, s.power * 0.035 + dizzyK * 0.06);
    if (s.rot / 360 >= STEPOUT_TURNS) this.stepOut();
  }

  /** Release from the live spin: the dial angle decides heading AND release angle (timing is the skill). */
  doRelease() {
    const s = this.spin;
    const psi = Number.isFinite(s.psiVis) ? s.psiVis : 180;
    const p = Number.isFinite(s.power) ? s.power : 0;
    const inWindow = Math.abs(psi) <= WINDOW_HALF;
    const speed = speedOf(p);
    let params = {
      speed,
      releaseAngle: releaseAngleOf(psi),
      heading: clamp(psi, -90, 90) * HEAD_FACTOR,
      attitude: this.attitude,
      wind: this.layout.wind,
    };
    let foulReason = null;
    if (Math.abs(psi) > 90) {
      // released behind the thrower: straight into the cage
      params = { ...params, speed: Math.max(4, speed * 0.28), releaseAngle: 25, heading: 180 + psi * 0.2 };
      foulReason = 'cage';
    }
    const tap = foulReason === 'cage' && s.rot < 120;
    const perfect = !foulReason && Math.abs(psi) <= 4;
    if (perfect) {
      this.flashNow('PERFECT', 'release window', 'good');
      this.haptics.perfect();
    }
    this.launch(params, { foulReason, power: p, psi, inWindow, tap, perfect });
  }

  stepOut() {
    this.flashNow('STEPPED OUT', 'the circle was 2.5 m', 'foul');
    const params = { speed: 3.5, releaseAngle: 55, heading: 180 * 0.5, attitude: this.attitude, wind: this.layout.wind };
    this.launch(params, { foulReason: 'stepout', power: 1, psi: 0, inWindow: false });
  }

  // ------------------------------------------------------------------ flight
  launch(p, meta = {}) {
    if (this.state !== 'ready' && this.state !== 'spin') return;
    const wind = p.wind || {};
    const sane = [p.speed, p.releaseAngle, p.heading, p.attitude, wind.x, wind.z].every(Number.isFinite);
    if (!sane) {
      // never let a bad release value reach the integrator (NaN flight = black screen): cage foul instead
      p = { speed: 4, releaseAngle: 25, heading: 180, attitude: Number.isFinite(this.attitude) ? this.attitude : 25, wind: this.layout.wind };
      meta = { ...meta, foulReason: 'cage', power: 0, psi: 180, inWindow: false };
      this.announcer.say('badRelease', {}, { priority: 3, ms: 3000 });
    }
    this.announcer.clear();
    const f = createFlight(p);
    const rec = {
      params: { ...f.p, coeffs: undefined },
      layout: this.layout,
      tRel: this.tO,
      samples: [],
      events: [],
      n: f.n,
      meta,
      mult: 1,
      hits: [],
      attempt: this.attempt,
    };
    this.cur = { f, rec, acc: 0, steps: 0, landedT: 0, stage: 'air', rng: mulberry32(this.layout.seed + 1) };
    this.pushSample(f, rec);
    this.spin = null;
    this.setState('flight');
    this.dom.hint.classList.add('off');
    // detach the discus from the hand into the world
    this.discus.group.removeFromParent();
    this.scene.add(this.discus.group);
    this.discus.group.rotation.set(0, 0, 0);
    this.glow.visible = true;
    this.shadow.visible = true;
    this.setDiscusPose(f.s, f.n);
    this.thrower.shoulder.rotation.set(0, 0, -0.9);
    this.shake = Math.max(this.shake, this.reducedMotion ? 0 : 0.22);
    this.haptics.release(meta.power ?? 0.6);
    if (meta.tap) this.announcer.say('tap', {}, { priority: 2, ms: 2600 });
    else if (meta.perfect) this.announcer.say('perfect', {}, { priority: 2, ms: 1800 });
    else if (!meta.foulReason) this.announcer.say('release', {}, { priority: 2, ms: 1600 });
    this.updateMultHud();
    // teaching nudge about the wind / nose, after the release line has had a moment
    const hw = -this.layout.wind.x;
    if (!meta.foulReason) {
      if (hw >= 1.5 && this.attempt === 0) this.announcer.say('headwind', {}, { priority: 1, ms: 5200 });
      else if (hw <= -1.2 && this.attempt === 1) this.announcer.say('tailwind', {}, { priority: 1, ms: 5200 });
      else if (this.attitude >= 38) this.announcer.say('stall', {}, { priority: 1, ms: 5200 });
    }
    return rec;
  }

  pushSample(f, rec) {
    const s = f.s;
    rec.samples.push([s.t, s.x, s.y, s.z, s.vx, s.vy, s.vz]);
  }

  setDiscusPose(s, n, spinDt = 0) {
    toThree(s.x, s.y, s.z, this.discus.group.position);
    const n3 = new THREE.Vector3(n[2], n[1], -n[0]);
    this.discus.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n3);
    this.discus.body.rotation.y += spinDt * 18;
    this.shadow.position.set(this.discus.group.position.x, 0.05, this.discus.group.position.z);
    const sc = 1.4 + s.y * 0.04;
    this.shadow.scale.setScalar(sc);
    this.shadow.material.opacity = clamp(0.8 - s.y * 0.035, 0.12, 0.8);
    this.glow.scale.setScalar(1.5 + Math.min(2, s.y * 0.04));
  }

  updateFlight(dt) {
    const c = this.cur;
    const { f, rec } = c;
    if (c.stage === 'air') {
      this.tO = rec.tRel + f.s.t;
      this.obstacles.update(this.tO, dt);
      c.acc += dt;
      let guard = 0;
      while (c.acc >= STEP && !f.landed && guard++ < 2000) {
        c.acc -= STEP;
        this.stepOnce(c);
      }
      this.setDiscusPose(f.s, f.n, dt);
      this.emitTrail(f.s);
      if (f.landed) this.onLanded();
    } else {
      this.tO += dt;
      this.obstacles.update(this.tO, dt);
      this.updateLanded(dt);
    }
  }

  /** One fixed physics step: integrate, record, test obstacles, guard against non-finite state. */
  stepOnce(c) {
    const { f, rec } = c;
    stepFlight(f, STEP);
    c.steps++;
    if (c.steps % REC_EVERY === 0 || f.landed) this.pushSample(f, rec);
    this.checkHits(c);
    if (!Number.isFinite(f.s.x + f.s.y + f.s.z)) Object.assign(f.s, { x: 3, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    if (f.s.t > 20 || f.s.y === 0) f.landed = true;
  }

  /**
   * Press during flight / slow-mo / tape: finish the throw at once. The remaining flight is integrated with the same
   * fixed step, obstacle clock and hit tests as the live path (60 Hz obstacle ticks, 240 Hz physics), so the mark,
   * multiplier and points are what the full-length throw would have produced.
   */
  skipToResult() {
    const c = this.cur;
    if (this.state !== 'flight' || !c || c.done) return false;
    if (c.stage === 'air') {
      if (c.f.s.t < SKIP_GRACE) return false;
      let guard = 0;
      while (!c.f.landed && guard++ < 6000) {
        this.tO = c.rec.tRel + c.f.s.t;
        this.obstacles.update(this.tO, 1 / 60);
        for (let i = 0; i < 4 && !c.f.landed; i++) this.stepOnce(c);
      }
      this.setDiscusPose(c.f.s, c.f.n);
      this.onLanded();
    }
    c.landedT = TAPE_START + TAPE_DUR;
    this.timeScale = 1;
    this.skipUntil = this.clock + 0.45; // swallow the second tap of a double-tap
    this.updateLanded(0);
    return true;
  }

  emitTrail(s) {
    const q = toThree(s.x, s.y, s.z);
    this.particles.emit({ p: [q.x, q.y, q.z], v: [0, 0, 0], color: [1, 0.55, 0.15], size: 0.55, life: 0.9, drag: 0 });
    this.particles.emit({ p: [q.x, q.y, q.z], v: [(Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8], color: [1, 0.95, 0.8], size: 0.22, life: 0.45 });
  }

  checkHits(c) {
    const { f, rec } = c;
    const s = f.s;
    for (const o of this.obstacles.list) {
      if (o.hitAt !== null) continue;
      if (!o.test(s.x, s.y, s.z)) continue;
      const m = o.meta;
      o.onHit(rec.tRel + s.t, s.x, s.y, s.z);
      rec.events.push({ t: s.t, key: o.key, p: [s.x, s.y, s.z] });
      rec.hits.push(o.key);
      rec.mult = Math.min(MULT_CAP, rec.mult * m.mult);
      s.vx *= m.speedMul;
      s.vz *= m.speedMul;
      s.vy = s.vy * 0.6 + m.kick * (0.6 + c.rng() * 0.8);
      s.vx += (c.rng() - 0.5) * m.kick * 0.5;
      s.vz += (c.rng() - 0.5) * m.kick * 0.8;
      if (o.key === 'cart' || o.key === 'vendor') s.y = Math.max(s.y, 0.2);
      this.flashNow(m.label, `MULTIPLIER x${rec.mult.toFixed(2).replace(/\.?0+$/, '')}`, 'good');
      const lineKey = rec.hits.length >= 2 ? 'bonus' : { pigeon: 'pigeon', cart: 'cart', vendor: 'vendor', sprinkler: 'sprinkler', jumbotron: 'jumbo' }[o.key];
      this.announcer.say(lineKey, { m: rec.mult.toFixed(2).replace(/\.?0+$/, '') }, { priority: 3, ms: 3000 });
      this.haptics.hit();
      this.shake = Math.max(this.shake, this.reducedMotion ? 0 : 0.3);
      this.stadium.setExcite(1);
      this.updateMultHud();
    }
  }

  updateMultHud() {
    // multiplier shown in the score chip while airborne
    const r = this.cur && this.cur.rec;
    this.dom.score.textContent = r && r.mult > 1 ? `${this.score} ×${r.mult.toFixed(1)}` : String(this.score);
  }

  // ------------------------------------------------------------------ landing + result
  onLanded() {
    const c = this.cur;
    const { f, rec } = c;
    const s = f.s;
    c.stage = 'landed';
    c.landedT = 0;
    const range = Math.hypot(s.x, s.z);
    const az = Math.atan2(s.z, s.x) / DEG;
    const distance = Math.max(0, range - CIRCLE_RADIUS);
    let foul = false;
    let reason = rec.meta.foulReason || null;
    if (reason) foul = true;
    else if (Math.abs(az) > SECTOR_HALF_ANGLE || s.x < 0) {
      foul = true;
      reason = az < 0 ? 'left' : 'right';
    }
    rec.result = { range, az, distance, foul, reason, landing: { x: s.x, z: s.z }, t: s.t };
    const q = toThree(s.x, 0.06, s.z);
    this.discus.group.position.copy(q);
    this.discus.group.quaternion.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.15, Math.random() * 6, 0));
    this.discus.group.rotation.x = 0;
    this.glow.visible = false;
    this.shadow.visible = false;
    this.particles.burst([q.x, 0.2, q.z], { count: 40, speed: 5, color: [0.55, 0.45, 0.35], size: 0.6, life: 1.1, gravity: 6, up: 3 });
    this.shake = Math.max(this.shake, this.reducedMotion ? 0 : 0.28);
    this.haptics[foul ? 'foul' : 'land']();
    if (foul) {
      this.flashNow('FOUL', { cage: 'THE CAGE WINS', stepout: 'LEFT THE CIRCLE', left: 'LEFT OF THE SECTOR', right: 'RIGHT OF THE SECTOR' }[reason] || '', 'foul');
      const key = { cage: 'cage', stepout: 'stepout', left: 'foulLeft', right: 'foulRight' }[reason];
      this.announcer.say(key, {}, { priority: 3, ms: 3600 });
    } else {
      const rank = rankFor(distance);
      const idx = ['Park & Rec Hopeful', 'Frisbee Fugitive', 'Varsity Walk-On', 'Conference Contender', 'Regional Qualifier', 'Nationals Finalist', 'Olympic Hopeful', 'Diamond League Dangerous', 'World Record Menace'].indexOf(rank.title);
      const edge = Math.abs(az) > SECTOR_HALF_ANGLE - 2;
      // said when the count-up finishes (finishAttempt) so the caption never quotes a mark the card has not reached yet
      rec.rankLine = [edge ? 'sectorEdge' : 'rank' + idx, { d: fmt(distance) }];
      if (distance >= WORLD_RECORD_M) this.flashNow('WORLD RECORD', `${fmt(distance)} m vs real WR ${WORLD_RECORD_M} m`, 'good');
    }
    // post-flight analysis (cheap: ~60 simulations of a few hundred steps)
    const p = { ...rec.params, coeffs: undefined };
    delete p.coeffs;
    const own = simulate(p, { sampleEvery: 1e9 });
    const still = simulate({ ...p, wind: { x: 0, z: 0 } }, { sampleEvery: 1e9 });
    const opt = optimalAttitude(p, { min: -5, max: 45, step: 2 });
    rec.analysis = {
      alphaRelease: own.alphaRelease / DEG,
      airtime: s.t,
      apex: f.apex,
      windEffect: own.range - still.range,
      optAttitude: opt.attitude,
      optGain: opt.range - own.range,
      speed: p.speed,
      releaseAngle: p.releaseAngle,
      attitude: p.attitude,
      hw: -this.layout.wind.x,
    };
    this.stadium.setExcite(foul ? 0.15 : clamp(0.4 + distance / 90, 0.4, 1));
  }

  updateLanded(dt) {
    const c = this.cur;
    c.landedT += dt;
    const rr = c.rec.result;
    const tapeStart = TAPE_START;
    const tapeDur = TAPE_DUR;
    if (c.landedT >= tapeStart) {
      const k = smooth((c.landedT - tapeStart) / tapeDur);
      this.tape.set(rr.range, rr.az, rr.foul ? 1 : k, rr.foul);
      if (!c.shown) {
        c.shown = true;
        this.showResult(c.rec);
      }
      if (!rr.foul) this.dom.resDist.textContent = fmt(rr.distance * k);
      if (!rr.foul) this.dom.resFeet.textContent = formatFeetInches(rr.distance * k);
      if (c.landedT >= tapeStart + tapeDur && !c.done) {
        c.done = true;
        this.finishAttempt(c.rec);
      }
    }
  }

  showResult(rec) {
    const d = this.dom;
    const rr = rec.result;
    const a = rec.analysis;
    d.result.hidden = false;
    d.result.classList.toggle('foul', rr.foul);
    d.resTag.textContent = `THROW ${rec.attempt + 1} OF 3`;
    if (rr.foul) {
      d.resDist.textContent = 'FOUL';
      d.resFeet.textContent = { cage: 'hit the cage', stepout: 'stepped out', left: 'landed left of sector', right: 'landed right of sector' }[rr.reason];
      d.resRank.textContent = 'no mark';
    } else {
      d.resRank.textContent = rankFor(rr.distance).title;
    }
    const mult = rec.mult;
    const pts = rr.foul ? 0 : Math.round(rr.distance * mult);
    rec.points = pts;
    d.resChips.innerHTML = '';
    const chip = (html, cls = '') => {
      const el = document.createElement('span');
      el.className = cls;
      el.innerHTML = html;
      d.resChips.appendChild(el);
    };
    const OBS = { pigeon: 'PIGEON', cart: 'COACH CART', vendor: 'HOT DOG', sprinkler: 'SPRINKLER', jumbotron: 'JUMBOTRON' };
    const MULTS = { pigeon: 1.5, cart: 2.5, vendor: 2, sprinkler: 1.25, jumbotron: 3 };
    rec.hits.forEach((h) => chip(`${OBS[h]} <b>x${MULTS[h]}</b>`));
    if (!rr.foul) chip(`${mult > 1 ? `${rr.distance.toFixed(1)} x ${mult.toFixed(2).replace(/\.?0+$/, '')} = ` : ''}<b>${pts} PTS</b>`, 'total');
    const row = (k, v, cls = '') => `<div><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`;
    const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
    d.resStats.innerHTML =
      row('RELEASE', `${a.speed.toFixed(1)} m/s @ ${a.releaseAngle.toFixed(0)}°`) +
      row('NOSE / AoA', `${a.attitude.toFixed(0)}° / ${a.alphaRelease.toFixed(0)}°`) +
      row('AIRTIME / APEX', `${a.airtime.toFixed(2)} s / ${a.apex.toFixed(1)} m`) +
      (rr.foul ? '' :
        row(a.hw >= 0 ? 'HEADWIND GAIN' : 'TAILWIND COST', `${sign(Math.abs(a.windEffect) < 0.05 ? 0 : a.windEffect)} m`, a.windEffect > -0.05 ? 'up' : 'down') +
        row('COACH SAYS', a.optGain > 0.25 ? `nose ${a.optAttitude.toFixed(0)}° = +${a.optGain.toFixed(1)} m` : 'nose angle: spot on', a.optGain > 0.25 ? 'down' : 'up'));
    let note = '';
    if (a.hw >= 1.5 && !rr.foul) note = `Headwind ${a.hw.toFixed(1)} m/s added ${sign(a.windEffect)} m vs the same release in still air (simulated). Faster air over the disc = more lift.`;
    else if (a.hw <= -1.2 && !rr.foul) note = `Tailwind ${(-a.hw).toFixed(1)} m/s cost ${a.windEffect.toFixed(1)} m vs still air. Less airspeed, less lift.`;
    else if (rec.params.attitude >= 38) note = 'Nose too high: the airflow separated (stall). Try 20-28°.';
    d.resNote.textContent = note;
    d.btnNext.firstChild.textContent = rec.attempt >= 2 ? 'FINAL RESULT ' : 'NEXT THROW ';
    if (this.best && !rr.foul && rr.distance > this.best.distance) this.announcer.say('newBest', {}, { priority: 2, ms: 2200 });
  }

  finishAttempt(rec) {
    const rr = rec.result;
    this.attempts[rec.attempt] = { foul: rr.foul, distance: rr.distance, points: rec.points };
    if (!rr.foul) {
      this.score += rec.points;
      if (!this.best || rr.distance > this.best.distance) this.best = { distance: rr.distance, rec };
    }
    this.updatePips();
    this.updateHudStatic();
    this.setState('result');
    if (rec.rankLine) this.announcer.say(rec.rankLine[0], rec.rankLine[1], { priority: 3, ms: 3800 });
    const res = this.resolvers.splice(0);
    const summary = { distance: rr.distance, foul: rr.foul, reason: rr.reason, mult: rec.mult, points: rec.points, hits: rec.hits, azimuth: rr.az, rank: rr.foul ? null : rankFor(rr.distance).title, analysis: rec.analysis };
    res.forEach((fn) => fn(summary));
  }

  showFinal() {
    const d = this.dom;
    this.setState('final');
    const bestD = this.best ? this.best.distance : 0;
    const rank = this.best ? rankFor(bestD).title : 'Park & Rec Hopeful';
    d.result.hidden = false;
    d.result.classList.remove('foul');
    d.resTag.textContent = 'FINAL';
    d.resRank.textContent = rank;
    d.resDist.textContent = this.best ? fmt(bestD) : '0.00';
    d.resFeet.textContent = this.best ? formatFeetInches(bestD) : 'no legal throws';
    d.resChips.innerHTML = `<span class="total">TOTAL <b>${this.score} PTS</b></span>` + this.attempts.map((a, i) => `<span>T${i + 1} <b>${a.foul ? 'FOUL' : a.distance.toFixed(1) + ' m'}</b></span>`).join('');
    d.resStats.innerHTML = `<div><dt>REAL WR</dt><dd>${WORLD_RECORD_M} m</dd></div><div><dt>YOU</dt><dd>${bestD ? (((bestD / WORLD_RECORD_M) * 100) | 0) + '% of WR' : '0%'}</dd></div>`;
    d.resNote.textContent = 'Real-world reference: 74.35 m, Mykolas Alekna, 2024.';
    d.btnNext.firstChild.textContent = 'PLAY AGAIN ';
    this.announcer.say('final', {}, { priority: 3 });
    this.tape.hide();
  }

  // ------------------------------------------------------------------ replay
  startReplay(rec) {
    if (!rec || !rec.samples.length) return;
    this.prevState = this.state;
    this.announcer.clear();
    this.flashNow(null);
    this.dom.result.hidden = true;
    this.dom.replayTag.hidden = false;
    this.dom.replayInfo.textContent = `BEST THROW • ${fmt(rec.result.distance)} m`;
    this.particles.clear();
    this.debris.clear();
    this.tape.hide();
    this.obstacles.setLayout(rec.layout);
    this.stadium.setWind(rec.layout.wind);
    const first = rec.samples[0];
    this.rt = { rec, t: 0, ev: 0, stage: 'air', landedT: 0 };
    this.discus.group.removeFromParent();
    this.scene.add(this.discus.group);
    this.glow.visible = true;
    this.shadow.visible = true;
    this.thrower.setFacing(rec.params.heading / HEAD_FACTOR);
    this.thrower.shoulder.rotation.set(0, 0, -0.9);
    this.tO = rec.tRel;
    this.setDiscusPose({ x: first[1], y: first[2], z: first[3] }, rec.n);
    this.setState('replay');
    this.timeScale = 1;
  }

  updateReplay(dt) {
    const r = this.rt;
    const rec = r.rec;
    if (r.stage === 'air') {
      r.t += dt;
      const S = rec.samples;
      const last = S[S.length - 1];
      const t = Math.min(r.t, last[0]);
      const idx = Math.min(S.length - 2, Math.floor(t * (240 / REC_EVERY)));
      const a = S[idx];
      const b = S[idx + 1];
      const k = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
      const lerp = (i) => a[i] + (b[i] - a[i]) * k;
      const s = { x: lerp(1), y: lerp(2), z: lerp(3), vx: lerp(4), vy: lerp(5), vz: lerp(6) };
      this.tO = rec.tRel + t;
      this.obstacles.update(this.tO, dt);
      while (r.ev < rec.events.length && rec.events[r.ev].t <= t) {
        const ev = rec.events[r.ev++];
        const o = this.obstacles.list.find((x) => x.key === ev.key);
        if (o) {
          o.hitAt = null;
          o.onHit(rec.tRel + ev.t, ev.p[0], ev.p[1], ev.p[2]);
          this.flashNow(o.meta.label, `x${o.meta.mult}`, 'good');
        }
      }
      this.setDiscusPose(s, rec.n, dt);
      this.emitTrail(s);
      this.replayS = s;
      if (r.t >= last[0]) {
        r.stage = 'landed';
        const q = toThree(s.x, 0.06, s.z);
        this.discus.group.position.copy(q);
        this.glow.visible = false;
        this.shadow.visible = false;
        this.particles.burst([q.x, 0.2, q.z], { count: 30, speed: 5, color: [0.55, 0.45, 0.35], size: 0.6, life: 1, gravity: 6, up: 3 });
      }
    } else {
      r.landedT += dt;
      this.tO += dt;
      this.obstacles.update(this.tO, dt);
      const rr = rec.result;
      this.tape.set(rr.range, rr.az, smooth(r.landedT / 1.4), rr.foul);
      if (r.landedT > 3.4) this.endReplay();
    }
  }

  endReplay() {
    if (this.state !== 'replay') return;
    this.rt = null;
    this.dom.replayTag.hidden = true;
    this.cancelFx();
    this.applyLayout(this.cur && this.cur.rec ? this.cur.rec.layout : this.layout);
    const back = this.prevState === 'howto' ? 'ready' : this.prevState;
    this.timeScale = 1;
    if (back === 'ready') {
      this.setReadyVisuals();
      this.setState('ready');
    } else {
      // restore the last result view
      const c = this.cur;
      this.setState(back);
      if (c && c.rec.result) {
        const rr = c.rec.result;
        const q = toThree(rr.landing.x, 0.06, rr.landing.z);
        this.discus.group.position.copy(q);
        this.glow.visible = false;
        this.shadow.visible = false;
        this.tape.set(rr.range, rr.az, 1, rr.foul);
        this.thrower.setFacing(c.rec.params.heading / HEAD_FACTOR);
        if (back === 'final') this.showFinal();
        else this.showResult(c.rec), (this.dom.resDist.textContent = rr.foul ? 'FOUL' : fmt(rr.distance)), (this.dom.resFeet.textContent = rr.foul ? this.dom.resFeet.textContent : formatFeetInches(rr.distance));
      }
    }
  }

  // ------------------------------------------------------------------ nose gauge + HUD
  updateNose() {
    const d = this.dom;
    d.noseRot.setAttribute('transform', `rotate(${-this.attitude})`);
    d.noseTxt.innerHTML = `${this.attitude.toFixed(0)}&deg;`;
    d.nose.setAttribute('aria-valuenow', this.attitude.toFixed(0));
    const psi = this.state === 'spin' && this.spin ? this.spin.psiVis : 0;
    const rel = releaseAngleOf(psi);
    const aoa = this.attitude - rel;
    const aoaHtml = this.attitude > 32 ? `STALL RISK ${this.attitude.toFixed(0)}&deg;` : `AoA ${aoa >= 0 ? '+' : ''}${aoa.toFixed(0)}&deg;<span class="rel"> @ release</span>`;
    if (d.aoaTxt.dataset.h !== aoaHtml) {
      d.aoaTxt.dataset.h = aoaHtml;
      d.aoaTxt.innerHTML = aoaHtml;
    }
    d.aoaTxt.className = 'num ' + (this.attitude > 32 ? 'warn' : aoa < 2 && aoa > -16 ? 'good' : 'dim');
    if (this.discus.group.parent === this.thrower.hand) this.discus.group.rotation.set(this.attitude * DEG, 0, 0);
  }

  updateHud() {
    const d = this.dom;
    const spin = this.state === 'spin' && this.spin;
    const p = spin ? this.spin.power : 0;
    const showMeters = spin || this.state === 'ready';
    if (spin) {
      d.powerFill.style.width = `${(p * 100).toFixed(0)}%`;
      d.powerFill.className = 'fill' + (this.spin.dizzy > 0.02 ? ' dizzy' : p >= 0.999 ? ' full' : '');
      d.powerTxt.textContent = `${(p * 100).toFixed(0)}%`;
      d.speedTxt.textContent = `${speedOf(p).toFixed(1)} m/s`;
      d.spinTxt.textContent = (this.spin.rot / 360).toFixed(1);
      d.dizzyTxt.hidden = this.spin.dizzy < 0.02;
      d.powerBar.setAttribute('aria-valuenow', (p * 100).toFixed(0));
      const psi = this.spin.psiVis;
      d.needle.setAttribute('transform', `rotate(${psi.toFixed(1)})`);
      const inW = Math.abs(psi) <= WINDOW_HALF;
      d.dialState.textContent = inW ? 'RELEASE!' : 'WAIT';
      d.dialState.className = 'num ' + (inW ? 'in' : 'out');
      this.updateNose();
    } else if (this.state === 'ready') {
      d.powerFill.style.width = '0%';
      d.powerTxt.textContent = '0%';
      d.speedTxt.textContent = `${V_MIN.toFixed(1)} m/s`;
      d.spinTxt.textContent = '0.0';
      d.dizzyTxt.hidden = true;
      d.needle.setAttribute('transform', 'rotate(180)');
      d.dialState.textContent = 'HOLD';
      d.dialState.className = 'num';
    }
    if (!spin && this.state !== 'ready' && this.state !== 'howto') {
      d.dialState.textContent = this.state === 'replay' ? 'REPLAY' : 'AWAY';
      d.dialState.className = 'num';
    }
    void showMeters;
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt) {
    const cam = this.camera;
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    let k = 3.2;
    let fov = this.baseFov;
    let roll = 0;
    const flying = (this.state === 'flight' && this.cur && this.cur.stage === 'air') || (this.state === 'replay' && this.rt && this.rt.stage === 'air');
    const landed = (this.state === 'flight' && this.cur && this.cur.stage === 'landed') || (this.state === 'replay' && this.rt && this.rt.stage === 'landed');
    if (flying) {
      const s = this.state === 'replay' ? this.replayS : this.cur.f.s;
      const pos = toThree(s.x, s.y, s.z);
      const v3 = new THREE.Vector3(s.vz, 0, -s.vx);
      if (v3.lengthSq() > 1e-4) {
        v3.normalize();
        this.hdir.lerp(v3, 1 - Math.exp(-6 * dt)).normalize();
      }
      const side = new THREE.Vector3(-this.hdir.z, 0, this.hdir.x); // right of travel
      const nearGround = s.vy < 0 && s.y < 10 && s.y / Math.max(2, -s.vy) < 1.1;
      if (nearGround) {
        want.copy(pos).addScaledVector(this.hdir, -9).addScaledVector(side, 4.5).setY(Math.max(1.6, s.y * 0.45 + 1.2));
        look.copy(pos).addScaledVector(this.hdir, 5).setY(Math.max(0.5, s.y * 0.6));
        k = 5.5;
        fov = this.baseFov - 8;
      } else {
        want.copy(pos).addScaledVector(this.hdir, -9).addScaledVector(side, 1.6).setY(Math.max(2.4, s.y * 0.5 + 2.8));
        look.copy(pos).addScaledVector(this.hdir, 6);
        k = 5;
      }
    } else if (landed || this.state === 'result') {
      const rec = this.cur && this.cur.rec;
      const rr = rec && rec.result;
      if (rr) {
        const L = Math.max(8, rr.range);
        const dir = new THREE.Vector3(Math.sin(rr.az * DEG), 0, -Math.cos(rr.az * DEG));
        const right = new THREE.Vector3(-dir.z, 0, dir.x);
        const mid = dir.clone().multiplyScalar(L * 0.5);
        if (cam.aspect < 0.9) {
          // portrait: the result sheet owns the bottom ~30% of the screen, so shoot down the tape from behind the
          // circle. The landing mark sits in the upper-middle band, the tape runs up the screen to it.
          want.copy(dir).multiplyScalar(-9).addScaledVector(right, 2.5).setY(L * 0.34 + 5);
          look.copy(dir).multiplyScalar(L * 0.42).setY(0);
        } else {
          want.copy(mid).addScaledVector(right, L * 0.55 + 12).addScaledVector(dir, -L * 0.1).setY(L * 0.3 + 8);
          look.copy(mid).addScaledVector(dir, L * 0.2).setY(0);
          // the result card owns the right edge: slide the picture left so the landing mark stays in the free area
          const f = clamp((this.dom.result.offsetWidth || 340) / Math.max(1, innerWidth), 0.15, 0.5);
          const fwd = look.clone().sub(want).setY(0);
          const dist = fwd.length();
          if (dist > 1e-3) {
            fwd.divideScalar(dist);
            const half = dist * Math.tan((this.baseFov * DEG) / 2) * cam.aspect;
            look.addScaledVector(new THREE.Vector3(-fwd.z, 0, fwd.x), half * f * 1.15);
          }
        }
        k = 2.4;
      }
      if (this.state === 'landed' || (landed && this.cur && this.cur.landedT < 0.45)) {
        // hold the low landing angle briefly, then rise
        const lt = this.cur ? this.cur.landedT : 0;
        if (lt < 0.45) {
          want.set(this.camPos.x, Math.max(1.4, this.camPos.y), this.camPos.z);
          look.copy(this.discus.group.position);
          k = 2;
        }
      }
    } else if (this.state === 'final') {
      const a = this.clock * 0.18;
      want.set(Math.sin(a) * 9, 4.5, Math.cos(a) * 9);
      look.set(0, 1.6, -4);
      k = 2;
    } else {
      // howto / ready / spin: broadcast shot behind-right of the circle, slow drift
      const drift = this.reducedMotion ? 0 : Math.sin(this.clock * 0.2) * 0.6;
      if (cam.aspect < 0.9) {
        want.set(3.2 + drift, 3.0, 10.8);
        look.set(-0.2, 1.3, -7);
      } else {
        want.set(5.4 + drift, 2.75, 9.8);
        look.set(-0.8, 1.45, -10);
      }
      if (this.state === 'spin' && this.spin) {
        const p = this.spin.power;
        want.z -= p * 1.1;
        want.x -= p * 0.8;
        fov -= p * 5;
        roll = (this.spin.dizzy || 0) * 0.12 * Math.sin(this.spin.t * 7);
      }
      k = this.state === 'spin' ? 5 : 2.2;
      if (this.state === 'howto') {
        const a = this.clock * 0.12;
        want.set(Math.sin(a) * 10 + 3, 3.4, Math.cos(a) * 9 + 2);
        look.set(0, 1.6, -9);
        k = 1.2;
      }
    }
    if (![want.x, want.y, want.z, look.x, look.y, look.z].every(Number.isFinite)) {
      want.set(5.4, 2.75, 9.8); // belt and braces: a non-finite target must never reach the camera
      look.set(-0.8, 1.45, -10);
    }
    const f = 1 - Math.exp(-k * dt);
    this.camPos.lerp(want, f);
    this.camLook.lerp(look, 1 - Math.exp(-Math.max(k, 3) * dt));
    cam.position.copy(this.camPos);
    if (this.shake > 0.001 && !this.reducedMotion) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      cam.position.z += (Math.random() - 0.5) * this.shake;
    }
    this.shake *= Math.exp(-5 * dt);
    cam.lookAt(this.camLook);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-5 * dt));
      cam.updateProjectionMatrix();
    }
  }

  targetTimeScale() {
    const slow = this.reducedMotion ? 0.6 : SLOW_SCALE;
    let s = null;
    if (this.state === 'flight' && this.cur && this.cur.stage === 'air') s = this.cur.f.s;
    else if (this.state === 'replay' && this.rt && this.rt.stage === 'air') s = this.replayS;
    if (s && s.vy < 0 && s.y < 8 && s.y / Math.max(2, -s.vy) < 0.26 && s.y > 0) return slow;
    if (this.state === 'flight' && this.cur && this.cur.stage === 'landed' && this.cur.landedT < 0.2) return slow;
    return 1;
  }

  // ------------------------------------------------------------------ main loop
  /** Advance the whole game by `dtReal` seconds (also used by the deterministic debug stepper). */
  update(dtReal) {
    const dt = Math.min(dtReal, 0.1);
    this.clock += dt;
    this.input.poll(dt);
    const target = this.targetTimeScale();
    this.timeScale += (target - this.timeScale) * (1 - Math.exp(-10 * dt));
    const sdt = dt * this.timeScale;

    if (this.state === 'spin') {
      this.updateSpin(sdt);
      this.tO += sdt;
      this.obstacles.update(this.tO, sdt);
    } else if (this.state === 'flight') this.updateFlight(sdt);
    else if (this.state === 'replay') this.updateReplay(sdt);
    else {
      this.tO += sdt;
      this.obstacles.update(this.tO, sdt);
    }
    if (this.state === 'ready' || this.state === 'howto') {
      this.thrower.group.rotation.y += 0; // idle: stays facing the camera side
      this.stadium.setExcite(0.3 + 0.1 * Math.sin(this.clock));
    }
    this.particles.update(sdt);
    this.debris.update(sdt);
    this.stadium.update(this.clock);
    this.announcer.update();
    this.updateHud();
    this.updateCamera(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Adaptive resolution: if we stay slow for ~1 s, drop the pixel ratio a notch (never below 1). */
  adapt(dtReal) {
    if (dtReal > 0.026) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 50 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.slowFrames = 0;
      this.resize();
    }
  }

  start() {
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      if (this.manual || document.hidden) {
        this.last = now;
        return;
      }
      const dtReal = (now - this.last) / 1000;
      this.last = now;
      this.update(dtReal);
      this.render();
      this.adapt(dtReal);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ debug hooks
  waitResult() {
    return new Promise((res) => this.resolvers.push(res));
  }

  /** Programmatic throw using the exact same pipeline as a human release. */
  debugThrow(p = {}) {
    if (this.state === 'howto') this.closeHowTo(true);
    for (let i = 0; i < 2 && (this.state === 'result' || this.state === 'final'); i++) this.next();
    if (this.state !== 'ready') return Promise.reject(new Error('not ready: ' + this.state));
    if (p.seed !== undefined || p.wind) {
      const l = makeLayout(p.seed ?? this.layout.seed);
      if (p.wind) l.wind = { x: p.wind.x ?? l.wind.x, z: p.wind.z ?? l.wind.z };
      this.applyLayout(l);
    }
    if (p.attitude !== undefined) {
      this.attitude = clamp(p.attitude, NOSE_MIN, NOSE_MAX);
      this.updateNose();
    }
    const psi = p.psi ?? 0;
    const power = p.power ?? 0.9;
    const params = {
      speed: p.speed ?? speedOf(power),
      releaseAngle: p.releaseAngle ?? releaseAngleOf(psi),
      heading: p.heading ?? psi * HEAD_FACTOR,
      attitude: this.attitude,
      wind: this.layout.wind,
    };
    this.thrower.setFacing(psi);
    const promise = this.waitResult();
    this.launch(params, { power, psi, inWindow: Math.abs(psi) <= WINDOW_HALF });
    return promise;
  }

  /** Manual stepping for deterministic captures: advance `sec` seconds in `step` slices, render once. */
  advance(sec, { step = 1 / 60, render = true } = {}) {
    this.manual = true;
    let t = 0;
    while (t < sec - 1e-9) {
      const d = Math.min(step, sec - t);
      this.update(d);
      t += d;
    }
    if (render) this.render();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.stadium.dispose();
    this.particles.dispose();
    this.debris.dispose();
    this.obstacles.dispose();
    this.thrower.dispose();
    this.discus.dispose();
    this.tape.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
  }
}
