// DISCUS DISASTER - local leaderboard + the Daily Throw seed. Pure module (no DOM) so Node tests can import it.
//
// Plug-in design: the game only talks to `Leaderboard`. The facade owns the rules (validation, sorting, top-10,
// seeded NPC entries, "does this mark qualify"); an *adapter* owns persistence:
//     adapter.list(boardId)         -> Promise<Entry[]>   (the player entries stored for that board)
//     adapter.add(boardId, entry)   -> Promise<void>
// `LocalAdapter` below implements that on localStorage (via src/storage.js, so it works with storage blocked).
// A global backend later = another adapter with the same two methods (fetch to your API, server-side validation),
// passed as `new Leaderboard({ adapter })`. Nothing here talks to a network and there are no secrets.
//
// Entry = { initials: 'ABC', mark: 61.23, character: 'blaze', mode: 'rookie'|'pro', date: 'YYYY-MM-DD' }
import { store } from './storage.js';
import { mulberry32 } from './physics.js';

export const BOARD_SIZE = 10;
export const SHARE_URL = 'discus-disaster.vercel.app';
const KEY = 'dd-board-v1';
const MAX_STORED = 60; // per board, so storage never grows without bound
const KEEP_DAILY_DAYS = 14;

export const ALL_TIME = 'all';
export const dailyBoardId = (dateKey) => `daily:${dateKey}`;

/** Local calendar date as YYYY-MM-DD (the Daily Throw rolls over at local midnight). */
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Stable 31-bit seed for a date key (FNV-1a), so everyone gets the same wind + cast sequence that day. */
export function dailySeed(key = dateKey()) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647;
}
/** Layout seed for throw `attempt` (0..2) of the daily. */
export const dailyLayoutSeed = (key, attempt) => dailySeed(key) + attempt * 101;

// Fictional regulars so a board is never empty. Marks are beatable but not trivial.
export const SEED_ENTRIES = [
  { initials: 'IRN', mark: 68.9, character: 'ironside', mode: 'pro', date: '2026-10-01' },
  { initials: 'PGN', mark: 64.2, character: 'blaze', mode: 'pro', date: '2026-10-02' },
  { initials: 'BLZ', mark: 59.7, character: 'blaze', mode: 'rookie', date: '2026-10-03' },
  { initials: 'HDG', mark: 55.3, character: 'noodle', mode: 'rookie', date: '2026-10-04' },
  { initials: 'CRT', mark: 51.0, character: 'ironside', mode: 'rookie', date: '2026-10-05' },
  { initials: 'NDL', mark: 46.6, character: 'noodle', mode: 'rookie', date: '2026-10-06' },
];

const CHARS = ['blaze', 'ironside', 'noodle'];
const NPC_INI = ['VND', 'COA', 'JBO', 'SPR', 'CRW', 'REF', 'TAP', 'OOF'];
/** Daily boards get three deterministic NPC regulars of their own. */
export function dailySeedEntries(key) {
  const r = mulberry32(dailySeed(key) ^ 0x9e3779b9);
  return [0, 1, 2].map((i) => ({
    initials: NPC_INI[Math.floor(r() * NPC_INI.length)],
    mark: Math.round((44 + r() * 20) * 10) / 10,
    character: CHARS[Math.floor(r() * CHARS.length)],
    mode: r() < 0.5 ? 'rookie' : 'pro',
    date: key,
    npc: i,
  }));
}

export function validEntry(e) {
  return !!e && /^[A-Z]{3}$/.test(e.initials) && Number.isFinite(e.mark) && e.mark > 0 && e.mark < 120 && (e.mode === 'rookie' || e.mode === 'pro') && typeof e.character === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '');
}

const byMark = (a, b) => b.mark - a.mark || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export class LocalAdapter {
  constructor(storage = store) {
    this.storage = storage;
  }
  _all() {
    const all = this.storage.getJSON(KEY, {});
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  }
  async list(boardId) {
    const rows = this._all()[boardId];
    return Array.isArray(rows) ? rows.filter(validEntry) : [];
  }
  async add(boardId, entry) {
    const all = this._all();
    const rows = (Array.isArray(all[boardId]) ? all[boardId] : []).filter(validEntry);
    rows.push(entry);
    all[boardId] = rows.sort(byMark).slice(0, MAX_STORED);
    // drop old daily boards
    const days = Object.keys(all).filter((k) => k.startsWith('daily:')).sort();
    for (const k of days.slice(0, Math.max(0, days.length - KEEP_DAILY_DAYS))) delete all[k];
    this.storage.setJSON(KEY, all);
  }
}

export class Leaderboard {
  constructor({ adapter = new LocalAdapter(), size = BOARD_SIZE } = {}) {
    this.adapter = adapter;
    this.size = size;
  }

  _seeds(boardId) {
    return boardId === ALL_TIME ? SEED_ENTRIES : boardId.startsWith('daily:') ? dailySeedEntries(boardId.slice(6)) : [];
  }

  /** Top entries (seeded NPCs merged in), best first, each with a 1-based `rank`. */
  async top(boardId) {
    const stored = await this.adapter.list(boardId);
    const rows = [...this._seeds(boardId).map((e) => ({ ...e, npc: true })), ...stored].sort(byMark).slice(0, this.size);
    return rows.map((e, i) => ({ ...e, rank: i + 1, you: false }));
  }

  /** Would `mark` make the top-N right now? (A board with fewer than N entries always has room.) */
  async qualifies(boardId, mark) {
    if (!Number.isFinite(mark) || mark <= 0) return false;
    const rows = await this.top(boardId);
    return rows.length < this.size || mark > rows[rows.length - 1].mark;
  }

  /** Validate, store, and return { rank, entries }. rank is null if the entry fell outside the top N. */
  async submit(boardId, entry) {
    const clean = { ...entry, initials: String(entry.initials || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3), mark: Math.round(entry.mark * 100) / 100 };
    if (!validEntry(clean)) throw new Error('invalid leaderboard entry');
    await this.adapter.add(boardId, clean);
    const stored = await this.adapter.list(boardId);
    const mineStored = stored.find((e) => e.initials === clean.initials && e.mark === clean.mark && e.date === clean.date && e.character === clean.character && e.mode === clean.mode);
    const rows = [...this._seeds(boardId).map((e) => ({ ...e, npc: true })), ...stored].sort(byMark);
    const idx = rows.findIndex((e) => e === mineStored);
    const entries = rows.slice(0, this.size).map((e, i) => ({ ...e, rank: i + 1, you: e === mineStored }));
    return { rank: idx >= 0 && idx < this.size ? idx + 1 : null, entries };
  }
}

/** "DISCUS DISASTER daily · 61.2 m · Rookie · discus-disaster.vercel.app" */
export function shareText({ daily = false, mark, mode }) {
  const m = mark > 0 ? `${mark.toFixed(1)} m` : 'no mark';
  return `DISCUS DISASTER${daily ? ' daily' : ''} · ${m} · ${mode === 'pro' ? 'Pro' : 'Rookie'} · ${SHARE_URL}`;
}
