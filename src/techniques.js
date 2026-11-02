// DISCUS DISASTER - throwing techniques. Pure data (no DOM, no three.js) so Node tests import it directly.
// All five are ORIGINAL, generic style names: no real athletes, no real signature moves, no footage.
//
// Every technique maps to the SAME physics inputs the release already uses (see modes.js releaseParams):
//   speed   multiplies the release speed (power -> m/s)
//   angle   adds degrees to the release angle (dial position still decides the base angle)
//   nose    adds degrees to the nose angle (Pro: on top of yours; Rookie: half of it on top of the auto-nose)
//   window  multiplies the green release window (and so how hard a dial error is punished)
//   turns   multiplies the turns needed for full power (and the whole sweet-spot / overcharge band with it)
//   overK   multiplies the overcharge penalty (how fast the window shrinks / the needle shakes past the sweet spot)
//   jitter  constant needle shake, in dial degrees (a loose, whippy technique)
// `pose` bends the in-game athlete (actors.js setStyle) so the demo and the real throw look different:
//   crouch (knee bend x), spread (leg splay, rad), lean (torso lean, rad), arm (throwing-arm lift, rad), bob (knee bob x).
// `demoTurn` = dial rotation (deg) at which the picker demo releases; 180 + 360 k lines the athlete up with the sector.
//
// Numbers are tuned against the simulator (tests/techniques.test.mjs): Wide-Leg Reverse is the neutral baseline
// (Pro perfect release ~66 m median); the others trade distance, control and wind for a different shape of throw.
// In this model a headwind favours a flat, fast throw and a tailwind favours a higher nose, hence the wind notes.

export const REAL_TECHNIQUE_URL = 'https://worldathletics.org/disciplines/throws/discus-throw';
export const DEFAULT_TECHNIQUE = 'wide';

export const TECHNIQUES = [
  {
    id: 'power',
    name: 'Power Spin',
    up: '+SPEED',
    down: '\u2212CONTROL',
    blurb: 'Whip it round harder: more speed, but it needs more turns and the green is small and shaky.',
    speed: 1.008, angle: 0, nose: 0, window: 0.8, turns: 1.12, overK: 1.3, jitter: 3,
    pose: { crouch: 1.35, spread: 0.08, lean: 0.12, arm: 0, bob: 1.15 },
    demoTurn: 900,
  },
  {
    id: 'wide',
    name: 'Wide-Leg Reverse',
    up: 'BALANCED',
    down: '',
    blurb: 'The all-rounder: a wide base and a clean release. No bonus, no penalty.',
    speed: 1, angle: 0, nose: 0, window: 1, turns: 1, overK: 1, jitter: 0,
    pose: { crouch: 1, spread: 0.22, lean: 0, arm: 0, bob: 1 },
    demoTurn: 900,
  },
  {
    id: 'low',
    name: 'Low Arc',
    up: '+HEADWIND',
    down: '\u2212TAILWIND',
    blurb: 'Flat and fast. Skims into a headwind, but gives distance away in a tailwind.',
    speed: 1.01, angle: -6, nose: -3, window: 1, turns: 1, overK: 1, jitter: 0,
    pose: { crouch: 1.5, spread: 0.1, lean: 0.18, arm: -0.25, bob: 1 },
    demoTurn: 900,
  },
  {
    id: 'floater',
    name: 'Floater',
    up: '+TAILWIND',
    down: '\u2212HEADWIND',
    blurb: 'Nose up and a high hang. Floats on a tailwind, but a headwind pushes it back.',
    speed: 1.005, angle: 5, nose: 5, window: 1, turns: 1, overK: 1, jitter: 0,
    pose: { crouch: 0.8, spread: 0.12, lean: -0.08, arm: 0.35, bob: 0.9 },
    demoTurn: 900,
  },
  {
    id: 'standing',
    name: 'Standing Throw',
    up: '+EASY',
    down: '\u2212DISTANCE',
    blurb: 'Feet planted, almost no spin. Very forgiving, but it will not go far.',
    speed: 0.8, angle: 0, nose: 0, window: 1.4, turns: 0.55, overK: 0.4, jitter: 0,
    pose: { crouch: 0.6, spread: 0.18, lean: 0.05, arm: 0, bob: 0 },
    demoTurn: 180,
  },
];

export const techniqueOf = (id) => TECHNIQUES.find((t) => t.id === id) || TECHNIQUES.find((t) => t.id === DEFAULT_TECHNIQUE);
export const techniqueIndex = (id) => Math.max(0, TECHNIQUES.findIndex((t) => t.id === id));
export const isTechnique = (id) => TECHNIQUES.some((t) => t.id === id);
