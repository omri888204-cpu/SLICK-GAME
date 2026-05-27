import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  CANDY_BOY_FEET_ANCHOR_Y,
  DEFAULT_PLAYER_SKIN,
  FIGHTER_FEET_ANCHOR_Y,
  FIGHTER_FRAME_SIZE,
  FIGHTER_SHEETS,
  fighterSheetUrl,
  MENU_MOOD_PORTRAIT_FILES,
  MENU_PLAYER_STILL_SRC,
  menuMoodPortraitSrc,
  PLAYER_AVATAR_SCALE,
  PLAYER_SKIN,
  type PlayerSkinName,
  type SkinFeetAnchors,
} from '../constants/playerSkin';
import { CHARACTER_SHEET_DARK_BG_MAX_CHANNEL } from '../utils/logoTexture';
import { loadKeyedSheetCanvas } from '../utils/spriteSheetExtract';
import {
  loadMobi2Animation,
  mobi2ClipsToCharacterTextures,
  MOBI2_ANIM,
} from '../animation/mobi2Animation';
import { ALIVE, GRAPPLE, RENDER, WALK } from '../../config/game.config';
import type { ActiveGrapple, Direction } from '../types';
import type { PlayerBody } from '../systems/Physics';

export enum PlayerState {
  Idle,
  Walk,
  Jump,
  Fall,
  WallSlide,
  Grapple,
  SuperJump,
  Attack,
}

const PLAYER_DISPLAY_SCALE = 1.15 * PLAYER_AVATAR_SCALE;
const FIGHTER_DISPLAY_WIDTH = 235 * PLAYER_DISPLAY_SCALE;
/** Nudge feet onto the platform deck when grounded (positive = down into surface). */
const GROUNDED_FEET_SINK_PX = 0;
const SLIDE_FPS = 10;
const IDLE_FPS = MOBI2_ANIM.fps.idle;

type BodyFrame = {
  texture: Texture;
  feetAnchorY: number;
};

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

const PLAYER_SCALE = 0.45785088 * PLAYER_AVATAR_SCALE;
const PLAYER_BODY_WIDTH = 70 * PLAYER_SCALE;
const PLAYER_BODY_HEIGHT = 96 * PLAYER_SCALE;

type CharacterTextures = {
  idle: Texture[];
  walk: Texture[];
  run: Texture[];
  jump: Texture[];
  slide: Texture[];
  attack: Texture[];
  landing: Texture[];
};

type SkinRenderBundle = {
  textures: CharacterTextures;
  spriteDisplayWidth: number;
  feetAnchors: SkinFeetAnchors;
  jumpLoopFrameStart: number;
};

async function sliceFighterSheet(url: string, frameCount: number): Promise<Texture[]> {
  const sheet = (await Assets.load(url)) as Texture;
  const cell = FIGHTER_FRAME_SIZE;
  const sheetW = Math.max(sheet.width, sheet.source.width);
  const sheetH = Math.max(sheet.height, sheet.source.height);
  const maxFrames = Math.max(1, Math.floor(sheetW / cell));
  const count = Math.min(frameCount, maxFrames);
  if (sheetH < cell * 0.5) {
    console.warn('[Player] Fighter sheet shorter than expected:', url);
    return [sheet];
  }
  const frames: Texture[] = [];
  for (let i = 0; i < count; i += 1) {
    frames.push(
      new Texture({
        source: sheet.source,
        frame: new Rectangle(i * cell, 0, cell, cell),
      }),
    );
  }
  return frames.length > 0 ? frames : [sheet];
}

async function loadFighterSheetSafe(file: string, frameCount: number): Promise<Texture[]> {
  try {
    return await sliceFighterSheet(fighterSheetUrl(file), frameCount);
  } catch (err) {
    console.warn('[Player] Failed to load Fighter sheet:', file, err);
    return [];
  }
}

async function loadFighterTextures(): Promise<CharacterTextures | null> {
  const s = FIGHTER_SHEETS;
  try {
    const [idle, run, jump, slide, attack1, attack2, attack3] = await Promise.all([
      loadFighterSheetSafe(s.idle.file, s.idle.frameCount),
      loadFighterSheetSafe(s.run.file, s.run.frameCount),
      loadFighterSheetSafe(s.jump.file, s.jump.frameCount),
      loadFighterSheetSafe(s.slide.file, s.slide.frameCount),
      loadFighterSheetSafe(s.attack1.file, s.attack1.frameCount),
      loadFighterSheetSafe(s.attack2.file, s.attack2.frameCount),
      loadFighterSheetSafe(s.attack3.file, s.attack3.frameCount),
    ]);
    if (idle.length === 0) {
      return null;
    }
    const attack = [...attack1, ...attack2, ...attack3];
    const ground = run.length > 0 ? run : idle;
    return {
      idle,
      walk: ground,
      run: ground,
      jump: jump.length > 0 ? jump : idle,
      slide: slide.length > 0 ? slide : idle,
      attack: attack.length > 0 ? attack : idle,
      landing: [],
    };
  } catch (err) {
    console.error('[Player] Fighter textures failed:', err);
    return null;
  }
}

function fighterSkinBundle(textures: CharacterTextures): SkinRenderBundle {
  return {
    textures,
    spriteDisplayWidth: FIGHTER_DISPLAY_WIDTH,
    feetAnchors: FIGHTER_FEET_ANCHOR_Y,
    jumpLoopFrameStart: textures.jump.length,
  };
}

function mobi2SkinBundle(textures: CharacterTextures): SkinRenderBundle {
  return {
    textures,
    spriteDisplayWidth: MOBI2_ANIM.displayWidth,
    feetAnchors: CANDY_BOY_FEET_ANCHOR_Y,
    jumpLoopFrameStart: MOBI2_ANIM.jumpLoopFrameStart,
  };
}

async function loadMobi2CharacterTextures(): Promise<CharacterTextures | null> {
  const bundle = await loadMobi2Animation();
  if (!bundle) {
    return null;
  }
  return mobi2ClipsToCharacterTextures(bundle.clips);
}

export type MenuPlayerClips = {
  idleFrames: Texture[];
  jumpFrames: Texture[];
};

let menuPlayerClipsPromise: Promise<MenuPlayerClips | null> | null = null;
let menuPlayerStillPromise: Promise<Texture | null> | null = null;
let menuPlayerMoodFramesPromise: Promise<Texture[]> | null = null;

/** Mood portraits for the main menu (joke → happy → think → mad). */
export async function loadMenuPlayerMoodFrames(): Promise<Texture[]> {
  menuPlayerMoodFramesPromise ??= (async () => {
    const textures: Texture[] = [];
    for (const file of MENU_MOOD_PORTRAIT_FILES) {
      const canvas = await loadKeyedSheetCanvas(menuMoodPortraitSrc(file), {
        darkMaxChannel: CHARACTER_SHEET_DARK_BG_MAX_CHANNEL,
      });
      if (canvas) {
        textures.push(Texture.from(canvas));
      }
    }
    return textures;
  })();
  return menuPlayerMoodFramesPromise;
}

/** Static menu portrait (`new mobi 2.png`) — fallback when mood art fails to load. */
export async function loadMenuPlayerStill(): Promise<Texture | null> {
  menuPlayerStillPromise ??= (async () => {
    const canvas = await loadKeyedSheetCanvas(MENU_PLAYER_STILL_SRC, {
      darkMaxChannel: CHARACTER_SHEET_DARK_BG_MAX_CHANNEL,
    });
    if (!canvas) {
      return null;
    }
    return Texture.from(canvas);
  })();
  return menuPlayerStillPromise;
}

/** Jump strip for PLAY transition only (`mobi 2 movement.png`). */
export async function loadMenuPlayerClips(): Promise<MenuPlayerClips | null> {
  menuPlayerClipsPromise ??= (async () => {
    const bundle = await loadMobi2Animation();
    if (bundle) {
      return {
        idleFrames: bundle.clips.idle,
        jumpFrames:
          bundle.clips.jump.length > 0 ? bundle.clips.jump : bundle.clips.idle,
      };
    }

    const fighter = await loadFighterTextures();
    if (fighter && fighter.idle.length > 0) {
      return {
        idleFrames: fighter.idle,
        jumpFrames: fighter.jump.length > 0 ? fighter.jump : fighter.idle,
      };
    }

    return null;
  })();
  return menuPlayerClipsPromise;
}

/** @deprecated Use {@link loadMenuPlayerClips}. */
export async function loadMenuPlayerIdleFrame(): Promise<Texture | undefined> {
  const clips = await loadMenuPlayerClips();
  return clips?.idleFrames[0];
}

/** @deprecated Use {@link loadMenuPlayerClips}. */
export async function loadMenuPlayerJumpFrame(): Promise<Texture | undefined> {
  const clips = await loadMenuPlayerClips();
  return clips?.jumpFrames[0];
}

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

  /**
   * Slide-phase chain walls only: elevator latch when `true`; `false` on slide latch, `true` after stair land.
   */
  hasTouchedPlatformSinceLastSlide = true;

  state = PlayerState.Idle;
  direction: Direction = 1;
  isShielded = false;

  /** Active playable skin id (Firebase `selected_character`). */
  skinName: PlayerSkinName = DEFAULT_PLAYER_SKIN;

  private glow = new Graphics();
  private feet = new Graphics();
  /** Holds pose (pos/rot/skew); children get uniform parent space for reliable overlay math. */
  private avatarRig?: Container;
  private bodySprite?: Sprite;
  private silhouette?: Sprite;
  private textures?: CharacterTextures;
  private skinBundles?: Record<PlayerSkinName, SkinRenderBundle>;
  private spriteDisplayWidth = FIGHTER_DISPLAY_WIDTH;
  private feetAnchors: SkinFeetAnchors = FIGHTER_FEET_ANCHOR_Y;
  private jumpLoopFrameStart = Number.MAX_SAFE_INTEGER;
  private distanceTraveled = 0;
  private idleTime = 0;
  private airTime = 0;
  private wallSlideAnimTime = 0;
  private wallSliding = false;
  private walkBlend = 0;
  private jumpPulseMs = 0;
  private jumpAnticipationMs = 0;
  private landingPulseMs = 0;
  private grappleLaunchMs = 0;
  /** Brief squash/stretch pop when a combo-milestone super jump (extra vy) fires. */
  private superJumpBoostMs = 0;
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

  private resolveSkinKey(skinName: PlayerSkinName): PlayerSkinName | undefined {
    const bundles = this.skinBundles;
    if (!bundles) {
      return undefined;
    }
    if (bundles[skinName]) {
      return skinName;
    }
    if (bundles[PLAYER_SKIN.CANDY_BOY]) {
      return PLAYER_SKIN.CANDY_BOY;
    }
    if (bundles[DEFAULT_PLAYER_SKIN]) {
      return DEFAULT_PLAYER_SKIN;
    }
    if (bundles[PLAYER_SKIN.FIGHTER]) {
      return PLAYER_SKIN.FIGHTER;
    }
    return undefined;
  }

  /** Swap playable spritesheet and remap idle / run / jump / attack strips. */
  updatePlayerSkin(skinName: PlayerSkinName): void {
    const key = this.resolveSkinKey(skinName);
    const b = key != null ? this.skinBundles?.[key] : undefined;
    if (!b || key == null) {
      return;
    }

    this.skinName = key;
    this.textures = b.textures;
    this.spriteDisplayWidth = b.spriteDisplayWidth;
    this.feetAnchors = b.feetAnchors;
    this.jumpLoopFrameStart = b.jumpLoopFrameStart;

    const frame0 = b.textures.idle[0] ?? Texture.EMPTY;
    const feetY = b.feetAnchors.idle;

    const snapPx = RENDER.pixelArt;

    if (this.bodySprite && this.avatarRig) {
      this.bodySprite.texture = frame0;
      this.bodySprite.anchor.set(0.5, feetY);
      this.bodySprite.width = this.spriteDisplayWidth;
      this.bodySprite.scale.y = this.bodySprite.scale.x;
      this.bodySprite.roundPixels = snapPx;
    }
    if (this.silhouette) {
      this.silhouette.texture = frame0;
      this.silhouette.anchor.set(0.5, feetY);
      this.silhouette.width = this.spriteDisplayWidth + 5;
      this.silhouette.scale.y = this.silhouette.scale.x;
      this.silhouette.roundPixels = snapPx;
    }
  }

  async load(): Promise<void> {
    const [fighterTextures, mobi2Textures] = await Promise.all([
      loadFighterTextures(),
      loadMobi2CharacterTextures(),
    ]);

    this.skinBundles = {} as Record<PlayerSkinName, SkinRenderBundle>;
    if (mobi2Textures) {
      this.skinBundles[PLAYER_SKIN.CANDY_BOY] = mobi2SkinBundle(mobi2Textures);
    }
    if (fighterTextures) {
      this.skinBundles[PLAYER_SKIN.FIGHTER] = fighterSkinBundle({
        ...fighterTextures,
        landing: [],
      });
    }

    const preferred =
      this.skinBundles[DEFAULT_PLAYER_SKIN] ??
      this.skinBundles[PLAYER_SKIN.CANDY_BOY] ??
      this.skinBundles[PLAYER_SKIN.FIGHTER];
    if (!preferred) {
      throw new Error('[Player] No playable character textures loaded');
    }

    const initialBundle = preferred;
    const initialFrame = initialBundle.textures.idle[0] ?? Texture.EMPTY;
    const initialFeetY = initialBundle?.feetAnchors.idle ?? 1;

    this.silhouette = new Sprite(initialFrame);
    this.silhouette.roundPixels = RENDER.pixelArt;
    this.silhouette.anchor.set(0.5, initialFeetY);
    this.silhouette.tint = 0xf4ead2;
    this.silhouette.alpha = 0.22;
    this.silhouette.width = (initialBundle?.spriteDisplayWidth ?? FIGHTER_DISPLAY_WIDTH) + 5;
    this.silhouette.scale.y = this.silhouette.scale.x;

    this.avatarRig = new Container();
    this.avatarRig.sortableChildren = true;

    this.bodySprite = new Sprite(initialFrame);
    this.bodySprite.roundPixels = RENDER.pixelArt;
    this.bodySprite.anchor.set(0.5, initialFeetY);
    this.bodySprite.width = initialBundle?.spriteDisplayWidth ?? FIGHTER_DISPLAY_WIDTH;
    this.bodySprite.scale.y = this.bodySprite.scale.x;
    this.bodySprite.position.set(0, 0);

    this.avatarRig.addChild(this.bodySprite);

    this.addChildAt(this.silhouette, 1);
    this.addChildAt(this.avatarRig, 2);

    this.updatePlayerSkin(DEFAULT_PLAYER_SKIN);
  }

  update(
    dt: number,
    axis: number,
    comboActive = false,
    grapple: ActiveGrapple | null = null,
    beastMode = false,
    shieldActive = false,
    wallSliding = false,
  ): void {
    this.wallSliding = wallSliding;
    if (wallSliding) {
      this.wallSlideAnimTime += dt;
    } else {
      this.wallSlideAnimTime = 0;
    }

    this.grappleClip = grapple;
    this.grapplePoseActive = grapple !== null;
    this.grappleAnimT = Player.computeGrappleAnimProgress(grapple, GRAPPLE.extendSec);
    this.jumpPulseMs = Math.max(0, this.jumpPulseMs - dt * 1000);
    this.jumpAnticipationMs = Math.max(0, this.jumpAnticipationMs - dt * 1000);
    this.landingPulseMs = Math.max(0, this.landingPulseMs - dt * 1000);
    this.grappleLaunchMs = Math.max(0, this.grappleLaunchMs - dt * 1000);
    this.superJumpBoostMs = Math.max(0, this.superJumpBoostMs - dt * 1000);
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

    // Prefer deliberate stick tilt over instantaneous vx. Viewport fascia clamp briefly inverts vx on wall
    // contact (restitution) while the player still holds toward the wall — using vx alone caused a visible flip.
    if (axis < -0.55) {
      this.direction = -1;
    } else if (axis > 0.55) {
      this.direction = 1;
    } else if (this.body.vx < -20) {
      this.direction = -1;
    } else if (this.body.vx > 20) {
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

  /** Called from `PlayScene` when the climb combo hits every 10th jump (extra upward impulse). */
  onComboSuperJumpBoost(): void {
    this.superJumpBoostMs = 320;
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

    if (this.wallSliding) {
      this.state = PlayerState.WallSlide;
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

    const { texture, feetAnchorY } = this.pickBodyFrame();
    this.bodySprite.anchor.set(0.5, feetAnchorY);
    this.silhouette.anchor.set(0.5, feetAnchorY);
    const pullingGrapple =
      this.state === PlayerState.Grapple &&
      this.grappleClip !== null &&
      this.grappleClip.phase === 'pull';
    const walkPhase = Math.sin(this.distanceTraveled * WALK.bobFrequency);
    const stridePhase = Math.cos(this.distanceTraveled * WALK.bobFrequency);
    const idleBreath = Math.sin(this.idleTime * ALIVE.idleBreathSpeed);
    const idleOffset = this.body.grounded
      ? 0
      : Math.cos(this.idleTime * ALIVE.idleBreathSpeed) * ALIVE.idleFloatPx;
    const idleBlend = 1 - this.walkBlend;
    const walkBob = walkPhase * WALK.bobAmplitude * this.walkBlend;
    const walkSway = stridePhase * WALK.swayAmplitude * this.walkBlend;
    const groundedSink = this.body.grounded ? GROUNDED_FEET_SINK_PX : 0;
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
    const width = this.spriteDisplayWidth + jumpPulse;
    const jumpAnticipation = this.getPulse(ALIVE.jumpAnticipationMs, this.jumpAnticipationMs);
    const landingPulse = this.getPulse(ALIVE.landingPulseMs, this.landingPulseMs);
    const grappleLaunch = this.getPulse(320, this.grappleLaunchMs);
    const superJumpPop = this.getPulse(320, this.superJumpBoostMs);

    if (grappleLaunch > 0) {
      stretch *= 1 + 0.1 * grappleLaunch;
      squash *= 1 - 0.06 * grappleLaunch;
    }

    if (superJumpPop > 0) {
      stretch *= 1 + 0.17 * superJumpPop;
      squash *= 1 - 0.1 * superJumpPop;
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

    if (landingPulse > 0 && !(this.textures.landing.length > 0)) {
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
      this.getFeetAnchorY() + groundedSink + walkBob + idleOffset * idleBlend,
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
    this.bodySprite.tint = 0xffffff;

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
    if (shieldActive && !this.body.grounded) {
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
    if (superJumpPop > 0 && !shieldActive) {
      const ring = 0.42 + 0.58 * superJumpPop;
      this.glow
        .ellipse(0, this.getFeetAnchorY() - this.spriteDisplayWidth * 0.42, 44 * ring, 34 * ring)
        .stroke({ width: 2.4, color: 0x88fff2, alpha: 0.38 * superJumpPop });
    }
  }

  private drawFeet(): void {
    this.feet.clear();
  }

  private jumpFrameFeetAnchorY(frameIndex: number): number {
    if (
      this.feetAnchors.jumpLoop !== undefined &&
      frameIndex >= this.jumpLoopFrameStart
    ) {
      return this.feetAnchors.jumpLoop;
    }
    return this.feetAnchors.jump;
  }

  /** Selects an animation frame based on player state, velocity, and elapsed time. */
  private pickBodyFrame(): BodyFrame {
    const empty: BodyFrame = {
      texture: Texture.EMPTY,
      feetAnchorY: this.feetAnchors.idle,
    };
    if (!this.textures) {
      return empty;
    }

    if (this.state === PlayerState.WallSlide && this.textures.slide.length > 0) {
      const slide = this.textures.slide;
      const idx =
        Math.floor(this.wallSlideAnimTime * SLIDE_FPS) % Math.max(1, slide.length);
      return { texture: slide[idx], feetAnchorY: this.feetAnchors.slide };
    }

    if (this.state === PlayerState.Attack && this.textures.attack.length > 0) {
      const attack = this.textures.attack;
      const progress = this.getAttackProgress();
      const idx = Math.min(attack.length - 1, Math.floor(progress * attack.length));
      return { texture: attack[idx], feetAnchorY: this.feetAnchors.attack };
    }

    if (this.state === PlayerState.Grapple) {
      const jump = this.textures.jump;
      const phaseT =
        this.grappleClip?.phase === 'pull'
          ? 0.55
          : 0.2 + 0.35 * this.grappleAnimT;
      const idx = Math.min(jump.length - 1, Math.floor(phaseT * jump.length));
      return { texture: jump[idx], feetAnchorY: this.jumpFrameFeetAnchorY(idx) };
    }

    if (
      this.body.grounded &&
      this.landingPulseMs > 0 &&
      this.textures.landing.length > 0
    ) {
      const landing = this.textures.landing;
      const progress = 1 - this.landingPulseMs / ALIVE.landingPulseMs;
      const idx = Math.min(
        landing.length - 1,
        Math.floor(Math.max(0, progress) * landing.length),
      );
      return {
        texture: landing[idx],
        feetAnchorY: this.feetAnchors.landing ?? this.feetAnchors.idle,
      };
    }

    if (!this.body.grounded) {
      const jump = this.textures.jump;
      const t = Player.airborneFrameT(this.body.vy, this.airTime);
      const idx = Math.min(jump.length - 1, Math.floor(t * jump.length));
      return { texture: jump[idx], feetAnchorY: this.jumpFrameFeetAnchorY(idx) };
    }

    if (this.state === PlayerState.Walk) {
      const walk = this.textures.walk;
      const idx =
        Math.floor(this.distanceTraveled / MOBI2_ANIM.runFrameDistance) %
        Math.max(1, walk.length);
      return { texture: walk[idx], feetAnchorY: this.feetAnchors.run };
    }

    const idle = this.textures.idle;
    return {
      texture:
        idle[Math.floor(this.idleTime * IDLE_FPS) % Math.max(1, idle.length)] ?? Texture.EMPTY,
      feetAnchorY: this.feetAnchors.idle,
    };
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

  /** World Y of the avatar rig origin — bottom-center of the sprite (feet). */
  private getFeetAnchorY(): number {
    return this.body.height * 0.5;
  }

  private getPulse(durationMs: number, remainingMs: number): number {
    if (remainingMs <= 0 || durationMs <= 0) {
      return 0;
    }

    return Math.sin((1 - remainingMs / durationMs) * Math.PI);
  }
}
