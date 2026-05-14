import {
  type DataSnapshot,
  get,
  limitToLast,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  set,
} from 'firebase/database';
import { rtdb } from '../../firebase.js';
import { fetchUserLedger } from './rtdbUsers';

/** One saved run for RTDB + HUD (sorted by {@link LeaderboardEntry.totalScore}). */
export type LeaderboardEntry = {
  nickname: string;
  /** Total points for this run — primary leaderboard sort. */
  totalScore: number;
  /** Peak climb height for that run (HUD meters / stairs). */
  maxHeightMeters: number;
  /** Peak jump-chain (combo) count reached during that run. */
  bestCombo: number;
  createdAtMs: number;
  /** Auth UID when row was synced from `/users/` (optional legacy rows omit this). */
  playerUid?: string;
};

/** Rows shown on the leaderboard UI (`orderByChild('totalScore')` + limit). */
export const LEADERBOARD_DISPLAY_LIMIT = 5;

/** Higher max height first; ties use total score, then newer run. */
export function compareLeaderboardByMaxHeight(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (b.maxHeightMeters !== a.maxHeightMeters) {
    return b.maxHeightMeters - a.maxHeightMeters;
  }
  if (b.totalScore !== a.totalScore) {
    return b.totalScore - a.totalScore;
  }
  return b.createdAtMs - a.createdAtMs;
}

/**
 * Top-level RTDB path for scores (child of db root — does not replace `/`).
 * Full path: `/leaderboard/{pushId}`.
 */
export const LEADERBOARD_COLLECTION = 'leaderboard';

/** Legacy path; emptied together with main leaderboard. */
export const LEADERBOARD_COLLECTION_ALT = 'global_top_runs';

/** Legacy path name. */
export const LEADERBOARD_SCORES_COLLECTION_LEGACY = 'scores';

/** Console line after a successful full RTDB wipe (exact string for runbooks / filtering). */
export const LEADERBOARD_PURGE_CONFIRM_LOG = 'Leaderboard database has been fully cleared';

const STORAGE_LEADERBOARD_PURGE_DONE_PREFIX = 'sky_climber_leaderboard_purge_done:';

/** Child paths removed entirely by {@link clearLeaderboardDatabase} (not the database root). */
export const LEADERBOARD_CLEARABLE_COLLECTIONS = [
  LEADERBOARD_COLLECTION,
  LEADERBOARD_COLLECTION_ALT,
  LEADERBOARD_SCORES_COLLECTION_LEGACY,
] as const;

function leaderboardRootRef() {
  return ref(rtdb, LEADERBOARD_COLLECTION);
}

/**
 * Leaderboard snapshot row with **nickname** and PB stats sourced from `/users/{uid}/profile`
 * and `/users/{uid}/stats` (expects stats already merged for this run).
 */
export async function buildLeaderboardRowFromSyncedUser(
  uid: string,
  totalScore: number,
): Promise<LeaderboardEntry | null> {
  const ledger = await fetchUserLedger(uid);
  if (!ledger) {
    return null;
  }
  const nickname = ledger.profile.nickname.trim().slice(0, 20) || 'Player';
  const maxHeightMeters = Math.max(0, Math.floor(ledger.stats.maxHeight ?? 0));
  const bestCombo = Math.max(0, Math.floor(ledger.stats.bestCombo ?? 0));
  return {
    nickname,
    totalScore: Math.max(0, Math.floor(totalScore)),
    maxHeightMeters,
    bestCombo,
    createdAtMs: Date.now(),
    playerUid: uid,
  };
}

export type SaveLeaderboardRunPayload = {
  nickname: string;
  totalScore: number;
  maxHeightMeters: number;
  bestCombo: number;
  playerUid?: string;
};

/**
 * Write one qualifying run under `/leaderboard/{autoId}`.
 *
 * **RTDB rules:** index `totalScore` and `maxHeightMeters` on `leaderboard` for ordered queries.
 */
export async function saveLeaderboardRun(payload: SaveLeaderboardRunPayload): Promise<void> {
  const cleanNick = payload.nickname.trim().slice(0, 20) || 'Player';
  const createdAtMs = Date.now();
  const doc = {
    nickname: cleanNick,
    totalScore: Math.max(0, Math.floor(payload.totalScore)),
    maxHeightMeters: Math.max(0, Math.floor(payload.maxHeightMeters)),
    bestCombo: Math.max(0, Math.floor(payload.bestCombo)),
    createdAt: createdAtMs,
    ...(payload.playerUid ? { playerUid: payload.playerUid } : {}),
  };
  console.info('[leaderboard] saveLeaderboardRun → push /' + LEADERBOARD_COLLECTION, doc);
  const newRef = push(leaderboardRootRef());
  await set(newRef, doc);
}

/** @deprecated Prefer {@link saveLeaderboardRun}. */
export async function saveScore(nickname: string, score: number): Promise<void> {
  await saveLeaderboardRun({
    nickname,
    totalScore: score,
    maxHeightMeters: score,
    bestCombo: 0,
  });
}

/** @deprecated Use {@link saveLeaderboardRun} */
export const submitLeaderboardScore = saveScore;

async function removeSubtreeAtPath(path: string): Promise<number> {
  const r = ref(rtdb, path);
  const snap = await get(r);
  const n = snap.exists() && snap.val() !== null ? Object.keys(snap.val() as object).length : 0;
  if (snap.exists()) {
    await remove(r);
  }
  return n;
}

/**
 * Deletes each top-level child path in {@link LEADERBOARD_CLEARABLE_COLLECTIONS} (`remove()` on that node only).
 */
export async function clearLeaderboardDatabase(): Promise<number> {
  let total = 0;
  for (const p of LEADERBOARD_CLEARABLE_COLLECTIONS) {
    total += await removeSubtreeAtPath(p);
  }
  return total;
}

/** @alias {@link clearLeaderboardDatabase} */
export async function clearLeaderboardCollection(): Promise<number> {
  return clearLeaderboardDatabase();
}

/**
 * Explicit one-time data wipe: Firebase Realtime Database **`remove()`** on each path in
 * {@link LEADERBOARD_CLEARABLE_COLLECTIONS} — `leaderboard`, `global_top_runs`, and legacy `scores` (never `/` root).
 */
export async function purgeLeaderboardDataOnce(): Promise<number> {
  return clearLeaderboardDatabase();
}

/**
 * Called from {@link Game.start} before scenes load. If `VITE_LEADERBOARD_ONE_TIME_PURGE` is non-empty, runs
 * {@link purgeLeaderboardDataOnce} **once per browser** for that sentinel (see `localStorage` key below), logs
 * {@link LEADERBOARD_PURGE_CONFIRM_LOG}, then skips on later loads — **remove the env var and rebuild** so the boot
 * purge path no longer runs (“function removed”). Bump the sentinel string if you need another wipe wave.
 */
export async function tryOneTimeScheduledLeaderboardPurge(): Promise<boolean> {
  const sentinel =
    typeof import.meta.env.VITE_LEADERBOARD_ONE_TIME_PURGE === 'string'
      ? import.meta.env.VITE_LEADERBOARD_ONE_TIME_PURGE.trim()
      : '';
  if (!sentinel) {
    return false;
  }
  try {
    if (typeof globalThis.localStorage === 'undefined') {
      console.warn('[leaderboard] one-time purge skipped — no localStorage');
      return false;
    }
    const key = STORAGE_LEADERBOARD_PURGE_DONE_PREFIX + sentinel;
    if (globalThis.localStorage.getItem(key) === '1') {
      return false;
    }
    await clearLeaderboardDatabase();
    globalThis.localStorage.setItem(key, '1');
    console.info(LEADERBOARD_PURGE_CONFIRM_LOG);
    return true;
  } catch (err) {
    console.error('[leaderboard] scheduled one-time purge failed', err);
    return false;
  }
}

function parseLeaderboardDoc(data: Record<string, unknown>): LeaderboardEntry {
  const nickname = typeof data.nickname === 'string' ? data.nickname : 'Player';

  const totalScoreRaw = data.totalScore;
  const legacyScore = data.score;
  let totalScore = 0;
  if (typeof totalScoreRaw === 'number' && Number.isFinite(totalScoreRaw)) {
    totalScore = totalScoreRaw;
  } else if (typeof legacyScore === 'number' && Number.isFinite(legacyScore)) {
    totalScore = legacyScore;
  }

  const maxRaw = data.maxHeightMeters;
  let maxHeightMeters = typeof maxRaw === 'number' && Number.isFinite(maxRaw) ? maxRaw : 0;
  if (
    maxHeightMeters === 0 &&
    typeof legacyScore === 'number' &&
    Number.isFinite(legacyScore) &&
    typeof totalScoreRaw !== 'number'
  ) {
    maxHeightMeters = legacyScore;
  }

  const bc = data.bestCombo;
  const bestCombo = typeof bc === 'number' && Number.isFinite(bc) ? bc : 0;

  let createdAtMs = Date.now();
  const ca = data.createdAt;
  if (typeof ca === 'number' && Number.isFinite(ca)) {
    createdAtMs = ca;
  } else if (
    typeof ca === 'object' &&
    ca !== null &&
    'toMillis' in ca &&
    typeof (ca as { toMillis: () => number }).toMillis === 'function'
  ) {
    createdAtMs = (ca as { toMillis: () => number }).toMillis();
  }

  return {
    nickname,
    totalScore: Math.max(0, Math.floor(totalScore)),
    maxHeightMeters: Math.max(0, Math.floor(maxHeightMeters)),
    bestCombo: Math.max(0, Math.floor(bestCombo)),
    createdAtMs,
    ...(typeof data.playerUid === 'string'
      ? { playerUid: data.playerUid.trim() || undefined }
      : typeof data.uid === 'string'
        ? { playerUid: (data.uid as string).trim() || undefined }
        : {}),
  };
}

function snapshotToEntries(snap: DataSnapshot): LeaderboardEntry[] {
  if (!snap.exists() || snap.val() == null) {
    return [];
  }
  const val = snap.val() as Record<string, Record<string, unknown>>;
  return Object.values(val).map((row) => parseLeaderboardDoc(row));
}

/** Higher score first; ties use height, then combo, then newer run (deterministic UI). */
export function compareLeaderboardRank(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (b.totalScore !== a.totalScore) {
    return b.totalScore - a.totalScore;
  }
  if (b.maxHeightMeters !== a.maxHeightMeters) {
    return b.maxHeightMeters - a.maxHeightMeters;
  }
  if (b.bestCombo !== a.bestCombo) {
    return b.bestCombo - a.bestCombo;
  }
  return b.createdAtMs - a.createdAtMs;
}

/**
 * After a qualifying save, merges the submitted run into `remote` for immediate UI parity with RTDB.
 */
export function mergeSessionIntoTop(
  remote: LeaderboardEntry[],
  session: LeaderboardEntry,
  limitCount = LEADERBOARD_DISPLAY_LIMIT,
): LeaderboardEntry[] {
  return [...remote, session].sort(compareLeaderboardRank).slice(0, limitCount);
}

/**
 * True if `session` is one of the best `limitCount` runs among `remote ∪ {session}` (same ranking as the UI).
 */
export function sessionQualifiesForTop(
  remote: LeaderboardEntry[],
  session: LeaderboardEntry,
  limitCount = LEADERBOARD_DISPLAY_LIMIT,
): boolean {
  const combined = [...remote, session];
  combined.sort(compareLeaderboardRank);
  const top = combined.slice(0, limitCount);
  return top.includes(session);
}

export async function fetchTopLeaderboard(limitCount = LEADERBOARD_DISPLAY_LIMIT): Promise<LeaderboardEntry[]> {
  const base = leaderboardRootRef();
  try {
    const q = query(base, orderByChild('totalScore'), limitToLast(limitCount));
    const snapshot = await get(q);
    const rows = snapshotToEntries(snapshot);
    rows.sort(compareLeaderboardRank);
    return rows.slice(0, limitCount);
  } catch (err) {
    console.warn(
      '[leaderboard] RTDB ordered query failed (rules / index); falling back to client sort',
      err,
    );
    const snapshot = await get(base);
    const rows = snapshotToEntries(snapshot);
    rows.sort(compareLeaderboardRank);
    return rows.slice(0, limitCount);
  }
}

/**
 * Top N by peak height (`maxHeightMeters`). Requires RTDB rules:
 * `"leaderboard": { ".indexOn": ["maxHeightMeters", "totalScore"] }` (or full data fallback).
 */
export async function fetchTopLeaderboardByMaxHeight(
  limitCount = LEADERBOARD_DISPLAY_LIMIT,
): Promise<LeaderboardEntry[]> {
  const base = leaderboardRootRef();
  try {
    const q = query(base, orderByChild('maxHeightMeters'), limitToLast(limitCount));
    const snapshot = await get(q);
    const rows = snapshotToEntries(snapshot);
    rows.sort(compareLeaderboardByMaxHeight);
    return rows.slice(0, limitCount);
  } catch (err) {
    console.warn(
      '[leaderboard] maxHeight query failed (rules / index); falling back to client sort',
      err,
    );
    const snapshot = await get(base);
    const rows = snapshotToEntries(snapshot);
    rows.sort(compareLeaderboardByMaxHeight);
    return rows.slice(0, limitCount);
  }
}

/**
 * Live Top N — updates whenever `/leaderboard` data matching the query changes.
 * Caller must invoke the returned unsubscribe to avoid leaks.
 */
export function subscribeTopLeaderboard(
  limitCount: number,
  onUpdate: (entries: LeaderboardEntry[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  const q = query(leaderboardRootRef(), orderByChild('totalScore'), limitToLast(limitCount));
  return onValue(
    q,
    (snapshot) => {
      const rows = snapshotToEntries(snapshot);
      rows.sort(compareLeaderboardRank);
      onUpdate(rows.slice(0, limitCount));
    },
    (err) => {
      console.warn('[leaderboard] onValue failed — check RTDB rules and .indexOn for leaderboard/totalScore', err);
      onError?.(err);
    },
  );
}
