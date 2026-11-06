import { Game } from './game.js';
import { makeLayout } from './obstacles.js';
import { artReady } from './cards.js';

// The stadium paints its signage and jersey numbers into canvases once, at build time: wait for the webfonts first so
// they use Oswald, not the fallback. Bounded (and failure-proof) so an offline / blocked font host never blocks the game.
async function fontsReady(ms = 2500) {
  if (!document.fonts || !document.fonts.load) return;
  const load = Promise.all([
    document.fonts.load('700 48px Oswald', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
    document.fonts.load('700 40px "JetBrains Mono"', '0123456789.m'),
  ]).catch(() => {});
  await Promise.race([load.then(() => document.fonts.ready), new Promise((r) => setTimeout(r, ms))]);
}
await fontsReady();

const canvas = document.getElementById('gl');
const game = new Game(canvas);
game.start();

// Test / capture hooks. Everything goes through the same code paths a human uses.
window.__debug = {
  game,
  get state() {
    return game.state;
  },
  /** throw({ power 0..1 | speed m/s, psi (dial deg), attitude (deg), seed, wind:{x,z} }) -> Promise<result> */
  throw: (p) => game.debugThrow(p),
  advance: (sec, o) => game.advance(sec, o),
  /** Step the simulation (no render) until a throw has resolved; returns the result. */
  async runThrow(p, { step = 1 / 30, max = 30 } = {}) {
    const promise = game.debugThrow(p);
    game.manual = true;
    let t = 0;
    while (game.state !== 'result' && t < max) {
      game.update(step);
      t += step;
    }
    game.render();
    return promise;
  },
  makeLayout,
  artReady,
  skipIntro: () => game.closeStart(true),
  setMode: (id) => game.setMode(id),
  setPersona: (id) => game.setPersona(id),
  setTechnique: (id) => game.setTechnique(id),
  setCamera: (id) => game.setCamera(id),
  setVenue: (id) => game.setVenue(id),
  setWeather: (id) => game.setWeatherChoice(id),
  press: () => game.input._press(),
  release: () => game.input._release(),
  manual: (on = true) => (game.manual = on),
};

addEventListener('pagehide', () => game.dispose());
