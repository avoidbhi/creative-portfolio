/* ─────────────────────────────────────────────────────────────
   ABHIJEET KANASE — page behaviour (v7 · one loop)

   ONE requestAnimationFrame loop drives everything continuous on the page:
     · smoothed scroll + scroll velocity  (the page never scroll-jacks — native
       scrolling is untouched; the smoothed value only feeds motion)
     · HUD progress / chapter label · chapter numerals (slow layer)
     · the depth layer  ([data-depth] elements arrive from depth as they scroll in)
     · the custom cursor · counters · the split-flap board · the phone cadence
     · the 3D scene (motion.js registers its tick here — same frame, same clock)
   Reveals are CSS transitions toggled by IntersectionObservers (once), never
   animated from JS, so no two systems ever write the same element.
   No setTimeout/setInterval drives interaction; state and events do.
   A fail-safe (html.reveal-all) forces every reveal visible if any script throws.
   ───────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const html = document.documentElement;
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = mqReduce.matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ───────────── fail-safe: nothing may ever stay hidden ───────────── */
  const revealAll = () => html.classList.add('reveal-all');
  addEventListener('error', revealAll);
  addEventListener('unhandledrejection', revealAll);
  if (reduce) html.classList.add('no-scene');

  /* ───────────── word splitting (keeps <em>, keeps a11y name) ───────────── */
  function splitWords(el) {
    if (!el || el.dataset.splitDone) return;
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    let i = 0;
    const walk = (node) => {
      const frag = document.createDocumentFragment();
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
            const inner = document.createElement('span'); inner.className = 'w__in'; inner.textContent = part;
            inner.style.setProperty('--i', i++);
            w.appendChild(inner); frag.appendChild(w);
          });
        } else if (child.nodeType === 1) {
          const clone = child.cloneNode(false);
          clone.appendChild(walk(child));
          frag.appendChild(clone);
        }
      });
      return frag;
    };
    const frag = walk(el);
    el.textContent = '';
    el.appendChild(frag);
    el.dataset.splitDone = '1';
  }
  $$('[data-split]').forEach(splitWords);

  /* ───────────── clocks (IST) ───────────── */
  const clocks = $$('[data-clock]');
  const tickClock = () => {
    const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
    clocks.forEach((c) => (c.textContent = t));
  };
  tickClock(); setInterval(tickClock, 15000);                    // a clock, not an animation

  /* ───────────── THE LOOP + scroll state ─────────────
     scroll.y       raw scrollY (native — never written by us)
     scroll.smooth  a low-pass copy with ~80 ms of lag: motion has mass, the page does not
     scroll.velocity px/s (signed, smoothed) · scroll.energy 0…1 from |velocity|      */
  const loop = { fns: new Set(), add(fn) { this.fns.add(fn); }, remove(fn) { this.fns.delete(fn); } };
  const scroll = { y: scrollY, smooth: scrollY, velocity: 0, energy: 0, progress: 0, max: 1, vh: innerHeight, vw: innerWidth };

  /* document offsets are measured once per layout change, never per frame → the loop performs no layout reads */
  const docTop = (el) => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; };
  const themed = $$('[data-theme][data-chapter]').map((el) => ({ el, top: 0, bottom: 0 }));
  const nums = $$('.chapter__num').map((el) => ({ el, top: 0, h: 0, last: NaN }));
  const depths = $$('[data-depth]').map((el) => ({ el, top: 0, h: 0, last: NaN, extra: '' }));   // data-depth may carry a resting transform (the index card's tilt) — read in measure()
  const mainEl = $('[data-main]');
  let mainBottom = 0;
  function measure() {
    scroll.vh = innerHeight; scroll.vw = innerWidth;
    scroll.max = Math.max(1, html.scrollHeight - innerHeight);
    themed.forEach((s) => { s.top = docTop(s.el); s.bottom = s.top + s.el.offsetHeight; });
    nums.forEach((n) => { n.top = docTop(n.el.parentElement); n.h = n.el.parentElement.offsetHeight; });
    depths.forEach((d) => { d.top = docTop(d.el); d.h = d.el.offsetHeight; d.extra = d.el.dataset.depth && innerWidth > 600 ? ' ' + d.el.dataset.depth : ''; d.last = NaN; });
    if (mainEl) mainBottom = docTop(mainEl) + mainEl.offsetHeight;
    document.dispatchEvent(new Event('page:measured'));
  }
  let measureQueued = false;
  const queueMeasure = () => { if (measureQueued) return; measureQueued = true; requestAnimationFrame(() => { measureQueued = false; measure(); }); };
  addEventListener('resize', queueMeasure);
  addEventListener('load', queueMeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);
  if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(document.body);   // any content-height change (images, the stage going 3D)
  measure();

  /* ───────────── HUD: progress, chapter label ───────────── */
  const progressBar = $('[data-progress]'), progressNum = $('[data-progress-num]');
  const hudChapter = $('.hud__chapter'), chapterLabel = $('[data-chapter-label]');
  let currentTheme = html.dataset.theme, currentChapter = chapterLabel ? chapterLabel.textContent : '';
  let lastPct = -1, lastP = -1, swapping = false, swapAt = 0;
  function setChapter(name) {
    if (name === currentChapter || !hudChapter) return;
    currentChapter = name;
    if (reduce) { chapterLabel.textContent = name; return; }
    if (swapping) return;                                      // the transitionend handler picks up the latest name
    swapping = true; swapAt = performance.now();
    hudChapter.classList.add('is-swapping');                   // the old label slides out (CSS)
  }
  const finishSwap = () => {                                   // slid out → swap text, slide back in; slid in → done
    if (hudChapter.classList.contains('is-swapping')) { chapterLabel.textContent = currentChapter; hudChapter.classList.remove('is-swapping'); return; }
    swapping = false;
    if (chapterLabel.textContent !== currentChapter) { swapping = true; swapAt = performance.now(); hudChapter.classList.add('is-swapping'); }
  };
  if (chapterLabel) chapterLabel.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') finishSwap(); });
  function setTheme(t) { if (t === currentTheme) return; currentTheme = t; html.dataset.theme = t; }   // labels only — plain black site-wide

  function hud() {
    const y = scroll.y, vh = scroll.vh;
    const p = scroll.progress;
    if (Math.abs(p - lastP) > 0.0005) { lastP = p; if (progressBar) progressBar.style.transform = `scaleX(${p.toFixed(4)})`; }
    const pct = Math.round(p * 100);
    if (pct !== lastPct && progressNum) { lastPct = pct; progressNum.textContent = String(pct).padStart(2, '0'); }
    // which chapter owns the vertical centre of the viewport? (last match wins → the stage nested in main overrides)
    const mid = y + vh * 0.5;
    let active = null;
    for (const s of themed) if (s.top <= mid && s.bottom > mid) active = s.el;
    if (active) { setTheme(active.dataset.theme); setChapter(active.dataset.chapter); }
    else if (mainEl && mainBottom <= mid) { setTheme('ink'); setChapter('Epilogue'); }
    if (swapping && performance.now() - swapAt > 1200) { swapping = false; chapterLabel.textContent = currentChapter; hudChapter.classList.remove('is-swapping'); }   // label hidden (no transition ran) → settle it
    // big chapter numerals drift slower than the page (ambient layer)
    if (reduce) return;
    const sm = scroll.smooth;
    for (const n of nums) {
      const top = n.top - sm;
      if (top + n.h < -200 || top > vh + 200) continue;
      const v = Math.round((top - vh * 0.5) * -0.14 * 2) / 2;
      if (v !== n.last) { n.last = v; n.el.style.transform = `translate3d(0, ${v}px, 0)`; }
    }
  }

  /* ───────────── the depth layer: chapter heads, artifacts and the epilogue arrive from depth ─────────────
     A continuous, scroll-derived pose (translate + scale + opacity, GPU only), never a triggered tween:
     the page is one space the camera moves through, so the same motion language as the orbit continues. */
  function depth() {
    if (reduce || !depths.length) return;
    const vh = scroll.vh, sm = scroll.smooth, amp = scroll.vw < 700 ? 30 : 56;
    for (const d of depths) {
      const top = d.top - sm;
      if (top > vh * 1.5 || top + d.h < -vh) continue;                            // far off-screen: leave as is
      let fin = vh * 0.42;                                                          // fully arrived when its top reaches 42 % of the viewport…
      const reach = d.top - scroll.max;                                              // …or as high as the page can ever scroll it (the epilogue)
      if (reach > fin) fin = Math.min(reach, vh * 0.92 - 60);
      const p = clamp((vh * 0.92 - top) / Math.max(1, vh * 0.92 - fin), 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      if (Math.abs(e - d.last) < 0.0008) continue;
      d.last = e;
      d.el.style.transform = `translate3d(0, ${((1 - e) * amp).toFixed(2)}px, 0) scale(${(0.965 + 0.035 * e).toFixed(4)})` + d.extra;
      d.el.style.opacity = (0.15 + 0.85 * e).toFixed(3);
    }
  }

  /* ───────────── custom cursor: one lerped follower, transform-only, fine pointers only ───────────── */
  const cursor = { x: innerWidth / 2, y: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2, s: 1, ts: 1, active: false };
  const dot = $('[data-cursor-dot]'), ring = $('[data-cursor-ring]'), ringLabel = $('[data-cursor-label]');
  const hasCursor = finePointer && !reduce && dot && ring;
  if (hasCursor) {
    html.classList.add('has-cursor');
    const setCursorTarget = (el) => {
      const target = el.closest('a, button, [data-cursor], input, label');
      const labelled = el.closest('[data-cursor]');
      if (labelled) { ringLabel.textContent = labelled.dataset.cursor; ring.classList.add('has-label'); cursor.ts = 1; }
      else { ring.classList.remove('has-label'); cursor.ts = target ? 1.55 : 1; }
    };
    addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      cursor.x = e.clientX; cursor.y = e.clientY; cursor.active = true;
      html.classList.remove('is-hidden-cursor');
      setCursorTarget(e.target);
    }, { passive: true });
    // something under a parked cursor changed its label (the stage swaps drag / read / close) → re-read it
    document.addEventListener('cursor:refresh', () => {
      if (!cursor.active) return;
      const el = document.elementFromPoint(cursor.x, cursor.y);
      if (el) setCursorTarget(el);
    });
    document.addEventListener('mouseleave', () => html.classList.add('is-hidden-cursor'));
    document.addEventListener('mouseenter', () => html.classList.remove('is-hidden-cursor'));
  }
  function cursorFrame(dt) {
    if (!hasCursor || !cursor.active) return;
    const k = 1 - Math.exp(-dt * 14);
    cursor.rx = lerp(cursor.rx, cursor.x, k); cursor.ry = lerp(cursor.ry, cursor.y, k); cursor.s = lerp(cursor.s, cursor.ts, k);
    dot.style.transform = `translate3d(${cursor.x}px, ${cursor.y}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${cursor.rx.toFixed(1)}px, ${cursor.ry.toFixed(1)}px, 0) translate(-50%, -50%) scale(${cursor.s.toFixed(3)})`;
  }

  /* ───────────── the frame ───────────── */
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05; if (dt < 0.001) dt = 0.001;      // a hidden tab resumes without a jump
    // READ (no layout reads: scrollY only)
    const y = scrollY;
    const v = (y - scroll.y) / dt;
    scroll.y = y;
    scroll.smooth += (y - scroll.smooth) * (1 - Math.exp(-dt * 16));
    if (Math.abs(y - scroll.smooth) < 0.05) scroll.smooth = y;
    scroll.velocity += (v - scroll.velocity) * (1 - Math.exp(-dt * 7));
    if (Math.abs(scroll.velocity) < 0.5) scroll.velocity = 0;
    scroll.energy = clamp(Math.abs(scroll.velocity) / 2400, 0, 1);
    scroll.progress = clamp(y / scroll.max, 0, 1);
    // WRITE
    hud(); depth(); cursorFrame(dt);
    for (const fn of loop.fns) fn(dt, now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ───────────── reveals: one mechanism — IntersectionObserver adds .is-in, CSS transitions move ───────────── */
  const once = (els, cb, opts) => {
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { cb(en.target); io.unobserve(en.target); }
    }), opts || { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
    els.forEach((el) => io.observe(el));
  };
  const isIn = (el) => el.classList.add('is-in');
  once($$('[data-reveal]'), isIn);
  once($$('[data-split]'), isIn, { rootMargin: '0px 0px -18% 0px', threshold: 0.1 });
  once($$('[data-depth]'), isIn, { threshold: 0.2 });          // a state hook only (the index card's circle draws on it); the pose comes from the loop

  // the signature move: strike the brief, ink the line — the beat lives in CSS transition delays
  once($$('[data-edit]'), (el) => { const s = $('.strike', el); s && s.classList.add('is-struck'); el.classList.add('is-inked'); }, { rootMargin: '0px 0px -25% 0px', threshold: 0.2 });

  // numbers count up — inside the one loop
  once($$('[data-count]'), (el) => {
    const end = parseFloat(el.dataset.count), dec = parseInt(el.dataset.decimals || '0', 10);
    const pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    const fmt = (v) => pre + v.toFixed(dec) + suf;
    if (reduce || end === 0) { el.textContent = fmt(end); return; }
    let t = 0;
    const count = (dt) => {
      t += dt;
      const k = clamp(t / 1.5, 0, 1), e = 1 - Math.pow(2, -10 * k);
      el.textContent = fmt(end * e);
      if (k >= 1) { el.textContent = fmt(end); loop.remove(count); }
    };
    loop.add(count);
  }, { threshold: 0.6 });

  /* ───────────── tilt artifacts (fine pointer only) — .tilt__inner is its only writer ───────────── */
  if (finePointer && !reduce) $$('[data-tilt]').forEach((el) => {
    const inner = $('.tilt__inner', el);
    el.addEventListener('pointerenter', () => el.classList.add('is-tilting'));
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      inner.style.transform = `rotateX(${(-py * 8).toFixed(2)}deg) rotateY(${(px * 10).toFixed(2)}deg) translateZ(0)`;
    }, { passive: true });
    el.addEventListener('pointerleave', () => { el.classList.remove('is-tilting'); inner.style.transform = ''; });
  });

  /* ───────────── magnetic email ───────────── */
  if (finePointer && !reduce) $$('[data-magnet]').forEach((el) => {
    const strength = 0.28;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
      el.style.transition = 'transform .15s linear, color .3s, background-size .5s';
    }, { passive: true });
    el.addEventListener('pointerleave', () => { el.style.transition = 'transform .7s cubic-bezier(.16,1,.3,1), color .3s, background-size .5s'; el.style.transform = ''; });
  });

  /* ───────────── phone notifications — a cadence in the loop, visible only while on screen ───────────── */
  const phone = $('[data-phone]');
  if (phone && !reduce) {
    const notifs = $$('.notif', phone); let idx = 0, acc = 0, visible = false;
    const next = () => {
      const cur = notifs[idx]; idx = (idx + 1) % notifs.length; const nxt = notifs[idx];
      cur.classList.remove('is-active'); cur.classList.add('is-leaving');      // CSS: leaves down…
      nxt.classList.remove('is-leaving'); nxt.classList.add('is-active');      // …the next arrives after its CSS delay
    };
    loop.add((dt) => { if (!visible) return; acc += dt; if (acc >= 3.2) { acc = 0; next(); } });
    new IntersectionObserver((es) => es.forEach((en) => { visible = en.isIntersecting; }), { threshold: 0.4 }).observe(phone);
  }

  /* ───────────── split-flap departure board ───────────── */
  const board = $('[data-flap]');
  if (board) {
    const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .';
    const rows = $$('.board__row', board).map((row) => {
      const text = row.dataset.text;
      const flaps = Array.from(text).map((c) => {
        const f = document.createElement('span'); f.className = 'flap' + (c === ' ' ? ' is-blank' : '');
        f.textContent = reduce ? c : ' '; row.appendChild(f); return f;
      });
      row.setAttribute('aria-label', text);
      return { text, flaps };
    });
    if (!reduce) once([board], () => {
      let el = 0;
      const run = (dt) => {
        el += dt * 1000; let live = false;
        rows.forEach(({ text, flaps }, ri) => flaps.forEach((f, i) => {
          const start = ri * 380 + i * 55, end = start + 520 + (i % 5) * 90;
          if (el < start) { live = true; return; }
          if (el < end) { live = true; f.textContent = CH[Math.floor(Math.random() * CH.length)]; return; }
          f.textContent = text[i];
        }));
        if (!live) loop.remove(run);
      };
      loop.add(run);
    }, { threshold: 0.5 });
  }

  /* ───────────── index overlay ───────────── */
  const index = $('[data-index]'), indexBtn = $('[data-index-toggle]'), indexLabel = $('[data-index-label]');
  $$('.index__list li').forEach((li, i) => li.style.setProperty('--i', i));
  let indexOpen = false;
  function toggleIndex(force) {
    indexOpen = typeof force === 'boolean' ? force : !indexOpen;
    index.classList.toggle('is-open', indexOpen);
    index.setAttribute('aria-hidden', String(!indexOpen));
    html.classList.toggle('index-open', indexOpen);
    indexBtn.setAttribute('aria-expanded', String(indexOpen));
    indexLabel.textContent = indexOpen ? 'Close' : 'Index';
    html.style.overflow = indexOpen ? 'hidden' : '';
    if (indexOpen && reduce) $('[data-index-link]')?.focus({ preventScroll: true });
  }
  if (index && indexBtn) {
    indexBtn.addEventListener('click', () => toggleIndex());
    index.addEventListener('transitionend', (e) => { if (e.target === index && e.propertyName === 'transform' && indexOpen) $('[data-index-link]')?.focus({ preventScroll: true }); });   // focus once the panel has arrived
    $$('[data-index-link]').forEach((a) => a.addEventListener('click', () => toggleIndex(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && indexOpen) { toggleIndex(false); indexBtn.focus(); } });
  }

  /* ───────────── in-page links: native smooth scroll (never hijacked) ───────────── */
  $$('[data-index-link], .hud__name, .hud__btn--solid, .services__list a, .stage__links a[href^="#"], [data-stage-more], .orbit-link a:not([data-orbit-open])').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || !id.startsWith('#')) return;
      const target = $(id); if (!target) return;
      e.preventDefault();
      if (indexOpen) toggleIndex(false);                        // overflow is released synchronously, so the scroll can start now
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', id);
    });
  });
  const top = $('[data-top]');
  if (top) top.addEventListener('click', (e) => { e.preventDefault(); scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); history.replaceState(null, '', '#orbit'); });

  /* ───────────── the red pen (a toy, not a service) ───────────── */
  const RULES = [
    ['for the modern consumer', 'for you'], ['for modern consumers', 'for you'], ['for businesses of all sizes', 'for everyone'],
    ['of all sizes', ''], ['in order to', 'to'], ['state-of-the-art', 'new'], ['cutting-edge', 'new'], ['cutting edge', 'new'],
    ['best-in-class', 'good'], ['best in class', 'good'], ['world-class', 'good'], ['world class', 'good'], ['next-generation', 'new'], ['next generation', 'new'], ['next-gen', 'new'],
    ['end-to-end', ''], ['going forward', ''], ['at scale', ''], ['a wide range of', ''], ['the future of', ''], ['one-stop shop', 'place'],
    ['game-changing', 'new'], ['data-driven', ''], ['ai-powered', ''], ['industry-leading', 'good'], ['mission-critical', 'important'],
    ['value-added', ''], ['customer-centric', ''], ['user-centric', ''], ['purpose-built', 'built'], ['designed to', 'to'],
    ['seamlessly', ''], ['seamless', ''], ['synergies', 'teamwork'], ['synergy', 'teamwork'], ['solutions', ''], ['solution', ''],
    ['innovative', ''], ['innovations', 'ideas'], ['innovation', 'ideas'], ['innovate', 'invent'], ['empowering', 'helping'], ['empowers', 'helps'], ['empower', 'help'],
    ['leveraging', 'using'], ['leverages', 'uses'], ['leverage', 'use'], ['utilizing', 'using'], ['utilising', 'using'], ['utilize', 'use'], ['utilise', 'use'],
    ['passionate about', 'good at'], ['passionate', ''], ['passion', 'care'], ['disruptive', 'new'], ['disrupting', 'changing'], ['disrupt', 'change'],
    ['revolutionary', 'new'], ['revolutionize', 'change'], ['revolutionise', 'change'], ['holistic', 'whole'], ['robust', 'solid'], ['scalable', ''],
    ['ecosystem', ''], ['journeys', 'ways'], ['journey', 'way'], ['unlocking', 'getting'], ['unlock', 'get'], ['elevating', 'lifting'], ['elevate', 'lift'],
    ['streamlining', 'simplifying'], ['streamline', 'simplify'], ['optimizing', 'improving'], ['optimising', 'improving'], ['optimize', 'improve'], ['optimise', 'improve'],
    ['transforming', 'changing'], ['transformative', ''], ['transformation', 'change'], ['transform', 'change'], ['experiences', 'things'], ['experience', ''],
    ['consumers', 'people'], ['customers', 'people'], ['individuals', 'people'], ['stakeholders', 'people'], ['enterprises', 'companies'], ['organizations', 'companies'], ['organisations', 'companies'],
    ['dynamic', ''], ['premium', 'good'], ['bespoke', 'custom'], ['tailored', 'custom'], ['comprehensive', 'full'], ['facilitate', 'help'], ['enabling', 'letting'], ['enable', 'let'],
    ['reimagining', 'rethinking'], ['reimagine', 'rethink'], ['redefining', 'changing'], ['redefine', 'change'], ['agile', 'quick'],
    ['effortlessly', 'easily'], ['effortless', 'easy'], ['frictionless', 'easy'], ['intuitive', 'simple'], ['powerful', ''], ['truly', ''], ['very', ''], ['really', ''], ['simply', ''],
  ];
  const SPECIAL = [
    ['passion', 'passion is not a flavour.'], ['seamless', 'nothing is seamless. things have seams; that’s how they’re made.'],
    ['synerg', 'synergy is what people say when they mean “we talked”.'], ['solution', 'nobody has ever wanted a solution. they wanted the problem gone.'],
    ['journey', 'it’s a checkout, not a journey.'], ['empower', 'you can’t empower anyone with a tagline.'], ['innovat', '“innovative” is a claim. show me the thing.'],
    ['leverage', '“leverage” is a noun that wandered.'], ['experience', 'everything is an experience. that’s why the word means nothing.'],
  ];
  const FALLBACK = ['Say what it does. Then stop.', 'It works. That’s the whole pitch.', 'Cheaper. Faster. Yours.', 'Less of this. More of what you meant.', 'We do the thing. Well.'];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function redPen(input) {
    let s = ' ' + input.trim().replace(/\s+/g, ' ') + ' ', killed = 0;
    const low = input.toLowerCase();
    for (const [from, to] of RULES) {
      const re = new RegExp(`(?<![\\w-])${esc(from)}(?![\\w-])${to === '' ? ',?' : ''}`, 'gi');
      s = s.replace(re, () => { killed++; return to; });
    }
    s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([,.;:!?]){2,}/g, '$1')
      .replace(/\b(and|of|for|with|to|the|a|an|our|your|their|that|which|through|by|in|on)\s+\1\b/gi, '$1')
      .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
      .replace(/\b(a) (?=[aeiou])/gi, 'an ').replace(/\b(an) (?=[^aeiou\s])/gi, 'a ')
      .replace(/\s+(and|of|for|with|to|the|a|an|our|your|their|that|which|through|by|in|on)$/i, '')
      .replace(/^(and|of|for|with|to|that|which|through|by)\s+/i, '')
      .replace(/\b(deliver|provide|offer|create|build|make|ship|delivering|providing|offering|creating|building|making|shipping)\s+(good|new|easy|simple|solid)$/i, '$1 $2 work');
    const words = s.split(' ').filter(Boolean);
    const gutted = killed > 0 && (words.length < 3 || killed >= words.length);
    const fallback = gutted || words.length < 2 || words.every((w) => /^(and|of|for|with|to|the|a|an|our|your|their|we|are|is|it)$/i.test(w));
    let out = fallback ? FALLBACK[(input.length + killed) % FALLBACK.length] : s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.!?]$/.test(out)) out += '.';
    let note = '';
    if (killed === 0 && !fallback) note = 'note: clean. either you’re good, or you’re already a client.';
    else {
      const sp = SPECIAL.find(([k]) => low.includes(k));
      const kept = fallback ? 0 : words.length;
      note = fallback
        ? `note: ${killed} ${killed === 1 ? 'word' : 'words'} killed. nothing survived, so I wrote you a new one.` + (sp ? ` ${sp[1]}` : '')
        : `note: ${killed} ${killed === 1 ? 'word' : 'words'} killed, ${kept} kept.` + (sp ? ` ${sp[1]}` : ' that’s the job.');
    }
    return { out, note };
  }

  const form = $('[data-redpen]');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#redpen-input', form), before = $('[data-redpen-before]', form), after = $('[data-redpen-after]', form), note = $('[data-redpen-note]', form);
    const val = inp.value.trim(); if (!val) return;
    const { out, note: n } = redPen(val);
    form.classList.remove('is-inked'); before.classList.remove('is-struck');
    before.textContent = val; after.textContent = out; note.textContent = n;
    void before.offsetWidth;                                     // commit the un-struck state as the transition start
    before.classList.add('is-struck'); form.classList.add('is-inked');   // the strike lands now, the line inks .5 s later (CSS delay)
  });

  /* ───────────── boot ───────────── */
  html.classList.add('is-loaded');
  // if the scene never booted (script blocked, threw, reduced motion) the stage's captioned grid must show
  const sceneCheck = () => { const st = $('[data-stage]'); if (st && !st.classList.contains('is-3d')) html.classList.add('no-scene'); };
  if (document.readyState === 'complete') sceneCheck(); else addEventListener('load', sceneCheck);
  mqReduce.addEventListener('change', (e) => { reduce = e.matches; html.classList.toggle('no-scene', reduce); document.dispatchEvent(new CustomEvent('motion:reduce', { detail: reduce })); });

  /* the seam motion.js plugs into: one loop, one scroll state, one measurer */
  window.AK = Object.freeze({ loop, scroll, measure: queueMeasure, get reduce() { return reduce; }, finePointer, docTop });
})();

