# Publishing this portfolio on GitHub Pages

Everything in this folder is the deployable site. `research/` (105 MB of decks, frames and
backups) is deliberately left out via `.gitignore`. Nothing in the site uses absolute paths,
so it works at `https://<user>.github.io/<repo>/` as well as at a custom domain.

## Option A — no terminal (browser only, ~5 minutes)

1. Sign in at https://github.com → top-right **+** → **New repository**.
   - Name: `portfolio` (any name works; the name becomes part of the URL).
   - **Public** (required for free GitHub Pages). Do NOT tick "Add a README".
   - **Create repository**.
2. On the empty-repo page click **uploading an existing file**.
3. Open this `deploy` folder on your computer and drag **its contents** (not the folder
   itself) into the browser: `index.html`, `index.dev.html`, `README.md`, `DEPLOY.md`,
   `.nojekyll`, `.gitignore`, `.gitattributes` and the folders `assets/`, `src/`, `tools/`.
   Drag-and-drop uploads folders with their contents intact; the "choose your files"
   button only takes flat files. If `.nojekyll` doesn't show in your file manager, enable
   hidden files (macOS: ⌘⇧. · Windows: View → Show hidden items).
   Limits: 100 files per drag — this folder has 63 — and 25 MB per file; the largest here is
   4.5 MB.
4. Commit message: `Portfolio v7.1` → **Commit changes**.
5. **Settings** tab → left sidebar **Pages** → under *Build and deployment*:
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/ (root)** → **Save**.
6. Wait 1–3 minutes, reload the Pages settings page: a banner shows
   **Your site is live at `https://<your-username>.github.io/portfolio/`**.
   That is your link. It serves `index.html` (the standalone build) automatically.

## Option B — with git on your machine

```bash
cd deploy
git init -b main
git add -A
git commit -m "Portfolio v7.1"
git remote add origin https://github.com/<your-username>/portfolio.git
git push -u origin main
```
Then do steps 5–6 above (Settings → Pages → Deploy from a branch → main / root).

## Option C — GitHub CLI (fastest)

```bash
cd deploy
gh auth login
git init -b main && git add -A && git commit -m "Portfolio v7.1"
gh repo create portfolio --public --source=. --push
gh api -X POST repos/{owner}/portfolio/pages -f build_type=legacy -f source[branch]=main -f source[path]=/
gh api repos/{owner}/portfolio/pages --jq .html_url        # prints the live link
```

## Updating later

Edit the files in `src/` on your computer, rebuild both files with `python3 tools/build.py`
from the parent `portfolio` folder (or edit `index.html` directly if you don't want a build
step), then upload again: repo → **Add file → Upload files** → drop the changed files → commit.
Pages redeploys in ~1 minute. A hard refresh (Ctrl/⌘ + Shift + R) clears the old cache.

## Useful extras

- **Custom domain**: Settings → Pages → *Custom domain* → `abhijeetkanase.com`; at your
  registrar add a CNAME record `www → <your-username>.github.io` (and the four GitHub
  A records for the apex — GitHub shows them on that page). Tick *Enforce HTTPS* once it verifies.
- **Naming the repo `<your-username>.github.io`** makes the site live at the bare
  `https://<your-username>.github.io/` with no `/portfolio/` suffix.
- **404 after enabling Pages?** Give it two minutes, check the *Actions* tab for the
  `pages build and deployment` run, and confirm `index.html` sits at the repository root
  (not inside a `deploy/` sub-folder).
- **Check the deployment**: open the live link, the orbit should be turning within a second;
  open `/index.dev.html` too — if images are missing there, the `assets/` folder didn't upload.
