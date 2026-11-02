// Rookie vs Pro: the mapping from "what the player did" to flight parameters (pure logic, no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, mulberry32, SECTOR_HALF_ANGLE } from '../src/physics.js';
import { speedOf, releaseAngleOf } from '../src/tuning.js';
import { MODES, releaseParams, powerFor, windowHalfFor, HEAD_FACTOR_PRO } from '../src/modes.js';

const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const randWind = (r) => ({ x: -(-2.5 + r() * 8.5), z: -4 + r() * 8 }); // same ranges as makeLayout
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/** Resolve one release the way the game does: legal marks in metres, 0 for a foul. */
function resolve(mode, { psi, rot = 540, power, wind, attempt = 0, attitude }) {
  const { params, meta } = releaseParams(mode, { psi, rot, power, attitude: attitude ?? (mode.noseAssist ? 'auto' : 25), wind, attempt });
  if (meta.foulReason) return { d: 0, foul: true, meta };
  const r = simulate(params, { sampleEvery: 1e9 });
  const foul = Math.abs(r.azimuth) > SECTOR_HALF_ANGLE || r.landing.x < 0;
  return { d: foul ? 0 : r.distance, foul, meta, params };
}

test('Pro mode is the original mapping: window +-40, heading = dial * sector/40, cage behind the thrower', () => {
  const wind = { x: -2, z: 1 };
  for (const psi of [-80, -35, 0, 12, 40, 85]) {
    const { params, meta } = releaseParams(MODES.pro, { psi, rot: 700, power: 0.8, attitude: 25, wind });
    assert.equal(params.speed, speedOf(0.8));
    assert.equal(params.releaseAngle, releaseAngleOf(psi));
    assert.equal(params.heading, psi * HEAD_FACTOR_PRO);
    assert.equal(params.attitude, 25);
    assert.equal(meta.foulReason, null);
    assert.equal(meta.inWindow, Math.abs(psi) <= 40);
  }
  const behind = releaseParams(MODES.pro, { psi: 170, rot: 30, power: 0.05, attitude: 25, wind });
  assert.equal(behind.meta.foulReason, 'cage');
  assert.ok(behind.meta.tap, 'an instant tap is flagged as a tap');
  assert.equal(windowHalfFor(MODES.pro, 0), 40);
  assert.equal(windowHalfFor(MODES.pro, 2), 40);
});

test('Rookie: wider window on the first throws, narrowing toward Pro; PERFECT is a wider centre band', () => {
  const w = [0, 1, 2].map((a) => windowHalfFor(MODES.rookie, a));
  assert.ok(w[0] > w[1] && w[1] > w[2] && w[2] > 40, `windows ${w}`);
  assert.ok(MODES.rookie.perfectHalf > MODES.pro.perfectHalf);
  assert.equal(MODES.rookie.fullTurns, MODES.pro.fullTurns, 'same power curve: a rookie still has to wait for power');
  assert.equal(powerFor(MODES.rookie, 900), powerFor(MODES.pro, 900));
});

test('Rookie: a tap or a release behind the thrower is a playful short throw, never a cage foul', () => {
  const wind = { x: -1, z: 0.5 };
  for (const [psi, rot] of [[180, 0], [172, 12], [-175, 350], [120, 60]]) {
    const r = resolve(MODES.rookie, { psi, rot, power: 0.02, wind });
    assert.ok(!r.foul, `psi ${psi}: legal`);
    assert.ok(r.meta.short);
    assert.ok(r.d > 8 && r.d < 30, `short toss ${r.d.toFixed(1)} m is short but real`);
    const p = resolve(MODES.pro, { psi, rot, power: 0.02, wind });
    assert.ok(p.foul, 'the same press is still a cage foul in Pro');
  }
});

test('Rookie assist helps a mid-quality release: lands farther and is legal more often than Pro', () => {
  // "Mid quality" = decent power (~2.5 turns) released anywhere from well early to well late (+-75 deg of the dial),
  // random game winds. Pro gets the usual default nose (25 deg); Rookie gets the wide window, calmer heading and auto nose.
  const rnd = mulberry32(99);
  const stats = { rookie: { legal: 0, sum: 0, n: 0 }, pro: { legal: 0, sum: 0, n: 0 } };
  for (let i = 0; i < 400; i++) {
    const psi = (rnd() * 2 - 1) * 75;
    const power = 0.7 + rnd() * 0.25;
    const wind = randWind(rnd);
    for (const id of ['rookie', 'pro']) {
      const r = resolve(MODES[id], { psi, power, wind });
      const s = stats[id];
      s.n++;
      s.sum += r.d;
      if (!r.foul) s.legal++;
    }
  }
  const legal = (id) => stats[id].legal / stats[id].n;
  const mean = (id) => stats[id].sum / stats[id].n;
  assert.ok(legal('rookie') > legal('pro') + 0.2, `legal: rookie ${legal('rookie').toFixed(2)} vs pro ${legal('pro').toFixed(2)}`);
  assert.ok(mean('rookie') > mean('pro') + 8, `mean mark (fouls = 0): rookie ${mean('rookie').toFixed(1)} vs pro ${mean('pro').toFixed(1)}`);
  assert.ok(legal('rookie') > 0.85, 'a sloppy rookie is legal most of the time');
});

test('Rookie nose assist beats the lazy default nose at the same release (tailwind and headwind)', () => {
  for (const wx of [4, -5]) {
    const wind = { x: wx, z: 0 }; // x > 0 tailwind
    const base = { psi: 0, rot: 900, power: 0.9, wind };
    const auto = resolve(MODES.rookie, { ...base, attitude: 'auto' });
    const lazy = resolve(MODES.rookie, { ...base, attitude: 5 });
    assert.ok(auto.d > lazy.d + 2, `wind ${wx}: auto ${auto.d.toFixed(1)} vs lazy nose ${lazy.d.toFixed(1)}`);
  }
});

test('Rookie: an average first-timer lands 45-65 m within 3 throws (Pro keeps its harder spread)', () => {
  // Player model: releases on the green after ~1.5 / 2.5 / 3.5 turns (weights 1:3:1 across the 5 throw "habits" below),
  // with +-45 deg of timing error (1 sigma) - a person who looks at the needle but is not precise.
  const habits = [1, 2, 2, 2, 3]; // k: release near rot = 180 + 360 k
  const run = (id, N = 300) => {
    const r = mulberry32(5);
    const best = [];
    let legal = 0;
    let total = 0;
    for (let p = 0; p < N; p++) {
      let b = 0;
      for (let a = 0; a < 3; a++) {
        const k = habits[Math.floor(r() * habits.length)];
        const rot = Math.max(0, 180 + 360 * k + gauss(r) * 45);
        const psi = wrap180(180 - rot);
        const res = resolve(MODES[id], { psi, rot, power: powerFor(MODES[id], rot), wind: randWind(r), attempt: a });
        total++;
        if (!res.foul) legal++;
        b = Math.max(b, res.d);
      }
      best.push(b);
    }
    best.sort((x, y) => x - y);
    return { median: median(best), p10: best[Math.floor(N * 0.1)], legal: legal / total };
  };
  const rookie = run('rookie');
  const pro = run('pro');
  assert.ok(rookie.median >= 45 && rookie.median <= 65, `rookie median best-of-3 ${rookie.median.toFixed(1)} m`);
  assert.ok(rookie.p10 >= 45, `even the unlucky 10% of rookies reach 45 m: ${rookie.p10.toFixed(1)}`);
  assert.ok(rookie.legal > 0.9, `rookie legal share ${rookie.legal.toFixed(2)}`);
  assert.ok(pro.legal < rookie.legal - 0.25, `pro legal ${pro.legal.toFixed(2)} vs rookie ${rookie.legal.toFixed(2)}`);
});

test('Rookie cannot out-throw the physics: a perfect rookie release is no farther than a perfect Pro release', () => {
  const wind = { x: 0, z: 0 };
  const best = (mode) => Math.max(...[0, 2].map((psi) => resolve(mode, { psi, power: 1, wind, attitude: mode.noseAssist ? 'auto' : 24 }).d));
  assert.ok(best(MODES.rookie) <= best(MODES.pro) + 1.5, `rookie ${best(MODES.rookie).toFixed(1)} vs pro ${best(MODES.pro).toFixed(1)}`);
});
