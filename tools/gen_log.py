#!/usr/bin/env python3
"""Dated work log per chapter, generated from src/data/pieces.json.

Fills the marker pairs in src/index.html:
    <!-- caselog:{key}:begin --> … <!-- caselog:{key}:end -->
where key ∈ {ch3, ch4, ch7, ch8, side}. A chapter with no pieces gets an empty
log (markers stay, content clears) — re-runs are idempotent by construction.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIECES_JSON = os.path.join(ROOT, 'src', 'data', 'pieces.json')
SRC_HTML = os.path.join(ROOT, 'src', 'index.html')

KEY_FOR_HREF = {
    '#ch3': 'ch3',
    '#ch4': 'ch4',
    '#ch7': 'ch7',
    '#ch8': 'ch8',
    '#side': 'side',
}
HEADS = {
    'ch3': 'The work, logged',
    'ch4': 'The work, logged',
    'ch7': 'The work, logged',
    'ch8': 'The work, logged',
    'side': 'Side quests, logged',
}


def load_pieces():
    with open(PIECES_JSON, encoding='utf8') as f:
        return json.load(f)['pieces']


def year_of(p):
    m = re.search(r'\u00b7\s*(20\d{2})(?:\u2013\d{2})?\s*$', p.get('k', ''))
    return m.group(1) if m else None


def entry_html(p):
    y = year_of(p)
    year = f'<span class="mono caselog__year">{y}</span>' if y else '<span class="mono caselog__year" aria-hidden="true">&middot;</span>'
    return (
        '        <li>\n'
        f'          {year}\n'
        '          <div class="caselog__body">\n'
        f'            <p class="caselog__what">{p["cap"]}</p>\n'
        f'            <a class="mono caselog__more" href="pieces/{p["id"]}.html">the piece &rarr;</a>\n'
        '          </div>\n'
        '        </li>'
    )


def build_block(key, pieces):
    if not pieces:
        return ''
    lis = '\n'.join(entry_html(p) for p in pieces)
    return (
        f'      <ol class="caselog" data-reveal>\n'
        f'        <li class="caselog__head" aria-hidden="true"><span class="mono">{HEADS[key]}</span></li>\n'
        f'{lis}\n'
        '      </ol>'
    )


def generate():
    pieces = load_pieces()
    by_key = {k: [] for k in KEY_FOR_HREF.values()}
    for p in pieces:
        key = KEY_FOR_HREF.get(p.get('href'))
        if key:
            by_key[key].append(p)

    with open(SRC_HTML, encoding='utf8') as f:
        html = f.read()

    for key in ('ch3', 'ch4', 'ch7', 'ch8', 'side'):
        pat = re.compile(
            r'(<!-- caselog:' + key + r':begin [^>]*-->)(.*?)(?: *)(<!-- caselog:' + key + r':end -->)',
            re.DOTALL,
        )
        block = build_block(key, by_key[key])
        def rep(m, block=block):
            inner = ('\n' + block + '\n      ' if block else '      ')
            return m.group(1) + inner + m.group(3)
        html, n = pat.subn(rep, html, count=1)
        if n != 1:
            print(f'  WARNING: no marker pair for caselog:{key}')

    with open(SRC_HTML, 'w', encoding='utf8') as f:
        f.write(html)
    total = sum(len(v) for v in by_key.values())
    print(f'  case logs: {total} entries across {sum(1 for v in by_key.values() if v)} chapters')


def check():
    pieces = load_pieces()
    by_key = {k: [] for k in KEY_FOR_HREF.values()}
    for p in pieces:
        key = KEY_FOR_HREF.get(p.get('href'))
        if key:
            by_key[key].append(p)
    html = open(SRC_HTML, encoding='utf8').read()
    drift = []
    for key in ('ch3', 'ch4', 'ch7', 'ch8', 'side'):
        pat = re.compile(
            r'(<!-- caselog:' + key + r':begin [^>]*-->)(.*?)(?: *)(<!-- caselog:' + key + r':end -->)',
            re.DOTALL,
        )
        m = pat.search(html)
        if not m:
            drift.append(key + '(missing markers)')
            continue
        expected = m.group(1) + ('\n' + build_block(key, by_key[key]) + '\n      ' if by_key[key] else '      ') + m.group(3)
        # same canonical form generate() writes
        if m.group(0) != expected:
            drift.append(key)
    print('  case logs: in sync' if not drift else f'  case logs: DRIFT ({", ".join(drift)})')
    return not drift


if __name__ == '__main__':
    if '--check' in sys.argv[1:]:
        sys.exit(0 if check() else 1)
    generate()
