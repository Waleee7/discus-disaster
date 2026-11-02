// Playwright smoke test: serves the repo statically and, at 1440x900, 390x844 (touch) and 844x390 (touch,
// landscape): plays one human-style throw through the REAL input path, an instant press+release / touch tap,
// a poisoned release (NaN guard) and a scripted throw; asserts no console errors, finite camera, a result
// shown quickly, 44px tool buttons, 11px minimum HUD text and a non-overlapping result card.
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
    return { small, tools, others, result, vw: innerWidth, vh: innerHeight, meta: document.querySelector('meta[name=viewport]').content };
  });
  assert.ok(!/user-scalable\s*=\s*(no|0)/i.test(info.meta), 'pinch zoom is not disabled');
  assert.deepEqual(info.small, [], `${name}/${state}: HUD text under 11px`);
  if (mobile) for (const b of info.tools) assert.ok(b.b - b.t >= 43.9 && b.r - b.l >= 43.9, `${name}: tool button ${b.id} is ${(b.r - b.l).toFixed(0)}x${(b.b - b.t).toFixed(0)}, needs 44x44`);
  if (info.result) {
    const r = info.result;
    assert.ok(r.l >= 0 && r.t >= 0 && r.r <= info.vw + 0.5 && r.b <= info.vh + 0.5, `${name}: result card inside the viewport ${JSON.stringify(r)}`);
    for (const o of info.others) {
      const hit = r.l < o.r && r.r > o.l && r.t < o.b && r.b > o.t;
      assert.ok(!hit, `${name}: result card overlaps ${o.q} ${JSON.stringify(o)} vs ${JSON.stringify(r)}`);
    }
  }
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
];

let failed = false;
try {
  for (const v of VIEWS) await run(...v);
  for (const v of VIEWS) await instantRelease(...v);
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
