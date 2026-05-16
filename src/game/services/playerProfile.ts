import type { PlayerSkinName } from '../constants/playerSkin';
import { DEFAULT_PLAYER_SKIN, normalizeSelectedCharacterSkin } from '../constants/playerSkin';

const NICKNAME_KEY = 'slick.nickname';
const CHARACTER_ID_KEY = 'slick.characterId';
const SELECTED_CHARACTER_SKIN_KEY = 'slick.selected_character';

export function getSavedNickname(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return (window.localStorage.getItem(NICKNAME_KEY) ?? '').trim();
}

export function saveNickname(nickname: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const clean = nickname.trim().slice(0, 20);
  if (!clean) {
    return;
  }
  window.localStorage.setItem(NICKNAME_KEY, clean);
}

export function getSelectedCharacterId(): string {
  if (typeof window === 'undefined') {
    return 'chromatic';
  }
  return (window.localStorage.getItem(CHARACTER_ID_KEY) ?? 'chromatic').trim() || 'chromatic';
}

export function saveSelectedCharacterId(id: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const clean = id.trim().slice(0, 32) || 'chromatic';
  window.localStorage.setItem(CHARACTER_ID_KEY, clean);
}

export function getSavedSelectedCharacterSkin(): PlayerSkinName {
  if (typeof window === 'undefined') {
    return DEFAULT_PLAYER_SKIN;
  }
  return normalizeSelectedCharacterSkin(window.localStorage.getItem(SELECTED_CHARACTER_SKIN_KEY));
}

export function saveSelectedCharacterSkin(skin: PlayerSkinName): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SELECTED_CHARACTER_SKIN_KEY, skin);
  } catch {
    /* private mode / quota */
  }
}

/** Clears cached nickname / character from localStorage (e.g. after sign-out). */
export function clearSavedPlayerProfile(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(NICKNAME_KEY);
    window.localStorage.removeItem(CHARACTER_ID_KEY);
    window.localStorage.removeItem(SELECTED_CHARACTER_SKIN_KEY);
  } catch {
    /* private mode / quota */
  }
}
