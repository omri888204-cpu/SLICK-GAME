/** Resolve a public asset URL against the current page (works with Vite `base: './'`). */
function resolvePublicAssetUrl(relativeToAssets: string): string {
  const base = import.meta.env.BASE_URL || '/';
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${base}assets/${relativeToAssets}`;
  }
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(`assets/${relativeToAssets}`, new URL(normalizedBase, window.location.href)).href;
}

/** Main menu loop — `public/assets/game music/Celestial Drift.mp3`. */
export const MENU_BGM_URL = resolvePublicAssetUrl(
  `${encodeURIComponent('game music')}/${encodeURIComponent('Celestial Drift.mp3')}`,
);

/** Default gameplay loop — `public/assets/game music/Starlight Gateway.mp3`. */
export const DEFAULT_GAME_BGM_URL = resolvePublicAssetUrl(
  `${encodeURIComponent('game music')}/${encodeURIComponent('Starlight Gateway.mp3')}`,
);
