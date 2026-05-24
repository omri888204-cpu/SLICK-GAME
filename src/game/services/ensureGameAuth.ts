import { signInAnonymously, type User } from 'firebase/auth';
import { auth } from '../../firebase.js';
import { fetchUserLedger, registerNewUser } from './rtdbUsers';

/**
 * Wait until Firebase Auth has restored (or created) a user.
 * Without the old landing gate, anonymous sign-in keeps `/users/{uid}/stats` loot in sync.
 */
export async function ensureGameAuthReady(): Promise<User | null> {
  await auth.authStateReady();

  const existing = auth.currentUser;
  if (existing) {
    return existing;
  }

  try {
    const cred = await signInAnonymously(auth);
    const u = cred.user;
    try {
      const ledger = await fetchUserLedger(u.uid);
      if (!ledger) {
        await registerNewUser(u.uid, `player_${u.uid.slice(0, 6)}`, '');
      }
    } catch (err) {
      console.warn('[ensureGameAuth] profile bootstrap failed', err);
    }
    return u;
  } catch (err) {
    const host = typeof window !== 'undefined' ? window.location.host : '';
    console.warn(
      '[ensureGameAuth] anonymous sign-in failed — menu loot needs Firebase Auth.',
      err,
      host && !host.startsWith('localhost')
        ? `Add "${host}" under Firebase Console → Authentication → Settings → Authorized domains.`
        : '',
    );
    return null;
  }
}
