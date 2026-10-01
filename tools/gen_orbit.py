#!/usr/bin/env python3
"""
gen_orbit.py — the orbit and the counts, generated from src/data/pieces.json.

    python3 tools/gen_orbit.py            write the two rings + the four count strings
    python3 tools/gen_orbit.py --check    compare in memory, exit 1 on drift
    python3 tools/gen_orbit.py --extract  rebuild pieces.json from the current HTML (bootstrap only)

pieces.json is the single content config for the orbit: one entry per piece —
id, ring, kind, asset, k-string, href, alt, caption. Card order in each ring
is list order. The generator owns exactly two things and nothing else:

  1. the <figure> blocks inside <div class="stage__ring" data-ring="in|out">
  2. the four "32 pieces" count strings (stage line, index overlay, home sub, see-all)

Everything else in src/index.html is hand-kept.
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_HTML = os.path.join(ROOT, 'src', 'index.html')
PIECES_JSON = os.path.join(ROOT, 'src', 'data', 'pieces.json')

WORD = {20: 'Twenty', 21: 'Twenty-one', 22: 'Twenty-two', 23: 'Twenty-three', 24: 'Twenty-four',
        25: 'Twenty-five', 26: 'Twenty-six', 27: 'Twenty-seven', 28: 'Twenty-eight',
        29: 'Twenty-nine', 30: 'Thirty', 31: 'Thirty-one', 32: 'Thirty-two', 33: 'Thirty-three',
        34: 'Thirty-four', 35: 'Thirty-five', 36: 'Thirty-six', 37: 'Thirty-seven',
        38: 'Thirty-eight', 39: 'Thirty-nine', 40: 'Forty', 41: 'Forty-one', 42: 'Forty-two',
        43: 'Forty-three', 44: 'Forty-four', 45: 'Forty-five', 46: 'Forty-six', 47: 'Forty-seven',
        48: 'Forty-eight', 49: 'Forty-nine', 50: 'Fifty', 51: 'Fifty-one', 52: 'Fifty-two'}


def load_pieces() -> list[dict]:
    with open(PIECES_JSON, encoding='utf8') as f:
        return json.load(f)['pieces']


# ── card rendering (byte-exact match of the hand-written markup) ─────────────────────────────

FRAG_DIR = os.path.join(ROOT, 'src', 'pieces')


def card_href(p: dict) -> str:
    """Orbit cards open the piece's page when its fragment exists, else fall back to the chapter."""
    if os.path.exists(os.path.join(FRAG_DIR, p['id'] + '.html')):
        return f"pieces/{p['id']}.html"
    return p['href']


def render_card(p: dict) -> str:
    if p['kind'] == 'film':
        return (f'      <figure class="stage__card stage__card--film" data-stage-card '
                f'data-card-id="{p["id"]}" data-k="{p["k"]}" data-href="{card_href(p)}">'
                f'<video muted loop playsinline preload="none" poster="../{p["poster"]}" '
                f'width="432" height="768" aria-label="{p["aria"]}">'
                f'<source src="../{p["src"]}" type="video/mp4"></video>'
                f'<figcaption class="mono">{p["cap"]}</figcaption></figure>')
    return (f'      <figure class="stage__card" data-stage-card data-card-id="{p["id"]}" '
            f'data-k="{p["k"]}" data-href="{card_href(p)}"><img src="../{p["src"]}" alt="{p["alt"]}" '
            f'width="{p["w"]}" height="{p["h"]}" loading="lazy" decoding="async" draggable="false">'
            f'<figcaption class="mono">{p["cap"]}</figcaption></figure>')


def ring_block(ring: str, pieces: list[dict]) -> str:
    cards = '\n'.join(render_card(p) for p in pieces if p['ring'] == ring)
    return (f'    <div class="stage__ring" data-ring="{ring}">\n{cards}\n    </div>')


# ── counts ────────────────────────────────────────────────────────────────────────────────────

def patch_counts(s: str, total: int) -> str:
    s = re.sub(r'>\d+ pieces of work', f'>{total} pieces of work', s)
    s = re.sub(r'[A-Za-z]+(?:-[a-z]+)? pieces of work, nine chapters',
               f'{WORD.get(total, str(total))} pieces of work, nine chapters', s)
    s = re.sub(r'See all \u2014 \d+ in the orbit', f'See all \u2014 {total} in the orbit', s)
    return s


# ── generate ──────────────────────────────────────────────────────────────────────────────────

def generate(html: str, pieces: list[dict]) -> str:
    for ring in ('in', 'out'):
        pat = re.compile(r'    <div class="stage__ring" data-ring="' + ring + r'">.*?\n    </div>', re.S)
        if not pat.search(html):
            sys.exit(f'gen_orbit: no data-ring="{ring}" block in src/index.html')
        html = pat.sub(lambda m: ring_block(ring, pieces), html, count=1)
    return patch_counts(html, len(pieces))


# ── extract (bootstrap: current HTML → pieces.json, order-preserving) ────────────────────────

FIG_RE = re.compile(
    r'<figure class="stage__card(?P<f>\s+stage__card--film)?" data-stage-card '
    r'data-card-id="(?P<id>[^"]+)" data-k="(?P<k>[^"]+)" data-href="(?P<href>[^"]+)">'
    r'(?P<body>.*?)</figure>', re.S)
IMG_RE = re.compile(r'<img src="\.\./(?P<src>[^"]+)" alt="(?P<alt>[^"]*)" '
                    r'width="(?P<w>\d+)" height="(?P<h>\d+)"')
VID_RE = re.compile(r'<video muted loop playsinline preload="none" poster="\.\./(?P<poster>[^"]+)" '
                    r'width="432" height="768" aria-label="(?P<aria>[^"]*)">'
                    r'<source src="\.\./(?P<src>[^"]+)" type="video/mp4">')


def href_of(id_: str) -> str:
    """Chapter anchor from the piece id — the JSON's `href` field (cards point at the piece page)."""
    if id_.startswith('surf-'):
        return '#ch3'
    if id_.startswith('boult-'):
        return '#ch4'
    if id_.startswith(('derek-', 'harshit-', 'jobcoach-')):
        return '#ch7'
    if id_.startswith('bajaj-'):
        return '#ch8'
    return '#side'


def extract(html: str) -> list[dict]:
    """Current HTML → pieces list, in DOM order (inner ring first, then outer)."""
    out_at = html.index('data-ring="out"')
    pieces = []
    for m in FIG_RE.finditer(html):
        body = m.group('body')
        p = dict(id=m.group('id'), k=m.group('k'), href=href_of(m.group('id')),
                 kind='film' if m.group('f') else 'static',
                 ring='out' if m.start() > out_at else 'in')
        p['cap'] = re.search(r'<figcaption class="mono">(.*?)</figcaption>', body).group(1)
        if p['kind'] == 'film':
            v = VID_RE.search(body)
            p.update(poster=v.group('poster'), src=v.group('src'), aria=v.group('aria'))
        else:
            i = IMG_RE.search(body)
            p.update(src=i.group('src'), alt=i.group('alt'), w=int(i.group('w')), h=int(i.group('h')))
        pieces.append(p)
    assert len(pieces) == html.count('data-stage-card'), 'extract count mismatch'
    return pieces


def check() -> bool:
    """generate in memory and compare — used by tools/build.py --check."""
    html = open(SRC_HTML, encoding='utf8').read()
    pieces = load_pieces()
    same = generate(html, pieces) == html
    print(f'  orbit from pieces.json: {"in sync" if same else "DRIFT"}  ({len(pieces)} pieces)')
    if not same:
        import difflib
        for line in list(difflib.unified_diff(html.splitlines(), generate(html, pieces).splitlines(),
                                              'html', 'generated', lineterm=''))[:20]:
            print('   ', line)
    return same


def main() -> None:
    args = [a for a in sys.argv[1:]]
    html = open(SRC_HTML, encoding='utf8').read()

    if '--extract' in args:
        pieces = extract(html)
        os.makedirs(os.path.dirname(PIECES_JSON), exist_ok=True)
        with open(PIECES_JSON, 'w', encoding='utf8') as f:
            json.dump({'pieces': pieces}, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'  extracted {len(pieces)} pieces → src/data/pieces.json')
        return

    if '--check' in args:
        sys.exit(0 if check() else 1)

    pieces = load_pieces()
    new = generate(html, pieces)

    if new != html:
        open(SRC_HTML, 'w', encoding='utf8').write(new)
        print(f'  wrote orbit + counts ({len(pieces)} pieces)')
    else:
        print(f'  orbit already matches pieces.json ({len(pieces)} pieces)')


if __name__ == '__main__':
    main()
