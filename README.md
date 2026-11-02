<p align="center"><a href="https://discus-disaster.vercel.app"><b>▶ PLAY NOW: discus-disaster.vercel.app</b></a></p>

<p align="center"><img src="docs/banner.svg" alt="DISCUS DISASTER - animated banner" width="100%"></p>

**A funny, physically serious 3D browser game. Throw a real-aerodynamics discus under the floodlights, read the wind, and try not to hit the pigeons. (Hit the pigeons.)**

> **v2 in one breath**
> - **One action:** hold to spin, let go when the needle is in the green. That is the whole game in **Rookie** mode (wide window, auto nose, friendly taps). Switch to **Pro** for the original, unforgiving version.
> - **Pick an athlete** (BLAZE the hype rookie, OLD IRON the stoic veteran, NOODLE the chaotic walk-on) and **beat the rival flag** on the pitch.
> - **Leaderboard:** arcade initials, local top 10, plus a **Daily Throw** (same wind and cast for everyone that day) with a one-tap **Copy result**.
> - **Run it:** `git clone https://github.com/Waleee7/discus-disaster.git && cd discus-disaster && python3 -m http.server 8137`, open <http://localhost:8137>.

Built by a real college discus thrower who also writes software. No build step, no install, no CDN: Three.js is vendored in `vendor/`.

<p align="center"><img src="docs/gameplay.gif" alt="Staged Rookie throw by BLAZE: start screen, spin, release in the green, pigeon strike, slow-mo landing, tape" width="720"></p>
<p align="center"><img src="docs/screenshot.png" alt="Pigeon strike mid-flight under the stadium lights" width="49%"> <img src="docs/shots/mobile-390x844-2-character.png" alt="Phone start screen: athlete carousel, Rookie / Pro toggle, PLAY and BOARD" width="24%"> <img src="docs/shots/mobile-390x844-8-board.png" alt="Phone leaderboard" width="24%"></p>
<p align="center"><sub>The GIF is a <b>staged</b> throw: a real PLAY click and key hold, but a hand-picked wind/obstacle seed and a pinned obstacle clock so the pigeon pass lines up, recorded as a time-lapse to stay under 2.5 MB. Your own throws will be messier.</sub></p>

## How it plays

| | **Rookie** (default) | **Pro** |
|---|---|---|
| Green release window | 124 deg on throw 1, 112, then 100 (Pro is 80) | 80 deg |
| Needle in the green | eases down so you can react | full speed |
| Nose angle | auto-set for your release and the wind (drag to take over) | yours, always |
| Instant tap / release behind you | a short, legal toss | cage foul |
| After a foul | one coaching line: *Let go when the needle is in the green.* | none |
| Physics, top speed, power curve | **identical** | identical |

A perfect release at full power (~3 turns) is about **66 m in Pro** (the real record is 74.35 m). Rookie keeps the same physics and the same top speed; it only forgives the human part, and a simulated "average first-timer" lands **45-65 m within three throws** (unit-tested). The choice is remembered (`localStorage`, optional: everything works with storage blocked).

**Characters.** Three original, fictional athletes built from primitives (capsule limbs, jersey numbers, headband, shades, hair): they differ in colours and personality, and the next one in the carousel is your **rival**. A flag and a line across the sector mark the rival's best mark; the result card tells you by how much you beat it.

**Leaderboard.** Finish three throws and a qualifying mark asks for **3 initials** (arcade wheels, or just type). The board shows mark, athlete, mode and date, is seeded with fictional regulars so it is never empty, and lives in `localStorage` only. **Daily Throw** (BOARD > DAILY > PLAY TODAY'S THROW): the wind and cast phases come from the date, so everyone gets the same day; it has its own board and a share line like `DISCUS DISASTER daily · 61.2 m · Rookie · discus-disaster.vercel.app`. The board is one module, [`src/leaderboard.js`](src/leaderboard.js), behind a two-method adapter (`list`, `add`): a global backend is a new adapter, nothing else changes. There is no network code and no secret in this repo.

## Controls

| Action | Keyboard | Mouse / Touch | Gamepad |
|---|---|---|---|
| Spin | hold `Space` / `Enter` | hold left button / hold anywhere | hold `A` or `RT` |
| Release | let go | let go / lift finger | let go |
| Nose angle (optional in Rookie) | `W`/`S` or `Up`/`Down` | drag up / down while holding | left stick / D-pad |
| Skip the landing beat | any press during flight | tap | `A` |
| Menu (athlete, mode, board) | `Esc` | MENU button | |
| Replay best / voice / haptics / help | `R` / `M` / `H` / `?` | toolbar, `?` on the start card | `X` / `Back` / `Y` |

## Scoring

- **Distance** is measured from the edge of the 2.5 m circle to the landing mark; it must land inside the 34.9 degree sector and you must stay in the circle. Fouls score nothing.
- **Best of 3** sets your rank, from *Park & Rec Hopeful* up to *World Record Menace*.
- **Points** = distance x multiplier. Pigeon x1.5, sprinkler x1.25, hot-dog vendor x2, coach cart x2.5, jumbotron x3, capped.
- Power builds with every turn (full at about 3 turns, dizzy after 4, stepped out after 5). The dial angle at release sets heading and release angle (early = low and right, late = high and left).

## The physics is real

Flight lives in [`src/physics.js`](src/physics.js): a pure, DOM-free, deterministic module (RK4 at a fixed 1/240 s step). A 2 kg, 221 mm discus with gravity, air density from temperature and altitude, and wind (head, tail, cross).

```
q = 1/2 * rho * |v - wind|^2
drag D = q * A * C_D(alpha)       (opposes the air-relative velocity)
lift L = q * A * C_L(alpha)       (perpendicular to it, in the plane of velocity and disc normal)
alpha  = angle of attack = attitude angle - flight path angle (no wind)
```

`C_L(alpha)` and `C_D(alpha)` are **approximations** shaped like published discus data (low-aspect-ratio wing, stall near 25 degrees, then flat-plate behaviour), following the qualitative shape in Frohlich (1981), *Am. J. Phys.* 49, and Hubbard & Cheng (2007), *J. Biomech.* 40; the numbers are not copied from those papers. The disc keeps a fixed attitude in flight (no precession).

**The headwind quirk.** Lift grows with airspeed squared, so a well-set nose angle makes the discus fly **farther** into a breeze (and a tailwind costs distance). After each throw the game re-simulates your release in still air and tells you the gain, plus the nose angle your coach would have picked (Rookie sets that nose for you). Real benchmark: men's WR **74.35 m**, Mykolas Alekna, 2024 (a reference, not a claim about this model).

## Also in the box

3D night stadium (all procedural), broadcast camera with a short slow-mo landing and best-throw replay, a lower-third announcer with optional Web Speech voice, the cast (pigeon flock, coach's golf cart, hot-dog vendor, sprinkler, jumbotron), haptics (`navigator.vibrate` + gamepad rumble), keyboard-playable UI with visible focus, `prefers-reduced-motion` support. Page weight about 1.5 MB, fully offline once loaded; only the optional webfont is external. **Tested:** Chromium (Playwright) at 1440x900 and, with touch emulation, 390x844, 844x390 and 667x375. Firefox and Safari should work but are untested, as are real-device touch and haptics.

## Tests

```bash
npm test                      # unit tests + browser smoke test
node tests/smoke.mjs --docs   # same, and refreshes the committed docs/shots/
node scripts/record-gif.mjs   # regenerates docs/gameplay.gif and docs/screenshot.png (needs ffmpeg)
```

<details>
<summary>What the tests check</summary>

- `node --test tests/` (Node 18+): physics (vacuum range vs analytic, headwind beats still air, stall, determinism, perfect-throw calibration sweeps), the announcer, **modes** (Pro mapping unchanged; Rookie's assist lands farther and is legal more often than Pro at the same mid-quality release; a simulated average rookie lands 45-65 m within 3 throws; the tap is a short legal toss), and the **leaderboard** (seeded, sorted, top 10, validation, works with storage blocked or corrupt, a fake remote adapter plugs in, daily seed and share text).
- `node tests/smoke.mjs` (Playwright) at 1440x900, 390x844, 844x390 and 667x375 through the real input path: start screen, athlete carousel, mode toggle and PLAY click; a human-style throw; Pro's instant tap and a poisoned release; Rookie's tap, slower needle, auto nose, PERFECT flash and coaching line; press-to-skip; initials entry (typed and wheels), board, Daily tab and share text; plus layout assertions on every screen (finite camera, 44 px targets, 11 px text, nothing overlapping, everything inside the viewport, athlete visible beside the start card).
- It expects Playwright at `$HOME/.claude/scripts/node_modules/playwright`; edit the `require` path if yours lives elsewhere.

</details>

## Tech and credits

Three.js r160 vendored in `vendor/`, import map, vanilla JS modules, CSS, Oswald + JetBrains Mono. Static files only: `index.html`, `src/*.js`, `src/style.css`. Pure modules (`physics`, `tuning`, `modes`, `personas`, `leaderboard`, `storage`) have no DOM, so Node tests import them directly; a `window.__debug` hook drives the deterministic captures.

Game, physics and jokes by Josh Dare. Characters are original and fictional. WR reference: World Athletics. No real pigeons were thrown at. MIT licensed, see [LICENSE](LICENSE); Three.js is MIT, see `vendor/three.LICENSE`.
