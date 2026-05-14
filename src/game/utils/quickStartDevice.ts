/** Shared heuristics for “get to gameplay fast” on phones / tablets. */

export function isQuickStartMobileDevice(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const narrow = window.matchMedia?.('(max-width: 560px)').matches ?? false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return narrow || coarse || 'ontouchstart' in window;
}

/** Boot splash: desktop keeps a short beat; mobile skips straight to menu. */
export function getBootMinDisplayMs(): number {
  if (typeof window === 'undefined') {
    return 720;
  }
  return isQuickStartMobileDevice() ? 120 : 720;
}

export function shouldUseBootGlowFilter(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return !isQuickStartMobileDevice();
}
