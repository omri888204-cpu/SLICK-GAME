import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';

export type LeaderboardEntry = {
  nickname: string;
  score: number;
  createdAtMs: number;
};

/** Firestore collection id — must match Firebase rules / console. */
export const LEADERBOARD_COLLECTION = 'leaderboard';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

function getDb(): Firestore | null {
  if (db) {
    return db;
  }
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined;
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined;

  if (!apiKey || !authDomain || !projectId || !appId) {
    return null;
  }

  app = initializeApp({
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId,
    storageBucket,
  });
  db = getFirestore(app);
  return db;
}

/**
 * Persist one run to Firestore: nickname + score (meters) + server timestamp.
 */
export async function saveScore(nickname: string, score: number): Promise<void> {
  const firestore = getDb();
  if (!firestore) {
    return;
  }
  const cleanNick = nickname.trim().slice(0, 20) || 'Player';
  await addDoc(collection(firestore, LEADERBOARD_COLLECTION), {
    nickname: cleanNick,
    score: Math.max(0, Math.floor(score)),
    createdAt: serverTimestamp(),
  });
}

/** @deprecated Use `saveScore` */
export const submitLeaderboardScore = saveScore;

export async function fetchTopLeaderboard(limitCount = 5): Promise<LeaderboardEntry[]> {
  const firestore = getDb();
  if (!firestore) {
    return [];
  }
  const q = query(
    collection(firestore, LEADERBOARD_COLLECTION),
    orderBy('score', 'desc'),
    limit(limitCount),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => {
    const data = doc.data();
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
