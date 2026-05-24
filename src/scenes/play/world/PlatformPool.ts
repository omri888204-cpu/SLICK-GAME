import type { Platform } from '../../../game/types';
import { PLAY_SCENE, STAIRS } from '../../../config/game.config';

export class PlatformPool {
  constructor() {}

  computeStairGapPx(_stairId: number): number {
    return 0;
  }

  updatePlatformBodyFromScale(platform: Platform): void {
    platform.height = STAIRS.platformHeight * PLAY_SCENE.stairPlatformScale;
  }
}
