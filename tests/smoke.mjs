// Playwright smoke test: serves the repo statically and, at 1440x900, 390x844 (touch), 844x390 and 667x375 (touch,
// landscape): plays one human-style throw through the REAL input path, an instant press+release / touch tap,
// a poisoned release (NaN guard) and a scripted throw; asserts no console errors, finite camera, a result
// shown quickly, 44px tool buttons, 11px minimum HUD text, a non-overlapping result card whose buttons are fully on
// screen, a visible landing mark, and a press during flight that reaches the result in < 2 s with the same mark.
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

async function openFresh(name, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
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
  const info = await page.evaluate(() => {
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
    for (const el of document.querySelectorAll('#hud *:not(svg *):not(svg), #howto *:not(svg *):not(svg)')) {
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
    const btns = ['btnNext', 'btnReplay2'].map((id) => document.getElementById(id)).filter((b) => b && vis(b)).map((b) => ({ id: b.id, ...box(b) }));
    const bar = ['.bug', '.tools', '.wind'].map((q) => [q, document.querySelector(q)]).filter(([, el]) => el && vis(el)).map(([q, el]) => ({ q, ...box(el) }));
    // landing mark (the discus rests on it) in CSS px
    let landing = null;
    const g = window.__debug.game;
    if (res && vis(res) && g.cur && g.cur.rec.result && !g.cur.rec.result.foul) {
      const v = g.discus.group.position.clone().project(g.camera);
      landing = { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, front: v.z < 1 };
    }
    return { small, tools, others, bar, btns, landing, result, vw: innerWidth, vh: innerHeight, meta: document.querySelector('meta[name=viewport]').content };
  });
  assert.ok(!/user-scalable\s*=\s*(no|0)/i.test(info.meta), 'pinch zoom is not disabled');
  assert.deepEqual(info.small, [], `${name}/${state}: HUD text under 11px`);
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

async function run(name, viewport, mobile) {
  const { ctx, page } = await openFresh(name, viewport, mobile);

  // 1) how-to overlay is shown on first visit
  assert.equal(await page.evaluate(() => window.__debug.state), 'howto', 'starts on the how-to overlay');
  await page.evaluate(() => window.__debug.advance(0.6));
  await hudChecks(page, name, mobile, 'howto');
  await page.screenshot({ path: path.join(SHOTS, `${name}-1-howto.png`) });

  // 2) real input path: Space starts a spin, power meter moves, release launches a flight
  await page.evaluate(() => window.__debug.skipIntro());
  await page.evaluate(() => window.__debug.advance(0.5));
  await page.waitForTimeout(600);
  await hudChecks(page, name, mobile, 'ready');
  await page.screenshot({ path: path.join(SHOTS, `${name}-2-ready.png`) });
  await page.keyboard.down('Space');
  await page.evaluate(() => window.__debug.advance(1.2));
  assert.equal(await page.evaluate(() => window.__debug.state), 'spin', 'Space starts the spin');
  const pw = await page.textContent('#powerTxt');
  assert.notEqual(pw.trim(), '0%', 'power meter builds while holding');
  await page.evaluate(() => window.__debug.advance(1.1));
  await page.waitForTimeout(450); // let HUD transitions settle
  await hudChecks(page, name, mobile, 'spin');
  await page.screenshot({ path: path.join(SHOTS, `${name}-3-spin.png`) });
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => window.__debug.state), 'flight', 'releasing Space launches the discus');
  await settle(page, 30);
  assert.equal(await page.evaluate(() => window.__debug.state), 'result', 'human-style throw resolves');

  // 3) scripted throw through the same pipeline: fixed seed, strong headwind, good nose angle
  await page.evaluate(() => {
    window.__p = window.__debug.throw({ seed: 4, power: 0.93, psi: 0, attitude: 22, wind: { x: -3, z: 1 } });
  });
  await page.evaluate(() => window.__debug.advance(1.7));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}-4-flight.png`) });
  await settle(page, 40);
  const res = await page.evaluate(() => window.__p);
  log(`${name}: result`, JSON.stringify({ distance: +res.distance.toFixed(2), foul: res.foul, mult: res.mult, rank: res.rank, hits: res.hits }));
  assert.ok(!res.foul, 'scripted throw is a legal throw');
  assert.ok(res.distance > 55 && res.distance < 80, `distance in a believable range: ${res.distance}`);
  const shown = (await page.textContent('#resDist')).trim();
  assert.match(shown, /^\d+\.\d\d$/, 'distance is displayed in metres');
  assert.ok(Math.abs(parseFloat(shown) - res.distance) < 0.011, 'displayed distance matches the physics result');
  assert.match((await page.textContent('#resFeet')).trim(), /^\d+' \d+"$/, 'distance also shown in feet/inches');
  await page.evaluate(() => window.__debug.advance(1.5)); // the result camera glides to its overview
  await page.waitForTimeout(500); // let the CSS slide-in finish
  await hudChecks(page, name, mobile, 'result');
  await page.screenshot({ path: path.join(SHOTS, `${name}-5-result.png`) });

  // 4) replay of the best throw
  await page.evaluate(() => window.__debug.game.onAction('replay'));
  assert.equal(await page.evaluate(() => window.__debug.state), 'replay');
  await page.evaluate(() => window.__debug.advance(2.2));
  await page.screenshot({ path: path.join(SHOTS, `${name}-6-replay.png`) });
  await ctx.close();
  return res;
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
  for (const v of VIEWS) await skipChecks(...v);
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
