// Playwright smoke test: serves the repo statically, plays one automated throw through the real
// pipeline (window.__debug.throw), asserts no console errors + a distance on screen, and saves
// screenshots at 1440x900 and 390x844 into docs/shots/.
//   node tests/smoke.mjs
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
const SHOTS = path.join(ROOT, 'docs', 'shots');
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

async function run(name, viewport, mobile) {
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

  // 1) how-to overlay is shown on first visit
  assert.equal(await page.evaluate(() => window.__debug.state), 'howto', 'starts on the how-to overlay');
  await page.evaluate(() => window.__debug.advance(0.6));
  await page.screenshot({ path: path.join(SHOTS, `${name}-1-howto.png`) });

  // 2) real input path: Space starts a spin, power meter moves, release launches a flight
  await page.evaluate(() => window.__debug.skipIntro());
  await page.evaluate(() => window.__debug.advance(0.5));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, `${name}-2-ready.png`) });
  await page.keyboard.down('Space');
  await page.evaluate(() => window.__debug.advance(1.2));
  assert.equal(await page.evaluate(() => window.__debug.state), 'spin', 'Space starts the spin');
  const pw = await page.textContent('#powerTxt');
  assert.notEqual(pw.trim(), '0%', 'power meter builds while holding');
  await page.evaluate(() => window.__debug.advance(1.1));
  await page.waitForTimeout(450); // let HUD transitions settle
  await page.screenshot({ path: path.join(SHOTS, `${name}-3-spin.png`) });
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => window.__debug.state), 'flight', 'releasing Space launches the discus');
  await page.evaluate(() => {
    // run the human throw to its result headlessly
    const g = window.__debug.game;
    let t = 0;
    while (g.state !== 'result' && t < 30) {
      g.update(1 / 30);
      t += 1 / 30;
    }
  });
  assert.equal(await page.evaluate(() => window.__debug.state), 'result', 'human-style throw resolves');

  // 3) scripted throw through the same pipeline: fixed seed, strong headwind, good nose angle
  await page.evaluate(() => {
    window.__p = window.__debug.throw({ seed: 4, power: 0.93, psi: 0, attitude: 22, wind: { x: -3, z: 1 } });
  });
  await page.evaluate(() => window.__debug.advance(1.7));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}-4-flight.png`) });
  let guard = 0;
  while ((await page.evaluate(() => window.__debug.state)) !== 'result' && guard++ < 80) {
    await page.evaluate(() => window.__debug.advance(0.25, { render: false }));
  }
  await page.evaluate(() => window.__debug.advance(0.1));
  const res = await page.evaluate(() => window.__p);
  log(`${name}: result`, JSON.stringify({ distance: +res.distance.toFixed(2), foul: res.foul, mult: res.mult, rank: res.rank, hits: res.hits }));
  assert.ok(!res.foul, 'scripted throw is a legal throw');
  assert.ok(res.distance > 55 && res.distance < 80, `distance in a believable range: ${res.distance}`);
  const shown = (await page.textContent('#resDist')).trim();
  assert.match(shown, /^\d+\.\d\d$/, 'distance is displayed in metres');
  assert.ok(Math.abs(parseFloat(shown) - res.distance) < 0.011, 'displayed distance matches the physics result');
  assert.match((await page.textContent('#resFeet')).trim(), /^\d+' \d+"$/, 'distance also shown in feet/inches');
  await page.waitForTimeout(500); // let the CSS slide-in finish
  await page.screenshot({ path: path.join(SHOTS, `${name}-5-result.png`) });

  // 4) replay of the best throw
  await page.evaluate(() => window.__debug.game.onAction('replay'));
  assert.equal(await page.evaluate(() => window.__debug.state), 'replay');
  await page.evaluate(() => window.__debug.advance(2.2));
  await page.screenshot({ path: path.join(SHOTS, `${name}-6-replay.png`) });
  await ctx.close();
  return res;
}

let failed = false;
try {
  await run('desktop-1440x900', { width: 1440, height: 900 }, false);
  await run('mobile-390x844', { width: 390, height: 844 }, true);
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
log('PASS - screenshots in docs/shots/');
