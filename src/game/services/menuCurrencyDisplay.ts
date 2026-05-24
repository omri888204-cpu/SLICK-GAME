import { auth } from '../../firebase.js';
import {
  debugLogMenuBagStorageRead,
  GAMEPLAY_BAG_STORAGE_KEY,
  MENU_BAG_STORAGE_KEY,
  readMenuBagCache,
  writeMenuBagCache,
} from './menuBagCache';
import { fetchUserLedger, userStatsRef } from './rtdbUsers';
import { get } from 'firebase/database';

/** Where main-menu currency values came from (logged on every display update). */
export type MenuCurrencySource = 'firebase' | 'localStorage' | 'default';

export type MenuCurrencySnapshot = {
  gold: number;
  diamonds: number;
  source: MenuCurrencySource;
  uid?: string;
  raw?: unknown;
};

export function debugLogFirebaseAuthUser(): void {
  const user = auth.currentUser;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
  console.info('[MenuCurrency] firebase auth user', {
    origin,
    uid: user?.uid ?? null,
    isAnonymous: user?.isAnonymous ?? null,
    email: user?.email ?? null,
  });
}

export function debugLogLocalStorageCurrency(): void {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
  let raw: string | null = null;
  if (typeof localStorage !== 'undefined') {
    raw = localStorage.getItem(GAMEPLAY_BAG_STORAGE_KEY);
  }
  const parsed = readMenuBagCache();
  console.info('[MenuCurrency] localStorage values', {
    gameplaySaveKey: GAMEPLAY_BAG_STORAGE_KEY,
    menuCurrencySaveKey: MENU_BAG_STORAGE_KEY,
    saveKey: MENU_BAG_STORAGE_KEY,
    origin,
    raw,
    gold: parsed?.gold ?? null,
    diamonds: parsed?.diamonds ?? null,
    uid: parsed?.uid ?? null,
  });
}

export function logMenuCurrencyLoad(label: string, snap: MenuCurrencySnapshot): void {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
  console.info(`[MenuCurrency] ${label}`, {
    gameplaySaveKey: GAMEPLAY_BAG_STORAGE_KEY,
    menuCurrencySaveKey: MENU_BAG_STORAGE_KEY,
    saveKey: MENU_BAG_STORAGE_KEY,
    origin,
    source: snap.source,
    gold: snap.gold,
    diamonds: snap.diamonds,
    loadedGold: snap.gold,
    loadedDiamonds: snap.diamonds,
    uid: snap.uid ?? auth.currentUser?.uid ?? null,
    saveData: snap.raw ?? null,
  });
}

/** Temporary debug — which save source won for the menu HUD. */
export function logMenuCurrencySourceMessage(snap: MenuCurrencySnapshot): void {
  const payload = {
    gold: snap.gold,
    diamonds: snap.diamonds,
    uid: snap.uid ?? auth.currentUser?.uid ?? null,
    saveData: snap.raw ?? null,
  };
  if (snap.source === 'firebase') {
    console.info('[MenuCurrency] loaded from firebase', payload);
    return;
  }
  if (snap.source === 'localStorage') {
    console.info('[MenuCurrency] loaded from localStorage', payload);
    return;
  }
  console.info('[MenuCurrency] fallback to default', payload);
}

export function readMenuCurrencyFromLocalStorage(): MenuCurrencySnapshot | null {
  const cached = readMenuBagCache();
  if (!cached) {
    return null;
  }
  return {
    gold: cached.gold,
    diamonds: cached.diamonds,
    source: 'localStorage',
    uid: cached.uid,
    raw: cached,
  };
}

export async function readMenuCurrencyFromFirebase(uid: string): Promise<MenuCurrencySnapshot | null> {
  try {
    const ledger = await fetchUserLedger(uid);
    if (ledger) {
      const snap: MenuCurrencySnapshot = {
        gold: ledger.stats.bagGold ?? 0,
        diamonds: ledger.stats.bagDiamonds ?? 0,
        source: 'firebase',
        uid,
        raw: ledger.stats,
      };
      console.info('[MenuCurrency] firebase profile fetch', {
        uid,
        saveData: snap.raw,
        gold: snap.gold,
        diamonds: snap.diamonds,
      });
      return snap;
    }

    const statsSnap = await get(userStatsRef(uid));
    if (!statsSnap.exists()) {
      console.info('[MenuCurrency] firebase profile empty (no stats node)', { uid });
      return null;
    }
    const stats = statsSnap.val() as { bagGold?: number; bagDiamonds?: number };
    const snap: MenuCurrencySnapshot = {
      gold: Math.max(0, Math.floor(Number(stats.bagGold ?? 0))),
      diamonds: Math.max(0, Math.floor(Number(stats.bagDiamonds ?? 0))),
      source: 'firebase',
      uid,
      raw: { ...stats, channel: 'stats-only' },
    };
    console.info('[MenuCurrency] firebase stats-only fetch', {
      uid,
      saveData: snap.raw,
      gold: snap.gold,
      diamonds: snap.diamonds,
    });
    return snap;
  } catch (err) {
    console.warn('[MenuCurrency] firebase profile unavailable — localStorage fallback', err);
    return null;
  }
}

export function snapshotFromFirebaseLive(
  uid: string,
  bagGold: number,
  bagDiamonds: number,
): MenuCurrencySnapshot {
  return {
    gold: bagGold,
    diamonds: bagDiamonds,
    source: 'firebase',
    uid,
    raw: { bagGold, bagDiamonds, channel: 'live' },
  };
}

function firebaseIsEmpty(firebase: MenuCurrencySnapshot | null): boolean {
  return !!firebase && firebase.gold === 0 && firebase.diamonds === 0;
}

/**
 * Priority: firebase (with values) → localStorage → firebase empty (only when allowed) → default.
 * Never prefer firebase 0/0 over saved local totals while save is still loading.
 */
export function resolveMenuCurrencyDisplay(
  local: MenuCurrencySnapshot | null,
  firebase: MenuCurrencySnapshot | null,
  options?: { allowFirebaseEmpty?: boolean; allowDefault?: boolean },
): MenuCurrencySnapshot | null {
  const localHasValue = !!local && (local.gold > 0 || local.diamonds > 0);
  const firebaseHasValue = !!firebase && (firebase.gold > 0 || firebase.diamonds > 0);

  if (firebaseHasValue) {
    return { ...firebase!, source: 'firebase' };
  }

  if (localHasValue) {
    return {
      ...local!,
      source: 'localStorage',
      raw: firebase
        ? { keptLocal: local!.raw, ignoredFirebase: firebase.raw }
        : local!.raw,
    };
  }

  if (local) {
    return { ...local, source: 'localStorage' };
  }

  if (firebase && !firebaseIsEmpty(firebase)) {
    return { ...firebase, source: 'firebase' };
  }

  if (firebase && firebaseIsEmpty(firebase) && options?.allowFirebaseEmpty) {
    return { ...firebase, source: 'firebase' };
  }

  if (options?.allowDefault) {
    return { gold: 0, diamonds: 0, source: 'default' };
  }

  return null;
}

export function persistMenuCurrencySnapshot(snap: MenuCurrencySnapshot): void {
  if (snap.source === 'default') {
    return;
  }
  writeMenuBagCache(snap.gold, snap.diamonds, snap.uid);
}

export async function loadMenuCurrencyForDisplay(): Promise<{
  immediateLocal: MenuCurrencySnapshot | null;
  resolved: MenuCurrencySnapshot;
}> {
  debugLogMenuBagStorageRead();
  debugLogLocalStorageCurrency();
  debugLogFirebaseAuthUser();

  const local = readMenuCurrencyFromLocalStorage();
  let firebase: MenuCurrencySnapshot | null = null;

  const uid = auth.currentUser?.uid;
  if (uid) {
    firebase = await readMenuCurrencyFromFirebase(uid);
  } else {
    console.info('[MenuCurrency] auth unavailable on this origin — trying localStorage only', {
      origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
      hint: 'Add this host to Firebase Console → Authentication → Authorized domains (e.g. 192.168.1.74)',
    });
  }

  const resolved = resolveMenuCurrencyDisplay(local, firebase, {
    allowFirebaseEmpty: true,
    allowDefault: true,
  });
  if (!resolved) {
    return { immediateLocal: local, resolved: { gold: 0, diamonds: 0, source: 'default' } };
  }
  logMenuCurrencyLoad(`menu currency resolved: ${resolved.source}`, resolved);
  logMenuCurrencySourceMessage(resolved);
  return { immediateLocal: local, resolved };
}
