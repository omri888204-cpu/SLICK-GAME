import { GRAPPLE, PHYSICS, WALK } from '../../config/game.config';
import type { Platform } from '../types';

export type PlayerBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  grounded: boolean;
};

export type PhysicsResult = {
  landedPlatform?: Platform;
  impactVy: number;
};

export class Physics {
  /**
   * First platform underside directly above within [min..max] ray distance (world coords, y down).
   */
  static castGrappleTarget(
    platforms: Platform[],
    mouthX: number,
    mouthY: number,
    minRangePx: number,
    maxRangePx: number,
    rayHalfWidth: number,
    preferFarthest = false,
  ): { x: number; y: number; platform: Platform } | undefined {
    let bestBottom = preferFarthest ? Infinity : -Infinity;
    let hit: { x: number; y: number; platform: Platform } | undefined;

    for (const platform of platforms) {
      const bottom = platform.y + platform.height;
      const half = rayHalfWidth;
      const overlapsX =
        mouthX + half > platform.x && mouthX - half < platform.x + platform.width;
      if (!overlapsX) {
        continue;
      }

      if (bottom >= mouthY) {
        continue;
      }

      const distanceToBottom = mouthY - bottom;
      if (distanceToBottom > maxRangePx || distanceToBottom < minRangePx) {
        continue;
      }

      const betterCandidate = preferFarthest ? bottom < bestBottom : bottom > bestBottom;
      if (betterCandidate) {
        bestBottom = bottom;
        hit = {
          x: mouthX,
          y: bottom - 3,
          platform,
        };
      }
    }

    return hit;
  }

  applyGrappleAcceleration(
    body: PlayerBody,
    _anchorX: number,
    anchorY: number,
    _mouthX: number,
    mouthY: number,
    dt: number,
  ): void {
    if (anchorY >= mouthY - 2) {
      return;
    }

    body.vy -= GRAPPLE.pullAcceleration * dt;
    body.vy = Math.max(-GRAPPLE.maxPullSpeed, body.vy);
    body.vx = this.moveToward(body.vx, 0, WALK.stopDeceleration * dt);

    const pullDamp = Math.max(0, 1 - GRAPPLE.pullVelocityDampingPerSec * dt);
    body.vx *= pullDamp;
    body.vy *= pullDamp;
  }

  /**
   * Platforms are kinematic (no `setFriction` — not a physics engine). Horizontal drift is applied in
   * `PlayScene` via `Platform.driftVx`; when grounded, the scene carries the player with the stair.
   */
  update(
    body: PlayerBody,
    platforms: Platform[],
    width: number,
    dt: number,
    gravityScale = 1,
  ): PhysicsResult {
    const previousBottom = this.getBottom(body);
    const previousY = body.y;

    body.vy += PHYSICS.gravity * gravityScale * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.grounded = false;

    this.resolveWorldBounds(body, width);
    const impactVy = body.vy;
    const landedPlatform = this.resolvePlatformLanding(body, platforms, previousBottom, previousY);

    return {
      landedPlatform,
      impactVy: landedPlatform ? impactVy : 0,
    };
  }

  applyHorizontalInput(body: PlayerBody, axis: number, dt: number, airControlScale = 1): void {
    const targetVx = axis * WALK.speedPxPerSecond;
    let rate: number;
    const airMul = body.grounded ? 1 : airControlScale;
    if (axis === 0) {
      rate = body.grounded ? WALK.stopDeceleration : WALK.airAcceleration * airMul;
    } else {
      rate = body.grounded ? WALK.acceleration : WALK.airAcceleration * airMul;
    }

    body.vx = this.moveToward(body.vx, targetVx, rate * dt);
    body.vx = Math.max(-PHYSICS.maxSpeed, Math.min(PHYSICS.maxSpeed, body.vx));
  }

  jump(body: PlayerBody): void {
    body.vy = -(PHYSICS.baseJump + Math.abs(body.vx) * PHYSICS.speedJumpBonus);
    body.grounded = false;
  }

  snapToPlatform(body: PlayerBody, platform: Platform): void {
    body.y = platform.y - body.height;
    body.vy = 0;
    body.grounded = true;
  }

  /**
   * Same role as Phaser `setCollideWorldBounds(true)`: keep the AABB inside the canvas width.
   * Call after any code path that moves the player without `update()` (e.g. 360 skill).
   */
  applyWorldBounds(body: PlayerBody, width: number): void {
    this.resolveWorldBounds(body, width);
  }

  private resolveWorldBounds(body: PlayerBody, width: number): void {
    const maxX = Math.max(0, width - body.width);
    const rest = PHYSICS.worldWallRestitution;

    if (body.x < 0) {
      body.x = 0;
      if (body.vx < 0) {
        body.vx = -body.vx * rest;
      }
    } else if (body.x > maxX) {
      body.x = maxX;
      if (body.vx > 0) {
        body.vx = -body.vx * rest;
      }
    }
  }

  private resolvePlatformLanding(
    body: PlayerBody,
    platforms: Platform[],
    previousBottom: number,
    previousY: number,
  ): Platform | undefined {
    if (body.vy < 0) {
      return undefined;
    }

    for (const platform of platforms) {
      const wasAbove = previousBottom <= platform.y;
      const overlapsX =
        body.x + body.width * 0.42 > platform.x && body.x < platform.x + platform.width;
      const crossedTop = this.getBottom(body) >= platform.y;
      const isMovingDown = body.y >= previousY;

      if (wasAbove && isMovingDown && overlapsX && crossedTop) {
        this.snapToPlatform(body, platform);
        return platform;
      }
    }

    return undefined;
  }

  private getBottom(body: PlayerBody): number {
    return body.y + body.height;
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) {
      return target;
    }

    return current + Math.sign(target - current) * maxDelta;
  }
}
