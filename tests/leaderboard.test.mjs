// Local leaderboard, Daily Throw seed, personas. Pure logic, runs in Node (no DOM, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard, LocalAdapter, SEED_ENTRIES, ALL_TIME, BOARD_SIZE, dailyBoardId, dailySeed, dailyLayoutSeed, dateKey, shareText, validEntry } from '../src/leaderboard.js';
import { store } from '../src/storage.js';
import { PERSONAS, rivalOf, rivalMark, personaOf } from '../src/personas.js';

const memStorage = () => {
  const m = new Map();
  return { getJSON: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), setJSON: (k, v) => m.set(k, JSON.stringify(v)), raw: m };
};
const entry = (initials, mark, o = {}) => ({ initials, mark, character: 'blaze', mode: 'rookie', date: '2026-11-01', ...o });

test('a fresh board is never empty: seeded fictional regulars, sorted, ranked', async () => {
  const lb = new Leaderboard({ adapter: new LocalAdapter(memStorage()) });
  const top = await lb.top(ALL_TIME);
  assert.equal(top.length, SEED_ENTRIES.length);
  assert.ok(top.length >= 5);
  assert.deepEqual(top.map((e) => e.rank), top.map((_, i) => i + 1));
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].mark >= top[i].mark);
  const daily = await lb.top(dailyBoardId('2026-11-01'));
  assert.ok(daily.length >= 3, 'daily boards seed their own regulars');
  assert.deepEqual((await lb.top(dailyBoardId('2026-11-01'))).map((e) => e.mark), daily.map((e) => e.mark), 'deterministic per day');
});

test('submit: validates, upper-cases initials, ranks the entry and caps the board at 10', async () => {
  const lb = new Leaderboard({ adapter: new LocalAdapter(memStorage()) });
  const res = await lb.submit(ALL_TIME, entry('abc', 66.666));
  assert.equal(res.rank, 2); // between IRN 68.9 and PGN 64.2
  assert.equal(res.entries[1].initials, 'ABC');
  assert.equal(res.entries[1].mark, 66.67);
  assert.ok(res.entries[1].you);
  for (let i = 0; i < 12; i++) await lb.submit(ALL_TIME, entry('ZZZ', 30 + i));
  const top = await lb.top(ALL_TIME);
  assert.equal(top.length, BOARD_SIZE);
  await assert.rejects(() => lb.submit(ALL_TIME, entry('A1', 50)), /invalid/);
  await assert.rejects(() => lb.submit(ALL_TIME, entry('ABC', NaN)), /invalid/);
  await assert.rejects(() => lb.submit(ALL_TIME, entry('ABC', 50, { mode: 'god' })), /invalid/);
});

test('qualifies: any real mark while there is room, then only marks that beat the 10th place', async () => {
  const lb = new Leaderboard({ adapter: new LocalAdapter(memStorage()) });
  assert.ok(await lb.qualifies(ALL_TIME, 12), 'room on a seeded board with < 10 entries');
  for (let i = 0; i < 6; i++) await lb.submit(ALL_TIME, entry('AAA', 40 + i)); // 6 seeds + 6 = 12 >= 10
  const top = await lb.top(ALL_TIME);
  const tenth = top[top.length - 1].mark;
  assert.ok(!(await lb.qualifies(ALL_TIME, tenth - 0.5)));
  assert.ok(await lb.qualifies(ALL_TIME, tenth + 0.5));
  assert.ok(!(await lb.qualifies(ALL_TIME, 0)));
  assert.ok(!(await lb.qualifies(ALL_TIME, NaN)));
});

test('works with no storage at all (private mode): falls back to memory and never throws', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: storage disabled');
    },
  });
  try {
    assert.equal(store.set('dd-test', 'x'), false, 'reports the write did not persist');
    assert.equal(store.get('dd-test'), 'x', 'but the session still sees it');
    const lb = new Leaderboard();
    await lb.submit(ALL_TIME, entry('MEM', 61.2));
    assert.ok((await lb.top(ALL_TIME)).some((e) => e.initials === 'MEM'));
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
});

test('corrupt storage is ignored, entries persist across adapters, old daily boards are pruned', async () => {
  const st = memStorage();
  st.raw.set('dd-board-v1', '{not json');
  const bad = { getJSON: () => ({ all: 'oops' }), setJSON: () => {} };
  assert.deepEqual(await new LocalAdapter(bad).list(ALL_TIME), []);
  const a = new Leaderboard({ adapter: new LocalAdapter(memStorage()) });
  await a.submit(ALL_TIME, entry('KEP', 70.01));
  const shared = memStorage();
  await new Leaderboard({ adapter: new LocalAdapter(shared) }).submit(ALL_TIME, entry('KEP', 70.01));
  assert.equal((await new Leaderboard({ adapter: new LocalAdapter(shared) }).top(ALL_TIME))[0].initials, 'KEP', 'a new adapter instance sees the saved entry');
  for (let d = 1; d <= 20; d++) await new Leaderboard({ adapter: new LocalAdapter(shared) }).submit(dailyBoardId(`2026-10-${String(d).padStart(2, '0')}`), entry('OLD', 50));
  const keys = Object.keys(JSON.parse(shared.raw.get('dd-board-v1'))).filter((k) => k.startsWith('daily:'));
  assert.ok(keys.length <= 14, `kept ${keys.length} daily boards`);
});

test('a global backend can plug in: any object with list() and add() works as the adapter', async () => {
  const calls = [];
  const remote = {
    rows: [],
    async list(id) {
      calls.push(['list', id]);
      return this.rows.filter((r) => r.board === id).map(({ board, ...e }) => e);
    },
    async add(id, e) {
      calls.push(['add', id]);
      this.rows.push({ board: id, ...e });
    },
  };
  const lb = new Leaderboard({ adapter: remote });
  const res = await lb.submit(ALL_TIME, entry('NET', 99.1));
  assert.equal(res.rank, 1);
  assert.deepEqual(calls.map((c) => c[0]), ['add', 'list']);
  assert.equal((await lb.top(ALL_TIME))[0].initials, 'NET');
});

test('Daily Throw: the seed is a pure function of the date, differs by day and by throw, and is positive', () => {
  assert.equal(dailySeed('2026-11-01'), dailySeed('2026-11-01'));
  assert.notEqual(dailySeed('2026-11-01'), dailySeed('2026-11-02'));
  const seeds = [0, 1, 2].map((a) => dailyLayoutSeed('2026-11-01', a));
  assert.equal(new Set(seeds).size, 3);
  for (const s of seeds) assert.ok(Number.isInteger(s) && s > 0);
  assert.match(dateKey(new Date(2026, 10, 1)), /^2026-11-01$/);
  assert.match(dateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('share text: "DISCUS DISASTER daily · 61.2 m · Rookie · discus-disaster.vercel.app"', () => {
  assert.equal(shareText({ daily: true, mark: 61.23, mode: 'rookie' }), 'DISCUS DISASTER daily · 61.2 m · Rookie · discus-disaster.vercel.app');
  assert.equal(shareText({ daily: false, mark: 48.04, mode: 'pro' }), 'DISCUS DISASTER · 48.0 m · Pro · discus-disaster.vercel.app');
  assert.match(shareText({ mark: 0, mode: 'pro' }), /no mark/);
  assert.ok(SEED_ENTRIES.every(validEntry));
});

test('personas: three original athletes with distinct colours, a one-line personality, quips and a rival that is never you', () => {
  assert.equal(PERSONAS.length, 3);
  assert.equal(new Set(PERSONAS.map((p) => p.id)).size, 3);
  assert.equal(new Set(PERSONAS.map((p) => p.colors.jersey)).size, 3, 'distinct jersey colours');
  assert.equal(new Set(PERSONAS.map((p) => p.number)).size, 3);
  for (const p of PERSONAS) {
    assert.ok(p.blurb.length > 20 && p.blurb.length < 70 && !p.blurb.includes('\n'), `${p.id}: one-line personality`);
    assert.ok(p.quips.length >= 3);
    assert.notEqual(rivalOf(p.id).id, p.id);
    assert.ok(p.rival.rookie < p.rival.pro + 1 && p.rival.rookie > 35 && p.rival.pro < 70, 'rival marks are beatable human numbers');
  }
  assert.equal(personaOf('nope').id, PERSONAS[0].id, 'unknown id falls back');
  const r = PERSONAS[1];
  assert.equal(rivalMark(r, 'rookie'), r.rival.rookie);
  assert.equal(rivalMark(r, 'pro', 123), rivalMark(r, 'pro', 123), 'daily wobble is deterministic');
  assert.ok(Math.abs(rivalMark(r, 'pro', 123) - r.rival.pro) <= 3.01);
});
