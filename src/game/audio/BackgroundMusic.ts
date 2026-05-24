let bgm: HTMLAudioElement | undefined;
let unlockCleanup: (() => void) | undefined;

function removeUnlockListeners(): void {
  unlockCleanup?.();
  unlockCleanup = undefined;
}

function tryPlayBgm(): void {
  const audio = bgm;
  if (!audio) {
    return;
  }

  const start = (): void => {
    void audio.play().then(() => {
      removeUnlockListeners();
    }).catch(() => {
      /* still blocked until the next gesture */
    });
  };

  if (audio.error) {
    if (import.meta.env.DEV) {
      console.warn('[BGM] load error', audio.src, audio.error);
    }
    return;
  }

  if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
    start();
    return;
  }

  audio.addEventListener('canplaythrough', start, { once: true });
  audio.load();
}

/** Attach one-shot window listeners until BGM successfully starts. */
export function bindBackgroundMusicUnlock(): void {
  if (unlockCleanup) {
    return;
  }

  const unlock = (): void => {
    tryPlayBgm();
  };

  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('touchstart', unlock, opts);
  window.addEventListener('keydown', unlock, opts);

  unlockCleanup = (): void => {
    window.removeEventListener('pointerdown', unlock, opts);
    window.removeEventListener('touchstart', unlock, opts);
    window.removeEventListener('keydown', unlock, opts);
  };
}

/** Call from login buttons so the gesture chain reaches menu BGM. */
export function markBackgroundMusicUnlocked(): void {
  tryPlayBgm();
}

export function playBackgroundMusic(url: string, volume = 0.2): void {
  stopBackgroundMusic();

  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = volume;
  audio.preload = 'auto';
  audio.addEventListener('error', () => {
    if (import.meta.env.DEV) {
      console.warn('[BGM] failed to load', url, audio.error);
    }
  }, { once: true });

  bgm = audio;
  bindBackgroundMusicUnlock();
  tryPlayBgm();
}

export function stopBackgroundMusic(): void {
  removeUnlockListeners();
  if (!bgm) {
    return;
  }
  bgm.pause();
  bgm.removeAttribute('src');
  bgm.load();
  bgm = undefined;
}

/** Retry playback after tap/key (menu PLAY, canvas, etc.). */
export function tryResumeBackgroundMusic(): void {
  tryPlayBgm();
}

/** Warm the menu track during boot so first play is instant. */
export function preloadBackgroundMusic(url: string): void {
  const warm = new Audio(url);
  warm.preload = 'auto';
  warm.load();
}
