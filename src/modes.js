// DISCUS DISASTER - difficulty modes. Pure module (no DOM / three.js) so Node tests can import it.
//
// PRO is the original game, untouched: dial window +-40 deg, heading and release angle straight off the dial, an
// instant tap or a release behind the thrower hits the cage, and the player owns the nose angle.
// ROOKIE keeps the SAME flight physics and the same top speed (V_MAX) but forgives the human part:
//   - a wider green window on the first throws (62 / 56 / 50 deg), the needle slows while it is in the green;
//   - heading and release angle are compressed so anything released in the green lands in the sector at a sane angle;
//   - the nose angle snaps to the best one for the actual release + wind unless the player drags it
//     (power still builds at the Pro rate: a rookie who waits ~3 turns throws as far as a pro, a 1.5-turn flick does not);
//   - a tap or a release behind the thrower is a playful short toss instead of a cage foul.
//
// CHARGE: power builds with every turn up to a SWEET SPOT (full power, still accurate). Spin on past `overFrom` turns
// and the release degrades smoothly instead of just fouling: the green window shrinks (so the same dial error flings
// the disc wider) and the needle shakes. Only 5 turns steps out of the circle. A technique (techniques.js) shifts the
// whole band: Standing Throw peaks early, Power Spin needs more turns.
import { optimalAttitude, simulate, SECTOR_HALF_ANGLE } from './physics.js';
import { powerOf, speedOf, releaseAngleOf, FULL_TURNS, STEPOUT_TURNS } from './tuning.js';
import { techniqueOf } from './techniques.js';
import { gripOf } from './weather.js';

export const WINDOW_HALF_PRO = 40;
export const HEAD_FACTOR_PRO = SECTOR_HALF_ANGLE / WINDOW_HALF_PRO; // pro: window edge == sector edge

export const MODES = {
  rookie: {
    id: 'rookie',
    label: 'Rookie',
    blurb: 'Wide window, auto nose, friendly taps',
    windowHalf: [62, 56, 50],
    perfectHalf: 9,
    fullTurns: 3.1,
    headingScale: 0.7,
    angleScale: 0.5,
    needleSlow: 0.35, // the dial turns up to 35% slower inside the green
    overFrom: 4.2, // turns where overcharge starts (the sweet spot is ~2.8 .. overFrom)
    overShrink: 0.3, // at 5 turns the green window is 30% narrower
    overWobble: 9, // needle shake (deg) at 5 turns
    noseAssist: true,
    shortToss: true,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    blurb: 'The real thing: tight window, you set the nose',
    windowHalf: [40, 40, 40],
    perfectHalf: 4,
    fullTurns: FULL_TURNS,
    headingScale: 1,
    angleScale: 1,
    needleSlow: 0,
    overFrom: 3.7,
    overShrink: 0.5,
    overWobble: 16,
    noseAssist: false,
    shortToss: false,
  },
};

export const modeOf = (id) => MODES[id] || MODES.rookie;
export const windowHalfFor = (mode, attempt = 0) => mode.windowHalf[Math.min(mode.windowHalf.length - 1, Math.max(0, attempt))];
export const NOSE_MIN = -5;
export const NOSE_MAX = 50;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Power 0..1 after `rot` degrees of spin (a technique can shorten / lengthen the build-up). */
export const powerFor = (mode, rot, tech = techniqueOf()) => powerOf(rot, mode.fullTurns * tech.turns);

/**
 * The charge meter's zones, in turns of spin: BUILD (0 .. sweetFrom), SWEET (sweetFrom .. overFrom: ~full power, accurate),
 * OVERCHARGE (overFrom .. stepOut: accuracy degrades), then a step-out foul at `stepOut`.
 */
export function chargeProfile(mode, tech = techniqueOf()) {
  const full = mode.fullTurns * tech.turns;
  const stepOut = STEPOUT_TURNS;
  const overFrom = Math.min(mode.overFrom * tech.turns, stepOut - 0.8);
  const sweetFrom = Math.min(full * 0.911, overFrom - 0.25); // power >= ~0.92
  return { full, sweetFrom, sweetTo: overFrom, overFrom, stepOut };
}

/** 0 inside the sweet spot, rising smoothly to 1 at the step-out turn. */
export function overchargeOf(mode, rot, tech = techniqueOf()) {
  const { overFrom, stepOut } = chargeProfile(mode, tech);
  const t = clamp((rot / 360 - overFrom) / (stepOut - overFrom), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Half-width (deg) of the green window right now: the mode's window x technique, shrunk by overcharge. */
export function effectiveWindow(mode, attempt, rot, tech = techniqueOf(), weather) {
  const over = overchargeOf(mode, rot, tech);
  const w = windowHalfFor(mode, attempt) * tech.window * gripOf(weather) * (1 - mode.overShrink * tech.overK * over);
  return clamp(w, 16, 85);
}

/** Needle shake (deg of amplitude) from overcharge plus the technique's own looseness. */
export const wobbleOf = (mode, rot, tech = techniqueOf()) => overchargeOf(mode, rot, tech) * mode.overWobble * tech.overK + tech.jitter;

/** Best nose angle for a release (what the Rookie assist snaps to). Coarse scan + refine, ~30 short simulations. */
export function assistNose(release) {
  const { speed, releaseAngle, heading = 0, wind } = release;
  return optimalAttitude({ speed, releaseAngle, heading, wind }, { min: -5, max: 45, step: 2 }).attitude;
}

/** The nose angle the Rookie auto-nose eases toward before the release (a typical good release for this wind and technique). */
export function assistTarget(mode, tech, wind) {
  const t = tech || techniqueOf();
  const p = { speed: speedOf(0.9) * t.speed, releaseAngle: clamp(33 + t.angle, 8, 58), heading: 0, wind };
  return clamp(assistNose(p) + 0.5 * t.nose, NOSE_MIN, NOSE_MAX);
}

/**
 * Turn "what the player did" (dial angle psi, spin rotation, power) into flight parameters + metadata.
 * attitude: a number (the player's nose angle) or 'auto' (Rookie assist: use the optimum for this release).
 * `technique` (an id or a techniques.js entry) scales the speed / window and biases the angles; the default is neutral.
 * Returns { params, meta } where meta = { foulReason, tap, short, perfect, inWindow, window, over, technique }.
 */
export function releaseParams(mode, { psi, rot = 0, power, attitude, wind, attempt = 0, technique, weather }) {
  const tech = typeof technique === 'object' && technique ? technique : techniqueOf(technique);
  const win = effectiveWindow(mode, attempt, rot, tech, weather);
  const speed = speedOf(power) * tech.speed;
  const meta = { foulReason: null, tap: false, short: false, perfect: false, inWindow: Math.abs(psi) <= win, window: win, over: overchargeOf(mode, rot, tech), technique: tech.id };
  let params;
  if (Math.abs(psi) > 90) {
    if (mode.shortToss) {
      // playful short toss (~18 m): never a cage foul in Rookie
      params = { speed: clamp(speed * 0.5, 12.5, 15), releaseAngle: 38, heading: clamp(psi * 0.03, -4, 4), wind };
      meta.short = true;
      meta.tap = rot < 120;
    } else {
      // released behind the thrower: straight into the cage
      params = { speed: Math.max(4, speed * 0.28), releaseAngle: 25, heading: 180 + psi * 0.2, wind };
      meta.foulReason = 'cage';
      meta.tap = rot < 120;
    }
  } else {
    const e = clamp(psi, -90, 90) * (WINDOW_HALF_PRO / win); // dial angle expressed in Pro dial units
    params = {
      speed,
      releaseAngle: clamp(releaseAngleOf(e * mode.angleScale) + tech.angle, 8, 58),
      heading: e * HEAD_FACTOR_PRO * mode.headingScale,
      wind,
    };
    meta.perfect = Math.abs(psi) <= mode.perfectHalf;
  }
  params.attitude = attitude === 'auto' ? clamp(assistNose(params) + 0.5 * tech.nose, NOSE_MIN, NOSE_MAX) : clamp(attitude + tech.nose, NOSE_MIN, NOSE_MAX);
  return { params, meta };
}

/** A perfect, still-air release with this technique: the flight the picker sketches and the demo disc follows. */
export function previewFlight(mode, tech) {
  const { params } = releaseParams(mode, { psi: 0, rot: chargeProfile(mode, tech).full * 360, power: 1, attitude: 25, wind: { x: 0, z: 0 }, technique: tech });
  const r = simulate(params, { sampleEvery: 12 });
  return { params, samples: r.samples, distance: r.distance };
}
