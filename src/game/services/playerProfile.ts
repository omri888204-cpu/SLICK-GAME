const NICKNAME_KEY = 'slick.nickname';

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
