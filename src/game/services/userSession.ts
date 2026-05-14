import type { RemoteUserLedger } from './rtdbUsers';

export type PersonalBestSnap = {
  maxHeightMeters: number;
  bestCombo: number;
  updatedAt?: number;
};

export type GameUserSession = {
  nickname: string;
  selectedCharacterId: string;
  personalBest: PersonalBestSnap;
};

let active: GameUserSession | null = null;

export function setGameUserSession(snapshot: GameUserSession): void {
  active = { ...snapshot };
}

export function getGameUserSession(): GameUserSession | null {
  return active ? { ...active } : null;
}

export function clearGameUserSession(): void {
  active = null;
}

/** Mirrors `/users/{uid}/stats.maxHeight` into {@link PersonalBestSnap.maxHeightMeters}. */
export function mergeUserLedgerIntoSession(ledger: RemoteUserLedger): GameUserSession {
  const st = ledger.stats;
  const session: GameUserSession = {
    nickname: ledger.profile.nickname.trim().slice(0, 20) || 'Player',
    selectedCharacterId: ledger.profile.selectedCharacterId ?? 'chromatic',
    personalBest: {
      maxHeightMeters: Math.max(0, Math.floor(st.maxHeight ?? 0)),
      bestCombo: Math.max(0, Math.floor(st.bestCombo ?? 0)),
      updatedAt: st.updatedAt,
    },
  };
  setGameUserSession(session);
  return session;
}

export function patchSessionPersonalBest(heightMeters: number, bestCombo: number): void {
  const s = getGameUserSession();
  if (!s) {
    return;
  }
  const h = Math.max(0, Math.floor(heightMeters));
  const c = Math.max(0, Math.floor(bestCombo));
  setGameUserSession({
    ...s,
    personalBest: {
      maxHeightMeters: Math.max(s.personalBest.maxHeightMeters, h),
      bestCombo: Math.max(s.personalBest.bestCombo, c),
      updatedAt: Date.now(),
    },
  });
}
