/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Wipes `leaderboard` + legacy collections on **every load** until you delete this env and rebuild.
   */
  readonly VITE_LEADERBOARD_ONE_TIME_PURGE?: string;
  /** Deletes leaderboard buckets on every startup until removed — prefer sentinel purge when possible. */
  readonly VITE_CLEAR_LEADERBOARD_ON_BOOT?: string;
}
