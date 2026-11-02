// Scenery review captures from the REAL gameplay cameras (ready, mid-flight follow, landing/tape, final orbit) at
// 1440x900 and 390x844, plus renderer.info (draw calls / triangles) for the ready camera. Outputs go to tests/out/scenery/.
//   node scripts/scenery-shots.mjs <label> [--hud] [--only=desktop|mobile]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.claude/scripts/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || 'after';
const HUD = process.argv.includes('--hud');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const OUT = path.join(ROOT, 'tests', 'out', 'scenery');
mkdirSync(OUT, { recursive: true });
const port = 8300 + Math.floor(Math.random() * 500);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const info = {};
const errors = [];
for (const [name, vp, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
  if (only && only !== name) continue;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${name}: ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__debug, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.evaluate(() => window.__debug.manual(true));
  if (!HUD) await page.addStyleTag({ content: '#hud,.hud,#lt,#hint,#initials,#board,#flash{display:none!important}' });
  const snap = async (n) => page.screenshot({ path: path.join(OUT, `${label}-${name}-${n}.png`) });
  const adv = (s, o) => page.evaluate(([s, o]) => window.__debug.advance(s, o), [s, o || { step: 1 / 30, render: true }]);
  await page.evaluate(() => window.__debug.skipIntro());
  await adv(4);
  await snap('1-ready');
  info[name] = await page.evaluate(() => {
    const g = window.__debug.game;
    g.render();
    const i = g.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, quality: g.stadium.quality || null };
  });
  // throw: fixed seed + wind so before/after frames match
  await page.evaluate(() => { window.__p = window.__debug.throw({ power: 0.92, psi: 3, seed: 12, wind: { x: -2, z: 1 } }); });
  await adv(0.9);
  await snap('2-flight-early');
  await adv(1.6);
  await snap('3-flight-mid');
  let guard = 0;
  while (guard++ < 60 && (await page.evaluate(() => window.__debug.game.cur && window.__debug.game.cur.stage)) !== 'landed') await adv(0.25);
  await adv(0.2);
  await snap('4-landing');
  guard = 0;
  while (guard++ < 60 && (await page.evaluate(() => window.__debug.state)) !== 'result') await adv(0.25);
  await adv(3.5);
  await snap('5-tape');
  await page.evaluate(() => { const g = window.__debug.game; g.showFinal(); });
  await adv(5);
  await snap('6-final');
  await ctx.close();
}
writeFileSync(path.join(OUT, `${label}-info.json`), JSON.stringify({ info, errors }, null, 2));
console.log(JSON.stringify({ info, errors }, null, 1));
await browser.close();
server.kill();
