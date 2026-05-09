import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase.js';

export type LeaderboardEntry = {
  nickname: string;
  score: number;
  createdAtMs: number;
};

/** Firestore collection id — must match Firebase rules / console. */
export const LEADERBOARD_COLLECTION = 'leaderboard';

/**
 * Persist one run to Firestore: nickname + score (meters) + server timestamp.
 */
export async function saveScore(nickname: string, score: number): Promise<void> {
  const cleanNick = nickname.trim().slice(0, 20) || 'Player';
  const payload = {
    nickname: cleanNick,
    score: Math.max(0, Math.floor(score)),
    createdAt: serverTimestamp(),
  };
  console.info('[leaderboard] saveScore → addDoc', {
    collection: 'leaderboard',
    nickname: cleanNick,
    score: payload.score,
  });
  await addDoc(collection(db, 'leaderboard'), payload);
}

/** @deprecated Use `saveScore` */
export const submitLeaderboardScore = saveScore;

export async function fetchTopLeaderboard(limitCount = 5): Promise<LeaderboardEntry[]> {
  const q = query(
    collection(db, LEADERBOARD_COLLECTION),
    orderBy('score', 'desc'),
    limit(limitCount),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      nickname: typeof data.nickname === 'string' ? data.nickname : 'Player',
      score: typeof data.score === 'number' ? data.score : 0,
      createdAtMs:
        typeof data.createdAt?.toMillis === 'function'
          ? data.createdAt.toMillis()
          : Date.now(),
    };
  });
}
