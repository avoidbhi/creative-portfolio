#!/usr/bin/env python3
"""
pull_work.py — pull the latest work from the shared Drive folder and wire it into the orbit.

    python3 tools/pull_work.py            # updated Bajaj work + WWC scripts + finance/creator scripts
    python3 tools/pull_work.py --dry-run  # show what would be downloaded / rendered / wired

Then rebuild and commit:

    python3 tools/build.py

What it does, in order:
  1. downloads the updated Bajaj pieces — the Safe-to-touch static, the NYE film and the
     NEW YEAR_2 cut (which replaces the current New Year film in place), from the public
     Drive folder (no login needed);
  2. renders page 1 of the ICC WWC 2025 player scripts (.docx) and the finance / creator
     scripts (.pdf) into plates under assets/work/plates/. PDFs need PyMuPDF
     (`pip install pymupdf`) or poppler's pdftoppm; .docx needs LibreOffice (soffice).
     A document without a renderer is skipped and listed at the end;
  3. wires the new orbit cards, the WWC orbit link and the piece counts into
     src/index.html — idempotent, and counts are recomputed from what actually landed,
     so a partial run can never leave a broken build;
  4. prints what is left for a human (e.g. a film poster when ffmpeg is missing).
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

DRY = '--dry-run' in sys.argv[1:]
BASE_COUNT = 32  # cards already in src/index.html (after the kettle + home-stories removals)

# ── the updated work: Drive file id → (target, label) ────────────────────────────────────────

BAJAJ = [
    ('15N83A-RMRx8lrUs4iSvfJ9oo-6QCEnIz', 'bajaj-safe-to-touch.png',
     'Bajaj Electricals × Zoo Media · Product post · 2026', 'Safe to touch.'),
    ('1aGqLstphS2oD_OTSdowCEhJD8dU4J8G7', 'films/bajaj-nye.mp4',
     'Bajaj Electricals × Zoo Media · Film · 2026', 'New Year’s Eve.'),
    ('1VChA7rnk-YZRpNQsS05e3h0vcMPDxI4-', 'films/bajaj-new-year.mp4',
     'Bajaj Electricals × Zoo Media · Film · 2026', 'replace the New Year film in place'),
]
# Drive video-preview thumbnail (folder listing) for the NYE film, poster fallback:
NYE_THUMBS = [
    'https://lh3.googleusercontent.com/drive-storage/AJQWtBMXacHH_nf4oD4sgISfVWT2ZV_lGwUsH7gst4R9B_qOyObioHSWkTCwknyoRKqVXDWFjlte64PkInhpw59gkMZLP2ms4eZQQDYLUWw-=s16000',
    'https://lh3.googleusercontent.com/drive-storage/AJQWtBMXacHH_nf4oD4sgISfVWT2ZV_lGwUsH7gst4R9B_qOyObioHSWkTCwknyoRKqVXDWFjlte64PkInhpw59gkMZLP2ms4eZQQDYLUWw-=s190',
]

WWC = [  # ICC Women’s World Cup 2025 — one player script per player (.docx)
    ('1VWD9TScsP871U9_rJeNzD9l8CfhphfJ2', 'wwc-smriti', 'Smriti Mandhana'),
    ('1qwGcs0_cjtcbWPNculA1BL_hpNdzIgH-', 'wwc-jemimah', 'Jemimah Rodrigues'),
    ('1N8IWuVfmCQRsNoTSZf2srLSX3MkqIJ_t', 'wwc-amelia-kerr', 'Amelia Kerr'),
    ('1odY9bXBJioLScy4Sln6PxU9ZUYJrVH8', 'wwc-sophie-ecclestone', 'Sophie Ecclestone'),
    ('1Ukto4iRXAfWFcZrqs-Nkqsxf3F-cNxA-', 'wwc-ashleigh-gardner', 'Ashleigh Gardner'),
    ('1z2k6J0ZjFwIktbgVVfLzQRUeHmVxWgU0', 'wwc-harshita', 'Harshita Samavikrama'),
    ('1cBR4ntJyT61EnylbU15KuCKLm9vkgXjz', 'wwc-fatima-sana', 'Fatima Sana'),
    ('1O1o6nE-Wp6NsHFSupdyyhLyPr42Wbthm', 'wwc-laura-wolvaardt', 'Laura Wolvaardt'),
    ('1ocQlJvz4IfvolZI6NV__yUnpTm-858mH', 'wwc-sarah-glenn', 'Sarah Glenn'),
    ('10nO-mK_NylsxWEBDwZFf5mQ9tVUwIyCF', 'wwc-nigar-jyoti', 'Nigar Sultana Jyoti'),
]

HOOKS = [  # finance / creator scripts (.pdf), hook-lab chapter
    ('1WQLHS1ma4jfyVYxppBqSlS29P4XlDYqv', 'hook-gaurav', 'Gaurav Mahavar — the scripts, p.1'),
    ('1O-U45AOk8E2jgZoN-3LogrBolZj6rUBe', 'hook-credit-card', 'Credit card — the finance reel'),
    ('1VW3NywF6YjBuWKTJ2NYVY9LzAPLKQgxU', 'hook-emergency-fund', 'Emergency fund — the finance reel'),
    ('10o0g4qeypED7_UADrRHtCPDZqh6Gwc8a', 'hook-retirement', 'Retirement funds — the finance reel'),
    ('1qEqmnkUydnGfSBjiZBll7R_lkuHFZmLM', 'hook-tariff', 'The tariff question — the finance reel'),
    ('1k9Sc3mLnQOO_LA4xM6tNpaOS-S_mIgTE', 'hook-ipo', 'Upcoming IPO — the finance reel'),
]

NUM = {2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
       9: 'Nine', 10: 'Ten', 11: 'Eleven', 12: 'Twelve', 13: 'Thirteen', 14: 'Fourteen'}

skipped: list[str] = []
noted: list[str] = []


def log(kind: str, msg: str) -> None:
    print(f'  [{kind:7s}] {msg}')


# ── drive download (public link; handles the large-file confirm page) ────────────────────────

def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def download(drive_id: str, dest: str) -> int:
    data = fetch(DRIVE_DL.format(id=drive_id))
    if data.lstrip()[:1] == b'<':  # HTML → confirm page (large file) or an error
        m = re.search(rb'<form[^>]+action="([^"]+)"', data)
        if m:
            data = fetch(urllib.parse.urljoin('https://drive.google.com', m.group(1).decode()))
        if data.lstrip()[:1] == b'<':
            raise RuntimeError(f'Drive download failed for id {drive_id}')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(data)
    return len(data)


# ── plate rendering (page 1 of a document → one image) ──────────────────────────────────────

def png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', data[16:24])
    return None


def render_pdf_first_page(pdf: str, out_base: str) -> tuple[str, int, int] | None:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(pdf)
        pix = doc[0].get_pixmap(dpi=150)
        for ext in ('.webp', '.png'):
            try:
                out = out_base + ext
                pix.save(out)
                return out, pix.width, pix.height
            except Exception:
                continue
    except ImportError:
        pass
    if shutil.which('pdftoppm'):
        prefix = out_base + '-ppm'
        subprocess.run(['pdftoppm', '-png', '-f', '1', '-l', '1', '-r', '150', pdf, prefix],
                       check=True, timeout=180)
        for cand in (prefix + '-1.png', prefix + '.png'):
            if os.path.exists(cand):
                data = open(cand, 'rb').read()
                out = out_base + '.png'
                open(out, 'wb').write(data)
                os.remove(cand)
                return out, *png_size(data)
    return None


def docx_to_pdf(docx: str, tmpdir: str) -> str | None:
    for soff in ('soffice', 'libreoffice'):
        if shutil.which(soff):
            subprocess.run([soff, '--headless', '--convert-to', 'pdf', '--outdir', tmpdir, docx],
                           check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            pdf = os.path.join(tmpdir, os.path.splitext(os.path.basename(docx))[0] + '.pdf')
            if os.path.exists(pdf):
                return pdf
    return None


def poster_from_video(mp4: str, out: str) -> bool:
    if not shutil.which('ffmpeg'):
        return False
    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mp4, '-frames:v', '1',
                        '-vf', 'scale=432:768:force_original_aspect_ratio=decrease,'
                               'pad=432:768:(ow-iw)/2:(oh-ih)/2:color=black',
                        '-q:v', '70', out], timeout=300)
        return True
    except Exception:
        return False


def save_image_url(url: str, dest_base: str) -> str | None:
    """Save an image URL; the extension comes from the bytes, not the URL."""
    try:
        data = fetch(url)
    except Exception:
        return None
    ext = None
    if data[:3] == b'\xff\xd8\xff':
        ext = '.jpg'
    elif data[:4] == b'RIFF':
        ext = '.webp'
    elif data[:4] == b'\x89PNG':
        ext = '.png'
    if ext:
        dest = dest_base + ext
        open(dest, 'wb').write(data)
        return 'assets/work/films/' + os.path.basename(dest)
    return None


# ── orbit card templates (match the existing markup conventions) ─────────────────────────────

def card_static(cid: str, src: str, alt: str, w: int, h: int, dk: str, href: str, cap: str) -> str:
    return (f'      <figure class="stage__card" data-stage-card data-card-id="{cid}" data-k="{dk}" '
            f'data-href="{href}"><img src="{src}" alt="{alt}" width="{w}" height="{h}" '
            f'loading="lazy" decoding="async" draggable="false"><figcaption class="mono">{cap}</figcaption></figure>')


def card_film(cid: str, mp4: str, poster: str | None, dk: str, href: str, cap: str, aria: str) -> str:
    poster_attr = f'poster="{poster}" ' if poster else ''
    return (f'      <figure class="stage__card stage__card--film" data-stage-card data-card-id="{cid}" '
            f'data-k="{dk}" data-href="{href}"><video muted loop playsinline preload="none" '
            f'{poster_attr}width="432" height="768" aria-label="{aria}">'
            f'<source src="{mp4}" type="video/mp4"></video><figcaption class="mono">{cap}</figcaption></figure>')


# ── wiring into src/index.html (idempotent) ──────────────────────────────────────────────────

def wire(cards: dict[str, list[str]], n_static: int, n_film: int, n_hook: int, n_wwc: int) -> None:
    """cards: anchor card id → list of card HTML to insert after it (in order)."""
    s = open(SRC_HTML, encoding='utf8').read()
    original = s

    def insert_after(anchor_id: str, card_html: str) -> None:
        nonlocal s
        i = s.index(f'data-card-id="{anchor_id}"')
        j = s.index('</figure>', i) + len('</figure>')
        eol = s.index('\n', j)
        s = s[:eol] + '\n' + card_html + s[eol:]

    for anchor_id, card_list in cards.items():
        for card_html in card_list:
            cid = re.search(r'data-card-id="([^"]+)"', card_html).group(1)
            if f'data-card-id="{cid}"' in s:
                continue
            insert_after(anchor_id, card_html)

    total = BASE_COUNT + n_static + n_film + n_hook + n_wwc
    s = s.replace(f'>{BASE_COUNT} pieces of work,', f'>{total} pieces of work,', 1)
    s = s.replace(f'>{BASE_COUNT} pieces of work ·', f'>{total} pieces of work ·', 1)

    if n_hook:
        s = s.replace('Three of the scripts, as delivered, are in the orbit',
                      f'{NUM[3 + n_hook]} of the scripts, as delivered, are in the orbit')
    s = s.replace('Ten statics and two films are in the orbit',
                  f'{NUM[n_static + 10]} statics and {NUM[n_film + 2].lower()} films are in the orbit')

    if n_wwc:
        if 'data-orbit-open="wwc-' not in s:
            m = re.search(r'<ul class="players".*?</ul>', s, re.S)
            assert m, 'players list not found in ch6'
            link = (f'\n      <p class="mono orbit-link" data-reveal><a href="#orbit" '
                    f'data-orbit-open="wwc-smriti">{NUM.get(n_wwc, str(n_wwc))} of the player scripts, '
                    f'as written, are in the orbit <span aria-hidden="true">↑</span></a></p>')
            s = s[:m.end()] + link + s[m.end():]

    if s != original:
        open(SRC_HTML, 'w', encoding='utf8').write(s)
        log('wire', f'src/index.html updated → {total} pieces of work in the orbit')
    else:
        log('wire', 'src/index.html already up to date')


# ── main ─────────────────────────────────────────────────────────────────────────────────────

def main() -> None:
    print('pull_work.py — updated work from the shared Drive folder' + ('  [dry run]' if DRY else ''))
    cards: dict[str, list[str]] = {'bajaj-contempo': [], 'bajaj-new-year': [],
                                   'luna-01': [], 'jobcoach-01': []}
    n = {'static': 0, 'film': 0, 'hook': 0, 'wwc': 0}

    # 1 · updated Bajaj work (16 Jan 2026)
    for drive_id, target, dk, cap in BAJAJ:
        dest = os.path.join(WORK, target)
        if not DRY:
            try:
                kb = download(drive_id, dest) / 1e3
                log('pull', f'{target:32s} {kb:8.1f} KB')
            except Exception as e:
                log('FAIL', f'{target}: {e}')
                continue
        else:
            log('pull', f'{target:32s} (would download)')
        if target == 'bajaj-safe-to-touch.png':
            if DRY or not os.path.exists(dest):
                w, h, src = 720, 900, 'assets/work/bajaj-safe-to-touch.png'
            else:
                size = png_size(open(dest, 'rb').read())
                w, h = size if size else (720, 900)
                src = 'assets/work/bajaj-safe-to-touch.png'
            cards['bajaj-contempo'].append(
                card_static('bajaj-safe-to-touch', '../' + src, 'Bajaj Electricals Safe-to-touch post',
                            w, h, dk, '#ch8', cap))
            n['static'] += 1
        elif target == 'films/bajaj-nye.mp4':
            poster = None
            if not DRY:
                out = os.path.join(FILMS, 'bajaj-nye.webp')
                if poster_from_video(dest, out):
                    poster = 'assets/work/films/bajaj-nye.webp'
                else:
                    for url in NYE_THUMBS:
                        poster = save_image_url(url, os.path.join(FILMS, 'bajaj-nye'))
                        if poster:
                            break
                if not poster:
                    noted.append('NYE film has no poster (ffmpeg not found and the Drive preview '
                                 'could not be fetched) — drop a 432×768 frame into assets/work/films/ '
                                 'and re-run, or edit the card in src/index.html.')
            cards['bajaj-new-year'].append(
                card_film('bajaj-nye', '../assets/work/films/bajaj-nye.mp4',
                          '../' + poster if poster else None, dk, '#ch8', cap,
                          'Bajaj New Year’s Eve film'))
            n['film'] += 1
        else:  # NEW YEAR_2 replaces the current New Year film
            if not DRY:
                out = os.path.join(FILMS, 'bajaj-new-year.webp')
                if poster_from_video(dest, out):
                    noted.append('New Year film poster regenerated from the NEW YEAR_2 cut.')
                else:
                    noted.append('New Year film replaced, but the old poster was kept (no ffmpeg) — '
                                 'check it still matches the cut.')
            log('pull', f'{target:32s} (replaces the New Year film in place)')

    # 2 · WWC player scripts (.docx) → plates
    for drive_id, plate, player in WWC:
        docx = os.path.join(PLATES, plate + '.docx')
        out_base = os.path.join(PLATES, plate)
        if not DRY:
            try:
                kb = download(drive_id, docx) / 1e3
                log('pull', f'plates/{plate}.docx     {kb:8.1f} KB')
            except Exception as e:
                log('FAIL', f'{plate}: {e}')
                continue
            with tempfile.TemporaryDirectory() as tmp:
                pdf = docx_to_pdf(docx, tmp)
                if pdf is None:
                    log('skip', f'{plate} — .docx needs LibreOffice (soffice) to render')
                    skipped.append(f'{plate}  (download: https://drive.google.com/file/d/{drive_id}/view)')
                    continue
                rendered = render_pdf_first_page(pdf, out_base)
            if rendered is None:
                log('skip', f'{plate} — PDF renderer missing (pip install pymupdf, or install poppler-utils)')
                skipped.append(f'{plate}  (download: https://drive.google.com/file/d/{drive_id}/view)')
                continue
        else:
            log('pull', f'plates/{plate}.docx     (would download + render)')
            rendered = (out_base + '.webp', 760, 1074)
        path, w, h = rendered
        rel = 'assets/work/plates/' + os.path.basename(path)
        cards['luna-01'].append(
            card_static(plate, '../' + rel, f'Player script, page 1 — {player}, #WillToWin',
                        w, h, 'ICC WWC 2025 × Zoo Media · Player script · 2025', '#ch6',
                        f'{player} — #WillToWin'))
        n['wwc'] += 1

    # 3 · finance / creator scripts (.pdf) → plates
    for drive_id, plate, cap in HOOKS:
        pdf = os.path.join(PLATES, plate + '.pdf')
        out_base = os.path.join(PLATES, plate)
        if not DRY:
            try:
                kb = download(drive_id, pdf) / 1e3
                log('pull', f'plates/{plate}.pdf     {kb:8.1f} KB')
            except Exception as e:
                log('FAIL', f'{plate}: {e}')
                continue
            rendered = render_pdf_first_page(pdf, out_base)
            if rendered is None:
                log('skip', f'{plate} — PDF renderer missing (pip install pymupdf, or install poppler-utils)')
                skipped.append(f'{plate}  (download: https://drive.google.com/file/d/{drive_id}/view)')
                continue
        else:
            log('pull', f'plates/{plate}.pdf     (would download + render)')
            rendered = (out_base + '.webp', 760, 1074)
        path, w, h = rendered
        rel = 'assets/work/plates/' + os.path.basename(path)
        cards['jobcoach-01'].append(
            card_static(plate, '../' + rel, f'Script document, page 1 — {cap}',
                        w, h, 'Creator scripts · Personal finance · 2025', '#ch7', cap))
        n['hook'] += 1

    # 4 · wire it in
    if not DRY:
        wire(cards, n['static'], n['film'], n['hook'], n['wwc'])
    else:
        log('wire', f'(would update src/index.html → {BASE_COUNT + n["static"] + n["film"] + n["hook"] + n["wwc"]} pieces)')

    print()
    if skipped:
        print('left for a human (renderer missing on this machine):')
        for line in skipped:
            print('   · ' + line)
        print('   install the renderer, then re-run — the script picks up where it stopped.')
    for line in noted:
        print('note: ' + line)
    if not DRY:
        print()
        print('done — now rebuild and review:')
        print('   python3 tools/build.py')


if __name__ == '__main__':
    main()
