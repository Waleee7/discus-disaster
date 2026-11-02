// DISCUS DISASTER - throw tuning (pure module: no DOM, no three.js, so Node tests can import it).

export const FULL_TURNS = 3.1; // power tops out here
export const DIZZY_TURNS = 4.1;
export const STEPOUT_TURNS = 5.0;
export const V_MIN = 11; // m/s at zero power
// Max release speed. Tuned so a PERFECT throw (full power, dial centred, sensible nose) lands ~65-70 m in
// still air; the 74.35 m world record then needs a perfect release AND a good headwind (or a lucky bounce
// off the cast). See tests/physics.test.mjs ("perfect throws" sweep).
export const V_MAX = 25.0;

export const powerOf = (rot) => Math.min(1, Math.pow(rot / (FULL_TURNS * 360), 0.9));
export const speedOf = (p) => V_MIN + (V_MAX - V_MIN) * p;
export const releaseAngleOf = (psi) => Math.min(55, Math.max(12, 35 - 0.3 * psi));
