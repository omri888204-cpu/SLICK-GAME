/**
 * Canonical user ledger under `/users/{uid}` (Realtime Database).
 *
 * - `/users/{uid}/profile` → nickname, email, onboarding fields
 * - `/users/{uid}/stats` → maxHeight (m HUD), bestCombo, totalPoints (best session PTS)
 *
 * **RTDB rules (example)**:
 * ```json
 * {
 *   "rules": {
 *     "leaderboard": { ".read": true, ".write": false, ".indexOn": ["totalScore", "maxHeightMeters"] },
 *     "users": {
 *       "$uid": {
 *         ".read": "$uid === auth.uid",
 *         ".write": "$uid === auth.uid"
 *       }
 *     }
 *   }
 * }
 * ```
 */

import type { User } from 'firebase/auth';
import { get, ref, set, update } from 'firebase/database';
import { rtdb } from '../../firebase.js';

export const USERS_PATH = 'users';

export type UserProfileNode = {
  nickname: string;
  email: string;
  registrationComplete?: boolean;
  selectedCharacterId?: string;
  createdAt?: number;
};

export type UserStatsNode = {
  /** Peak climb HUD meters (`/stats.maxHeight`). */
  maxHeight: number;
  bestCombo: number;
  /** Best single-run peak PTS (same units as HUD score: height×10 + combo×5). */
  totalPoints: number;
  updatedAt?: number;
};

/** Convenience shape for landing + menu (matches former `RemoteUserProfile` usage). */
export type RemoteUserLedger = {
  profile: UserProfileNode;
  stats: UserStatsNode;
};

export function userProfileRef(uid: string) {
  return ref(rtdb, `${USERS_PATH}/${uid}/profile`);
}

export function userStatsRef(uid: string) {
  return ref(rtdb, `${USERS_PATH}/${uid}/stats`);
}

export async function fetchUserLedger(uid: string): Promise<RemoteUserLedger | null> {
  const [profileSnap, statsSnap] = await Promise.all([
    get(userProfileRef(uid)),
    get(userStatsRef(uid)),
  ]);
  if (!profileSnap.exists()) {
    return null;
  }
  const profile = profileSnap.val() as UserProfileNode;
  const stats = statsSnap.exists()
    ? (statsSnap.val() as UserStatsNode)
    : ({
        maxHeight: 0,
        bestCombo: 0,
        totalPoints: 0,
        updatedAt: Date.now(),
      } satisfies UserStatsNode);
  return { profile, stats };
}

/** True if this Firebase user last signed in with Google (used for nickname sync). */
export function userHasGoogleProvider(user: User): boolean {
  return user.providerData.some((p) => p.providerId === 'google.com');
}

/**
 * For Google sign-in: persist leaderboard nickname from `user.displayName` under
 * `/users/{uid}/profile/nickname` (and create profile + stats for first-time Google users).
 */
export async function syncProfileNicknameFromGoogleAccount(user: User): Promise<void> {
  if (!userHasGoogleProvider(user)) {
    return;
  }
  const raw =
    user.displayName?.trim() ||
    user.email?.split('@')[0] ||
    `player_${user.uid.slice(0, 8)}`;
  const cleanNick = raw.slice(0, 20) || 'Player';

  const ledger = await fetchUserLedger(user.uid);
  if (!ledger) {
    await registerNewUser(user.uid, cleanNick, (user.email ?? '').trim());
    return;
  }
  await update(userProfileRef(user.uid), { nickname: cleanNick });
}

/** Register nickname + email; initialise stats counters. */
export async function registerNewUser(
  uid: string,
  nickname: string,
  email: string,
): Promise<void> {
  const cleanNick = nickname.trim().slice(0, 20) || 'Player';
  const cleanEmail = email.trim().toLowerCase();
  const now = Date.now();
  await set(userProfileRef(uid), {
    nickname: cleanNick,
    email: cleanEmail,
    registrationComplete: false,
    createdAt: now,
  } satisfies UserProfileNode);
  await set(userStatsRef(uid), {
    maxHeight: 0,
    bestCombo: 0,
    totalPoints: 0,
    updatedAt: now,
  } satisfies UserStatsNode);
}

export async function finalizeCharacterSelection(
  uid: string,
  selectedCharacterId: string,
): Promise<void> {
  await update(userProfileRef(uid), {
    selectedCharacterId,
    registrationComplete: true,
  });
}

/** Merge upwards; stores under `/users/{uid}/stats`. */
export async function upsertPersonalBestIfBetter(
  user: User,
  heightMeters: number,
  bestCombo: number,
  sessionPeakPts?: number,
): Promise<void> {
  const statsRefLocal = userStatsRef(user.uid);
  const snap = await get(statsRefLocal);
  const prev = snap.exists()
    ? (snap.val() as UserStatsNode)
    : ({
        maxHeight: 0,
        bestCombo: 0,
        totalPoints: 0,
      } satisfies UserStatsNode);

  const h = Math.max(0, Math.floor(heightMeters));
  const c = Math.max(0, Math.floor(bestCombo));
  const p =
    sessionPeakPts === undefined
      ? undefined
      : Math.max(0, Math.floor(sessionPeakPts));

  let nextHeight = prev.maxHeight ?? 0;
  let nextCombo = prev.bestCombo ?? 0;
  let nextPts = Math.max(0, Math.floor(prev.totalPoints ?? 0));
  let changed = false;

  if (h > nextHeight) {
    nextHeight = h;
    changed = true;
  }
  if (c > nextCombo) {
    nextCombo = c;
    changed = true;
  }
  if (p !== undefined && p > nextPts) {
    nextPts = p;
    changed = true;
  }
  if (!changed) {
    return;
  }

  const payload: Partial<UserStatsNode> & { updatedAt: number } = {
    maxHeight: nextHeight,
    bestCombo: nextCombo,
    totalPoints: nextPts,
    updatedAt: Date.now(),
  };
  await update(statsRefLocal, payload);
}
