// Safe localStorage wrapper: every call is try/catch'd and falls back to memory, so the game works in private mode,
// with storage disabled, or in Node tests. Values are strings; JSON helpers below.
const mem = new Map();

export const store = {
  get(key) {
    try {
      const v = globalThis.localStorage.getItem(key);
      if (v !== null) return v;
    } catch {
      /* storage unavailable */
    }
    return mem.has(key) ? mem.get(key) : null;
  },
  set(key, value) {
    mem.set(key, String(value));
    try {
      globalThis.localStorage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  },
  getJSON(key, fallback) {
    try {
      const raw = this.get(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  setJSON(key, value) {
    return this.set(key, JSON.stringify(value));
  },
};
