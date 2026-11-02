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

const LINES = {
  intro: [
    'Good evening, and welcome to the only stadium with a pigeon union. I am your announcer, and I fear for everyone.',
    'Tonight, under the lights: one athlete, one two-kilogram plate, and a golf cart nobody authorized.',
  ],
  ready: [
    'The athlete steps into the circle. The circle is 2.5 meters wide. This is relevant later.',
    'Hold to spin. Release when the needle crosses the green. Simple. Humans have still found a way.',
    'Chalk up. Breathe. Do not look at the pigeons.',
  ],
  spin: ['And we are SPINNING.', 'Here comes the wind-up. The crowd leans in. The hot dog vendor leans out.', 'Rotation one... the stadium is a blur and so is the plan.'],
  sweet: ['Full power. Peak rotation. NOW would be a lovely time.', 'That is maximum spin. Nothing after this is improvement.'],
  dizzy: ['He is getting dizzy. The horizon has filed a complaint.', 'Too many turns! The circle is not a washing machine!'],
  release: ['AND IT IS GONE!', 'Released! Physics, you may take it from here.', 'Away it goes, spinning like a lawsuit.'],
  stepout: [
    'He has left the circle. The circle was the entire job.',
    'Stepped out! He spun so long the discus filed for emotional distance.',
    'That is a foul. The officials did not even need the tape. Or the circle. Or hope.',
  ],
  cage: [
    'Directly into the cage! The net did its one job, and so did you: poorly.',
    'The discus hit the net and came back like a boomerang with trust issues.',
  ],
  foulLeft: [
    'FOUL! Left of the sector. The sector was painted in white. On green. Hard to miss.',
    'That one is heading for the 4x400 relay, and they are NOT warmed up.',
    'Foul! The officials are measuring that one in apologies.',
  ],
  foulRight: [
    'FOUL! Right of the sector. Row F has been evacuated.',
    'It is heading for the parking lot. Valet is thrilled.',
    'Foul! That is not a throw, that is a hostage situation in the cheap seats.',
  ],
  headwind: [
    'TEACHING MOMENT: that headwind is not the enemy. Faster air over the disc means more lift, so it can fly FARTHER. Aim the nose lower.',
    'FUN FACT: a discus likes a headwind. Lift scales with airspeed squared. The breeze just gave you free altitude.',
  ],
  tailwind: [
    'TEACHING MOMENT: tailwind steals airspeed, so the disc loses lift. Raise the nose a touch to compensate.',
  ],
  stall: ['TEACHING MOMENT: that is a stall. Nose too high, the airflow separates and lift collapses. The disc becomes a very expensive plate.'],
  pigeon: ['PIGEON STRIKE! Not hurt, just heavily inconvenienced. Multiplier up!', 'A pigeon has been recruited into the event. Bonus awarded, apology pending.'],
  cart: ["Coach's golf cart has been HIT! He is fine! The clipboard is not!", "That is the coach's cart! Coach has questions and a very loud horn."],
  vendor: ['HOT DOG DOWN! Condiments everywhere! The vendor will be fine, the mustard will not!', 'The vendor has been flattened by physics and nine-dollar hot dogs rain from the sky!'],
  sprinkler: ['The sprinkler goes off! Nobody asked for that, everybody wanted that.', 'You found the sprinkler. Groundskeeper just gasped.'],
  jumbo: ['THE JUMBOTRON! It showed your face for a second. Now it shows NO SIGNAL.', 'Direct hit on the big screen! The kiss cam will never recover.'],
  rank0: ['Park & Rec Hopeful. {d} meters. A toddler with a hula hoop is concerned for you.', '{d} meters. That is a warm-up. For a different sport.'],
  rank1: ['Frisbee Fugitive at {d} meters. The dog caught it. The dog is not impressed.'],
  rank2: ['{d} meters. Varsity Walk-On. Your mother is proud and slightly confused.'],
  rank3: ['{d} meters. Conference Contender. The coach has stopped checking his phone.'],
  rank4: ['{d} meters! Regional Qualifier. Real throwers are starting to notice.'],
  rank5: ['{d} meters! Nationals Finalist. Somewhere, a shot putter just felt a disturbance.'],
  rank6: ['{d} meters!! Olympic Hopeful. The pigeons have stood down in respect.'],
  rank7: ['{d} METERS! Diamond League Dangerous! Officials are re-measuring out of fear!'],
  rank8: ['{d} METERS!!! WORLD RECORD MENACE! Mykolas Alekna is checking his phone and sweating!'],
  perfect: ['PERFECT window! That is textbook release timing.'],
  sectorEdge: ['Just inside the line! The sector judges are pretending that was easy.'],
  final: ['That is the competition. The pigeons will hold a vote on your title.'],
  bonus: ['Multiplier stacked! Math has joined the throwing event.'],
  newBest: ['New personal best for the night! Someone alert the local paper.'],
};

export class Announcer {
  constructor({ root, textEl, tagEl }) {
    this.root = root;
    this.textEl = textEl;
    this.tagEl = tagEl;
    this.voiceOn = false;
    this.last = {};
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
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === this.last[key]) i = (i + 1) % pool.length;
    this.last[key] = i;
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
    this.textEl.textContent = teaching ? text.replace(/^(TEACHING MOMENT|FUN FACT):\s*/, '') : text;
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
