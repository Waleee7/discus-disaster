<p align="center"><img src="docs/banner.svg" alt="DISCUS DISASTER - animated banner" width="100%"></p>

**A funny, physically serious 3D browser game. Throw a real-aerodynamics discus under the floodlights, read the wind, and try not to hit the pigeons. (Hit the pigeons.)**

Built by a real college discus thrower who also writes software. No build step, no dependencies to install, one CDN import.

<p align="center"><img src="docs/gameplay.gif" alt="Gameplay: spin, release in the green window, pigeon strike, slow-mo landing, measuring tape" width="720"></p>
<p align="center"><img src="docs/screenshot.png" alt="Pigeon strike mid-flight" width="720"></p>

## Play it locally

```bash
git clone <this repo> && cd discus-disaster
python3 -m http.server 8137      # any static server works
# open http://localhost:8137
```

Needs a browser with WebGL2 (any current Chrome, Edge, Firefox, Safari). Fonts and Three.js load from CDNs, so you need a network connection the first time.

## Controls

| | Hold + spin | Release | Nose angle (attitude) | Other |
|---|---|---|---|---|
| **Keyboard** | hold `Space` / `Enter` | let go | `W`/`S` or `Up`/`Down` | `R` replay best, `M` voice, `H` haptics, `?` help, `N` next |
| **Mouse** | hold left button | let go | drag up / down while holding | toolbar buttons |
| **Touch** | hold anywhere | lift finger | drag up / down while holding | toolbar buttons |
| **Gamepad** | hold `A` or `RT` | let go | left stick / D-pad up-down | `X` replay, `Y` help, `Back` voice, `Start` next |

How a throw works: power builds with every turn (full at ~3 turns, dizzy after 4, stepped out after 5). A dial shows your facing; **release inside the green window**. Dial angle sets both the heading (edge of window = edge of the legal sector) and the release angle (early = low and right, late = high and left). The nose angle sets how the disc meets the air. 3 throws, best distance sets your rank, bonuses multiply your points.

## The physics is real

Flight lives in [`src/physics.js`](src/physics.js): a pure, DOM-free, deterministic module (RK4 at a fixed 1/240 s step). A 2 kg, 221 mm discus with gravity, air density from temperature and altitude, and wind (head, tail, cross).

```
q = 1/2 * rho * |v - wind|^2
drag D = q * A * C_D(alpha)       (opposes the air-relative velocity)
lift L = q * A * C_L(alpha)       (perpendicular to it, in the plane of velocity and disc normal)
alpha  = angle of attack = attitude angle - flight path angle (no wind)
```

`C_L(alpha)` and `C_D(alpha)` are **approximations** shaped like published discus data (low-aspect-ratio wing: lift slope ~1.6 per radian, small lift at zero angle from the dished profile, quadratic drag growth, stall near 25 degrees, then flat-plate behaviour). They follow the qualitative shape in Frohlich (1981), *Aerodynamic and mechanical forces in discus flight*, Am. J. Phys. 49, and Hubbard & Cheng (2007), *Optimal discus trajectories*, J. Biomech. 40, but the numbers are not copied from those papers. Simplifications: the disc keeps a fixed attitude in flight (gyroscopic stability), there is no pitching moment or precession, and crosswind uses a small roll-bank gain so the disc actually drifts.

**The headwind quirk.** Lift grows with airspeed squared. A headwind raises the air-relative speed without slowing the disc over the ground, so a well-set nose angle turns it into extra lift and the discus flies **farther** into a breeze (and a tailwind costs distance). After each throw the game re-simulates your exact release in still air and tells you the gain, plus the nose angle your coach would have picked. Real-world benchmark: men's WR **74.35 m**, Mykolas Alekna, 2024 (a reference mark painted on the pitch, not a claim about this model).

## Features

- **3D night stadium**, all procedural: floodlights with beams, instanced crowd of thousands with camera flashes, ad boards, discus cage, lathe-geometry discus with rim, tape measure.
- **Camera**: broadcast shot while spinning, follow-cam in flight, slow-mo near landing, tape-measure fly-over, replay of your best throw (recorded trajectory + obstacle clock, so it replays exactly).
- **Announcer**: broadcast lower-third captions with savage foul lines and teaching moments; optional Web Speech voice (muted by default, toggle `M`).
- **The cast**: a pigeon flock, the coach's golf cart, a hot-dog vendor, a sprinkler, and a jumbotron, each with a multiplier and a bad day.
- **Haptics**: `navigator.vibrate` patterns on spin ticks, release, landing and hits (feature-detected; iOS Safari has none and degrades silently) plus **Gamepad rumble** (`vibrationActuator` dual-rumble, legacy `hapticActuators` fallback).
- **Accessibility and comfort**: fully keyboard playable, visible focus, captions for every announcer line, high-contrast HUD, `prefers-reduced-motion` removes shake and softens slow-mo, pixel ratio capped at 2 with adaptive drop, pauses when the tab is hidden.

## Tests

```bash
node --test tests/            # 12 physics tests (Node 18+; `tests/index.js` makes the directory form work on Node 22)
node tests/smoke.mjs          # Playwright smoke: real input + scripted throw, no console errors, screenshots to docs/shots/
node scripts/record-gif.mjs   # regenerates docs/gameplay.gif (needs ffmpeg)
```

The physics suite checks: vacuum range vs the analytic projectile formula (<1%), headwind beats still air for a well-attituded throw, extreme angle of attack stalls and shortens range, a realistic 25 m/s / 35 deg release lands 55-75 m, plus determinism, crosswind symmetry and the density model. `tests/smoke.mjs` expects Playwright at `$HOME/.claude/scripts/node_modules/playwright`; edit the `require` path if yours lives elsewhere.

## Tech

Three.js r160 via ES module import map (jsDelivr, pinned), vanilla JS modules, CSS, Oswald + JetBrains Mono. Static files only: `index.html`, `src/*.js`, `src/style.css`. A `window.__debug` hook (`throw`, `advance`, `runThrow`) drives the deterministic captures used by the smoke test and the GIF.

## Credits

Game, physics and jokes by Josh Dare. Aerodynamics background: Frohlich 1981, Hubbard & Cheng 2007. WR reference: World Athletics. No real pigeons were thrown at. MIT licensed, see [LICENSE](LICENSE).
