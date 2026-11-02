// Dev helper: find a seed where a good throw also hits something funny (used to pick the README GIF throw).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.claude/scripts/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8291;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => !!window.__debug);
const out = await page.evaluate(async () => {
  const rows = [];
  for (let seed = 1; seed <= 60; seed++) {
    window.__debug.game.tO = 5;
    const r = await window.__debug.runThrow({ seed, power: 1, psi: 0, attitude: 22 });
    rows.push({ seed, d: +r.distance.toFixed(1), hits: r.hits.join(','), mult: r.mult, foul: r.foul });
  }
  return rows;
});
out.filter((r) => r.hits).forEach((r) => console.log(JSON.stringify(r)));
await browser.close();
server.kill();
