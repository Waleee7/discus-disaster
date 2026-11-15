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
import { buildDiscus, buildThrower, buildTape, buildBlobShadow, buildRivalMarker } from './actors.js';
import { Particles, Debris, disposeTree } from './fx.js';
import { buildObstacles, makeLayout } from './obstacles.js';
import { setArtWeather, setArtQuality } from './cards.js';
import { pickTier, singlePassTransparent } from './scenery/util.js';
import { Announcer, rankFor } from './announcer.js';
import { Haptics } from './haptics.js';
import { Input } from './input.js';
import { STEPOUT_TURNS, powerOf, speedOf, releaseAngleOf } from './tuning.js';
import { MODES, modeOf, powerFor, releaseParams, assistTarget, chargeProfile, overchargeOf, effectiveWindow, wobbleOf, previewFlight, HEAD_FACTOR_PRO, NOSE_MIN, NOSE_MAX } from './modes.js';
import { TECHNIQUES, techniqueOf, isTechnique, DEFAULT_TECHNIQUE } from './techniques.js';
import { presetOf, nextPreset, isPreset, DEFAULT_PRESET, clearCamera } from './camera.js';
import { WEATHERS, WEATHER_CHOICES, weatherOf, isWeatherChoice, resolveWeather, dailyWeather } from './weather.js';
import { VENUES, venueOf, isVenue, nextVenue, DEFAULT_VENUE } from './venues.js';
import { PERSONAS, personaOf, personaIndex, rivalOf, rivalMark } from './personas.js';
import { Leaderboard, ALL_TIME, dailyBoardId, dateKey, dailyLayoutSeed, dailySeed, shareText } from './leaderboard.js';
import { store } from './storage.js';

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
const HEAD_FACTOR = HEAD_FACTOR_PRO; // pro: dial angle -> throw heading (window edge == sector edge)
const OVERLAYS = ['start', 'help', 'board', 'initials', 'tech']; // states that are a modal screen over the stadium
const UNDER = ['help', 'board', 'initials']; // overlays that sit on top of whatever state was current
const DEMO_LOOP = 4.8; // technique demo loop (seconds)
const MULT_CAP = 9;

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
    this.state = 'start';
    this.prevState = 'ready';
    this.under = 'ready'; // the state beneath a help / board / initials overlay
    this.modeId = store.get('dd-mode') === 'pro' ? 'pro' : 'rookie';
    this.mode = modeOf(this.modeId);
    this.personaId = personaOf(store.get('dd-char')).id;
    this.camId = isPreset(store.get('dd-cam')) ? store.get('dd-cam') : DEFAULT_PRESET;
    this.techId = isTechnique(store.get('dd-tech')) ? store.get('dd-tech') : DEFAULT_TECHNIQUE;
    this.tech = techniqueOf(this.techId);
    this.venueId = isVenue(store.get('dd-venue')) ? store.get('dd-venue') : DEFAULT_VENUE;
    this.weatherChoice = isWeatherChoice(store.get('dd-wx')) ? store.get('dd-wx') : 'clear';
    this.weatherId = resolveWeather(this.weatherChoice);
    this.stadiums = {};
    this.camBlend = 0; // seconds of extra-gentle camera motion after switching presets
    this.toastUntil = 0;
    this.demo = null; // technique-picker demo loop state
    this.flights = {}; // cached still-air flights per technique (picker sketches + demo disc)
    this.daily = false;
    this.dKey = dateKey();
    this.runKey = null; // mode of the run in progress (null = no run yet)
    this.windowHalf = effectiveWindow(this.mode, 0, 0, this.tech, this.weatherId);
    this.dialDrawn = -1;
    this.noseManual = false;
    this.noseDrag = 0;
    this.assistAtt = 25;
    this.board = new Leaderboard();
    this.pending = null; // { at, ... } initials prompt scheduled on the game clock
    this.ini = { letters: [0, 0, 0], slot: 0 };
    this.finalInfo = null;
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
    // one quality tier for the whole session (viewport + device hints, or ?q=low|mid|high): art, stadium and post agree
    this.tier = pickTier(innerWidth, innerHeight);
    setArtQuality(this.tier.name);
    // per-frame scratch (the camera and the discus run every frame: no garbage)
    this._tq = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._focus = new THREE.Vector3();
    this._n3 = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
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

    this.stadium = this.getStadium(this.venueId);
    this.particles = new Particles(this.scene);
    this.debris = new Debris(this.scene);
    this.obstacles = buildObstacles(this.scene, { particles: this.particles, debris: this.debris });
    this.obstacles.setCamera(this.camera);
    this.thrower = buildThrower(personaOf(this.personaId));
    this.thrower.setStyle(this.tech.pose);
    this.scene.add(this.thrower.group);
    this.markCasters();
    this.rival = buildRivalMarker();
    this.scene.add(this.rival.group);
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
      windWx: $('windWx'),
      powerFill: $('powerFill'),
      powerBar: $('powerBar'),
      powerTxt: $('powerTxt'),
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
      btnReplay2: $('btnReplay2'),
      resCoach: $('resCoach'),
      btnShare: $('btnShare'),
      dial: document.querySelector('.dial'),
      attemptLbl: $('attemptLbl'),
      noseLbl: $('noseLbl'),
      start: $('start'),
      help: $('help'),
      initials: $('initials'),
      boardEl: $('board'),
      boardList: $('boardList'),
      boardSub: $('boardSub'),
      btnVoice: $('btnVoice'),
      btnHaptics: $('btnHaptics'),
      replayTag: $('replayTag'),
      replayInfo: $('replayInfo'),
      btnCam: $('btnCam'),
      camName: $('camName'),
      camToast: $('camToast'),
      btnTech: $('btnTech'),
      techName: $('techName'),
      techDot: $('techDot'),
      btnSwap: $('btnSwap'),
      tech: $('tech'),
      techList: $('techList'),
      techInfo: $('techInfo'),
      powerState: $('powerState'),
      zoneSweet: $('zoneSweet'),
      zoneOver: $('zoneOver'),
    };
    $('dialSector').setAttribute('d', 'M0 -54 L0 -40');
    this.setDial();

    this.announcer = new Announcer({ root: $('lt'), textEl: $('ltText'), tagEl: $('ltTag') });
    this.input = new Input(canvas.parentElement, {
      press: () => this.onPress(),
      release: () => this.onRelease(),
      nose: (d) => this.adjustNose(d),
      action: (a, data) => this.onAction(a, data),
    });
    this.haptics = new Haptics(() => this.input.pad);
    this.bindButtons();

    this.layout = makeLayout(this.seedBase, this.weatherId);
    this.applyLayout(this.layout);
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      if (document.hidden && this.announcer.supportsSpeech) speechSynthesis.cancel();
    });
    this.updatePips();
    this.updateNose();
    this.setReadyVisuals();
    this.updateHudStatic();
    this.buildTechList();
    this.applyModeUi();
    this.applyCamUi();
    this.applyTechUi();
    this.updateSetupUi();
    this.applyWeather(false);
    this.updateCarousel();
    this.updateRival();
    singlePassTransparent(this.scene);
    this.openStart(true);
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
    click($('btnMenu'), () => this.onAction('menu'));
    click($('btnHelp'), () => this.onAction('help'));
    click($('btnHelpOk'), () => this.closeHelp());
    click(d.btnNext, () => this.onAction('next'));
    click(d.btnDetails, () => this.setDetails(!d.result.classList.contains('open')));
    click($('btnStart'), () => this.closeStart());
    click($('charPrev'), () => this.cycleCharacter(-1));
    click($('charNext'), () => this.cycleCharacter(1));
    click($('modeRookie'), () => this.setMode('rookie'));
    click($('modePro'), () => this.setMode('pro'));
    click(d.btnCam, () => this.onAction('camera'));
    click(d.btnTech, () => this.onAction('technique'));
    click(d.btnSwap, () => this.onAction('player'));
    click($('techDone'), () => this.closeTech());
    click($('btnVenue'), () => this.setVenue(nextVenue(this.venueId)));
    click($('btnWeather'), () => this.setWeatherChoice(WEATHER_CHOICES[(WEATHER_CHOICES.indexOf(this.weatherChoice) + 1) % WEATHER_CHOICES.length]));
    click($('techPrev'), () => this.cycleCharacter(-1));
    click($('techNext'), () => this.cycleCharacter(1));
    click($('btnBoard'), () => this.openBoard(ALL_TIME));
    click($('btnBoard2'), () => this.openBoard(this.daily ? 'daily' : ALL_TIME));
    click($('btnShare'), () => this.shareResult());
    click($('tabAll'), () => this.showBoardTab(ALL_TIME));
    click($('tabDaily'), () => this.showBoardTab('daily'));
    click($('btnBoardClose'), () => this.closeBoard());
    click($('btnPlayDaily'), () => this.playDaily());
    click($('iniOk'), () => this.saveInitials());
    click($('iniSkip'), () => this.skipInitials());
    d.initials.querySelectorAll('.wheel').forEach((w, i) => {
      click(w.querySelector('.up'), () => this.bumpLetter(i, 1));
      click(w.querySelector('.down'), () => this.bumpLetter(i, -1));
    });
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
    this.rival.setScale(w / h < 0.9 ? 1.2 : 1);
  }

  applyLayout(l) {
    this.layout = l;
    this.obstacles.setLayout(l);
    this.stadium.setWind(l.wind, l.gust);
    const hw = -l.wind.x;
    const d = this.dom;
    const wxp = weatherOf(l.weather);
    d.windWx.innerHTML = `<span aria-hidden="true">${wxp.icon}</span> <span class="wxn">${wxp.short}</span> ${Math.round(l.temp ?? wxp.temp)}\u00b0C${wxp.gust >= 0.3 ? '<span class="wxn"> \u00b7 GUSTS</span>' : ''}`;
    d.windWx.title = `${wxp.name}, ${Math.round(l.temp ?? wxp.temp)}\u00b0C${wxp.gust >= 0.3 ? ', gusty' : ''}`;
    d.windKind.textContent = hw >= 0 ? 'HEADWIND' : 'TAILWIND';
    d.windKind.className = 'kind ' + (hw >= 0 ? 'head' : 'tail');
    d.windVal.textContent = `${Math.abs(hw).toFixed(1)} m/s`;
    d.windCross.textContent = `CROSS ${Math.abs(l.wind.z).toFixed(1)} ${l.wind.z >= 0 ? '→' : '←'}`;
    d.windArrow.querySelector('.arrow').style.transform = `rotate(${Math.atan2(l.wind.z, l.wind.x) / DEG}deg)`;
    // Rookie nose assist: the nose angle the auto-nose will ease toward for this wind (a typical good release)
    this.updateAssist();
  }

  updateAssist() {
    this.assistAtt = assistTarget(this.mode, this.tech, this.layout.wind);
  }

  setState(s) {
    this.state = s;
    document.body.dataset.state = s;
    document.body.classList.toggle('hint-on', s === 'ready');
    this.dom.hint.classList.toggle('off', s !== 'ready');
    this.rival.group.visible = s !== 'start' && this.rivalSet;
  }

  /** The stadium state the camera / HUD should show: the one beneath a help / board / initials overlay. */
  viewState() {
    return UNDER.includes(this.state) ? this.under : this.state;
  }

  // ------------------------------------------------------------------ mode, characters, rival
  setDial() {
    const w = this.windowHalf;
    this.dialDrawn = w;
    const r = 54;
    const p = (a) => `${(r * Math.sin(a * DEG)).toFixed(2)} ${(-r * Math.cos(a * DEG)).toFixed(2)}`;
    $('dialWindow').setAttribute('d', `M0 0 L${p(-w)} A${r} ${r} 0 0 1 ${p(w)} Z`);
  }

  applyModeUi() {
    document.body.dataset.mode = this.modeId;
    document.body.dataset.nose = this.noseManual || !this.mode.noseAssist ? 'manual' : 'auto';
    $('modeRookie').setAttribute('aria-checked', String(this.modeId === 'rookie'));
    $('modePro').setAttribute('aria-checked', String(this.modeId === 'pro'));
    $('modeBlurb').textContent = this.mode.blurb;
    this.dom.noseLbl.textContent = this.mode.noseAssist && !this.noseManual ? 'NOSE · AUTO' : 'NOSE ANGLE';
    this.windowHalf = effectiveWindow(this.mode, this.attempt, 0, this.tech, this.weatherId);
    this.setDial();
    this.updateZones();
  }

  /** Charge meter zones for this mode + technique: SWEET (green bracket) and OVERCHARGE (red hatch), as % of the bar. */
  updateZones() {
    const pr = chargeProfile(this.mode, this.tech);
    this.dom.zoneSweet.style.left = `${((pr.sweetFrom / pr.stepOut) * 100).toFixed(1)}%`;
    this.dom.zoneSweet.style.width = `${(((pr.sweetTo - pr.sweetFrom) / pr.stepOut) * 100).toFixed(1)}%`;
    this.dom.zoneOver.style.left = `${((pr.overFrom / pr.stepOut) * 100).toFixed(1)}%`;
    this.dom.zoneOver.style.right = '0';
  }

  setMode(id) {
    if (!MODES[id] || id === this.modeId) return;
    this.modeId = id;
    this.mode = MODES[id];
    store.set('dd-mode', id);
    this.noseManual = false;
    this.noseDrag = 0;
    this.attitude = id === 'pro' ? 25 : this.attitude;
    this.applyModeUi();
    this.applyLayout(this.layout);
    this.updateNose();
    this.updateRival();
  }

  // ------------------------------------------------------------------ venue + weather
  /** Build a venue on first use (cached), so switching back and forth is instant after the first time. */
  getStadium(id) {
    if (!this.stadiums[id]) {
      const st = buildStadium(this.scene, { reducedMotion: this.reducedMotion, venue: id, renderer: this.renderer, quality: this.tier.name });
      st.setWeather(weatherOf(this.weatherId));
      this.stadiums[id] = st;
    }
    return this.stadiums[id];
  }

  markCasters() {
    for (const st of Object.values(this.stadiums)) st.addCaster(this.thrower.group);
  }

  setVenue(id) {
    if (!isVenue(id)) return;
    store.set('dd-venue', id);
    const next = this.getStadium(id);
    if (this.stadium && this.stadium !== next) this.stadium.deactivate();
    this.stadium = next;
    this.venueId = id;
    next.activate();
    this.markCasters();
    next.setWeather(weatherOf(this.weatherId));
    next.setWind(this.layout.wind, this.layout.gust);
    this.updateSetupUi();
  }

  setWeatherChoice(choice) {
    if (!isWeatherChoice(choice)) return;
    this.weatherChoice = choice;
    store.set('dd-wx', choice);
    this.weatherId = resolveWeather(choice);
    this.runKey = null; // a different sky is a different run: PLAY starts fresh instead of resuming
    this.applyWeather(true);
    this.updateSetupUi();
  }

  /** Show the current weather (fog, sky, rain, sun) and, optionally, re-roll this throw's wind for it. */
  applyWeather(relayout = true) {
    this.stadium.setWeather(weatherOf(this.weatherId));
    setArtWeather(this.weatherId);
    if (relayout) this.applyLayout(makeLayout(this.layout.seed, this.weatherId));
    this.applyModeUi();
  }

  updateSetupUi() {
    $('venueName').textContent = venueOf(this.venueId).short;
    $('btnVenue').setAttribute('aria-label', `Venue: ${venueOf(this.venueId).name}. Press to change`);
    const w = this.weatherChoice === 'random' ? 'RANDOM' : weatherOf(this.weatherChoice).name.toUpperCase();
    $('weatherName').textContent = w;
    $('btnWeather').setAttribute('aria-label', `Weather: ${w.toLowerCase()}. Press to change`);
    document.body.dataset.venue = this.venueId;
    document.body.dataset.weather = this.weatherId;
  }

  // ------------------------------------------------------------------ technique, camera, athlete swap
  setTechnique(id) {
    if (!isTechnique(id)) return;
    this.techId = id;
    this.tech = techniqueOf(id);
    store.set('dd-tech', id);
    this.thrower.setStyle(this.tech.pose);
    this.applyModeUi();
    this.updateAssist();
    this.applyTechUi();
    if (this.demo) this.demo = { t: 0 };
  }

  applyTechUi() {
    const t = this.tech;
    this.dom.techName.textContent = t.name.toUpperCase();
    this.dom.btnTech.setAttribute('aria-label', `Throwing technique: ${t.name}`);
    this.dom.techList.querySelectorAll('.tc').forEach((b) => {
      const on = b.dataset.id === t.id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const pct = (v) => `${v >= 1 ? '+' : '\u2212'}${Math.abs(Math.round((v - 1) * 100))}%`;
    const deg = (v) => `${v >= 0 ? '+' : '\u2212'}${Math.abs(v)}\u00b0`;
    const bits = [];
    if (t.speed !== 1) bits.push(`SPEED ${pct(t.speed)}`);
    if (t.angle) bits.push(`RELEASE ANGLE ${deg(t.angle)}`);
    if (t.nose) bits.push(`NOSE ${deg(t.nose)}`);
    if (t.window !== 1) bits.push(`GREEN WINDOW ${pct(t.window)}`);
    if (t.turns !== 1) bits.push(`TURNS TO FULL POWER ${pct(t.turns)}`);
    this.dom.techInfo.innerHTML = `<span><b class="up">${t.up}</b>${t.down ? ` <b class="dn">${t.down}</b>` : ''} &nbsp;${t.blurb}</span><span class="num">${bits.join(' \u00b7 ') || 'NO BONUS, NO PENALTY'}</span>`;
  }

  /** Cached still-air flight of a perfect release with a technique (Pro mapping, so the sketches compare like for like). */
  flightOf(t) {
    return (this.flights[t.id] = this.flights[t.id] || previewFlight(MODES.pro, t));
  }

  buildTechList() {
    const list = this.dom.techList;
    list.innerHTML = '';
    const SX = 92 / 72;
    const SY = 38 / 17;
    TECHNIQUES.forEach((t) => {
      const fl = this.flightOf(t);
      const pts = [];
      for (const s of fl.samples) {
        const x = 2 + s[1] * SX;
        if (x > 94) break;
        pts.push([x, Math.min(44, 44 - s[2] * SY)]);
      }
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      let apex = pts[0];
      for (const q of pts) if (q[1] < apex[1]) apex = q;
      const dot = this.reducedMotion
        ? `<circle class="dot" r="2.6" cx="${apex[0].toFixed(1)}" cy="${apex[1].toFixed(1)}"/>`
        : `<circle class="dot" r="2.6"><animateMotion dur="2.4s" repeatCount="indefinite" path="${d}"/></circle>`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tc';
      b.setAttribute('role', 'radio');
      b.dataset.id = t.id;
      b.innerHTML = `<span class="tc-name">${t.name.toUpperCase()}</span><span class="tc-tags"><i class="up">${t.up}</i>${t.down ? `<i class="dn">${t.down}</i>` : ''}</span><svg class="tc-arc" viewBox="0 0 96 46" aria-hidden="true"><line class="ground" x1="2" y1="44.5" x2="94" y2="44.5"/><path class="path" d="${d}"/>${dot}</svg>`;
      b.addEventListener('click', () => this.setTechnique(t.id));
      list.appendChild(b);
    });
  }

  openTech() {
    if (this.state !== 'ready') return;
    this.under = 'ready';
    this.prevState = 'ready';
    this.announcer.clear();
    this.dom.tech.hidden = false;
    this.setState('tech');
    this.demo = { t: 0 };
    this.camSnap = 0;
    const on = this.dom.techList.querySelector('.tc[aria-checked="true"]');
    if (on) on.focus({ preventScroll: true });
  }

  closeTech() {
    if (this.state !== 'tech') return;
    this.dom.tech.hidden = true;
    this.demo = null;
    this.dom.techDot.hidden = true;
    store.set('dd-tech-seen', '1');
    this.setState('ready');
    this.setReadyVisuals();
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
  }

  /** One loop of the selected technique, performed by the in-game athlete in the circle (the camera frames it beside the card). */
  updateDemo(dt) {
    const d = this.demo || (this.demo = { t: 0 });
    d.t += dt;
    const t = d.t % DEMO_LOOP;
    const tech = this.tech;
    const th = this.thrower;
    const T0 = 0.5;
    const T1 = tech.demoTurn > 200 ? 3.0 : 1.5;
    const k = (t - T1) / 0.95;
    if (t < T0) {
      th.setFacing(180);
      th.idle(this.clock);
      this.demoDiscus(true);
    } else if (t < T1) {
      const u = (t - T0) / (T1 - T0);
      const rot = tech.demoTurn * Math.pow(u, 1.5);
      th.setFacing(180 - rot);
      th.spin(rot, 0.3 + 0.7 * u);
      this.demoDiscus(true);
    } else {
      th.setFacing(180 - tech.demoTurn);
      th.release(Math.min(1, k));
      this.demoDiscus(false, t - T1);
    }
  }

  /** Keep the disc in the hand, or (after the release) fly it down the technique's real still-air trajectory, time-stretched. */
  demoDiscus(inHand, since = 0) {
    const dg = this.discus.group;
    if (inHand) {
      if (dg.parent !== this.thrower.hand) {
        dg.removeFromParent();
        this.thrower.hand.add(dg);
      }
      dg.visible = true;
      dg.position.set(0, 0, 0);
      dg.quaternion.identity();
      dg.rotation.set(this.attitude * DEG, 0, 0);
      this.glow.visible = false;
      this.demoStart = null;
      return;
    }
    if (dg.parent === this.thrower.hand) {
      this.demoStart = this.thrower.hand.getWorldPosition(new THREE.Vector3());
      dg.removeFromParent();
      this.scene.add(dg);
    }
    const S = this.flightOf(this.tech).samples; // 20 Hz samples [t, x, y, z, ...]; played 2.2x slower than real
    const fi = since * 2.2 * 20;
    const i = Math.min(S.length - 2, Math.floor(fi));
    const f = clamp(fi - i, 0, 1);
    const L = (j) => S[i][j] + (S[i + 1][j] - S[i][j]) * f - S[0][j];
    const o = this.demoStart || new THREE.Vector3();
    const q = toThree(L(1), L(2), L(3));
    dg.position.set(o.x + q.x, o.y + q.y, o.z + q.z);
    dg.rotation.set(0.3, 0, 0);
    this.discus.body.rotation.y += 0.5;
    dg.visible = fi < S.length - 2 && since < 1.7;
  }

  setCamera(id) {
    if (!isPreset(id)) return;
    const changed = id !== this.camId;
    this.camId = id;
    store.set('dd-cam', id);
    this.applyCamUi();
    if (changed) {
      this.camBlend = 1.2;
      if (this.reducedMotion) this.camSnap = 2; // reduced motion: cut to the new view instead of gliding
      this.toast(presetOf(id).name);
    }
  }

  cycleCamera(dir = 1) {
    this.setCamera(nextPreset(this.camId, dir));
  }

  applyCamUi() {
    const p = presetOf(this.camId);
    this.dom.camName.textContent = p.name;
    this.dom.btnCam.setAttribute('aria-label', `Camera: ${p.name}. Press to change view`);
    this.dom.btnCam.title = `Camera: ${p.name} (C)`;
    document.body.dataset.cam = p.id;
  }

  toast(text) {
    this.dom.camToast.textContent = text;
    this.toastUntil = this.clock + 1.6;
  }

  /** Swap the athlete between throws (result card, ready, or the technique picker); the rival flag follows. */
  swapAthlete() {
    if (!['ready', 'result', 'tech'].includes(this.state)) return;
    this.cycleCharacter(1);
    if (this.state === 'result') this.refreshResult();
    if (this.state === 'tech') return;
    const p = personaOf(this.personaId);
    this.announcer.show(`${p.name} steps in. Beat the ${this.rivalInfo.name} flag: ${this.rivalInfo.mark.toFixed(1)} m.`, p.name, 2, 3400);
  }

  /** Re-render the result card for the same throw (the rival chip depends on the athlete). */
  refreshResult() {
    const c = this.cur;
    if (!c || !c.rec.result) return;
    const rr = c.rec.result;
    this.showResult(c.rec);
    this.dom.resDist.textContent = rr.foul ? 'FOUL' : fmt(rr.distance);
    if (!rr.foul) this.dom.resFeet.textContent = formatFeetInches(rr.distance);
  }

  setPersona(id) {
    const p = personaOf(id);
    this.personaId = p.id;
    store.set('dd-char', p.id);
    const old = this.thrower;
    const inHand = this.discus.group.parent === old.hand;
    old.group.removeFromParent();
    if (inHand) this.discus.group.removeFromParent(); // the discus is shared: never dispose it with the old athlete
    old.dispose();
    this.thrower = buildThrower(p);
    this.thrower.setStyle(this.tech.pose);
    this.scene.add(this.thrower.group);
    this.markCasters();
    if (inHand) {
      this.thrower.hand.add(this.discus.group);
      this.discus.group.position.set(0, 0, 0);
      this.discus.group.quaternion.identity();
      this.discus.group.rotation.set(this.attitude * DEG, 0, 0);
    }
    this.thrower.setFacing(180);
    this.thrower.idle(this.clock);
    if (this.state === 'result' || this.state === 'final') this.restoreThrower(this.state);
    this.updateCarousel();
    this.updateRival();
  }

  cycleCharacter(dir) {
    const n = PERSONAS.length;
    this.setPersona(PERSONAS[(personaIndex(this.personaId) + dir + n) % n].id);
  }

  updateCarousel() {
    const p = personaOf(this.personaId);
    $('charName').textContent = p.name;
    $('charRoleTxt').textContent = p.role.toUpperCase();
    $('charCount').textContent = `${personaIndex(p.id) + 1}/${PERSONAS.length}`;
    $('charBlurb').textContent = p.blurb;
    $('charSwatch').style.background = p.css;
    this.dom.start.style.setProperty('--char', p.css);
    $('techAth').textContent = p.name;
    this.dom.tech.firstElementChild.style.setProperty('--char', p.css);
  }

  /** The "beat the rival" flag: the next athlete round the carousel, at their best mark for this mode. */
  updateRival() {
    const r = rivalOf(this.personaId);
    this.rivalInfo = { name: r.name, mark: rivalMark(r, this.modeId, this.daily ? dailySeed(this.dKey) : null) };
    this.rival.set({ mark: this.rivalInfo.mark, az: r.rival.az, color: r.colors.jersey, label: r.name });
    this.rivalSet = true;
    this.rival.group.visible = this.state !== 'start';
  }

  // ------------------------------------------------------------------ input handlers
  onPress() {
    switch (this.state) {
      case 'start':
        this.closeStart();
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
      case 'initials':
        this.saveInitials();
        break;
      case 'tech':
        this.closeTech();
        break;
      default:
    }
  }

  onRelease() {
    if (this.state === 'spin') this.doRelease();
  }

  adjustNose(d) {
    if (this.state !== 'ready' && this.state !== 'spin' && this.state !== 'result') return;
    if (this.mode.noseAssist && !this.noseManual) {
      // Rookie: finger jitter while holding must not switch the assist off; a deliberate drag (~4 deg) does
      this.noseDrag += Math.abs(d);
      if (this.noseDrag < 4) return;
      this.noseManual = true;
      document.body.dataset.nose = 'manual';
      this.dom.noseLbl.textContent = 'NOSE ANGLE';
    }
    this.attitude = clamp(this.attitude + d, NOSE_MIN, NOSE_MAX);
    this.updateNose();
  }

  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const st = this.state;
    if (st === 'start' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      this.cycleCharacter(e.code === 'ArrowLeft' ? -1 : 1);
      e.preventDefault();
    } else if (st === 'tech' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
      const i = TECHNIQUES.findIndex((t) => t.id === this.techId);
      const n = TECHNIQUES.length;
      this.setTechnique(TECHNIQUES[(i + (e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 1) + n) % n].id);
      const on = this.dom.techList.querySelector('.tc[aria-checked="true"]');
      if (on) on.focus({ preventScroll: true });
      e.preventDefault();
    } else if (st === 'board' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      this.showBoardTab(this.boardTab === ALL_TIME ? 'daily' : ALL_TIME);
      e.preventDefault();
    } else if (st === 'initials') {
      const i = this.ini;
      if (e.code === 'ArrowUp') this.bumpLetter(i.slot, 1);
      else if (e.code === 'ArrowDown') this.bumpLetter(i.slot, -1);
      else if (e.code === 'ArrowLeft') this.setSlot(i.slot - 1);
      else if (e.code === 'ArrowRight') this.setSlot(i.slot + 1);
      else if (e.code === 'Backspace') this.setSlot(i.slot - 1);
      else if (/^Key[A-Z]$/.test(e.code) && !e.repeat) {
        i.letters[i.slot] = e.code.charCodeAt(3) - 65;
        this.setSlot(Math.min(2, i.slot + 1));
        this.renderInitials();
      } else return;
      e.preventDefault();
    }
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
        if (this.best && ['ready', 'result'].includes(this.state)) this.startReplay(this.best.rec);
        else if (this.state === 'replay') this.endReplay();
        break;
      case 'camera':
        if (['ready', 'spin', 'flight', 'replay'].includes(this.state)) this.cycleCamera();
        break;
      case 'technique':
        if (this.state === 'ready') this.openTech();
        else if (this.state === 'tech') this.closeTech();
        break;
      case 'player':
        this.swapAthlete();
        break;
      case 'next':
        if (this.state === 'result' || this.state === 'final') this.next();
        else if (this.state === 'start') this.closeStart();
        break;
      case 'menu':
        if (['ready', 'result', 'final'].includes(this.state)) this.openStart();
        else if (this.state === 'start' && this.runKey) this.closeStart();
        break;
      case 'help':
        if (this.state === 'help') this.closeHelp();
        else if (['start', 'ready', 'result', 'final'].includes(this.state)) this.openHelp();
        break;
      case 'close':
        if (this.state === 'help') this.closeHelp();
        else if (this.state === 'board') this.closeBoard();
        else if (this.state === 'initials') this.skipInitials();
        else if (this.state === 'replay') this.endReplay();
        else if (this.state === 'tech') this.closeTech();
        else if (this.state === 'start' && this.runKey) this.closeStart();
        else if (['ready', 'result', 'final'].includes(this.state)) this.openStart();
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

  // ------------------------------------------------------------------ start screen, help
  /** Show the start screen (also the MENU). `first` = page load: nothing to resume. */
  openStart(first = false) {
    if (!first) {
      this.prevState = this.state;
      this.menuMode = this.modeId;
    }
    this.pending = null;
    this.camSnap = first ? 3 : 0;
    this.dom.start.hidden = false;
    $('dailyDot').hidden = store.get('dd-daily-played') === dateKey();
    this.setState('start');
    this.dom.hint.classList.add('off');
    this.announcer.clear();
    $('btnStart').focus({ preventScroll: true });
  }

  /** PLAY: resume the run in progress (same mode) or start a new one. `silent` = test hook, no announcer line. */
  closeStart(silent = false) {
    if (this.state !== 'start') return;
    this.dom.start.hidden = true;
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    const resume = this.runKey === this.modeId && this.prevState !== 'final' && this.prevState !== 'start';
    if (resume) {
      const back = this.prevState;
      this.setState(back);
      this.restoreThrower(back);
      return;
    }
    this.daily = false;
    this.newRun(silent);
  }

  restoreThrower(st) {
    if (st === 'ready') {
      this.thrower.setFacing(180);
    } else if (this.cur && this.cur.rec) {
      this.thrower.setFacing(Number.isFinite(this.cur.rec.meta.psi) ? this.cur.rec.meta.psi : 0);
      this.thrower.release(1);
    }
  }

  openHelp() {
    this.under = this.state === 'start' ? 'start' : this.state;
    this.prevState = this.state;
    this.dom.help.hidden = false;
    this.setState('help');
    $('btnHelpOk').focus({ preventScroll: true });
  }

  closeHelp() {
    if (this.state !== 'help') return;
    this.dom.help.hidden = true;
    const back = this.prevState;
    this.setState(back);
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    if (back === 'start') $('btnStart').focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ attempt lifecycle
  updatePips() {
    const pips = this.dom.pips.children;
    for (let i = 0; i < 3; i++) {
      const r = this.attempts[i];
      pips[i].className = r ? (r.foul ? 'foul' : 'done') : i === this.attempt ? 'on' : '';
    }
    this.dom.attemptTxt.textContent = `${Math.min(this.attempt + 1, 3)}/3`;
    this.dom.attemptLbl.textContent = this.daily ? 'DAILY' : 'ATTEMPT';
    document.body.dataset.played = String(this.attempts.filter(Boolean).length);
  }

  updateHudStatic() {
    this.dom.bestDist.textContent = this.best ? fmt(this.best.distance) : '--.--';
    this.dom.score.textContent = String(this.score);
    this.dom.btnReplay.disabled = !this.best;
  }

  setReadyVisuals() {
    this.thrower.setFacing(180);
    this.thrower.idle(this.clock);
    this.discus.group.removeFromParent();
    this.thrower.hand.add(this.discus.group);
    this.discus.group.position.set(0, 0, 0);
    this.discus.group.quaternion.identity();
    this.discus.group.rotation.set(this.attitude * DEG, 0, 0);
    this.discus.group.visible = true;
    this.glow.visible = false;
    this.shadow.visible = false;
    this.tape.hide();
    this.stadium.setJudgeCall(null);
    this.dom.result.hidden = true;
  }

  next() {
    if (this.state === 'final') {
      this.daily = false; // "PLAY AGAIN" is a normal run; the Daily is opened from the BOARD
      this.newRun();
      return;
    } else if (this.attempt < 2) {
      this.attempt++;
    } else {
      this.showFinal();
      return;
    }
    this.startAttempt();
  }

  /** A fresh 3-throw run (normal or Daily) with the current mode and athlete. */
  newRun(silent = false) {
    this.pending = null;
    this.attempt = 0;
    this.attempts = [];
    this.score = 0;
    this.best = null;
    this.runKey = this.modeId;
    this.noseManual = false;
    this.noseDrag = 0;
    this.dKey = dateKey();
    // weather is fixed for a run: the Daily uses the date's weather, otherwise the picker's choice (Random rolls a fresh one)
    this.weatherId = this.daily ? dailyWeather(dailySeed(this.dKey)) : resolveWeather(this.weatherChoice);
    this.applyWeather(false);
    this.updateHudStatic();
    this.applyModeUi();
    this.updateRival();
    this.startAttempt(undefined, silent);
  }

  startAttempt(seed, silent = false) {
    this.cancelFx();
    if (seed === undefined && this.daily) {
      // the Daily: the same wind + cast phases for everyone, and the obstacle clock restarts at a fixed value per throw
      seed = dailyLayoutSeed(this.dKey, this.attempt);
      this.tO = 4 + this.attempt * 9;
    }
    this.applyLayout(makeLayout(seed ?? ++this.seedBase, this.weatherId));
    this.applyModeUi();
    this.setReadyVisuals();
    this.updatePips();
    this.setState('ready');
    this.timeScale = 1;
    this.flashNow(null);
    if (silent) return;
    if (this.attempt === 0) {
      const p = personaOf(this.personaId);
      const q = p.quips[(this.seedBase + (this.attempt || 0)) % p.quips.length];
      this.announcer.show(`\u201c${q}\u201d  Beat the ${this.rivalInfo.name} flag: ${this.rivalInfo.mark.toFixed(1)} m.`, p.name, 2, 4200);
    } else this.announcer.say('ready', {}, { priority: 1 });
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
    this.stadium.setJudgeCall(null);
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
    this.spin = { rot: 0, t: 0, tickN: 0, psi: 180, psiVis: 180, power: 0, dizzy: 0, announced: new Set(), prof: chargeProfile(this.mode, this.tech) };
    this.dom.hint.classList.add('off');
    this.flashNow(null);
    this.announcer.say('spin', {}, { priority: 1, ms: 2200 });
    this.haptics.tick(0);
  }

  updateSpin(dt) {
    const s = this.spin;
    const m = this.mode;
    const tech = this.tech;
    const prof = s.prof;
    const p = powerFor(m, s.rot, tech);
    let rate = 260 + 240 * p;
    // Rookie: the needle eases down while it is inside the green, so there is time to react (power still follows rot)
    if (m.needleSlow) rate *= 1 - m.needleSlow * smooth((this.windowHalf + 14 - Math.abs(s.psi)) / 14);
    s.rot += rate * dt;
    s.t += dt;
    // CHARGE: build -> sweet spot -> overcharge. Past the sweet spot the green window shrinks and the needle shakes.
    const over = overchargeOf(m, s.rot, tech);
    const wobble = wobbleOf(m, s.rot, tech) * Math.sin(s.t * 19);
    this.windowHalf = effectiveWindow(m, this.attempt, s.rot, tech, this.weatherId);
    s.psi = wrap180(180 - s.rot);
    s.psiVis = s.psi + wobble;
    s.power = powerFor(m, s.rot, tech);
    s.dizzy = over;
    const turns = s.rot / 360;
    s.zone = turns >= prof.overFrom ? 'over' : turns >= prof.sweetFrom ? 'sweet' : 'build';
    const inW = Math.abs(s.psiVis) <= this.windowHalf;
    if (inW && !s.wasIn) this.haptics.tick(0.2); // a small tick as the needle enters the green
    s.wasIn = inW;
    const half = Math.floor(s.rot / 180);
    if (half > s.tickN) {
      s.tickN = half;
      this.haptics.tick(s.power);
    }
    if (turns >= prof.sweetFrom && !s.announced.has('sweet')) {
      s.announced.add('sweet');
      this.announcer.say('sweet', {}, { priority: 2, ms: 2000 });
      this.haptics.perfect();
    }
    if (turns >= prof.overFrom && !s.announced.has('dizzy')) {
      s.announced.add('dizzy');
      this.announcer.say('dizzy', {}, { priority: 2, ms: 2000 });
    }
    this.thrower.setFacing(s.psiVis);
    this.thrower.spin(s.rot, s.power);
    this.shake = Math.max(this.shake, s.power * 0.035 + over * 0.06);
    if (turns >= STEPOUT_TURNS) this.stepOut();
  }

  /**
   * Release from the live spin: the dial angle decides heading AND release angle (timing is the skill).
   * The mapping lives in modes.js (pure, unit-tested); Rookie also sets the nose for you unless you dragged it.
   */
  doRelease() {
    const s = this.spin;
    const psi = Number.isFinite(s.psiVis) ? s.psiVis : 180;
    const p = Number.isFinite(s.power) ? s.power : 0;
    const auto = this.mode.noseAssist && !this.noseManual;
    const { params, meta } = releaseParams(this.mode, { psi, rot: Number.isFinite(s.rot) ? s.rot : 0, power: p, attitude: auto ? 'auto' : this.attitude, wind: this.layout.wind, attempt: this.attempt, technique: this.tech, weather: this.weatherId });
    if (auto && Number.isFinite(params.attitude)) {
      params.attitude = clamp(params.attitude, NOSE_MIN, NOSE_MAX);
      this.attitude = params.attitude;
      this.updateNose();
    }
    if (meta.perfect) {
      this.flashNow('PERFECT', 'dead-centre release', 'perfect');
      this.haptics.perfect();
    } else if (meta.over > 0.3 && !meta.short) {
      this.flashNow('OVERCHARGED', 'the green shrank and the needle shook', 'foul');
    }
    this.launch(params, { ...meta, power: p, psi });
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
    // the air of this venue / weather: density from the temperature, plus the gust profile (both deterministic)
    if (this.layout.rho !== undefined && p.rho === undefined) p = { ...p, rho: this.layout.rho };
    if (this.layout.gust && p.gust === undefined) p = { ...p, gust: this.layout.gust };
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
    meta = { technique: this.techId, ...meta };
    rec.meta = meta;
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
    this.thrower.release(0);
    this.shake = Math.max(this.shake, this.reducedMotion ? 0 : 0.22);
    this.haptics.release(meta.power ?? 0.6);
    if (meta.short) this.announcer.say(meta.tap ? 'tapRookie' : 'shortToss', {}, { priority: 2, ms: 3200 });
    else if (meta.tap) this.announcer.say('tap', {}, { priority: 2, ms: 2600 });
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
    const n3 = this._n3.set(n[2], n[1], -n[0]);
    this.discus.group.quaternion.setFromUnitVectors(this._up, n3);
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
    const q = toThree(s.x, s.y, s.z, this._tq);
    this.particles.spawn(q.x, q.y, q.z, 0, 0, 0, 1, 0.55, 0.15, 0.55, 0.9, 0, 0);
    this.particles.spawn(q.x, q.y, q.z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 1, 0.95, 0.8, 0.22, 0.45, 0, 0);
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
    this.dom.score.innerHTML = r && r.mult > 1 ? `${this.score}<span class="mult"> ×${r.mult.toFixed(1)}</span>` : String(this.score);
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
    this.stadium.setJudgeCall(foul ? 'foul' : 'fair');
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

  /** One plain line of coaching (Rookie only): after a foul, or after a playful short toss. */
  coachFor(rec) {
    const rr = rec.result;
    const m = rec.meta || {};
    if (!rr.foul) return m.short ? 'Short toss. Hold longer, then let go in the green.' : '';
    if (rr.reason === 'stepout') return 'Let go before the circle runs out: about 3 turns is plenty.';
    if (rr.reason === 'cage' || !m.inWindow) return 'Let go when the needle is in the green.';
    return 'Aim for the middle of the green: wind pushes the disc sideways.';
  }

  showResult(rec) {
    const d = this.dom;
    const rr = rec.result;
    const a = rec.analysis;
    d.result.hidden = false;
    d.result.classList.toggle('foul', rr.foul);
    d.resChips.classList.remove('final-grid');
    d.resTag.textContent = `THROW ${rec.attempt + 1} OF 3`;
    const coach = this.mode.noseAssist ? this.coachFor(rec) : '';
    d.resCoach.hidden = !coach;
    d.resCoach.textContent = coach;
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
    chip(`${personaOf(this.personaId).name} <b>${techniqueOf(rec.meta && rec.meta.technique).name.toUpperCase()}</b>`, 'who');
    rec.hits.forEach((h) => chip(`${OBS[h]} <b>x${MULTS[h]}</b>`));
    if (!rr.foul) chip(`${mult > 1 ? `${rr.distance.toFixed(1)} x ${mult.toFixed(2).replace(/\.?0+$/, '')} = ` : ''}<b>${pts} PTS</b>`, 'total');
    if (!rr.foul && this.rivalInfo) {
      const diff = rr.distance - this.rivalInfo.mark;
      chip(diff >= 0 ? `BEAT ${this.rivalInfo.name} <b>+${diff.toFixed(1)} m</b>` : `${this.rivalInfo.name} <b>${diff.toFixed(1)} m</b>`, diff >= 0 ? 'rival win' : 'rival');
    }
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
    d.resTag.textContent = this.daily ? 'DAILY FINAL' : 'FINAL';
    d.resRank.textContent = rank;
    d.resCoach.hidden = true;
    d.resDist.textContent = this.best ? fmt(bestD) : '0.00';
    d.resFeet.textContent = this.best ? formatFeetInches(bestD) : 'no legal throws';
    d.resChips.classList.add('final-grid');
    const r = this.rivalInfo;
    const rivalChip = !this.best || !r ? '' : bestD >= r.mark ? `<span class="rival win">BEAT ${r.name} <b>+${(bestD - r.mark).toFixed(1)} m</b></span>` : `<span class="rival">${r.name} LEADS <b>${(r.mark - bestD).toFixed(1)} m</b></span>`;
    d.resChips.innerHTML = this.attempts.map((a, i) => `<span>T${i + 1} <b>${a.foul ? 'FOUL' : a.distance.toFixed(1) + ' m'}</b></span>`).join('') + `<span class="total">TOTAL <b>${this.score} PTS</b></span>` + rivalChip;
    d.resStats.innerHTML = `<div><dt>REAL WR</dt><dd>${WORLD_RECORD_M} m</dd></div><div><dt>YOU</dt><dd>${bestD ? (((bestD / WORLD_RECORD_M) * 100) | 0) + '% of WR' : '0%'}</dd></div>`;
    d.resNote.textContent = 'Real-world reference: 74.35 m, Mykolas Alekna, 2024.';
    d.btnNext.firstChild.textContent = 'PLAY AGAIN ';
    this.setShareLabel(null);
    this.announcer.say('final', {}, { priority: 3 });
    this.tape.hide();
    this.stadium.setJudgeCall(null);
    if (this.daily && bestD > 0) store.set('dd-daily-played', this.dKey);
    this.finalInfo = { mark: bestD };
    // arcade initials prompt, a beat after the final card appears (game clock, so it also works under the test stepper)
    this.pending = null;
    if (bestD > 0) {
      const id = this.boardId();
      this.board.qualifies(id, bestD).then((q) => {
        if (q && this.state === 'final' && this.finalInfo && this.finalInfo.mark === bestD) this.pending = { at: this.clock + 1.2, id, mark: bestD };
      });
    }
  }

  boardId() {
    return this.daily ? dailyBoardId(this.dKey) : ALL_TIME;
  }

  // ------------------------------------------------------------------ leaderboard UI
  openInitials() {
    const pen = this.pending;
    this.pending = null;
    if (!pen || this.state !== 'final') return;
    this.under = 'final';
    this.prevState = 'final';
    const last = store.get('dd-initials');
    const base = /^[A-Z]{3}$/.test(last || '') ? last : 'AAA';
    this.ini = { letters: [...base].map((c) => c.charCodeAt(0) - 65), slot: 0, id: pen.id, mark: pen.mark };
    $('iniMark').textContent = pen.mark.toFixed(1);
    $('iniSub').textContent = `${this.daily ? 'TODAY’S DAILY' : 'ALL-TIME TOP 10'} · ${this.mode.label.toUpperCase()} · ${personaOf(this.personaId).name}`;
    this.renderInitials();
    this.dom.initials.hidden = false;
    this.setState('initials');
    $('iniOk').focus({ preventScroll: true });
  }

  renderInitials() {
    for (let i = 0; i < 3; i++) {
      const el = $('ini' + i);
      el.textContent = String.fromCharCode(65 + this.ini.letters[i]);
      el.parentElement.classList.toggle('on', i === this.ini.slot);
    }
  }

  setSlot(i) {
    this.ini.slot = clamp(i, 0, 2);
    this.renderInitials();
  }

  bumpLetter(i, dir) {
    this.ini.slot = i;
    this.ini.letters[i] = (this.ini.letters[i] + dir + 26) % 26;
    this.renderInitials();
  }

  skipInitials() {
    if (this.state !== 'initials') return;
    this.dom.initials.hidden = true;
    this.setState('final');
  }

  async saveInitials() {
    if (this.state !== 'initials' || this.saving) return;
    this.saving = true;
    const initials = this.ini.letters.map((n) => String.fromCharCode(65 + n)).join('');
    store.set('dd-initials', initials);
    try {
      const res = await this.board.submit(this.ini.id, { initials, mark: this.ini.mark, character: this.personaId, mode: this.modeId, date: dateKey() });
      this.dom.initials.hidden = true;
      this.setState('final');
      await this.openBoard(this.ini.id === ALL_TIME ? ALL_TIME : 'daily', res.rank);
    } catch {
      this.skipInitials();
    } finally {
      this.saving = false;
    }
  }

  async openBoard(tab = ALL_TIME, highlightRank = null) {
    if (this.state === 'board') return;
    this.under = this.state === 'start' ? 'start' : this.state;
    this.prevState = this.state;
    this.dom.boardEl.hidden = false;
    this.setState('board');
    this.highlightRank = highlightRank;
    await this.showBoardTab(tab);
    $('btnBoardClose').focus({ preventScroll: true });
  }

  closeBoard() {
    if (this.state !== 'board') return;
    this.dom.boardEl.hidden = true;
    const back = this.prevState;
    this.setState(back);
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    if (back === 'start') $('btnBoard').focus({ preventScroll: true });
  }

  async showBoardTab(tab) {
    this.boardTab = tab;
    const daily = tab === 'daily';
    $('tabAll').setAttribute('aria-selected', String(!daily));
    $('tabDaily').setAttribute('aria-selected', String(daily));
    $('btnPlayDaily').hidden = !daily;
    const key = dateKey();
    this.dom.boardSub.textContent = daily ? `${key} · same wind and cast for everyone today` : 'Top 10 on this device';
    const rows = await this.board.top(daily ? dailyBoardId(key) : ALL_TIME);
    const name = (id) => personaOf(id).name;
    const shortDate = (k) => new Date(k + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const mine = this.highlightRank;
    this.dom.boardList.innerHTML =
      `<div class="brow head" aria-hidden="true"><span>#</span><span>NAME</span><span>MARK</span><span>ATHLETE</span><span>MODE</span><span>DATE</span></div>` +
      rows
        .map(
          (e) =>
            `<div class="brow${mine && e.rank === mine && !e.npc ? ' you' : ''}${e.npc ? ' npc' : ''}"><span class="rk num">${e.rank}</span><span class="in num">${e.initials}</span><span class="mk num">${e.mark.toFixed(1)}</span><span class="ch"><i style="background:${personaOf(e.character).css}"></i>${name(e.character)}</span><span class="md ${e.mode}">${e.mode === 'pro' ? 'PRO' : 'ROOKIE'}</span><span class="dt num">${shortDate(e.date)}</span></div>`,
        )
        .join('');
    this.dom.boardList.scrollTop = 0;
  }

  /** Daily Throw: same wind + cast phases for everyone today. Starts a fresh run. */
  playDaily() {
    this.dom.boardEl.hidden = true;
    this.dom.start.hidden = true;
    this.dom.help.hidden = true;
    this.daily = true;
    this.setState('ready');
    this.newRun();
  }

  async shareResult() {
    const text = shareText({ daily: this.daily, mark: this.finalInfo ? this.finalInfo.mark : this.best ? this.best.distance : 0, mode: this.modeId });
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    this.lastShare = text;
    this.setShareLabel(ok ? 'COPIED' : 'FAILED');
    this.dom.resNote.textContent = ok ? text : `Copy this: ${text}`;
    setTimeout(() => this.setShareLabel(null), 2200);
  }

  setShareLabel(txt) {
    this.dom.btnShare.innerHTML = txt ? txt : '<span class="lg">COPY RESULT</span><span class="sm">COPY</span>';
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
    this.stadium.setJudgeCall(null);
    this.obstacles.setLayout(rec.layout);
    this.stadium.setWind(rec.layout.wind, rec.layout.gust);
    const first = rec.samples[0];
    this.rt = { rec, t: 0, ev: 0, stage: 'air', landedT: 0 };
    this.discus.group.removeFromParent();
    this.scene.add(this.discus.group);
    this.glow.visible = true;
    this.shadow.visible = true;
    this.thrower.setFacing(Number.isFinite(rec.meta.psi) ? rec.meta.psi : rec.params.heading / HEAD_FACTOR);
    this.thrower.release(0);
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
      this.thrower.release(t / 0.8);
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
    const back = this.prevState === 'start' ? 'ready' : this.prevState;
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
        this.thrower.setFacing(Number.isFinite(c.rec.meta.psi) ? c.rec.meta.psi : c.rec.params.heading / HEAD_FACTOR);
        this.thrower.release(1);
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
      const pr = this.spin.prof;
      const zone = this.spin.zone;
      d.powerFill.style.width = `${(clamp(this.spin.rot / 360 / pr.stepOut, 0, 1) * 100).toFixed(1)}%`;
      d.powerFill.className = 'fill' + (zone === 'over' ? ' dizzy' : zone === 'sweet' ? ' full' : '');
      d.powerTxt.textContent = `${(p * 100).toFixed(0)}%`;
      d.powerState.textContent = zone === 'over' ? 'OVERCHARGE' : zone === 'sweet' ? 'SWEET SPOT' : 'BUILD';
      d.powerState.className = 'pstate ' + zone;
      d.spinTxt.textContent = (this.spin.rot / 360).toFixed(1);
      d.dizzyTxt.hidden = this.spin.dizzy < 0.02;
      d.powerBar.setAttribute('aria-valuenow', (p * 100).toFixed(0));
      d.powerBar.setAttribute('aria-valuetext', `${(p * 100).toFixed(0)}% power, ${d.powerState.textContent.toLowerCase()}`);
      if (Math.abs(this.dialDrawn - this.windowHalf) > 0.4) this.setDial();
      const psi = this.spin.psiVis;
      d.needle.setAttribute('transform', `rotate(${psi.toFixed(1)})`);
      const inW = Math.abs(psi) <= this.windowHalf;
      const perfect = Math.abs(psi) <= this.mode.perfectHalf;
      d.dialState.textContent = perfect ? 'PERFECT!' : inW ? 'RELEASE!' : 'WAIT';
      d.dialState.className = 'num ' + (perfect ? 'perfect' : inW ? 'in' : 'out');
      d.dial.classList.toggle('hot', inW);
      d.dial.classList.toggle('perfect', perfect);
      this.updateNose();
    } else if (this.state === 'ready') {
      d.powerFill.style.width = '0%';
      d.powerFill.className = 'fill';
      d.powerState.textContent = 'BUILD';
      d.powerState.className = 'pstate';
      d.powerTxt.textContent = '0%';
      d.spinTxt.textContent = '0.0';
      d.dizzyTxt.hidden = true;
      d.needle.setAttribute('transform', 'rotate(180)');
      d.dialState.textContent = 'HOLD';
      d.dialState.className = 'num';
      d.dial.classList.remove('hot', 'perfect');
    }
    if (!spin && this.state !== 'ready' && !OVERLAYS.includes(this.state)) {
      d.dial.classList.remove('hot', 'perfect');
      d.dialState.textContent = this.state === 'replay' ? 'REPLAY' : 'AWAY';
      d.dialState.className = 'num';
    }
    void showMeters;
    document.body.classList.toggle('card-on', !d.result.hidden);
    document.body.classList.toggle('toast-on', this.clock < this.toastUntil);
    d.camToast.classList.toggle('on', this.clock < this.toastUntil);
  }

  // ------------------------------------------------------------------ camera
  /** The athlete turning beside a card (start screen, technique picker): the card owns the right (or bottom in portrait). */
  athleteShot(want, look, card, dist, portraitDist) {
    const cam = this.camera;
    const portrait = cam.aspect < 0.9;
    const D = portrait ? portraitDist : dist;
    want.set(portrait ? 1.2 : 1.9, portrait ? 1.3 : 1.45, D);
    look.set(0, 1.0, 0);
    const H = 2 * D * Math.tan((this.baseFov * DEG) / 2);
    if (portrait) look.y -= clamp((card ? card.offsetHeight : 400) / Math.max(1, innerHeight), 0.2, 0.7) * 0.5 * H * 0.95;
    else {
      const fw = clamp((card ? card.offsetWidth : 380) / Math.max(1, innerWidth), 0.2, 0.6);
      const fx = look.x - want.x;
      const fz = look.z - want.z;
      const fl = Math.hypot(fx, fz) || 1;
      const sh = 0.5 * fw * H * cam.aspect * 0.95;
      look.x += (-fz / fl) * sh; // camera-right
      look.z += (fx / fl) * sh;
    }
  }

  /**
   * Non-broadcast presets (see camera.js). `pos` = the disc in three.js space while it is in the air, else null (ready / spin).
   * Fills want / look and returns { k, fov }. Static cameras (behind, side) stay put and zoom; chase cameras follow the disc.
   */
  presetShot(id, pos, s, want, look, fov0) {
    const portrait = this.camera.aspect < 0.9;
    const base = this.baseFov;
    let k = 3;
    let fov = fov0;
    const spinP = this.state === 'spin' && this.spin ? this.spin.power : 0;
    if (id === 'behind') {
      want.set(portrait ? 1.6 : 2.0, portrait ? 2.8 : 2.3, portrait ? 10.4 : 9.8);
      if (pos) {
        look.set(pos.x, Math.max(0.9, pos.y * 0.9), pos.z);
        fov = clamp(base * (16 / Math.max(16, want.distanceTo(pos))), 14, base);
        k = 4;
      } else {
        look.set(0, 1.6, -14);
        fov = base - spinP * 4;
        k = 3;
      }
    } else if (id === 'side') {
      // left of the sector (the tents are on the right): a fixed sideline position that pans with the disc
      if (pos) {
        want.set(portrait ? -27 : -22, portrait ? 3.8 : 2.9, portrait ? -26 : -24);
        look.set(pos.x, Math.max(0.8, pos.y * 0.85), pos.z);
        fov = base * (portrait ? 0.72 : 0.62);
        k = 4;
      } else {
        want.set(portrait ? -3.8 : -4.2, 3.0, portrait ? -16 : -14.5); // front-left, looking back through the cage mouth (a side-on shot would sit behind the net wall)
        look.set(0, 1.3, 0.2);
        fov = base * (portrait ? 0.62 : 0.65) - spinP * 3;
        k = 3;
      }
    } else if (id === 'disc') {
      if (pos) {
        const hd = this.hdir;
        want.copy(pos).addScaledVector(hd, -3.4);
        want.y = Math.max(0.9, pos.y + 0.8);
        look.copy(pos).addScaledVector(hd, 14);
        look.y = Math.max(0.5, pos.y * 0.85);
        fov = base + 4;
        k = 7;
      } else {
        want.set(portrait ? 1.1 : 1.6, portrait ? 1.6 : 1.5, portrait ? 4.0 : 3.1);
        look.set(0, 1.25, 0);
        fov = base - spinP * 4;
        k = 3;
      }
    } else {
      // overhead
      if (pos) {
        want.set(pos.x * 0.7, 20 + Math.min(14, (s ? s.y : 0) * 0.6), pos.z + 13);
        look.set(pos.x * 0.9, pos.y * 0.2, pos.z - 5);
        fov = base * 0.85;
        k = 3.5;
      } else {
        want.set(0.6, portrait ? 19 : 15.5, portrait ? 7 : 5.5);
        look.set(0, 0.6, portrait ? -1.2 : -2.0);
        fov = base * 0.9;
        k = 3;
      }
    }
    return { k, fov };
  }

  updateCamera(dt) {
    const cam = this.camera;
    const want = this._want.set(0, 0, 0);
    const look = this._look.set(0, 0, 0);
    let k = 3.2;
    let fov = this.baseFov;
    let roll = 0;
    let focus = null; // what a collision-aware shot must keep visible (three.js space)
    const preset = this.camId;
    const st = this.viewState();
    const flying = (st === 'flight' && this.cur && this.cur.stage === 'air') || (st === 'replay' && this.rt && this.rt.stage === 'air');
    const landed = (st === 'flight' && this.cur && this.cur.stage === 'landed') || (st === 'replay' && this.rt && this.rt.stage === 'landed');
    if (flying) {
      const s = st === 'replay' ? this.replayS : this.cur.f.s;
      const pos = toThree(s.x, s.y, s.z, this._pos);
      const v3 = this._v3.set(s.vz, 0, -s.vx);
      if (v3.lengthSq() > 1e-4) {
        v3.normalize();
        this.hdir.lerp(v3, 1 - Math.exp(-6 * dt)).normalize();
      }
      const side = this._side.set(-this.hdir.z, 0, this.hdir.x); // right of travel
      const nearGround = s.vy < 0 && s.y < 10 && s.y / Math.max(2, -s.vy) < 1.1;
      if (preset !== 'broadcast') {
        ({ k, fov } = this.presetShot(preset, pos, s, want, look, fov));
        focus = pos;
      } else if (nearGround) {
        want.copy(pos).addScaledVector(this.hdir, -9).addScaledVector(side, 4.5).setY(Math.max(1.6, s.y * 0.45 + 1.2));
        look.copy(pos).addScaledVector(this.hdir, 5).setY(Math.max(0.5, s.y * 0.6));
        k = 5.5;
        fov = this.baseFov - 8;
      } else {
        want.copy(pos).addScaledVector(this.hdir, -9).addScaledVector(side, 1.6).setY(Math.max(2.4, s.y * 0.5 + 2.8));
        look.copy(pos).addScaledVector(this.hdir, 6);
        k = 5;
      }
    } else if (landed || st === 'result') {
      const rec = this.cur && this.cur.rec;
      const rr = rec && rec.result;
      if (rr) {
        const L = Math.max(8, rr.range);
        const dir = this._dir.set(Math.sin(rr.az * DEG), 0, -Math.cos(rr.az * DEG));
        const right = this._right.set(-dir.z, 0, dir.x);
        const mid = this._mid.copy(dir).multiplyScalar(L * 0.5);
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
          const fwd = this._fwd.copy(look).sub(want).setY(0);
          const dist = fwd.length();
          if (dist > 1e-3) {
            fwd.divideScalar(dist);
            const half = dist * Math.tan((this.baseFov * DEG) / 2) * cam.aspect;
            look.addScaledVector(this._v3.set(-fwd.z, 0, fwd.x), half * f * 1.15);
          }
        }
        k = 2.4;
      }
      if (landed && this.cur && this.cur.landedT < 0.45) {
        // hold the low landing angle briefly, then rise
        const lt = this.cur ? this.cur.landedT : 0;
        if (lt < 0.45) {
          want.set(this.camPos.x, Math.max(1.4, this.camPos.y), this.camPos.z);
          look.copy(this.discus.group.position);
          k = 2;
        }
      }
    } else if (st === 'start') {
      this.athleteShot(want, look, this.dom.start.firstElementChild, 3.6, 3.4);
      k = 3;
    } else if (st === 'tech') {
      this.athleteShot(want, look, this.dom.tech.firstElementChild, 5.4, 5.2);
      k = 3;
    } else if (st === 'final') {
      const a = this.clock * 0.18;
      want.set(Math.sin(a) * 9, 4.5, Math.cos(a) * 9);
      look.set(0, 1.6, -4);
      k = 2;
    } else {
      // ready / spin
      if (preset === 'broadcast') {
        // broadcast shot behind-right of the circle, slow drift
        const drift = this.reducedMotion ? 0 : Math.sin(this.clock * 0.2) * 0.6;
        if (cam.aspect < 0.9) {
          want.set(3.2 + drift, 3.0, 10.8);
          look.set(-0.2, 1.3, -7);
        } else {
          want.set(5.4 + drift, 2.75, 9.8);
          look.set(-0.8, 1.45, -10);
        }
        if (st === 'spin' && this.spin) {
          const p = this.spin.power;
          want.z -= p * 1.1;
          want.x -= p * 0.8;
          fov -= p * 5;
        }
        k = st === 'spin' ? 5 : 2.2;
      } else {
        ({ k, fov } = this.presetShot(preset, null, null, want, look, fov));
        k = st === 'spin' ? Math.max(k, 4) : k;
      }
      if (st === 'spin' && this.spin) roll = (this.spin.dizzy || 0) * 0.12 * Math.sin(this.spin.t * 7);
      focus = this._focus.set(0, 1.2, 0);
    }
    // never let a net fill the view: nudge a non-broadcast shot around the athlete / circle until the sight line is clear
    if (focus && (preset !== 'broadcast' || !flying) && [want.x, want.y, want.z].every(Number.isFinite)) {
      const near = Math.hypot(focus.x, focus.z) < 12;
      const c = clearCamera({ x: want.x, y: want.y, z: want.z }, { x: focus.x, y: focus.y, z: focus.z }, { pivot: near ? { x: focus.x, z: focus.z } : { x: 0, z: 0 } });
      want.set(c.x, c.y, c.z);
    }
    if (![want.x, want.y, want.z, look.x, look.y, look.z].every(Number.isFinite)) {
      want.set(5.4, 2.75, 9.8); // belt and braces: a non-finite target must never reach the camera
      look.set(-0.8, 1.45, -10);
    }
    if (this.camBlend > 0) {
      this.camBlend = Math.max(0, this.camBlend - dt);
      k = Math.min(k, 2.4); // a view switch glides, it does not whip
    }
    const snap = this.camSnap > 0; // first frames of the start screen / MENU: cut straight to the shot, no fly-in
    if (snap) this.camSnap--;
    this.camPos.lerp(want, snap ? 1 : 1 - Math.exp(-k * dt));
    this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-Math.max(k, 3) * dt));
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
      cam.fov += (fov - cam.fov) * (snap ? 1 : 1 - Math.exp(-5 * dt));
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
    const vs = this.viewState();
    if (this.state === 'tech') this.updateDemo(dt);
    if (vs === 'ready' || vs === 'start' || vs === 'tech') {
      this.stadium.setExcite(0.3 + 0.1 * Math.sin(this.clock));
      if (this.state === 'start' || this.state === 'ready' || this.state === 'help') this.thrower.idle(this.clock);
      if (this.state === 'start') this.thrower.setFacing(this.reducedMotion ? 150 : 180 + this.clock * 28);
    }
    if (this.state === 'flight') {
      const c = this.cur;
      this.thrower.release(c && c.stage === 'air' ? c.f.s.t / 0.8 : 1);
    }
    // Rookie nose assist: ease the nose toward the best angle for this wind until the player takes over
    if (this.mode.noseAssist && !this.noseManual && (this.state === 'ready' || this.state === 'spin')) {
      const na = this.attitude + (this.assistAtt - this.attitude) * (1 - Math.exp(-3 * dt));
      if (Math.abs(na - this.attitude) > 0.01) {
        this.attitude = na;
        this.updateNose();
      }
    }
    if (this.pending && this.clock >= this.pending.at && this.state === 'final') this.openInitials();
    this.particles.update(sdt);
    this.debris.update(sdt);
    this.stadium.update(this.clock, this.camera);
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
    } else if (this.slowFrames > 90 && this.dpr <= 1) {
      this.slowFrames = 0;
      this.stadium.degrade(); // already at 1x pixel ratio: thin the crowd / drop haze instead
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
    if (this.state === 'start') this.closeStart(true);
    for (let i = 0; i < 2 && (this.state === 'result' || this.state === 'final'); i++) this.next();
    if (this.state !== 'ready') return Promise.reject(new Error('not ready: ' + this.state));
    if (p.seed !== undefined || p.wind) {
      const l = makeLayout(p.seed ?? this.layout.seed, this.weatherId);
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
    this.thrower.release(0);
    const promise = this.waitResult();
    this.launch(params, { power, psi, inWindow: Math.abs(psi) <= this.windowHalf });
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
    Object.values(this.stadiums).forEach((st) => st.dispose());
    this.particles.dispose();
    this.debris.dispose();
    this.obstacles.dispose();
    this.thrower.dispose();
    this.rival.dispose();
    this.discus.dispose();
    this.tape.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
  }
}
