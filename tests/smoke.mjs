// Playwright smoke test: serves the repo statically and, at 1440x900, 390x844 (touch), 844x390 and 667x375 (touch,
// landscape): plays one human-style throw through the REAL input path, an instant press+release / touch tap,
// a poisoned release (NaN guard) and a scripted throw; asserts no console errors, finite camera, a result
// shown quickly, 44px tool buttons, 11px minimum HUD text, a non-overlapping result card whose buttons are fully on
// screen, a visible landing mark, and a press during flight that reaches the result in < 2 s with the same mark.
// v2 adds: the start screen (athlete carousel, Rookie/Pro toggle, PLAY, BOARD), Rookie assists (forgiving tap, auto
// nose, slower needle in the green, coaching after a foul), the initials entry and the leaderboard, all asserted at
// every viewport for overlap / 44 px targets / 11 px text / on-screen.
// Screenshots go to tests/out/ (git-ignored). Pass --docs to refresh the committed docs/shots/ on purpose.
//   node tests/smoke.mjs [--docs]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.claude/scripts/node_modules/playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TO_DOCS = process.argv.includes('--docs');
const SHOTS = TO_DOCS ? path.join(ROOT, 'docs', 'shots') : path.join(ROOT, 'tests', 'out');
mkdirSync(SHOTS, { recursive: true });

const freePort = () =>
  new Promise((res) => {
    const s = net.createServer().listen(0, () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const url = `http://127.0.0.1:${port}/index.html`;
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const errors = [];
const log = (...a) => console.log('[smoke]', ...a);

const settle = async (page, maxSim = 40) => {
  // advance the simulation until the attempt resolves; returns simulated seconds used
  let used = 0;
  while ((await page.evaluate(() => window.__debug.state)) !== 'result' && used < maxSim) {
    await page.evaluate(() => window.__debug.advance(0.25, { render: false }));
    used += 0.25;
  }
  await page.evaluate(() => window.__debug.advance(0.1));
  return used;
};

const finiteCamera = (page) =>
  page.evaluate(() => {
    const c = window.__debug.game.camera;
    return [c.position.x, c.position.y, c.position.z, c.fov, c.matrixWorld.elements[12], c.matrixWorld.elements[13], c.matrixWorld.elements[14]].every(Number.isFinite);
  });

async function openFresh(name, viewport, mobile, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, ...opts });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin }).catch(() => {});
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`${name}: requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__debug, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__debug.manual(true));
  return { ctx, page };
}

/** The NaN-lockup regression: a same-frame press+release (keyboard, then a real touch tap) must resolve fast, finite. */
async function instantRelease(name, viewport, mobile) {
  const { ctx, page } = await openFresh(name, viewport, mobile);
  // These are the original (v1) assertions and they describe PRO: a tap is a cage foul. Rookie's forgiving tap has its own test.
  await page.evaluate(() => window.__debug.setMode('pro'));
  await page.evaluate(() => window.__debug.skipIntro());
  await page.evaluate(() => window.__debug.advance(0.3));
  const check = async (label) => {
    assert.equal(await page.evaluate(() => window.__debug.state), 'flight', `${label}: release launched a flight`);
    assert.ok(await finiteCamera(page), `${label}: camera finite right after launch`);
    const used = await settle(page);
    assert.ok(used <= 12, `${label}: result shown within 12 simulated seconds (took ${used})`);
    assert.ok(await finiteCamera(page), `${label}: camera finite at the result`);
    const r = await page.evaluate(() => window.__debug.game.cur.rec.result);
    assert.ok(Number.isFinite(r.distance) && Number.isFinite(r.range) && Number.isFinite(r.az), `${label}: finite result ${JSON.stringify(r)}`);
    assert.ok(r.foul, `${label}: an instant tap is a foul`);
    assert.equal((await page.textContent('#resDist')).trim(), 'FOUL', `${label}: result card says FOUL`);
    const s = await page.evaluate(() => window.__debug.game.cur.f.s);
    assert.ok([s.x, s.y, s.z].every(Number.isFinite), `${label}: flight state finite`);
  };
  // a) same-frame press+release through the real Input object
  await page.evaluate(() => {
    window.__debug.press();
    window.__debug.release();
  });
  await check('press+release in one frame');
  // b) real key tap (down+up with no frame in between, game is in manual stepping mode)
  await page.evaluate(() => window.__debug.game.next());
  await page.evaluate(() => window.__debug.advance(0.3));
  await page.keyboard.press('Space');
  await check('keyboard tap');
  // c) real touchscreen tap on touch viewports
  if (mobile) {
    await page.evaluate(() => window.__debug.game.next());
    await page.evaluate(() => window.__debug.advance(0.3));
    await page.touchscreen.tap(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
    await check('touchscreen tap');
  }
  // d) a poisoned release must fall back to a cage foul, never a NaN flight
  await page.evaluate(() => window.__debug.game.setState('ready'));
  await page.evaluate(() => {
    const g = window.__debug.game;
    g.startAttempt();
    window.__p = g.waitResult();
    g.launch({ speed: NaN, releaseAngle: 35, heading: 0, attitude: 25, wind: g.layout.wind }, { power: NaN, psi: NaN });
  });
  await check('NaN release guard');
  await ctx.close();
  log(`${name}: instant-release / NaN-guard checks pass`);
}

/** Layout + a11y assertions on the visible HUD. */
async function hudChecks(page, name, mobile, state) {
  const info = await page.evaluate((state) => {
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05 || el.hidden) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const small = [];
    for (const el of document.querySelectorAll('#hud *:not(svg *):not(svg), .overlay *:not(svg *):not(svg)')) {
      if (!vis(el) || !el.childNodes.length) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 10.95) small.push(`${el.tagName.toLowerCase()}#${el.id}.${el.className}:${fs}px "${el.textContent.trim().slice(0, 20)}"`);
    }
    const tools = [...document.querySelectorAll('.tools button')].filter(vis).map((b) => ({ id: b.id, ...box(b) }));
    const others = ['.meters', '.dial', '.hint', '.wind', '.bug', '.tools'].map((q) => [q, document.querySelector(q)]).filter(([, el]) => el && vis(el)).map(([q, el]) => ({ q, ...box(el) }));
    const res = document.getElementById('result');
    const result = res && vis(res) ? box(res) : null;
    const btns = ['btnNext', 'btnReplay2', 'btnSwap'].map((id) => document.getElementById(id)).filter((b) => b && vis(b)).map((b) => ({ id: b.id, ...box(b) }));
    const cluster = [...document.querySelectorAll('.cluster button')].filter(vis).map((b) => ({ id: b.id, ...box(b) }));
    const clusterAvoid = ['.bug', '.tools', '.wind', '.hint', '.meters', '.dial', '.lt', '#replayTag'].map((q) => [q, document.querySelector(q)]).filter(([, el]) => el && vis(el)).map(([q, el]) => ({ q, ...box(el) }));
    const bar = ['.bug', '.tools', '.wind'].map((q) => [q, document.querySelector(q)]).filter(([, el]) => el && vis(el)).map(([q, el]) => ({ q, ...box(el) }));
    // landing mark (the discus rests on it) in CSS px
    let landing = null;
    const g = window.__debug.game;
    // the landing mark belongs to the per-throw result view; the final card orbits the athlete instead
    if (res && vis(res) && state !== 'final' && g.cur && g.cur.rec.result && !g.cur.rec.result.foul) {
      const v = g.discus.group.position.clone().project(g.camera);
      landing = { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, front: v.z < 1 };
    }
    return { small, tools, others, bar, btns, cluster, clusterAvoid, landing, result, vw: innerWidth, vh: innerHeight, meta: document.querySelector('meta[name=viewport]').content };
  }, state);
  assert.ok(!/user-scalable\s*=\s*(no|0)/i.test(info.meta), 'pinch zoom is not disabled');
  assert.deepEqual(info.small, [], `${name}/${state}: HUD text under 11px`);
  for (const b of info.cluster) {
    assert.ok(b.l >= -0.5 && b.t >= -0.5 && b.r <= info.vw + 0.5 && b.b <= info.vh + 0.5, `${name}/${state}: ${b.id} inside the viewport ${JSON.stringify(b)}`);
    assert.ok(b.b - b.t >= 43.9 && b.r - b.l >= 43.9, `${name}/${state}: ${b.id} is ${(b.r - b.l).toFixed(0)}x${(b.b - b.t).toFixed(0)}, needs 44x44`);
    for (const o of info.clusterAvoid) assert.ok(!(b.l < o.r && b.r > o.l && b.t < o.b && b.b > o.t), `${name}/${state}: ${b.id} overlaps ${o.q} ${JSON.stringify(o)} vs ${JSON.stringify(b)}`);
  }
  if (mobile) for (const b of info.tools) assert.ok(b.b - b.t >= 43.9 && b.r - b.l >= 43.9, `${name}: tool button ${b.id} is ${(b.r - b.l).toFixed(0)}x${(b.b - b.t).toFixed(0)}, needs 44x44`);
  // top row: scorebug, tools and wind never touch, and the tools stay on ONE row (no wrapping into the result card)
  for (let i = 0; i < info.bar.length; i++)
    for (let j = i + 1; j < info.bar.length; j++) {
      const a = info.bar[i];
      const b = info.bar[j];
      assert.ok(!(a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t), `${name}/${state}: ${a.q} overlaps ${b.q}`);
    }
  if (info.tools.length > 1 && info.vw > info.vh) {
    const tops = new Set(info.tools.map((b) => Math.round(b.t)));
    assert.equal(tops.size, 1, `${name}/${state}: toolbar wrapped onto ${tops.size} rows`);
  }
  if (info.result) {
    const r = info.result;
    for (const b of info.btns) {
      assert.ok(b.l >= -0.5 && b.t >= -0.5 && b.r <= info.vw + 0.5 && b.b <= info.vh + 0.5, `${name}: ${b.id} fully inside the viewport ${JSON.stringify(b)}`);
      assert.ok(b.l >= r.l - 0.5 && b.r <= r.r + 0.5 && b.t >= r.t - 0.5 && b.b <= r.b + 0.5, `${name}: ${b.id} fully inside the result card (not clipped)`);
      assert.ok(b.b - b.t >= 43.9, `${name}: ${b.id} is ${(b.b - b.t).toFixed(0)}px tall, needs 44`);
    }
    if (info.landing) {
      const L = info.landing;
      const px = 6;
      assert.ok(L.front && L.x >= 0 && L.x <= info.vw && L.y >= 0 && L.y <= info.vh, `${name}: landing mark on screen ${JSON.stringify(L)}`);
      assert.ok(!(L.x > r.l - px && L.x < r.r + px && L.y > r.t - px && L.y < r.b + px), `${name}: landing mark ${JSON.stringify(L)} hidden behind the result card ${JSON.stringify(r)}`);
      for (const b of info.bar) assert.ok(!(L.x > b.l && L.x < b.r && L.y > b.t && L.y < b.b), `${name}: landing mark hidden behind ${b.q}`);
    }
    assert.ok(r.l >= 0 && r.t >= 0 && r.r <= info.vw + 0.5 && r.b <= info.vh + 0.5, `${name}: result card inside the viewport ${JSON.stringify(r)}`);
    for (const o of info.others) {
      const hit = r.l < o.r && r.r > o.l && r.t < o.b && r.b > o.t;
      assert.ok(!hit, `${name}: result card overlaps ${o.q} ${JSON.stringify(o)} vs ${JSON.stringify(r)}`);
    }
  }
}

/** Press during flight / slow-mo / tape jumps to the result in < 2 s and records the SAME mark as the full-length throw. */
async function skipChecks(name, viewport, mobile) {
  const { ctx, page } = await openFresh(name, viewport, mobile);
  await page.evaluate(() => window.__debug.skipIntro());
  await page.evaluate(() => window.__debug.advance(0.3));
  const P = { seed: 12, power: 1, psi: -2, attitude: 22 }; // the GIF throw: strikes a pigeon, so skipping must keep the multiplier
  const go = (label) =>
    page.evaluate((p) => {
      window.__debug.game.tO = 5; // pinned obstacle clock: identical pigeons, carts and sprinklers both times
      window.__p = window.__debug.throw(p);
    }, P);
  const tap = () => (mobile ? page.touchscreen.tap(Math.round(viewport.width / 2), Math.round(viewport.height / 2)) : page.keyboard.press('Space'));

  // reference: full-length throw
  await go('reference');
  const used = await settle(page, 40);
  const ref = await page.evaluate(() => window.__p);
  assert.ok(!ref.foul && ref.distance > 55, `reference throw is a real throw: ${ref.distance}`);
  assert.ok(used < 9, `full-length throw reaches the result in ${used.toFixed(1)} simulated s (slow-mo is capped, was ~10 s)`);

  // press mid-flight
  await page.evaluate(() => window.__debug.game.next());
  await page.evaluate(() => window.__debug.advance(0.3));
  await go('skip');
  await page.evaluate(() => window.__debug.advance(0.8));
  assert.equal(await page.evaluate(() => window.__debug.state), 'flight', 'still airborne before the press');
  const t0 = Date.now();
  await tap();
  assert.equal(await page.evaluate(() => window.__debug.state), 'result', 'a press during flight jumps to the result');
  const took = Date.now() - t0;
  assert.ok(took < 2000, `press-to-result took ${took} ms (< 2000)`);
  const sk = await page.evaluate(() => window.__p);
  assert.ok(Math.abs(sk.distance - ref.distance) < 0.05, `skipped mark ${sk.distance.toFixed(3)} == full-length mark ${ref.distance.toFixed(3)}`);
  assert.ok(ref.hits.includes('pigeon') && ref.mult > 1, `the staged throw really strikes a pigeon (hits ${ref.hits})`);
  assert.deepEqual(sk.hits, ref.hits, 'same obstacle hits');
  assert.ok(Math.abs(sk.mult - ref.mult) < 1e-9, 'same multiplier');
  assert.equal((await page.textContent('#resDist')).trim(), sk.distance.toFixed(2), 'card shows the final distance, not a half-counted one');
  assert.ok(await finiteCamera(page), 'camera finite after a skip');
  // a second tap right away must not skip the result card itself (double-tap guard)
  await tap();
  assert.equal(await page.evaluate(() => window.__debug.state), 'result', 'double-tap does not blow through the result');

  // press during the tape / landed beat
  await page.evaluate(() => window.__debug.advance(0.6));
  await page.evaluate(() => window.__debug.game.next());
  await page.evaluate(() => window.__debug.advance(0.3));
  await go('tape');
  for (let i = 0; i < 400 && (await page.evaluate(() => window.__debug.game.cur.stage)) !== 'landed'; i++) await page.evaluate(() => window.__debug.advance(0.05, { render: false }));
  assert.equal(await page.evaluate(() => window.__debug.game.cur.stage), 'landed');
  assert.equal(await page.evaluate(() => window.__debug.state), 'flight', 'the tape beat is still part of the flight state');
  await tap();
  assert.equal(await page.evaluate(() => window.__debug.state), 'result', 'a press during the landed/tape beat jumps to the result');
  const tp = await page.evaluate(() => window.__p);
  assert.ok(Math.abs(tp.distance - ref.distance) < 0.05, 'tape-skip mark identical');
  await ctx.close();
  log(`${name}: skip checks pass (press->result ${took} ms, mark ${sk.distance.toFixed(2)} m == ${ref.distance.toFixed(2)} m)`);
}

/** Layout assertions for a modal screen (start / initials / board): inside the viewport, 44px targets, no overlaps, 11px text. */
async function overlayChecks(page, name, mobile, sel, label, { avoidThrower = false } = {}) {
  const info = await page.evaluate(({ sel, avoidThrower }) => {
    const root = document.querySelector(sel);
    const card = root.firstElementChild;
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const small = [];
    for (const el of root.querySelectorAll('*:not(svg *):not(svg)')) {
      if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 10.95) small.push(`${el.tagName.toLowerCase()}#${el.id}:${fs}px "${el.textContent.trim().slice(0, 16)}"`);
    }
    const buttons = [...root.querySelectorAll('button')].filter(vis).map((b) => ({ id: b.id || b.className || b.textContent.trim(), ...box(b) }));
    let thrower = null;
    if (avoidThrower) {
      const g = window.__debug.game;
      const pt = (y) => {
        const v = g.thrower.group.position.clone().setY(y).project(g.camera);
        return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
      };
      thrower = { head: pt(1.9), mid: pt(1.0), feet: pt(0.05) };
    }
    return { card: box(card), buttons, small, scroll: [card.scrollHeight, card.clientHeight], vw: innerWidth, vh: innerHeight, thrower };
  }, { sel, avoidThrower });
  assert.deepEqual(info.small, [], `${name}/${label}: text under 11px`);
  const c = info.card;
  assert.ok(c.l >= -0.5 && c.t >= -0.5 && c.r <= info.vw + 0.5 && c.b <= info.vh + 0.5, `${name}/${label}: card inside the viewport ${JSON.stringify(c)}`);
  assert.ok(info.scroll[0] <= info.scroll[1] + 1, `${name}/${label}: card content fits without scrolling (${info.scroll})`);
  assert.ok(info.buttons.length >= 2, `${name}/${label}: has buttons`);
  for (const b of info.buttons) {
    assert.ok(b.l >= c.l - 0.5 && b.r <= c.r + 0.5 && b.t >= c.t - 0.5 && b.b <= c.b + 0.5, `${name}/${label}: ${b.id} inside the card`);
    assert.ok(b.b - b.t >= 43.9 && b.r - b.l >= 43.9 - (mobile ? 0 : 4), `${name}/${label}: ${b.id} is ${(b.r - b.l).toFixed(0)}x${(b.b - b.t).toFixed(0)}, needs 44`);
  }
  for (let i = 0; i < info.buttons.length; i++)
    for (let j = i + 1; j < info.buttons.length; j++) {
      const a = info.buttons[i];
      const b = info.buttons[j];
      assert.ok(!(a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5), `${name}/${label}: ${a.id} overlaps ${b.id}`);
    }
  if (info.thrower) {
    const T = info.thrower;
    for (const k of ['head', 'mid', 'feet']) {
      const p = T[k];
      assert.ok(p.x > 0 && p.x < info.vw && p.y > 0 && p.y < info.vh, `${name}/${label}: athlete ${k} on screen ${JSON.stringify(p)}`);
      assert.ok(!(p.x > c.l && p.x < c.r && p.y > c.t && p.y < c.b), `${name}/${label}: athlete ${k} hidden behind the card`);
    }
  }
}

async function run(name, viewport, mobile) {
  const { ctx, page } = await openFresh(name, viewport, mobile);
  const click = (sel) => page.locator(sel).click();

  // 1) start screen on every load: title, athlete carousel, mode toggle, PLAY, BOARD (nothing else)
  assert.equal(await page.evaluate(() => window.__debug.state), 'start', 'starts on the start screen');
  await page.evaluate(() => window.__debug.advance(0.6));
  await hudChecks(page, name, mobile, 'start');
  await overlayChecks(page, name, mobile, '#start', 'start', { avoidThrower: true });
  assert.equal((await page.textContent('#charName')).trim(), 'BLAZE');
  assert.equal(await page.getAttribute('#modeRookie', 'aria-checked'), 'true', 'Rookie is the default');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}-1-start.png`) });

  // 2) character select: the carousel changes athlete and the choice is remembered (localStorage, try/catch'd in the game)
  await click('#charNext');
  await page.evaluate(() => window.__debug.advance(0.8));
  assert.equal((await page.textContent('#charName')).trim(), 'OLD IRON');
  await overlayChecks(page, name, mobile, '#start', 'character', { avoidThrower: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}-2-character.png`) });
  await click('#charPrev');
  assert.equal((await page.textContent('#charName')).trim(), 'BLAZE');
  await click('#modePro');
  assert.equal(await page.getAttribute('#modePro', 'aria-checked'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('dd-mode')), 'pro', 'mode choice is remembered');
  assert.equal(await page.evaluate(() => localStorage.getItem('dd-char')), 'blaze', 'athlete choice is remembered');
  await click('#modeRookie');
  assert.equal(await page.evaluate(() => localStorage.getItem('dd-mode')), 'rookie');

  // 3) PLAY with a real click, then the real input path: Space starts a spin, power meter moves, release launches a flight
  await click('#btnStart');
  assert.equal(await page.evaluate(() => window.__debug.state), 'ready', 'PLAY leaves the start screen');
  await page.evaluate(() => window.__debug.advance(0.5));
  await page.waitForTimeout(600);
  await hudChecks(page, name, mobile, 'ready');
  await page.screenshot({ path: path.join(SHOTS, `${name}-3-ready.png`) });
  await page.keyboard.down('Space');
  await page.evaluate(() => window.__debug.advance(1.2));
  assert.equal(await page.evaluate(() => window.__debug.state), 'spin', 'Space starts the spin');
  const pw = await page.textContent('#powerTxt');
  assert.notEqual(pw.trim(), '0%', 'power meter builds while holding');
  await page.evaluate(() => window.__debug.advance(1.1));
  await page.waitForTimeout(450); // let HUD transitions settle
  await hudChecks(page, name, mobile, 'spin');
  await page.screenshot({ path: path.join(SHOTS, `${name}-4-spin.png`) });
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => window.__debug.state), 'flight', 'releasing Space launches the discus');
  await settle(page, 30);
  assert.equal(await page.evaluate(() => window.__debug.state), 'result', 'human-style throw resolves');

  // 4) scripted throw through the same pipeline: fixed seed, strong headwind, good nose angle
  await page.evaluate(() => {
    window.__p = window.__debug.throw({ seed: 4, power: 0.93, psi: 0, attitude: 22, wind: { x: -3, z: 1 } });
  });
  await page.evaluate(() => window.__debug.advance(1.7));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}-5-flight.png`) });
  await settle(page, 40);
  const res = await page.evaluate(() => window.__p);
  log(`${name}: result`, JSON.stringify({ distance: +res.distance.toFixed(2), foul: res.foul, mult: res.mult, rank: res.rank, hits: res.hits }));
  assert.ok(!res.foul, 'scripted throw is a legal throw');
  assert.ok(res.distance > 55 && res.distance < 80, `distance in a believable range: ${res.distance}`);
  const shown = (await page.textContent('#resDist')).trim();
  assert.match(shown, /^\d+\.\d\d$/, 'distance is displayed in metres');
  assert.ok(Math.abs(parseFloat(shown) - res.distance) < 0.011, 'displayed distance matches the physics result');
  assert.match((await page.textContent('#resFeet')).trim(), /^\d+' \d+"$/, 'distance also shown in feet/inches');
  assert.match(await page.textContent('#resChips'), /OLD IRON/, 'the result shows the rival comparison');
  await page.evaluate(() => window.__debug.advance(1.5)); // the result camera glides to its overview
  await page.waitForTimeout(500); // let the CSS slide-in finish
  await hudChecks(page, name, mobile, 'result');
  await page.screenshot({ path: path.join(SHOTS, `${name}-6-result.png`) });

  // 5) replay of the best throw
  await page.evaluate(() => window.__debug.game.onAction('replay'));
  assert.equal(await page.evaluate(() => window.__debug.state), 'replay');
  await page.evaluate(() => window.__debug.advance(2.2));
  await page.screenshot({ path: path.join(SHOTS, `${name}-9-replay.png`) });
  await ctx.close();
  return res;
}

/** Rookie assists, through the real input path: forgiving tap, slower needle in the green, auto nose, coaching, PERFECT. */
async function rookieChecks(name, viewport, mobile) {
  const { ctx, page } = await openFresh(name, viewport, mobile);
  await page.evaluate(() => window.__debug.skipIntro());
  await page.evaluate(() => window.__debug.advance(0.3));
  assert.equal(await page.evaluate(() => window.__debug.game.modeId), 'rookie');
  // a) an instant tap is a playful short throw, not a foul
  await page.keyboard.press('Space');
  await settle(page);
  const tap = await page.evaluate(() => window.__debug.game.cur.rec.result);
  assert.ok(!tap.foul && tap.distance > 8 && tap.distance < 30, `rookie tap is a legal short throw: ${JSON.stringify(tap)}`);
  assert.notEqual((await page.textContent('#resDist')).trim(), 'FOUL');
  // b) the needle slows inside the green (and only there)
  await page.evaluate(() => window.__debug.game.next());
  await page.evaluate(() => window.__debug.advance(0.3));
  const rates = await page.evaluate(() => {
    const g = window.__debug.game;
    g.startSpin();
    let inR = [];
    let outR = [];
    for (let i = 0; i < 400 && g.state === 'spin' && g.spin.rot < 700; i++) {
      const r0 = g.spin.rot;
      const psi = g.spin.psi;
      g.updateSpin(1 / 120);
      const rate = (g.spin.rot - r0) * 120;
      if (Math.abs(psi) < 25) inR.push(rate);
      else if (Math.abs(psi) > 110) outR.push(rate);
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    return { inside: avg(inR), outside: avg(outR) };
  });
  assert.ok(rates.inside < rates.outside * 0.85, `needle eases in the green: ${rates.inside.toFixed(0)} deg/s vs ${rates.outside.toFixed(0)} deg/s outside`);
  await page.evaluate(() => {
    const g = window.__debug.game;
    g.spin = null;
    g.setState('ready');
  });
  // c) hold for ~2.5 turns, let go in the green: legal, a real mark, nose auto-set, and PERFECT flashes at dead centre
  await page.keyboard.down('Space');
  const rel = await page.evaluate(() => {
    const g = window.__debug.game;
    g.attitude = 5; // a bad nose the assist must fix
    g.noseManual = false;
    for (let i = 0; i < 4000 && g.state === 'spin' && !(g.spin.rot > 880 && Math.abs(g.spin.psiVis) < 3); i++) g.update(1 / 240);
    return { rot: g.spin.rot, psi: g.spin.psiVis };
  });
  assert.ok(Math.abs(rel.psi) < 3, `positioned at the centre of the green ${JSON.stringify(rel)}`);
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => window.__debug.state), 'flight');
  assert.match(await page.textContent('#flash'), /PERFECT/, 'dead-centre release flashes PERFECT');
  await settle(page);
  const good = await page.evaluate(() => ({ r: window.__debug.game.cur.rec.result, att: window.__debug.game.cur.rec.params.attitude }));
  assert.ok(!good.r.foul && good.r.distance > 40, `a rookie release in the green is a real throw: ${good.r.distance}`);
  assert.ok(good.att > 12 && good.att < 40, `the nose was auto-set (was 5): ${good.att}`);
  // d) coaching after a foul: one clear line, inside the result card
  await page.evaluate(() => window.__debug.game.next());
  await page.evaluate(() => window.__debug.advance(0.3));
  await page.evaluate(() => {
    const g = window.__debug.game;
    window.__p = g.waitResult();
    g.launch({ speed: 4, releaseAngle: 25, heading: 180, attitude: 25, wind: g.layout.wind }, { foulReason: 'cage', inWindow: false, power: 0.1, psi: 170 });
  });
  await settle(page);
  await page.evaluate(() => window.__debug.advance(1.5));
  await page.waitForTimeout(450);
  assert.equal((await page.textContent('#resCoach')).trim(), 'Let go when the needle is in the green.');
  const cb = await page.evaluate(() => {
    const r = document.getElementById('result').getBoundingClientRect();
    const c = document.getElementById('resCoach').getBoundingClientRect();
    return { visible: c.width > 0 && c.height > 0, inside: c.top >= r.top && c.bottom <= r.bottom + 0.5 && c.left >= r.left && c.right <= r.right + 0.5, vh: innerHeight, b: c.bottom };
  });
  assert.ok(cb.visible && cb.inside && cb.b <= cb.vh, `coach line visible inside the result card ${JSON.stringify(cb)}`);
  await hudChecks(page, name, mobile, 'foul-coach');
  // e) Pro has no coaching line and no assist
  await page.evaluate(() => window.__debug.setMode('pro'));
  assert.equal(await page.evaluate(() => window.__debug.game.mode.noseAssist), false);
  await ctx.close();
  log(`${name}: rookie assist checks pass (tap ${tap.distance.toFixed(1)} m, green throw ${good.r.distance.toFixed(1)} m, needle ${rates.inside.toFixed(0)}/${rates.outside.toFixed(0)} deg/s)`);
}

/** Finish a run: initials entry (keyboard + buttons), leaderboard, daily tab, share text, final-screen chips in a 3-column grid. */
async function boardChecks(name, viewport, mobile) {
  const { ctx, page } = await openFresh(name, viewport, mobile);
  await page.evaluate(() => window.__debug.skipIntro());
  await page.evaluate(() => window.__debug.advance(0.3));
  // three scripted throws (one is a foul so the final screen shows a FOUL chip), then the final card
  for (let i = 0; i < 3; i++) {
    await page.evaluate((i) => {
      window.__p = window.__debug.throw({ seed: 20 + i, power: i === 1 ? 0.2 : 0.95, psi: i === 1 ? 170 : 0, attitude: 24, heading: i === 1 ? 60 : undefined });
    }, i);
    await settle(page, 40);
    if (i < 2) await page.evaluate(() => window.__debug.game.next());
    await page.evaluate(() => window.__debug.advance(0.3));
  }
  await page.evaluate(() => window.__debug.game.next()); // -> final
  assert.equal(await page.evaluate(() => window.__debug.state), 'final');
  await page.evaluate(() => window.__debug.advance(0.6));
  await page.waitForTimeout(450);
  // final-screen T1/T2/T3 chips sit in a 3-column grid on one row, equal widths
  const chips = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#resChips span')].filter((e) => /^T\d/.test(e.textContent));
    return el.map((e) => {
      const r = e.getBoundingClientRect();
      return { t: Math.round(r.top), w: Math.round(r.width) };
    });
  });
  assert.equal(chips.length, 3, 'three throw chips');
  assert.equal(new Set(chips.map((c) => c.t)).size, 1, `T1/T2/T3 share one row ${JSON.stringify(chips)}`);
  assert.ok(Math.max(...chips.map((c) => c.w)) - Math.min(...chips.map((c) => c.w)) <= 2, `equal-width columns ${JSON.stringify(chips)}`);
  await hudChecks(page, name, mobile, 'final');
  await page.screenshot({ path: path.join(SHOTS, `${name}-7-final.png`) });
  // share text
  await page.locator('#btnShare').click();
  await page.waitForFunction(() => !!window.__debug.game.lastShare);
  const shareTxt = await page.evaluate(() => window.__debug.game.lastShare);
  assert.match(shareTxt, /^DISCUS DISASTER · \d+\.\d m · Rookie · discus-disaster\.vercel\.app$/, `share text: ${shareTxt}`);
  // initials prompt appears a beat after the final card (qualifying: the board is seeded with beatable NPCs)
  await page.evaluate(() => window.__debug.advance(1.6));
  await page.waitForFunction(() => window.__debug.state === 'initials', null, { timeout: 5000 }).catch(() => {});
  assert.equal(await page.evaluate(() => window.__debug.state), 'initials', 'a qualifying round asks for initials');
  await overlayChecks(page, name, mobile, '#initials', 'initials');
  await page.keyboard.press('KeyB');
  await page.keyboard.press('KeyO');
  assert.equal((await page.textContent('#ini0')) + (await page.textContent('#ini1')) + (await page.textContent('#ini2')), 'BOA', 'typing sets letters');
  await page.locator('#initials .wheel:nth-child(3) .up').click(); // A -> B
  await page.locator('#initials .wheel:nth-child(3) .down').click();
  await page.locator('#initials .wheel:nth-child(3) .down').click(); // B -> A -> Z
  assert.equal(await page.textContent('#ini2'), 'Z', 'wheel buttons change a letter');
  await page.locator('#initials .wheel:nth-child(3) .up').click(); // Z -> A
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('KeyB'); // slot 0 -> B, advance
  await page.keyboard.press('KeyO');
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}-7-initials.png`) });
  await page.locator('#iniOk').click();
  await page.waitForFunction(() => window.__debug.state === 'board', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  await overlayChecks(page, name, mobile, '#board', 'board');
  const row = await page.evaluate(() => {
    const y = document.querySelector('.brow.you');
    return y ? y.textContent : null;
  });
  assert.ok(row && /BOB/.test(row) && /ROOKIE/.test(row), `your entry is highlighted on the board: ${row}`);
  const rows = await page.evaluate(() => document.querySelectorAll('.brow:not(.head)').length);
  assert.ok(rows >= 6 && rows <= 10, `board has ${rows} rows`);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dd-board-v1')).all.length), 1, 'entry saved to localStorage');
  await page.screenshot({ path: path.join(SHOTS, `${name}-8-board.png`) });
  // daily tab: own board + "play today's throw"
  await page.locator('#tabDaily').click();
  await page.waitForTimeout(150);
  assert.ok((await page.evaluate(() => document.querySelectorAll('.brow:not(.head)').length)) >= 3, 'daily board is seeded');
  assert.ok(await page.locator('#btnPlayDaily').isVisible(), 'daily tab offers the Daily Throw');
  await overlayChecks(page, name, mobile, '#board', 'board-daily');
  await page.locator('#btnBoardClose').click();
  assert.equal(await page.evaluate(() => window.__debug.state), 'final', 'closing the board returns to the final card');
  // Daily Throw: same wind for the same date, via the board button
  const winds = [];
  for (let k = 0; k < 2; k++) {
    await page.locator('#btnBoard2').click();
    await page.locator('#tabDaily').click();
    await page.locator('#btnPlayDaily').click();
    assert.equal(await page.evaluate(() => window.__debug.state), 'ready');
    winds.push(await page.evaluate(() => JSON.stringify(window.__debug.game.layout.wind)));
    assert.equal((await page.textContent('#attemptLbl')).trim(), 'DAILY');
    await page.evaluate(() => {
      const g = window.__debug.game;
      g.attempts = [{ foul: true }, { foul: true }, { foul: true }];
      g.attempt = 2;
      g.best = null;
      g.showFinal();
    });
    await page.evaluate(() => window.__debug.advance(0.1));
  }
  assert.equal(winds[0], winds[1], 'the Daily Throw has the same wind for everyone / every attempt that day');
  await ctx.close();
  log(`${name}: initials, board, daily and share checks pass`);
}


/** v3 features through the real UI: camera cycling, athlete swap, technique picker, charge meter, venue + weather pickers. */
async function featureChecks(name, viewport, mobile) {
  const { ctx, page } = await openFresh(name, viewport, mobile);
  const D = (fn, arg) => page.evaluate(fn, arg);
  const click = (sel) => page.locator(sel).click();
  // --docs refreshes the feature shots only for the desktop and phone-portrait viewports (keeps docs/ small)
  const toDocs = TO_DOCS && /desktop|mobile/.test(name);
  const shot = (f, always = false) => page.screenshot({ path: path.join(always || !toDocs ? path.join(ROOT, 'tests', 'out') : SHOTS, `${name}-${f}.png`) });
  mkdirSync(path.join(ROOT, 'tests', 'out'), { recursive: true });

  // ---- venue + weather pickers (start screen) ----
  assert.ok(await page.locator('#btnVenue').isVisible() && (await page.locator('#btnWeather').isVisible()), 'venue and weather pickers are on the start screen');
  assert.equal((await page.textContent('#venueName')).trim(), 'COLLEGE MEET');
  assert.equal((await page.textContent('#weatherName')).trim(), 'CLEAR NIGHT');
  await overlayChecks(page, name, mobile, '#start', 'start-setup', { avoidThrower: true });
  await click('#btnVenue');
  assert.equal(await D(() => window.__debug.game.venueId), 'world');
  assert.equal(await D(() => localStorage.getItem('dd-venue')), 'world', 'venue is remembered');
  assert.equal((await page.textContent('#venueName')).trim(), 'WORLD STADIUM');
  assert.equal(await D(() => window.__debug.game.stadium.info().venue), 'world');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await click('#btnWeather');
    seen.push(await D(() => window.__debug.game.weatherChoice));
  }
  assert.deepEqual(seen, ['breezy', 'rain', 'fog', 'sunset', 'random', 'clear'], 'the weather picker cycles Clear > Breezy > Rain > Fog > Sunset > Random');
  await click('#btnWeather');
  await click('#btnWeather'); // -> rain
  assert.equal(await D(() => window.__debug.game.weatherId), 'rain');
  assert.equal(await D(() => localStorage.getItem('dd-wx')), 'rain', 'weather is remembered');
  assert.equal(await D(() => window.__debug.game.layout.weather), 'rain', 'the wind is rolled for the weather');
  await D(() => window.__debug.advance(1.2));
  await overlayChecks(page, name, mobile, '#start', 'start-venue-weather', { avoidThrower: true });
  await page.waitForTimeout(250);
  await shot('13-venue-weather');
  await click('#btnStart');
  await D(() => window.__debug.advance(1));
  const wxTitle = ((await page.getAttribute('#windWx', 'title')) || '').trim();
  assert.match(wxTitle, /^Rain, \d+°C/, `weather + temperature are in the wind badge (title: ${wxTitle})`);
  assert.match((await page.textContent('#windWx')).trim(), /\d+°C$/, 'the temperature is shown in the badge');
  const wet = await D(() => ({ win: window.__debug.game.windowHalf, rain: window.__debug.game.stadium.info().venue, vis: !!document.querySelector('body[data-weather="rain"]') }));
  assert.ok(wet.win < 62 * 0.95 && wet.vis, `rain narrows the green (${wet.win.toFixed(1)} vs 62)`);
  await hudChecks(page, name, mobile, 'ready');
  await shot('14-world-rain-ready');
  // a throw in the rain uses the wet-air density and the same pipeline
  const rho = await D(async () => {
    const r = await window.__debug.runThrow({ power: 0.9, psi: 0, attitude: 24 });
    const g = window.__debug.game;
    return { rho: g.cur.rec.params.rho, want: g.layout.rho, foul: r.foul, d: r.distance };
  });
  assert.equal(rho.rho, rho.want, 'the flight uses this weather\'s air density');
  assert.ok(!rho.foul && rho.d > 50 && rho.d < 78, `a rainy throw is a believable throw: ${rho.d}`);
  await D(() => { window.__debug.setWeather('sunset'); window.__debug.setVenue('college'); window.__debug.game.newRun(); window.__debug.advance(2.5); });
  assert.equal(await D(() => window.__debug.game.state), 'ready');
  await hudChecks(page, name, mobile, 'ready');
  await shot('15-college-sunset-ready');
  await D(() => { window.__debug.setWeather('clear'); window.__debug.game.newRun(); window.__debug.advance(1); });
  assert.equal(await D(() => window.__debug.game.layout.weather), 'clear');

  // ---- technique picker ----
  await D(() => window.__debug.advance(0.5));
  assert.ok(await page.locator('#btnTech').isVisible(), 'technique button shown while ready');
  await click('#btnTech');
  assert.equal(await D(() => window.__debug.game.state), 'tech');
  await D(() => window.__debug.advance(2.2));
  await page.waitForTimeout(300);
  const names = await page.locator('#techList .tc .tc-name').allTextContents();
  assert.equal(names.length, 5, 'five technique cards');
  assert.ok(names.includes('POWER SPIN') && names.includes('WIDE-LEG REVERSE') && names.includes('LOW ARC') && names.includes('FLOATER') && names.includes('STANDING THROW'));
  await overlayChecks(page, name, mobile, '#tech', 'technique', { avoidThrower: true });
  const link = await D(() => {
    const a = document.getElementById('techReal');
    const r = a.getBoundingClientRect();
    const c = document.querySelector('.tech-card').getBoundingClientRect();
    return { href: a.href, target: a.target, rel: a.rel, h: r.height, inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 };
  });
  assert.equal(link.href, 'https://worldathletics.org/disciplines/throws/discus-throw');
  assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/);
  assert.ok(link.h >= 43.9 && link.inside, `the real-technique link is a 44px target inside the card ${JSON.stringify(link)}`);
  await shot('10-technique');
  // the demo is the real in-game athlete: the pose differs per technique and the discus leaves the hand
  const poses = {};
  for (const [id, label] of [['power', 'POWER SPIN'], ['standing', 'STANDING THROW'], ['low', 'LOW ARC'], ['floater', 'FLOATER'], ['wide', 'WIDE-LEG REVERSE']]) {
    await page.locator('#techList .tc', { hasText: label }).click();
    assert.equal(await D(() => window.__debug.game.techId), id);
    assert.equal(await page.locator('#techList .tc[aria-checked="true"]').count(), 1);
    await D(() => window.__debug.advance(1.5)); // mid-spin
    poses[id] = await D(() => { const g = window.__debug.game; const t = g.thrower; return [t.hand.getWorldPosition(new g.camPos.constructor()).y.toFixed(3), t.group.children[0].position.y.toFixed(3)].join('/'); });
    await D(() => window.__debug.advance(2.2)); // after the release the disc flies away from the hand
    const away = await D(() => { const g = window.__debug.game; return g.discus.group.parent === g.scene; });
    assert.ok(away || (await D(() => window.__debug.game.demo.t)) > 0, `${id}: the demo loop runs`);
    assert.equal(await D(() => localStorage.getItem('dd-tech')), id, 'technique is remembered');
  }
  assert.ok(new Set(Object.values(poses)).size >= 4, `each technique is performed differently: ${JSON.stringify(poses)}`);
  // physics: the chosen technique reaches the release mapping (direction checks live in tests/techniques.test.mjs)
  const phys = await D(async () => {
    const m = await import('/src/modes.js');
    const t = await import('/src/techniques.js');
    const out = {};
    for (const x of t.TECHNIQUES) out[x.id] = m.releaseParams(m.MODES.pro, { psi: 0, rot: 1100, power: 1, attitude: 25, wind: { x: 0, z: 0 }, technique: x });
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { speed: v.params.speed, angle: v.params.releaseAngle, nose: v.params.attitude, window: v.meta.window }]));
  });
  assert.ok(phys.power.speed > phys.wide.speed && phys.standing.speed < phys.wide.speed && phys.low.angle < phys.wide.angle && phys.floater.nose > phys.wide.nose && phys.standing.window > phys.power.window);
  await page.keyboard.press('ArrowDown');
  await click('#techDone');
  assert.equal(await D(() => window.__debug.game.state), 'ready');
  await D(() => window.__debug.setTechnique('standing'));
  assert.equal((await page.textContent('#techName')).trim(), 'STANDING THROW');
  // a human-style throw with Standing Throw: slow release, and the window is the widest
  await page.keyboard.down('Space');
  await D(() => window.__debug.advance(1.1));
  await page.keyboard.up('Space');
  await settle(page, 30);
  const st = await D(() => ({ tech: window.__debug.game.cur.rec.meta.technique, speed: window.__debug.game.cur.rec.params.speed }));
  assert.equal(st.tech, 'standing');
  assert.ok(st.speed <= 24.6 * 0.8 + 0.01, `standing throw release speed ${st.speed.toFixed(1)}`);
  await D(() => window.__debug.setTechnique('wide'));

  // ---- athlete swap from the result card (and the P key in ready) ----
  await D(() => window.__debug.advance(1.5));
  await page.waitForTimeout(500);
  assert.ok(await page.locator('#btnSwap').isVisible(), 'swap button in the result card');
  const before = await D(() => ({ p: window.__debug.game.personaId, rival: window.__debug.game.rivalInfo.name }));
  await hudChecks(page, name, mobile, 'result');
  await click('#btnSwap');
  const after = await D(() => ({ p: window.__debug.game.personaId, rival: window.__debug.game.rivalInfo.name, ch: localStorage.getItem('dd-char') }));
  assert.notEqual(after.p, before.p, 'the athlete changed');
  assert.notEqual(after.rival, before.rival, 'the rival flag follows the athlete');
  assert.equal(after.ch, after.p, 'swap is remembered');
  await D(() => window.__debug.advance(1.2));
  assert.match((await page.textContent('#resChips')).toUpperCase(), new RegExp(after.rival.replace(/[^A-Z0-9 ]/g, '.')), 'the result card shows the NEW rival');
  await hudChecks(page, name, mobile, 'result');
  await page.waitForTimeout(300);
  await shot('12-swap');
  await D(() => window.__debug.game.next());
  await D(() => window.__debug.advance(0.5));
  await page.keyboard.press('KeyP');
  assert.notEqual(await D(() => window.__debug.game.personaId), after.p, 'P swaps the athlete in ready too');

  // ---- charge meter: build -> sweet spot -> overcharge (the green shrinks), no foul until the step-out turn ----
  await D(() => { window.__debug.game.setState('ready'); window.__debug.game.startSpin(); });
  const zones = await D(() => {
    const g = window.__debug.game;
    const at = (turns) => {
      while (g.state === 'spin' && g.spin.rot < turns * 360) g.update(1 / 120);
      return { state: document.getElementById('powerState').textContent, win: g.windowHalf, dial: document.getElementById('dialWindow').getAttribute('d'), cls: document.getElementById('powerFill').className, w: parseFloat(document.getElementById('powerFill').style.width) };
    };
    const a = at(1.2);
    const b = at(3.3);
    const c = at(4.6);
    const bar = document.getElementById('powerBar').getBoundingClientRect();
    const sw = document.getElementById('zoneSweet').getBoundingClientRect();
    const ov = document.getElementById('zoneOver').getBoundingClientRect();
    return { a, b, c, state: g.state, bar: [bar.left, bar.right], sw: [sw.left, sw.right], ov: [ov.left, ov.right] };
  });
  assert.equal(zones.a.state, 'BUILD');
  assert.equal(zones.b.state, 'SWEET SPOT');
  assert.equal(zones.c.state, 'OVERCHARGE');
  assert.ok(zones.c.win < zones.b.win * 0.92, `the green window shrinks when overcharged: ${zones.b.win.toFixed(1)} -> ${zones.c.win.toFixed(1)}`);
  assert.notEqual(zones.b.dial, zones.c.dial, 'the dial redraws the narrower green');
  assert.equal(zones.state, 'spin', 'overcharging is not a foul by itself');
  assert.ok(zones.sw[0] >= zones.bar[0] - 1 && zones.sw[1] <= zones.ov[0] + 1 && zones.ov[1] <= zones.bar[1] + 1, `zones sit inside the bar and in order ${JSON.stringify(zones)}`);
  assert.ok(zones.b.w > zones.a.w && zones.c.w > zones.b.w, 'the charge bar fills up with the turns');
  await D(() => { const g = window.__debug.game; g.spin = null; g.setState('ready'); });

  // ---- camera presets: key C / gamepad-style action cycles, remembered, never fully behind a net ----
  await D(() => { window.__debug.game.startAttempt(); window.__debug.advance(2); });
  assert.equal(await D(() => window.__debug.game.camId), 'broadcast');
  const order = ['behind', 'side', 'disc', 'overhead', 'broadcast'];
  for (const id of order) {
    await page.keyboard.press('KeyC');
    assert.equal(await D(() => window.__debug.game.camId), id, `C cycles to ${id}`);
    assert.equal(await D(() => localStorage.getItem('dd-cam')), id, 'camera choice is remembered');
    await D(() => window.__debug.advance(3));
    assert.ok(await finiteCamera(page), `${id}: camera finite`);
    const blocked = await D(async () => {
      const m = await import('/src/camera.js');
      const c = window.__debug.game.camera.position;
      return m.viewBlocked({ x: c.x, y: c.y, z: c.z }, { x: 0, y: 1.2, z: 0 });
    });
    assert.equal(blocked, false, `${id}: no net fills the view of the athlete`);
    await hudChecks(page, name, mobile, 'ready');
  }
  assert.equal((await page.textContent('#camName')).trim(), 'BROADCAST');
  // each preset mid-flight (and the toast names it); pressing C while airborne works
  for (const id of ['behind', 'side', 'disc', 'overhead']) {
    await D((c) => window.__debug.setCamera(c), id);
    await D(() => { const g = window.__debug.game; if (g.state !== 'ready') { while (g.state === 'result') g.next(); } g.startAttempt(); window.__debug.advance(1.5); window.__p = window.__debug.throw({ seed: 4, power: 0.95, psi: 0, attitude: 22, wind: { x: -3, z: 1 } }); });
    await D(() => window.__debug.advance(1.5));
    assert.equal(await D(() => window.__debug.state), 'flight');
    assert.ok(await finiteCamera(page), `${id}: camera finite mid-flight`);
    const cam = await D(() => { const c = window.__debug.game.camera; return [c.position.x, c.position.y, c.position.z]; });
    assert.ok(cam.every((v) => Math.abs(v) < 200), `${id}: the camera stays in the stadium ${cam}`);
    await hudChecks(page, name, mobile, 'flight');
    await shot(`11-cam-${id}`, true);
    await settle(page, 40);
  }
  await D(() => { const g = window.__debug.game; g.next(); g.startAttempt(); window.__debug.advance(1); window.__p = window.__debug.throw({ seed: 4, power: 0.9, psi: 0 }); window.__debug.advance(1); });
  const mid = await D(() => window.__debug.game.camId);
  await page.keyboard.press('KeyC');
  assert.notEqual(await D(() => window.__debug.game.camId), mid, 'C also works during flight');
  await settle(page, 40);
  await D(() => window.__debug.game.onAction('replay'));
  assert.equal(await D(() => window.__debug.state), 'replay');
  const mid2 = await D(() => window.__debug.game.camId);
  await page.keyboard.press('KeyC');
  assert.notEqual(await D(() => window.__debug.game.camId), mid2, 'C also works during the replay');
  await D(() => window.__debug.advance(1.5));
  assert.ok(await finiteCamera(page), 'camera finite in the replay');
  await ctx.close();

  // reduced motion: a preset switch cuts instead of gliding
  const rm = await openFresh(name + '-rm', viewport, mobile, { reducedMotion: 'reduce' });
  await rm.page.evaluate(() => window.__debug.skipIntro());
  await rm.page.evaluate(() => window.__debug.advance(2));
  await rm.page.evaluate(() => window.__debug.setCamera('overhead'));
  await rm.page.evaluate(() => window.__debug.advance(0.1));
  const near = await rm.page.evaluate(() => {
    const g = window.__debug.game;
    const p = g.camera.position.clone();
    window.__debug.advance(4);
    return p.distanceTo(g.camera.position);
  });
  assert.ok(near < 1.5, `reduced motion cuts straight to the new view (${near.toFixed(2)} m from settled after 0.1 s)`);
  await rm.ctx.close();
  log(`${name}: venue, weather, technique, swap, charge-meter and camera checks pass`);
}

const VIEWS = [
  ['desktop-1440x900', { width: 1440, height: 900 }, false],
  ['mobile-390x844', { width: 390, height: 844 }, true],
  ['landscape-844x390', { width: 844, height: 390 }, true],
  ['landscape-667x375', { width: 667, height: 375 }, true],
];

let failed = false;
try {
  for (const v of VIEWS) await run(...v);
  for (const v of VIEWS) await instantRelease(...v);
  for (const v of VIEWS) await rookieChecks(...v);
  for (const v of VIEWS) await boardChecks(...v);
  for (const v of VIEWS) await skipChecks(...v);
  for (const v of VIEWS) await featureChecks(...v);
  if (errors.length) {
    console.error('[smoke] console/page errors:\n' + errors.join('\n'));
    failed = true;
  } else log('no console errors');
} catch (e) {
  console.error('[smoke] FAILED:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
if (failed) process.exit(1);
log(`PASS - screenshots in ${path.relative(ROOT, SHOTS)}/`);
