import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

/**
 * **Web app object** must match Firebase Console → Project settings → **General** → *Your apps* → Web.
 * Copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and use this
 * **Realtime Database URL** for `databaseURL`.
 *
 * Error `auth/configuration-not-found`: usually wrong/rotated API key & app credentials, Auth not enabled
 * for the project, or this config is from a different Firebase project than the one you enabled Auth on.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyCAbFNV0Z2Nkzz95s9_Fk1GzgmpuFRqJ1k',
  authDomain: 'drift-vip.firebaseapp.com',
  databaseURL: 'https://drift-vip-default-rtdb.europe-west1.firebasedatabase.app/',
  projectId: 'drift-vip',
  storageBucket: 'drift-vip.firebasestorage.app',
  messagingSenderId: '474930466991',
  appId: '1:474930466991:web:dae0d9337d0e794f54845a',
};

const REQUIRED_CONFIG_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'databaseURL',
];

/** @returns {boolean} true if usable */
function firebaseConfigLooksComplete(cfg) {
  return REQUIRED_CONFIG_KEYS.every((key) => {
    const val = cfg[key];
    return typeof val === 'string' && val.trim().length > 0;
  });
}

if (!firebaseConfigLooksComplete(firebaseConfig)) {
  const missing = REQUIRED_CONFIG_KEYS.filter(
    (key) =>
      firebaseConfig[key] === undefined ||
      firebaseConfig[key] === null ||
      String(firebaseConfig[key]).trim() === '',
  );
  console.error(
    '[Firebase] firebaseConfig is incomplete. Missing or empty:',
    missing.join(', '),
    '— copy the web app object from Firebase Console → Project settings.',
  );
}

/** One app per page; avoids duplicate `initializeApp` during Vite HMR. */
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/** Realtime Database — leaderboard code uses child paths only (e.g. `leaderboard/`), never the DB root. */
export const rtdb = getDatabase(app);

/** Email/password Auth — add LAN dev hosts (e.g. `192.168.1.74`) under Firebase Console → Authentication → Settings → Authorized domains. */
export const auth = getAuth(app);

export { app, firebaseConfig };
