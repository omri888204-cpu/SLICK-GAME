import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ALIVE, GRAPPLE, WALK } from '../../config/game.config';
import type { ActiveGrapple, Direction } from '../types';
import type { PlayerBody } from '../systems/Physics';
import chameleonCleanUrl from '../../assets/sprites/chameleon_clean.png';
import chameleonRunPair1Url from '../../assets/sprites/chameleon-run-pair-1.png';
import chameleonRunPair2Url from '../../assets/sprites/chameleon-run-pair-2.png';
import chameleonRunPair3Url from '../../assets/sprites/chameleon-run-pair-3.png';

export enum PlayerState {
  Idle,
  Walk,
  Jump,
  Fall,
  Grapple,
  SuperJump,
}

const PLAYER_JUMP_WIDTH = 150;

type DirectionalTextures = Record<'jumpLeft' | 'jumpRight', Texture>;

type ChameleonTextures = {
  jumpLeft: Texture;
  jumpRight: Texture;
  runLeft: Texture[];
  runRight: Texture[];
};

export class Player extends Container {
  readonly body: PlayerBody = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    width: 70,
    height: 96,
    grounded: false,
  };

  state = PlayerState.Idle;
  direction: Direction = 1;

  private glow = new Graphics();
  private feet = new Graphics();
  /** Holds pose (pos/rot/skew); children get uniform parent space for reliable overlay math. */
  private avatarRig?: Container;
  private bodySprite?: Sprite;
  private silhouette?: Sprite;
  private textures?: ChameleonTextures;
  private spriteAspectScale = 1;
  private silhouetteAspectScale = 1;
  private distanceTraveled = 0;
  private idleTime = 0;
  private walkBlend = 0;
  private jumpPulseMs = 0;
  private jumpAnticipationMs = 0;
  private landingPulseMs = 0;
  private grappleLaunchMs = 0;
  private grapplePoseActive = false;
  private grappleAnimT = 0;
  private grappleClip: ActiveGrapple | null = null;

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
    const [jumpTextures, ...runParts] = await Promise.all([
      this.createDirectionalTextures(chameleonCleanUrl),
      this.createDirectionalTextures(chameleonRunPair1Url),
      this.createDirectionalTextures(chameleonRunPair2Url),
      this.createDirectionalTextures(chameleonRunPair3Url),
    ]);
    const runPairs = runParts as DirectionalTextures[];
    const { jumpLeft, jumpRight } = jumpTextures;

    this.textures = {
      jumpLeft,
      jumpRight,
      runLeft: runPairs.map((pair) => pair.jumpLeft),
      runRight: runPairs.map((pair) => pair.jumpRight),
    };

    this.silhouette = new Sprite(jumpRight);
    this.silhouette.anchor.set(0.5);
    this.silhouette.tint = 0xf4ead2;
    this.silhouette.alpha = 0.26;
    this.silhouette.width = PLAYER_JUMP_WIDTH + 5;
    this.silhouette.scale.y = this.silhouette.scale.x;
    this.silhouette.position.set(0, -8);

    this.avatarRig = new Container();
    this.avatarRig.sortableChildren = true;

    this.bodySprite = new Sprite(jumpRight);
    this.bodySprite.anchor.set(0.5);
    this.bodySprite.width = PLAYER_JUMP_WIDTH;
    this.bodySprite.scale.y = this.bodySprite.scale.x;
    this.bodySprite.position.set(0, 0);

    this.spriteAspectScale = this.bodySprite.scale.y / this.bodySprite.scale.x;
    this.silhouetteAspectScale = this.silhouette.scale.y / this.silhouette.scale.x;

    this.avatarRig.position.set(0, -8);

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
  ): void {
    this.grappleClip = grapple;
    this.grapplePoseActive = grapple !== null;
    this.grappleAnimT = Player.computeGrappleAnimProgress(grapple, GRAPPLE.extendSec);
    this.jumpPulseMs = Math.max(0, this.jumpPulseMs - dt * 1000);
    this.jumpAnticipationMs = Math.max(0, this.jumpAnticipationMs - dt * 1000);
    this.landingPulseMs = Math.max(0, this.landingPulseMs - dt * 1000);
    this.grappleLaunchMs = Math.max(0, this.grappleLaunchMs - dt * 1000);
    this.idleTime += dt;

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
    this.drawSprite(comboActive, beastMode);
    this.drawFeet();
  }

  onJump(): void {
    this.jumpPulseMs = ALIVE.jumpPulseMs;
    this.jumpAnticipationMs = ALIVE.jumpAnticipationMs;
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

  private updateState(): void {
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

  private drawSprite(_comboActive: boolean, beastMode: boolean): void {
    if (!this.avatarRig || !this.bodySprite || !this.silhouette || !this.textures) {
      return;
    }

    const texture = this.pickBodyTexture();
    const pullingGrapple =
      this.state === PlayerState.Grapple &&
      this.grappleClip !== null &&
      this.grappleClip.phase === 'pull';
    const bodyAspect = this.spriteAspectScale;
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
    const width = PLAYER_JUMP_WIDTH + jumpPulse;
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
    this.bodySprite.scale.x = spriteBaseScale * squash;
    this.bodySprite.scale.y = spriteBaseScale * bodyAspect * stretch;
    this.avatarRig.position.set(walkSway, -8 + groundedSink + walkBob + idleOffset * idleBlend);
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
    this.bodySprite.tint = beastMode ? 0xffddaa : 0xffffff;

    this.silhouette.texture = texture;
    this.silhouette.width = width + 5;
    const silhouetteBaseScale = Math.abs(this.silhouette.scale.x);
    this.silhouette.scale.x = silhouetteBaseScale * squash;
    const silhouetteAspect = this.silhouetteAspectScale;
    this.silhouette.scale.y = silhouetteBaseScale * silhouetteAspect * stretch;
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
  }

  private drawFeet(): void {
    this.feet.clear();
  }

  /** Grapple: jump textures for the body; tongue is drawn in `PlayScene` (vector). */
  private pickBodyTexture(): Texture {
    if (!this.textures) {
      return Texture.EMPTY;
    }

    if (this.state === PlayerState.Grapple) {
      return this.direction === 1 ? this.textures.jumpLeft : this.textures.jumpRight;
    }

    const isRunning = this.state === PlayerState.Walk && this.body.grounded;
    const runFrames = this.direction === 1 ? this.textures.runLeft : this.textures.runRight;

    if (isRunning && runFrames.length > 0) {
      const frameIndex =
        Math.floor(this.distanceTraveled / WALK.runFrameDistance) % runFrames.length;
      return runFrames[frameIndex];
    }

    return this.direction === 1 ? this.textures.jumpLeft : this.textures.jumpRight;
  }

  private getPulse(durationMs: number, remainingMs: number): number {
    if (remainingMs <= 0 || durationMs <= 0) {
      return 0;
    }

    return Math.sin((1 - remainingMs / durationMs) * Math.PI);
  }

  private async createDirectionalTextures(url: string): Promise<DirectionalTextures> {
    const sourceTexture = await Assets.load<Texture>(url);
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return {
        jumpLeft: sourceTexture,
        jumpRight: sourceTexture,
      };
    }

    context.drawImage(image, 0, 0);

    return {
      jumpLeft: this.cropTexture(canvas, 0, canvas.width / 2),
      jumpRight: this.cropTexture(canvas, canvas.width / 2, canvas.width / 2),
    };
  }

  private cropTexture(source: HTMLCanvasElement, x: number, width: number): Texture {
    const crop = document.createElement('canvas');
    crop.width = width;
    crop.height = source.height;

    const context = crop.getContext('2d');
    if (!context) {
      return Texture.from(source);
    }

    context.drawImage(source, x, 0, width, source.height, 0, 0, width, source.height);
    return Texture.from(crop);
  }
}
