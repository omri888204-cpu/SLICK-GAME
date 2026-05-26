/** Seconds per full clock rotation / speed tier step. */
export const RUN_SPEED_CLOCK_CYCLE_SEC = 30;
/** Maximum global speed multiplier (tier caps here). */
export const RUN_SPEED_CLOCK_MAX_MULTIPLIER = 5;

/**
 * Run-time speed clock — one full rotation every {@link RUN_SPEED_CLOCK_CYCLE_SEC}s.
 * Each completed cycle raises the global speed multiplier by ×1 (×1 … ×5).
 */
export class RunSpeedClock {
  private elapsedSec = 0;
  private tier = 1;
  private tierPulseSec = 0;

  /** Active gameplay elapsed seconds (excludes pause / pre-unlock intro). */
  get elapsed(): number {
    return this.elapsedSec;
  }

  /** Current tier label 1–5 (matches multiplier while tiers are integer steps). */
  get currentTier(): number {
    return this.tier;
  }

  /** Hand angle in radians — 0 at 12 o'clock, clockwise. */
  get handAngleRad(): number {
    const cycleT = this.elapsedSec % RUN_SPEED_CLOCK_CYCLE_SEC;
    return (cycleT / RUN_SPEED_CLOCK_CYCLE_SEC) * Math.PI * 2 - Math.PI / 2;
  }

  /** Remaining tier-up pulse animation time (seconds). */
  get tierPulseRemainingSec(): number {
    return this.tierPulseSec;
  }

  get isAtMaxTier(): boolean {
    return this.tier >= RUN_SPEED_CLOCK_MAX_MULTIPLIER;
  }

  reset(): void {
    this.elapsedSec = 0;
    this.tier = 1;
    this.tierPulseSec = 0;
  }

  tick(dt: number): void {
    if (dt <= 0) {
      return;
    }
    const prevTier = this.tier;
    this.elapsedSec += dt;
    this.tier = RunSpeedClock.tierForElapsed(this.elapsedSec);
    if (this.tier > prevTier) {
      this.tierPulseSec = 0.22;
    }
    if (this.tierPulseSec > 0) {
      this.tierPulseSec = Math.max(0, this.tierPulseSec - dt);
    }
  }

  /** Global speed multiplier applied to camera scroll and related systems. */
  getMultiplier(): number {
    return this.tier;
  }

  static tierForElapsed(elapsedSec: number): number {
    const cycles = Math.floor(Math.max(0, elapsedSec) / RUN_SPEED_CLOCK_CYCLE_SEC);
    return Math.min(RUN_SPEED_CLOCK_MAX_MULTIPLIER, cycles + 1);
  }
}
