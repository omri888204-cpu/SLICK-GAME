/**
 * Canonical user ledger under `/users/{uid}` (Realtime Database).
 *
 * - `/users/{uid}/profile` → nickname, email, onboarding fields
 * - `/users/{uid}/stats` → maxHeight (m HUD), bestCombo, totalPoints (best session PTS),
 *   bagGold / bagDiamonds / purpleMushrooms (YOUR BAG inventory; RTDB `increment()`)
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
import { get, increment, onValue, ref, set, update } from 'firebase/database';
import type { PlayerSkinName } from '../constants/playerSkin';
import { rtdb } from '../../firebase.js';

export const USERS_PATH = 'users';

export type UserProfileNode = {
  nickname: string;
  email: string;
  registrationComplete?: boolean;
  selectedCharacterId?: string;
  /** Playable runner skin: `FIGHTER` (see {@link ../constants/playerSkin}). */
  selected_character?: string;
  createdAt?: number;
};

export type UserStatsNode = {
  /** Peak climb HUD meters (`/stats.maxHeight`). */
  maxHeight: number;
  bestCombo: number;
  /** Best single-run peak PTS (same units as HUD score: height×10 + combo×5). */
  totalPoints: number;
  updatedAt?: number;
  /** Lifetime gold bars stored for YOUR BAG (sum of per-run pickups). */
  bagGold?: number;
  /** Lifetime diamonds stored for YOUR BAG (sum of per-run pickups). */
  bagDiamonds?: number;
  /** Purple mushrooms defeated across runs (YOUR BAG). */
  purpleMushrooms?: number;
};

export type UserBagBalances = {
  bagGold: number;
  bagDiamonds: number;
  purpleMushrooms: number;
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
        bagGold: 0,
        bagDiamonds: 0,
        purpleMushrooms: 0,
        updatedAt: Date.now(),
      } satisfies UserStatsNode);
  stats.bagGold = Math.max(0, Math.floor(Number(stats.bagGold ?? 0)));
  stats.bagDiamonds = Math.max(0, Math.floor(Number(stats.bagDiamonds ?? 0)));
  stats.purpleMushrooms = Math.max(0, Math.floor(Number(stats.purpleMushrooms ?? 0)));
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
    bagGold: 0,
    bagDiamonds: 0,
    purpleMushrooms: 0,
    updatedAt: now,
  } satisfies UserStatsNode);
}

/**
 * Atomically add session loot to `/users/{uid}/stats` using RTDB {@link increment}
 * (Firestore-style “add to balance” semantics).
 */
export async function incrementUserBagBalances(
  uid: string,
  goldDelta: number,
  diamondDelta: number,
  purpleMushroomsDelta: number,
): Promise<void> {
  const g = Math.max(0, Math.floor(goldDelta));
  const d = Math.max(0, Math.floor(diamondDelta));
  const m = Math.max(0, Math.floor(purpleMushroomsDelta));
  if (g === 0 && d === 0 && m === 0) {
    return;
  }
  const patch: Record<string, unknown> = {
    updatedAt: Date.now(),
  };
  if (g > 0) {
    patch.bagGold = increment(g);
  }
  if (d > 0) {
    patch.bagDiamonds = increment(d);
  }
  if (m > 0) {
    patch.purpleMushrooms = increment(m);
  }
  await update(userStatsRef(uid), patch);
}

/** Live YOUR BAG totals while PlayScene is active. */
export function subscribeUserBagBalances(
  uid: string,
  onBalances: (b: UserBagBalances) => void,
  onError?: (e: unknown) => void,
): () => void {
  return onValue(
    userStatsRef(uid),
    (snap) => {
      const raw = snap.val() as Partial<UserStatsNode> | null;
      onBalances({
        bagGold: Math.max(0, Math.floor(Number(raw?.bagGold ?? 0))),
        bagDiamonds: Math.max(0, Math.floor(Number(raw?.bagDiamonds ?? 0))),
        purpleMushrooms: Math.max(0, Math.floor(Number(raw?.purpleMushrooms ?? 0))),
      });
    },
    (err) => {
      onError?.(err);
    },
  );
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

export async function persistSelectedCharacter(uid: string, skin: PlayerSkinName): Promise<void> {
  await update(userProfileRef(uid), { selected_character: skin });
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
