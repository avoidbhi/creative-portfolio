# The Motion System — creative frontend engineering, in depth

How everything moves in the Abhijeet Kanase portfolio — every arrangement, every hand-off,
every constant — and the pattern space available to mutate it in a rebuild.

Source of truth: `src/motion.js` (the scene, v7), `src/main.js` (page behaviour, v7),
`src/fluid.js` (the cursor fluid), `src/css/*.css`. Every number below is the number in the
code, not an approximation.

---

## I · The laws — the seven invariants

Every mutation in §VII is allowed exactly because these seven are never broken.

1. **One clock, one writer.** A single `requestAnimationFrame` loop lives in `main.js`
   (`AK.loop`). `motion.js`'s `render` step is the only code that touches a card's
   `transform`/`opacity`, the camera (`.stage__space`) and the title. No tweens, no CSS
   transitions on cards, no ScrollTrigger, no per-component rAFs.
2. **A pose is a pure function of (i, S).** `poseRing / poseDrum / poseGrid / poseFront`
   take a card index and the scene state and fill an output object. They read no DOM, write
   nothing, and can be evaluated for *any* time — which is what makes arrangements swappable.
3. **Layout changes are journeys, not swaps.** `travel(i, delay, dur, ease)` snapshots the
   card's *current* pose into `from[i]`, then every frame the pose is blended
   `from → LIVE destination` with a per-card stagger and one ease. The destination keeps
   turning while the card travels into it — so a card flowing into the drum lands in a slot
   that is already moving. Identity is physical: the same DOM element moves from one
   arrangement into the next.
4. **A mass layer gives everything inertia.** After the pose (and any journey) is computed,
   every channel relaxes toward it: `cur += (pose − cur) · (1 − e^(−dt·24))`. Drag, hover,
   focus, resize and drag-release all pass through this one filter, so the scene always
   *arrives* at a state and never snaps.
5. **Scroll influences, never controls.** Native scrolling is untouched. The smoothed scroll
   value and velocity from `main.js` only *modulate* the scene: rotation rate
   (`1 + 1.4 · energy`) and the camera (pulled back and over as the stage leaves, so the hero
   hands over to the chapters as one space).
6. **Enter = ease-out, exit = ease-in. Nothing high-frequency animates.** Arrivals use
   `expo.out` (`1 − 2^(−10t)`), on-screen moves use `power3.inOut`. The only continuous
   motion on the page is the ring/drum rotation (slow, constant-rate) and the fluid under a
   recently-moved pointer. Idle state is still.
7. **Degrade is designed, not accidental.** No JS → the markup is a captioned grid. Reduced
   motion at load → `html.no-scene`, the scene never boots. Reduced motion toggled mid-session
   → `destroy()` unwinds every listener and style write. Any thrown error in the tick →
   `destroy()`. Any script error on the page → `html.reveal-all` forces every reveal visible.
   The page is never left half-animated or hidden.

---

## II · The cast

- **`[data-stage]`** — the full-viewport scene. Hosts the space, the cards, the HUD, the
  title, the mode buttons, the caption band.
- **`[data-stage-space]`** — the *camera*. One element, transformed as
  `translate3d(0,0,z) rotateX(rx) rotateY(ry)` about the stage centre; perspective
  `P = 640` px (must match `.stage.is-3d` in CSS).
- **41 × `[data-stage-card]`** — `<figure>`s in two rings
  (`<div class="stage__ring" data-ring="in|out">`). Each holds one `img` or one `video`
  (432×768, lazy, `preload=none`), a `figcaption.mono` caption, `data-card-id`,
  `data-k` (the label line) and `data-href` (its piece page).
- **Reads happen once, at boot.** Aspect ratios (`--ar` custom property per card;
  `stage__card--wide` for landscape), `isFilm[]`, `captions[]`, `kinds[]`, `hrefs[]`, and
  the stagger order `order[i] = (i·7) mod n` — a stable pseudo-random permutation that is the
  same every load, so the choreography is reproducible.
- **`window.AK_SCENE`** — a read-only QA handle: `{ S, cur, cards, setMode, open, close,
  measure, tick, ring, drum }`. Every state below is inspectable live.

---

## III · The state — one source of truth

```js
S = {
  mode: 'orbit' | 'scatter' | 'grid',   prevMode,
  scrollProgress, scrollVelocity,       // 0 = stage at top … 1 = gone · px/s (smoothed)
  orbitRotation, drumRotation,          // degrees, UNBOUNDED — += rate·dt, never wrapped, never reset
  carouselProgress (= drumRotation/360), layoutProgress,
  ringRate, drumRate, ringVel, drumVel, // °/s (smoothed) · drag impulses (decaying)
  focused: -1, hovered: -1, hold, touchHold, dragging,
  active,        // stage on screen (IntersectionObserver) — off-screen = no rotation, no writes
  live,          // boot complete
  cam: {rx, ry, z}, camT: {rx, ry, z},   // camera current / target
  ptr: {x, y},    // cursor parallax target
  dim, titleO, idle,
}
```

Key disciplines: rotations are unbounded (no wrap → no discontinuity, ever); the drum's
axial position is *derived* from its rotation (a helix rotated is a helix translated);
camera and dim/title opacity are targets chased with exponential relaxations, never set.

---

## IV · The patterns — how each arrangement moves

### 1 · ORBIT — "a flat ring turning in the screen plane"

**Solve (per resize, `solveRing`):** the outer ring's radius is
`R = min(W/2 − 10, roomHeight/2, 600)`; the ring's *card scale* is iterated 4× so the total
card width fills 86 % of the circumference (`FILL = 0.86`) — wide cards take more degrees
because each card's base angle is proportional to its pixel width
(`place()`: `base[i] = (acc + cw/2)/total · 360`). The inner ring is a 0.6-factor circle
inside the outer, with its own 4-pass fit and a `max(10 px, 4 % R)` gap between the two.
Every card's **base angle** is fixed at solve time; rotation is added at pose time.

**Pose (`poseRing`):** the ring is flat — `z = 0` for all cards. The card's `rz` is
`baseAngle + rotation + 90`, so each card stays tangent to the ring (a print pinned to a
circular desk, readable at all times). Scales: outer `0.6`, inner `0.5` (fit-solved).
The inner ring **counter-turns at 1.35×** the outer — the two rings slide past each other,
which is what makes the ring read as depth even though `z = 0`.

**Motion:** `RING_RATE = 360/64` (one turn ≈ 64 s, outer). The rate is smoothed
(`k = 1 − e^(−7dt)`) and modulated by scroll energy: `(1 + 1.4 · min(|v|/1200, 1))` —
fling the page and the rings pick up speed, then settle. The rotation is **held**
(rate relaxes to 0) while the pointer hovers the ring band, drags, or a card is focused.

**The hole:** the headline lives in the inner ring's hole. `fitTitle()` measures the
headline at its CSS size and scales it (`--title-fit`, floor 0.42) until the farthest glyph
clears the hole on 16:9 screens; on ≤ 600 px the headline stacks *above* the rings and stays
full size. The title's opacity is a chased value (`titleO`, k = 5) that is wanted only in
orbit mode with nothing focused — in grid/scatter it fades out, on phones it stays up.

**Cursor label:** `drag`.

### 2 · SCATTER — "the same cards on a turning helix drum"

The drum is a **screw**: n cards on a helix around a vertical axis. Because rotating a helix
is the same as translating it, the rotation *carries the cards along the axis* — the whole
collection flows upward through the room and wraps where nobody can see it (the helix is
~3× taller than the room).

**Solve (`solveDrum` + `drumPack`):**
- **`perTurn = 5`** cards per 360° (laptop and phone alike) — the tightest packing the
  spacing solver can prove safe.
- **Common-area sizing:** every card is scaled to one shared visual area (the median card's
  area), but no card may be taller than the median card's height at that scale — a 9:16
  film at equal area is a third taller, and it used to set the vertical pitch for everyone.
- **Deterministic jitter** (a desk, not a lattice): per-card offsets from integer hashes
  (`i·2654435761` and `i·40503+7` → `h1s/h2s` in [0,1)) — vertical jitter `jy` up to ±15 %
  of the pitch, radial jitter `jr` ±6 %. Successive turns never line up in columns, and it
  is identical every load.
- Desktop: a **wide, shallow ellipse** (`Rz = 0.55·Rx`) so the near arc spreads across the
  middle of the screen instead of stacking in a column. Phone: a round drum
  (`Rx = 0.44W`, `Rz = Rx`).
- **`drumPack` (v8.3, the spacing solver):** for each vertical pitch from tight to loose
  (`room/18 … room/12`), it searches the narrowest radius (`W·0.14 … 0.36`) whose **lit**
  cards never touch at *any* angle, then keeps the pitch whose lit neighbours sit closest on
  average. Every test projects each card's four corners **exactly as the browser will** —
  card transform (translate/rotateY/scale), camera (−5° from above, ±3.6° scroll lean, ±6°
  cursor pan), perspective 640 about the stage centre — across five camera poses
  (`DRUM_LEAN = [[−5,0],[−8.6,−6],[−8.6,6],[−1.4,−6],[−1.4,6]]`). Rules: two lit cards
  (opacity ≥ 0.7) keep `DRUM_GAP = 4` px at rest and never intersect under the lean, unless
  the one behind is a half-lit "shoulder" card with ≤ 15 % show-through (real depth order —
  a stack of prints, not a clash); two dim shoulder cards and the far side are free. Cost
  ~30–50 ms, **once per resize, never in the frame loop.** This is what makes the drum pack
  itself for *any* future set of work — 41 cards, 60, or 20.

**Pose (`poseDrum`):** `u = (i + rotation/step) mod n` — position along the helix in card
slots, wrapping at the invisible ends. `x = sin·Rx·jr`, `y = mid + (u − n/2)·dy + jy`,
`z = (cos − zoff)·Rz·jr`. `ry = atan2(Rz·sin, Rx·cos)` — **tangent to the ellipse**: cards
are face-on up front, edge-on at the sides, so the drum reads as a solid object, not a wall.
Opacity is a product of four smoothstep factors: near-side lighting
(`0.1 + 0.9·smooth01((cos+0.5)/1.2)` — the far half goes almost dark), end fades (gone
before the wrap), and a soft vertical clip at the HUD and the foot (gone once ~⅔ of the card
is outside the room).

**The wrap teleport:** because `y` is derived from a wrapped angle, a card's destination can
jump by a whole helix height. `poseOf` detects the jump (`|Δy| > total/2`) and either
teleports the card's *current* pose to the destination (it was at an invisible end) or
re-times an in-flight journey from where it is — **no visible jump, ever.**

**Motion:** `DRUM_RATE = 360/18` (one turn ≈ 18 s; every piece passes the front once in
~90 s). A hovered drum **slows to 0.12×, never freezes** under a parked cursor. The camera
sits 5° above. Front card ≈ 40 % of the room tall; the phone keeps its approved front size
with a perspective-magnification correction (`kFront`).

**Cursor label:** `turn`. Parallax amplitude 6° (2.5° phone).

### 3 · GRID — "the year as one contact sheet"

**Solve (`solveGrid`):** tries 2–10 rows, packs each by card aspect (row height first,
widths follow), and keeps the row count with the largest card height within the room width;
gap 8–16 px; the sheet is centred. Cards are static: `z = 0`, no rotation, scale `h/ch[i]`.

**Motion:** none — the grid is the *rest* of the scene. It still breathes through the
camera (parallax 1.5°) and the scroll hand-off. That contrast is the point: after the drum's
constant motion, the sheet is stillness you can read.

**KLINE:** "Grid — the year as one contact sheet".

### 4 · FRONT — the focus pose

**Pose (`poseFront`):** the focused card scales to fill ~90 % of the room height
(`f = min(0.9·room/h, 0.86·W/w)`), and its `z` is set by inverting the perspective so that
scale reads as distance, not as a zoom (`z = P·(1 − 1/f)`).

**Choreography (`open`):** the tour dies; the previous card's film stops; the focused card
travels with **`expo.out`** (arrival) while every other card travels with **`power3.inOut`**
(settling) — one duration (0.9 s), two personalities. `S.dim` chases 1 and the other cards'
opacity falls to `1 − 0.88·dim` (0.12) — the room goes dark around the one piece. The card's
cursor becomes `close`; the caption line under the stage becomes `kinds[i] / captions[i]`
plus the **"Read the piece →"** link (`data-href`). If it's a film and the stage is active,
the film plays (`preload` upgrades to `auto`; saved-data mode refuses).

**`close`:** the film stops, `dim` relaxes back, and the re-layout is re-staggered with the
*returning* card going first (delay 0, others `0.05 + order·0.012`) — the piece hands the
arrangement back before anything else moves. A toggle guard (0.35 s between open/close)
makes a double-tap one open, not an open-and-close flicker. `Escape` closes; `Enter`/
`Space` on a card opens (keyboard path moves focus to the card).

**The hand-off with the films:** an `IntersectionObserver` on the stage pauses/resumes the
focused film exactly with `S.active` — scroll the piece out of view and its film stops.

### 5 · The journey engine (what makes patterns interchangeable)

```js
travel(i, delay, dur, ease)      // snapshot: from[i] = cur[i]; jStart = now + delay
poseOf(i, out):
    dest(i, out)                 // LIVE destination (the pattern keeps moving)
    if journey active:
        e = ease((now − t0)/dur) // 0…1
        out = from + (out − from)·e          // x,y,z,s,o linear
        out.rx/ry/rz via shortDelta()        // shortest arc, stays on the same turn
```

- Stagger: `order[i] = (i·7) mod n` (same every load). Mode change: delays
  `order·0.022 s`, duration 1.15 s, `power3.inOut`. Boot: `0.15 + order·0.03`, 1.7 s,
  `expo.out`.
- **Why the destination is live:** a card travelling into the drum lands in a slot that is
  still rotating; a card travelling out of focus starts returning while the ring is already
  turning again. The scene never waits for a journey to finish before the world moves.
- **`shortDelta`** keeps rotations on the shortest arc across any wrap — a card never spins
  the long way to "stay in the same turn".

### 6 · The mass layer and the one write

Per frame, per card: `poseOf` → (focus dim) → mass relaxation
(`kMass = 1 − e^(−24dt)` on x/y/z/rx/ry/rz/s/o) → **hover lift** (`lift[i]` chases 0/1 at
`k = 1 − e^(−9dt)`; adds `+40 px` of z and `+3 %` scale — a card rises off the desk under
the cursor) → one transform string. The far side of the drum flips its face while edge-on
(invisible moment): `if cos(ry) < 0: ry += 180`. Strings are diffed against the previous
write; the DOM is touched only when a value actually changed. **transform + opacity only —
no layout reads anywhere in the loop** (geometry is measured on resize, once).

### 7 · The camera

`camBase()` = mode + scroll, smoothed: as `scrollProgress` p goes 0→1 (stage scrolling out),
the camera lies back (`rx → +16°`) and recedes (`z → −340 px` desktop, −200 phone) with a
smoothstep `p²(3−2p)`, plus a velocity lean `clamp(v/900, ±3°)`. The drum adds its −5°
overhead. Cursor parallax (`ptr`) is added per mode (scatter 6°, grid 1.5°, orbit 0°) — and
**freezes while the pointer is over a card**: "what you aim at stays put." The whole camera
chases its target at `k = 1 − e^(−4dt)`.

### 8 · The tour — the standing opening

```
TOUR = ['grid', 'scatter', 'orbit']     DWELL = [10, 5, 5]
```

The site **always opens on orbit** (laptop and phone). After 10 s idle it moves to grid
(5 s), then scatter (5 s), then orbit — on the loop. The tour *pauses* (idle timer resets)
while the pointer hovers a card or the ring band, drags, focuses, the tab is hidden, the
stage is > 25 % scrolled away, or the page is mid-fling (`|v| > 80`). Any **direct**
interaction (mode button, drag, opening a card, a chapter's orbit-link) calls `tourOff()` —
permanent for the session. The hand-off is silent: the tour's `setMode` is the same journey
any user could trigger.

### 9 · Pointer semantics — the whole vocabulary

| gesture | in orbit | in scatter | in grid |
|---|---|---|---|
| hover the ring band | holds the rings | — | — |
| hover a card | holds; caption shown; `lift` | slows to 0.12×; caption | caption; `lift` |
| drag (6 px threshold, pointer-captured) | `orbitRotation += dx·0.22` (clamped ±12°/event) + `ringVel` impulse | same (±14, `dx·0.28`) + `drumVel` | pans `ptr.x` (±16) |
| release | impulse decays `e^(−4.5dt)` — the ring coasts | same | — |
| click a card | open | open | open |
| click empty space | close (if focused) | close | close |
| drag vs click | a drag is not a click (8 px / 0.3 s suppression) | | |
| touch | finger-down = hold (like hover); tap = open | | |
| `Escape` | close | | |
| chapter "in the orbit ↑" links | `setMode('orbit')`, native smooth scroll, then the pending card opens once the stage has arrived (`|y − top| < 6` or the fling has settled) | | |

Drag impulses are added to the rotation *and* to a decaying velocity — so a flick coasts and
dies naturally, through the same mass layer as everything else. The cursor element re-reads
its label on a `cursor:refresh` event, which is how a *parked* pointer updates when the
stage swaps `drag → read → close` under it.

### 10 · Boot and death

**Boot:** wait for `document.fonts.ready` (measure after the type loads — card widths are
real), place every card at `z = −1600, opacity 0, scale ×0.6`, then travel them in with the
boot stagger (1.7 s, `expo.out`) — **the rings assemble out of the dark**. The stage gets
`is-live`, which fades in the HUD and foot via CSS.

**Death:** `destroy()` (reduced-motion toggled on, context lost, or an error in the tick)
removes every listener, every class, every inline style the scene ever wrote, stops the
focused film, and adds `html.no-scene` — the page falls back to the captioned grid exactly
as if JS had never run. Separately, `main.js` listens for `error` / `unhandledrejection`
and adds `html.reveal-all`, which forces every reveal, artifact and stage element visible
with `!important` — a failed script can never hide the site.

---

## V · The fluid — how the cursor's trail moves

`fluid.js` is a GPU fluid simulation (stable-fluids: semi-Lagrangian advection + pressure
projection) rendered into the fixed background layer, one splat per pointer-move.

**The chain, per frame:**
1. **Input.** Each pointer carries its own color (full spectrum, swapped at 10 updates/s).
   On move: a *velocity splat* (`dx, dy · SPLAT_FORCE`) and a *dye splat* (a gaussian of
   radius `SPLAT_RADIUS/100`, aspect-corrected) at the pointer, in the pointer's color.
2. **Advection.** The velocity field carries the dye — this is what makes a trail *flow*
   instead of smear. Pressure projection (20 Jacobi iterations) keeps the field incompressible,
   so the dye curls and folds instead of collapsing.
3. **Dissipation.** Dye decays at `DENSITY_DISSIPATION = 2.5` (~3 s to plain black);
   velocity at `VELOCITY_DISSIPATION = 1.8` (the motion dies quickly, so the flow stays
   compact at the pointer).
4. **Post.** Bloom (8 iterations @ 256 px, threshold 0.25, intensity 0.2) and sunrays
   (weight 0.4) — only the brightest moments glow; `BRIGHTNESS = 0.05` keeps the dye a
   whisper under the type. The opening burst (`multipleSplats`) is the same dye at 5.5×
   brightness, once, on load — the only moment the page glows for itself.

**Current tuning (the "smaller radius" the client approved):**
`SPLAT_RADIUS 0.25 → 0.12 → 0.07`, `SPLAT_FORCE 3000 → 1800 → 1200`,
`VELOCITY_DISSIPATION 0.8 → 1.4 → 1.8` — a compact wisp that hugs the pointer. All of it
lives in one config object (`window.AK_FLUID_CONFIG` can override every value) — the
mutation surface for the trail is a data object, not code.

**Lifecycle:** `wake()` on pointer move; `SLEEP_AFTER = 4 s` idle → the sim stops and the
background is plain black; `MAX_DPR = 1` (the dye is a 512 px texture — extra display pixels
buy nothing); `SIM_RESOLUTION = 128`, `DYE_RESOLUTION = 512`. Motion-law compliant: it runs
only while the pointer has recently moved, and it dies on `motion:reduce`.

---

## VI · Below the fold — the chapter grammar

The stage is the loud room; the chapters are the quiet one. Same laws, different tempos.

- **One loop drives the HUD.** `main.js`'s frame updates the progress bar
  (`scaleX(progress)`), the `NN% READ` numeral, the chapter label in the nav, and the
  depth layer — never a separate timer.
- **Scroll smoothing** is two exponential chases: position at `k = 1 − e^(−16dt)`, velocity
  at `k = 1 − e^(−7dt)` — the page's *felt* motion, which the scene's energy term reads.
- **Reveals:** `IntersectionObserver` (once) toggles a class; CSS does the move —
  `opacity 0 + translateY(26px) → in`, `.9 s var(--ease-out)`, delayed by `--d`. The base
  law is *rise from below*; specific components bend it with their own starting transforms:
  the manifesto rises 16 px and its emphasized word **lands late and heavier**
  (`cubic-bezier(.34, 1.56, .64, 1)` — the single permitted overshoot, +32 % delay,
  "the shout lands after the question"); the hook-lab script rows **read in from the left
  like a timeline** (`translateX(−18px)`, the red super lands 0.22 s after its VO line).
- **The red pen (`.edit` decision cards):** on entering the bottom 75 % of the viewport,
  `is-inked` is added and *CSS timing only* does the rest — the strike lands at 0.2 s
  (a `background-size: 0 → 100%` of `0.085em` — a line drawn through the "could have said"),
  the serif "said" inks in at 0.55 s (1 s, from `translateY(.18em) scale(.985)`, origin
  left-bottom — ink pooling upward from the baseline), and the red note fades at 1.1 s.
  **The strike always lands before the correction** — the pen's grammar. No JS timers.
- **The depth layer:** `[data-depth]` elements (chapter heads, the index card) arrive from
  depth as they scroll in: `translateY((1−e)·amp)` + `scale(.965 → 1)`, driven per-frame by
  their viewport progress (the one continuous scroll-linked effect below the fold — it is
  slow, ±a few px, and respects reduced motion). A resting transform (the index card's tilt)
  is carried by the element and preserved.
- **Tilt artifacts:** `[data-tilt]` wrappers hold `perspective: 1200px`; while the pointer
  is over them the inner card tracks it at `0.12 s linear` (`.is-tilting`), and settles back
  over `0.6 s var(--ease-out)` — a print leaning under your finger, then letting go.
- **The custom cursor:** the dot follows 1:1; the **ring lerps behind at
  `k = 1 − e^(−14dt)`** — the follower, not the leader. Over a target it scales to 1.55;
  over `[data-cursor]` elements it carries the stage's label (`drag` / `read` / `close` /
  `turn`) via the `cursor:refresh` event. Fine pointers only; hidden on touch and under
  reduced motion.
- **The paper stocks:** four named surface treatments are pure CSS (no grain animation, no
  shimmer) — the static materials the motion sits on.

---

## VII · The pattern space — the mutation formula

A **pattern** in this system is exactly:

```js
{
  pose(i, S, out)     // pure; the arrangement's law
  solve()             // per-resize geometry (may be expensive — never in the loop)
  rate?               // base rotation rate (°/s) if it moves
  camBase?            // camera contribution (e.g. the drum's −5°)
  parallax?           // cursor-pan amplitude (deg)
  cursor, kline       // vocabulary
}
```

That's it. Journeys, the mass layer, drag + impulse, focus, dim, the tour, the deep links,
the boot, `destroy()`, the QA window and every degrade path are **pattern-agnostic** — they
operate on the `LAYOUT` registry and the pose output, not on any specific arrangement.
Adding a pattern is adding a pose function + a solver + one line in the registry + one
button + one KLINE string. The choreography (stagger `order`, the two-personality open, the
live-destination blending, the wrap teleport for axial patterns) is inherited for free.

Cost model: poses are O(n) per frame (n = 41 today — cheap even at 60 fps); solvers may be
O(n² · phases) because they run per resize only. Anything heavier than `drumPack` should
run on a timeout after resize settles.

### The catalog — extraordinary moves, each ready to mutate in

**A · New arrangements (one pose function each)**

1. **MANUSCRIPT** — the ring becomes a letterpress page: a single vertical column of
   "lines", each card a typeset line, x-jittered by the deterministic hash, `rz` = 0, the
   column's `t` driven by scroll progress inside the stage section (law 5 intact: smoothed,
   never controls). Pose: `y = mid + (i − n/2)·lineH; x = jitter(i)·0.4rem; s = 1/2`.
   The orbit stops "turning" and starts *reading* — the work as a letter to the reader.
   Cost: trivial. Reduce-motion: the column is static (it already is without scroll-tie).
2. **HELIX PAIR** — the inner and outer rings become two counter-rotating strands of a
   vertical helix (the drum's math, but two strands, `ringOf` → strand, opposite sign,
   phase-offset 180°). Cross-strand "base pairs" drawn as thin red lines on a 2D canvas
   behind the cards (the one place red is allowed to draw geometry). The two clients —
   the pitch and the film — read as one molecule. Cost: low; canvas O(n).
3. **THE DESK** — top-down flat-lay: every card a print on the black desk, rotation
   `jitter(i)·8° − 4°`, positions from a hand-laid `solve` (or golden-angle spiral),
   drag = **pan the desk** (camera translate, not rotation), focus = the print **lifts**
   (the existing `poseFront` with a shadow layer). The drum's `drumPack` machinery
   repurposed as a 2D non-overlap check. Cost: low. Voice: the desk is where the work was
   actually done.
4. **CONSTELLATION** — the drum becomes a star field: cards at hash positions, scaled by
   year (2025 near, 2026 far), opacity breathing at 0.6 s offset per card; on focus the red
   pen draws the lines of the piece's constellation (SVG path, inked over 0.8 s, erased on
   close with the same stroke in reverse). The chapter's work-log entries are the stars'
   labels. Cost: low-mid. The pen draws *connective tissue* — relationships between pieces.
5. **ECLIPSE** — a focus variant, not a layout: instead of the card flying to center, the
   camera pushes *through* the card's position (the card holds its slot; `cam.z` passes its
   z; the card's `s` is pinned to screen). The piece eclipses the hole, the title goes dark
   behind it. Cost: a camera curve + a poseFront bypass. Voice: the work is in front of the
   name, not replacing it.
6. **ZINE** — the grid gets a filmstrip: sprocket holes on the left edge (CSS), cards
   cropped to a fixed 3:2 window, the sheet draggable horizontally in page-width pages
   (drag → `ptr.x` already exists; add page snapping). The year as contact sheets you
   flick through. Cost: low.
7. **GLYPH FORM** — the endgame pattern: the destination pose *is typography*. For the
   current KLINE text, measure the glyphs (canvas, once per text) and let the cards travel
   to glyph positions — the arrangement literally becomes the sentence ("Forty-one pieces of
   work" made of the forty-one pieces). Triggered on chapter arrival (the stage reforming
   into the chapter's title). Cost: the highest on this list (glyph hit-testing); scope it
   as the closing beat of one chapter, not a mode.

**B · Behavior mutations (touch one existing layer)**

8. **BREATHING** — the idle stage breathes: ring radius `R·(1 + 0.02·sin(2πt/6))`, drum
   pitch `dy·(1 + 0.015·sin(2πt/6 + 1))`. Six-second period, sub-2 % amplitude — below
   perception-as-motion, above perception-as-still. One line each in `poseRing`/`poseDrum`
   (time is already an input to poses). Off under reduced motion.
9. **WORD-SYNC CAPTION** — while a card is focused, the caption under the stage types out
   word-by-word (the `say()` string, split, revealed on a 90 ms cadence from the existing
   loop — no timer), the last word underlined in red by the pen (a `::after` width
   animation, ease-out). The stage *reads* the piece before you do.
10. **YEAR DIAL** — a mono dial at the stage's rim (CSS + one custom property per frame):
    it turns with `orbitRotation`, and each card's year lights on the dial as the card
    passes the front (the pose's angle is already computed — compare to the front angle,
    write one class). 2025–26 becomes a *mechanism* you can see turning.
11. **INK REWIND** — on `close()`, instead of the card simply returning, the fluid takes
    one snapshot of the last dye frame (already in the GPU) and it is composited as a thin
    red scribble that draws itself down the stage for 0.5 s and fades in 0.8 s — the pen
    "signs" the piece as you leave it. One texture readback, once per close.
12. **PAPER STOCKS IN MOTION** — the four stocks shift per chapter as *static* texture
    swaps on scroll (no crossfade longer than 0.4 s, ease-out) — the material of the room
    changes with the room. Zero continuous motion; law 6 intact.
13. **SCROLL-TIED RING** — within the stage section, the ring's rotation maps to scroll
    position (`rotation = base + progress·120°`) with the existing smoothed value — the
    reader *turns the ring by scrolling*, the way you turn a record. The auto-rate runs
    only when the reader is still. (This is the strongest mutation of law 5 — do it with the
    smoothing and the hold states intact, and test the fling case.)
14. **TALKING HEAD** — a pattern *as metaphor for the medium*: in the hook-lab chapter the
    drum's front slot becomes a 9:16 phone frame (CSS) with the script's hook typed under
    it — the creator scripts orbit as the videos they became. The frame is the front card's
    wrapper; the pose is unchanged.
15. **SOUND (off by default)** — mode changes and card opens carry a 80 ms filtered-noise
    breath (WebAudio, synthesized — no assets), only after the first user gesture, mutable
    from the HUD, documented in the epilogue. The one mutation that adds a *sense*; ship it
    as an opt-in toggle, never on by default.

Each of the above degrades cleanly: without JS or under reduced motion, the captioned grid
is already there.

---

## VIII · Mutation protocol — how to change it without breaking it

1. **Touch exactly one layer.** Pose (new arrangement) · journey (stagger/ease) · mass
   (inertia feel) · camera (parallax/hand-off) · tour (dwells/order) · fluid (the config
   object only) · reveal (CSS + IO only). A mutation that spans layers is two mutations.
2. **Config is data.** `window.AK_FLUID_CONFIG` already overrides every fluid constant;
   give the stage the same: `window.AK_STAGE_CONFIG` for rates, dwells, gaps, amplitudes.
   Tuning a feel should never require reading a pose function.
3. **The guardrails (never break):** one writer · poses pure · no CSS transitions on cards ·
   enter ease-out / exit ease-in · nothing high-frequency · red is the only accent ·
   unbounded rotations · `motion:reduce` contract (boot skip, live `destroy()`) ·
   `cursor:refresh` vocabulary · `reveal-all` fail-safe · no layout reads in the loop.
4. **Verify with the machine, then the eye.** `window.AK_SCENE` exposes everything for QA
   scripts: drive `setMode`/`open`/`close` programmatically, assert pose invariants (no
   card opacity > 1, no transform writes when `!S.active`, wrap teleport never visible:
   `|Δy|` jumps only at opacity < 0.05). Visual checklist, 12 fixed shots — 390 / 768 /
   1440 px × {orbit, scatter, grid, focused card} — diffed against the approved baseline.
   Generated markup (orbit, logs, piece pages) stays under `tools/build.py --check`
   idempotency: two builds, byte-identical.

---

## IX · Code map

| file | role | the pieces that matter |
|---|---|---|
| `src/motion.js` | the scene (v7) | `S` (state) · `measure/solveRing/solveDrum/drumPack/solveGrid` (geometry) · `poseRing/poseDrum/poseGrid/poseFront` + `LAYOUT/dest` (patterns) · `travel/poseOf` (journeys) · `step` (the tick: rotation, camera, dim, mass, one write) · `setMode/open/close` (grammar) · `tourStep` (the opening) · `camBase` (the hand-off) · `destroy` (the exit) |
| `src/main.js` | page behaviour (v7) | the single `frame` loop · scroll smoothing (k16/k7) · HUD progress + chapter label · depth layer · custom cursor (dot 1:1, ring k14) · reveals (IO once + CSS) · `reveal-all` fail-safe · `AK` namespace (loop, scroll, measure, finePointer) |
| `src/fluid.js` | the cursor's trail | config object (`AK_FLUID_CONFIG`) · `splat/multipleSplats/applyInputs` · solver (advection, 20-iteration pressure, dissipation) · bloom + sunrays · wake/sleep (4 s) · `motion:reduce` destroy |
| `src/css/00-tokens.css` | the system | palette (`--ink/--graphite/--paper/--red`) · fonts · easings · the 8 px scale · `--page 76rem` |
| `src/css/20-type.css` | reveal grammar | `[data-reveal]` .9 s ease-out rise · `reveal-all` fail-safe block |
| `src/css/50-chapters.css` | the pen's grammar | `.edit` (strike 0.2 s → after 0.55 s → note 1.1 s) · `manifesto__line em` overshoot · `script__row` left-in · tilt artifacts · the caselog |
| `src/index.html` | the markup spec | the stage + 41 cards (generated) · chapters · worklist · HUD · all copy |
| `src/data/pieces.json` | the content config | 41 pieces → orbit, logs, piece pages, counts |
| `tools/*.py` | the generators | `gen_orbit` (rings + counts) · `gen_log` (case logs) · `gen_pieces` (piece pages) · `build` (assemble + `--check`) · `pull_creatives` (Drive → 4K → webp → config) |

---

*The system's single sentence: **the same forty-one objects, always — the only thing that
changes is the law that places them, and every law hands every object back to the next law
without dropping it.*** That is what a mutation is allowed to be, and what it must never be:
a second system.
