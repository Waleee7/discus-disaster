// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate,
  coefficients,
  airDensity,
  optimalAttitude,
  createFlight,
  stepFlight,
  discusNormal,
  formatFeetInches,
  mulberry32,
  G,
  DEG,
} from '../src/physics.js';

const run = (p) => simulate(p, { sampleEvery: 1e9 });
const VACUUM = () => ({ cl: 0, cd: 0 });

test('vacuum, zero-lift case matches the analytic projectile range within 1%', () => {
  for (const [v, ang, h] of [
    [25, 35, 0],
    [25, 45, 0],
    [20, 30, 1.8],
    [26, 38, 1.6],
  ]) {
    const r = simulate({ speed: v, releaseAngle: ang, releaseHeight: h, originOffset: 0, rho: 0, coeffs: VACUUM }, { sampleEvery: 1e9 });
    const th = ang * DEG;
    const analytic = ((v * Math.cos(th)) / G) * (v * Math.sin(th) + Math.sqrt((v * Math.sin(th)) ** 2 + 2 * G * h));
    const err = Math.abs(r.downrange - analytic) / analytic;
    assert.ok(err < 0.01, `v=${v} ang=${ang} h=${h}: sim ${r.downrange.toFixed(3)} vs analytic ${analytic.toFixed(3)} (${(err * 100).toFixed(3)}%)`);
  }
});

test('density model: sea level 20C ~1.20 kg/m3, thinner at altitude (Mexico City ~2240 m)', () => {
  assert.ok(Math.abs(airDensity(20, 0) - 1.204) < 0.01);
  assert.ok(airDensity(20, 2240) < airDensity(20, 0) * 0.82);
});

test('a moderate headwind increases range vs still air for a well-attituded throw', () => {
  const base = { speed: 25, releaseAngle: 35, attitude: 25 };
  const still = run(base).range;
  for (const hw of [1, 2, 3, 4]) {
    const windy = run({ ...base, wind: { x: -hw } }).range;
    assert.ok(windy > still, `headwind ${hw} m/s: ${windy.toFixed(2)} should beat still air ${still.toFixed(2)}`);
  }
  // ...and a tailwind hurts
  assert.ok(run({ ...base, wind: { x: 3 } }).range < still);
});

test('extreme angle of attack stalls and shortens range', () => {
  const good = run({ speed: 25, releaseAngle: 35, attitude: 25 });
  const stalled = run({ speed: 25, releaseAngle: 35, attitude: 70 }); // nose way up -> ~35 deg AoA at release, worse later
  assert.ok(stalled.range < good.range - 8, `stalled ${stalled.range.toFixed(1)} vs good ${good.range.toFixed(1)}`);
  assert.ok(stalled.maxAlpha > 40 * DEG);
  // lift coefficient actually collapses past stall (flat-plate regime)
  assert.ok(coefficients(20 * DEG).cl > coefficients(60 * DEG).cl);
  assert.ok(coefficients(80 * DEG).cd > 3 * coefficients(5 * DEG).cd);
});

test('realistic release (~25 m/s, ~35 deg, 25-30 deg attitude) lands roughly 55-75 m', () => {
  for (const attitude of [25, 28, 30]) {
    const r = run({ speed: 25, releaseAngle: 35, attitude });
    assert.ok(r.distance > 55 && r.distance < 75, `attitude ${attitude}: ${r.distance.toFixed(1)} m`);
    assert.ok(r.flightTime > 3 && r.flightTime < 4.5);
  }
});

test('aerodynamics beat vacuum for a good throw (lift > extra drag) by a believable margin', () => {
  const vac = run({ speed: 25, releaseAngle: 35, rho: 0, coeffs: VACUUM }).range;
  const air = run({ speed: 25, releaseAngle: 35, attitude: 25 }).range;
  assert.ok(air > vac + 2 && air < vac + 10, `vac ${vac.toFixed(1)} air ${air.toFixed(1)}`);
});

test('crosswind pushes the discus downwind; lateral drift scales with wind', () => {
  const calm = run({ speed: 25, releaseAngle: 35, attitude: 25 });
  const right = run({ speed: 25, releaseAngle: 35, attitude: 25, wind: { z: 4 } });
  const left = run({ speed: 25, releaseAngle: 35, attitude: 25, wind: { z: -4 } });
  assert.ok(Math.abs(calm.landing.z) < 1e-6);
  assert.ok(right.landing.z > 1 && left.landing.z < -1);
  assert.ok(Math.abs(right.landing.z + left.landing.z) < 0.01, 'symmetric');
});

test('deterministic: same inputs give bit-identical trajectories', () => {
  const p = { speed: 24.3, releaseAngle: 33.3, attitude: 22, heading: 7, wind: { x: -2.2, z: 1.1 } };
  const a = simulate(p);
  const b = simulate(p);
  assert.deepEqual(a.samples, b.samples);
  assert.equal(a.distance, b.distance);
});

test('stepper and simulate() agree; landing point is interpolated onto y = 0', () => {
  const p = { speed: 25, releaseAngle: 35, attitude: 25 };
  const f = createFlight(p);
  while (!f.landed) stepFlight(f);
  const r = run(p);
  assert.equal(f.s.x, r.landing.x);
  assert.equal(f.s.y, 0);
});

test('optimalAttitude finds an attitude at least as good as any coarse sample, and it drops into a headwind-free sweep', () => {
  const p = { speed: 25, releaseAngle: 35 };
  const best = optimalAttitude(p);
  for (const a of [0, 10, 20, 30, 40]) assert.ok(best.range >= run({ ...p, attitude: a }).range - 1e-9);
  assert.ok(best.attitude > 10 && best.attitude < 35, `optimum ${best.attitude}`);
});

test('disc normal is a unit vector and tilts nose-up/back', () => {
  const n = discusNormal(30, 10, 5);
  assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-12);
  assert.ok(discusNormal(30)[0] < 0, 'normal leans backward for a nose-up disc');
});

test('helpers: feet/inches formatting and seeded PRNG are stable', () => {
  assert.equal(formatFeetInches(74.35), `243' 11"`);
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  assert.equal(r1(), r2());
});
