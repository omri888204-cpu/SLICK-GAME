import {
  GUMMY_BEAR_NAMES,
  type GummyBearName,
  isGummyBearName,
} from '../constants/gummyBears';

export const GUMMY_DISCOVERY_STORAGE_KEY = 'sky-climber:gummy-discovered';

type DiscoveredPayload = {
  discovered: GummyBearName[];
};

function readDiscoveredSet(): Set<GummyBearName> {
  if (typeof localStorage === 'undefined') {
    return new Set();
  }
  try {
    const raw = localStorage.getItem(GUMMY_DISCOVERY_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as Partial<DiscoveredPayload>;
    const list = Array.isArray(parsed.discovered) ? parsed.discovered : [];
    return new Set(list.filter(isGummyBearName));
  } catch {
    return new Set();
  }
}

function writeDiscoveredSet(discovered: Set<GummyBearName>): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const payload: DiscoveredPayload = {
    discovered: GUMMY_BEAR_NAMES.filter((name) => discovered.has(name)),
  };
  localStorage.setItem(GUMMY_DISCOVERY_STORAGE_KEY, JSON.stringify(payload));
}

/** Whether this gummy was already discovered in a prior run. */
export function isGummyDiscovered(gummyName: GummyBearName): boolean {
  return readDiscoveredSet().has(gummyName);
}

/** All gummy names the player has discovered so far. */
export function getDiscoveredGummies(): readonly GummyBearName[] {
  const discovered = readDiscoveredSet();
  return GUMMY_BEAR_NAMES.filter((name) => discovered.has(name));
}

/**
 * Mark a gummy as discovered. Returns `true` only on the **first** discovery.
 *
 * @example discoverGummy("Red Berry")
 */
export function discoverGummy(gummyName: GummyBearName | string): boolean {
  if (!isGummyBearName(gummyName)) {
    return false;
  }
  const discovered = readDiscoveredSet();
  if (discovered.has(gummyName)) {
    return false;
  }
  discovered.add(gummyName);
  writeDiscoveredSet(discovered);
  return true;
}

/** Clears saved discoveries (debug / account reset). */
export function clearDiscoveredGummies(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.removeItem(GUMMY_DISCOVERY_STORAGE_KEY);
}
