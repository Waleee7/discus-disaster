// CINEMA: the walk-out and the replays. Pure camera / timing logic on top of the game's own pieces (athlete poses,
// recorded flights, obstacles that are a pure function of time), so a replay is the real throw, not an animation of it.
//
//   Walkout         PLAY -> the athlete comes out of the players' tunnel under the floods, three shots, then hands the
//                   camera to the throwing view. Any press skips. Reduced motion: the same story in static cuts.
//   ReplayDirector  poses the world (athlete, discus, cast) at any moment of a recorded throw.
//   feedShot        the jumbotron's angle on a replay (a different camera than the player saw).
//   REPLAY_SHOTS    the full-screen cinematic replay: four shots, slow motion where it matters.
import * as THREE from 'three';
import { DEG } from './physics.js';
import { toThree } from './scene.js';
import { tunnelFrame } from './scenery/tunnel.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (x) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
const ease = (x) => {
  const t = clamp(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const lerp = (a, b, t) => a + (b - a) * t;

/** Facing (psi, degrees, physics convention) that points the athlete's chest along a three.js direction (x, z). */
export const facingAlong = (dx, dz) => -Math.atan2(-dx, -dz) / DEG;

// ------------------------------------------------------------------------------------------------ the broadcast pose
/** The throwing camera's ready framing (broadcast preset), the walk-out lands exactly here. */
export function readyPose(aspect, out) {
  if (aspect < 0.9) {
    out.pos.set(3.2, 3.0, 10.8);
    out.look.set(-0.2, 1.3, -7);
  } else {
    out.pos.set(5.4, 2.75, 9.8);
    out.look.set(-0.8, 1.45, -10);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------- WALK-OUT
const WALK_SPEED = 1.72; // m/s: a purposeful stride, not a stroll
const STRIDE = 1.62; // metres per stride (right + left step)

export class Walkout {
  /**
   * @param {object} o { short: crane-in only (PLAY AGAIN), reduced: static cuts, aspect }
   */
  constructor(o = {}) {
    const F = tunnelFrame();
    this.F = F;
    const P0 = F.back.clone().addScaledVector(F.dir, 0.9);
    const P1 = F.mouth.clone().addScaledVector(F.dir, 1.0);
    // out of the tunnel, across the lanes and the infield, to the cage's rear opening, into the circle
    const W = new THREE.Vector3(2.7, 0, 7.4);
    const E = new THREE.Vector3(1.2, 0, 2.55);
    const C = new THREE.Vector3(0, 0, 0);
    const mid = P1.clone().lerp(W, 0.5).add(new THREE.Vector3(0.8, 0, 0));
    this.path = new THREE.CatmullRomCurve3([P0, F.mouth.clone().addScaledVector(F.dir, -1.4), P1, mid, W, E, C], false, 'centripetal', 0.5);
    this.len = this.path.getLength();
    this.short = !!o.short;
    this.reduced = !!o.reduced;
    // shot timing (seconds) and where on the path (metres) each shot picks the athlete up
    const s3len = 4.55; // the last stretch, walked in shot 3
    const d1 = this.short ? 0 : 2.65;
    const d2 = this.short ? 0 : 2.75;
    const d3w = s3len / WALK_SPEED;
    const turn = 0.62;
    const settle = 0.55;
    this.shots = [];
    if (!this.short) {
      this.shots.push({ id: 'tunnel', t0: 0, t1: d1, s0: 0, s1: d1 * WALK_SPEED });
      const sEnd = this.len - s3len;
      const s2len = d2 * WALK_SPEED;
      const s2 = Math.max(d1 * WALK_SPEED, lerp(d1 * WALK_SPEED, sEnd - s2len, 0.55));
      this.shots.push({ id: 'track', t0: d1, t1: d1 + d2, s0: s2, s1: s2 + s2len });
    }
    const t3 = d1 + d2;
    this.shots.push({ id: 'crane', t0: t3, t1: t3 + d3w + turn + settle, s0: this.len - s3len, s1: this.len, walkEnd: t3 + d3w, turnEnd: t3 + d3w + turn });
    this.total = t3 + d3w + turn + settle;
    this.nameIn = t3 + 0.35;
    this.nameOut = this.total - 0.25;
    this.t = 0;
    this.done = false;
    this.pos = new THREE.Vector3();
    this.tan = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, dof: 0, focus: 5, range: 3, roll: 0 };
    this.endPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    readyPose(o.aspect || 1.6, this.endPose);
  }

  shotAt(t) {
    for (const s of this.shots) if (t < s.t1) return s;
    return this.shots[this.shots.length - 1];
  }

  /** Floodlight level at time t: dark, then three banks slam on with a flicker (the hero beat). Full on in short / reduced. */
  flood(t) {
    if (this.short || this.reduced) return 1;
    const steps = [[0.85, 0.42], [1.2, 0.72], [1.55, 1]];
    let k = 0.14;
    for (const [at, v] of steps) {
      if (t >= at) {
        const d = t - at;
        k = d < 0.12 ? v * (0.55 + 0.45 * Math.abs(Math.sin(d * 90))) : v; // strike flicker
      }
    }
    return k;
  }

  /** Crowd excitement and phone-flash density over the walk-out. */
  crowd(t) {
    const e = this.short ? 0.6 + 0.4 * smooth((t - 0.3) / 1.5) : t < 0.9 ? 0.35 : 0.35 + 0.65 * smooth((t - 0.9) / 3.5);
    const f = this.short ? 0.5 : smooth((t - 1.0) / 1.5) * (0.6 + 0.4 * smooth((t - this.nameIn) / 1.0));
    return { excite: e, flash: f };
  }

  /** Athlete state at time t: { x, z, psi, mode: 'walk'|'turn'|'settle', phase, k }. */
  athlete(t, out) {
    const sh = this.shotAt(t);
    const u = clamp((t - sh.t0) / Math.max(1e-6, (sh.walkEnd ?? sh.t1) - sh.t0));
    const s = lerp(sh.s0, sh.s1, u);
    const tt = clamp(s / this.len);
    this.path.getPointAt(tt, this.pos);
    this.path.getTangentAt(Math.min(0.999, tt), this.tan);
    out.x = this.pos.x;
    out.z = this.pos.z;
    out.phase = (t * WALK_SPEED) / STRIDE;
    if (sh.walkEnd !== undefined && t >= sh.walkEnd) {
      // in the circle: turn to face the back of the cage (the start of the throw), little steps, then shake out
      const arrive = facingAlong(this.tan.x, this.tan.z);
      const v = clamp((t - sh.walkEnd) / (sh.turnEnd - sh.walkEnd));
      const target = arrive + wrap180(180 - arrive);
      out.psi = lerp(arrive, target, ease(v));
      out.mode = t < sh.turnEnd ? 'turn' : 'settle';
      out.k = t < sh.turnEnd ? 0.35 * (1 - v) + 0.12 : 0;
      out.settle = clamp((t - sh.turnEnd) / (sh.t1 - sh.turnEnd));
    } else {
      out.psi = facingAlong(this.tan.x, this.tan.z);
      // ease into the stride at the start and out of it on the last steps
      const end = sh.walkEnd !== undefined ? clamp((sh.walkEnd - t) / 0.5) : 1;
      out.k = sh.id === 'tunnel' ? smooth(t / 0.35) : sh.id === 'crane' ? 0.4 + 0.6 * end : 1;
      out.mode = 'walk';
    }
    return out;
  }

  /** Camera for time t (aspect for portrait framing). Fills this.cam. */
  camera(t, aspect, ath) {
    const c = this.cam;
    const portrait = aspect < 0.9;
    const sh = this.shotAt(t);
    const u = clamp((t - sh.t0) / (sh.t1 - sh.t0));
    const F = this.F;
    const head = this._a.set(ath.x, 1.55, ath.z);
    if (sh.id === 'tunnel') {
      // low, in front of the mouth, dollying back as the athlete comes out of the light
      const back = this.reduced ? 4.2 : 3.3 + 1.5 * ease(u);
      c.pos.copy(F.mouth).addScaledVector(F.dir, back).addScaledVector(F.side, portrait ? 0.35 : 0.85);
      c.pos.y = portrait ? 0.95 : 0.72;
      c.look.set(ath.x, 1.3, ath.z);
      c.fov = portrait ? 56 : 36;
      c.focus = c.pos.distanceTo(c.look);
      c.range = 1.6;
      c.dof = 1;
      c.roll = 0;
    } else if (sh.id === 'track') {
      // long lens, side-on, tracking alongside; the home stand and the floodlight towers stacked up behind
      this.path.getTangentAt(clamp(lerp(sh.s0, sh.s1, u) / this.len), this.tan);
      const tx = this.tan.x;
      const tz = this.tan.z;
      const l = Math.hypot(tx, tz) || 1;
      const rx = -tz / l;
      const rz = tx / l;
      const dist = portrait ? 8.5 : 7.2;
      const lead = this.reduced ? 0 : 0.9;
      if (this.reduced) {
        // static: frame the middle of the stretch, the athlete walks through it
        const mid = clamp((sh.s0 + sh.s1) / 2 / this.len);
        this.path.getPointAt(mid, this._b);
        c.pos.set(this._b.x + rx * dist, 1.45, this._b.z + rz * dist);
        c.look.set(this._b.x, 1.3, this._b.z);
      } else {
        c.pos.set(ath.x + rx * dist + (tx / l) * lead, 1.45, ath.z + rz * dist + (tz / l) * lead);
        c.look.set(ath.x + (tx / l) * 0.35, 1.32, ath.z + (tz / l) * 0.35);
      }
      c.fov = portrait ? 38 : 24;
      c.focus = c.pos.distanceTo(head);
      c.range = 2.2;
      c.dof = 1;
      c.roll = 0;
    } else {
      // crane: low behind the athlete as they step through the rear opening, rising and swinging round to the
      // broadcast position, ending exactly on the throwing camera
      const end = this.endPose;
      if (this.reduced) {
        c.pos.copy(end.pos);
        c.look.copy(end.look);
        c.fov = 0;
        c.dof = 0;
      } else {
        const k = ease(u);
        const startPos = this._b.set(ath.x + 2.2, 1.05, ath.z + 3.4);
        if (u < 0.02) this.craneStart = startPos.clone();
        const S0 = this.craneStart || startPos;
        // cubic Bezier: S0 -> up and out -> above the end -> end
        const S1x = S0.x + 2.5;
        const S1y = S0.y + 4.2;
        const S1z = S0.z + 2.0;
        const S2x = end.pos.x + 1.5;
        const S2y = end.pos.y + 3.2;
        const S2z = end.pos.z + 1.2;
        const it = 1 - k;
        c.pos.set(
          it * it * it * S0.x + 3 * it * it * k * S1x + 3 * it * k * k * S2x + k * k * k * end.pos.x,
          it * it * it * S0.y + 3 * it * it * k * S1y + 3 * it * k * k * S2y + k * k * k * end.pos.y,
          it * it * it * S0.z + 3 * it * it * k * S1z + 3 * it * k * k * S2z + k * k * k * end.pos.z,
        );
        const lk = smooth((u - 0.45) / 0.55);
        c.look.set(lerp(ath.x, end.look.x, lk), lerp(1.35, end.look.y, lk), lerp(ath.z, end.look.z, lk));
        c.fov = -1 + (1 - smooth((u - 0.5) / 0.5)) * 0; // filled by the caller: lerp to the base fov
        c.fovMix = smooth((u - 0.35) / 0.65);
        c.fovFrom = portrait ? 52 : 34;
        c.focus = c.pos.distanceTo(head);
        c.range = 2.8;
        c.dof = 0.7 * (1 - smooth((u - 0.4) / 0.5));
      }
      c.roll = 0;
    }
    c.shot = sh.id;
    c.cut = this._lastShot !== sh.id;
    this._lastShot = sh.id;
    return c;
  }
}

// --------------------------------------------------------------------------------------------- REPLAY DIRECTOR
/**
 * Timeline of a recorded throw, in "throw seconds": tau < 0 is the end of the spin (the athlete's recorded turns),
 * tau = 0 is the release, tau = flight time is the touchdown. pose(tau) puts the world there.
 */
export class ReplayDirector {
  constructor(game) {
    this.g = game;
    this.rec = null;
    this._q = new THREE.Vector3();
    this._snap = { pose: [], parent: null, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vis: true, glow: false, shadow: false, tape: false, parts: true, dust: true, debris: true, shPos: new THREE.Vector3(), shScale: 1, shOp: 0.5 };
  }

  load(rec, { preroll = 1.3 } = {}) {
    this.rec = rec;
    const sp = (rec.pose && rec.pose.spin) || [];
    this.spinDur = sp.length >= 4 ? sp[sp.length - 4] : 0;
    this.preroll = Math.min(preroll, this.spinDur);
    const S = rec.samples;
    this.flightT = S.length ? S[S.length - 1][0] : 0;
    this.ev = 0;
    return this;
  }

  /** Disc position (three.js) at flight time tf, written into out. */
  discAt(tf, out) {
    const S = this.rec.samples;
    const last = S[S.length - 1];
    const t = Math.min(Math.max(tf, 0), last[0]);
    // samples are at 120 Hz from t = 0 (plus the touchdown sample): find the bracket
    let i = Math.min(S.length - 2, Math.max(0, Math.floor(t * 120)));
    while (i > 0 && S[i][0] > t) i--;
    while (i < S.length - 2 && S[i + 1][0] < t) i++;
    const a = S[i];
    const b = S[i + 1] || a;
    const k = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0])) : 0;
    const s = this._s || (this._s = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    s.x = lerp(a[1], b[1], k);
    s.y = lerp(a[2], b[2], k);
    s.z = lerp(a[3], b[3], k);
    s.vx = lerp(a[4], b[4], k);
    s.vy = lerp(a[5], b[5], k);
    s.vz = lerp(a[6], b[6], k);
    if (out) toThree(s.x, s.y, s.z, out);
    return s;
  }

  /** Spin state at spin time ts from the recorded track [t, rot, power, psi, ...]. */
  spinAt(ts) {
    const sp = this.rec.pose.spin;
    const n = sp.length / 4;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (sp[m * 4] <= ts) lo = m;
      else hi = m;
    }
    const a = lo * 4;
    const b = hi * 4;
    const k = sp[b] > sp[a] ? clamp((ts - sp[a]) / (sp[b] - sp[a])) : 0;
    const o = this._sp || (this._sp = {});
    o.rot = lerp(sp[a + 1], sp[b + 1], k);
    o.power = lerp(sp[a + 2], sp[b + 2], k);
    o.psi = sp[a + 3] + wrap180(sp[b + 3] - sp[a + 3]) * k;
    return o;
  }

  /** Pose the athlete, the discus and the cast at tau. `live` = also fire hit reactions (full-screen replay). */
  pose(tau, { live = false } = {}) {
    const g = this.g;
    const rec = this.rec;
    const th = g.thrower;
    const dg = g.discus.group;
    const style = (rec.pose && rec.pose.style) || null;
    th.setStyle(style);
    if (tau < 0 && this.spinDur > 0) {
      const sp = this.spinAt(this.spinDur + tau);
      th.setFacing(sp.psi);
      th.spin(sp.rot, sp.power);
      if (dg.parent !== th.hand) {
        dg.removeFromParent();
        th.hand.add(dg);
      }
      dg.position.set(0, 0, 0);
      dg.quaternion.identity();
      dg.rotation.set((rec.params.attitude || 25) * DEG, 0, 0);
      dg.visible = true;
      g.glow.visible = false;
      g.shadow.visible = false;
      g.obstacles.update(rec.tRel + tau, 0);
      return;
    }
    const tf = Math.max(0, tau);
    th.setFacing(Number.isFinite(rec.meta.psi) ? rec.meta.psi : 0);
    th.release(tf / 0.8);
    if (dg.parent !== g.scene) {
      dg.removeFromParent();
      g.scene.add(dg);
    }
    const landed = tf >= this.flightT;
    const s = this.discAt(tf, null);
    if (landed) {
      toThree(s.x, 0.06, s.z, dg.position);
      dg.quaternion.identity();
      g.glow.visible = false;
      g.shadow.visible = false;
    } else {
      g.setDiscusPose(s, rec.n, 1 / 60);
      g.glow.visible = true;
      g.shadow.visible = true;
    }
    dg.visible = true;
    g.obstacles.update(rec.tRel + tf, 0);
    if (live) {
      while (this.ev < rec.events.length && rec.events[this.ev].t <= tf) {
        const ev = rec.events[this.ev++];
        const o = g.obstacles.list.find((x) => x.key === ev.key);
        if (o) {
          o.hitAt = null;
          o.onHit(rec.tRel + ev.t, ev.p[0], ev.p[1], ev.p[2]);
          g.flashNow(o.meta.label, `x${o.meta.mult}`, 'good');
        }
      }
    }
  }

  /** Save the live world (before rendering a past moment into the jumbotron). */
  snapshot() {
    const g = this.g;
    const S = this._snap;
    g.thrower.getPose(S.pose);
    const dg = g.discus.group;
    S.parent = dg.parent;
    S.pos.copy(dg.position);
    S.quat.copy(dg.quaternion);
    S.vis = dg.visible;
    S.glow = g.glow.visible;
    S.shadow = g.shadow.visible;
    S.shPos.copy(g.shadow.position);
    S.shScale = g.shadow.scale.x;
    S.shOp = g.shadow.material.opacity;
    S.tape = g.tape.group.visible;
    S.parts = g.particles.points.visible;
    S.dust = g.dust ? g.dust.points.visible : false;
    S.debris = g.debris.group.visible;
    S.divot = g.divot ? g.divot.visible : false;
    g.tape.group.visible = false;
    g.particles.points.visible = false;
    if (g.dust) g.dust.points.visible = false;
    g.debris.group.visible = false;
    if (g.divot) g.divot.visible = false;
  }

  restore() {
    const g = this.g;
    const S = this._snap;
    g.thrower.setStyle(g.tech.pose);
    g.thrower.setPose(S.pose);
    const dg = g.discus.group;
    if (dg.parent !== S.parent) {
      dg.removeFromParent();
      if (S.parent) S.parent.add(dg);
    }
    dg.position.copy(S.pos);
    dg.quaternion.copy(S.quat);
    dg.visible = S.vis;
    g.glow.visible = S.glow;
    g.shadow.visible = S.shadow;
    g.shadow.position.copy(S.shPos);
    g.shadow.scale.setScalar(S.shScale);
    g.shadow.material.opacity = S.shOp;
    g.tape.group.visible = S.tape;
    g.particles.points.visible = S.parts;
    if (g.dust) g.dust.points.visible = S.dust;
    g.debris.group.visible = S.debris;
    if (g.divot) g.divot.visible = S.divot;
    g.obstacles.update(g.tO, 0);
  }
}

// ------------------------------------------------------------------------------------------- the jumbotron's angle
/**
 * Slow-motion speed (throw seconds per real second) at tau for the jumbotron feed: the last turns and the release
 * crawl, the flight runs near real time, the landing slows right down again.
 */
export function feedSpeed(tau, flightT) {
  if (tau < 0.25) return 0.36;
  if (tau > flightT - 0.55 && tau < flightT + 0.3) return 0.32;
  return 0.9;
}

/** The jumbotron camera: through the cage mouth for the spin and release (the reverse of the player's view), then a high side
 * angle on the flight, then low at the landing. Fills cam { pos, look, fov }. */
export function feedShot(dir, tau, cam) {
  const ft = dir.flightT;
  const land = dir._land || (dir._land = new THREE.Vector3());
  if (tau < 0.3) {
    const k = clamp((tau + dir.preroll) / (dir.preroll + 0.3));
    cam.pos.set(1.7 - 0.5 * k, 1.5, -8.6 + 1.2 * k);
    cam.look.set(0, 1.12, 0);
    cam.fov = 30 - 3 * k;
    return cam;
  }
  if (tau < ft - 0.55) {
    const p = dir._p || (dir._p = new THREE.Vector3());
    dir.discAt(tau, p);
    cam.pos.set(p.x + 16, Math.max(7, p.y * 0.55 + 6), p.z + 9);
    cam.look.copy(p);
    cam.fov = 34;
    return cam;
  }
  dir.discAt(ft, land);
  land.y = 0;
  cam.pos.set(land.x + 4.2, 0.75, land.z + 4.6);
  cam.look.set(land.x, 0.35, land.z);
  cam.fov = 30;
  return cam;
}

// ------------------------------------------------------------------------------------ full-screen replay shots
/**
 * The REPLAY button's edit: four shots over the throw's timeline. Each shot: tau range, playback speed, and a camera
 * function (dir, tau, u, aspect, cam) that also sets depth of field (focus / range / dof).
 */
export function replayShots(dir) {
  const ft = dir.flightT;
  const pre = dir.preroll;
  const shots = [];
  if (pre > 0.05) {
    shots.push({
      id: 'spin',
      a: -pre,
      b: 0.06,
      speed: 0.42,
      cam(d, tau, u, aspect, c) {
        // low hero angle from inside the cage mouth, orbiting slowly
        const a = (-35 + 22 * u) * DEG;
        const r = aspect < 0.9 ? 4.4 : 3.7;
        c.pos.set(Math.sin(a) * r, 0.78, -Math.cos(a) * r);
        c.look.set(0, 1.12, 0);
        c.fov = aspect < 0.9 ? 48 : 32;
        c.focus = r;
        c.range = 1.1;
        c.dof = 1;
      },
    });
  }
  shots.push({
    id: 'release',
    a: 0.06,
    b: Math.min(0.95, ft * 0.35),
    speed: 0.45,
    cam(d, tau, u, aspect, c) {
      // over the shoulder: the disc leaves the hand and climbs away down the sector
      const p = d._p || (d._p = new THREE.Vector3());
      d.discAt(tau, p);
      c.pos.set(0.95, 1.95, 2.3);
      c.look.set(lerp(0, p.x, 0.75), lerp(1.4, p.y, 0.75), lerp(-3, p.z, 0.75));
      c.fov = aspect < 0.9 ? 56 : 42;
      c.focus = c.pos.distanceTo(p);
      c.range = 6;
      c.dof = 0.6;
    },
  });
  shots.push({
    id: 'flight',
    a: Math.min(0.95, ft * 0.35),
    b: Math.max(Math.min(0.95, ft * 0.35) + 0.2, ft - 0.5),
    speed: 1.0,
    cam(d, tau, u, aspect, c) {
      // long lens on the sideline, panning with the disc
      const p = d._p || (d._p = new THREE.Vector3());
      d.discAt(tau, p);
      const side = aspect < 0.9 ? 30 : 24;
      c.pos.set(side, 3.4 + p.y * 0.25, p.z + 7 - 8 * u);
      c.look.copy(p);
      c.fov = aspect < 0.9 ? 30 : 20;
      c.focus = c.pos.distanceTo(p);
      c.range = 9;
      c.dof = 0.45;
    },
  });
  shots.push({
    id: 'landing',
    a: Math.max(Math.min(0.95, ft * 0.35) + 0.2, ft - 0.5),
    b: ft + 1.5,
    speed: 0.3,
    after: 1.0, // full speed once it has landed
    cam(d, tau, u, aspect, c) {
      const L = d._land || (d._land = new THREE.Vector3());
      d.discAt(ft, L);
      L.y = 0;
      // grass level, side-on to the line of flight
      c.pos.set(L.x + 3.6, 0.32, L.z + 3.2);
      c.look.set(L.x, 0.28, L.z);
      c.fov = aspect < 0.9 ? 44 : 28;
      c.focus = c.pos.distanceTo(L);
      c.range = 1.6;
      c.dof = 1;
    },
  });
  return shots;
}
