import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

/**
 * Hardcoded web app config (bypasses build-time env on hosts like Vercel).
 * `databaseURL` targets the europe-west1 Realtime Database instance (not the root; app code only uses child paths).
 */
const firebaseConfig = {
  apiKey: 'AIzaSyCAbFNV0Z2Nkzz95s9_Fk1GzgmpuFRqJ1k',
  authDomain: 'drift-vip.firebaseapp.com',
  databaseURL: 'https://drift-vip-default-rtdb.europe-west1.firebasedatabase.app/',
  projectId: 'drift-vip',
  storageBucket: 'drift-vip.appspot.com',
  messagingSenderId: '474930466991',
  appId: '1:474930466991:web:dae0d9337d0e794f54845a',
};

const app = initializeApp(firebaseConfig);

/** Realtime Database — leaderboard code uses child paths only (e.g. `leaderboard/`), never the DB root. */
export const rtdb = getDatabase(app);

export { app, firebaseConfig };
