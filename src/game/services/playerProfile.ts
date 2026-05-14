const NICKNAME_KEY = 'slick.nickname';
const CHARACTER_ID_KEY = 'slick.characterId';

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
