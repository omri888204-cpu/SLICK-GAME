/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set `"true"` once to wipe Firestore collections `leaderboard` + `global_top_runs` at startup (then rebuild without it). */
  readonly VITE_CLEAR_LEADERBOARD_ON_BOOT?: string;
}
