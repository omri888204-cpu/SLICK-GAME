import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase.js';

/** One saved run for Firestore + HUD (sorted by {@link LeaderboardEntry.totalScore}). */
export type LeaderboardEntry = {
  nickname: string;
  /** Total points for this run — primary leaderboard sort. */
  totalScore: number;
  /** Peak climb height for that run (HUD meters / stairs). */
  maxHeightMeters: number;
  /** Peak jump-chain (combo) count reached during that run. */
  bestCombo: number;
  createdAtMs: number;
};

/** Rows shown on the leaderboard UI and capped Firestore reads (`orderBy totalScore`, `limit`). */
export const LEADERBOARD_DISPLAY_LIMIT = 5;

/**
 * Primary Firestore collection (must match Firebase Rules + any composite indexes).
 * Fields: `nickname`, `totalScore`, `maxHeightMeters`, `bestCombo`, `createdAt`.
 */
export const LEADERBOARD_COLLECTION = 'leaderboard';

/** Older experiments / migrations; wiped by {@link clearLeaderboardDatabase}. */
export const LEADERBOARD_COLLECTION_ALT = 'global_top_runs';

/** Legacy Firebase path name — emptied together with `{@link LEADERBOARD_COLLECTION}`. */
export const LEADERBOARD_SCORES_COLLECTION_LEGACY = 'scores';

/** All Firestore buckets deleted by bootstrap / purge (batch `delete`). */
export const LEADERBOARD_CLEARABLE_COLLECTIONS = [
  LEADERBOARD_COLLECTION,
  LEADERBOARD_COLLECTION_ALT,
  LEADERBOARD_SCORES_COLLECTION_LEGACY,
] as const;

export type SaveLeaderboardRunPayload = {
  nickname: string;
  totalScore: number;
  maxHeightMeters: number;
  bestCombo: number;
};

/**
 * Persist one run that already qualifies as a global top-{@link LEADERBOARD_DISPLAY_LIMIT} entry.
 * Fields: `nickname`, `totalScore`, `maxHeightMeters`, `bestCombo`, `createdAt`.
 *
 * **Purging legacy rows:** set `VITE_LEADERBOARD_ONE_TIME_PURGE` until you redeploy without it (see {@link tryOneTimeScheduledLeaderboardPurge}); or briefly `VITE_CLEAR_LEADERBOARD_ON_BOOT=true`.
 */
export async function saveLeaderboardRun(payload: SaveLeaderboardRunPayload): Promise<void> {
  const cleanNick = payload.nickname.trim().slice(0, 20) || 'Player';
  const doc = {
    nickname: cleanNick,
    totalScore: Math.max(0, Math.floor(payload.totalScore)),
    maxHeightMeters: Math.max(0, Math.floor(payload.maxHeightMeters)),
    bestCombo: Math.max(0, Math.floor(payload.bestCombo)),
    createdAt: serverTimestamp(),
  };
  console.info('[leaderboard] saveLeaderboardRun → addDoc', {
    collection: LEADERBOARD_COLLECTION,
    ...doc,
    createdAt: '[serverTimestamp]',
  });
  await addDoc(collection(db, LEADERBOARD_COLLECTION), doc);
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

async function deleteAllDocsInCollection(collectionId: string): Promise<number> {
  const snap = await getDocs(collection(db, collectionId));
  const docs = snap.docs;
  let deleted = 0;
  const BATCH = 500;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + BATCH);
    for (const d of chunk) {
      batch.delete(d.ref);
    }
    try {
      await batch.commit();
    } catch (err) {
      console.error(
        `[leaderboard] delete batch failed for "${collectionId}" (${chunk.length} refs) — check Firestore rules allow delete`,
        err,
      );
      throw err;
    }
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * Batch-deletes **every document** under {@link LEADERBOARD_CLEARABLE_COLLECTIONS} (`delete()` on each ref).
 */
export async function clearLeaderboardDatabase(): Promise<number> {
  let total = 0;
  for (const cid of LEADERBOARD_CLEARABLE_COLLECTIONS) {
    total += await deleteAllDocsInCollection(cid);
  }
  return total;
}

/** @alias {@link clearLeaderboardDatabase} */
export async function clearLeaderboardCollection(): Promise<number> {
  return clearLeaderboardDatabase();
}

/**
 * When `import.meta.env.VITE_LEADERBOARD_ONE_TIME_PURGE` is non-empty, wipes leaderboard buckets **on every startup**
 * until you remove the env string and rebuild — briefly use for a controlled rollout or local QA only.
 *
 * Prints: Leaderboard database has been fully cleared
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
    await clearLeaderboardDatabase();
    console.info('Leaderboard database has been fully cleared');
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
    /** Legacy docs stored meters as `score` only. */
    maxHeightMeters = legacyScore;
  }

  const bc = data.bestCombo;
  const bestCombo = typeof bc === 'number' && Number.isFinite(bc) ? bc : 0;

  const createdAtMs =
    typeof data.createdAt === 'object' &&
    data.createdAt !== null &&
    'toMillis' in data.createdAt &&
    typeof (data.createdAt as { toMillis: () => number }).toMillis === 'function'
      ? (data.createdAt as { toMillis: () => number }).toMillis()
      : Date.now();

  return {
    nickname,
    totalScore: Math.max(0, Math.floor(totalScore)),
    maxHeightMeters: Math.max(0, Math.floor(maxHeightMeters)),
    bestCombo: Math.max(0, Math.floor(bestCombo)),
    createdAtMs,
  };
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
 * After a qualifying save, merges the submitted run into `remote` for immediate UI parity with Firestore.
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
 * Used to avoid saving or locally merging runs that cannot appear on the leaderboard.
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
  const col = collection(db, LEADERBOARD_COLLECTION);
  try {
    const q = query(col, orderBy('totalScore', 'desc'), limit(limitCount));
    const snapshot = await getDocs(q);
    const rows = snapshot.docs.map((docSnap) =>
      parseLeaderboardDoc(docSnap.data() as Record<string, unknown>),
    );
    rows.sort(compareLeaderboardRank);
    return rows.slice(0, limitCount);
  } catch (err) {
    console.warn(
      '[leaderboard] ordered query failed (missing index or rules); falling back to client sort',
      err,
    );
    const snapshot = await getDocs(query(col, limit(200)));
    const rows = snapshot.docs.map((docSnap) =>
      parseLeaderboardDoc(docSnap.data() as Record<string, unknown>),
    );
    rows.sort(compareLeaderboardRank);
    return rows.slice(0, limitCount);
  }
}

/**
 * Live Top N — updates whenever any qualifying document changes (same query as {@link fetchTopLeaderboard}).
 * Caller must invoke the returned unsubscribe (e.g. in `Scene.destroy`) to avoid leaks.
 */
export function subscribeTopLeaderboard(
  limitCount: number,
  onUpdate: (entries: LeaderboardEntry[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  const col = collection(db, LEADERBOARD_COLLECTION);
  const q = query(col, orderBy('totalScore', 'desc'), limit(limitCount));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((docSnap) =>
        parseLeaderboardDoc(docSnap.data() as Record<string, unknown>),
      );
      rows.sort(compareLeaderboardRank);
      onUpdate(rows.slice(0, limitCount));
    },
    (err) => {
      console.warn('[leaderboard] onSnapshot failed — check Firestore index for leaderboard/totalScore', err);
      onError?.(err);
    },
  );
}
