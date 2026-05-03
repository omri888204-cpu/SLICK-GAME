# Netlify deployment — SLICK (slick-game)

## Netlify UI (must match repo)

| Setting | Value |
|--------|--------|
| **Build command** | `npm ci && npm run build` (or leave empty if `netlify.toml` is used) |
| **Publish directory** | **`dist`** — exactly, lowercase, no trailing slash |

If Publish directory is `public`, `.`, or blank while the UI overrides `netlify.toml`, Netlify will not serve your Vite output → **404**.

## What `npm run build` produces

- **`dist/index.html`** — entry HTML with `./assets/*.js` / `./assets/*.css` (`base: './'` in Vite).
- **`dist/_redirects`** — SPA rule: `/* /index.html 200` (copied from `public/_redirects`).
- **`dist/assets/`** — bundled JS, CSS, and hashed static files, including:
  - Chameleon: `chameleon-run-pair-*.png`, `chameleon_clean-*.png`
  - SLICK logo: `slick-logo-*.png`
  - Platforms: crystal / slime / volcano / storm PNGs

## SPA routing

Redirects are defined **twice** (either is enough; both is fine):

1. **`netlify.toml`** → `[[redirects]]` from `/*` to `/index.html` with status `200`.
2. **`public/_redirects`** → `/* /index.html 200` (published at `dist/_redirects`).

## Local verification

```bash
cd /path/to/sky-climber
npm ci
npm run build
```

Then confirm: `dist/index.html` exists and `dist/assets/` contains chameleon + slick-logo PNGs.

Optional: `npx vite preview --host` and open the printed URL.

## Deploy after fixes

### Option A — Git (recommended)

```bash
git add netlify.toml public/_redirects vite.config.ts package.json
git add -A
git commit -m "fix(netlify): publish dist, SPA redirects, relative assets"
git push origin main
```

Use your real branch name if not `main`. Netlify will build from the pushed commit.

### Option B — Manual + clear cache (Netlify dashboard)

1. **Deploys** → **Trigger deploy** → **Clear cache and deploy site**.
2. Or drag-and-drop the **`dist`** folder after a successful local `npm run build` (manual deploy).

## If you still see 404

1. **Deploy log** — did `vite build` finish and list `dist/index.html`?
2. **Deploy summary** — does it say “Published directory: dist”?
3. **URL** — use the exact production URL from **Domain management** (e.g. `https://slick-game.netlify.app`).
