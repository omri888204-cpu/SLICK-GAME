/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set `"true"` once to wipe Firestore `leaderboard` via client SDK at startup (then rebuild without it). */
  readonly VITE_CLEAR_LEADERBOARD_ON_BOOT?: string;
}
