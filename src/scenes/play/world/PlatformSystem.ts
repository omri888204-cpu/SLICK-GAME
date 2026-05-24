import type { Texture } from 'pixi.js';

import type { Platform } from '../../../game/types';
import { PlatformPool } from './PlatformPool';

export type PlayerProbe = {
  getClimbBaselineY(): number;
};

export type WorldProbe = {
  getCameraX(): number;
  getCameraY(): number;
  getWorldWidthFromScreen(): number;
  getCameraZoom(): number;
};

export type RenderProbe = {
  getPlatformCount(): number;
};

export type PlatformSystemCallbacks = {
  maybeSpawnFirstRestFloorProps(platform: Platform): void;
  rebuildPlatformSprites(): void;
  onRestFloorEncountered(platform: Platform): void;
  getRestFloorTopY(meters: number): number;
  clearRestFloorProps(): void;
  updateRestFloorCloudBreathing(): void;
  loadTextureFromCandidates(candidates: string[]): Promise<Texture>;
  getWorldWidthFromScreen(): number;
  getCameraZoom(): number;
};

export type PlatformSystemDeps = {
  playerProbe: PlayerProbe;
  worldProbe: WorldProbe;
  renderProbe: RenderProbe;
  callbacks: PlatformSystemCallbacks;
};

export class PlatformSystem {
  private readonly pool: PlatformPool;

  constructor(private readonly deps: PlatformSystemDeps) {
    this.pool = new PlatformPool();
  }

  computeStairGapPx(stairId: number): number {
    void this.deps.playerProbe.getClimbBaselineY();
    void this.deps.worldProbe.getCameraX();
    void this.deps.worldProbe.getCameraY();
    void this.deps.worldProbe.getWorldWidthFromScreen();
    void this.deps.worldProbe.getCameraZoom();
    void this.deps.renderProbe.getPlatformCount();
    return this.pool.computeStairGapPx(stairId);
  }

  updatePlatformBodyFromScale(platform: Platform): void {
    this.pool.updatePlatformBodyFromScale(platform);
  }
}
