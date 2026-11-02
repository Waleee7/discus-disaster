// DISCUS DISASTER - fictional athletes. Original characters: no real people, names or likenesses.
// Pure data (no three.js) so the carousel, the rival marker and the tests can all share it.
//
// `rival` marks are the "beat the rival" target for whoever you are NOT playing (the next persona in the list).
export const PERSONAS = [
  {
    id: 'blaze',
    name: 'BLAZE',
    role: 'The Hype Rookie',
    blurb: 'Warms up by shouting. Has never once been warm.',
    number: 7,
    colors: { jersey: 0xff8a1f, trim: 0xffffff, shorts: 0x10131c, skin: 0xa8683f, hair: 0x15110e, shoes: 0xffffff, accent: 0xffd23f },
    look: { hair: 'spikes', headband: true, shades: true },
    css: '#ff8a1f',
    rival: { rookie: 52.4, pro: 58.9, az: 9 },
    quips: ['Easy. I was born warm.', 'Cameras? Perfect. I brought my good side.', 'Hold my water bottle. Watch this.'],
  },
  {
    id: 'ironside',
    name: 'OLD IRON',
    role: 'The Stoic Veteran',
    blurb: 'Fourteen seasons. Has seen every pigeon. Is unmoved.',
    number: 22,
    colors: { jersey: 0x2f6bff, trim: 0xe9eef9, shorts: 0xe9eef9, skin: 0xd9a77c, hair: 0xb8bfcc, shoes: 0x10131c, accent: 0x9fc0ff },
    look: { hair: 'short', headband: false, shades: false, beard: true },
    css: '#5b8dff',
    rival: { rookie: 57.8, pro: 63.6, az: -8 },
    quips: ['The wind is a rumour.', 'I have thrown in worse. Ask the cart.', 'Breathe. Spin. Forgive the pigeon.'],
  },
  {
    id: 'noodle',
    name: 'NOODLE',
    role: 'The Chaotic Walk-On',
    blurb: 'Borrowed shoes. Unclear on the rules. Unbothered.',
    number: 99,
    colors: { jersey: 0xff3e8a, trim: 0x35e0b0, shorts: 0x7a3dff, skin: 0x6b3f26, hair: 0x15110e, shoes: 0x35e0b0, accent: 0x35e0b0 },
    look: { hair: 'puff', headband: false, shades: false, mismatch: true },
    css: '#ff4f9a',
    rival: { rookie: 44.7, pro: 49.3, az: 6 },
    quips: ['Is the big plate the whole sport?', 'I read the rules once. They were long.', 'These are not my shoes. They fit great.'],
  },
];

export const personaOf = (id) => PERSONAS.find((p) => p.id === id) || PERSONAS[0];
export const personaIndex = (id) => Math.max(0, PERSONAS.findIndex((p) => p.id === id));

/** The rival is the next persona round the carousel (so there is always one, and it is never you). */
export const rivalOf = (id) => PERSONAS[(personaIndex(id) + 1) % PERSONAS.length];

/** Rival's best mark for a mode; the daily gets a small deterministic wobble so it is not always the same number. */
export function rivalMark(rival, modeId, dailySeed = null) {
  const base = rival.rival[modeId === 'pro' ? 'pro' : 'rookie'];
  if (dailySeed === null) return base;
  const wobble = ((((dailySeed * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 6; // +-3 m
  return Math.round((base + wobble) * 10) / 10;
}
