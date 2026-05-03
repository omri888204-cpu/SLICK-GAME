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
  wrappedX: boolean;
};

export class Physics {
  /**
   * First platform underside above `mouthY` within horizontal band and max range (world coords, y down).
   */
  static castGrappleTarget(
    platforms: Platform[],
    mouthX: number,
    mouthY: number,
  ): { x: number; y: number; platform: Platform } | undefined {
    let bestBottom = -Infinity;
    let hit: { x: number; y: number; platform: Platform } | undefined;

    for (const platform of platforms) {
      const bottom = platform.y + platform.height;
      const half = GRAPPLE.rayHalfWidth;
      const overlapsX =
        mouthX + half > platform.x && mouthX - half < platform.x + platform.width;
      if (!overlapsX) {
        continue;
      }

      if (bottom >= mouthY) {
        continue;
      }

      if (mouthY - bottom > GRAPPLE.maxRangePx) {
        continue;
      }

      if (bottom > bestBottom) {
        bestBottom = bottom;
        hit = {
          x: Math.max(platform.x + 4, Math.min(mouthX, platform.x + platform.width - 4)),
          y: bottom - 3,
          platform,
        };
      }
    }

    return hit;
  }

  applyGrappleAcceleration(
    body: PlayerBody,
    anchorX: number,
    anchorY: number,
    mouthX: number,
    mouthY: number,
    dt: number,
  ): void {
    let dx = anchorX - mouthX;
    let dy = anchorY - mouthY;
    const len = Math.hypot(dx, dy);
    if (len < 8) {
      return;
    }

    dx /= len;
    dy /= len;

    body.vx += dx * GRAPPLE.pullAcceleration * dt;
    body.vy += dy * GRAPPLE.pullAcceleration * dt;

    const towardSpeed = body.vx * dx + body.vy * dy;
    if (towardSpeed > GRAPPLE.maxPullSpeed) {
      const excess = towardSpeed - GRAPPLE.maxPullSpeed;
      body.vx -= dx * excess;
      body.vy -= dy * excess;
    }

    const tx = -dy;
    const ty = dx;
    const swing = PHYSICS.gravity * GRAPPLE.swingTangentialScale * dt;
    body.vx += tx * swing;
    body.vy += ty * swing;
  }

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

    const wrappedX = this.wrapHorizontal(body, width);
    const impactVy = body.vy;
    const landedPlatform = this.resolvePlatformLanding(body, platforms, previousBottom, previousY);

    return { landedPlatform, impactVy: landedPlatform ? impactVy : 0, wrappedX };
  }

  applyHorizontalInput(body: PlayerBody, axis: number, dt: number): void {
    const targetVx = axis * WALK.speedPxPerSecond;
    const rate =
      axis === 0
        ? body.grounded
          ? WALK.stopDeceleration
          : WALK.airAcceleration
        : body.grounded
          ? WALK.acceleration
          : WALK.airAcceleration;

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

  private wrapHorizontal(body: PlayerBody, width: number): boolean {
    if (body.x + body.width < 0) {
      body.x = width;
      return true;
    }

    if (body.x > width) {
      body.x = -body.width;
      return true;
    }

    return false;
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
