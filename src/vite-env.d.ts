/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * One purge per browser per string: removes RTDB `leaderboard` + `global_top_runs` + `scores`, logs
   * `Leaderboard database has been fully cleared`, then persists in localStorage — remove env after deploy.
   */
  readonly VITE_LEADERBOARD_ONE_TIME_PURGE?: string;
  /** Wipes those paths on every load until deleted from env (omit if using the sentinel purge above). */
  readonly VITE_CLEAR_LEADERBOARD_ON_BOOT?: string;
}
