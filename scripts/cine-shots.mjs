// Pixel proof: deterministic screenshots of the cinematic moments at phone (390x844 @3x, touch) and desktop (1440x900).
// Walk-out frames, a throw (spin, release, flight, landing), the jumbotron replay during the result, and the full-screen
// cinematic replay. Everything is driven through window.__debug (the same code paths a player uses), stepped manually.
//   node scripts/cine-shots.mjs [--out dir] [--only phone|desktop] [--q low|mid|high] [--venue world] [--wx rain]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.claude/scripts/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg('--out', path.join(ROOT, 'tests', 'out', 'cine')));
const ONLY = arg('--only');
const Q = arg('--q');
const VENUE = arg('--venue', 'college');
const WX = arg('--wx', 'clear');
const STEPS = (arg('--steps', '') || '').split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });

const port = await new Promise((res) => {
  const s = net.createServer().listen(0, () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const url = `http://127.0.0.1:${port}/index.html${Q ? `?q=${Q}` : ''}`;
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const PROFILES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
].filter((p) => !ONLY || p.name === ONLY);

const want = (s) => !STEPS.length || STEPS.includes(s);
for (const prof of PROFILES) {
  const ctx = await browser.newContext({ viewport: prof.viewport, deviceScaleFactor: prof.deviceScaleFactor, isMobile: prof.isMobile, hasTouch: prof.hasTouch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(prof.name, 'pageerror', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(prof.name, 'console.error', m.text()));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__debug);
  await page.evaluate(() => window.__debug.artReady());
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(([v, w]) => {
    window.__debug.manual(true);
    window.__debug.setVenue(v);
    window.__debug.setWeather(w);
  }, [VENUE, WX]);
  const D = (fn, a) => page.evaluate(fn, a);
  const shot = async (n) => {
    await page.waitForTimeout(120);
    const f = path.join(OUT, `${prof.name}-${n}.png`);
    await page.screenshot({ path: f });
    console.log('shot', f);
  };
  const adv = (s) => D((s) => window.__debug.advance(s), s);

  await adv(0.5);
  if (want('start')) await shot('00-start');
  // walk-out (if the build has one): PLAY through the real button
  const hasWalk = await D(() => typeof window.__debug.game.startWalkout === 'function');
  await page.locator('#btnStart').click();
  if (hasWalk && (await D(() => window.__debug.state)) === 'walkout') {
    const total = await D(() => window.__debug.game.walk.total);
    const marks = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
    let t = 0;
    for (let i = 0; i < marks.length; i++) {
      const to = marks[i] * total;
      await adv(to - t);
      t = to;
      if (want('walk')) await shot(`01-walk-${i + 1}`);
    }
    await adv(total - t + 1.2);
    if (want('walk')) await shot('01-walk-handoff');
  } else {
    await adv(1.0);
  }
  if ((await D(() => window.__debug.state)) !== 'ready') await D(() => window.__debug.skipIntro());
  await adv(0.6);
  if (want('ready')) await shot('02-ready');
  // a human-style spin + release in the green, then the flight
  await D(() => {
    const g = window.__debug.game;
    window.__debug.press();
    for (let i = 0; i < 2000 && g.state === 'spin' && !(g.spin.rot > 900 && Math.abs(g.spin.psiVis) < 4); i++) g.update(1 / 240);
    g.render();
  });
  if (want('throw')) await shot('03-spin');
  await D(() => window.__debug.release());
  await adv(0.12);
  if (want('throw')) await shot('04-release');
  await adv(0.9);
  if (want('throw')) await shot('05-flight');
  // run to touchdown
  await D(() => {
    const g = window.__debug.game;
    for (let i = 0; i < 2000 && g.state === 'flight' && g.cur.stage === 'air'; i++) g.update(1 / 120);
    g.render();
  });
  await adv(0.15);
  if (want('throw')) await shot('06-landing');
  await D(() => {
    const g = window.__debug.game;
    for (let i = 0; i < 600 && g.state !== 'result'; i++) g.update(1 / 60);
  });
  await adv(1.6);
  if (want('result')) await shot('07-result');
  // the jumbotron replay plays during the result: frames through it
  const hasScreen = await D(() => !!window.__debug.game.screen);
  if (hasScreen) {
    await adv(1.2);
    if (want('jumbo')) await shot('08-jumbo-1');
    await adv(1.5);
    if (want('jumbo')) await shot('08-jumbo-2');
    const shotJ = await D(() => (window.__debug.game.frameJumbo ? (window.__debug.game.frameJumbo(), true) : false));
    if (shotJ) {
      await adv(0.05);
      if (want('jumbo')) await shot('08-jumbo-close');
      await D(() => window.__debug.game.frameJumbo(false));
    }
  }
  // full-screen cinematic replay
  await D(() => window.__debug.game.onAction('replay'));
  if ((await D(() => window.__debug.state)) === 'replay') {
    const total = await D(() => (window.__debug.game.rt && window.__debug.game.rt.total) || 5);
    const marks = [0.08, 0.25, 0.45, 0.62, 0.8, 0.94];
    let t = 0;
    for (let i = 0; i < marks.length; i++) {
      const to = marks[i] * total;
      await adv(to - t);
      t = to;
      if (want('replay')) await shot(`09-replay-${i + 1}`);
    }
  }
  await ctx.close();
}
await browser.close();
server.kill();
