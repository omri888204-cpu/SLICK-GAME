import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { ALIVE, GRAPPLE, RENDER, WALK } from '../../config/game.config';
import type { ActiveGrapple, Direction } from '../types';
import type { PlayerBody } from '../systems/Physics';

export enum PlayerState {
  Idle,
  Walk,
  Jump,
  Fall,
  Grapple,
  SuperJump,
  Attack,
}

/**
 * Spritesheet layout — `public/assets/Player staff/character_spritesheet.png` is an 800×280 sheet
 * arranged as 8 columns × 7 rows of 100×40 frames. The user-facing spec describes
 * 48×48 frames but the asset itself uses 100×40 cells; what matters for animation is
 * that the row mapping below matches their intent (idle = row 0, run = row 1, jump = row 2).
 */
const SPRITESHEET_URL = `${import.meta.env.BASE_URL}assets/${encodeURIComponent('Player staff')}/character_spritesheet.png`;
const FRAME_W = 100;
const FRAME_H = 40;
const IDLE_ROW = 0;
const RUN_ROW = 1;
const JUMP_ROW = 2;
const ATTACK_ROW = 3;
const IDLE_FRAMES = 6;
const RUN_FRAMES = 8;
const JUMP_FRAMES = 8;
const ATTACK_FRAMES = 8;

/**
 * Attack swing length (seconds). Drives both the animation playback rate and the
 * "locked until anim finishes" cooldown — `attackTime` counts down from this value
 * to 0, and the player ignores new attack inputs while it is non-zero.
 */
export const PLAYER_ATTACK_DURATION_SEC = 0.4;
/**
 * Hit window — the fraction of the attack animation during which the swing actually
 * connects with enemies. Skips the wind-up and recovery frames so the player has to
 * roughly aim at an enemy rather than instakill anything in range.
 */
export const PLAYER_ATTACK_HIT_WINDOW_START = 0.18;
export const PLAYER_ATTACK_HIT_WINDOW_END = 0.78;

/** Display scale of each cell. Character art occupies ~25×28 inside the cell, so a 3.12× scale
 * renders the visible figure at ~78×87 (20% larger than the previous 2.6× sizing). */
const SPRITE_SCALE = 3.12;
const SPRITE_DISPLAY_WIDTH = FRAME_W * SPRITE_SCALE;

/**
 * Vertical offset of the avatar rig relative to the body center.
 *
 * The character art sits inside the 40-px cell at source rows 5..33, so its feet are
 * `(33 - 20) * SPRITE_SCALE ≈ 40.6` px below the sprite center. With `groundedSink = 4`,
 * an idle player's rig lands at `BASE_AVATAR_Y + groundedSink ≈ -22`, putting the feet
 * at ~`19` px below body center — exactly the hitbox bottom (body.height / 2).
 */
const BASE_AVATAR_Y = -26;

const PLAYER_SCALE = 0.3981312;
const PLAYER_BODY_WIDTH = 70 * PLAYER_SCALE;
const PLAYER_BODY_HEIGHT = 96 * PLAYER_SCALE;

const IDLE_FPS = 8;

type CharacterTextures = {
  idle: Texture[];
  run: Texture[];
  jump: Texture[];
  attack: Texture[];
};

export class Player extends Container {
  readonly body: PlayerBody = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    width: PLAYER_BODY_WIDTH,
    height: PLAYER_BODY_HEIGHT,
    grounded: false,
  };

  state = PlayerState.Idle;
  direction: Direction = 1;
  isShielded = false;

  private glow = new Graphics();
  private feet = new Graphics();
  /** Holds pose (pos/rot/skew); children get uniform parent space for reliable overlay math. */
  private avatarRig?: Container;
  private bodySprite?: Sprite;
  private silhouette?: Sprite;
  private textures?: CharacterTextures;
  private distanceTraveled = 0;
  private idleTime = 0;
  private airTime = 0;
  private walkBlend = 0;
  private jumpPulseMs = 0;
  private jumpAnticipationMs = 0;
  private landingPulseMs = 0;
  private grappleLaunchMs = 0;
  private grapplePoseActive = false;
  private grappleAnimT = 0;
  private grappleClip: ActiveGrapple | null = null;
  /** Counts down from `PLAYER_ATTACK_DURATION_SEC` while a swing is in progress. */
  private attackTime = 0;

  constructor() {
    super();
    this.addChild(this.glow, this.feet);
  }

  /**
   * Extend: **0 → 1** (`extendT / extendSec`). Pull: **1**. Idle: **0**.
   */
  static computeGrappleAnimProgress(
    grapple: Pick<ActiveGrapple, 'phase' | 'extendT'> | null,
    extendSec: number,
  ): number {
    if (!grapple) {
      return 0;
    }

    if (grapple.phase === 'pull') {
      return 1;
    }

    return Math.min(1, grapple.extendT / extendSec);
  }

  async load(): Promise<void> {
    const sheet = (await Assets.load(SPRITESHEET_URL)) as Texture;
    const source = sheet.source;

    const sliceRow = (row: number, count: number): Texture[] => {
      const frames: Texture[] = [];
      for (let i = 0; i < count; i += 1) {
        frames.push(
          new Texture({
            source,
            frame: new Rectangle(i * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H),
          }),
        );
      }
      return frames;
    };

    this.textures = {
      idle: sliceRow(IDLE_ROW, IDLE_FRAMES),
      run: sliceRow(RUN_ROW, RUN_FRAMES),
      jump: sliceRow(JUMP_ROW, JUMP_FRAMES),
      attack: sliceRow(ATTACK_ROW, ATTACK_FRAMES),
    };

    const initialFrame = this.textures.idle[0];

    this.silhouette = new Sprite(initialFrame);
    this.silhouette.roundPixels = RENDER.pixelArt;
    this.silhouette.anchor.set(0.5);
    this.silhouette.tint = 0xf4ead2;
    this.silhouette.alpha = 0.22;
    this.silhouette.width = SPRITE_DISPLAY_WIDTH + 5;
    this.silhouette.scale.y = this.silhouette.scale.x;
    this.silhouette.position.set(0, BASE_AVATAR_Y);

    this.avatarRig = new Container();
    this.avatarRig.sortableChildren = true;

    this.bodySprite = new Sprite(initialFrame);
    this.bodySprite.roundPixels = RENDER.pixelArt;
    this.bodySprite.anchor.set(0.5);
    this.bodySprite.width = SPRITE_DISPLAY_WIDTH;
    this.bodySprite.scale.y = this.bodySprite.scale.x;
    this.bodySprite.position.set(0, 0);

    this.avatarRig.position.set(0, BASE_AVATAR_Y);
    this.avatarRig.addChild(this.bodySprite);

    this.addChildAt(this.silhouette, 1);
    this.addChildAt(this.avatarRig, 2);
  }

  update(
    dt: number,
    axis: number,
    comboActive = false,
    grapple: ActiveGrapple | null = null,
    beastMode = false,
    shieldActive = false,
  ): void {
    this.grappleClip = grapple;
    this.grapplePoseActive = grapple !== null;
    this.grappleAnimT = Player.computeGrappleAnimProgress(grapple, GRAPPLE.extendSec);
    this.jumpPulseMs = Math.max(0, this.jumpPulseMs - dt * 1000);
    this.jumpAnticipationMs = Math.max(0, this.jumpAnticipationMs - dt * 1000);
    this.landingPulseMs = Math.max(0, this.landingPulseMs - dt * 1000);
    this.grappleLaunchMs = Math.max(0, this.grappleLaunchMs - dt * 1000);
    this.attackTime = Math.max(0, this.attackTime - dt);
    this.idleTime += dt;

    if (this.body.grounded) {
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }

    if (grapple) {
      const cx = this.body.x + this.body.width * 0.5;
      const toAnchor = grapple.targetX - cx;
      if (Math.abs(toAnchor) > 8) {
        this.direction = toAnchor > 0 ? 1 : -1;
      }
    }

    if (axis < -0.55 || this.body.vx < -20) {
      this.direction = -1;
    } else if (axis > 0.55 || this.body.vx > 20) {
      this.direction = 1;
    }

    this.updateState();
    this.updateWalkBlend(dt);
    this.updateWalk(dt);
    this.syncContainerToBody();
    this.drawSprite(comboActive, beastMode, shieldActive);
    this.drawFeet();
  }

  onJump(): void {
    this.jumpPulseMs = ALIVE.jumpPulseMs;
    this.jumpAnticipationMs = ALIVE.jumpAnticipationMs;
    this.airTime = 0;
  }

  onLand(impactVy: number): void {
    if (impactVy < ALIVE.landingImpactVy) {
      return;
    }

    this.landingPulseMs = ALIVE.landingPulseMs;
  }

  onGrappleLaunch(): void {
    this.grappleLaunchMs = 320;
    this.walkBlend = Math.min(this.walkBlend, 0.1);
  }

  /**
   * Begin an attack swing. Returns `false` if a previous swing is still in progress —
   * caller should treat that as the cooldown lockout the task spec asks for. Locks the
   * facing direction at the moment of the swing so the player doesn't visibly U-turn
   * mid-attack while the hitbox is live.
   */
  startAttack(facing?: Direction): boolean {
    if (this.attackTime > 0) {
      return false;
    }
    this.attackTime = PLAYER_ATTACK_DURATION_SEC;
    if (facing) {
      this.direction = facing;
    }
    return true;
  }

  isAttacking(): boolean {
    return this.attackTime > 0;
  }

  /**
   * Normalized 0..1 progress through the current swing (0 = start, ~1 = finishing).
   * Returns 0 when no attack is active.
   */
  getAttackProgress(): number {
    if (this.attackTime <= 0) {
      return 0;
    }
    return Math.max(
      0,
      Math.min(1, 1 - this.attackTime / PLAYER_ATTACK_DURATION_SEC),
    );
  }

  /** True only during the "swing connects" portion of the animation. */
  isAttackHitActive(): boolean {
    if (this.attackTime <= 0) {
      return false;
    }
    const t = this.getAttackProgress();
    return t >= PLAYER_ATTACK_HIT_WINDOW_START && t <= PLAYER_ATTACK_HIT_WINDOW_END;
  }

  private updateState(): void {
    if (this.attackTime > 0) {
      this.state = PlayerState.Attack;
      return;
    }

    if (this.grapplePoseActive) {
      this.state = PlayerState.Grapple;
      return;
    }

    if (!this.body.grounded) {
      this.state = this.body.vy < 0 ? PlayerState.Jump : PlayerState.Fall;
      return;
    }

    this.state = Math.abs(this.body.vx) > WALK.vxThreshold ? PlayerState.Walk : PlayerState.Idle;
  }

  private updateWalk(dt: number): void {
    if (this.walkBlend <= 0.01) {
      return;
    }

    this.distanceTraveled += Math.abs(this.body.vx) * dt;
  }

  private syncContainerToBody(): void {
    this.position.set(
      this.body.x + this.body.width / 2,
      this.body.y + this.body.height / 2,
    );
  }

  private updateWalkBlend(dt: number): void {
    const target = this.state === PlayerState.Walk ? 1 : 0;
    const delta = Math.min(1, WALK.blendSpeed * dt);
    this.walkBlend += (target - this.walkBlend) * delta;
  }

  private drawSprite(_comboActive: boolean, beastMode: boolean, shieldActive: boolean): void {
    if (!this.avatarRig || !this.bodySprite || !this.silhouette || !this.textures) {
      return;
    }

    const texture = this.pickBodyTexture();
    const pullingGrapple =
      this.state === PlayerState.Grapple &&
      this.grappleClip !== null &&
      this.grappleClip.phase === 'pull';
    const walkPhase = Math.sin(this.distanceTraveled * WALK.bobFrequency);
    const stridePhase = Math.cos(this.distanceTraveled * WALK.bobFrequency);
    const idleBreath = Math.sin(this.idleTime * ALIVE.idleBreathSpeed);
    const idleOffset = Math.cos(this.idleTime * ALIVE.idleBreathSpeed) * ALIVE.idleFloatPx;
    const idleBlend = 1 - this.walkBlend;
    const walkBob = walkPhase * WALK.bobAmplitude * this.walkBlend;
    const walkSway = stridePhase * WALK.swayAmplitude * this.walkBlend;
    const groundedSink = this.body.grounded ? 4 : 0;
    let stretch =
      1 +
      Math.abs(walkPhase) * WALK.stretchAmplitude * this.walkBlend +
      idleBreath * ALIVE.idleBreathScale * idleBlend;
    let squash =
      1 -
      Math.abs(walkPhase) * WALK.stretchAmplitude * 0.5 * this.walkBlend -
      idleBreath * ALIVE.idleBreathScale * 0.5 * idleBlend;
    const jumpPulse =
      Math.sin((1 - this.jumpPulseMs / ALIVE.jumpPulseMs) * Math.PI) * 8;
    const width = SPRITE_DISPLAY_WIDTH + jumpPulse;
    const jumpAnticipation = this.getPulse(ALIVE.jumpAnticipationMs, this.jumpAnticipationMs);
    const landingPulse = this.getPulse(ALIVE.landingPulseMs, this.landingPulseMs);
    const grappleLaunch = this.getPulse(320, this.grappleLaunchMs);

    if (grappleLaunch > 0) {
      stretch *= 1 + 0.1 * grappleLaunch;
      squash *= 1 - 0.06 * grappleLaunch;
    }

    if (this.grapplePoseActive) {
      stretch *= GRAPPLE.poseStretch;
      squash *= 0.97;
      if (this.grappleClip?.phase === 'extend') {
        const p = this.grappleAnimT;
        stretch *= 1 + 0.08 * Math.sin(p * Math.PI);
      }
    }

    if (jumpAnticipation > 0) {
      stretch *= 1 - ALIVE.jumpAnticipationSquash * jumpAnticipation;
      squash *= 1 + ALIVE.jumpAnticipationStretch * jumpAnticipation;
    }

    if (landingPulse > 0) {
      stretch *= 1 - ALIVE.landingSquash * landingPulse;
      squash *= 1 + ALIVE.landingStretch * landingPulse;
    }

    this.bodySprite.texture = texture;
    this.bodySprite.width = width;
    const spriteBaseScale = Math.abs(this.bodySprite.scale.x);
    const magX = spriteBaseScale * squash;
    const flip = this.direction < 0 ? -1 : 1;
    this.bodySprite.scale.x = flip * magX;
    this.bodySprite.scale.y = magX * stretch;
    this.avatarRig.position.set(
      walkSway,
      BASE_AVATAR_Y + groundedSink + walkBob + idleOffset * idleBlend,
    );
    this.avatarRig.rotation =
      walkPhase * WALK.tiltAmplitude * this.walkBlend +
      this.direction * 0.025 * this.walkBlend +
      Math.sin(this.idleTime * ALIVE.idleSwaySpeed) * ALIVE.idleTilt * idleBlend +
      (this.grapplePoseActive
        ? GRAPPLE.poseTilt * (pullingGrapple ? GRAPPLE.artExtraTiltScale : 1)
        : 0);
    this.avatarRig.skew.x =
      Math.sin(this.distanceTraveled * ALIVE.tailWagFrequency + this.idleTime) *
      ALIVE.tailSkew *
      (this.walkBlend + ALIVE.tailIdleInfluence) *
      this.direction;
    if (beastMode) {
      const flash = Math.sin(this.idleTime * 34) > 0;
      this.bodySprite.tint = flash ? 0xffffff : 0xffb13d;
    } else {
      this.bodySprite.tint = 0xffffff;
    }

    this.silhouette.texture = texture;
    this.silhouette.width = width + 5;
    const silhouetteBaseScale = Math.abs(this.silhouette.scale.x);
    const silMag = silhouetteBaseScale * squash;
    this.silhouette.scale.x = flip * silMag;
    this.silhouette.scale.y = silMag * stretch;
    this.silhouette.position.copyFrom(this.avatarRig.position);
    this.silhouette.rotation = this.avatarRig.rotation;
    this.silhouette.skew.x = this.avatarRig.skew.x;
    this.silhouette.tint = beastMode ? 0xffcc88 : 0xf4ead2;

    this.glow.clear();
    if (beastMode) {
      const pulse = 0.55 + 0.45 * Math.sin(this.idleTime * 14);
      this.glow
        .ellipse(0, -6, 52 * pulse, 38 * pulse)
        .stroke({ width: 3, color: 0xff6600, alpha: 0.35 + 0.2 * pulse });
      this.glow
        .ellipse(0, -6, 40 * pulse, 30 * pulse)
        .stroke({ width: 2, color: 0xffcc44, alpha: 0.25 + 0.15 * pulse });
    }
    if (shieldActive) {
      const pulse = 0.58 + 0.42 * Math.sin(this.idleTime * 12);
      this.glow
        .ellipse(0, -6, 56 * pulse, 42 * pulse)
        .stroke({ width: 3.2, color: 0x66e8ff, alpha: 0.42 + 0.22 * pulse });
      this.glow
        .ellipse(0, -6, 44 * pulse, 34 * pulse)
        .stroke({ width: 2.2, color: 0xc8ffff, alpha: 0.32 + 0.18 * pulse });
      this.glow
        .ellipse(0, -6, 30 * pulse, 24 * pulse)
        .stroke({ width: 1.4, color: 0xffffff, alpha: 0.18 + 0.12 * pulse });
    }
  }

  private drawFeet(): void {
    this.feet.clear();
  }

  /** Selects an animation frame based on player state, velocity, and elapsed time. */
  private pickBodyTexture(): Texture {
    if (!this.textures) {
      return Texture.EMPTY;
    }

    if (this.state === PlayerState.Attack && this.textures.attack.length > 0) {
      const attack = this.textures.attack;
      const progress = this.getAttackProgress();
      const idx = Math.min(attack.length - 1, Math.floor(progress * attack.length));
      return attack[idx];
    }

    if (this.state === PlayerState.Grapple) {
      const jump = this.textures.jump;
      const phaseT =
        this.grappleClip?.phase === 'pull'
          ? 0.55
          : 0.2 + 0.35 * this.grappleAnimT;
      return jump[Math.min(jump.length - 1, Math.floor(phaseT * jump.length))];
    }

    if (!this.body.grounded) {
      const jump = this.textures.jump;
      const t = Player.airborneFrameT(this.body.vy, this.airTime);
      return jump[Math.min(jump.length - 1, Math.floor(t * jump.length))];
    }

    if (this.state === PlayerState.Walk) {
      const run = this.textures.run;
      const idx = Math.floor(this.distanceTraveled / WALK.runFrameDistance) % run.length;
      return run[idx];
    }

    const idle = this.textures.idle;
    return idle[Math.floor(this.idleTime * IDLE_FPS) % idle.length];
  }

  /**
   * Maps vertical velocity (and a short airtime kicker) into a 0..1 progress through
   * the jump cycle: anticipation → ascent → apex → descent.
   */
  private static airborneFrameT(vy: number, airTime: number): number {
    const launchKick = Math.min(1, airTime / 0.08);

    if (vy < -600) {
      return 0.05 + 0.15 * launchKick;
    }
    if (vy < 0) {
      const a = vy / -600;
      return 0.25 + (1 - a) * 0.15;
    }
    if (vy < 400) {
      return 0.45 + (vy / 400) * 0.25;
    }

    return Math.min(0.99, 0.7 + Math.min(1, (vy - 400) / 800) * 0.29);
  }

  private getPulse(durationMs: number, remainingMs: number): number {
    if (remainingMs <= 0 || durationMs <= 0) {
      return 0;
    }

    return Math.sin((1 - remainingMs / durationMs) * Math.PI);
  }
}
