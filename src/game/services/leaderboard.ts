import {
  addDoc,
  collection,
  getDocs,
  limit,
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

/** @deprecated Old collection; cleared when {@link clearLeaderboardCollection} runs. */
export const LEADERBOARD_COLLECTION_LEGACY = 'leaderboard';

/**
 * Global top runs (v2). Add matching Firestore rules mirroring the legacy `leaderboard` collection.
 * Fields: `nickname`, `totalScore`, `maxHeightMeters`, `bestCombo`, `createdAt`.
 */
export const LEADERBOARD_COLLECTION = 'global_top_runs';

export type SaveLeaderboardRunPayload = {
  nickname: string;
  totalScore: number;
  maxHeightMeters: number;
  bestCombo: number;
};

/**
 * Persist one run. Firestore fields: `nickname`, `totalScore`, `maxHeightMeters`, `bestCombo`, `createdAt`.
 *
 * **One-time wipe:** set `VITE_CLEAR_LEADERBOARD_ON_BOOT=true`, rebuild, open the game once, then remove the flag.
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
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * Deletes every document in the legacy `leaderboard` collection and {@link LEADERBOARD_COLLECTION}
 * (batched, 500/writeBatch).
 */
export async function clearLeaderboardCollection(): Promise<number> {
  const legacy = await deleteAllDocsInCollection(LEADERBOARD_COLLECTION_LEGACY);
  const current = await deleteAllDocsInCollection(LEADERBOARD_COLLECTION);
  const total = legacy + current;
  console.info('[leaderboard] clearLeaderboardCollection deleted', { legacy, current, total });
  return total;
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

export async function fetchTopLeaderboard(limitCount = 5): Promise<LeaderboardEntry[]> {
  const q = query(
    collection(db, LEADERBOARD_COLLECTION),
    orderBy('totalScore', 'desc'),
    limit(limitCount),
  );
  const snapshot = await getDocs(q);
  const rows = snapshot.docs.map((docSnap) => parseLeaderboardDoc(docSnap.data() as Record<string, unknown>));
  rows.sort(compareLeaderboardRank);
  return rows.slice(0, limitCount);
}
