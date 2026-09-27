# Abhijeet Kanase — Portfolio

A single-page, story-format portfolio for **Abhijeet Kanase** — copywriter & creative strategist,
Mumbai. It opens on **the orbit**: every piece of work (pitch pages, statics, films, scripts, web
and email) turning on two rings around the first line. Below it, eight short chapters tell the
work, line by line — and a red pen closes the page. No frameworks, no dependencies.

## What's in this repo

| Path | What it is |
| --- | --- |
| `src/index.html` | **The page** — all the copy. The only file you edit for content. |
| `src/css/` | One stylesheet in ten files, concatenated in `<link>` order. |
| `src/main.js` · `motion.js` · `fluid.js` · `palettes.js` | Plain JS, no dependencies: page behaviour, the 3D orbit, the fluid background, the type-picker. |
| `assets/` | The fonts and the work — Bajaj statics & films, pitch-deck plates, script pages. |
| `index.dev.html` | **Generated.** The page in one readable file (styles + scripts inlined, assets external). |
| `index.html` | **Generated.** The standalone build — every font, image and film inlined as data URIs. Opens from a USB stick; hosts anywhere. |
| `tools/build.py` | Assembles the two published files from `src/` + `assets/` (Python stdlib only). |
| `DEPLOY.md` | How to publish it — GitHub Pages or any static host. |

## Editing & rebuilding

```bash
# 1. edit copy in src/index.html  (or add files to assets/ + a card in the orbit)
# 2. rebuild the two published files:
python3 tools/build.py          # writes index.dev.html and index.html  (~0.3 s)
python3 tools/build.py --check  # verify the published files match src/ — no writes
```

Never hand-edit `index.html` or `index.dev.html`. They are generated, the build is byte-deterministic,
and `--check` is how you notice drift: a diff in a published file is always a real change to the page.

## Adding a piece to the orbit

Drop the file in `assets/work/` and add one card in the opening `#orbit` section:

- pitch / script pages go in `[data-ring="in"]`, everything else in `[data-ring="out"]`
- `<figure class="stage__card" data-stage-card data-card-id="…">` — the `width`/`height`
  attributes on the `<img>`/`<video>` drive the card's aspect ratio
- the `<figcaption>` is the line that prints on hover and when the card opens
- films: 432×768 mp4 with a WebP poster, class `stage__card--film`

Then rebuild. The three arrangements (Scatter / Grid / Orbit) re-solve automatically for any count.
