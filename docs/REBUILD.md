# REBUILD PROMPT — Abhijeet Kanase creative-portfolio
### v2 · self-contained, with the full motion spec and the mutation catalog

You are rebuilding the creative-portfolio site for Abhijeet Kanase (copywriter & creative
strategist, Mumbai) from scratch, **in this same repo**, replacing the current hand-rolled
single-file build with a content-first static architecture. The existing repo is your **spec
and your content source of truth** — extract its design, copy, behavior and motion 1:1, then
rebuild. Do not invent content, dates, process or copy. Where the existing site has a string,
port it verbatim (including U+2011 non-breaking hyphens and exact punctuation).

The current constant-level reference for everything below is `docs/motion-engineering.md` —
read it first. Where this prompt and the code disagree, the code wins; report the discrepancy.

---

## 0 · Ground rules

1. The site's product is the person. Voice, positioning and every line of copy come from the
   existing repo.
2. Keep it simple. One column. No admin, no login, no framework features you can't defend in
   one sentence.
3. Deploy to Vercel from `main` via PR.
4. A content edit means editing **one content file** — never HTML surgery, never regex patching.
5. Every derived string (counts, orbit membership, chapter work-logs, worklist rows) is
   computed at build time from the content collection — never hand-written in two places.
6. **Motion is a deliverable, not a decoration.** The system in §5 is binding: port the
   *behavior* exactly (the feel is approved), the code shape may change with the stack.
7. Preserve all design/motion decisions in §4 and §9. They are client-approved, not suggestions.

## 1 · Where the truth is (read these first)

- `docs/motion-engineering.md` — the constant-level spec of the motion system (all numbers).
- `src/index.html` — full markup spec: every section, chapter, kicker, worklist row, HUD string.
- `src/css/*.css` — the design system. Start with `00-tokens.css`.
- `src/motion.js` — the orbit engine. Port it, don't rewrite it.
- `src/main.js` — the single loop, HUD, reveals, depth, cursor.
- `src/fluid.js` — the WebGL cursor fluid, with its current config.
- `src/pieces/*.html` — 41 fragments: the full real copy of every piece. This is the content.
- `src/data/pieces.json` — current orbit config (ids, rings, k-strings, captions, assets).
- `index.dev.html` — the readable inlined build; a single-file reference of the shipped site.
- `tools/pull_creatives.py` — Drive→4K→webp pipeline; all Drive IDs live here.
- `assets/` — artwork (2560 px webp q80), films, fonts.

### 1.1 · External references (the pages the build uses)

**Ground truth (check against these, not memory)**

- Live site (the current deployed build — side-by-side parity reference):
  https://creative-portfolio-two-omega.vercel.app
- This repo: https://github.com/avoidbhi/creative-portfolio

**Stack**

- Astro — https://docs.astro.build/en/
  - Islands architecture (the two heavy islands: `<Orbit />`, `<Fluid />`):
    https://docs.astro.build/en/concepts/islands/
  - Content collections (loaders + Zod schemas for pieces/chapters):
    https://docs.astro.build/en/guides/content-collections/
  - File-based routing + `getStaticPaths()` (the 41 piece pages):
    https://docs.astro.build/en/guides/routing/
  - MDX (the piece/chapter bodies + the `Line`/`Items`/`Note` component vocabulary):
    https://docs.astro.build/en/guides/mdx/
  - Deploying a static Astro site to Vercel (no adapter needed for static output):
    https://docs.astro.build/en/guides/deploy/vercel/
  - `@astrojs/vercel` adapter — **only** if a Vercel service (image optimization,
    analytics) is actually used:
    https://docs.astro.build/en/guides/integrations-guide/vercel/
- Zod (frontmatter validation, so "edit one file" is enforced by the build):
  https://zod.dev/
- Vercel — Astro guide: https://vercel.com/docs/astro · project configuration
  (headers / cache rules for fonts + webp): https://vercel.com/docs/project-configuration
  · preview deployments per PR:
  https://vercel.com/docs/concepts/deployments/preview-deployments
- GitHub Actions (wire `npm run check` as a pre-push gate):
  https://docs.github.com/en/actions
- Lighthouse (acceptance: Performance ≥ 90):
  https://developer.chrome.com/docs/lighthouse/overview/

**Motion system — the Web APIs the engine is built on (MDN is the behavior spec;
the repo code is the executable spec — if the two disagree, the code wins)**

- `requestAnimationFrame` (the one clock):
  https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- `IntersectionObserver` (chapter `active`, reveal-once, tour pause):
  https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver
- `ResizeObserver` (solve on resize):
  https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
- Pointer Events (hold / drag / capture / click-suppression vocabulary):
  https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- `prefers-reduced-motion` (the designed degrade):
  https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- Canvas 2D (constellation / ink-rewind mutations):
  https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
- Web Audio API (the opt-in sound mutation only):
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- WebGL fluid — the reference implementation this repo's `src/fluid.js` descends
  from (stable fluids: semi-Lagrangian advection, Jacobi pressure iteration):
  https://github.com/PavelDoGreat/WebGL-Fluid-Simulation

**Assets & type**

- WebP (the artwork format, ≤ 2560 px q80):
  https://developers.google.com/speed/webp
- `sharp` (only if the Drive pipeline moves from Python/PIL to Node):
  https://sharp.pixelplumbing.com
- Fonts — self-host woff2, no CDN:
  Instrument Serif https://fonts.google.com/specimen/Instrument+Serif ·
  Instrument Sans https://fonts.google.com/specimen/Instrument+Sans ·
  JetBrains Mono https://fonts.google.com/specimen/JetBrains+Mono ·
  npm packages (easiest self-hosting): https://fontsource.org/fonts/instrument-serif ,
  https://fontsource.org/fonts/instrument-sans ,
  https://fontsource.org/fonts/jetbrains-mono

**Rule:** these are the only external runtime dependencies: nothing. No GSAP, no
Three.js, no animation libraries, no font CDNs — everything in §4 is raw Web APIs.
If the sandbox network blocks a page, treat the repo's own code
(`src/motion.js`, `src/main.js`, `src/fluid.js`) as the authoritative spec and
record the gap in `REBUILD-NOTES.md`.

## 2 · What the site is (structure & content spec)

**Opening:** full-viewport dark stage. A ring of work-cards orbits slowly; auto-tour: opens on
orbit, 10 s → grid 5 s → scatter 5 s → orbit, on the loop; the user can drag, switch modes
(SCATTER / GRID / ORBIT buttons), focus a card. Center: "The audience wrote the brief. /
*I write the line.*" (serif; second line red italic). Cursor-following WebGL fluid trail.
Footer HUD: name + COPYWRITER, INDEX, SAY HELLO; EMAIL / CALL / ABOUT; "NN% READ" progress.

**Cards:** 41 pieces. Inner ring 14 (6 Surf Excel slides, 8 GoBoult slides); outer ring 27
(10 Bajaj stills, 2 Bajaj films, 3 creator scripts, 3 side projects, Luna ×5, KokoonLabs,
LumiCell, Bajaj Safe-to-touch, Bajaj NYE film). Each card: plate/film, mono `data-k` label
(grammar `Client × Zoo Media · scope, detail · year`), mono caption. Focusing a card opens its
piece page ("Read the piece →"); the piece page links back to its chapter.

**Below the stage:** home/intro → `#work` worklist (six major briefs, stills) → notes → ping →
nine chapters + epilogue: 01 The brief before the brief · 02 The first build (ICC Champions
Trophy 2025) · 03 Surf Excel · 04 GoBoult · 05 DHL × Mumbai Indians · 06 ICC Women's World Cup
· 07 The hook lab · 08 Bajaj Electricals (incl. side-quests) · 09 How I work · epilogue.
Case chapters carry: meta, prose, results, the red-pen "Could have said → said" decision
component, artifacts, an orbit-link, and a **dated work-log** (year · caption · "the piece →"
per piece of that chapter). Chapters with zero pieces carry no log. No fabrication.

**Piece pages:** one per piece (41). Kicker, serif title (the piece's line from its caption),
plate or film, the **full real copy**, then links: back to orbit, down to chapter, email.

## 3 · Design system — binding, port the values exactly

- Palette: `--ink #000000` (only background) · `--graphite #0B0B0D` · `--paper #F6F6F4`
  (text) · `--red #FF3B30` (the red pen — the only accent) · `#FFF` where a surface needs one.
- Type: Instrument Serif (display/quotes) · Instrument Sans (body) · JetBrains Mono (labels).
  Self-hosted woff2.
- Scale: 7.2 rem display · 6.6 rem hero / 6.4 rem static stage · 5.4 rem epilogue mail ·
  3.6 rem home display · 2.6–2.8 rem list rows.
- One column: 76 rem, max 1480 px; hairline chapter separations; one 8 px spacing scale.
- Kicker grammar `NN / name · year`. Easings: `--ease-out cubic-bezier(.16,1,.3,1)`,
  `--ease-inout cubic-bezier(.7,0,.2,1)`, `--ease-in cubic-bezier(.6,0,.9,.4)`.

## 4 · The motion system — how everything moves (binding behavior spec)

Port this system as the stage's client island. The **DOM contract is part of the spec**: the
engine reads `[data-stage]`, `[data-stage-space]`, `[data-stage-card]` (with `data-ring`,
`data-card-id`, `data-k`, `data-href`), the mode buttons `[data-stage-mode]`, the caption line
`[data-stage-k/q]`, the "read" link `[data-stage-more]`, the title `.stage__title`, the HUD
`.stage__hud`. Keep those names and the engine ports almost unmodified.

### 4.1 The seven laws (never break any of these)

1. **One clock, one writer.** A single rAF loop drives everything continuous. The scene's
   step is the only code that writes a card's transform/opacity, the camera and the title.
   No tweens, no CSS transitions on cards, no per-component rAFs.
2. **A pose is a pure function of (i, S).** Poses read no DOM, write nothing, and can be
   evaluated for any time — that is what makes arrangements swappable.
3. **Layout changes are journeys.** On any re-arrangement, each card's *current* pose is
   snapshotted and blended toward the **live** destination pose with a per-card stagger and
   one ease. The destination keeps moving while the card travels into it — cards land in
   slots that are already turning. Same DOM element throughout: identity is physical.
4. **A mass layer gives everything inertia.** After pose + journey, every channel relaxes:
   `cur += (pose − cur)·(1 − e^(−dt·24))`. Drag, hover, focus, resize all pass through it —
   the scene arrives at states, never snaps.
5. **Scroll influences, never controls.** Native scroll untouched. Smoothed scroll + velocity
   only modulate rotation rate (`1 + 1.4·min(|v|/1200, 1)`) and the camera (pulled back and
   over as the stage leaves — the hero hands over to the chapters as one space).
6. **Enter = ease-out, exit = ease-in; nothing high-frequency animates.** Arrivals
   `expo.out` (`1 − 2^(−10t)`), on-screen moves `power3.inOut`. The only continuous motion is
   the slow constant-rate rotation and the fluid under a recently-moved pointer. Idle is still.
7. **Degrade is designed.** No JS → captioned grid. Reduced motion at load → scene never
   boots. Reduced motion mid-session → full `destroy()` (every listener, class and style
   write unwound). Any error in the scene tick → `destroy()`. Any page error → a `reveal-all`
   class forces every reveal visible. The page is never left half-animated or hidden.

### 4.2 The state and the cast

One scene state `S`: `mode`, `scrollProgress/scrollVelocity` (smoothed), `orbitRotation` /
`drumRotation` (**unbounded degrees, never wrapped, never reset**), smoothed rates + decaying
drag impulses, `focused / hovered / hold / dragging`, `active` (stage on screen — off-screen:
no rotation, no writes), `live` (booted), camera current/target, cursor-parallax target, `dim`,
`titleO`. At boot the engine reads once: each card's aspect (sets `--ar`), film-or-static,
caption, `data-k`, `data-href`, and the stagger order `(i·7) mod n` — identical every load, so
the choreography is reproducible. Expose a read-only QA handle (`AK_SCENE`: state,
`setMode/open/close/measure`, card list) for scripted verification.

### 4.3 Pattern — ORBIT

Two counter-turning flat rings in the screen plane (inner 14 / outer 27, per `data-ring`).
Per resize: outer radius `R = min(W/2−10, room/2, 600)`; card scales iterated 4× until total
card width fills 86 % of the circumference (wide cards take more degrees — base angle
∝ card width); inner ring at 0.6 factor with its own fit and a ≥ 10 px gap. Pose: `z = 0`,
card rotation keeps each card **tangent to the ring** (readable at all times); outer scale
0.6, inner 0.5. The inner ring **counter-turns at 1.35×** — two rings sliding past each other
read as depth with zero z. Rate: outer one turn ≈ 64 s, smoothed (`1 − e^(−7dt)`), held to 0
while hovering the ring band / dragging / focused. The headline lives in the inner ring's hole:
measured per resize and scaled down (`--title-fit`, floor 0.42) until the farthest glyph
clears the hole; ≤ 600 px the headline stacks above the rings full-size. Title wanted (visible)
only in orbit mode with nothing focused; chased opacity, never a hard toggle.

### 4.4 Pattern — SCATTER (the drum)

A **screw**: all cards on a helix around a vertical axis. Rotating a helix *is* translating it,
so the rotation carries cards along the axis — the collection flows through the room and wraps
at invisible ends (helix ≈ 3× room height). **5 cards per 360°** (laptop and phone). Every card
scaled to one common visual area (the median card's) but never taller than the median card
(a 9:16 film at equal area is ⅓ taller and must not set the pitch). Deterministic per-card
jitter (integer-hash derived: vertical ±15 % of pitch, radial ±6 %) — "a desk, not a lattice",
identical every load. Desktop: wide shallow ellipse (depth = 0.55 × width); phone: round drum
(0.44 W). Pose: `u = (i + rotation/step) mod n` in card slots; position on the ellipse; card
rotation **tangent** (face-on up front, edge-on at the sides — it reads as a solid object);
opacity = near-side lighting (far half almost dark) × end fades × soft vertical clip at the
HUD/foot (gone once ⅔ is out of the room). **Wrap teleport:** when a card's destination jumps
a whole helix height, snap its *current* pose (it was at an invisible end) or re-time an
in-flight journey — no visible jump, ever. Rate: one turn ≈ 18 s (every piece passes the front
once in ~90 s); a hovered drum **slows to 0.12×, never freezes**. Camera sits 5° above.
Front card ≈ 40 % of room height (phone: approved size, perspective-corrected).

**The spacing solver (per resize only, ~30–50 ms):** for each vertical pitch from tight to
loose, find the narrowest drum radius whose *lit* cards never touch at any angle; keep the
tightest safe pitch. Every test projects each card's four corners exactly as the browser will
(transform → camera tilt −5° / scroll lean ±3.6° / cursor pan ±6° → perspective 640 px) across
five camera poses. Rules: two lit cards keep 4 px at rest and never intersect under lean,
unless the one behind is a half-lit shoulder card with ≤ 15 % show-through (occlusion, not a
clash); dim cards are free. This is what makes the drum **pack itself for any future set of
work** — 41 cards, 60, or 20.

### 4.5 Pattern — GRID

One flat contact sheet: try 2–10 rows per resize, keep the row count with the largest card
height that fits the room; gap 8–16 px; cards static (`z = 0`, no rotation). The grid is the
*rest* of the scene — its stillness is the point after the drum.

### 4.6 Pattern — FRONT (focus)

The focused card scales to fill ~90 % of the room; its z is set by inverting the perspective
so the scale reads as distance, not zoom. Open: the focused card travels `expo.out` while
every other card travels `power3.inOut` — **one duration (0.9 s), two personalities**. `dim`
chases 1 and the other cards' opacity falls to 0.12 — the room goes dark around one piece.
Caption line becomes the card's `data-k` + caption + "Read the piece →". Films play on focus
(refusing in save-data mode) and pause with the stage's visibility observer. Close: the
returning card goes first (delay 0), others re-stagger; a 0.35 s toggle guard makes a
double-tap one open. `Escape` closes; `Enter`/`Space` opens from the keyboard.

### 4.7 Journeys, the mass layer, one write

Journey per card: snapshot → blend to live destination, `from + (live − from)·ease(u)`,
rotations via shortest-arc (`shortDelta` — cards stay on the same turn). Stagger `(i·7) mod n`:
mode change delays `order·0.022 s` @ 1.15 s; boot `0.15 + order·0.03` @ 1.7 s `expo.out`.
After pose + journey: mass relaxation (k = 24), hover lift (a card rises +40 px z / +3 %
scale under the cursor, chased at k = 9), the far side of the drum flips its face while
edge-on (invisible moment), then **one transform string per card, diffed against the previous
write** — DOM touched only on change, transform + opacity only, **no layout reads in the loop**
(geometry measured on resize).

### 4.8 The camera and the hand-off

Camera = base + cursor parallax, chased at k = 4. Base: as the stage scrolls out (progress
0→1 over ~0.9 viewport heights, smoothstepped) it lies back (+16°) and recedes (−340 px
desktop / −200 phone), plus a velocity lean (±3°). Parallax amplitudes: scatter 6° (2.5°
phone), grid 1.5°, orbit 0° — and **frozen while the pointer is over a card** (what you aim at
stays put).

### 4.9 The tour (the standing opening)

Opens on **orbit** (laptop and phone). Idle 10 s → grid 5 s → scatter 5 s → orbit, looping.
Pauses (timer resets) while: hovering a card/ring band, dragging, focused, tab hidden, stage
> 25 % scrolled away, or page mid-fling (|v| > 80). Any **direct** interaction (mode button,
drag, open, a chapter's orbit-link) kills the tour for the session. The tour's mode changes
are the same journeys a user would trigger — the hand-off is silent.

### 4.10 The pointer vocabulary

- Hover: orbit ring band → rings hold; a card → caption shown + lift (orbit also holds);
  drum → 0.12×.
- Drag: 6 px horizontal threshold, pointer-captured; orbit `rotation += dx·0.22` (±12°/event)
  plus a decaying velocity impulse (`e^(−4.5dt)`) — a flick coasts and dies; scatter same
  (±14°); grid pans. A drag is not a click (8 px / 0.3 s suppression).
- Click: card → open; empty space → close. Touch: finger-down = hold; tap = open.
- Deep links (`data-orbit-open` from chapters): switch to orbit, native smooth scroll, the
  pending card opens once the stage has arrived (|Δy| < 6 px or the fling settled).
- Cursor labels: the stage swaps `drag / turn / read / close` under the pointer; a parked
  pointer re-reads its label on a refresh event (the cursor ring shows the label).

### 4.11 Boot and death

Boot: wait for fonts (measure with real type), place cards at z = −1600 / opacity 0 / scale
×0.6, travel them in with the boot stagger — **the rings assemble out of the dark** — then the
HUD and foot fade in (CSS). Death: `destroy()` (reduced motion toggled, context lost, tick
error) removes every listener/class/style the scene wrote and falls back to the captioned
grid exactly as if JS never ran.

### 4.12 The fluid (the cursor's trail)

A GPU fluid sim (stable fluids: semi-Lagrangian advection + 20-iteration pressure projection)
on the fixed background layer. Per pointer-move: a velocity jet (`dx,dy · SPLAT_FORCE`) and a
gaussian dye splat (radius `SPLAT_RADIUS/100`, aspect-corrected) in the pointer's color
(full spectrum, one color per pointer, swapped at 10 updates/s). The velocity field *carries*
the dye (that is the flow); dye dissipates in ~3 s, velocity dies fast so the flow stays
compact. Post: soft bloom (threshold 0.25, intensity 0.2) + sunrays (0.4); overall brightness
0.05 — a whisper under the type. The opening burst is the same dye at 5.5× once, on load —
the only moment the page glows for itself. Current approved config (the compact wisp):
`SPLAT_RADIUS 0.07 · SPLAT_FORCE 1200 · VELOCITY_DISSIPATION 1.8 · DENSITY_DISSIPATION 2.5 ·
SIM 128 / DYE 512 · MAX_DPR 1 · SLEEP_AFTER 4 s`. All in one config object
(`window.AK_FLUID_CONFIG` may override). Runs only while the pointer has recently moved;
dies on reduced motion.

### 4.13 The chapter grammar (below the fold)

- Reveals: IntersectionObserver (once) toggles a class; CSS moves — `opacity + translateY(26px)
  → in`, 0.9 s ease-out, delayed by `--d`. Specific components bend the rise with their own
  start transforms (manifesto 16 px; the hook-lab rows read in from the left, their red super
  landing 0.22 s after the line).
- **The red pen (`.edit`):** on entering the bottom 75 % of the viewport: the strike lands at
  0.2 s (a drawn line through the "could have said"), the serif "said" inks in at 0.55 s
  (1 s, from `translateY(.18em) scale(.985)`, origin left-bottom — ink pooling from the
  baseline), the red note fades at 1.1 s. **The strike always lands before the correction** —
  CSS timing only, no JS timers.
- Depth layer: `[data-depth]` elements arrive from depth on scroll (translateY + scale
  0.965→1), slow, a few px, off under reduced motion; resting transforms preserved.
- Tilt artifacts: `perspective: 1200px`; the print tracks the cursor at 0.12 s linear while
  touched and settles back over 0.6 s ease-out.
- Cursor: dot 1:1, ring lerps behind (k = 14), scales 1.55 over targets, carries stage labels;
  fine pointers only.
- HUD: progress bar `scaleX`, "NN% READ", chapter label — all from the single loop.
- The manifesto's emphasized word is the single permitted overshoot in the whole system:
  `cubic-bezier(.34, 1.56, .64, 1)`, delayed +0.32 s — the shout lands late and heavier than
  its question.

---

## 5 · The mutation catalog — extraordinary moves, ready to mutate in

A **pattern** in this system is exactly: a pure `pose(i, S, out)` + a per-resize `solve()` +
one registry line (+ optional rate, camera contribution, parallax amplitude, cursor label,
KLINE string). Journeys, the mass layer, drag + impulse, focus, dim, the tour, deep links,
boot, destroy, the QA handle and every degrade path are pattern-agnostic — a new arrangement
inherits all of them. Cost model: poses are O(n) per frame (n = 41 — cheap); solvers may be
O(n²·phases) because they run per resize only.

**You will implement exactly three of the following as first-class, behind config flags
(default ON), each degrading cleanly under reduced motion and no-JS, and each documented in a
code comment.** Prefer one arrangement (A) + two behaviors (B). Do not implement more than
three in the rebuild — the catalog exists to be picked from, not exhausted.

**A · New arrangements (one pose function each)**
1. **MANUSCRIPT** — the ring becomes a letterpress page: one vertical column of "lines",
   each card a typeset line, x-jittered by the hash, the column driven by the stage's scroll
   progress (law 5 intact). The orbit stops turning and starts *reading*. Cost: trivial.
2. **HELIX PAIR** — the inner/outer rings as two counter-rotating helix strands (drum math,
   two strands, phase-offset 180°); thin red lines on a 2D canvas behind the cards connect
   the strands — the two kinds of work as one molecule. Cost: low.
3. **THE DESK** — top-down flat-lay: prints at hand-laid or golden-angle positions, rotation
   from the hash (±4°), drag = pan the desk (camera translate), focus = the print lifts
   (existing front pose + a shadow). Reuse the drum's non-overlap math in 2D. Cost: low.
4. **CONSTELLATION** — a star field: cards at hash positions scaled by year, opacity
   breathing at 6 s offsets; on focus the red pen draws the piece's constellation (SVG path,
   inked 0.8 s, erased in reverse on close). Cost: low-mid.
5. **ECLIPSE** — a focus variant: the camera pushes *through* the focused card's slot (the
   card holds position; the title goes dark behind it). The work is in front of the name, not
   replacing it. Cost: a camera curve.
6. **ZINE** — the grid as filmstrip: sprocket holes, 3:2-cropped cards, the sheet flickable
   in page-width increments (the existing pan, plus snapping). Cost: low.
7. **GLYPH FORM** — the endgame beat: cards travel to glyph positions and *become* the
   current headline text (glyph targets measured on canvas, once per text). Scope it as the
   closing beat of one chapter, not a mode. Cost: highest on the list.

**B · Behavior mutations (each touches one existing layer)**
8. **BREATHING** — idle stage breathes: ring radius `R·(1 + 0.02·sin(2πt/6))`, drum pitch
   `dy·(1 + 0.015·sin(2πt/6 + 1))`. Six-second period, sub-2 % amplitude — below
   perception-as-motion, above perception-as-still. One line per pose.
9. **WORD-SYNC CAPTION** — while a card is focused, its caption types out word-by-word
   (90 ms cadence from the existing loop, no timers); the last word underlined in red by the
   pen. The stage reads the piece before you do.
10. **YEAR DIAL** — a mono dial at the stage's rim turns with the ring; each card's year
    lights on the dial as the card passes the front (compare pose angle to the front angle —
    the math already exists). 2025–26 becomes a mechanism you can see turning.
11. **INK REWIND** — on close, one texture readback of the last dye frame is composited as a
    thin red scribble that draws itself down the stage (0.5 s) and fades (0.8 s) — the pen
    signs the piece as you leave it.
12. **PAPER STOCKS IN MOTION** — the four named stocks shift per chapter as static texture
    swaps (≤ 0.4 s ease-out crossfade max) — the material of the room changes with the room.
13. **SCROLL-TIED RING** — within the stage section, ring rotation maps to scroll position
    (smoothed, holds intact) — the reader turns the ring by scrolling, like a record. The
    strongest mutation of law 5; test the fling case.
14. **TALKING HEAD** — in the hook-lab chapter the drum's front slot becomes a 9:16 phone
    frame with the script's hook typed under it — the scripts orbit as the videos they became.
15. **SOUND (off by default)** — an 80 ms filtered-noise breath on mode changes and opens
    (WebAudio, synthesized, no assets), only after the first gesture, HUD-mutable, mentioned
    in the epilogue. Opt-in only, never default.

**Guardrails for every mutation:** it must keep the seven laws intact (one writer, pure poses,
no CSS transitions on cards, enter ease-out / exit ease-in, nothing high-frequency, red the
only accent, designed degrade), it must not add a second animation clock, and it must pass
the QA checklist in §7.

---

## 6 · Architecture (the "better way")

**Astro, static output, Vercel adapter.** A content site with two heavy interactive islands:
Astro ships zero JS by default, gives real routes for 41 piece pages, and content collections
with Zod schemas make the "edit one file" rule enforced by the build.

- `content/pieces/*.mdx` — one per piece (41). Frontmatter: `id, ring (in|out), kind
  (static|film), src, poster?, w, h, client, scope, year, chapter (ch1–ch9|side), alt, cap,
  aria?`. Body: full copy as MDX with a small component vocabulary (`Line` big serif line,
  `Items` hook lists, `Note` mono meta, blockquotes).
- `content/chapters/*.mdx` — one per chapter (9 + epilogue): `no, title, year, pieces:`
  (explicit piece ids for the work-log; empty = no log).
- `src/data/site.json` — name, role, email, city, tagline, tour config, **and the stage/fluid
  config objects (rates, dwells, gaps, amplitudes, the three mutation flags)** — all tuning
  is data, overridable at runtime as today.
- Routes: `/` (stage + chapters) and `/pieces/[id]` (`getStaticPaths` from the collection).
- Islands: `<Orbit />` (the ported engine — cards rendered server-side from the collection,
  DOM contract per §4), `<Fluid />` (the ported sim behind the stage canvas), plus small
  vanilla modules (cursor, reveals, progress). Nothing else is client JS.
- **Delete, deliberately:** the 4.7 MB standalone data-URI build (Vercel serves assets with
  immutable cache headers), marker-comment injection, count-regex patching, the custom Python
  preview server (`npm run dev` is the preview).
- **Keep:** `tools/pull_creatives.py` (Drive → 4K → 2560 px webp q80), repointed so its wire
  step writes into the content world: update piece frontmatter (`src, w, h`) for replaces,
  create `content/pieces/<id>.mdx` for adds, then `npm run build`. Idempotent, `--dry-run`,
  `--wire-only`.
- Scripts: `npm run dev` · `npm run build` · `npm run check` (= schema validation +
  counts-consistency + dead-link scan + "every piece has a page, asset, year, caption" +
  two consecutive builds byte-identical).

## 7 · Acceptance criteria

1. `npm run build` idempotent (byte-identical twice); `npm run check` passes, wired pre-push.
2. All 41 pieces: correct ring/year/caption in the orbit; `/pieces/<id>` with full real copy
   and asset; linked from orbit card and chapter work-log.
3. Counts in exactly one computed place; every visible count matches.
4. Verbatim copy parity with `index.dev.html` for all chapters, HUD, worklist, epilogue
   (diff the text, not the markup).
5. **Motion parity:** the 12-shot checklist — 390 / 768 / 1440 px × {orbit, scatter, grid,
   focused card} — visually indistinguishable from the current build (the mutations you
   enabled are the only allowed deltas, and each is documented). The QA handle drives
   `setMode/open/close` programmatically; assert: no opacity > 1, no writes while the stage
   is off-screen, the drum's wrap teleport never visible (jumps only at opacity < 0.05),
   the tour pauses and dies exactly as in §4.9, reduced-motion kills the scene and reveals
   everything.
6. Orbit: three modes, tour 10/5/5, drag + keyboard + touch, card → piece page; media lazy
   with width/height (zero CLS); orbit is the opening on phones too.
7. Fluid matches the approved compact config; reduced motion disables it and the tour.
8. Lighthouse on `/` and a piece page: Performance ≥ 90; only the two fonts render-block;
   images ≤ 2560 px webp.
9. One-file content edit: change a caption → build → orbit card, work-log, piece page and
   counts all update; nothing else touched.
10. Vercel: preview per PR, production from main. README clean: one paragraph, the scripts,
    the content-edit flow.

## 8 · Execution order (do not skip)

1. **Inventory:** read §1 files + `docs/motion-engineering.md` completely; write
   `REBUILD-NOTES.md` (untracked) listing every section, string, token, behavior and motion
   constant you found — your parity checklist.
2. Scaffold Astro + tokens/base CSS (port token values verbatim) + layout + fonts.
3. Content collections + Zod schemas; migrate all 41 pieces and 9 chapters (copy verbatim).
4. **The stage island:** port the scene engine (DOM contract per §4) + the full pattern set
   (orbit/drum/grid/front, journeys, mass, camera, tour, pointer vocabulary, boot, destroy,
   QA handle) + the fluid island. Verify motion parity on the 12-shot checklist *before*
   building the rest of the page.
5. Components: HUD, Chapter/CaseChapter, red-pen `Edit`, Caselog, Worklist, PiecePage,
   reveals/depth/tilt/cursor/progress modules.
6. **Pick and implement your three mutations** (§5), each flagged and documented.
7. Repoint `pull_creatives.py`; write `npm run check`.
8. Vercel config; open a PR; run §7 end-to-end; side-by-side against the current
   `index.dev.html`; fix every unexplained difference.

## 9 · Do not touch (client-approved)

Type scale and tokens in §3 · the seven laws in §4.1 · orbit-as-opening on laptop **and**
phone · the 10/5/5 tour · 64 s ring / 18 s drum / 5 cards per turn / 4 px drum gap ·
clean single column · the red pen as the only accent · the pen's grammar (strike before
correction) · the "research first. Then the sentence." voice · no invented dates or process
(Bajaj 2025, KokoonLabs 2026, LumiCell 2025, NYC 2026, Luna 2025) · deploy via PR ·
README clean · the fluid's approved compact config.

*The system's single sentence — the rebuild must keep it true: the same forty-one objects,
always; the only thing that changes is the law that places them, and every law hands every
object back to the next law without dropping it. A mutation is allowed to be a new law. It
must never be a second system.*
