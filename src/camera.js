// DISCUS DISASTER - camera presets + cage-view collision. Pure module (plain numbers, no three.js, no DOM).
import { CAGE_PANELS } from './scenery/cagegeom.js';

export const PRESETS = [
  { id: 'broadcast', name: 'BROADCAST', blurb: 'Behind-right of the circle, then chases the disc' },
  { id: 'behind', name: 'BEHIND CIRCLE', blurb: 'Fixed behind the circle, zooms down the sector' },
  { id: 'side', name: 'SIDE LINE', blurb: 'Beside the sector, tracks across the flight' },
  { id: 'disc', name: 'DISCUS CAM', blurb: 'Rides just behind the disc' },
  { id: 'overhead', name: 'OVERHEAD', blurb: 'High above, looking down on the whole throw' },
];
export const DEFAULT_PRESET = 'broadcast';
export const isPreset = (id) => PRESETS.some((p) => p.id === id);
export const presetOf = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];
export const nextPreset = (id, dir = 1) => PRESETS[(PRESETS.findIndex((p) => p.id === id) + dir + PRESETS.length) % PRESETS.length].id;

/**
 * Net crossings along the sight line cam -> target. Returns [{ d, t }] (distance from the camera, 0..1 along the line) for
 * every panel the line passes through below the net's top edge and above its bottom edge.
 */
export function netHits(cam, target, panels = CAGE_PANELS) {
  const hits = [];
  const dx = target.x - cam.x;
  const dz = target.z - cam.z;
  const len3 = Math.hypot(dx, target.y - cam.y, dz);
  for (const p of panels) {
    const ex = p.bx - p.ax;
    const ez = p.bz - p.az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue; // parallel
    const t = ((p.ax - cam.x) * ez - (p.az - cam.z) * ex) / den; // along the sight line
    const u = ((p.ax - cam.x) * dz - (p.az - cam.z) * dx) / den; // along the panel
    if (t <= 0 || t >= 1 || u < 0 || u > 1) continue;
    const y = cam.y + (target.y - cam.y) * t;
    const top = p.ha + (p.hb - p.ha) * u;
    if (y < top && y > 0.2) hits.push({ d: t * len3, t });
  }
  return hits;
}

/** A net is "in the way" when the sight line crosses two or more layers, or a single one closer than `near` metres. */
export function viewBlocked(cam, target, { near = 5, panels = CAGE_PANELS } = {}) {
  const h = netHits(cam, target, panels);
  return h.length >= 2 || h.some((x) => x.d < near);
}

/**
 * Nudge the camera around a pivot (default the target; the circle centre for far-away targets) at the same radius and
 * height, so the framing is kept, until the view is clear. Tries small angles first, alternating sides; if every angle
 * is blocked it lifts the camera above the net tops. Returns a NEW { x, y, z }; the input is never mutated.
 */
export function clearCamera(cam, target, opts = {}) {
  if (!viewBlocked(cam, target, opts)) return { x: cam.x, y: cam.y, z: cam.z };
  const pv = opts.pivot || target;
  const r = Math.hypot(cam.x - pv.x, cam.z - pv.z);
  const a0 = Math.atan2(cam.z - pv.z, cam.x - pv.x);
  for (let k = 1; k <= 15; k++) {
    for (const sgn of [1, -1]) {
      const a = a0 + sgn * k * 0.2;
      const c = { x: pv.x + Math.cos(a) * r, y: cam.y, z: pv.z + Math.sin(a) * r };
      if (!viewBlocked(c, target, opts)) return c;
    }
  }
  return { x: cam.x, y: Math.max(cam.y, 6.4), z: cam.z };
}
