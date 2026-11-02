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
import { optimalAttitude, SECTOR_HALF_ANGLE } from './physics.js';
import { powerOf, speedOf, releaseAngleOf, FULL_TURNS } from './tuning.js';

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
    noseAssist: false,
    shortToss: false,
  },
};

export const modeOf = (id) => MODES[id] || MODES.rookie;
export const windowHalfFor = (mode, attempt = 0) => mode.windowHalf[Math.min(mode.windowHalf.length - 1, Math.max(0, attempt))];
export const powerFor = (mode, rot) => powerOf(rot, mode.fullTurns);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Best nose angle for a release (what the Rookie assist snaps to). Coarse scan + refine, ~30 short simulations. */
export function assistNose(release) {
  const { speed, releaseAngle, heading = 0, wind } = release;
  return optimalAttitude({ speed, releaseAngle, heading, wind }, { min: -5, max: 45, step: 2 }).attitude;
}

/**
 * Turn "what the player did" (dial angle psi, spin rotation, power) into flight parameters + metadata.
 * attitude: a number (the player's nose angle) or 'auto' (Rookie assist: use the optimum for this release).
 * Returns { params, meta } where meta = { foulReason, tap, short, perfect, inWindow }.
 */
export function releaseParams(mode, { psi, rot = 0, power, attitude, wind, attempt = 0 }) {
  const win = windowHalfFor(mode, attempt);
  const speed = speedOf(power);
  const meta = { foulReason: null, tap: false, short: false, perfect: false, inWindow: Math.abs(psi) <= win };
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
      releaseAngle: releaseAngleOf(e * mode.angleScale),
      heading: e * HEAD_FACTOR_PRO * mode.headingScale,
      wind,
    };
    meta.perfect = Math.abs(psi) <= mode.perfectHalf;
  }
  params.attitude = attitude === 'auto' ? assistNose(params) : attitude;
  return { params, meta };
}
