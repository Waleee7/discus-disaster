// Records docs/gameplay.gif: one human-style throw (real Space key hold/release), captured frame-by-frame with the
// deterministic stepper (window.__debug.advance), then palette-optimised with ffmpeg.
//   node scripts/record-gif.mjs
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.claude/scripts/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG || process.env.HOME + '/.local/bin/ffmpeg';
const FRAMES = process.env.FRAMES_DIR || path.join(tmpdir(), 'dd-frames');
const FPS = 10;
const SEED = 12; // pigeon flock lines up with a 69 m throw at obstacle-time 5.0 (see scripts/scan-seeds.mjs)
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const port = 8293;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => !!window.__debug);
await page.evaluate(() => document.fonts.ready);
await page.evaluate((seed) => {
  const d = window.__debug;
  d.manual(true);
  d.skipIntro();
  d.game.applyLayout(d.makeLayout(seed));
  d.game.attitude = 22;
  d.game.updateNose();
}, SEED);

let n = 0;
let stillShot = false;
const shot = async (dt, opts) => {
  await page.evaluate(([d, o]) => window.__debug.advance(d, o), [dt, { step: 1 / 120 }]);
  const f = path.join(FRAMES, `f${String(n++).padStart(4, '0')}.png`);
  await page.screenshot({ path: f });
  return f;
};

for (let i = 0; i < 4; i++) await shot(1 / FPS); // idle in the circle
await page.keyboard.down('Space'); // real input path
let guard = 0;
while (guard++ < 200) {
  const rot = await page.evaluate(() => window.__debug.game.spin.rot);
  if (rot > 1262 - 75) break; // close enough: finish the pass with fine steps below
  await shot(1 / 6);
}
// fine-step into the centre of the dial window, then release (obstacle clock pinned so the pigeon pass is reproducible)
await page.evaluate(() => {
  const g = window.__debug.game;
  while (g.spin.rot < 1262) g.update(1 / 240);
  g.tO = 5;
});
await page.keyboard.up('Space');
guard = 0;
while (guard++ < 400) {
  const st = await page.evaluate(() => window.__debug.state);
  if (st === 'result') break;
  const f = await shot(1 / FPS);
  const hit = await page.evaluate(() => window.__debug.game.cur.rec.hits.length);
  if (hit && !stillShot) {
    stillShot = true;
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(ROOT, 'docs', 'screenshot.png') });
  }
  void f;
}
await page.waitForTimeout(500);
for (let i = 0; i < 9; i++) await shot(1 / FPS);
const info = await page.evaluate(() => window.__debug.game.cur.rec.result);
console.log('recorded', n, 'frames; result', JSON.stringify({ distance: info.distance, foul: info.foul }));
await browser.close();
server.kill();

const out = path.join(ROOT, 'docs', 'gameplay.gif');
// keep every Nth captured frame (time-lapse feel) so the crowd noise doesn't blow the size budget
const run = (keep, colors, w, dither) =>
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%04d.png'), '-vf',
    `select='not(mod(n,${keep}))',setpts=N/(${FPS}*TB),scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`, '-r', String(FPS), '-loop', '0', out]);
for (const [keep, colors, dither] of [[2, 96, 'none'], [2, 64, 'none'], [2, 48, 'none'], [3, 96, 'none']]) {
  run(keep, colors, 720, dither);
  const mb = statSync(out).size / 1048576;
  console.log(`gif keep 1/${keep} colors=${colors} w=720 dither=${dither}: ${mb.toFixed(2)} MB`);
  if (mb <= 5.7) break;
}
