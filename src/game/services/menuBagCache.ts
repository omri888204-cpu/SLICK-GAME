/**
 * Canonical localStorage bag totals — written by PlayScene (`writeMenuBagCache`), read by MenuScene.
 * Firebase RTDB `/users/{uid}/stats` is the online source; this key is the offline cache.
 */
export const GAMEPLAY_BAG_STORAGE_KEY = 'sky-climber:menu-bag-totals';
/** @deprecated alias — same key as {@link GAMEPLAY_BAG_STORAGE_KEY} */
export const MENU_BAG_STORAGE_KEY = GAMEPLAY_BAG_STORAGE_KEY;

const STORAGE_KEY = GAMEPLAY_BAG_STORAGE_KEY;

/** Log every localStorage key on this origin (debug). */
export function debugLogAllLocalStorageKeys(): string[] {
  const origin = getStorageOrigin();
  if (typeof localStorage === 'undefined') {
    console.info('[MenuBagCache] all localStorage keys', { origin, keys: [] });
    return [];
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key) {
      keys.push(key);
    }
  }
  keys.sort();
  console.info('[MenuBagCache] all localStorage keys', {
    origin,
    count: keys.length,
    keys,
  });
  return keys;
}

/** Confirm gameplay + menu use the same localStorage key. */
export function debugLogBagSaveKeyComparison(): void {
  console.info('[MenuBagCache] save key comparison', {
    origin: getStorageOrigin(),
    gameplaySaveKey: GAMEPLAY_BAG_STORAGE_KEY,
    menuCurrencySaveKey: MENU_BAG_STORAGE_KEY,
    keysMatch: GAMEPLAY_BAG_STORAGE_KEY === MENU_BAG_STORAGE_KEY,
  });
}

function parseBagPayload(raw: string, key: string): MenuBagCache | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const gold = Math.max(
      0,
      Math.floor(Number(parsed.gold ?? parsed.bagGold ?? 0)),
    );
    const diamonds = Math.max(
      0,
      Math.floor(Number(parsed.diamonds ?? parsed.bagDiamonds ?? 0)),
    );
    const uid = typeof parsed.uid === 'string' ? parsed.uid : undefined;
    const updatedAt = Number(parsed.updatedAt ?? 0);
    if (gold === 0 && diamonds === 0 && key !== STORAGE_KEY) {
      return null;
    }
    return { gold, diamonds, uid, updatedAt };
  } catch {
    return null;
  }
}

/** Scan localStorage for any JSON entry that looks like bag totals (fallback if key moved). */
export function findBagSaveInLocalStorage(): { key: string; data: MenuBagCache } | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const primaryRaw = localStorage.getItem(STORAGE_KEY);
  if (primaryRaw) {
    const data = parseBagPayload(primaryRaw, STORAGE_KEY);
    if (data) {
      return { key: STORAGE_KEY, data };
    }
  }
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || key === STORAGE_KEY) {
      continue;
    }
    const raw = localStorage.getItem(key);
    if (!raw) {
      continue;
    }
    const data = parseBagPayload(raw, key);
    if (data && (data.gold > 0 || data.diamonds > 0)) {
      console.info('[MenuBagCache] found bag-like save under alternate key', {
        key,
        gold: data.gold,
        diamonds: data.diamonds,
        canonicalKey: STORAGE_KEY,
      });
      return { key, data };
    }
  }
  return null;
}

export type MenuBagCache = {
  gold: number;
  diamonds: number;
  uid?: string;
  updatedAt: number;
};

function getStorageOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'unknown';
}

/** Debug: log whether save exists on this origin and what was loaded. */
export function debugLogMenuBagStorageRead(): MenuBagCache | null {
  debugLogAllLocalStorageKeys();
  debugLogBagSaveKeyComparison();

  const origin = getStorageOrigin();
  const saveKey = STORAGE_KEY;

  if (typeof localStorage === 'undefined') {
    console.info('[MenuBagCache] localStorage unavailable', {
      saveKey,
      origin,
      loadedGold: null,
      loadedDiamonds: null,
    });
    return null;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  const found = findBagSaveInLocalStorage();
  if (!found) {
    console.info('[MenuBagCache] no save on this origin (first launch / empty storage)', {
      saveKey,
      origin,
      loadedGold: 0,
      loadedDiamonds: 0,
      note: 'localhost and LAN IP use separate storage — play once on this URL to build save',
    });
    return null;
  }

  const parsed = found.data;
  console.info('[MenuBagCache] loaded save from localStorage', {
    saveKey: found.key,
    canonicalKey: saveKey,
    origin,
    loadedGold: parsed.gold,
    loadedDiamonds: parsed.diamonds,
    uid: parsed.uid ?? null,
    updatedAt: parsed.updatedAt ?? null,
    raw: found.key === STORAGE_KEY ? raw : localStorage.getItem(found.key),
  });
  return parsed;
}

export function readMenuBagCache(): MenuBagCache | null {
  const found = findBagSaveInLocalStorage();
  return found?.data ?? null;
}

export function writeMenuBagCache(gold: number, diamonds: number, uid?: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const nextGold = Math.max(0, Math.floor(gold));
    const nextDiamonds = Math.max(0, Math.floor(diamonds));
    const prev = readMenuBagCache();
    const origin = getStorageOrigin();

    if (nextGold === 0 && nextDiamonds === 0) {
      if (!prev) {
        console.info('[MenuBagCache] skip persisting empty defaults (no prior save)', {
          saveKey: STORAGE_KEY,
          origin,
        });
        return;
      }
      if (prev.gold > 0 || prev.diamonds > 0) {
        console.info('[MenuBagCache] skip zero overwrite of existing save', {
          saveKey: STORAGE_KEY,
          origin,
          existing: prev,
          attemptedUid: uid ?? null,
        });
        return;
      }
    }

    if (
      prev &&
      nextGold === 0 &&
      nextDiamonds === 0 &&
      (prev.gold > 0 || prev.diamonds > 0) &&
      uid &&
      prev.uid &&
      uid !== prev.uid
    ) {
      console.info('[MenuBagCache] skip zero overwrite from different account', {
        saveKey: STORAGE_KEY,
        origin,
        existing: prev,
        attemptedUid: uid,
      });
      return;
    }

    const payload: MenuBagCache = {
      gold: nextGold,
      diamonds: nextDiamonds,
      uid,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    console.info('[MenuBagCache] wrote save to localStorage', {
      gameplaySaveKey: GAMEPLAY_BAG_STORAGE_KEY,
      menuCurrencySaveKey: MENU_BAG_STORAGE_KEY,
      saveKey: STORAGE_KEY,
      origin,
      loadedGold: payload.gold,
      loadedDiamonds: payload.diamonds,
      uid: payload.uid ?? null,
    });
  } catch {
    /* private mode / quota */
  }
}
