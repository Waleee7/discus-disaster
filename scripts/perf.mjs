// Performance probe: Playwright Chromium on the Metal GPU (ANGLE), phone (390x844 @3x, touch) and desktop (1440x900 @2x).
// Measures, per profile and scene state: CPU ms per frame (update + render), GPU-inclusive ms per frame (render + gl.finish),
// draw calls + triangles, estimated texture memory (decoded w x h x 4 x 1.33 with mips), pixel-ratio handling, and
// per-frame JS allocations (CDP sampling heap profiler, including objects already collected by the GC).
//   node scripts/perf.mjs [--json out.json] [--q low|mid|high]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.claude/scripts/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const OUT = arg('--json');
const Q = arg('--q');
const ONLY = arg('--only');

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
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });

const PROFILES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
].filter((p) => !ONLY || p.name === ONLY);

// in-page helpers (stringified into the page)
const PAGE_HELPERS = () => {
  window.__perf = {
    texMem() {
      const g = window.__debug.game;
      const seen = new Map();
      const add = (t, where) => {
        if (!t || !t.isTexture || seen.has(t.uuid)) return;
        const img = t.image;
        let w = 0;
        let h = 0;
        if (img) {
          w = img.width || (img.data && img.width) || 0;
          h = img.height || 0;
          if (Array.isArray(img) && img[0]) {
            w = img[0].width * 1;
            h = img[0].height * 6;
          }
        }
        if (t.isRenderTargetTexture) return;
        const mip = t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 1.33 : 1;
        const bpp = t.type === 1016 ? 8 : t.type === 1015 ? 16 : 4;
        seen.set(t.uuid, { name: t.name || where, w, h, mb: (w * h * bpp * mip) / 1048576 });
      };
      const visitMat = (m, where) => {
        if (!m) return;
        for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) add(m[k], where + '.' + k);
        if (m.uniforms) for (const k of Object.keys(m.uniforms)) {
          const v = m.uniforms[k] && m.uniforms[k].value;
          if (v && v.isTexture) add(v, where + '.u.' + k);
        }
      };
      g.scene.traverse((o) => {
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        ms.forEach((m) => visitMat(m, o.name || o.type));
      });
      if (g.scene.environment) add(g.scene.environment, 'scene.environment');
      if (g.scene.background && g.scene.background.isTexture) add(g.scene.background, 'scene.background');
      // render targets the game owns (post, replay screen, shadows)
      const rts = [];
      const rtAdd = (rt, name) => {
        if (!rt || !rt.width) return;
        const bpp = rt.texture && rt.texture.type === 1016 ? 8 : 4;
        const samples = rt.samples || 0;
        rts.push({ name, w: rt.width, h: rt.height, mb: (rt.width * rt.height * bpp * (1 + (samples ? samples : 0)) + (rt.depthBuffer ? rt.width * rt.height * 4 : 0)) / 1048576 });
      };
      g.scene.traverse((o) => {
        if (o.isLight && o.castShadow && o.shadow && o.shadow.map) rtAdd(o.shadow.map, 'shadow:' + (o.name || o.type));
      });
      if (g.post && g.post.targets) for (const [n, rt] of Object.entries(g.post.targets())) rtAdd(rt, 'post:' + n);
      if (g.screen && g.screen.rt) rtAdd(g.screen.rt, 'replay-screen');
      const list = [...seen.values()].sort((a, b) => b.mb - a.mb);
      const total = list.reduce((s, x) => s + x.mb, 0);
      const rtTotal = rts.reduce((s, x) => s + x.mb, 0);
      return { total: +total.toFixed(1), count: list.length, top: list.slice(0, 12).map((x) => `${x.name} ${x.w}x${x.h} ${x.mb.toFixed(1)}MB`), rtTotal: +rtTotal.toFixed(1), rts: rts.map((r) => `${r.name} ${r.w}x${r.h} ${r.mb.toFixed(1)}MB`) };
    },
    info() {
      const g = window.__debug.game;
      const r = g.renderer;
      const gl = r.getContext();
      return {
        dpr: devicePixelRatio,
        pixelRatio: r.getPixelRatio(),
        buffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
        tier: g.stadium.info().tier,
        post: g.post ? g.post.describe() : 'none',
        programs: r.info.programs ? r.info.programs.length : 0,
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
      };
    },
    /** n manual frames; returns cpu ms (update+render) and gpu-inclusive ms (with gl.finish), calls, tris. */
    frames(n = 120, dt = 1 / 60, finish = false) {
      const g = window.__debug.game;
      const gl = g.renderer.getContext();
      g.manual = true;
      const times = [];
      const px = new Uint8Array(4);
      let calls = 0;
      let tris = 0;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        g.update(dt);
        g.render();
        if (finish) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces a wait for the GPU to finish the frame
        times.push(performance.now() - t0);
        calls += g.renderer.info.render.calls;
        tris += g.renderer.info.render.triangles;
      }
      times.sort((a, b) => a - b);
      const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
      return { p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +times[times.length - 1].toFixed(2), calls: Math.round(calls / n), tris: Math.round(tris / n) };
    },
    /** Real rAF loop for `ms`: frame intervals. */
    raf(ms = 3000) {
      const g = window.__debug.game;
      g.manual = false;
      return new Promise((res) => {
        const iv = [];
        let last = performance.now();
        const t0 = last;
        const f = (now) => {
          iv.push(now - last);
          last = now;
          if (now - t0 < ms) requestAnimationFrame(f);
          else {
            iv.shift();
            iv.sort((a, b) => a - b);
            const q = (p) => iv[Math.min(iv.length - 1, Math.floor(p * iv.length))];
            res({ fps: +((iv.length / ms) * 1000).toFixed(1), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +iv[iv.length - 1].toFixed(2) });
          }
        };
        requestAnimationFrame(f);
      });
    },
  };
};

const results = {};
for (const prof of PROFILES) {
  const ctx = await browser.newContext({ viewport: prof.viewport, deviceScaleFactor: prof.deviceScaleFactor, isMobile: prof.isMobile, hasTouch: prof.hasTouch });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const bytes = { total: 0, img: 0 };
  page.on('response', async (r) => {
    try {
      const b = await r.body();
      bytes.total += b.length;
      if (/\.(webp|png|jpg)$/.test(r.url())) bytes.img += b.length;
    } catch {}
  });
  const tLoad = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__debug, null, { timeout: 30000 });
  await page.evaluate(() => window.__debug.artReady());
  const loadMs = Date.now() - tLoad;
  await page.evaluate(PAGE_HELPERS);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const R = { load: { ms: loadMs }, info: null, states: {} };
  // warm up: compile programs on the start screen, then go to the throw
  await page.evaluate(() => window.__perf.frames(30));
  await page.evaluate(() => window.__debug.skipIntro());
  await page.evaluate(() => window.__perf.frames(60));
  R.info = await page.evaluate(() => window.__perf.info());
  R.tex = await page.evaluate(() => window.__perf.texMem());
  R.load.mb = +(bytes.total / 1048576).toFixed(2);
  R.load.imgMb = +(bytes.img / 1048576).toFixed(2);

  const alloc = async (label, setup, n = 240) => {
    await page.evaluate(setup);
    await page.evaluate(() => window.__perf.frames(20));
    const cpu = await page.evaluate((n) => window.__perf.frames(n), n);
    const gpu = await page.evaluate((n) => window.__perf.frames(n, 1 / 60, true), Math.min(90, n));
    await cdp.send('HeapProfiler.collectGarbage');
    const h0 = await page.evaluate(() => performance.memory.usedJSHeapSize);
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await page.evaluate((n) => window.__perf.frames(n), n);
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    await cdp.send('HeapProfiler.collectGarbage');
    const h1 = await page.evaluate(() => performance.memory.usedJSHeapSize);
    let total = 0;
    const sites = new Map();
    const walk = (node, stack) => {
      const cf = node.callFrame;
      const here = cf.functionName ? `${cf.functionName} ${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}` : '';
      if (node.selfSize) {
        total += node.selfSize;
        const key = here || stack;
        sites.set(key, (sites.get(key) || 0) + node.selfSize);
      }
      for (const c of node.children || []) walk(c, here || stack);
    };
    walk(profile.head, '(root)');
    const top = [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${((v / n) / 1024).toFixed(1)}KB/f`);
    R.states[label] = { cpu, gpu, allocKBperFrame: +((total / n) / 1024).toFixed(2), retainedKB: Math.round((h1 - h0) / 1024), topAlloc: top };
  };

  await alloc('ready', () => {});
  await alloc('spin', () => {
    const g = window.__debug.game;
    if (g.state !== 'ready') g.startAttempt();
    window.__debug.press();
    g.update(1 / 60);
  }, 60);
  await alloc('flight', () => {
    const g = window.__debug.game;
    if (g.state === 'spin') {
      // abandon the spin: back to a fresh ready, then a scripted throw (same pipeline as a human release)
      g.input._release && g.input._release();
    }
    for (let i = 0; i < 400 && g.state !== 'result' && g.state !== 'ready'; i++) g.update(1 / 30);
    while (g.state === 'result') g.next();
    if (g.state !== 'ready') g.startAttempt();
    window.__p = window.__debug.throw({ seed: 4, power: 0.95, psi: 0, attitude: 22, wind: { x: -3, z: 1 } });
    g.update(1 / 60);
  }, 60);
  await alloc('result', () => {
    const g = window.__debug.game;
    for (let i = 0; i < 900 && g.state !== 'result'; i++) g.update(1 / 30);
    for (let i = 0; i < 60; i++) g.update(1 / 30);
  }, 120);
  // real-time loop at the ready state (rAF intervals)
  await page.evaluate(() => {
    const g = window.__debug.game;
    while (g.state === 'result') g.next();
    if (g.state !== 'ready') g.startAttempt();
  });
  R.raf = await page.evaluate(() => window.__perf.raf(3000));
  R.errors = errs.slice(0, 5);
  results[prof.name] = R;
  await ctx.close();
}
await browser.close();
server.kill();

for (const [n, R] of Object.entries(results)) {
  console.log(`\n=== ${n} ===`);
  console.log('load', JSON.stringify(R.load), '| info', JSON.stringify(R.info));
  console.log(`textures ~${R.tex.total} MB in ${R.tex.count} | RTs ${R.tex.rtTotal} MB`);
  R.tex.top.forEach((t) => console.log('   ', t));
  R.tex.rts.forEach((t) => console.log('    RT', t));
  for (const [s, v] of Object.entries(R.states)) {
    console.log(`${s.padEnd(7)} cpu p50 ${v.cpu.p50} p95 ${v.cpu.p95} | gpu-incl p50 ${v.gpu.p50} p95 ${v.gpu.p95} | calls ${v.cpu.calls} tris ${v.cpu.tris} | alloc ${v.allocKBperFrame} KB/frame, retained ${v.retainedKB} KB`);
    v.topAlloc.slice(0, 5).forEach((t) => console.log('      ', t));
  }
  console.log('raf', JSON.stringify(R.raf));
  if (R.errors.length) console.log('ERRORS', R.errors);
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
