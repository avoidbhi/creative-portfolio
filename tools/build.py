#!/usr/bin/env python3
"""
build.py — assemble the two published files from src/ + assets/.

    python3 tools/build.py            write index.dev.html and index.html
    python3 tools/build.py --check    build to memory, compare, exit 1 on drift (CI / pre-commit)

src/index.html is the only file you edit for copy; src/css/*.css and src/*.js are the sheet and
the four scripts. Cascade and execution order come from the order of the <link> / <script src>
tags in src/index.html, so the markup is the single source of truth for both.

Two artifacts, one pipeline:

  index.dev.html   the readable single file — sheet and scripts inlined, assets left as
                   files under assets/ (so it is diffable and reviewable, ~245 KB)
  index.html       the standalone build — the same document with every asset inlined as a
                   base64 data URI, and the webm film fallbacks dropped (ships mp4 only);
                   ~4.7 MB, opens from a USB stick, hosts anywhere, no requests at all

Rules the standalone build applies, in order:
  1. <link> tags  → one <style> block, files concatenated in document order
  2. <script src> → inline <script>, same order
  3. ../assets/ and ../../assets/ → assets/ (refs are relative to the file they live in)
  4. <source ...webm> removed, then every remaining assets/ path replaced by its data URI
"""
from __future__ import annotations
import base64, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
MIME = {'.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.svg': 'image/svg+xml', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff',
        '.mp4': 'video/mp4', '.webm': 'video/webm'}
ASSET_RE = re.compile(r"""assets/[A-Za-z0-9_.\-/]+\.(?:woff2|woff|webp|jpg|jpeg|png|svg|gif|mp4|webm)""")

read = lambda p: open(p, encoding='utf8').read()


def assemble():
    """src/ → the readable single-file document (sheet + scripts inlined, assets external)."""
    doc = read(os.path.join(SRC, 'index.html'))

    links = re.findall(r'[ \t]*<link rel="stylesheet" href="(css/[^"]+\.css)">\n?', doc)
    assert links, 'no stylesheet <link> tags in src/index.html'
    css = ''
    for href in links:
        css += read(os.path.join(SRC, href))
    span = (doc.index(f'<link rel="stylesheet" href="{links[0]}">'),
            doc.index(f'<link rel="stylesheet" href="{links[-1]}">') + len(f'<link rel="stylesheet" href="{links[-1]}">'))
    doc = doc[:span[0]] + '<style>\n' + css + '</style>' + doc[span[1]:]

    srcs = re.findall(r'<script src="([^"]+\.js)"></script>', doc)
    assert srcs, 'no <script src> tags in src/index.html'
    for name in srcs:
        body = read(os.path.join(SRC, name))
        doc = doc.replace(f'<script src="{name}"></script>', f'<script>\n{body}</script>', 1)

    # refs are written relative to the file that holds them; both builds live at the repo root
    doc = doc.replace('../../assets/', 'assets/').replace('../assets/', 'assets/')
    return doc


def data_uri(path):
    with open(os.path.join(ROOT, path), 'rb') as fh:
        raw = fh.read()
    ext = os.path.splitext(path)[1].lower()
    if ext not in MIME:
        sys.exit(f'build.py: no MIME type for {path}')
    return f'data:{MIME[ext]};base64,' + base64.b64encode(raw).decode('ascii')


def standalone(dev_doc):
    """the readable single file → the portable one: assets inlined, webm fallbacks dropped."""
    doc = re.sub(r'[ \t]*<source src="assets/[^"]*\.webm" type="video/webm">\n?', '', dev_doc)
    seen, missing = set(), set()
    # longest first: no asset path can then be rewritten as a prefix of another
    paths = sorted(set(ASSET_RE.findall(doc)), key=len, reverse=True)
    for p in paths:
        if not os.path.exists(os.path.join(ROOT, p)):
            missing.add(p)
    if missing:
        sys.exit('build.py: referenced but absent from assets/:\n  ' + '\n  '.join(sorted(missing)))
    uris = {p: data_uri(p) for p in paths}
    for p, uri in uris.items():
        doc = doc.replace(p, uri)
        seen.add(p)
    left = ASSET_RE.findall(doc)
    return doc, sorted(set(left)), len(seen)


def main():
    check = '--check' in sys.argv[1:]
    if args_unknown := [a for a in sys.argv[1:] if a != '--check']:
        sys.exit(f'build.py: unknown argument {args_unknown[0]!r} (only --check)')

    dev = assemble()
    prod, leftover, inlined = standalone(dev)

    out = []
    for name, text in (('index.dev.html', dev), ('index.html', prod)):
        path = os.path.join(ROOT, name)
        new = text.encode('utf8')
        old = open(path, 'rb').read() if os.path.exists(path) else b''
        if check:
            out.append(f'  {name:16s} {"in sync" if old == new else "DRIFT" if old else "missing":7s} '
                       f'{len(new)/1e6:6.2f} MB')
            if old and old != new:
                out.append(f'    {name}: {len(old)} bytes on disk, {len(new)} from src/ — run without --check')
        else:
            with open(path, 'wb') as fh:
                fh.write(new)
            out.append(f'  wrote {name:16s} {len(new)/1e6:6.2f} MB  ({len(text.splitlines())} lines)')

    kb = len(dev.encode("utf8")) / 1e3
    out.append(f'  {inlined} assets inlined into the standalone build; {kb:.0f} KB readable build')
    if leftover:
        out.append('  !! external refs left in index.html: ' + ', '.join(leftover))
    print('\n'.join(out))
    if check and any('DRIFT' in l or 'missing' in l for l in out):
        sys.exit(1)


if __name__ == '__main__':
    main()
