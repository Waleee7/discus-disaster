// Techniques, the charge meter (sweet spot / overcharge) and the camera net-collision: pure logic, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, mulberry32, SECTOR_HALF_ANGLE } from '../src/physics.js';
import { MODES, releaseParams, chargeProfile, overchargeOf, effectiveWindow, wobbleOf, powerFor } from '../src/modes.js';
import { TECHNIQUES, techniqueOf, DEFAULT_TECHNIQUE, REAL_TECHNIQUE_URL } from '../src/techniques.js';
import { PRESETS, nextPreset, netHits, viewBlocked, clearCamera } from '../src/camera.js';

const run = (p) => simulate(p, { sampleEvery: 1e9 });
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const randWind = (r) => ({ x: -(-2.5 + r() * 8.5), z: -4 + r() * 8 });
const T = (id) => techniqueOf(id);
const rel = (mode, id, o = {}) => {
  const tech = T(id);
  return releaseParams(mode, { psi: 0, rot: chargeProfile(mode, tech).full * 360, power: 1, attitude: 25, wind: { x: 0, z: 0 }, technique: tech, ...o });
};

test('there are 5 original techniques; the default is neutral; no real athlete names', () => {
  assert.equal(TECHNIQUES.length, 5);
  const d = T(DEFAULT_TECHNIQUE);
  assert.deepEqual([d.speed, d.angle, d.nose, d.window, d.turns, d.jitter], [1, 0, 0, 1, 1, 0]);
  const text = JSON.stringify(TECHNIQUES).toLowerCase();
  for (const name of ['alekna', 'schult', 'ubartas', 'oerter', 'kanter', 'stahl', 'weir']) assert.ok(!text.includes(name), `no real athlete: ${name}`);
  assert.equal(REAL_TECHNIQUE_URL, 'https://worldathletics.org/disciplines/throws/discus-throw');
});

test('each technique moves the physics inputs in its intended direction', () => {
  for (const mid of ['pro', 'rookie']) {
    const m = MODES[mid];
    const base = rel(m, 'wide', { attitude: mid === 'rookie' ? 'auto' : 25 });
    const get = (id) => rel(m, id, { attitude: mid === 'rookie' ? 'auto' : 25 });
    const power = get('power');
    const low = get('low');
    const floater = get('floater');
    const standing = get('standing');
    assert.ok(power.params.speed > base.params.speed, `${mid}: Power Spin has more release speed`);
    assert.ok(power.meta.window < base.meta.window, `${mid}: Power Spin has a narrower green`);
    assert.ok(chargeProfile(m, T('power')).full > chargeProfile(m, T('wide')).full, `${mid}: Power Spin needs more turns`);
    assert.ok(low.params.releaseAngle < base.params.releaseAngle, `${mid}: Low Arc releases lower`);
    assert.ok(low.params.attitude < base.params.attitude, `${mid}: Low Arc has a lower nose`);
    assert.ok(floater.params.releaseAngle > base.params.releaseAngle, `${mid}: Floater releases higher`);
    assert.ok(floater.params.attitude > base.params.attitude, `${mid}: Floater has a higher nose`);
    assert.ok(standing.params.speed < base.params.speed * 0.9, `${mid}: Standing Throw is slow`);
    assert.ok(standing.meta.window > base.meta.window, `${mid}: Standing Throw has the widest green`);
    assert.ok(chargeProfile(m, T('standing')).full < chargeProfile(m, T('wide')).full, `${mid}: Standing Throw peaks early`);
  }
});

test('Standing Throw is the most forgiving: widest window, most legal releases, and the shortest', () => {
  const legal = {};
  const dist = {};
  for (const t of TECHNIQUES) {
    const r = mulberry32(3);
    let ok = 0;
    const N = 300;
    const ds = [];
    for (let i = 0; i < N; i++) {
      const psi = (r() * 2 - 1) * 60;
      const { params, meta } = releaseParams(MODES.pro, { psi, rot: chargeProfile(MODES.pro, t).full * 360, power: 1, attitude: 25, wind: randWind(r), technique: t });
      const s = run(params);
      if (!meta.foulReason && Math.abs(s.azimuth) <= SECTOR_HALF_ANGLE && s.landing.x > 0) {
        ok++;
        ds.push(s.distance);
      }
    }
    legal[t.id] = ok / N;
    dist[t.id] = median(ds);
  }
  const win = Object.fromEntries(TECHNIQUES.map((t) => [t.id, effectiveWindow(MODES.pro, 0, 0, t)]));
  for (const t of TECHNIQUES) if (t.id !== 'standing') {
    assert.ok(win.standing > win[t.id], `window: standing ${win.standing} > ${t.id} ${win[t.id]}`);
    assert.ok(legal.standing > legal[t.id] + 0.15, `legal share: standing ${legal.standing.toFixed(2)} vs ${t.id} ${legal[t.id].toFixed(2)}`);
    assert.ok(dist.standing < dist[t.id] - 15, `standing is short: ${dist.standing.toFixed(1)} vs ${t.id} ${dist[t.id].toFixed(1)}`);
  }
  assert.ok(dist.standing > 30 && dist.standing < 50, `standing median ${dist.standing.toFixed(1)} m`);
  assert.ok(legal.power < legal.wide, 'Power Spin trades control for speed');
});

test('techniques stay realistic: perfect-release medians 64-70 m (Standing 38-48), the 74.35 m record stays out of reach', () => {
  for (const t of TECHNIQUES) {
    const r = mulberry32(7);
    const out = [];
    for (let i = 0; i < 400; i++) {
      const psi = (r() * 2 - 1) * 4;
      const { params } = releaseParams(MODES.pro, { psi, rot: chargeProfile(MODES.pro, t).full * 360, power: 1, attitude: 20 + r() * 8, wind: randWind(r), technique: t });
      out.push(run(params).distance);
    }
    const m = median(out);
    const wr = out.filter((d) => d >= 74.35).length / out.length;
    if (t.id === 'standing') assert.ok(m > 38 && m < 48, `standing median ${m.toFixed(1)}`);
    else assert.ok(m >= 64 && m <= 70, `${t.id} median ${m.toFixed(1)}`);
    assert.ok(wr <= 0.01, `${t.id}: ${(wr * 100).toFixed(1)}% of perfect throws beat the world record`);
  }
  const wide = median(Array.from({ length: 200 }, (_, i) => run(rel(MODES.pro, 'wide', { psi: 0, wind: { x: 0, z: 0 }, attitude: 20 + (i % 9) }).params).distance));
  assert.ok(wide >= 62 && wide <= 70, `Wide-Leg Reverse (the baseline) still ~66 m: ${wide.toFixed(1)}`);
});

test('wind trade-offs follow the simulator: Low Arc beats Wide-Leg into a headwind, Floater in a tailwind', () => {
  const d = (id, wx, mid = 'pro') => run(rel(MODES[mid], id, { wind: { x: wx, z: 0 }, attitude: mid === 'rookie' ? 'auto' : 25 }).params).distance;
  for (const mid of ['pro', 'rookie']) {
    assert.ok(d('low', -5, mid) > d('wide', -5, mid) + 0.8, `${mid}: Low Arc gains in a headwind`);
    assert.ok(d('low', 4, mid) < d('wide', 4, mid) - 0.8, `${mid}: Low Arc loses in a tailwind`);
    assert.ok(d('floater', 4, mid) > d('wide', 4, mid) + 0.5, `${mid}: Floater gains in a tailwind`);
    // Rookie's auto-nose re-optimises the nose, which softens (but does not remove) the headwind penalty
    assert.ok(d('floater', -5, mid) < d('wide', -5, mid) - (mid === 'pro' ? 0.8 : 0.3), `${mid}: Floater loses in a headwind`);
  }
});

test('charge meter: build, sweet spot, overcharge, step-out; overcharge narrows the green and shakes the needle', () => {
  for (const mid of ['pro', 'rookie']) {
    const m = MODES[mid];
    for (const t of TECHNIQUES) {
      const p = chargeProfile(m, t);
      assert.ok(p.sweetFrom < p.sweetTo && p.sweetTo <= p.overFrom && p.overFrom < p.stepOut, `${mid}/${t.id} zones ordered ${JSON.stringify(p)}`);
      assert.ok(powerFor(m, p.sweetFrom * 360, t) >= 0.9, `${mid}/${t.id}: the sweet spot starts at ~full power`);
      assert.equal(overchargeOf(m, p.sweetTo * 360, t), 0, 'no penalty up to the end of the sweet spot');
      assert.ok(overchargeOf(m, (p.overFrom + 0.4) * 360, t) > 0);
      assert.ok(overchargeOf(m, p.stepOut * 360, t) > 0.99);
      let prevW = Infinity;
      let prevS = -1;
      for (let turns = p.sweetFrom; turns <= p.stepOut; turns += 0.1) {
        const w = effectiveWindow(m, 0, turns * 360, t);
        const sh = wobbleOf(m, turns * 360, t);
        assert.ok(w <= prevW + 1e-9 && sh >= prevS - 1e-9, `${mid}/${t.id}: window only shrinks, shake only grows`);
        prevW = w;
        prevS = sh;
      }
      assert.ok(effectiveWindow(m, 0, p.stepOut * 360, t) < effectiveWindow(m, 0, p.sweetFrom * 360, t) * 0.9);
    }
  }
  // Rookie stays forgiving: gentler shrink, later onset
  const w = (m) => effectiveWindow(MODES[m], 0, 4.8 * 360) / effectiveWindow(MODES[m], 0, 3 * 360);
  assert.ok(w('rookie') > w('pro'), 'rookie keeps more of its window when overcharged');
  assert.ok(chargeProfile(MODES.rookie).overFrom > chargeProfile(MODES.pro).overFrom);
});

test('overcharging costs accuracy, not a foul: the same dial error lands wider with a shrunken green', () => {
  const at = (turns, psi) => {
    const { params, meta } = releaseParams(MODES.pro, { psi, rot: turns * 360, power: 1, attitude: 25, wind: { x: 0, z: 0 } });
    return { az: Math.abs(run(params).azimuth), meta };
  };
  const sweet = at(3.3, 20);
  const over = at(4.7, 20);
  assert.ok(!over.meta.foulReason && !sweet.meta.foulReason, 'neither is a foul');
  assert.ok(over.az > sweet.az * 1.2, `azimuth ${over.az.toFixed(1)} (overcharged) vs ${sweet.az.toFixed(1)} (sweet)`);
});

test('camera presets cycle in order and wrap', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ['broadcast', 'behind', 'side', 'disc', 'overhead']);
  let id = 'broadcast';
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push((id = nextPreset(id)));
  assert.deepEqual(seen, ['behind', 'side', 'disc', 'overhead', 'broadcast']);
  assert.equal(nextPreset('broadcast', -1), 'overhead');
});

test('camera net collision: a sight line through two nets (or one right in front of the lens) is blocked, and clearCamera fixes it', () => {
  const ath = { x: 0, y: 1.2, z: 0 };
  assert.ok(netHits({ x: -12, y: 1.8, z: 0 }, ath).length >= 1, 'a side view crosses the net');
  assert.ok(viewBlocked({ x: 3.7, y: 1.5, z: 0.05 }, ath), 'a lens pressed against the net is blocked');
  assert.ok(!viewBlocked({ x: 0, y: 15, z: 6.5 }, ath), 'over the top is clear');
  // every camera on rings round the circle, at heights a broadcast camera uses, resolves to a clear view
  for (const r of [6, 8, 11]) for (const y of [1.5, 2.5, 4]) for (let a = 0; a < 360; a += 7) {
    const c = { x: Math.cos((a * Math.PI) / 180) * r, y, z: Math.sin((a * Math.PI) / 180) * r };
    const fixed = clearCamera(c, ath);
    assert.ok(!viewBlocked(fixed, ath), `r${r} y${y} a${a} resolves to a clear view`);
    assert.ok(Math.abs(Math.hypot(fixed.x, fixed.z) - r) < 1e-6 || fixed.y > 6, 'same radius (or lifted over the nets)');
  }
  // the shots the game uses are already clear
  for (const c of [{ x: 5.4, y: 2.75, z: 9.8 }, { x: 3.2, y: 3, z: 10.8 }, { x: 1.3, y: 2.1, z: 7.2 }, { x: -13.5, y: 1.8, z: -4.5 }, { x: 1.6, y: 1.5, z: 3.1 }, { x: 0.6, y: 15.5, z: 5.5 }])
    assert.ok(!viewBlocked(c, ath), `preset shot ${JSON.stringify(c)} is not blocked`);
});
