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

function getFirebaseDb(): Firestore {
  if (db) {
    return db;
  }
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;

  if (!apiKey || !authDomain || !projectId || !appId) {
    const detail =
      'Missing VITE_FIREBASE_* at build time. In Vercel: Project → Settings → Environment Variables, add VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID (and optional MESSAGING_SENDER_ID, STORAGE_BUCKET), then redeploy.';
    console.error('[leaderboard]', detail, {
      hasApiKey: Boolean(apiKey),
      hasAuthDomain: Boolean(authDomain),
      hasProjectId: Boolean(projectId),
      hasAppId: Boolean(appId),
    });
    throw new Error(detail);
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
 * Uses explicit `addDoc(collection(db, 'leaderboard'), ...)` so the target collection is obvious.
 */
export async function saveScore(nickname: string, score: number): Promise<void> {
  const firestoreDb = getFirebaseDb();
  const cleanNick = nickname.trim().slice(0, 20) || 'Player';
  const payload = {
    nickname: cleanNick,
    score: Math.max(0, Math.floor(score)),
    createdAt: serverTimestamp(),
  };
  console.info('[leaderboard] saveScore → addDoc', {
    collection: LEADERBOARD_COLLECTION,
    nickname: cleanNick,
    score: payload.score,
  });
  await addDoc(collection(firestoreDb, 'leaderboard'), payload);
}

/** @deprecated Use `saveScore` */
export const submitLeaderboardScore = saveScore;

export async function fetchTopLeaderboard(limitCount = 5): Promise<LeaderboardEntry[]> {
  let firestoreDb: Firestore;
  try {
    firestoreDb = getFirebaseDb();
  } catch (e) {
    console.error('[leaderboard] fetchTopLeaderboard: no db', e);
    return [];
  }
  const q = query(
    collection(firestoreDb, LEADERBOARD_COLLECTION),
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
