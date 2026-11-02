// CAGE GEOMETRY (pure numbers, no three.js): the posts and net panels of the discus cage in three.js space
// (x right, z toward the camera side; the mouth faces -z). cage.js builds the meshes from this, and camera.js reads the
// same panels so the broadcast cameras can tell when a net is in the way. Single source of truth: edit it here.
export const CAGE_R = 3.6;
const rad = (deg) => (deg * Math.PI) / 180;
const at = (deg) => ({ x: CAGE_R * Math.sin(rad(deg)), z: CAGE_R * Math.cos(rad(deg)) });
const P = (x, z, h) => ({ x, z, h });

// chains of posts, mouth -> back; the rear opening sits between -5 and 55 degrees
export const CAGE_LEFT = [P(-3.0, -4.2, 4.4), P(-3.3, -2.1, 5.0), ...[-90, -62, -34, -5].map((d, i) => ({ ...at(d), h: 5.5 + (i === 3 ? 0.1 : 0) }))];
export const CAGE_RIGHT = [P(3.0, -4.2, 4.4), P(3.3, -2.1, 5.0), ...[90, 75, 55].map((d) => ({ ...at(d), h: 5.5 }))];

// mouth gates (hinge post, direction in degrees from -z, width, height) flared outward
export const MOUTH_GATES = [
  { hinge: { x: -3.0, z: -4.2 }, deg: -28, w: 2.0, h: 3.6 },
  { hinge: { x: 3.0, z: -4.2 }, deg: 28, w: 2.0, h: 3.6 },
];
// rear gate: swung open and folded back along the left net, deliberately small and low so it does not fill the ready shot
export const REAR_GATE = { hinge: { x: CAGE_LEFT[5].x, z: CAGE_LEFT[5].z }, dir: { x: -0.99, z: 0.1 }, w: 1.9, h: 3.4 };

const gateEnd = (g) => {
  const l = Math.hypot(g.dir.x, g.dir.z);
  return { x: g.hinge.x + (g.dir.x / l) * g.w, z: g.hinge.z + (g.dir.z / l) * g.w };
};

/** Every net as a straight panel { ax, az, bx, bz, ha, hb } (top-edge heights at each end; the bottom is ~0.2 m). */
export const CAGE_PANELS = (() => {
  const out = [];
  for (const chain of [CAGE_LEFT, CAGE_RIGHT])
    for (let i = 0; i < chain.length - 1; i++) out.push({ ax: chain[i].x, az: chain[i].z, bx: chain[i + 1].x, bz: chain[i + 1].z, ha: chain[i].h, hb: chain[i + 1].h });
  for (const g of MOUTH_GATES) {
    const d = { x: Math.sin(rad(g.deg)), z: -Math.cos(rad(g.deg)) };
    out.push({ ax: g.hinge.x, az: g.hinge.z, bx: g.hinge.x + d.x * g.w, bz: g.hinge.z + d.z * g.w, ha: g.h - 0.1, hb: g.h - 0.1 });
  }
  const e = gateEnd(REAR_GATE);
  out.push({ ax: REAR_GATE.hinge.x, az: REAR_GATE.hinge.z, bx: e.x, bz: e.z, ha: REAR_GATE.h - 0.1, hb: REAR_GATE.h - 0.1 });
  return out;
})();
export { gateEnd };
