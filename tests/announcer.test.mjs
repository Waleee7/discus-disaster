// Announcer content + no-repeat picker (pure logic; no DOM needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINES, Announcer, RANKS } from '../src/announcer.js';

const fakeEl = () => ({ classList: { toggle() {}, remove() {}, add() {} }, textContent: '', offsetWidth: 0, hidden: true });
const make = () => new Announcer({ root: fakeEl(), textEl: fakeEl(), tagEl: fakeEl() });

test('every announcer key has at least 3 distinct, non-empty variants', () => {
  for (const [key, pool] of Object.entries(LINES)) {
    assert.ok(pool.length >= 3, `${key} has only ${pool.length} variants`);
    assert.equal(new Set(pool).size, pool.length, `${key} has duplicate lines`);
    for (const l of pool) assert.ok(l.trim().length > 8, `${key}: empty line`);
  }
});

test('keys the game calls all exist, including one line set per rank, sectorEdge, bonus and newBest', () => {
  const needed = ['intro', 'ready', 'spin', 'sweet', 'dizzy', 'release', 'tap', 'badRelease', 'stepout', 'cage', 'foulLeft', 'foulRight', 'headwind', 'tailwind', 'stall', 'pigeon', 'cart', 'vendor', 'sprinkler', 'jumbo', 'bonus', 'perfect', 'sectorEdge', 'newBest', 'final'];
  for (let i = 0; i < RANKS.length; i++) needed.push('rank' + i);
  for (const k of needed) assert.ok(LINES[k], `missing LINES.${k}`);
});

test('no line repeats within 3 consecutive uses of a key (or the pool size minus one)', () => {
  const a = make();
  for (const [key, pool] of Object.entries(LINES)) {
    const seen = [];
    for (let i = 0; i < 60; i++) {
      const t = a.pickLine(key, { d: '60.00', m: '3' });
      const window = Math.min(3, pool.length - 1);
      assert.ok(!seen.slice(-window).includes(t), `${key}: repeated within ${window} uses`);
      seen.push(t);
    }
  }
});

test('placeholders are filled and teaching lines render with a capital letter', () => {
  const a = make();
  assert.match(a.pickLine('rank4', { d: '57.31' }), /57\.31/);
  assert.doesNotMatch(a.pickLine('bonus', { m: '4.5' }), /\{/);
  for (const t of [...LINES.headwind, ...LINES.tailwind, ...LINES.stall]) {
    a._display(t, 'STADIUM ANNOUNCER', 1, 100);
    assert.match(a.textEl.textContent, /^[A-Z]/, `teaching line starts lowercase: ${a.textEl.textContent}`);
  }
});

test('clear() drops the current caption and the queue', () => {
  const a = make();
  a.show('first', 'T', 3, 5000);
  a.show('second', 'T', 1, 5000);
  assert.ok(a.queued);
  a.clear();
  assert.equal(a.queued, null);
  assert.equal(a.root.hidden, true);
});
