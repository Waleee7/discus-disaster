// Stadium announcer: broadcast lower-third captions (always) + optional Web Speech voice (muted by default).

export const RANKS = [
  { min: 0, title: 'Park & Rec Hopeful' },
  { min: 25, title: 'Frisbee Fugitive' },
  { min: 35, title: 'Varsity Walk-On' },
  { min: 45, title: 'Conference Contender' },
  { min: 55, title: 'Regional Qualifier' },
  { min: 62, title: 'Nationals Finalist' },
  { min: 68, title: 'Olympic Hopeful' },
  { min: 72, title: 'Diamond League Dangerous' },
  { min: 74.35, title: 'World Record Menace' },
];
export const rankFor = (m) => [...RANKS].reverse().find((r) => m >= r.min) || RANKS[0];

// Voice: a tired stadium announcer who has seen it all and is still fond of you. Savage about the
// throw, never about the thrower. Every key needs 3+ variants (tests/announcer.test.mjs enforces it).
// Placeholders: {d} distance in m, {m} running multiplier.
export const LINES = {
  intro: [
    'Good evening, and welcome to the only stadium with a pigeon union. I am your announcer, and I fear for everyone.',
    'Tonight, under the lights: one athlete, one two-kilogram plate, and a golf cart nobody authorized.',
    'Live from a stadium that has never once passed a safety inspection. Please enjoy the discus responsibly.',
  ],
  ready: [
    'The athlete steps into the circle. The circle is 2.5 meters wide. This is relevant later.',
    'Hold to spin. Release when the needle sweeps the green. Simple. Humans have still found a way.',
    'Chalk up. Breathe. Do not make eye contact with the pigeons.',
    'Ladies and gentlemen, a moment of silence for whatever is about to get hit.',
    'Wind check, nose check, nerve check. Two out of three is a respectable start.',
  ],
  spin: [
    'And we are SPINNING.',
    'Here comes the wind-up. The crowd leans in. The hot dog vendor leans out.',
    'Rotation one... the stadium is a blur and so is the plan.',
    'Spinning up! Somewhere a physiotherapist just felt a chill.',
  ],
  sweet: [
    'Full power. Peak rotation. NOW would be a lovely time.',
    'That is maximum spin. Nothing after this is improvement.',
    'The bar is full. Every extra turn is just cardio.',
  ],
  dizzy: [
    'Getting dizzy out there! The horizon has filed a complaint.',
    'Too many turns! The circle is not a washing machine!',
    'The wobble has begun. Bold strategy, spinning past the point of return.',
  ],
  release: [
    'AND IT IS GONE!',
    'Released! Physics, you may take it from here.',
    'Away it goes, spinning like a lawsuit.',
    'There it flies! Whatever happens next is now the discus\'s fault.',
  ],
  tap: [
    'That was a tap, not a throw. The discus left out of pity.',
    'Zero turns, zero power, one very confused discus.',
    'A bold new technique: the polite nudge. The judges are not sure it counts.',
  ],
  tapRookie: [
    'A gentle tap! Rookie rules: that still counts. Hold longer for real distance.',
    'One polite nudge, no cage required. Hold a little longer next time.',
    'Short, sweet, legal. The discus is mostly confused and a little flattered.',
  ],
  shortToss: [
    'Let go from behind the thrower? Rookie rules turned that into a short toss. Aim for the green next time.',
    'That release was in the wrong place, so the discus took a gentle stroll. Legal, tiny, fine.',
    'The assist caught that one. Short toss, no foul. Let go when the needle is green.',
  ],
  badRelease: [
    'The release was so strange that the officials declared a cage foul on principle.',
    'Technical difficulties. The discus has been returned to the cage for its own protection.',
    'That release broke the laws of physics, so the laws of the cage have taken over.',
  ],
  stepout: [
    'Out of the circle! The circle was the entire job.',
    'Stepped out! The spin lasted so long the discus filed for emotional distance.',
    'Foul. The officials did not even need the tape. Or the circle. Or hope.',
  ],
  cage: [
    'Straight into the cage! The net did its one job, and so did you: poorly.',
    'The discus met the net and came back like a boomerang with trust issues.',
    'Cage! Released behind the athlete, which is a bold interpretation of "forward".',
  ],
  foulLeft: [
    'FOUL! Left of the sector. The lines are painted white, on green, in daylight. In fairness, it is night.',
    'That one is heading for the 4x400 relay, and they are NOT warmed up.',
    'Foul on the left! The officials are measuring that one in apologies.',
    'Left of the line. The discus has chosen a different event.',
  ],
  foulRight: [
    'FOUL! Right of the sector. Row F has been evacuated.',
    'It is heading for the parking lot. Valet is thrilled.',
    'Foul on the right! That is not a throw, that is a delivery to the cheap seats.',
    'Wide right. The sector is 35 degrees wide and you found the other 325.',
  ],
  headwind: [
    'TEACHING MOMENT: that headwind is not the enemy. Faster air over the disc means more lift, so it can fly FARTHER. Keep the nose low.',
    'FUN FACT: a discus likes a headwind. Lift scales with airspeed squared, so the breeze just gave you free altitude.',
    'TEACHING MOMENT: into a headwind the disc sees extra airspeed. Extra airspeed is extra lift. The sky is on your side tonight.',
  ],
  tailwind: [
    'TEACHING MOMENT: a tailwind steals airspeed, so the disc loses lift. Raise the nose a touch to compensate.',
    'FUN FACT: a tailwind feels like help and flies like a penalty. Less air over the disc, less lift.',
    'TEACHING MOMENT: with the wind at your back the disc sinks sooner. A little more nose can buy it back.',
  ],
  stall: [
    'TEACHING MOMENT: that is a stall. Nose too high, the airflow separates and lift collapses. The disc becomes a very expensive plate.',
    'TEACHING MOMENT: past about 25 degrees of attack the air lets go of the disc. Drag up, lift gone, regret loading.',
    'FUN FACT: a stalled discus is just a plate with ambition. Try a flatter nose next time.',
  ],
  pigeon: [
    'PIGEON STRIKE! Not hurt, just heavily inconvenienced. Multiplier up!',
    'A pigeon has been recruited into the event. Bonus awarded, apology pending.',
    'Direct hit on a pigeon! Local wildlife demands a recount.',
  ],
  cart: [
    "The coach's golf cart has been HIT! Coach is fine! The clipboard is not!",
    "That is the coach's cart! Coach has questions and a very loud horn.",
    'Cart down! Coach is already drafting an email with way too many exclamation points.',
  ],
  vendor: [
    'HOT DOG DOWN! Condiments everywhere! The vendor will be fine, the mustard will not!',
    'The vendor has been flattened by physics and nine-dollar hot dogs rain from the sky!',
    'Concession stand incident! Somebody call the mustard marshals!',
  ],
  sprinkler: [
    'The sprinkler goes off! Nobody asked for that, everybody wanted that.',
    'You found the sprinkler. The groundskeeper just gasped.',
    'Sprinkler activated! The infield is now a water feature.',
  ],
  jumbo: [
    'THE JUMBOTRON! It showed your face for a second. Now it shows NO SIGNAL.',
    'Direct hit on the big screen! The kiss cam will never recover.',
    'The scoreboard has seen enough. Please enjoy this blue screen.',
  ],
  bonus: [
    'Multiplier stacked to x{m}! Math has joined the throwing event.',
    'Another one! The multiplier is x{m} and the stadium has lost the plot.',
    'Combo! x{m} and counting. The chaos has a scoring system now.',
  ],
  rank0: [
    '{d} meters. Park & Rec Hopeful. A toddler with a hula hoop is concerned for you.',
    '{d} meters. That is a warm-up. For a different sport.',
    '{d} meters. The discus is not even tired. Neither, honestly, is the crowd.',
  ],
  rank1: [
    '{d} meters. Frisbee Fugitive. The dog caught it. The dog is not impressed.',
    '{d} meters. Frisbee Fugitive. The park has been notified.',
    '{d} meters. A fine toss for a picnic. This is not a picnic.',
  ],
  rank2: [
    '{d} meters. Varsity Walk-On. Your mother is proud and slightly confused.',
    '{d} meters. Varsity Walk-On. The roster spot is yours, the good locker is not.',
    '{d} meters. Varsity Walk-On. Respectable, in a "we will see you at practice" way.',
  ],
  rank3: [
    '{d} meters. Conference Contender. The coach has stopped checking his phone.',
    '{d} meters. Conference Contender. Rival teams are suddenly doing stretches.',
    '{d} meters. Conference Contender. Now we are talking, quietly.',
  ],
  rank4: [
    '{d} meters! Regional Qualifier. Real throwers are starting to notice.',
    '{d} meters! Regional Qualifier. The scouts have put down their nachos.',
    '{d} meters! Regional Qualifier. That one had actual technique in it.',
  ],
  rank5: [
    '{d} meters! Nationals Finalist. Somewhere, a shot putter just felt a disturbance.',
    '{d} meters! Nationals Finalist. The big board is making room.',
    '{d} meters! Nationals Finalist. Serious people are whispering.',
  ],
  rank6: [
    '{d} meters!! Olympic Hopeful. The pigeons have stood down in respect.',
    '{d} meters!! Olympic Hopeful. The sponsors just woke up.',
    '{d} meters!! Olympic Hopeful. Somebody is already designing the poster.',
  ],
  rank7: [
    '{d} METERS! Diamond League Dangerous! Officials are re-measuring out of fear!',
    '{d} METERS! Diamond League Dangerous! The tape measure needs a moment.',
    '{d} METERS! Diamond League Dangerous! That one nearly left the stadium.',
  ],
  rank8: [
    '{d} METERS!!! WORLD RECORD MENACE! Mykolas Alekna is checking his phone and sweating!',
    '{d} METERS!!! WORLD RECORD MENACE! Someone call World Athletics, and a doctor!',
    '{d} METERS!!! WORLD RECORD MENACE! The pigeons are applauding. The pigeons!',
  ],
  perfect: [
    'PERFECT window! That is textbook release timing.',
    'Dead center! The needle said yes and so did the physics.',
    'Clean release! Even the pigeons paused to watch.',
  ],
  sectorEdge: [
    '{d} meters, and it died on the line! The sector judges are pretending that was easy.',
    '{d} meters. Chalk dust on the line. The judges need a very close look.',
    '{d} meters, legal by a whisker! The officials have chosen not to breathe.',
  ],
  newBest: [
    'New personal best for the night! Someone alert the local paper.',
    'That is the best of the night. The previous best is quietly updating its résumé.',
    'A new best! The scoreboard is as surprised as you are.',
  ],
  final: [
    'That is the competition. The pigeons will hold a vote on your title.',
    'And that is the final. The judges have seen enough and so has the cart.',
    'Competition over! The vendor is counting casualties. The crowd is counting you.',
  ],
};

export class Announcer {
  constructor({ root, textEl, tagEl, rng = Math.random }) {
    this.root = root;
    this.textEl = textEl;
    this.tagEl = tagEl;
    this.voiceOn = false;
    this.rng = rng;
    this.recent = {}; // key -> indices used lately, so a line never repeats within a few throws
    this.until = 0;
    this.prio = 0;
    this.queued = null;
    this.voice = null;
    this.supportsSpeech = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    if (this.supportsSpeech) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice =
          vs.find((v) => /en[-_](GB|US)/i.test(v.lang) && /(daniel|alex|fred|google uk english male|male)/i.test(v.name)) ||
          vs.find((v) => /^en/i.test(v.lang)) ||
          null;
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  pickLine(key, vars = {}) {
    const pool = LINES[key] || [key];
    const recent = (this.recent[key] ||= []);
    const keep = Math.min(3, pool.length - 1); // with 4+ variants nothing repeats within 3 uses
    const fresh = pool.map((_, n) => n).filter((n) => !recent.includes(n));
    const i = fresh[Math.floor(this.rng() * fresh.length)];
    recent.push(i);
    while (recent.length > keep) recent.shift();
    return pool[i].replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
  }

  say(key, vars, { tag = 'STADIUM ANNOUNCER', priority = 1, ms = 3600 } = {}) {
    const text = this.pickLine(key, vars);
    this.show(text, tag, priority, ms);
    return text;
  }

  show(text, tag = 'STADIUM ANNOUNCER', priority = 1, ms = 3600) {
    const now = performance.now();
    if (now < this.until && priority < this.prio) {
      this.queued = { text, tag, priority, ms };
      return;
    }
    this._display(text, tag, priority, ms);
  }

  _display(text, tag, priority, ms) {
    const teaching = /^TEACHING MOMENT|^FUN FACT/.test(text);
    this.root.classList.toggle('teaching', teaching);
    this.tagEl.textContent = teaching ? 'TEACHING MOMENT' : tag;
    const body = teaching ? text.replace(/^(TEACHING MOMENT|FUN FACT):\s*/, '') : text;
    this.textEl.textContent = body.charAt(0).toUpperCase() + body.slice(1);
    this.root.classList.remove('pop');
    void this.root.offsetWidth; // restart the CSS animation
    this.root.classList.add('pop');
    this.root.hidden = false;
    const readMs = Math.max(ms, 1200 + text.length * 38);
    this.until = performance.now() + readMs;
    this.prio = priority;
    if (this.voiceOn && this.supportsSpeech && !document.hidden) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/^(TEACHING MOMENT|FUN FACT):\s*/, '').replace(/x(\d)/g, 'times $1'));
      if (this.voice) u.voice = this.voice;
      u.rate = 1.06;
      u.pitch = 0.8;
      speechSynthesis.speak(u);
    }
  }

  /** Drop the current caption (and anything queued) so stale commentary never sits over a new throw. */
  clear() {
    this.queued = null;
    this.until = 0;
    this.prio = 0;
    this.root.hidden = true;
    if (this.voiceOn && this.supportsSpeech) speechSynthesis.cancel();
  }

  update() {
    if (this.queued && performance.now() >= this.until) {
      const q = this.queued;
      this.queued = null;
      this._display(q.text, q.tag, q.priority, q.ms);
    }
  }

  setVoice(on) {
    this.voiceOn = !!on && this.supportsSpeech;
    if (!this.voiceOn && this.supportsSpeech) speechSynthesis.cancel();
    return this.voiceOn;
  }
}
