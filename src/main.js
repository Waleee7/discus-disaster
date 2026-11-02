import { Game } from './game.js';
import { makeLayout } from './obstacles.js';

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
  skipIntro: () => game.closeHowTo(true),
  press: () => game.input._press(),
  release: () => game.input._release(),
  manual: (on = true) => (game.manual = on),
};

addEventListener('pagehide', () => game.dispose());
