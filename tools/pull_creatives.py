#!/usr/bin/env python3
"""
pull_creatives.py — the 4K creatives pull.

Downloads the latest creatives from the shared Drive folders (public, no
login), renders the decks/documents to high-resolution plates, optimises
every photo to a web-ready 2560 px WebP, and wires them into the orbit —
replacing the low-res plates in place and adding the new pieces (Luna
product creatives, KokoonLabs, LumiCell, Safe-to-touch, the NYE film).

    python3 tools/pull_creatives.py --dry-run     # show the plan, touch nothing
    python3 tools/pull_creatives.py               # download → optimise → render → wire
    python3 tools/pull_creatives.py --wire-only   # re-wire from files already on disk

Needs: python3 stdlib. For the best results: Pillow (pip install pillow)
or node+npm (sharp) for WebP; PyMuPDF (pip install pymupdf) or poppler
(pdftoppm) for PDF decks; ffmpeg to cut film posters. Missing tools
degrade gracefully — raw files land and are listed at the end.

Then:

    python3 tools/build.py
    git add -A && git commit -m "4K creatives in the orbit" && git push

Sources (Drive, all public):
  Bajaj Electricals            1OzNdE9K5SSNB_XjuiayuLIWeGiD8pn94 (+ Spotify WRAPPED 2025)
  Simple Website Copy          1UJaUq2S3FuSNqeKy7i2kwS8Ng5_5OWHh  (NYC · KokoonLabs · LumiCell)
  Luna by Khush - Creatives    1w9vNIrzeCfBcEpzj_LlcAxsfM_4DXUvR  (+ Sample Emails)
  Brand Work: Zoo Media        15Oaizbz-J8TNDzukAirXgFnGJk5_B-mz  (Surf + Boult decks)
  Short form Scripts           1U9p-vXNZAwqOb5E3P5rMUWybOFjEmis0  (derek · harshit · jobcoach)
"""
from __future__ import annotations

import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_HTML = os.path.join(ROOT, 'src', 'index.html')
WORK = os.path.join(ROOT, 'assets', 'work')
PLATES = os.path.join(WORK, 'plates')
FILMS = os.path.join(WORK, 'films')
DRIVE_DL = 'https://drive.google.com/uc?export=download&id={id}'

MAX_EDGE = 2560      # sources are 4K; 2560 px is crisp at every size the page ever draws
WEBP_Q = 80

DRY = '--dry-run' in sys.argv[1:]
WIRE_ONLY = '--wire-only' in sys.argv[1:]

# ── the decks (page = slide number; the orbit captions already name the slides) ─────────────

SURF_DECK = ('15u3lHOAreipBXIMCH0u58UlqNL9WarHj',
             [('24', 'surf-24-paglus'), ('28', 'surf-28-stain-story'), ('38', 'surf-38-horoscopes'),
              ('39', 'surf-39-stain-bios'), ('40', 'surf-40-this-or-that'), ('65', 'surf-65-bingo')])
BOULT_DECK = ('1Mm7qb1AUaEcm9eso-sowEeJVFwzFDcb0',
              [('25', 'boult-25-mouth'), ('8', 'boult-08-name-hides'), ('27', 'boult-27-posters'),
               ('30', 'boult-30-billboard-viral'), ('45', 'boult-45-roar-thump'),
               ('54', 'boult-54-team-belly'), ('55', 'boult-55-sirf-fein'), ('56', 'boult-56-eras-tour')])

# ── photos: drive id → asset base (replaces the low-res file on disk + in the html) ─────────

PHOTOS = [
    # Bajaj stills — Drive originals replace the 720×900 jpgs
    ('1-YilpKfHxB29ADktaQg81guPQfgqBfSl', 'bajaj-lohri'),
    ('18-BIVSS_Ma7kNlXqGsGoSTFTFh3r4JuP', 'bajaj-sankranti'),
    ('1QC6hzK8YgWNdpT_dltAhsdgazr3v6y3-', 'bajaj-summer'),
    ('1kt9Dv93xgHiMsOf2hR3sptEBMoV0x3X-', 'bajaj-gracio'),
    ('1RL-JlWthiPf3VyNbiJBdbPOSk1Koe5QL', 'bajaj-contempo'),
    # the Wrapped series
    ('16dmiMnkLRUEiX5rXSLWM-xeFI4PqoKBH', 'bajaj-wrapped-1'),
    ('1Qq9fmLYzygF9onlGg7vgaNW09JDfEJc3', 'bajaj-wrapped-2'),
    ('1Et2aWh0GR5KDDjNZ_X3QScArhCNML5U8', 'bajaj-wrapped-3'),
    ('1IIfIHMCqd3xS1U-rHTvi3Zz-bbSeZlac', 'bajaj-wrapped-4'),
    ('1n3iOECqsK2nHC-o1_NulKEj0TOVibPoI', 'bajaj-wrapped-5'),
    # Vanilla Noir — the case-study folder's webpage shot replaces the 899×518 jpg
    ('1jwACcVWoU0iDJthTIJPQ023DG4Y-eDdp', 'vanilla-noir'),
]

# ── documents: drive id → (target plate base, page) — re-rendered at 2560 px ────────────────

DOCS = [
    ('1jmu8QC9gJ8CQFVJ7Oi-FA6pQqXEZ_Pzy', 'nyc-01', 1),          # NYC - Basic Website v1.pdf
    ('1xaTsoisKtfvxNoDSJbEvoY7dxgEn7UYm', 'luna-01', 1),         # founder-led brand storytelling email
    ('1UHcaIVi4Pm7suI5odeOaDG8nM90iqfzz', 'derek-01', 1),        # DEREK - IG SCRIPTS.pdf
    ('1UCZF1U4CJBLgYa3j-LZX3pKGVeJf-PDF', 'harshit-01', 1),      # Harshit - IG SCRIPTS.pdf
    ('1TFR2x5LFmsR-vkapEs3sQnLm0_RkERtp', 'jobcoach-01', 1),     # Job Coach Scripts.pdf
    ('1dGeF2JZGzL01cTN60o_F9agT96p1zkJL', 'kokoon-01', 1),       # KokoonLabs - WebCopy - v3.pdf  (NEW card)
    ('1yOx3wh8d9s17kJEnztvyc54AySest0mg', 'lumicell-01', 1),     # LumiCell - Renewal Serum.pdf  (NEW card)
]

# ── new orbit cards ──────────────────────────────────────────────────────────────────────────

LUNA_K = 'Luna by Khush \u00b7 Product creative \u00b7 2025'
LUNA_CREATIVES = [  # drive id, target base, caption
    ('1Hn68ot-PrjddXG6WdyW1YpKCdbKbvyku', 'luna-eyeshadow', 'The Eyeshadow + Smudger — the duo.'),
    ('1ltCals_Z4Ier5VltqdXOsv57ds2w7KuQ', 'luna-gaze', 'Eyeshadow gaze — the look.'),
    ('1e74rlne_NMhLQh1NZY-CNIl82cob2krk', 'luna-flawless', 'Flawless smudge.'),
    ('1ktwfs5keS9HuVSQ3Qebv3vEOIpb4CoGS', 'luna-reviews', 'Luna Reviews — the proof wall.'),
    ('1BwcvXDmU0wDp8-wnXSGAv3HPcj-PkNLd', 'luna-water', 'The Smudger, in water.'),
]
SAFE_TOUCH = ('15N83A-RMRx8lrUs4iSvfJ9oo-6QCEnIz', 'bajaj-safe-to-touch',
              'Bajaj Electricals \u00d7 Zoo Media \u00b7 Product post \u00b7 2025', 'Safe to touch.')
NYE_FILM = ('1aGqLstphS2oD_OTSdowCEhJD8dU4J8G7', 'bajaj-nye',
            'Bajaj Electricals \u00d7 Zoo Media \u00b7 Film \u00b7 2025', 'New Year\u2019s Eve.')
NYE_THUMBS = [  # Drive's own video thumbnail (poster fallback when ffmpeg is absent)
    'https://lh3.googleusercontent.com/drive-storage/AJQWtBMXacHH_nf4oD4sgISfVWT2ZV_lGwUsH7gst4R9B_qOyObioHSWkTCwknyoRKqVXDWFjlte64PkInhpw59gkMZLP2ms4eZQQDYLUWw-=s16000',
    'https://lh3.googleusercontent.com/drive-storage/AJQWtBMXacHH_nf4oD4sgISfVWT2ZV_lGwUsH7gst4R9B_qOyObioHSWkTCwknyoRKqVXDWFjlte64PkInhpw59gkMZLP2ms4eZQQDYLUWw-=s190',
]

# films that replace the ones already in the orbit, in place (same filename)
FILM_REPLACE = [
    ('17VqXUG_noJKnGKZ9Yt4B8-5YN5xx7iuF', 'films/bajaj-auto-shut-off.mp4'),   # Auto Shut Down.mp4
    ('1VChA7rnk-YZRpNQsS05e3h0vcMPDxI4-', 'films/bajaj-new-year.mp4'),        # NEW YEAR_2.mp4
]

def log(kind: str, msg: str) -> None:
    print(f'  [{kind:7s}] {msg}')


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def download(drive_id: str, dest: str) -> int:
    """Public Drive download; handles the large-file confirm page."""
    data = fetch(DRIVE_DL.format(id=drive_id))
    if data.lstrip()[:1] == b'<':
        m = re.search(rb'<form[^>]+action="([^"]+)"', data)
        if m:
            data = fetch(urllib.parse.urljoin('https://drive.google.com', m.group(1).decode()))
        if data.lstrip()[:1] == b'<':
            raise RuntimeError(f'Drive download failed for id {drive_id}')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(data)
    return len(data)


def save_url(url: str, dest: str) -> int:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(fetch(url))
    return os.path.getsize(dest)


def image_size(path: str) -> tuple[int, int] | None:
    """Pure-stdlib dimensions for PNG / JPEG / WebP."""
    with open(path, 'rb') as f:
        data = f.read(65536)
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', data[16:24])
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        if data[12:16] == b'VP8X':
            return 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little')
        if data[12:16] == b'VP8L':
            b = data[21:25]
            return 1 + (((b[1] & 0x3F) << 8) | b[0]), 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
        if data[12:16] == b'VP8 ':
            return struct.unpack('<HH', data[26:30])[::-1]
    if data[:2] == b'\xff\xd8':
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack('>HH', data[i + 5:i + 9])
                return w, h
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    return None


# ── optimisation: 4K source → 2560 px WebP ───────────────────────────────────────────────────

def _via_pillow(src: str, dest_base: str) -> tuple[str, int, int] | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    im = Image.open(src)
    w, h = im.size
    scale = min(1.0, MAX_EDGE / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    if im.mode not in ('RGB', 'RGBA', 'L'):
        im = im.convert('RGB')
    out = dest_base + '.webp'
    im.save(out, 'WEBP', quality=WEBP_Q, method=4)
    return out, im.size[0], im.size[1]


def _via_sharp(src: str, dest_base: str) -> tuple[str, int, int] | None:
    node, npm = shutil.which('node'), shutil.which('npm')
    if not (node and npm):
        return None
    prefix = os.path.join(ROOT, 'tools', '.sharp')
    os.makedirs(prefix, exist_ok=True)
    if not os.path.exists(os.path.join(prefix, 'node_modules', 'sharp')):
        try:
            subprocess.run([npm, 'i', '--prefix', prefix, '--no-save', '--no-audit', '--no-fund', 'sharp'],
                           check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            return None
    out = dest_base + '.webp'
    sharp_dir = os.path.join(prefix, 'node_modules', 'sharp').replace('\\', '/')
    js = (f"const s=require('{sharp_dir}');(async()=>{{"
          f"await s('{src}'.replace(/\\/g,'/')).rotate()"
          f".resize({{width:{MAX_EDGE},withoutEnlargement:true}})"
          f".webp({{quality:{WEBP_Q}}}).toFile('{out}'.replace(/\\/g,'/'));"
          f"const md=await s('{out}'.replace(/\\/g,'/')).metadata();"
          f"process.stdout.write(md.width+'x'+md.height);}})().catch(()=>process.exit(3));")
    try:
        p = subprocess.run([node, '-e', js], capture_output=True, text=True, timeout=600,
                           env={**os.environ, 'NODE_PATH': os.path.join(prefix, 'node_modules')})
        if p.returncode != 0 or not p.stdout.strip():
            return None
        w, h = (int(x) for x in p.stdout.strip().split('x')[:2])
        return out, w, h
    except Exception:
        return None


def _via_cwebp(src: str, dest_base: str) -> tuple[str, int, int] | None:
    cwebp = shutil.which('cwebp')
    if not cwebp:
        return None
    size = image_size(src)
    if not size:
        return None
    w, h = size
    scale = min(1.0, MAX_EDGE / max(w, h))
    out = dest_base + '.webp'
    try:
        subprocess.run([cwebp, '-q', str(WEBP_Q), '-resize', str(round(w * scale)), str(round(h * scale)),
                        src, '-o', out, '-quiet'], check=True, timeout=600,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return out, round(w * scale), round(h * scale)
    except Exception:
        return None


def optimize(src: str, dest_base: str) -> tuple[str, int, int]:
    """Returns (path, w, h). Tries Pillow → sharp → cwebp → the file as-is."""
    for fn in (_via_pillow, _via_sharp, _via_cwebp):
        try:
            r = fn(src, dest_base)
            if r:
                return r
        except Exception:
            pass
    ext = os.path.splitext(src)[1] or '.jpg'
    out = dest_base + ext
    shutil.copyfile(src, out)
    size = image_size(out)
    log('keep', f'{os.path.basename(out)} — no image tool found, file kept as-is '
                f'(pip install pillow for the WebP pass)')
    return out, *(size or (0, 0))


# ── PDF → plate (page N at 2560 px) ──────────────────────────────────────────────────────────

def render_pdf_page(pdf: str, page: int, dest_base: str) -> tuple[str, int, int] | None:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(pdf)
        if page > len(doc):
            log('skip', f'{os.path.basename(pdf)} has {len(doc)} pages, not {page}')
            return None
        rect = doc[page - 1].rect
        zoom = min(MAX_EDGE / rect.width, MAX_EDGE / rect.height)
        pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        raw = dest_base + '-raw.png'
        pix.save(raw)
        out, w, h = optimize(raw, dest_base)
        os.remove(raw)
        return out, w, h
    except ImportError:
        pass
    except Exception as e:
        log('skip', f'pymupdf failed on {os.path.basename(pdf)}: {e}')
        return None
    if shutil.which('pdftoppm'):
        try:
            prefix = dest_base + '-ppm'
            subprocess.run(['pdftoppm', '-png', '-f', str(page), '-l', str(page), '-r', '200',
                            pdf, prefix], check=True, timeout=600, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
            cand = next((c for c in (f'{prefix}-{page}.png', f'{prefix}-{page:02d}.png', prefix + '.png')
                         if os.path.exists(c)), None)
            if cand:
                out, w, h = optimize(cand, dest_base)
                os.remove(cand)
                return out, w, h
        except Exception:
            pass
    log('skip', f'no PDF renderer for {os.path.basename(pdf)} (pip install pymupdf, or install poppler)')
    return None


def poster_from_video(mp4: str, out: str) -> bool:
    if not shutil.which('ffmpeg'):
        return False
    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '0.8', '-i', mp4, '-frames:v', '1',
                        '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,'
                               'pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black',
                        out], timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return os.path.exists(out)
    except Exception:
        return False


# ── wiring: src/data/pieces.json → orbit + case logs + piece pages (idempotent) ──
#
# pieces.json is the single content config (see tools/gen_orbit.py). Wire updates it with
# whatever landed on disk, then regenerates the orbit rings + counts (gen_orbit), the chapter
# case logs (gen_log) and the piece pages (gen_pieces). Hand-kept HTML (the worklist stills)
# gets its width/height refreshed for every replaced asset, all occurrences.

def plan() -> list[dict]:
    items = []
    for deck_id, pages in (SURF_DECK, BOULT_DECK):
        for pg, base in pages:
            items.append(dict(kind='deck', deck=deck_id, page=pg, base=f'plates/{base}',
                              old=f'assets/work/plates/{base}.webp', new=f'assets/work/plates/{base}.webp'))
    for did, base in PHOTOS:
        items.append(dict(kind='photo', did=did, base=base,
                          old=f'assets/work/{base}.jpg', new=f'assets/work/{base}.webp'))
    for did, base, page in DOCS:
        items.append(dict(kind='doc', did=did, page=page, base=f'plates/{base}',
                          old=f'assets/work/plates/{base}.webp', new=f'assets/work/plates/{base}.webp'))
    for did, base, cap in LUNA_CREATIVES:
        items.append(dict(kind='luna', did=did, base=base, cap=cap,
                          old=f'assets/work/{base}.webp', new=f'assets/work/{base}.webp'))
    items.append(dict(kind='safe', did=SAFE_TOUCH[0], base=SAFE_TOUCH[1],
                      old=f'assets/work/{SAFE_TOUCH[1]}.webp', new=f'assets/work/{SAFE_TOUCH[1]}.webp'))
    items.append(dict(kind='nye-film', did=NYE_FILM[0], new='assets/work/films/bajaj-nye.mp4'))
    for did, rel in FILM_REPLACE:
        items.append(dict(kind='film-replace', did=did, new=f'assets/work/{rel}'))
    return items


def _first_out_index(pieces: list) -> int:
    for i, p in enumerate(pieces):
        if p['ring'] == 'out':
            return i
    return len(pieces)


def wire(done: dict, skipped: list) -> None:
    import json
    pieces_path = os.path.join(ROOT, 'src', 'data', 'pieces.json')
    with open(pieces_path, encoding='utf8') as f:
        pieces = json.load(f)['pieces']
    ids = {p['id'] for p in pieces}
    s = open(SRC_HTML, encoding='utf8').read()
    original = s
    replaced = added = 0

    # 1 · replaces (deck plates, 4K photos, pdf docs): src + dimensions in the config
    for it in plan():
        if it['kind'] not in ('deck', 'photo', 'doc', 'luna', 'safe'):
            continue
        if it['base'] not in done:
            continue
        p, w, h = done[it['base']]
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        stem = os.path.splitext(os.path.basename(it['old']))[0]
        for pc in pieces:
            if pc['id'] == stem:
                pc['src'] = rel
                if pc['kind'] == 'static':
                    pc['w'], pc['h'] = w, h
                replaced += 1
                break
        if it['old'] != it['new'] and it['old'] in s:
            s = s.replace(it['old'], rel)
        for name in (os.path.basename(it['old']), os.path.basename(rel)):
            pat_w = re.compile(r'(<img[^>]*src="[^"]*' + re.escape(name) + r'[^"]*"[^>]*?)width="\d+"', re.S)
            pat_h = re.compile(r'(<img[^>]*src="[^"]*' + re.escape(name) + r'[^"]*"[^>]*?)height="\d+"', re.S)
            s = pat_w.sub(lambda m: m.group(1) + f'width="{w}"', s)
            s = pat_h.sub(lambda m: m.group(1) + f'height="{h}"', s)

    # 2 · adds: new pieces into the config (front of the outer ring, as before)
    cands = []
    for _did, base, cap in LUNA_CREATIVES:
        if base in done:
            p, w, h = done[base]
            cands.append(dict(id=base, ring='out', kind='static',
                              src=os.path.relpath(p, ROOT).replace(os.sep, '/'), w=w, h=h,
                              k=LUNA_K, href='#side', alt=cap, cap=cap))
    for key, base, k, href, alt, cap in (
            ('plates/kokoon-01', 'kokoon-01', 'KokoonLabs \u00b7 Website copy, v3 \u00b7 2026', '#side',
             'KokoonLabs \u2014 the website copy, version three.', 'KokoonLabs \u2014 the website copy, version three.'),
            ('plates/lumicell-01', 'lumicell-01', 'LumiCell \u00b7 Product page copy \u00b7 2025', '#side',
             'The Renewal Serum \u2014 the product page.', 'The Renewal Serum \u2014 the product page.')):
        if key in done:
            p, w, h = done[key]
            cands.append(dict(id=base, ring='out', kind='static',
                              src=os.path.relpath(p, ROOT).replace(os.sep, '/'), w=w, h=h,
                              k=k, href=href, alt=alt, cap=cap))
    if SAFE_TOUCH[1] in done:
        p, w, h = done[SAFE_TOUCH[1]]
        cands.append(dict(id=SAFE_TOUCH[1], ring='out', kind='static',
                          src=os.path.relpath(p, ROOT).replace(os.sep, '/'), w=w, h=h,
                          k=SAFE_TOUCH[2], href='#ch8', alt=SAFE_TOUCH[3], cap=SAFE_TOUCH[3]))
    if 'nye' in done:
        cands.append(dict(id='bajaj-nye', ring='out', kind='film',
                          src='assets/work/films/bajaj-nye.mp4', poster=done['nye'][0],
                          k=NYE_FILM[2], href='#ch8', aria='Bajaj New Year\u2019s Eve film', cap=NYE_FILM[3]))
    at = _first_out_index(pieces)
    for c in cands:
        if c['id'] not in ids:
            pieces.insert(at, c)
            ids.add(c['id'])
            added += 1
            at += 1

    if replaced or added or s != original:
        with open(pieces_path, 'w', encoding='utf8') as f:
            json.dump({'pieces': pieces}, f, ensure_ascii=False, indent=2)
            f.write('\n')

    # 3 · regenerate: orbit + counts from the config, then logs, then piece pages
    import gen_log, gen_orbit, gen_pieces
    s2 = gen_orbit.generate(s, pieces)
    if s2 != original:
        open(SRC_HTML, 'w', encoding='utf8').write(s2)
        log('wire', f'src/index.html rewired ({len(pieces)} cards)')
    elif s != original:
        open(SRC_HTML, 'w', encoding='utf8').write(s)
        log('wire', 'worklist stills refreshed (orbit already matched)')
    else:
        log('wire', 'no changes (already wired)')
    gen_log.generate()
    gen_pieces.generate()
    log('wire', f'config: {replaced} replaced, {added} added, {len(pieces)} pieces total')


# ── main ─────────────────────────────────────────────────────────────────────────────────────

def main() -> None:
    print('pull_creatives.py — 4K creatives → the orbit' + ('   [dry run]' if DRY else ''))
    items = plan()

    if DRY:
        for it in items:
            if it['kind'] == 'deck':
                log('plan', f"deck p.{it['page']} → {it['new']}")
            elif it['kind'] == 'photo':
                log('plan', f"{it['base']}: 4K photo → {it['new']}")
            elif it['kind'] == 'doc':
                log('plan', f"pdf p.{it['page']} → {it['new']}")
            elif it['kind'] == 'luna':
                log('plan', f'NEW card {it["base"]}')
            elif it['kind'] == 'safe':
                log('plan', 'NEW card bajaj-safe-to-touch (2025)')
            elif it['kind'] == 'nye-film':
                log('plan', 'NEW film card bajaj-nye (2025)')
            else:
                log('plan', f"film in place → {it['new']}")
        log('plan', 'wires: src/data/pieces.json → orbit + case logs + piece pages (32 → 41)')
        return

    if WIRE_ONLY:
        done: dict = {}
        for it in items:
            rel = it.get('new')
            if not rel or not os.path.exists(os.path.join(ROOT, rel)):
                continue
            if rel == 'assets/work/films/bajaj-nye.mp4':
                poster = os.path.join(ROOT, 'assets/work/films/bajaj-nye.webp')
                if os.path.exists(poster):
                    done['nye'] = ('assets/work/films/bajaj-nye.webp', 432, 768)
                continue
            key = it.get('base', rel)
            sz = image_size(os.path.join(ROOT, rel)) or (0, 0)
            done[key] = (os.path.abspath(rel), *sz)
        print(f'  wire-only: {len(done)} assets found on disk')
        wire(done, [])
        return

    os.makedirs(PLATES, exist_ok=True)
    os.makedirs(FILMS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='creatives-')
    done: dict[str, tuple[str, int, int]] = {}   # item key → (abs path, w, h)
    skipped: list[str] = []

    # 1 · the decks
    for deck_id, pages in (SURF_DECK, BOULT_DECK):
        pdf = os.path.join(tmp, 'deck.pdf')
        try:
            n = download(deck_id, pdf)
            log('fetch', f'deck {deck_id[:10]}… ({n / 1e6:.1f} MB)')
        except Exception as e:
            log('fail', f'deck {deck_id[:10]}… — {e}')
            continue
        for pg, base in pages:
            r = render_pdf_page(pdf, int(pg), os.path.join(WORK, f'plates/{base}'))
            key = f'plates/{base}'
            if r:
                done[key] = (r[0], r[1], r[2])
                log('plate', f'{base} p.{pg} → {r[1]}×{r[2]}')
            else:
                skipped.append(f'deck page {pg} ({base})')
        os.remove(pdf)

    # 2 · the photos
    for did, base in PHOTOS:
        src = os.path.join(tmp, f'{base}.src')
        try:
            n = download(did, src)
            log('fetch', f'{base} ({n / 1e6:.1f} MB)')
        except Exception as e:
            log('fail', f'{base} — {e}')
            skipped.append(base)
            continue
        r = optimize(src, os.path.join(WORK, base))
        done[base] = (r[0], r[1], r[2])
        log('photo', f'{base} → {os.path.basename(r[0])} {r[1]}×{r[2]} ({os.path.getsize(r[0]) / 1e3:.0f} KB)')
        os.remove(src)

    # 3 · the documents
    for did, base, page in DOCS:
        pdf = os.path.join(tmp, f'{base}.pdf')
        try:
            n = download(did, pdf)
            log('fetch', f'{base} ({n / 1e6:.2f} MB)')
        except Exception as e:
            log('fail', f'{base} — {e}')
            skipped.append(base)
            continue
        r = render_pdf_page(pdf, page, os.path.join(WORK, f'plates/{base}'))
        os.remove(pdf)
        if r:
            done[f'plates/{base}'] = (r[0], r[1], r[2])
            log('plate', f'{base} → {r[1]}×{r[2]}')
        else:
            skipped.append(f'{base} (pdf)')

    # 4 · luna creatives + safe-to-touch
    for did, base, _cap in LUNA_CREATIVES:
        src = os.path.join(tmp, f'{base}.src')
        try:
            n = download(did, src)
            log('fetch', f'{base} ({n / 1e6:.1f} MB)')
        except Exception as e:
            log('fail', f'{base} — {e}')
            skipped.append(base)
            continue
        r = optimize(src, os.path.join(WORK, base))
        done[base] = (r[0], r[1], r[2])
        log('photo', f'{base} → {r[1]}×{r[2]}')
        os.remove(src)

    did, base, _k, _cap = SAFE_TOUCH
    src = os.path.join(tmp, f'{base}.src')
    try:
        n = download(did, src)
        log('fetch', f'{base} ({n / 1e6:.1f} MB)')
    except Exception as e:
        log('fail', f'{base} — {e}')
        skipped.append(base)
    else:
        r = optimize(src, os.path.join(WORK, base))
        done[base] = (r[0], r[1], r[2])
        log('photo', f'{base} → {r[1]}×{r[2]}')
        os.remove(src)

    # 5 · films
    for did, rel in FILM_REPLACE:
        dest = os.path.join(WORK, rel)
        try:
            n = download(did, dest)
            log('film', f'{rel} → {n / 1e6:.1f} MB')
        except Exception as e:
            log('fail', f'{rel} — {e}')
            skipped.append(rel)
    if os.path.exists(os.path.join(WORK, 'films/bajaj-new-year.mp4')) and poster_from_video(
            os.path.join(WORK, 'films/bajaj-new-year.mp4'),
            os.path.join(WORK, 'films/bajaj-new-year.webp')):
        log('poster', 'bajaj-new-year.webp cut from NEW YEAR_2')

    did, base, _k, _cap = NYE_FILM
    nye_mp4 = os.path.join(WORK, f'films/{base}.mp4')
    try:
        n = download(did, nye_mp4)
        log('film', f'{base}.mp4 → {n / 1e6:.1f} MB')
        poster = None
        if poster_from_video(nye_mp4, os.path.join(WORK, f'films/{base}.webp')):
            poster = f'assets/work/films/{base}.webp'
            log('poster', f'{base} poster cut from the film')
        if poster is None:  # no ffmpeg — fall back to Drive's video thumbnail
            for url in NYE_THUMBS:
                cand = os.path.join(WORK, f'films/{base}-thumb.src')
                try:
                    save_url(url, cand)
                    if image_size(cand):
                        r = optimize(cand, os.path.join(WORK, f'films/{base}'))
                        poster = 'assets/work/films/' + os.path.basename(r[0])
                        log('poster', f'{base} poster {r[1]}×{r[2]} (Drive thumbnail)')
                        break
                except Exception:
                    continue
                finally:
                    if os.path.exists(cand):
                        os.remove(cand)
        if poster:
            done['nye'] = (poster, 432, 768)
    except Exception as e:
        log('fail', f'{base} film — {e}')
        skipped.append(base)
        if os.path.exists(nye_mp4):
            os.remove(nye_mp4)

    shutil.rmtree(tmp, ignore_errors=True)
    wire(done, skipped)

    # 6 · report
    print()
    print('  landed:')
    for k in sorted(done):
        p, w, h = done[k]
        pp = p if os.path.isabs(p) else os.path.join(ROOT, p)
        print(f'    {os.path.relpath(pp, ROOT):44s} {w}×{h}  {os.path.getsize(pp) / 1e3:.0f} KB')
    if skipped:
        print('  skipped (re-run after fixing the tool/network):')
        for sk in skipped:
            print(f'    {sk}')
    html = open(SRC_HTML, encoding='utf8').read()
    olds = [it['old'] for it in plan()
            if it.get('old') and it['old'] != it['new']
            and os.path.exists(os.path.join(ROOT, it['old']))
            and it['old'] not in html]
    if olds:
        print('  stale now (referenced nowhere — delete when happy):')
        for o in olds:
            print(f'    {o}')
    print()
    print('  next:  python3 tools/build.py && git add -A && git commit && git push')


if __name__ == '__main__':
    main()
