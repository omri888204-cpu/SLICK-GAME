import type { Platform } from '../../../game/types';
import { PLATFORM_SIZING, PLAY_SCENE, STAIRS } from '../../../config/game.config';
import type { CreatePlatformsInput, CreatePlatformsResult } from './PlatformSystem';

export class PlatformPool {
  constructor() {}

  computeStairGapPx(_stairId: number): number {
    return 0;
  }

  updatePlatformBodyFromScale(platform: Platform): void {
    platform.height = STAIRS.platformHeight * PLAY_SCENE.stairPlatformScale;
  }

  getNormalPlatformWorldWidth(
    worldWidthFromScreen: number,
    viewportSafeMarginWorld: number,
    platformEdgePaddingPx: number,
  ): number {
    const margin = viewportSafeMarginWorld * 2 + platformEdgePaddingPx * 2;
    const maxW = Math.max(200, worldWidthFromScreen - margin);
    return Math.min(
      PLATFORM_SIZING.normalWorldWidthPx,
      Math.floor(maxW * PLATFORM_SIZING.maxViewportWidthFraction),
    );
  }

  getPlatformSpawnHorizontalRange(
    platformWidth: number,
    viewOriginX: number,
    viewportSafeMarginWorld: number,
    worldWidthFromScreen: number,
    platformEdgePaddingPx: number,
    worldBoundsX: number,
    worldWidth: number,
  ): { minX: number; maxX: number } {
    const viewLeft = viewOriginX + viewportSafeMarginWorld;
    const viewRight = viewOriginX + worldWidthFromScreen - viewportSafeMarginWorld;
    const pad = platformEdgePaddingPx;
    const minX = Math.max(worldBoundsX + pad, viewLeft);
    const maxX = Math.min(worldWidth - pad - platformWidth, viewRight - platformWidth);
    if (maxX <= minX) {
      const cx = viewOriginX + worldWidthFromScreen * 0.5 - platformWidth * 0.5;
      const clamped = Math.max(worldBoundsX + pad, Math.min(cx, worldWidth - pad - platformWidth));
      return { minX: clamped, maxX: clamped };
    }
    return { minX, maxX };
  }

  computePlatformSpawnX(
    stairId: number,
    platformWidth: number,
    range: { minX: number; maxX: number },
  ): number {
    const { minX, maxX } = range;
    if (maxX <= minX) {
      return minX;
    }
    const raw = Math.sin((stairId + 1) * 12.9898) * 43758.5453;
    const unit = raw - Math.floor(raw);
    return minX + unit * (maxX - minX);
  }

  getPlatformMeters(
    platform: Platform,
    climbBaselineY: number,
    playerBodyHeight: number,
  ): number {
    return Math.max(
      0,
      Math.floor((climbBaselineY - (platform.y - playerBodyHeight)) / 12),
    );
  }

  getRestFloorPlatformBounds(
    cameraX: number,
    worldWidthFromScreen: number,
  ): { x: number; width: number } {
    const width = worldWidthFromScreen * 2;
    return {
      x: cameraX - worldWidthFromScreen * 0.5,
      width,
    };
  }

  getFloorZeroSpawnPlatformBounds(
    cameraX: number,
    worldWidthFromScreen: number,
  ): { x: number; width: number } {
    return this.getRestFloorPlatformBounds(cameraX, worldWidthFromScreen);
  }

  getRestFloorTopY(
    climbBaselineY: number,
    playerBodyHeight: number,
    meters: number,
  ): number {
    return climbBaselineY - meters * 12 + playerBodyHeight;
  }

  getNextRestFloorYAbove(
    climbBaselineY: number,
    playerBodyHeight: number,
    worldY: number,
    restFloorIntervalMeters: number,
  ): number {
    const currentMeters = Math.max(0, (climbBaselineY - (worldY - playerBodyHeight)) / 12);
    const nextMeters =
      Math.floor(currentMeters / restFloorIntervalMeters + 1) * restFloorIntervalMeters;
    return this.getRestFloorTopY(climbBaselineY, playerBodyHeight, nextMeters);
  }

  pickNextPlatformY(
    previousTopY: number,
    normalY: number,
    nextRestFloorYAbove: number,
  ): number {
    if (nextRestFloorYAbove < previousTopY && nextRestFloorYAbove >= normalY) {
      return nextRestFloorYAbove;
    }
    return normalY;
  }

  createPlatforms(
    input: CreatePlatformsInput,
    helpers: {
      applyResponsivePlatformWidth(platform: Platform): void;
      computePlatformSpawnX(stairId: number, platformWidth: number, viewOriginX: number): number;
      computeStairGapPx(stairId: number): number;
      getPlatformSpawnHorizontalRange(
        platformWidth: number,
        viewOriginX: number,
      ): { minX: number; maxX: number };
    },
  ): CreatePlatformsResult {
    const platforms: Platform[] = [];
    const baseY = input.worldMaxY - 96;
    let y = baseY;
    const viewportW = input.worldWidthFromScreen;
    const maxCamX = Math.max(0, input.worldWidth - viewportW);
    const layoutCamX = Math.max(0, Math.min((input.worldWidth - viewportW) * 0.5, maxCamX));

    for (let index = 0; index < input.poolCount; index += 1) {
      const platform: Platform = {
        x: 0,
        y,
        width: 0,
        height: input.platformHeight,
        baseWidth: input.uniformBaseWidth,
        driftDir: Math.random() < 0.5 ? -1 : 1,
        driftVx: 0,
        stairId: index,
        kind: index === 0 ? 'spawn' : 'normal',
      };
      helpers.applyResponsivePlatformWidth(platform);
      if (index === 0) {
        if (platform.kind !== 'spawn') {
          const ideal = layoutCamX + viewportW * 0.5 - platform.width * 0.5;
          const { minX, maxX } = helpers.getPlatformSpawnHorizontalRange(platform.width, layoutCamX);
          platform.x = Math.max(minX, Math.min(ideal, maxX));
        }
      } else {
        platform.x = helpers.computePlatformSpawnX(index, platform.width, layoutCamX);
      }
      platforms.push(platform);
      y -= helpers.computeStairGapPx(index);
    }

    return {
      platforms,
      nextStairId: input.poolCount - 1,
    };
  }
}
