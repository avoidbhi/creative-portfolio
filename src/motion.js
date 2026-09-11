/* ─────────────────────────────────────────────────────────────
   ABHIJEET KANASE — THE SCENE (v7)
   One continuous 3D environment for every piece of work, modelled on
   Andrianjaka Tony's "Portfolio Homepage Layout" (recent.design/i/75uqgzu):

     ORBIT   a flat ring turning in the screen plane (two counter-turning rings here)
     SCATTER the same cards on a turning helix drum — a true 3D carousel:
             tangent to the cylinder, near = large & bright, far = small & dim,
             edge-on at the sides, overlap allowed, infinite rotation
     GRID    the same cards as one flat sheet

   ARCHITECTURE
   · sceneState (S) is the single source of truth: scrollProgress, scrollVelocity,
     orbitRotation, drumRotation (both unbounded degrees, += rate·dt — never reset),
     carouselProgress, layoutProgress, camera, focus, hover, drag.
   · Every card pose is a pure function of (i, S, t): poseRing / poseDrum / poseGrid /
     poseFront. Layout changes are "journeys": the card's current pose is snapshotted and
     blended toward the LIVE destination pose with a per-card stagger and an ease, so the
     same DOM element physically travels from one arrangement into the next (identity kept)
     while the destination keeps turning. A mass layer (cur += (pose − cur)·k) then gives
     everything acceleration and settle — drag, hover, focus, resize all pass through it.
   · ONE writer: render() is the only code that touches a card's transform/opacity, the
     camera (.stage__space) and the title. No tweens, no CSS transitions on cards, no
     ScrollTrigger. It runs inside main.js's single requestAnimationFrame loop (AK.loop).
   · Scroll INFLUENCES, never controls: native scrolling is untouched; the smoothed scroll
     value and velocity from main.js modulate rotation rate and pull the camera back and
     over as the stage leaves, so the hero hands over to the chapters as one space.
   · GPU only (transform + opacity), no layout reads in the loop (measured on resize),
     will-change only on the moving layers.
   Without JS / with scripts blocked / under reduced motion the markup is a captioned grid.
   ───────────────────────────────────────────────────────────── */
(() => {
  'use strict';
  const html = document.documentElement;
  const stage = document.querySelector('[data-stage]');
  if (!stage) return;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMQ.matches) { html.classList.add('no-scene'); return; }          // orbit stopped, 3D off, everything visible

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const shortDelta = (d) => ((d % 360) + 540) % 360 - 180;
  const DEG = Math.PI / 180;
  const easeInOut = (t) => (t >= 1 ? 1 : t <= 0 ? 0 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // power3.inOut — on-screen moves
  const easeOut = (t) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(2, -10 * t));                                         // expo.out — arrivals

  /* main.js provides the loop + scroll state; if it ever failed, run a minimal one so the scene still works */
  const AK = window.AK || (() => {
    const fns = new Set(), scroll = { y: scrollY, smooth: scrollY, velocity: 0, energy: 0, vh: innerHeight, vw: innerWidth };
    let last = performance.now();
    const frame = (now) => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05); last = now;
      const y = scrollY, v = (y - scroll.y) / dt; scroll.y = y;
      scroll.smooth += (y - scroll.smooth) * (1 - Math.exp(-dt * 16));
      scroll.velocity += (v - scroll.velocity) * (1 - Math.exp(-dt * 7));
      scroll.vh = innerHeight; scroll.vw = innerWidth;
      fns.forEach((fn) => fn(dt, now / 1000)); requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return { loop: { add: (f) => fns.add(f), remove: (f) => fns.delete(f) }, scroll, measure() {}, finePointer: matchMedia('(hover: hover) and (pointer: fine)').matches, docTop: (el) => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; } };
  })();

  /* ── the cast ── */
  const space = $('[data-stage-space]', stage);
  const cards = $$('[data-stage-card]', stage);
  const buttons = $$('[data-stage-mode]', stage);
  const lineK = $('[data-stage-k]', stage), lineQ = $('[data-stage-q]', stage), more = $('[data-stage-more]', stage);
  const hud = $('.stage__hud', stage), title = $('.stage__title', stage);
  const fine = AK.finePointer;
  const n = cards.length;
  if (!n || !space) return;
  const P = 640;                                                          // must match .stage.is-3d perspective — short lens: near ≈ 2.3× far on the drum, like the reference
  const ringOf = cards.map((c) => (c.parentElement.dataset.ring === 'in' ? 0 : 1));
  const idxIn = [], idxOut = [];
  cards.forEach((c, i) => (ringOf[i] ? idxOut : idxIn).push(i));
  const media = cards.map((c) => $('img, video', c));
  const isFilm = cards.map((c) => c.classList.contains('stage__card--film'));
  const ar = cards.map((c, i) => { const m = media[i]; const w = +m.getAttribute('width') || 4, h = +m.getAttribute('height') || 5; return h / w; });
  cards.forEach((c, i) => { c.style.setProperty('--ar', ar[i].toFixed(4)); if (ar[i] < 1) c.classList.add('stage__card--wide'); });
  const captions = cards.map((c) => ($('figcaption', c) || {}).textContent || '');
  const kinds = cards.map((c) => c.dataset.k || '');
  const hrefs = cards.map((c) => c.dataset.href || '#ch1');
  const KLINE = { scatter: 'Scatter — the desk, turning', grid: 'Grid — the year as one contact sheet', orbit: '34 pieces of work, 2025–26' };
  const order = cards.map((_, i) => (i * 7) % n);                       // stable pseudo-random stagger order

  /* ── sceneState — the single source of truth ── */
  const S = {
    mode: 'orbit', prevMode: null,
    scrollProgress: 0, scrollVelocity: 0,                                 // the stage's own scroll-out (0 = at the top, 1 = gone) · px/s
    orbitRotation: 0, drumRotation: 0,                                    // degrees, unbounded — never wrapped, never reset
    get carouselProgress() { return this.drumRotation / 360; },
    layoutProgress: 1,                                                    // 0…1 of the current layout journey
    ringRate: 0, drumRate: 0, ringVel: 0, drumVel: 0,                     // °/s (smoothed) · drag impulses (°/frame, decaying)
    focused: -1, hovered: -1, hold: false, touchHold: false, dragging: false, active: true, live: false,
    cam: { rx: 0, ry: 0, z: 0 }, camT: { rx: 0, ry: 0, z: 0 }, ptr: { x: 0, y: 0 },   // camera (current / target) · cursor parallax target
    dim: 0, titleO: 0, idle: 0,
  };
  const RING_RATE = 360 / 64;                                             // outer ring: one turn ≈ 64 s (inner counter-turns ×1.35)
  const DRUM_RATE = 360 / 18;                                             // the drum: one turn ≈ 18 s (every piece passes the front once in ~90 s) — near cards travel right and sink, like a screw

  /* ── geometry: measured on resize only (no layout reads inside the loop) ── */
  let W = 0, H = 0, CY = 0, cw = [], ch = [], roomTop = 0, roomBottom = 0, stageTop = 0, mobile = false, stacked = false;   // stacked: the headline sits above the rings (CSS @media (max-width: 600px) — inclusive, so ≤ 600)
  const ring = { rOut: 0, sOut: 0, rIn: 0, sIn: 0, base: new Array(n).fill(0), inner: 0, outer: 0 };
  const drum = { Rx: 0, Rz: 0, zoff: 0.2, s: 0.95, sc: new Array(n).fill(1), jy: new Array(n).fill(0), jr: new Array(n).fill(1), dy: 0, step: 0, total: 0, mid: 0, top: 0, bottom: 0, fade: 90 };
  const grid = cards.map(() => ({ x: 0, y: 0, s: 1 }));
  function measure() {
    W = stage.clientWidth; H = stage.clientHeight; mobile = W < 700; stacked = W <= 600;
    cw = cards.map((c) => c.offsetWidth); ch = cards.map((c) => c.offsetHeight);
    /* the arrangement switch is docked at the BOTTOM of the scene now (below the rings, above the
       caption band), so the top band is just breathing room and the bottom band is measured from the
       mode row down. In the stacked (≤600px) layout the headline sits above the rings and reserves its own height. */
    const band = stacked ? 118 : 108;                                                          // the caption band, as before
    const hudTop = hud ? hud.getBoundingClientRect().top - stage.getBoundingClientRect().top : H - band;
    const above = stacked ? title.offsetTop + title.offsetHeight + 10 : 20;
    const below = Math.max(band, H - hudTop + 12);                                             // everything the mode row + foot occupy
    CY = above + (H - above - below) / 2;                                 // the scene's centre, in stage px
    roomTop = above - CY; roomBottom = H - below - CY;                    // the room, relative to that centre
    stage.style.setProperty('--cy', CY.toFixed(1) + 'px');
    stageTop = AK.docTop(stage);
    solveRing(); solveDrum(); solveGrid();
    fitTitle();
  }
  /* the headline lives in the hole of the inner ring. Its CSS size follows the viewport WIDTH (3.4vw); the hole follows
     the room HEIGHT — on 16:9 laptops the words outgrow the hole and the inner cards sweep across them. So: measure the
     headline at its CSS size (once per resize, mobile excluded — there it sits above the rings) and scale it down until
     its corners clear the hole, with the same headroom the cards keep. One CSS variable; the loop still only writes opacity. */
  function fitTitle() {
    stage.style.removeProperty('--title-fit');
    if (stacked) return;
    const r = title.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const half = Math.hypot(r.width, r.height) / 2;                        // the farthest glyph from the centre, at scale 1
    const hole = ring.inner - 8;                                           // ring.inner already keeps 6 px from the innermost card edge
    const fit = clamp(hole / half, 0.55, 1);
    if (fit < 0.995) stage.style.setProperty('--title-fit', fit.toFixed(3));
  }
  const sumW = (idx) => idx.reduce((a, i) => a + cw[i], 0);
  const maxH = (idx) => Math.max(...idx.map((i) => ch[i]));
  function solveRing() {
    const R = Math.min(W / 2 - (stacked ? 4 : 10), (roomBottom - roomTop) / 2, 600);
    const FILL = 0.86;
    const scaleFor = (idx, r, sMax) => Math.min(sMax, 2 * Math.PI * r * FILL / sumW(idx));
    let rOut = R * 0.9, sOut = 0.6;
    for (let k = 0; k < 4; k++) { sOut = scaleFor(idxOut, rOut, 0.6); rOut = R - sOut * maxH(idxOut) / 2; }
    let rIn = rOut * 0.6, sIn = 0.5;
    for (let k = 0; k < 4; k++) { sIn = scaleFor(idxIn, rIn, 0.5); rIn = rOut - sOut * maxH(idxOut) / 2 - sIn * maxH(idxIn) / 2 - Math.max(10, R * 0.04); }
    const place = (idx, offset) => { const total = sumW(idx); let acc = 0; idx.forEach((i) => { ring.base[i] = ((acc + cw[i] / 2) / total) * 360 + offset; acc += cw[i]; }); };
    place(idxOut, -90); place(idxIn, -90 + 360 / idxIn.length / 2);
    Object.assign(ring, { rOut, sOut, rIn, sIn, inner: rIn - sIn * maxH(idxIn) / 2 - 6, outer: rOut + sOut * maxH(idxOut) / 2 + 6 });
  }
  function solveDrum() {
    // a screw: n cards on a helix around a vertical axis. Turning the drum also carries the cards along the axis
    // (a helix rotated = a helix translated), so the whole collection flows through the room and wraps where
    // nobody can see it — the helix is ~3× taller than the room. Near side big and bright, far side small and dim.
    // Desktop: the drum is a wide, shallow ellipse (Rz ≈ 55 % of Rx) so the near arc spreads across the middle of
    // the screen instead of stacking in a column, and every card is scaled to ONE common area (a 16:9 plate and a
    // 9:16 film take the same room). v8.3: the spacing PACKS ITSELF (see drumPack) — as close as this card set
    // allows on this screen, on both axes, with no two lit cards ever touching, and it re-solves for any new set of work.
    const room = roomBottom - roomTop, midY = (roomTop + roomBottom) / 2;
    const perTurn = mobile ? 5 : 6.5;                                                 // cards per turn: a fractional count keeps successive turns from lining up in columns
    const aRef = cards.map((_, i) => cw[i] * ch[i]).sort((a, b) => a - b)[n >> 1];    // the reference area: the median card (a 4:5 static)
    const kFront = P / (P - (1 - 0.2) * W * 0.44);                                   // phone: how much the perspective magnifies the front card (its z = (1 − zoff)·R)
    const s = mobile ? 1.15 / kFront : clamp(room / 1080 * 1.25, 0.6, 0.85);         // common size, from the room height: the front card ≈ 40 % of the room tall, like the reference; the phone keeps its approved front-card size now that depth is real
    const hRef = ch.slice().sort((a, b) => a - b)[n >> 1] * s;                          // the median card's height at the common size
    const h1s = [], h2s = [];
    for (let i = 0; i < n; i++) {
      drum.sc[i] = mobile ? s : Math.min(s * Math.sqrt(aRef / (cw[i] * ch[i])), hRef / ch[i]);   // …but no card taller than the median one: a 9:16 film at equal area is ⅓ taller and was setting the vertical pitch for everyone
      h1s[i] = ((i * 2654435761) >>> 0) % 1000 / 1000; h2s[i] = ((i * 40503 + 7) * 2246822519 >>> 0) % 1000 / 1000;   // deterministic per-card offsets (a desk, not a lattice)
      drum.jr[i] = mobile ? 1 : 1 + (h2s[i] - 0.5) * 0.12;
    }
    const apply = (Rx, dy) => {
      for (let i = 0; i < n; i++) drum.jy[i] = mobile ? 0 : (h1s[i] - 0.5) * 0.3 * dy;
      Object.assign(drum, { Rx, Rz: mobile ? Rx : Rx * 0.55, zoff: mobile ? 0.2 : 0.35, s, dy, step: 360 / perTurn, total: n * dy, mid: midY, top: roomTop, bottom: roomBottom, fade: mobile ? 60 : 90 });
    };
    if (mobile) {                                                                     // the round phone drum (approved as is): same radius, size and turn; only its pitch is checked
      const Rx = W * 0.44, dy0 = clamp(room / 16, 36, 64); let dy = dy0;
      apply(Rx, dy);
      while (dy < room / 8 && drumTouches()) { dy = Math.min(room / 8, dy * 1.05); apply(Rx, dy); }   // now that the cards really come forward (v8.3), the front ones are a fifth bigger — open the pitch just enough
      return;
    }
    drumPack(apply, room);
  }
  /* ── the drum's spacing solver (v8.3) ──
     For each vertical pitch, tight → loose (one card every room/18 … room/12 px), find the narrowest drum (Rx from
     14 % to 36 % of the width, 1 % steps) whose lit cards never touch at any angle, then keep the pitch whose lit
     neighbours sit closest on average. Every test projects the cards' corners exactly as the browser will — card
     transform (translate, rotateY, scale), the camera (−5° from above, ±3.6° of scroll lean, ±6° of cursor pan),
     perspective P about the stage centre. Rules: a pair with a LIT card (opacity ≥ .7, the near arc) keeps `gap` px
     at rest and never intersects under the lean — unless the one behind is a half-lit shoulder card (< .75) tucked
     behind an opaque one (real depth order, so it is simply occluded, like a stack of prints); two shoulder cards
     (< .7) and the dark far side are free. ~30–50 ms, once per resize (nothing runs in the frame loop). */
  const DRUM_GAP = 12, DRUM_LEAN = [[-5, 0], [-8.6, -6], [-8.6, 6], [-1.4, -6], [-1.4, 6]];   // [tilt, pan] in degrees: rest first
  const boxes = [];                                                                    // scratch: projected boxes of the lit cards at one phase
  function drumPack(apply, room) {
    const RxMin = W * 0.14, RxMax = Math.min(W * 0.36, room * 0.9);
    let best = null;
    for (let div = 18; div >= 12; div--) {
      const dy = room / div;
      for (let Rx = RxMin; Rx <= RxMax + 0.01; Rx = Math.min(RxMax, Rx + W * 0.01)) {
        apply(Rx, dy);
        if (drumTouches()) { if (Rx >= RxMax) break; continue; }
        const nn = drumGap();
        if (!best || nn < best.nn) best = { Rx, dy, nn };
        break;
      }
    }
    if (best) apply(best.Rx, best.dy); else apply(RxMax, room / 12);                 // nothing packs (a very odd room): the loosest drum
  }
  function drumProject(ph, tilt, pan) {                                              // the lit cards' screen boxes (stage-centre origin) at phase `ph` slots
    const ca = Math.cos(tilt * DEG), sa = Math.sin(tilt * DEG), cb = Math.cos(pan * DEG), sb = Math.sin(pan * DEG);
    let m = 0;
    for (let i = 0; i < n; i++) {
      const u = (i + ph) % n, rad = u * drum.step * DEG, c = Math.cos(rad), sn = Math.sin(rad);
      if (c < -0.1) continue;                                                         // the far half never lights up
      const x = sn * drum.Rx * drum.jr[i], y = drum.mid + (u - n / 2) * drum.dy + drum.jy[i], z = (c - drum.zoff) * drum.Rz * drum.jr[i], s = drum.sc[i];
      const k0 = P / (P - z), yS = H / 2 + (CY + y - H / 2) * k0, hs = ch[i] * s * k0 / 2;
      const o = (0.1 + 0.9 * smooth01((c + 0.5) / 1.2)) * smooth01(u / 2) * smooth01((n - u) / 2) * smooth01((yS - (CY + drum.top - 0.3 * hs)) / (1.3 * hs)) * smooth01(((CY + drum.bottom + 0.3 * hs) - yS) / (1.3 * hs));   // = poseDrum's opacity
      if (o < 0.5) continue;
      const ry = Math.atan2(drum.Rz * sn, drum.Rx * c), cr = Math.cos(ry), sr = Math.sin(ry);
      let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity;
      for (let q = 0; q < 4; q++) {
        const lx = (q & 1 ? 1 : -1) * cw[i] / 2, ly = (q & 2 ? 1 : -1) * ch[i] / 2;
        const X0 = x + s * lx * cr, Y0 = y + s * ly + (CY - H / 2), Z0 = z - s * lx * sr;   // the card's corner in the scene (rotateY about its centre)
        const X1 = X0 * cb + Z0 * sb, Z1 = -X0 * sb + Z0 * cb;                             // camera pan
        const Y = Y0 * ca - Z1 * sa, Z = Y0 * sa + Z1 * ca, k = P / (P - Z);                 // camera tilt, then perspective
        const xp = X1 * k, yp = Y * k;
        if (xp < L) L = xp; if (xp > R) R = xp; if (yp < T) T = yp; if (yp > B) B = yp;
      }
      const b = boxes[m] || (boxes[m] = {}); b.L = L; b.R = R; b.T = T; b.B = B; b.o = o; b.z = z; m++;
    }
    return m;
  }
  const sepOf = (A, B) => Math.max(Math.max(A.L, B.L) - Math.min(A.R, B.R), Math.max(A.T, B.T) - Math.min(A.B, B.B));   // clear distance between two boxes (< 0: they intersect)
  function drumTouches() {                                                             // does any forbidden pair come too close, at any phase, from any camera?
    for (let v = 0; v < DRUM_LEAN.length; v++) {
      const rest = v === 0, gap = rest ? DRUM_GAP : 0, dph = rest ? 0.125 : 0.25;
      for (let ph = 0; ph < n; ph += dph) {
        const m = drumProject(ph, DRUM_LEAN[v][0], DRUM_LEAN[v][1]);
        for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) {
          const A = boxes[a], B = boxes[b];
          if (A.o < 0.7 && B.o < 0.7) continue;                                         // two shoulder cards: the dark zone, nobody reads it
          const front = A.z >= B.z ? A : B, back = front === A ? B : A;
          if (back.o < 0.75 && (1 - front.o) * back.o <= 0.15) continue;                // a half-lit sliver tucked behind an opaque card: the desk's depth, not a clash (≤ 15 % show-through)
          if (sepOf(A, B) < gap) return true;                                            // anything else must keep clear
        }
      }
    }
    return false;
  }
  function drumGap() {                                                                 // the mean distance from a bright card to its nearest bright neighbour, over a full cycle at rest
    let sum = 0, cnt = 0;
    for (let ph = 0; ph < n; ph += 0.25) {
      const m = drumProject(ph, DRUM_LEAN[0][0], DRUM_LEAN[0][1]);
      for (let a = 0; a < m; a++) {
        if (boxes[a].o < 0.7) continue;
        let nn = Infinity;
        for (let b = 0; b < m; b++) if (b !== a && boxes[b].o >= 0.7) nn = Math.min(nn, sepOf(boxes[a], boxes[b]));
        if (nn < Infinity) { sum += nn; cnt++; }
      }
    }
    return cnt ? sum / cnt : Infinity;
  }
  function solveGrid() {
    const gap = Math.max(8, Math.min(16, W * 0.01));
    const room = roomBottom - roomTop;
    const maxW = W - 2 * Math.max(gap, W * 0.03);
    const packRows = (rows) => {
      const cellH = (room - gap * (rows - 1)) / rows;
      const widths = cards.map((_, i) => cellH / ar[i]);
      const total = widths.reduce((a, w) => a + w + gap, 0);
      const out = Array.from({ length: rows }, () => []); let acc = 0;
      cards.forEach((_, i) => { const w = widths[i] + gap; out[Math.min(rows - 1, Math.floor((acc + w / 2) / total * rows))].push(i); acc += w; });
      const kept = out.filter((r) => r.length);
      const widest = Math.max(...kept.map((r) => r.reduce((a, i) => a + widths[i], 0) + gap * (r.length - 1)));
      return { rows: kept, h: cellH * Math.min(1, maxW / widest) };
    };
    let best = null;
    for (let r = 2; r <= 10; r++) { const c = packRows(r); if (!best || c.h > best.h) best = c; }
    const h = best.h, rowsArr = best.rows;
    const gh = rowsArr.length * h + (rowsArr.length - 1) * gap;
    const y0 = (roomTop + roomBottom) / 2 - gh / 2 + h / 2;
    rowsArr.forEach((row, r) => {
      const rw = row.reduce((a, i) => a + h / ar[i], 0) + gap * (row.length - 1);
      let x = -rw / 2;
      row.forEach((i) => { const w = h / ar[i]; grid[i].x = x + w / 2; grid[i].y = y0 + r * (h + gap); grid[i].s = h / ch[i]; x += w + gap; });
    });
  }

  /* ── poses: pure functions of (i, S) ── */
  const poseRing = (i, o) => {
    const a = ring.base[i] + S.orbitRotation * (ringOf[i] ? 1 : -1.35), rad = a * DEG, r = ringOf[i] ? ring.rOut : ring.rIn;
    o.x = Math.cos(rad) * r; o.y = Math.sin(rad) * r; o.z = 0; o.rx = 0; o.ry = 0; o.rz = a + 90; o.s = ringOf[i] ? ring.sOut : ring.sIn; o.o = 1;
  };
  const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const poseDrum = (i, o) => {
    const u = (((i + S.drumRotation / drum.step) % n) + n) % n;                        // position along the helix in card slots — wraps at the invisible ends
    const th = u * drum.step, rad = th * DEG, c = Math.cos(rad), sn = Math.sin(rad);
    o.x = sn * drum.Rx * drum.jr[i]; o.y = drum.mid + (u - n / 2) * drum.dy + drum.jy[i]; o.z = (c - drum.zoff) * drum.Rz * drum.jr[i];    // an ellipse: wide across the screen, shallow in depth; its axis a little behind the screen plane
    o.rx = 0; o.ry = Math.atan2(drum.Rz * sn, drum.Rx * c) / DEG; o.rz = 0; o.s = drum.sc[i];   // tangent to the ellipse: edge-on at the sides, face-on up front
    const ends = smooth01(u / 2) * smooth01((n - u) / 2);                              // gone before the wrap
    const k = P / (P - o.z), yS = H / 2 + (CY + o.y - H / 2) * k, hs = ch[i] * o.s * k / 2;   // projected centre and half-height (perspective origin = stage centre)
    const edges = smooth01((yS - (CY + drum.top - 0.3 * hs)) / (1.3 * hs)) * smooth01(((CY + drum.bottom + 0.3 * hs) - yS) / (1.3 * hs));   // a soft clip at the HUD / the foot (gone once ~⅔ of the card is outside the room)
    o.o = (0.1 + 0.9 * smooth01((c + 0.5) / 1.2)) * ends * edges;                      // near half lit, edge-on half-dim, far side almost dark
  };
  const poseGrid = (i, o) => { const g = grid[i]; o.x = g.x; o.y = g.y; o.z = 0; o.rx = 0; o.ry = 0; o.rz = 0; o.s = g.s; o.o = 1; };
  const poseFront = (i, o) => {
    const room = roomBottom - roomTop;
    const f = clamp(Math.min(0.9 * room / ch[i], 0.86 * W / cw[i]), 0.2, 3);         // fill ~90 % of the room's height
    o.x = 0; o.y = (roomTop + roomBottom) / 2 / f; o.z = P * (1 - 1 / f); o.rx = 0; o.ry = 0; o.rz = 0; o.s = 1; o.o = 1;
  };
  const LAYOUT = { orbit: poseRing, scatter: poseDrum, grid: poseGrid };
  const dest = (i, o) => { if (S.focused === i) poseFront(i, o); else LAYOUT[S.mode](i, o); };

  /* ── journeys: snapshot → live destination, per-card stagger, one ease ── */
  const mk = () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, o: 1 });
  const cur = cards.map(mk), from = cards.map(mk), tmp = mk();
  const jStart = new Array(n).fill(-1), jDur = new Array(n).fill(1), jEase = new Array(n).fill(easeInOut);
  const lift = new Array(n).fill(0);                                      // hover emphasis 0…1 (state-derived, lerped)
  const written = cards.map(() => ({ t: '', o: '' }));
  let now = 0;
  function travel(i, delay, dur, ease) { Object.assign(from[i], cur[i]); jStart[i] = now + delay; jDur[i] = dur; jEase[i] = ease; }
  const mixA = (a, b, u) => a + shortDelta(b - a) * u;
  const lastY = new Array(n).fill(NaN), lastDrum = new Array(n).fill(false);
  function poseOf(i, out) {
    dest(i, out);
    const onDrum = S.mode === 'scatter' && S.focused !== i;
    const wrapped = onDrum && lastDrum[i] && Math.abs(out.y - lastY[i]) > drum.total / 2;   // the screw wrapped this card (at an invisible end)
    lastDrum[i] = onDrum; lastY[i] = out.y;
    const t0 = jStart[i];
    if (wrapped) { if (t0 < 0) Object.assign(cur[i], out); else { Object.assign(from[i], cur[i]); jStart[i] = now; } }   // teleport unseen, or re-time a travelling card (no visible jump)
    if (t0 < 0) return;
    const u = (now - t0) / jDur[i];
    if (u >= 1) { jStart[i] = -1; return; }
    const e = u <= 0 ? 0 : jEase[i](u), f = from[i];
    out.x = f.x + (out.x - f.x) * e; out.y = f.y + (out.y - f.y) * e; out.z = f.z + (out.z - f.z) * e;
    out.rx = mixA(f.rx, out.rx, e); out.ry = mixA(f.ry, out.ry, e); out.rz = mixA(f.rz, out.rz, e);
    out.s = f.s + (out.s - f.s) * e; out.o = f.o + (out.o - f.o) * e;
  }

  /* ── the caption line, the title, cursor labels ── */
  const say = (k, q, href) => {
    if (lineK) lineK.textContent = k;
    if (lineQ) lineQ.textContent = q || '';
    if (more) { more.hidden = !href; if (href) more.setAttribute('href', href); }
    document.dispatchEvent(new Event('cursor:refresh'));
  };
  const titleWanted = () => (S.mode === 'orbit' && S.focused < 0 ? 1 : 0);   // the headline lives in the still centre of the rings only

  /* ── mode changes: the same cards travel to the next arrangement ── */
  let lead = -1;
  function setMode(mode, byUser = false) {
    if (byUser) tourOff();
    if (S.focused >= 0) { close(mode === S.mode); if (mode === S.mode) return; }
    if (mode === S.mode && byUser) return;
    clearHover();
    S.prevMode = S.mode; S.mode = mode;
    buttons.forEach((b) => { const on = b.dataset.stageMode === mode; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
    say(KLINE[mode], '', null);
    if (mode === 'orbit') stage.dataset.cursor = 'drag'; else if (mode === 'scatter') stage.dataset.cursor = 'turn'; else delete stage.dataset.cursor;
    S.ptr.x = 0; S.ptr.y = 0;
    cards.forEach((_, i) => travel(i, i === lead ? 0 : order[i] * 0.022, 1.15, easeInOut));
    lead = -1;
  }

  /* ── focus: one piece to the front, its film playing, its line under it ── */
  function stopFilm(i) { if (!isFilm[i]) return; media[i].pause(); cards[i].classList.remove('is-playing'); }
  function playFilm(i) {
    if (!isFilm[i] || (navigator.connection && navigator.connection.saveData)) return;
    const v = media[i]; v.preload = 'auto'; const pl = v.play(); if (pl && pl.catch) pl.catch(() => {}); cards[i].classList.add('is-playing');
  }
  let lastToggle = -1;                                                    // time of the last open/close (a double-click is one open)
  function open(i, how) {
    tourOff();
    if (S.focused === i) { if (now - lastToggle > 0.35) close(); return; }
    lastToggle = now;
    const prev = S.focused;
    if (prev >= 0) { stopFilm(prev); delete cards[prev].dataset.cursor; }
    clearHover();
    S.focused = i;
    stage.classList.add('is-focused');
    cards.forEach((_, j) => travel(j, 0, 0.9, j === i ? easeOut : easeInOut));   // the piece comes forward; everything else settles into its slot
    cards[i].dataset.cursor = 'close';
    delete stage.dataset.cursor;
    S.ptr.x = 0; S.ptr.y = 0;
    say(kinds[i], captions[i], hrefs[i]);
    if (S.active) playFilm(i);
    if (how === 'keyboard') cards[i].focus({ preventScroll: true });
    document.dispatchEvent(new Event('cursor:refresh'));
  }
  function close(relayout = true) {
    if (S.focused < 0) return;
    lastToggle = now;
    const i = S.focused;
    stopFilm(i);
    delete cards[i].dataset.cursor;
    if (S.mode === 'orbit') stage.dataset.cursor = 'drag'; else if (S.mode === 'scatter') stage.dataset.cursor = 'turn';
    S.focused = -1;
    clearHover();
    stage.classList.remove('is-focused');
    say(KLINE[S.mode], '', null);
    lead = i;
    if (relayout) { cards.forEach((_, j) => travel(j, j === i ? 0 : 0.05 + order[j] * 0.012, 1.0, easeInOut)); lead = -1; }
    document.dispatchEvent(new Event('cursor:refresh'));
  }

  /* ── pointer: hold on hover, drag to turn, click to open · parallax on fine pointers ── */
  let downX = 0, downY = 0, lastX = 0, suppressClickUntil = -1, tour = true;
  const tourOff = () => { tour = false; };
  const parallaxAmp = () => (S.mode === 'scatter' ? (W < 900 ? 2.5 : 6) : S.mode === 'grid' ? 1.5 : 0);
  const dragBy = (dx) => {
    if (S.mode === 'orbit') { const d = clamp(dx * 0.22, -12, 12); S.orbitRotation += d; S.ringVel = d; }
    else if (S.mode === 'scatter') { const d = clamp(dx * 0.28, -14, 14); S.drumRotation += d; S.drumVel = d; }
    else S.ptr.x = clamp(S.ptr.x + dx * 0.06, -16, 16);
  };
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    downX = e.clientX; downY = e.clientY; lastX = e.clientX; S.dragging = false; S.idle = 0;
    if (e.pointerType !== 'mouse') { S.hold = true; S.touchHold = true; }           // a finger on the scene holds it, like a hover
  };
  const onMove = (e) => {
    const mouse = e.pointerType === 'mouse';
    const pressed = mouse ? !!(e.buttons & 1) : true;
    if (S.dragging) { const dx = e.clientX - lastX; lastX = e.clientX; dragBy(dx); return; }
    if (pressed && S.focused < 0 && !e.target.closest('button, a') && Math.abs(e.clientX - downX) > 6 && Math.abs(e.clientX - downX) > Math.abs(e.clientY - downY)) {
      S.dragging = true; lastX = e.clientX; tourOff(); clearHover();
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (!mouse || !fine || S.focused >= 0 || pressed) return;
    const r = stage.getBoundingClientRect(), amp = parallaxAmp();
    const onCard = !!e.target.closest('[data-stage-card]');
    if (S.mode === 'orbit') {                                                        // in the ring band → the rings hold still
      const d = Math.hypot(e.clientX - r.left - W / 2, e.clientY - r.top - CY);
      S.hold = d > ring.inner && d < ring.outer;
    } else S.hold = onCard;
    if (S.hold) tourOff();
    if (onCard) { S.ptr.x = S.cam.ry - camBase().ry; S.ptr.y = -(S.cam.rx - camBase().rx) / 0.6; return; }   // over a card the camera freezes: what you aim at stays put
    S.ptr.x = ((e.clientX - r.left) / r.width - 0.5) * 2 * amp;
    S.ptr.y = -((e.clientY - r.top) / r.height - 0.5) * 2 * amp;
  };
  const onUp = (e) => {
    if (S.dragging || Math.hypot(e.clientX - downX, e.clientY - downY) > 8) suppressClickUntil = now + 0.3;   // a drag is not a click
    if (S.dragging) { try { stage.releasePointerCapture(e.pointerId); } catch (_) {} }
    S.dragging = false;
    if (e.pointerType !== 'mouse') { S.hold = false; S.touchHold = false; }
    if (S.mode === 'orbit' || e.pointerType !== 'mouse') { S.ptr.x = 0; S.ptr.y = 0; }
  };
  const onLeave = () => { if (!S.dragging) { S.ptr.x = 0; S.ptr.y = 0; } S.hold = false; };
  const onClick = (e) => {
    S.idle = 0;
    if (now < suppressClickUntil || now - lastToggle < 0.35 || e.target.closest('button, a')) return;
    const card = e.target.closest('[data-stage-card]');
    if (card) open(cards.indexOf(card)); else if (S.focused >= 0) close();
  };
  const onKey = (e) => {
    S.idle = 0;
    if (e.key === 'Escape' && S.focused >= 0) { close(); return; }
    const card = e.target.closest && e.target.closest('[data-stage-card]');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(cards.indexOf(card), 'keyboard'); }
  };
  const clearHover = () => { S.hovered = -1; S.hold = false; };
  const onOver = (e) => {
    const card = e.target.closest('[data-stage-card]');
    if (!card || S.focused >= 0 || !fine || S.dragging) return;
    const i = cards.indexOf(card);
    if (i === S.hovered) return;
    S.hovered = i; if (S.mode !== 'orbit') S.hold = true;
    tourOff();
    say(kinds[i], captions[i], null);
  };
  const onOut = (e) => {
    const card = e.target.closest('[data-stage-card]');
    if (!card || !fine) return;
    if (cards.indexOf(card) === S.hovered) S.hovered = -1;
    if (S.mode !== 'orbit') S.hold = false;
    if (S.focused < 0) say(KLINE[S.mode], '', null);
  };
  const cleanup = [];
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); cleanup.push(() => el.removeEventListener(ev, fn, opt)); };
  on(stage, 'pointerdown', onDown); on(stage, 'pointermove', onMove);
  on(stage, 'pointerup', onUp); on(stage, 'pointercancel', onUp); on(stage, 'pointerleave', onLeave);
  on(stage, 'click', onClick); on(stage, 'keydown', onKey); on(stage, 'pointerover', onOver); on(stage, 'pointerout', onOut);
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && !html.classList.contains('index-open')) close(); });
  buttons.forEach((b) => on(b, 'click', () => setMode(b.dataset.stageMode, true)));

  /* ── deep links from the chapters: scroll up (natively), open the piece once the stage has arrived ── */
  const byId = {}; cards.forEach((c, i) => { byId[c.dataset.cardId] = i; });
  let pending = null;                                                    // { i, how } — consumed by the tick when the stage is in place
  $$('[data-orbit-open]').forEach((a) => on(a, 'click', (e) => {
    const i = byId[a.dataset.orbitOpen]; if (i === undefined) return;
    e.preventDefault(); tourOff();
    if (S.mode !== 'orbit') setMode('orbit', true);
    pending = { i, how: e.detail === 0 ? 'keyboard' : 'pointer', moved: false };
    stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', '#orbit');
  }));

  /* ── the camera ── */
  const camBase = () => {
    const p = S.scrollProgress, e = p * p * (3 - 2 * p);
    const above = S.mode === 'scatter' && S.focused < 0 ? -5 : 0;         // the drum is seen a little from above
    return { rx: above + 16 * e + clamp(S.scrollVelocity / 900, -3, 3), ry: 0, z: -(mobile ? 200 : 340) * e };   // leaving: the scene lies back and recedes
  };

  /* ── THE TICK — runs inside main.js's single rAF loop ── */
  const sc = AK.scroll;
  let lastCam = '', lastTitle = -1;
  const tick = (dt, t) => { try { step(dt, t); } catch (err) { destroy(); console.error(err); } };
  function step(dt, t) {
    now = t;
    if (!S.live) return;
    /* scroll → state (read only; native scroll is never touched) */
    S.scrollProgress = clamp((sc.smooth - stageTop) / Math.max(1, H * 0.9), 0, 1);
    S.scrollVelocity = sc.velocity;
    if (pending) {                                                        // the deep link: open when the stage has arrived (or the scroll has settled)
      if (Math.abs(sc.y - stageTop) < 6) { const p = pending; pending = null; open(p.i, p.how); }
      else if (Math.abs(sc.velocity) > 50) pending.moved = true;
      else if (pending.moved && sc.velocity === 0) { const p = pending; pending = null; open(p.i, p.how); }
    }
    if (!S.active) return;                                                // off-screen: no rotation, no writes

    /* rotation: constant base velocity, held on hover/drag/focus, modulated by scroll velocity, plus drag inertia — infinite, never reset */
    const k7 = 1 - Math.exp(-dt * 7);
    const held = S.hold || S.dragging || S.focused >= 0;
    const energy = clamp(Math.abs(S.scrollVelocity) / 1200, 0, 1);         // fling the page → the scene picks up energy, settles when you stop
    const ringT = S.mode === 'orbit' && !held ? RING_RATE * (1 + 1.4 * energy) : 0;
    const drumT = S.mode === 'scatter' && !(S.dragging || S.focused >= 0 || S.touchHold) ? DRUM_RATE * (1 + 1.4 * energy) * (S.hovered >= 0 || S.hold ? 0.12 : 1) : 0;   // a hovered drum only slows: it never freezes under a parked cursor
    S.ringRate += (ringT - S.ringRate) * k7; S.drumRate += (drumT - S.drumRate) * k7;
    S.orbitRotation += S.ringRate * dt + (S.dragging ? 0 : S.ringVel);
    S.drumRotation += S.drumRate * dt + (S.dragging ? 0 : S.drumVel);
    if (!S.dragging) { const decay = Math.exp(-dt * 4.5); S.ringVel *= decay; S.drumVel *= decay; }

    /* camera: base (mode + scroll) + cursor parallax, with mass */
    const b = camBase(), amp = parallaxAmp();
    const focusedOrCoarse = S.focused >= 0 || !fine;
    S.camT.rx = b.rx + (focusedOrCoarse ? 0 : S.ptr.y * 0.6); S.camT.ry = b.ry + (focusedOrCoarse || !amp ? 0 : S.ptr.x); S.camT.z = b.z;
    const k4 = 1 - Math.exp(-dt * 4);
    S.cam.rx += (S.camT.rx - S.cam.rx) * k4; S.cam.ry += (S.camT.ry - S.cam.ry) * k4; S.cam.z += (S.camT.z - S.cam.z) * k4;
    const camStr = `translate3d(0,0,${S.cam.z.toFixed(1)}px) rotateX(${S.cam.rx.toFixed(3)}deg) rotateY(${S.cam.ry.toFixed(3)}deg)`;
    if (camStr !== lastCam) { lastCam = camStr; space.style.transform = camStr; }

    /* focus dim, title, idle tour */
    S.dim += ((S.focused >= 0 ? 1 : 0) - S.dim) * (1 - Math.exp(-dt * 6));
    S.titleO += (titleWanted() - S.titleO) * (1 - Math.exp(-dt * 5));
    if (Math.abs(S.titleO - lastTitle) > 0.002) { lastTitle = S.titleO; title.style.opacity = S.titleO.toFixed(3); }
    tourStep(dt);

    /* cards: pose → mass layer → hover emphasis → ONE write */
    const kMass = 1 - Math.exp(-dt * 24), kLift = 1 - Math.exp(-dt * 9);
    let progress = 1;
    for (let i = 0; i < n; i++) {
      poseOf(i, tmp);
      if (jStart[i] >= 0) progress = Math.min(progress, clamp((now - jStart[i]) / jDur[i], 0, 1));
      if (S.focused >= 0 && S.focused !== i) tmp.o *= 1 - 0.88 * S.dim;   // the others fall back while one piece is open
      const c = cur[i];
      c.rx = tmp.rx + shortDelta(c.rx - tmp.rx); c.ry = tmp.ry + shortDelta(c.ry - tmp.ry); c.rz = tmp.rz + shortDelta(c.rz - tmp.rz);   // stay in the same turn
      c.x += (tmp.x - c.x) * kMass; c.y += (tmp.y - c.y) * kMass; c.z += (tmp.z - c.z) * kMass;
      c.rx += (tmp.rx - c.rx) * kMass; c.ry += (tmp.ry - c.ry) * kMass; c.rz += (tmp.rz - c.rz) * kMass;
      c.s += (tmp.s - c.s) * kMass; c.o += (tmp.o - c.o) * kMass;
      lift[i] += ((S.hovered === i && S.focused < 0 ? 1 : 0) - lift[i]) * kLift;
      let ry = c.ry; if (Math.cos(ry * DEG) < 0) ry += 180;                // the far side of the drum shows its face (flips while edge-on — invisible)
      const z = c.z + lift[i] * 40, s = c.s * (1 + lift[i] * 0.03);
      const tr = `translate3d(${c.x.toFixed(2)}px,${c.y.toFixed(2)}px,${z.toFixed(2)}px) rotateX(${c.rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${c.rz.toFixed(2)}deg) scale(${s.toFixed(4)})`;
      const w = written[i];
      if (tr !== w.t) { w.t = tr; cards[i].style.transform = tr; }
      const o = c.o < 0.002 ? '0' : c.o.toFixed(3);
      if (o !== w.o) { w.o = o; cards[i].style.opacity = o; }
    }
    S.layoutProgress = progress;
  }

  /* ── the idle tour: orbit → scatter → grid → orbit once, only while nobody is looking closely ── */
  const TOUR = ['scatter', 'grid', 'orbit']; let tourI = 0;
  function tourStep(dt) {
    if (!tour) return;
    if (S.hold || S.hovered >= 0 || S.focused >= 0 || S.dragging || document.hidden || S.scrollProgress > 0.25 || Math.abs(S.scrollVelocity) > 80) { S.idle = 0; return; }
    S.idle += dt;
    if (S.idle < (tourI === 0 ? 12 : 6)) return;
    S.idle = 0;
    setMode(TOUR[tourI]);
    if (++tourI >= TOUR.length) tour = false;
  }

  /* ── visibility: the stage in view → active (films resume), out of view → idle ── */
  const io = new IntersectionObserver((es) => es.forEach((en) => {
    S.active = en.isIntersecting;
    const f = S.focused;
    if (f >= 0 && isFilm[f]) { if (S.active) playFilm(f); else stopFilm(f); }
  }), { threshold: 0 });
  io.observe(stage); cleanup.push(() => io.disconnect());

  /* ── reduced motion switched on while the page is open: put the scene away, leave the captioned grid ── */
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return; destroyed = true;
    cleanup.forEach((fn) => fn());
    if (S.focused >= 0) stopFilm(S.focused);
    stage.classList.remove('is-3d', 'is-focused', 'is-live');
    [space, title, ...cards].forEach((el) => { el.style.transform = ''; el.style.opacity = ''; });
    stage.style.removeProperty('--cy'); stage.style.removeProperty('--title-fit');
    cards.forEach((c) => { c.removeAttribute('tabindex'); c.removeAttribute('role'); c.removeAttribute('aria-label'); delete c.dataset.cursor; c.classList.remove('stage__card--wide', 'is-playing'); });
    delete stage.dataset.cursor;
    html.classList.add('no-scene');
  };

  /* ── boot: the rings assemble out of the dark, the headline settles ── */
  try {
  stage.classList.add('is-3d');
  cards.forEach((c, i) => { c.tabIndex = 0; c.setAttribute('role', 'button'); c.setAttribute('aria-label', 'Open: ' + captions[i]); c.dataset.cursor = 'read'; });
  stage.dataset.cursor = 'drag';
  say(KLINE.orbit, '', null);
  title.style.opacity = '0';
  measure();
  cards.forEach((c, i) => { poseRing(i, cur[i]); cur[i].z = -1600; cur[i].o = 0; cur[i].s *= 0.6; c.style.opacity = '0'; });
  const start = () => {
    measure();
    now = performance.now() / 1000;
    cards.forEach((_, i) => travel(i, 0.15 + order[i] * 0.03, 1.7, easeOut));
    S.live = true;
    stage.classList.add('is-live');                                        // HUD + foot fade in (CSS)
    AK.measure();
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(start)); else requestAnimationFrame(start);
  AK.loop.add(tick); cleanup.push(() => AK.loop.remove(tick));

  let lastW = stage.clientWidth, lastH = stage.clientHeight;
  const ro = new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w === lastW && h === lastH) return; lastW = w; lastH = h;
    measure();                                                             // poses are live functions of the geometry: the cards glide to their new places through the mass layer
  });
  ro.observe(stage); cleanup.push(() => ro.disconnect());
  document.addEventListener('page:measured', () => { stageTop = AK.docTop(stage); });

  reduceMQ.addEventListener('change', (e) => { if (e.matches) destroy(); });
  } catch (err) { destroy(); console.error(err); return; }

  /* a read-only window for QA tooling */
  Object.defineProperty(window, 'AK_SCENE', { value: { S, cur, cards, setMode, open, close, measure, tick, ring, drum }, enumerable: false });
})();

