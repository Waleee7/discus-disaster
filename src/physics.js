// DISCUS DISASTER - flight physics (pure module, no DOM, deterministic).
//
// Frame: +x = downrange (throw direction at heading 0), +y = up, +z = to the thrower's right.
// Units: SI (m, s, kg, N). Angles are DEGREES at the API boundary, radians inside.
//
// Model summary
// -------------
// The discus is a point mass with a fixed-orientation disc (gyroscopic stability: the spin axis
// is treated as constant in space during the ~3-4 s flight; precession/pitching moment is ignored).
// Aerodynamic force = drag (opposite to the AIR-RELATIVE velocity) + lift (perpendicular to that
// velocity, in the plane containing the velocity and the disc normal).
//
//   q = 1/2 * rho * |v_rel|^2
//   D = q * A * C_D(alpha)          L = q * A * C_L(alpha)
//   alpha = angle of attack = angle between v_rel and the disc plane
//         = attitude angle - flight path angle (in the vertical plane, no wind)
//
// Coefficient curves C_L(alpha), C_D(alpha) are APPROXIMATIONS built to resemble the published
// shape of discus wind-tunnel / flight data (not quotes of any table):
//   * Frohlich, C. (1981) "Aerodynamic and mechanical forces in discus flight", Am. J. Phys. 49.
//   * Hubbard, M. & Cheng, K.B. (2007) "Optimal discus trajectories", J. Biomechanics 40.
//   * Ganslen, R.V. (1964) wind-tunnel work on discus lift/drag, for the qualitative shape.
// Shape used here: a low-aspect-ratio wing (lift slope ~ 1.9/rad, small positive lift at
// alpha = 0 from the dished camber, induced-drag-like quadratic drag growth), which stalls
// around alpha ~ 25-30 deg and then behaves like a flat plate (C_L ~ sin(2a), C_D ~ sin^2(a)).
//
// The headwind quirk: a headwind raises the air-relative speed, so lift grows ~ v_rel^2 and,
// for a discus released with a small/negative angle of attack, the lift gain outweighs the extra
// drag over a moderate range of wind speeds. That's why a discus can fly farther into a breeze.

export const G = 9.80665;
export const DEG = Math.PI / 180;

export const DISCUS = Object.freeze({
  mass: 2.0, // kg, men's competition discus (min. 2.0 kg)
  diameter: 0.221, // m, ~ 219-221 mm
  area: Math.PI * (0.221 / 2) ** 2, // reference area (planform), m^2
});

export const CIRCLE_RADIUS = 1.25; // m (2.50 m diameter throwing circle)
export const SECTOR_HALF_ANGLE = 17.46; // deg (34.92 deg landing sector)
export const WORLD_RECORD_M = 74.35; // m - real-world men's discus WR, Mykolas Alekna (LTU), 2024

/** Air density from temperature (C) and altitude (m) via ideal gas + ISA pressure lapse. */
export function airDensity(tempC = 20, altitudeM = 0) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  return p / (287.05 * (tempC + 273.15));
}

export const RHO_DEFAULT = airDensity(20, 0); // ~1.204 kg/m^3

// --- aerodynamic coefficient model (alpha in radians) ---------------------------------------
const CL_SLOPE = 1.6; // per rad, low-aspect-ratio disc
const ALPHA_ZERO_LIFT = -4 * DEG; // dished profile keeps a little lift at alpha = 0
const CD0 = 0.07;
const CD_K = 0.9;
const STALL_ALPHA = 0.43; // rad (~25 deg): onset of separation
const STALL_BLEND = 0.35; // rad: width of the attached -> separated blend
const CN90 = 1.17; // flat-plate normal force coefficient at 90 deg (disc, finite aspect)

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Lift and drag coefficients as a function of angle of attack (radians). */
export function coefficients(alpha) {
  const a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, alpha));
  const abs = Math.abs(a);
  // attached flow: linear lift, quadratic drag about the zero-lift angle (alpha clamped at stall)
  const ac = Math.sign(a) * Math.min(abs, STALL_ALPHA);
  const clAtt = CL_SLOPE * (ac - ALPHA_ZERO_LIFT);
  const cdAtt = CD0 + CD_K * (ac - ALPHA_ZERO_LIFT) ** 2;
  // separated flow (flat plate)
  const s = Math.sin(a);
  const c = Math.cos(a);
  const clSep = CN90 * s * c;
  const cdSep = CD0 + CN90 * s * s;
  const w = smoothstep(STALL_ALPHA, STALL_ALPHA + STALL_BLEND, abs);
  return { cl: clAtt * (1 - w) + clSep * w, cd: cdAtt * (1 - w) + cdSep * w };
}

// --- geometry helpers -----------------------------------------------------------------------
/** Unit normal of the disc plane. attitude = nose-up angle, roll = right edge down, heading = azimuth (+ = right). */
export function discusNormal(attitudeDeg, rollDeg = 0, headingDeg = 0) {
  const th = attitudeDeg * DEG;
  const ph = rollDeg * DEG;
  const psi = headingDeg * DEG;
  const f = [Math.cos(psi), 0, Math.sin(psi)];
  const r = [-Math.sin(psi), 0, Math.cos(psi)];
  const cT = Math.cos(th);
  const sT = Math.sin(th);
  const cP = Math.cos(ph);
  const sP = Math.sin(ph);
  return [
    cT * sP * r[0] - sT * f[0],
    cT * cP,
    cT * sP * r[2] - sT * f[2],
  ];
}

const DEFAULTS = {
  speed: 25,
  releaseAngle: 35,
  attitude: 28,
  roll: 0,
  heading: 0,
  releaseHeight: 1.6,
  originOffset: 0.9, // m from circle centre along the heading to the release point
  wind: { x: 0, y: 0, z: 0 }, // air velocity, m/s (negative x = headwind for a throw toward +x)
  rho: RHO_DEFAULT,
  mass: DISCUS.mass,
  area: DISCUS.area,
  dt: 1 / 240,
  crossBank: 1.0, // see accel(): crosswind roll gain (0 = rigid disc)
  coeffs: coefficients, // override with () => ({cl:0, cd:0}) for the vacuum case
};

/** Build a flight object (initial state + resolved parameters). */
export function createFlight(params = {}) {
  const p = { ...DEFAULTS, ...params, wind: { ...DEFAULTS.wind, ...(params.wind || {}) } };
  const gam = p.releaseAngle * DEG;
  const psi = p.heading * DEG;
  const vh = p.speed * Math.cos(gam);
  const s = {
    t: 0,
    x: p.originOffset * Math.cos(psi),
    y: p.releaseHeight,
    z: p.originOffset * Math.sin(psi),
    vx: vh * Math.cos(psi),
    vy: p.speed * Math.sin(gam),
    vz: vh * Math.sin(psi),
  };
  return {
    p,
    n: discusNormal(p.attitude, p.roll, p.heading),
    r: [-Math.sin(psi), 0, Math.cos(psi)],
    s,
    landed: false,
    alpha: 0,
    cl: 0,
    cd: 0,
    maxAlpha: 0,
    alphaRelease: NaN,
    apex: s.y,
    impulse: [0, 0, 0], // external velocity kicks log (collisions), informational
  };
}

/** Aerodynamic + gravity acceleration for velocity v. Writes diagnostic fields into `diag` if given. */
function accel(v, f, out, diag) {
  const { p, n } = f;
  const rx = v[0] - p.wind.x;
  const ry = v[1] - p.wind.y;
  const rz = v[2] - p.wind.z;
  const sp = Math.hypot(rx, ry, rz);
  let ax = 0;
  let ay = -G;
  let az = 0;
  if (sp > 1e-6 && p.rho > 0) {
    const dx = rx / sp;
    const dy = ry / sp;
    const dz = rz / sp;
    // Crosswind "weathervane" bank: the flow component across the throw direction rolls the disc's
    // normal toward the downwind side (gameplay approximation of the aerodynamic roll moment that
    // makes real discs curve in a crosswind; a rigid flat disc alone would barely drift).
    const dlat = dx * f.r[0] + dz * f.r[2];
    let nx = n[0] - p.crossBank * dlat * f.r[0];
    let ny = n[1];
    let nz = n[2] - p.crossBank * dlat * f.r[2];
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const dn = dx * nx + dy * ny + dz * nz;
    const alpha = Math.asin(Math.max(-1, Math.min(1, -dn)));
    const { cl, cd } = p.coeffs(alpha);
    const qa = 0.5 * p.rho * sp * sp * p.area;
    // drag opposes air-relative velocity
    const dr = (-qa * cd) / p.mass;
    ax += dr * dx;
    ay += dr * dy;
    az += dr * dz;
    // lift along the component of n perpendicular to the flow
    const lx = nx - dn * dx;
    const ly = ny - dn * dy;
    const lz = nz - dn * dz;
    const ll = Math.hypot(lx, ly, lz);
    if (ll > 1e-9) {
      const lr = (qa * cl) / (p.mass * ll);
      ax += lr * lx;
      ay += lr * ly;
      az += lr * lz;
    }
    if (diag) {
      diag.alpha = alpha;
      diag.cl = cl;
      diag.cd = cd;
    }
  }
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
}

const _k = [new Array(3), new Array(3), new Array(3), new Array(3)];
const _v = [0, 0, 0];

/** Advance one fixed RK4 step. Handles the ground crossing (linear interpolation of the landing point). */
export function stepFlight(f, dt = f.p.dt) {
  if (f.landed) return f;
  const s = f.s;
  const v0 = [s.vx, s.vy, s.vz];
  const diag = {};
  accel(v0, f, _k[0], diag);
  // RK4 on (position, velocity); acceleration depends only on velocity
  const kv1 = _k[0].slice();
  const kx1 = v0;
  _v[0] = v0[0] + 0.5 * dt * kv1[0];
  _v[1] = v0[1] + 0.5 * dt * kv1[1];
  _v[2] = v0[2] + 0.5 * dt * kv1[2];
  const kx2 = _v.slice();
  accel(_v, f, _k[1]);
  const kv2 = _k[1].slice();
  _v[0] = v0[0] + 0.5 * dt * kv2[0];
  _v[1] = v0[1] + 0.5 * dt * kv2[1];
  _v[2] = v0[2] + 0.5 * dt * kv2[2];
  const kx3 = _v.slice();
  accel(_v, f, _k[2]);
  const kv3 = _k[2].slice();
  _v[0] = v0[0] + dt * kv3[0];
  _v[1] = v0[1] + dt * kv3[1];
  _v[2] = v0[2] + dt * kv3[2];
  const kx4 = _v.slice();
  accel(_v, f, _k[3]);
  const kv4 = _k[3];

  const nx = s.x + (dt / 6) * (kx1[0] + 2 * kx2[0] + 2 * kx3[0] + kx4[0]);
  const ny = s.y + (dt / 6) * (kx1[1] + 2 * kx2[1] + 2 * kx3[1] + kx4[1]);
  const nz = s.z + (dt / 6) * (kx1[2] + 2 * kx2[2] + 2 * kx3[2] + kx4[2]);
  const nvx = s.vx + (dt / 6) * (kv1[0] + 2 * kv2[0] + 2 * kv3[0] + kv4[0]);
  const nvy = s.vy + (dt / 6) * (kv1[1] + 2 * kv2[1] + 2 * kv3[1] + kv4[1]);
  const nvz = s.vz + (dt / 6) * (kv1[2] + 2 * kv2[2] + 2 * kv3[2] + kv4[2]);

  if (Number.isNaN(f.alphaRelease) && diag.alpha !== undefined) f.alphaRelease = diag.alpha;
  if (diag.alpha !== undefined) {
    f.alpha = diag.alpha;
    f.cl = diag.cl;
    f.cd = diag.cd;
    f.maxAlpha = Math.max(f.maxAlpha, Math.abs(diag.alpha));
  }

  if (ny <= 0 && s.vy < 0) {
    const k = s.y / (s.y - ny); // fraction of the step to the ground
    s.x += (nx - s.x) * k;
    s.z += (nz - s.z) * k;
    s.y = 0;
    s.vx += (nvx - s.vx) * k;
    s.vy += (nvy - s.vy) * k;
    s.vz += (nvz - s.vz) * k;
    s.t += dt * k;
    f.landed = true;
    return f;
  }
  s.x = nx;
  s.y = ny;
  s.z = nz;
  s.vx = nvx;
  s.vy = nvy;
  s.vz = nvz;
  s.t += dt;
  if (ny > f.apex) f.apex = ny;
  return f;
}

/** Run a whole flight. Returns a trajectory plus summary values. */
export function simulate(params = {}, { maxTime = 30, sampleEvery = 1 } = {}) {
  const f = createFlight(params);
  const samples = [];
  const record = () => {
    const s = f.s;
    samples.push([s.t, s.x, s.y, s.z, s.vx, s.vy, s.vz, f.alpha]);
  };
  record();
  let i = 0;
  while (!f.landed && f.s.t < maxTime) {
    stepFlight(f);
    if (++i % sampleEvery === 0 || f.landed) record();
  }
  const s = f.s;
  const landing = { x: s.x, y: 0, z: s.z, t: s.t };
  const azimuth = Math.atan2(s.z, s.x) / DEG;
  return {
    samples,
    landing,
    range: Math.hypot(s.x, s.z), // from circle centre
    downrange: s.x,
    distance: Math.max(0, Math.hypot(s.x, s.z) - CIRCLE_RADIUS), // as measured by the judges
    azimuth,
    flightTime: s.t,
    apex: f.apex,
    alphaRelease: f.alphaRelease,
    maxAlpha: f.maxAlpha,
    impactSpeed: Math.hypot(s.vx, s.vy, s.vz),
    params: f.p,
  };
}

/** Scan attitude angles to find the one that maximises distance for the given release (coarse scan + parabola refine). */
export function optimalAttitude(params = {}, { min = -10, max = 45, step = 1 } = {}) {
  let best = { attitude: min, range: -Infinity };
  const ranges = [];
  for (let a = min; a <= max + 1e-9; a += step) {
    const r = simulate({ ...params, attitude: a }, { sampleEvery: 1e9 }).range;
    ranges.push([a, r]);
    if (r > best.range) best = { attitude: a, range: r };
  }
  const i = ranges.findIndex(([a]) => a === best.attitude);
  if (i > 0 && i < ranges.length - 1) {
    const [x0, y0] = ranges[i - 1];
    const [x1, y1] = ranges[i];
    const [, y2] = ranges[i + 1];
    const denom = y0 - 2 * y1 + y2;
    if (denom < 0) {
      const off = (0.5 * (y0 - y2)) / denom;
      const aRef = x1 + off * (x1 - x0);
      const rRef = simulate({ ...params, attitude: aRef }, { sampleEvery: 1e9 }).range;
      if (rRef >= best.range) best = { attitude: aRef, range: rRef };
    }
  }
  return best;
}

export const metersToFeet = (m) => m * 3.280839895;
export function formatFeetInches(m) {
  const totalIn = Math.round(m * 39.37007874);
  return `${Math.floor(totalIn / 12)}' ${totalIn % 12}"`;
}

/** Tiny seeded PRNG (mulberry32) so wind/obstacle layout per throw can be reproduced. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
