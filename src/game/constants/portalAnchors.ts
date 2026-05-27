import type { LayerBackgroundLayout } from '../systems/atmosphere/candyStaticBackground';
import type { MenuCoverLayout } from './menuBackground';
import {
  MENU_PORTAL_AMBIENCE_CENTER_X_NORM,
  MENU_PORTAL_AMBIENCE_CENTER_Y_NORM,
} from './menuBackground';

/** Painted portal center on `new menu space.png` (matches {@link MENU_PORTAL_AMBIENCE_CENTER_*_NORM}). */
export const MENU_PORTAL_ART_NORM = {
  x: MENU_PORTAL_AMBIENCE_CENTER_X_NORM,
  y: MENU_PORTAL_AMBIENCE_CENTER_Y_NORM,
} as const;

/** `public/assets/backgroud teset/space 1.png` — existing gameplay entry portal (measured). */
export const PLAY_SPACE1_PORTAL_NORM = {
  x: 0.501,
  y: 0.534,
} as const;

export const PLAY_SPACE1_TEX_W = 1024;
export const PLAY_SPACE1_TEX_H = 1536;

export function menuPortalFocusScreen(
  layout: MenuCoverLayout,
  texW: number,
  texH: number,
): { x: number; y: number } {
  return {
    x: layout.left + MENU_PORTAL_ART_NORM.x * texW * layout.scale,
    y: layout.top + MENU_PORTAL_ART_NORM.y * texH * layout.scale,
  };
}

/** Screen position of the painted portal on `space 1.png` at run start (cover-scaled middle layer). */
export function gameplayPortalScreen(
  viewport: LayerBackgroundLayout,
  texW = PLAY_SPACE1_TEX_W,
  texH = PLAY_SPACE1_TEX_H,
): { x: number; y: number } {
  const scale = Math.max(viewport.viewportW / texW, viewport.fillH / texH);
  const displayW = texW * scale;
  const displayH = texH * scale;
  const left = viewport.centerX - displayW * 0.5;
  const top = viewport.centerY - displayH * 0.5;
  return {
    x: left + PLAY_SPACE1_PORTAL_NORM.x * displayW,
    y: top + PLAY_SPACE1_PORTAL_NORM.y * displayH,
  };
}
