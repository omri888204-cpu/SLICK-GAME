import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

/** Hardcoded web app config (bypasses build-time env on hosts like Vercel). */
const firebaseConfig = {
  apiKey: 'AIzaSyCAbFNV0Z2Nkzz95s9_Fk1GzgmpuFRqJ1k',
  authDomain: 'drift-vip.firebaseapp.com',
  projectId: 'drift-vip',
  storageBucket: 'drift-vip.appspot.com',
  messagingSenderId: '474930466991',
  appId: '1:474930466991:web:dae0d9337d0e794f54845a',
};

const app = initializeApp(firebaseConfig);

/** Shared Firestore instance for leaderboard reads/writes. */
export const db = getFirestore(app);

export { app, firebaseConfig };
