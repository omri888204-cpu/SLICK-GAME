import {
  Application,
  Assets,
  Container,
  FederatedPointerEvent,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
  TilingSprite,
  type Ticker,
} from 'pixi.js';
import { PixiFactory, type PixiArmatureDisplay } from 'pixi-dragonbones-runtime';
import {
  COMBO,
  COLLECTIBLES,
  GRAPPLE,
  PHYSICS,
  RENDER,
  SCORE_UI,
  STAIRS,
} from '../../config/game.config';
import { HyperScoreboard } from '../ui/HyperScoreboard';
import { Player } from '../entities/Player';
import { InputManager } from '../systems/InputManager';
import { Physics } from '../systems/Physics';
import type { ActiveGrapple, Platform, Ripple } from '../types';
import crystalPlatformUrl from '../../assets/sprites/crystal-platform.png';
import slimePlatformUrl from '../../assets/sprites/slime-platform.png';
import volcanoPlatformUrl from '../../assets/sprites/volcano-platform.png';
import stormPlatformUrl from '../../assets/sprites/storm-platform.png';
import type { Scene } from './Scene';

type ComboPopup = {
  label: Text;
  t: number;
  wx: number;
  wy: number;
};

type BeastParticle = {
  x: number;
  y: number;
  age: number;
};

type DiamondShineSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
};

type LevelUpParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
};

type Action360Phase = 'attach' | 'rotate';

type Action360State = {
  phase: Action360Phase;
  timeLeft: number;
  hookStairId: number;
  hookX: number;
  hookY: number;
  orbitRadius: number;
  orbitBaseAngle: number;
};

type Action360Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
};

type TouchPointerTrack = {
  side: 'left' | 'right';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  swipeBaselineY: number;
  swipeBaselineX: number;
  startMs: number;
  swipeHandled: boolean;
};

type TouchRipple = {
  x: number;
  y: number;
  age: number;
  life: number;
};

type CollectibleKind = 'coin' | 'diamond';

type Collectible = {
  kind: CollectibleKind;
  /** Stable index into `this.platforms` — world position derived from platform top each frame. */
  platformIdx: number;
  /** 0..1 along usable width (between edge margins). */
  along: number;
  r: number;
  phase: 'active' | 'collecting';
  /** Normalized collect tween 0..1. */
  collectT: number;
  collectStartX: number;
  collectStartY: number;
};

type SfxId =
  | 'tongue_shoot'
  | 'tongue_hit'
  | 'collect_coin'
  | 'collect_diamond'
  | 'player_land';

/** Remote clips when `public/audio/<name>.*` is missing (see `SFX_LOCAL`). */
const SFX_REMOTE: Record<SfxId, string> = {
  tongue_shoot:
    'https://assets.mixkit.co/active_storage/sfx/3169/3169-preview.mp3',
  tongue_hit:
    'https://assets.mixkit.co/active_storage/sfx/2180/2180-preview.mp3',
  collect_coin:
    'https://labs.phaser.io/assets/audio/SoundEffects/p-ping.mp3',
  collect_diamond: 'https://labs.phaser.io/assets/audio/SoundEffects/pickup.wav',
  player_land:
    'https://assets.mixkit.co/active_storage/sfx/2070/2070-preview.mp3',
};

/** Game binaries (music, DragonBones, diamond SFX) live in `public/assets/`. */
const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;

const SFX_LOCAL: Record<SfxId, string> = {
  tongue_shoot: `${import.meta.env.BASE_URL}audio/tongue_shoot.mp3`,
  tongue_hit: `${import.meta.env.BASE_URL}audio/tongue_hit.mp3`,
  collect_coin: `${import.meta.env.BASE_URL}audio/collect_coin.mp3`,
  collect_diamond: `${GAME_ASSETS}/diamond_collect.mp3`,
  player_land: `${import.meta.env.BASE_URL}audio/player_land.mp3`,
};

/** DragonBones export: `*_ske.json`, `*_tex.json`, `*_tex.png` in `public/assets/`. */
const TONGUE_DB_SKE = `${GAME_ASSETS}/tongue_ske.json`;
const TONGUE_DB_TEX_JSON = `${GAME_ASSETS}/tongue_tex.json`;
const TONGUE_DB_TEX_PNG = `${GAME_ASSETS}/tongue_tex.png`;
/** Rest length of the rig in data space; tune if tongue appears too short/long. */
const TONGUE_DB_REST_LENGTH_PX = 118;
const TONGUE_DB_BASE_SCALE = 1;

/**
 * HTMLAudio-based SFX with pooled `cloneNode` playback and local → remote fallback URLs.
 */
class PlaySceneSfx {
  private readonly prototypes = new Map<SfxId, HTMLAudioElement>();
  private master = 0.42;

  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(SFX_REMOTE) as SfxId[]).map((id) => this.loadOne(id)),
    );
  }

  private loadOne(id: SfxId): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.prototypes.set(id, audio);
        resolve();
      };

      const audio = new Audio();
      audio.preload = 'auto';

      const useRemote = (): void => {
        audio.removeEventListener('error', onLocalError);
        audio.src = SFX_REMOTE[id];
        audio.load();
        audio.addEventListener('canplaythrough', () => finish(), { once: true });
        audio.addEventListener('error', () => finish(), { once: true });
      };

      const onLocalError = (): void => {
        useRemote();
      };

      audio.addEventListener('canplaythrough', () => finish(), { once: true });
      audio.addEventListener('error', onLocalError, { once: true });
      audio.src = SFX_LOCAL[id];
      audio.load();
    });
  }

  play(id: SfxId, volume = 1): void {
    const template = this.prototypes.get(id);
    if (!template?.src) {
      return;
    }
    const clip = template.cloneNode(true) as HTMLAudioElement;
    clip.volume = Math.max(0, Math.min(1, volume * this.master));
    void clip.play().catch(() => {
      /* autoplay policy / decode */
    });
  }

  dispose(): void {
    for (const a of this.prototypes.values()) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    this.prototypes.clear();
  }
}

const CHECKER_BACKGROUND_COLOR_SPREAD = 10;
/** Pixels at image edges this dark (and connected) are cleared — removes black letterbox around Photoroom exports. */
const DARK_BG_MAX_CHANNEL = 42;

const COLLECTIBLE_HUD_W = 156;
const COLLECTIBLE_HUD_H = 64;
const PLATFORM_SCALE = 2.1;
const PLATFORM_EDGE_PADDING_PX = 8;
const CAMERA_ZOOM = 0.5;
const MOBILE_CAMERA_ZOOM = 0.42;
const BACKGROUND_PARALLAX_X = 0.2;
const BACKGROUND_PARALLAX_Y = 0.14;
const CAMERA_DEADZONE_PX = 100;
const CAMERA_FOLLOW_LERP_X = 0.1;
const CAMERA_FOLLOW_LERP_Y = 0.1;
const CAMERA_PLAYER_SCREEN_Y_RATIO = 0.62;
const CAMERA_UPWARD_FOLLOW_BOOST = 1.45;
const CAMERA_STAIRS_BELOW_PLAYER = 1;
const WORLD_BOUNDS_X = 0;
const WORLD_BOUNDS_Y = -1000000;
const WORLD_BOUNDS_W = 1400;
const WORLD_BOUNDS_H = 1001000;
const PLATFORM_SPAWN_MIN_X = 100;
const PLATFORM_SPAWN_MAX_X = 1400 - 100;
const STAIR_GAP_MIN_PX = 250;
const STAIR_GAP_MAX_PX = 350;
const BACKGROUND_HORIZONTAL_PAD_PX = 1200;
const BACKGROUND_VERTICAL_PAD_PX = 24000;
const PLAYER_SPAWN_CLEARANCE_PX = 14;
const GRAPPLE_VERTICAL_REACH_PLATFORMS = 2;
const GRAPPLE_MIN_TARGET_DISTANCE_PX = 150;
const GRAPPLE_VERTICAL_BOOST_VY = -400;
const GRAPPLE_STOP_ABOVE_PLATFORM_PX = 20;
const LEVEL_MAX = 100;
const LEVEL_SCORE_STEP = 1000;
const LEVEL_PLATFORM_SPEED_BASE = 24;
const LEVEL_PLATFORM_SPEED_PER_LEVEL = 5;
const LEVEL_PLATFORM_WIDTH_DECAY_RATIO_PER_LEVEL = 0.005;
const LEVEL_PLATFORM_MIN_BASE_WIDTH = 72;
const LEVEL_MILESTONE_STEP = 10;
const FLASH_SKILL_BOOST_DURATION_SEC = 10;
const FLASH_SKILL_BOOST_COOLDOWN_SEC = 10;
const FLASH_REARM_STAIRS_REQUIRED = 10;
const FLASH_TONGUE_COOLDOWN_SPEEDUP = 2;
const FLASH_BOOST_STAIR_COUNT = 4;
const FLASH_TONGUE_RAY_WIDTH_MULTIPLIER = 2.4;
const ACTION360_ATTACH_SEC = 0.72;
const ACTION360_ROTATE_SEC = 2.6;
const ACTION360_ROTATIONS = 2;
const ACTION360_TARGET_STAIRS_UP = 3;
const TOUCH_SWIPE_UP_MIN_PX = 18;
const TOUCH_SWIPE_JUMP_MIN_DISTANCE_PX = 20;
const TOUCH_SWIPE_UPWARD_RATIO_MIN = 0.4;
const TOUCH_FOLLOW_DISTANCE_PX = 44;
const TOUCH_LOCK_RADIUS_PX = 120;
const TOUCH_ACTION_RETRIGGER_MS = 110;
/** After a jump, auto tongue only once we're clearly falling (world y-down vy). */
const AUTO_TONGUE_AFTER_JUMP_MIN_FALL_VY = 110;

export class PlayScene implements Scene {
  readonly name = 'play';

  private app?: Application;
  private input?: InputManager;
  private physics = new Physics();
  private world = new Container();
  private background = new TilingSprite({
    texture: Texture.WHITE,
    width: 1,
    height: 1,
  });
  private jelly = new Graphics();
  private fxLayer = new Graphics();
  private platformSpriteLayer = new Container();
  private platformLayer = new Graphics();
  private rippleLayer = new Graphics();
  private collectiblesGfx = new Graphics();
  private gameShake = new Container();
  /** HUD + touch: never parented under `world` / `gameShake` so it isn’t redrawn with the camera. */
  private uiLayer = new Container();
  private tongueRoot = new Container();
  private tongueVector = new Graphics();
  private tongueArmature: PixiArmatureDisplay | null = null;
  private tongueDbReady = false;
  private player = new Player();
  private scoreboard?: HyperScoreboard;
  private collectibleHudRoot = new Container();
  private collectibleHudBg = new Graphics();
  private touchControlsLayer = new Container();
  private touchFeedbackLayer = new Graphics();
  private touchPointers = new Map<number, TouchPointerTrack>();
  private touchControlPointerId: number | null = null;
  private touchRipples: TouchRipple[] = [];
  private touchLastJumpMs = 0;
  private touchLastGrappleMs = 0;
  private collectibleHudGoldText?: Text;
  private collectibleHudDiamondText?: Text;
  private collectibles: Collectible[] = [];
  private goldCount = 0;
  private diamondCount = 0;
  /** Displayed counts (lerp toward real counts for smooth HUD). */
  private hudGoldShown = 0;
  private hudDiamondShown = 0;
  /** 1 = full collectible HUD punch, decays each frame. */
  private collectibleHudBump = 0;
  private sfx = new PlaySceneSfx();
  private platformTexture?: Texture;
  private platformTextureSlime?: Texture;
  private platformTextureVolcano?: Texture;
  private platformTextureStorm?: Texture;
  private platformSprites: Sprite[] = [];
  private platforms: Platform[] = [];
  /** Stair the player is standing on (kinematic carry uses `driftVx`). */
  private currentGroundPlatform: Platform | null = null;
  private ripples: Ripple[] = [];
  private width = 0;
  private height = 0;
  private worldWidth = 0;
  private worldHeight = 0;
  private worldMinY = 0;
  private worldMaxY = 0;
  private cameraX = 0;
  private cameraY = 0;
  private highestY = 0;
  private grappleCooldown = 0;
  private grapple: ActiveGrapple | null = null;
  private grappleReleaseDampingLeft = 0;
  private grappleReloadingLogged = false;
  private score = 0;
  /** Highest stair id that has already awarded points (landing or grapple). */
  private lastScoredStairId = -1;
  /** Next id assigned to a stair recycled to the top. */
  private nextStairId = 0;

  /** Successful chains within `COMBO.chainWindowSec`; 0 = idle. */
  private comboChain = 0;
  private lastChainTime = -1e9;
  private runTime = 0;
  private comboPopups: ComboPopup[] = [];
  private beastParticles: BeastParticle[] = [];
  private diamondShineSparks: DiamondShineSpark[] = [];
  private beastParticleSpawnAcc = 0;
  private shakeTime = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  private bgm?: HTMLAudioElement;
  private level = 1;
  private levelUpBannerTime = 0;
  private levelUpParticles: LevelUpParticle[] = [];
  private currentBackgroundColor = 0x000000;
  private levelUpFloatText?: Text;
  private flashSkillBoostTime = 0;
  private flashSkillBoostCooldownTime = 0;
  private flashSkillBoostRearmStairId = 0;
  private wasBeastModeActiveLastFrame = false;
  private action360State: Action360State | null = null;
  private action360Sparks: Action360Spark[] = [];
  private jumpArcAssistTime = 0;
  private jumpArcAssistDuration = 0;
  private jumpArcStartCenterX = 0;
  private jumpArcTargetCenterX = 0;
  /** When true, a failed jump may auto-fire the tongue toward the next overhead stair. */
  private autoTongueAfterJumpArmed = false;
  private autoTongueJumpFromStairId = -1;
  async init(app: Application): Promise<void> {
    this.app = app;
    this.width = app.screen.width;
    this.height = app.screen.height;
    this.refreshWorldViewport();

    await Promise.all([this.loadPlatformSprite(), this.player.load(), this.sfx.load()]);

    this.uiLayer.sortableChildren = true;
    app.stage.addChild(this.gameShake);
    app.stage.addChild(this.uiLayer);
    this.gameShake.addChild(this.background);
    this.gameShake.addChild(this.world);
    this.world.sortableChildren = true;
    this.world.addChild(
      this.jelly,
      this.platformSpriteLayer,
      this.platformLayer,
      this.rippleLayer,
      this.collectiblesGfx,
      this.tongueRoot,
      this.fxLayer,
      this.player,
    );
    this.levelUpFloatText = new Text({
      text: 'LEVEL UP!',
      style: new TextStyle({
        fill: '#ffff66',
        fontFamily: 'Urbanist, Heebo, Arial Black, sans-serif',
        fontSize: 18,
        fontWeight: '800',
        stroke: { color: '#301050', width: 4 },
      }),
    });
    this.levelUpFloatText.anchor.set(0.5);
    this.levelUpFloatText.visible = false;
    this.world.addChild(this.levelUpFloatText);
    this.tongueRoot.addChild(this.tongueVector);

    this.scoreboard = new HyperScoreboard();
    this.scoreboard.position.set(10, 6);
    this.scoreboard.onResize(this.width);
    this.uiLayer.addChild(this.scoreboard);

    this.setupCollectibleHud(app);
    this.layoutCollectibleHud();

    this.input = new InputManager(app);
    this.input.attach();
    this.setupTouchControlsOverlay(app);

    await this.tryLoadTongueArmature();
    this.startBackgroundMusic();

    this.resetRun();
    this.drawStaticWorld();
    this.applyCameraTransform();
    this.drawDynamicWorld();
  }

  update(ticker: Ticker): void {
    // Use real frame delta on mobile — capping to 1/30s made slow frames *lose* time so drifting
    // platforms and the camera looked stuttery. Only cap huge spikes (tab resume).
    const dt = Math.min(Math.max(ticker.deltaMS, 0) / 1000, 1 / 8);
    this.runTime += dt;
    this.input?.smoothTouchJoystickAxis(dt);
    this.expireComboIfNeeded();
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    this.updateFlashSkillBoost(dt);
    this.updateTouchRipples(dt);
    this.updateGrappleCooldownFeedback();
    this.updateLevelProgress();
    this.updatePlatformDifficulty(dt);
    this.updateLevelUpParticles(dt);
    this.update360Action(dt);
    this.updateTouchFollowAxis();

    if (!this.action360State && this.grapple?.phase === 'extend') {
      this.grapple.extendT += dt;
      if (this.grapple.extendT >= GRAPPLE.extendSec) {
        this.grapple.phase = 'pull';
        this.grapple.pullStartX = this.player.body.x + this.player.body.width * 0.5;
        this.grapple.pullStartY = this.player.body.y + this.player.body.height * 0.5;
        this.player.body.vy = Math.min(this.player.body.vy, GRAPPLE_VERTICAL_BOOST_VY);
        this.player.body.grounded = false;
        this.sfx.play('tongue_hit', 0.95);
      }
    }

    if (!this.action360State && this.grapple?.phase === 'pull') {
      const body = this.player.body;
      const hookPlatform = this.platforms.find((platform) => platform.stairId === this.grapple?.hookStairId);
      if (!hookPlatform) {
        this.grapple = null;
      } else {
        const pullTargetY = hookPlatform.y - body.height - GRAPPLE_STOP_ABOVE_PLATFORM_PX;
        const hookCenterX = hookPlatform.x + hookPlatform.width * 0.5;
        const targetBodyX = hookCenterX - body.width * 0.5;
        body.x += (targetBodyX - body.x) * Math.min(1, dt * 10);
        body.vx *= Math.max(0, 1 - 10 * dt);
        body.vy = Math.min(body.vy, GRAPPLE_VERTICAL_BOOST_VY);
        if (body.y <= pullTargetY) {
          body.y = pullTargetY;
          body.vy = 0;
          body.vx = 0;
          body.grounded = false;
          const hookId = this.grapple.hookStairId;
          const grappleGain = Math.max(0, hookId - this.lastScoredStairId);
          if (grappleGain > 0) {
            const launchSpeed = Math.hypot(body.vx, Math.abs(body.vy));
            this.feedComboFromGrapple(grappleGain, false, launchSpeed);
            const mult = this.getComboMultiplier();
            const delta = grappleGain * mult;
            this.score += delta * this.getScoreGainMultiplier();
            this.lastScoredStairId = hookId;
            this.maybeSpawnComboPopup(mult);
            this.scoreboard?.onPointsGained(delta);
            this.maybeTriggerScreenShake(delta, mult);
          }
          this.grapple = null;
          this.grappleReleaseDampingLeft = GRAPPLE.releaseDampingDurationSec;
        }
      }
    }

    if (
      !this.action360State &&
      this.currentGroundPlatform &&
      this.player.body.grounded &&
      !this.grapple &&
      RENDER.platformSurfaceFriction === 0
    ) {
      this.player.body.x += this.currentGroundPlatform.driftVx * dt;
    }

    if (this.action360State) {
      this.currentGroundPlatform = null;
      this.updateCamera(dt);
      this.recycleStairsOffscreen();
      this.syncPlatformSpritesFromPlatforms();
      this.checkFallGameOver();
      this.updateRipples(dt);
      this.updateBeastParticles(dt);
      this.updateComboPopups(dt);
      this.updateDiamondShineSparks(dt);
      this.updateAction360Sparks(dt);
      this.updateCollectibles(dt);
      this.updateCollectibleHudSmooth(dt);
      const mult = this.getComboMultiplier();
      this.player.update(
        dt,
        0,
        this.highestY < -650,
        this.grapple,
        mult >= COMBO.beastModeMinMultiplier,
      );
      this.physics.applyWorldBounds(this.player.body, this.worldWidth);
      this.drawDynamicWorld();
      this.updateScreenShake(dt);
      const heightMeters = Math.max(0, Math.floor(-this.highestY / 12));
      this.scoreboard?.update(dt, this.score, mult, heightMeters, this.runTime, this.level);
      return;
    }

    const axis = this.input?.getHorizontalAxis() ?? 0;
    const pulling = this.grapple?.phase === 'pull';
    const axisScale = pulling ? 0 : 1;
    const jumpArcAssistActive = this.jumpArcAssistTime > 0 && !this.player.body.grounded;
    const effectiveAxis = jumpArcAssistActive ? 0 : axis;

    this.physics.applyHorizontalInput(this.player.body, effectiveAxis * axisScale, dt);
    if (jumpArcAssistActive) {
      this.jumpArcAssistTime = Math.max(0, this.jumpArcAssistTime - dt);
      const body = this.player.body;
      const bodyCenterX = body.x + body.width * 0.5;
      const elapsed = Math.max(0, this.jumpArcAssistDuration - this.jumpArcAssistTime);
      const t = this.jumpArcAssistDuration > 0 ? Math.min(1, elapsed / this.jumpArcAssistDuration) : 1;
      const curveT = 1 - Math.pow(1 - t, 2);
      const desiredCenterX =
        this.jumpArcStartCenterX +
        (this.jumpArcTargetCenterX - this.jumpArcStartCenterX) * curveT;
      const toDesired = desiredCenterX - bodyCenterX;
      const targetVx = Math.max(-300, Math.min(220, toDesired * 4.8));
      const steer = Math.min(1, dt * 6);
      body.vx += (targetVx - body.vx) * steer;
      // Keep momentum bending inward while arc assist is active.
      if (this.jumpArcTargetCenterX < bodyCenterX) {
        body.vx = Math.min(body.vx, -70);
      }
    } else if (this.player.body.grounded) {
      this.jumpArcAssistTime = 0;
      this.jumpArcAssistDuration = 0;
    }
    this.handleActions();
    this.applyPostGrappleReleaseDamping(dt);

    const gravityScale = pulling ? 0 : this.getGravityScaleForLevel();
    const wasGrounded = this.player.body.grounded;
    const result = this.physics.update(
      this.player.body,
      this.platforms,
      this.worldWidth,
      dt,
      gravityScale,
    );
    if (result.landedPlatform) {
      this.autoTongueAfterJumpArmed = false;
      this.currentGroundPlatform = result.landedPlatform;
      this.player.onLand(result.impactVy);
      if (!wasGrounded) {
        const landVol = Math.min(1, result.impactVy / 520);
        this.sfx.play('player_land', 0.35 + landVol * 0.65);
      }
      const p = result.landedPlatform;
      const landGain = Math.max(0, p.stairId - this.lastScoredStairId);
      if (landGain > 0) {
        this.feedComboFromLand();
        const mult = this.getComboMultiplier();
        const delta = landGain * mult;
        this.score += delta * this.getScoreGainMultiplier();
        this.lastScoredStairId = p.stairId;
        this.maybeSpawnComboPopup(mult);
        this.scoreboard?.onPointsGained(delta);
        this.maybeTriggerScreenShake(delta, mult);
      }
      this.landOn(p);
    } else if (!this.player.body.grounded) {
      this.currentGroundPlatform = null;
      this.maybeAutoTongueAfterFailedJump();
    }

    this.updateCamera(dt);
    this.recycleStairsOffscreen();
    this.syncPlatformSpritesFromPlatforms();
    this.checkFallGameOver();
    this.updateRipples(dt);
    this.updateBeastParticles(dt);
    this.updateComboPopups(dt);
    this.updateDiamondShineSparks(dt);
    this.updateAction360Sparks(dt);
    this.updateCollectibles(dt);
    this.updateCollectibleHudSmooth(dt);
    const mult = this.getComboMultiplier();
    const boostVisualActive = this.isFlashSkillBoostActive();
    this.player.update(
      dt,
      axis,
      this.highestY < -650,
      this.grapple,
      boostVisualActive,
    );
    this.drawDynamicWorld();
    this.updateScreenShake(dt);
    const heightMeters = Math.max(0, Math.floor(-this.highestY / 12));
    this.scoreboard?.update(dt, this.score, mult, heightMeters, this.runTime, this.level);
  }

  resize(width: number, height: number): void {
    const prevW = this.width;
    const prevH = this.height;
    const dw = Math.abs(width - prevW);
    const dh = Math.abs(height - prevH);
    this.width = width;
    this.height = height;
    this.refreshWorldViewport();

    if (this.scoreboard) {
      this.scoreboard.onResize(width);
      this.scoreboard.position.set(10, 6);
    }
    this.layoutCollectibleHud();
    this.input?.onResize();

    // Mobile browser chrome toggles height in small steps; resetting the whole run felt like “stuck” stairs.
    const minorViewportJitter =
      prevW > 0 && this.platforms.length > 0 && dw <= 36 && dh <= 96;
    if (minorViewportJitter) {
      this.drawStaticWorld();
      this.clampEntitiesToWorldBounds();
      this.syncPlatformSpritesFromPlatforms();
      this.drawDynamicWorld();
      return;
    }

    this.resetRun();
    this.drawStaticWorld();
    this.drawDynamicWorld();
  }

  destroy(): void {
    if (this.input?.isTouchControlsActive()) {
      this.app?.stage.off('pointerdown', this.handleTouchPointerDown);
      this.app?.stage.off('pointermove', this.handleTouchPointerMove);
      this.app?.stage.off('pointerup', this.handleTouchPointerUpOrCancel);
      this.app?.stage.off('pointerupoutside', this.handleTouchPointerUpOrCancel);
      this.app?.stage.off('pointercancel', this.handleTouchPointerUpOrCancel);
      this.touchPointers.clear();
      this.touchControlPointerId = null;
      this.input?.clearTouchHolds();
    }
    this.input?.destroy();
    this.player.rotation = 0;
    this.clearPlatformSprites();
    this.clearFloatingComboUi();
    this.uiLayer.destroy({ children: true });
    this.sfx.dispose();
    this.stopBackgroundMusic();
    this.tongueArmature?.dispose(true);
    this.tongueArmature = null;
    this.tongueDbReady = false;
    this.gameShake.destroy({ children: true });
  }

  private handleActions(): void {
    if (this.action360State) {
      return;
    }
    const wantGrapple = this.input?.consumeGrapple() ?? false;
    if (wantGrapple) {
      this.triggerGrappleAction();
    }

    const jumpPressed = this.input?.consumeJump() ?? false;

    if (jumpPressed) {
      this.triggerJumpAction();
    }
  }

  private computeGrappleTargetHit():
    | { x: number; y: number; platform: Platform }
    | undefined {
    const flashBoost = this.isFlashSkillBoostActive();
    const body = this.player.body;
    const shootX = body.x + body.width * 0.5;
    const shootY = body.y + body.height * 0.5;
    const baseReach = Math.max(350, STAIRS.stepPx * GRAPPLE_VERTICAL_REACH_PLATFORMS + 100);
    const boostedReach = STAIRS.stepPx * FLASH_BOOST_STAIR_COUNT + 70;
    const maxReach = flashBoost ? boostedReach : baseReach;
    const baseRayHalfWidth = Math.max(8, body.width * 0.8);
    const verticalRayHalfWidth = flashBoost
      ? baseRayHalfWidth * FLASH_TONGUE_RAY_WIDTH_MULTIPLIER
      : baseRayHalfWidth;
    return Physics.castGrappleTarget(
      this.platforms,
      shootX,
      shootY,
      GRAPPLE_MIN_TARGET_DISTANCE_PX,
      maxReach,
      verticalRayHalfWidth,
      flashBoost,
    );
  }

  private beginGrappleFromHit(hit: { x: number; y: number; platform: Platform }): void {
    this.autoTongueAfterJumpArmed = false;
    this.grapple = {
      phase: 'extend',
      targetX: hit.x,
      targetY: hit.y,
      extendT: 0,
      hookStairId: hit.platform.stairId,
      pullStartX: this.player.body.x + this.player.body.width * 0.5,
      pullStartY: this.player.body.y + this.player.body.height * 0.5,
    };
    const cooldownSpeedup = this.isFlashSkillBoostActive() ? FLASH_TONGUE_COOLDOWN_SPEEDUP : 1;
    this.grappleCooldown = GRAPPLE.cooldownSec / cooldownSpeedup;
    this.grappleReloadingLogged = false;
    this.player.onGrappleLaunch();
    this.sfx.play('tongue_shoot', 0.88);
  }

  private triggerGrappleAction(): void {
    if (this.grappleCooldown > 0 || this.grapple) {
      return;
    }
    const hit = this.computeGrappleTargetHit();
    if (!hit) {
      return;
    }
    this.beginGrappleFromHit(hit);
  }

  private maybeAutoTongueAfterFailedJump(): void {
    if (!this.autoTongueAfterJumpArmed || this.grapple || this.action360State) {
      return;
    }
    const body = this.player.body;
    if (body.grounded || body.vy <= AUTO_TONGUE_AFTER_JUMP_MIN_FALL_VY) {
      return;
    }
    const hit = this.computeGrappleTargetHit();
    if (!hit || hit.platform.stairId <= this.autoTongueJumpFromStairId) {
      return;
    }
    this.beginGrappleFromHit(hit);
  }

  private applyPostGrappleReleaseDamping(dt: number): void {
    if (this.grapple !== null || this.grappleReleaseDampingLeft <= 0) {
      return;
    }
    this.grappleReleaseDampingLeft = Math.max(0, this.grappleReleaseDampingLeft - dt);
    const damp = Math.max(0, 1 - GRAPPLE.releaseDampingPerSec * dt);
    this.player.body.vx *= damp;
    this.player.body.vy *= damp;
  }

  private updateGrappleCooldownFeedback(): void {
    if (this.grappleCooldown > 0) {
      if (!this.grappleReloadingLogged) {
        this.grappleReloadingLogged = true;
        console.log('Tongue reloading...');
      }
      return;
    }

    if (this.grappleReloadingLogged) {
      this.grappleReloadingLogged = false;
      console.log('Tongue ready!');
    }
  }

  private triggerJumpAction(fromRightSwipe = false): void {
    if (!this.player.body.grounded || !!this.grapple) {
      return;
    }
    this.autoTongueJumpFromStairId =
      this.currentGroundPlatform?.stairId ?? this.lastScoredStairId;
    this.autoTongueAfterJumpArmed = true;
    this.physics.jump(this.player.body);
    if (this.isFlashSkillBoostActive()) {
      const maxBoostJumpHeight = STAIRS.stepPx * FLASH_BOOST_STAIR_COUNT;
      const maxBoostJumpVy = -Math.sqrt(2 * PHYSICS.gravity * maxBoostJumpHeight);
      this.player.body.vy = maxBoostJumpVy;
    }
    if (fromRightSwipe) {
      const body = this.player.body;
      const centerX = this.worldWidth * 0.5;
      const bodyCenterX = body.x + body.width * 0.5;
      const rightBias = Math.max(0, (bodyCenterX - centerX) / Math.max(1, this.worldWidth * 0.5));
      const inwardAssistVx = -(170 + rightBias * 250);
      // Keep existing stronger inward motion, otherwise bend trajectory toward screen center.
      body.vx = Math.min(body.vx, inwardAssistVx);
      this.jumpArcAssistDuration = 0.28;
      this.jumpArcAssistTime = this.jumpArcAssistDuration;
      this.jumpArcStartCenterX = bodyCenterX;
      this.jumpArcTargetCenterX = centerX;
    }
    this.player.onJump();
  }

  private createPlatforms(): void {
    this.platforms = [];
    this.clearPlatformSprites();
    const baseY = this.worldMaxY - 96;
    let y = baseY;

    for (let index = 0; index < STAIRS.poolCount; index += 1) {
      const baseWidth = 150 + ((index * 37) % 80);
      const width = baseWidth * PLATFORM_SCALE;
      const x = this.computePlatformSpawnX(index, width);
      const platform: Platform = {
        x,
        y,
        width,
        height: STAIRS.platformHeight,
        baseWidth,
        driftDir: Math.random() < 0.5 ? -1 : 1,
        driftVx: 0,
        stairId: index,
      };
      this.updatePlatformBodyFromScale(platform);
      if (index === 0) {
        platform.x = this.worldWidth * 0.5 - platform.width * 0.5;
      }
      this.platforms.push(platform);
      y -= this.computeStairGapPx(index);
    }

    this.nextStairId = STAIRS.poolCount - 1;
    this.createPlatformSprites();
  }

  /**
   * Steps that scroll below visible area move to the top with a new stairId so climbing is endless.
   */
  private recycleStairsOffscreen(): void {
    const cutoff = this.cameraY + this.worldHeightFromScreen() + STAIRS.recycleBelowScreenPx;
    const staying = this.platforms.filter((p) => p.y <= cutoff);
    if (staying.length === 0 || staying.length === this.platforms.length) {
      return;
    }

    const toRecycle = this.platforms.filter((p) => p.y > cutoff).sort((a, b) => b.y - a.y);
    let spawnY = Math.min(
      Math.min(...staying.map((p) => p.y)) - STAIRS.stepPx,
      this.cameraY - 2000,
    );

    const recycleSpeed = LEVEL_PLATFORM_SPEED_BASE + this.level * LEVEL_PLATFORM_SPEED_PER_LEVEL;
    for (const p of toRecycle) {
      this.nextStairId += 1;
      p.stairId = this.nextStairId;
      p.y = spawnY;
      p.baseWidth = 150 + ((this.nextStairId * 37) % 80);
      p.width = p.baseWidth * PLATFORM_SCALE;
      p.driftDir = Math.random() < 0.5 ? -1 : 1;
      p.driftVx = p.driftDir * recycleSpeed;
      this.updatePlatformBodyFromScale(p);
      p.x = this.computePlatformSpawnX(this.nextStairId, p.width);
      spawnY -= this.computeStairGapPx(this.nextStairId);
    }
  }

  private computeStairGapPx(stairId: number): number {
    const raw = Math.sin((stairId + 17) * 19.357) * 43758.5453;
    const unit = raw - Math.floor(raw);
    return STAIR_GAP_MIN_PX + unit * (STAIR_GAP_MAX_PX - STAIR_GAP_MIN_PX);
  }

  private computePlatformSpawnX(stairId: number, platformWidth: number): number {
    const minCenterX = PLATFORM_SPAWN_MIN_X;
    const maxCenterX = PLATFORM_SPAWN_MAX_X;
    const minX = Math.max(WORLD_BOUNDS_X + PLATFORM_EDGE_PADDING_PX, minCenterX - platformWidth * 0.5);
    const maxX = Math.min(
      this.worldWidth - platformWidth - PLATFORM_EDGE_PADDING_PX,
      maxCenterX - platformWidth * 0.5,
    );
    if (maxX <= minX) {
      return minX;
    }
    const raw = Math.sin((stairId + 1) * 12.9898) * 43758.5453;
    const unit = raw - Math.floor(raw);
    return minX + unit * (maxX - minX);
  }

  private updatePlatformBodyFromScale(platform: Platform): void {
    // Custom physics uses this body directly; keep collider scale in exact sync with art scale.
    platform.height = STAIRS.platformHeight * PLATFORM_SCALE;
  }

  /** After a small viewport change (mobile URL bar), keep platforms and player inside the new width. */
  private clampEntitiesToWorldBounds(): void {
    const margin = PLATFORM_EDGE_PADDING_PX;
    const maxPx = Math.max(margin + 1, this.worldWidth - margin);
    for (const p of this.platforms) {
      if (p.x < margin) {
        p.x = margin;
      }
      if (p.x + p.width > maxPx) {
        p.x = Math.max(margin, maxPx - p.width);
      }
      this.updatePlatformBodyFromScale(p);
    }
    const body = this.player.body;
    body.x = Math.max(0, Math.min(body.x, this.worldWidth - body.width));
  }

  private syncPlatformSpritesFromPlatforms(): void {
    if (!this.platformTexture) {
      return;
    }

    const climbM = Math.max(0, Math.floor(-this.highestY / 12));

    let tex: Texture = this.platformTexture;
    let artMul = 1;

    if (climbM >= STAIRS.stormPlatformAfterMeters && this.platformTextureStorm !== undefined) {
      tex = this.platformTextureStorm;
      artMul = STAIRS.stormPlatformArtScale;
    } else if (climbM >= STAIRS.volcanoPlatformAfterMeters && this.platformTextureVolcano !== undefined) {
      tex = this.platformTextureVolcano;
      artMul = STAIRS.volcanoPlatformArtScale;
    } else if (climbM >= STAIRS.slimePlatformAfterMeters && this.platformTextureSlime !== undefined) {
      tex = this.platformTextureSlime;
      artMul = STAIRS.slimePlatformArtScale;
    } else if (climbM >= STAIRS.compactPlatformArtAfterMeters) {
      artMul = STAIRS.compactPlatformArtScale;
    }

    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const sprite = this.platformSprites[i];
      if (!sprite) {
        continue;
      }

      if (sprite.texture !== tex) {
        sprite.texture = tex;
      }

      sprite.roundPixels = RENDER.pixelArt;
      sprite.width = platform.width * artMul;
      sprite.scale.y = Math.abs(sprite.scale.x);
      sprite.position.set(platform.x + platform.width / 2, platform.y + platform.height / 2 + 6);
    }
  }

  private resetRun(): void {
    this.currentGroundPlatform = null;
    this.clearFloatingComboUi();
    this.score = 0;
    this.lastScoredStairId = -1;
    this.cameraX = 0;
    this.cameraY = 0;
    this.highestY = 0;
    this.goldCount = 0;
    this.diamondCount = 0;
    this.collectibles = [];
    this.comboChain = 0;
    this.lastChainTime = -1e9;
    this.beastParticles = [];
    this.beastParticleSpawnAcc = 0;
    this.shakeTime = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.diamondShineSparks = [];
    this.level = 1;
    this.levelUpBannerTime = 0;
    this.levelUpParticles = [];
    this.action360State = null;
    this.action360Sparks = [];
    this.player.rotation = 0;
    this.flashSkillBoostTime = 0;
    this.flashSkillBoostCooldownTime = 0;
    this.flashSkillBoostRearmStairId = 0;
    this.wasBeastModeActiveLastFrame = false;
    this.syncTouch360Visibility();
    this.jumpArcAssistTime = 0;
    this.jumpArcAssistDuration = 0;
    this.autoTongueAfterJumpArmed = false;
    this.autoTongueJumpFromStairId = -1;
    this.currentBackgroundColor = this.getBackgroundColorForLevel(this.level);
    if (this.levelUpFloatText) {
      this.levelUpFloatText.visible = false;
    }
    this.createPlatforms();
    this.spawnCollectibleField();
    this.resetPlayer();
    this.snapCameraToPlayer();
    this.scoreboard?.reset();
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.collectibleHudBump = 0;
    this.collectibleHudRoot.scale.set(1);
    this.refreshCollectibleHudText();
    this.scoreboard?.setLevel(this.level);
  }

  private updateFlashSkillBoost(dt: number): void {
    const wasBoostActive = this.flashSkillBoostTime > 0;
    this.flashSkillBoostCooldownTime = Math.max(0, this.flashSkillBoostCooldownTime - dt);
    const beastModeActiveNow = this.getComboMultiplier() >= COMBO.beastModeMinMultiplier;
    if (
      beastModeActiveNow &&
      !this.wasBeastModeActiveLastFrame &&
      this.flashSkillBoostCooldownTime <= 0 &&
      this.canRearmBoost()
    ) {
      this.flashSkillBoostTime = FLASH_SKILL_BOOST_DURATION_SEC;
      this.flashSkillBoostCooldownTime = FLASH_SKILL_BOOST_COOLDOWN_SEC;
    } else if (this.flashSkillBoostTime > 0) {
      this.flashSkillBoostTime = Math.max(0, this.flashSkillBoostTime - dt);
    }
    this.wasBeastModeActiveLastFrame = beastModeActiveNow;
    if (wasBoostActive && this.flashSkillBoostTime <= 0) {
      this.resetBoostAbilitiesToNormal();
      this.comboChain = 0;
      this.lastChainTime = -1e9;
      this.flashSkillBoostRearmStairId = this.lastScoredStairId + FLASH_REARM_STAIRS_REQUIRED;
    }
    this.syncTouch360Visibility();
  }

  private isFlashSkillBoostActive(): boolean {
    return this.flashSkillBoostTime > 0;
  }

  private canRearmBoost(): boolean {
    return this.lastScoredStairId >= this.flashSkillBoostRearmStairId;
  }

  private resetBoostAbilitiesToNormal(): void {
    if (this.action360State) {
      this.stop360Action(true);
      return;
    }
    if (this.player.body.vy < 0) {
      const normalJumpVy =
        -(PHYSICS.baseJump + Math.abs(this.player.body.vx) * PHYSICS.speedJumpBonus);
      // If boost expired mid-air, clamp remaining upward speed back to normal jump ceiling.
      this.player.body.vy = Math.max(this.player.body.vy, normalJumpVy);
    }
  }

  private getScoreGainMultiplier(): number {
    return this.action360State?.phase === 'rotate' ? 3 : 1;
  }

  private perform360Action(): void {
    if (this.action360State) {
      return;
    }
    const body = this.player.body;
    const shootX = body.x + body.width * 0.5;
    const shootY = body.y + body.height * 0.5;
    const hit = this.find360AttachTarget(shootX, shootY, body.width);
    if (!hit) {
      return;
    }
    this.action360State = {
      phase: 'attach',
      timeLeft: ACTION360_ATTACH_SEC,
      hookStairId: hit.platform.stairId,
      hookX: hit.x,
      hookY: hit.y,
      orbitRadius: 0,
      orbitBaseAngle: 0,
    };
    this.autoTongueAfterJumpArmed = false;
    this.grapple = {
      phase: 'extend',
      targetX: hit.x,
      targetY: hit.y,
      extendT: 0,
      hookStairId: hit.platform.stairId,
      pullStartX: shootX,
      pullStartY: shootY,
    };
    body.vx = 0;
    body.vy = 0;
    body.grounded = false;
    this.touchPointers.clear();
    this.input?.clearTouchHolds();
  }

  private find360AttachTarget(
    shootX: number,
    shootY: number,
    bodyWidth: number,
  ): { x: number; y: number; platform: Platform } | undefined {
    const baseStairId =
      this.currentGroundPlatform?.stairId ??
      this.platforms
        .filter((p) => p.y >= this.player.body.y - 8)
        .reduce((best, p) => (best ? (p.y < best.y ? p : best) : p), undefined as Platform | undefined)
        ?.stairId ??
      this.lastScoredStairId;
    const targetStairId = baseStairId + ACTION360_TARGET_STAIRS_UP;
    const exactThirdUp = this.platforms.find(
      (p) => p.stairId === targetStairId && p.y + p.height < shootY,
    );
    if (exactThirdUp) {
      return {
        x: exactThirdUp.x + exactThirdUp.width * 0.5,
        y: exactThirdUp.y + exactThirdUp.height - 3,
        platform: exactThirdUp,
      };
    }

    const reach = STAIRS.stepPx * 5.2;
    const direct = Physics.castGrappleTarget(
      this.platforms,
      shootX,
      shootY,
      18,
      reach,
      Math.max(18, bodyWidth * 2.6),
      true,
    );
    if (direct) {
      return direct;
    }

    let best:
      | {
          score: number;
          x: number;
          y: number;
          platform: Platform;
        }
      | undefined;
    for (const p of this.platforms) {
      const bottom = p.y + p.height;
      if (bottom >= shootY) {
        continue;
      }
      const dy = shootY - bottom;
      if (dy > reach || dy < 18) {
        continue;
      }
      const px = p.x + p.width * 0.5;
      const dx = Math.abs(px - shootX);
      const score = dy * 1.35 + dx * 0.35;
      if (!best || score < best.score) {
        best = {
          score,
          x: px,
          y: bottom - 3,
          platform: p,
        };
      }
    }
    return best
      ? { x: best.x, y: best.y, platform: best.platform }
      : undefined;
  }

  private update360Action(dt: number): void {
    const state = this.action360State;
    if (!state) {
      this.player.rotation = 0;
      return;
    }
    const body = this.player.body;
    const attachPlatform = this.platforms.find((p) => p.stairId === state.hookStairId);
    if (!attachPlatform) {
      this.stop360Action(false);
      return;
    }
    if (state.phase === 'attach') {
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      const attachProgress = 1 - state.timeLeft / ACTION360_ATTACH_SEC;
      if (this.grapple) {
        this.grapple.phase = 'extend';
        this.grapple.extendT = Math.min(GRAPPLE.extendSec, attachProgress * GRAPPLE.extendSec);
      }
      body.vx = 0;
      body.vy = 0;
      body.grounded = this.player.body.grounded;
      if (state.timeLeft <= 0) {
        const centerX = body.x + body.width * 0.5;
        const centerY = body.y + body.height * 0.5;
        if (this.grapple) {
          this.grapple.phase = 'pull';
          this.grapple.extendT = GRAPPLE.extendSec;
          this.grapple.pullStartX = centerX;
          this.grapple.pullStartY = centerY;
        }
        state.phase = 'rotate';
        state.timeLeft = ACTION360_ROTATE_SEC;
        const ox = centerX - state.hookX;
        const oy = centerY - state.hookY;
        const baseRadius = Math.hypot(ox, oy) * 1.62;
        const minOrbitRadius = Math.max(150, this.height * 0.24);
        const maxOrbitRadius = Math.max(minOrbitRadius + 20, this.height * 0.42);
        state.orbitRadius = Math.max(minOrbitRadius, Math.min(maxOrbitRadius, baseRadius));
        state.orbitBaseAngle = Math.atan2(oy, ox);
      }
      this.player.rotation = 0;
      return;
    }

    state.timeLeft = Math.max(0, state.timeLeft - dt);
    const t = 1 - state.timeLeft / ACTION360_ROTATE_SEC;
    const angle = state.orbitBaseAngle + t * Math.PI * 2 * ACTION360_ROTATIONS;
    const cx = state.hookX + Math.cos(angle) * state.orbitRadius;
    const cy = state.hookY + Math.sin(angle) * state.orbitRadius;
    body.x = cx - body.width * 0.5;
    body.y = cy - body.height * 0.5;
    body.vx = 0;
    body.vy = 0;
    body.grounded = false;
    this.player.rotation = angle + Math.PI * 0.5;
    this.spawnAction360Sparks(state.hookX, state.hookY);

    if (state.timeLeft <= 0) {
      this.stop360Action(true);
    }
  }

  private stop360Action(landOnPlatform: boolean): void {
    const state = this.action360State;
    this.action360State = null;
    this.player.rotation = 0;
    this.action360Sparks = [];
    if (landOnPlatform && state) {
      const platform = this.platforms.find((p) => p.stairId === state.hookStairId);
      if (platform) {
        this.player.body.x = platform.x + platform.width * 0.5 - this.player.body.width * 0.5;
        this.physics.snapToPlatform(this.player.body, platform);
        this.currentGroundPlatform = platform;
      }
    }
    this.grapple = null;
    this.flashSkillBoostTime = 0;
    this.wasBeastModeActiveLastFrame = false;
    this.syncTouch360Visibility();
  }

  private spawnAction360Sparks(x: number, y: number): void {
    for (let i = 0; i < 3; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 130;
      this.action360Sparks.push({
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 18,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        age: 0,
        life: 0.28 + Math.random() * 0.2,
      });
    }
  }

  private updateAction360Sparks(dt: number): void {
    this.action360Sparks = this.action360Sparks
      .map((s) => ({
        ...s,
        age: s.age + dt,
        x: s.x + s.vx * dt,
        y: s.y + s.vy * dt,
        vx: s.vx * (1 - dt * 2.6),
        vy: s.vy * (1 - dt * 2.6),
      }))
      .filter((s) => s.age < s.life);
    if (this.action360Sparks.length > 180) {
      this.action360Sparks.splice(0, this.action360Sparks.length - 180);
    }
  }

  private drawAction360Sparks(): void {
    for (const s of this.action360Sparks) {
      const u = s.age / s.life;
      const alpha = (1 - u) * 0.95;
      const r = 2 + 4 * (1 - u);
      this.fxLayer.circle(s.x, s.y, r + 2).fill({ color: 0xffaa33, alpha: alpha * 0.25 });
      this.fxLayer.circle(s.x, s.y, r).fill({ color: 0xffe066, alpha });
      this.fxLayer.circle(s.x - 0.9, s.y - 0.9, r * 0.38).fill({ color: 0xffffff, alpha: alpha * 0.8 });
    }
  }

  private syncTouch360Visibility(): void {
    // Full-screen touch mode: 360 on-screen button is hidden/disabled.
  }

  private checkFallGameOver(): void {
    const feetY = this.player.body.y + this.player.body.height;
    const deathLine = this.cameraY + this.worldHeightFromScreen() + STAIRS.fallDeathBelowViewportPx;
    if (feetY > deathLine) {
      this.resetRun();
    }
  }

  private resetPlayer(): void {
    const spawnX = this.worldWidth * 0.5 - this.player.body.width * 0.5;
    const spawnY = this.worldMaxY - 100 - this.player.body.height;
    this.player.body.x = Math.round(spawnX);
    this.player.body.y = Math.round(spawnY);
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.body.grounded = true;
    this.grapple = null;
    this.grappleCooldown = 0;
    this.grappleReleaseDampingLeft = 0;
    this.grappleReloadingLogged = false;
    this.autoTongueAfterJumpArmed = false;
    this.autoTongueJumpFromStairId = -1;
    this.lastScoredStairId = this.platforms[0]?.stairId ?? 0;
    this.player.update(0, 0, false, null, false);
  }

  private landOn(platform: Platform): void {
    this.ripples.push({
      x: this.player.body.x + this.player.body.width / 2,
      y: platform.y + 46,
      age: 0,
    });
  }

  private updateCamera(_dt: number): void {
    this.highestY = Math.min(this.highestY, this.player.body.y);

    const viewportW = this.worldWidthFromScreen();
    const viewportH = this.worldHeightFromScreen();
    const halfW = Math.max(0, viewportW * 0.5);
    const halfH = Math.max(0, viewportH * 0.5);
    const deadX = Math.min(CAMERA_DEADZONE_PX, Math.max(20, halfW - 12));
    const deadY = Math.min(CAMERA_DEADZONE_PX, Math.max(20, halfH - 12));

    const playerCx = this.player.body.x + this.player.body.width * 0.5;
    const playerCy = this.player.body.y + this.player.body.height * 0.5;
    const left = this.cameraX + deadX;
    const right = this.cameraX + viewportW - deadX;
    const top = this.cameraY + deadY;
    const bottom = this.cameraY + viewportH - deadY;

    let targetCamX = this.cameraX;
    let targetCamY = this.cameraY;
    if (playerCx < left) {
      targetCamX = playerCx - deadX;
    } else if (playerCx > right) {
      targetCamX = playerCx - (viewportW - deadX);
    }
    if (playerCy < top) {
      targetCamY = playerCy - deadY;
    } else if (playerCy > bottom) {
      targetCamY = playerCy - (viewportH - deadY);
    }

    // Lock follow so one stair line stays below the player.
    const desiredPlayerScreenY = viewportH - STAIRS.stepPx * CAMERA_STAIRS_BELOW_PLAYER;
    const desiredCamY = playerCy - desiredPlayerScreenY;
    targetCamY = Math.min(targetCamY, desiredCamY);

    this.cameraX += (targetCamX - this.cameraX) * CAMERA_FOLLOW_LERP_X;
    const movingUp = targetCamY < this.cameraY;
    const yLerp = movingUp ? CAMERA_FOLLOW_LERP_Y * CAMERA_UPWARD_FOLLOW_BOOST : CAMERA_FOLLOW_LERP_Y;
    this.cameraY += (targetCamY - this.cameraY) * Math.min(1, yLerp);
    const maxCamX = Math.max(0, this.worldWidth - viewportW);
    this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamX));
    this.cameraY = Math.min(0, this.cameraY);

    this.world.position.set(-this.cameraX, -this.cameraY);
    this.background.tilePosition.set(
      -this.cameraX * BACKGROUND_PARALLAX_X,
      -this.cameraY * BACKGROUND_PARALLAX_Y,
    );
  }

  private snapCameraToPlayer(): void {
    const viewportW = this.worldWidthFromScreen();
    const viewportH = this.worldHeightFromScreen();
    const playerCx = this.player.body.x + this.player.body.width * 0.5;
    this.cameraX = playerCx - viewportW * 0.5;
    const maxCamX = Math.max(0, this.worldWidth - viewportW);
    this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamX));
    const playerCy = this.player.body.y + this.player.body.height * 0.5;
    const desiredPlayerScreenY = viewportH - STAIRS.stepPx * CAMERA_STAIRS_BELOW_PLAYER;
    this.cameraY = playerCy - desiredPlayerScreenY;
    this.cameraY = Math.min(0, this.cameraY);
    this.cameraY = Math.max(this.worldMinY, this.cameraY);
    this.world.position.set(-this.cameraX, -this.cameraY);
    this.background.tilePosition.set(
      -this.cameraX * BACKGROUND_PARALLAX_X,
      -this.cameraY * BACKGROUND_PARALLAX_Y,
    );
  }


  private updateScreenShake(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / SCORE_UI.shakeDurationSec);
      const mag = SCORE_UI.shakeMaxPx * k;
      this.shakeOffsetX = (Math.random() - 0.5) * 2 * mag;
      this.shakeOffsetY = (Math.random() - 0.5) * 2 * mag;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
    this.applyCameraTransform();
  }

  private maybeTriggerScreenShake(pointsDelta: number, mult: number): void {
    if (
      pointsDelta >= SCORE_UI.bigPointsThreshold ||
      (pointsDelta >= SCORE_UI.shakePointsFloor && mult >= SCORE_UI.shakeMinMultForFloor)
    ) {
      this.shakeTime = Math.max(this.shakeTime, SCORE_UI.shakeDurationSec);
    }
  }

  private updateRipples(dt: number): void {
    this.ripples = this.ripples
      .map((ripple) => ({ ...ripple, age: ripple.age + dt }))
      .filter((ripple) => ripple.age < 0.8);
  }

  private expireComboIfNeeded(): void {
    if (
      this.comboChain > 0 &&
      this.runTime - this.lastChainTime > COMBO.chainWindowSec
    ) {
      this.comboChain = 0;
    }
  }

  private getComboMultiplier(): number {
    if (this.comboChain <= 0) {
      return 1;
    }

    return Math.min(COMBO.maxMultiplier, this.comboChain);
  }

  private feedComboFromLand(): void {
    this.comboChain += 1;
    this.lastChainTime = this.runTime;
  }

  private feedComboFromGrapple(
    grappleGain: number,
    peakBonus: boolean,
    launchSpeed: number,
  ): void {
    let add = 1 + Math.max(0, grappleGain - 1);
    if (peakBonus && launchSpeed >= COMBO.highLaunchSpeedPx) {
      add += 1;
    }

    this.comboChain += add;
    this.lastChainTime = this.runTime;
  }

  private maybeSpawnComboPopup(mult: number): void {
    if (mult < 2) {
      return;
    }

    if (mult === SCORE_UI.apexComboMultiplier) {
      this.scoreboard?.triggerApexBurst();
    }

    if (mult >= COMBO.beastModeMinMultiplier) {
      this.scoreboard?.triggerBeastBurst();
    }

    const wordIndex = Math.min(
      COMBO.words.length - 1,
      Math.max(0, mult - 2),
    );
    this.spawnComboPopup(COMBO.words[wordIndex]);
  }

  private spawnComboPopup(text: string): void {
    const wx = this.player.body.x + this.player.body.width * 0.5;
    const wy = this.player.body.y + this.player.body.height * 0.4;
    const label = new Text({
      text,
      style: {
        fill: '#fff5e6',
        fontFamily: 'Arial Black, Impact, sans-serif',
        fontSize: 28,
        stroke: { color: '#4a1530', width: 5 },
        dropShadow: {
          alpha: 0.55,
          angle: Math.PI / 4,
          blur: 4,
          color: '#ff2288',
          distance: 3,
        },
      },
    });
    label.anchor.set(0.5);
    label.position.set(wx, wy);
    label.scale.set(0.35);
    label.alpha = 1;
    this.world.addChild(label);
    this.comboPopups.push({ label, t: 0, wx, wy });
  }

  private updateComboPopups(dt: number): void {
    const life = COMBO.floatLifeSec;
    const next: ComboPopup[] = [];

    for (const p of this.comboPopups) {
      p.t += dt;
      const u = p.t / life;
      if (u >= 1) {
        p.label.destroy();
        continue;
      }

      const popT = Math.min(1, p.t / COMBO.popInSec);
      const popScale = 0.4 + 0.8 * Math.sin((popT * Math.PI) / 2);
      const drift = COMBO.floatDriftPxPerSec * p.t;
      p.label.position.set(p.wx, p.wy - drift);
      p.label.alpha = 1 - u * u;
      p.label.scale.set(popScale * (1 - 0.12 * u));

      next.push(p);
    }

    this.comboPopups = next;
  }

  private updateBeastParticles(dt: number): void {
    const beast = this.isFlashSkillBoostActive();
    const spd = Math.hypot(this.player.body.vx, this.player.body.vy);

    if (beast && spd >= COMBO.beastParticleMinSpeed) {
      this.beastParticleSpawnAcc += dt;
      while (this.beastParticleSpawnAcc >= COMBO.beastParticleSpawnIntervalSec) {
        this.beastParticleSpawnAcc -= COMBO.beastParticleSpawnIntervalSec;
        const px =
          this.player.body.x +
          this.player.body.width * 0.5 +
          (Math.random() - 0.5) * 36;
        const py =
          this.player.body.y +
          this.player.body.height * 0.5 +
          (Math.random() - 0.5) * 28;
        this.beastParticles.push({ x: px, y: py, age: 0 });
      }
    } else {
      this.beastParticleSpawnAcc = 0;
    }

    this.beastParticles = this.beastParticles
      .map((p) => ({ ...p, age: p.age + dt }))
      .filter((p) => p.age < COMBO.beastParticleLifeSec);

    if (this.beastParticles.length > 40) {
      this.beastParticles.splice(0, this.beastParticles.length - 40);
    }
  }

  private clearFloatingComboUi(): void {
    for (const p of this.comboPopups) {
      p.label.destroy();
    }

    this.comboPopups = [];
  }

  private startBackgroundMusic(): void {
    this.stopBackgroundMusic();
    const bgm = new Audio(`${GAME_ASSETS}/music.mp3`);
    bgm.loop = true;
    bgm.volume = 0.2;
    this.bgm = bgm;
    void bgm.play().catch(() => {
      /* autoplay: may need user gesture */
    });
  }

  private stopBackgroundMusic(): void {
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.removeAttribute('src');
      this.bgm.load();
    }
    this.bgm = undefined;
  }

  private async tryLoadTongueArmature(): Promise<void> {
    this.tongueDbReady = false;
    this.tongueArmature?.dispose(true);
    this.tongueArmature = null;
    try {
      const [skeRes, texJsonRes] = await Promise.all([
        fetch(TONGUE_DB_SKE),
        fetch(TONGUE_DB_TEX_JSON),
      ]);
      if (!skeRes.ok || !texJsonRes.ok) {
        return;
      }
      const ske = (await skeRes.json()) as { armature?: Array<{ name?: string }> };
      const texJson = await texJsonRes.json();
      const tex = await Assets.load<Texture>(TONGUE_DB_TEX_PNG);
      const factory = PixiFactory.factory;
      factory.parseDragonBonesData(ske, 'tongue');
      factory.parseTextureAtlasData(texJson, tex, 'tongue');
      const armName = ske.armature?.[0]?.name ?? 'Armature';
      const display = factory.buildArmatureDisplay(armName, 'tongue');
      if (!display) {
        return;
      }
      display.eventMode = 'none';
      display.visible = false;
      display.animation.play(null, 0);
      this.tongueRoot.addChild(display);
      this.tongueArmature = display;
      this.tongueDbReady = true;
    } catch {
      this.tongueDbReady = false;
    }
  }

  private syncTongueArmatureToGrapple(
    mouth: { x: number; y: number },
    tip: { x: number; y: number },
    _beastMode: boolean,
  ): void {
    const arm = this.tongueArmature;
    if (!arm || !this.tongueDbReady) {
      return;
    }
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      arm.visible = false;
      return;
    }
    arm.visible = true;
    arm.position.set(mouth.x, mouth.y);
    arm.rotation = Math.atan2(dy, dx) - Math.PI / 2;
    const stretch = (len / TONGUE_DB_REST_LENGTH_PX) * TONGUE_DB_BASE_SCALE;
    arm.scale.set(stretch);
    arm.tint = 0xffffff;
  }

  private spawnDiamondCollectShine(x: number, y: number): void {
    const n = 16;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.55;
      const sp = 160 + Math.random() * 140;
      this.diamondShineSparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.34 + Math.random() * 0.14,
        age: 0,
      });
    }
  }

  private updateDiamondShineSparks(dt: number): void {
    this.diamondShineSparks = this.diamondShineSparks
      .map((s) => ({
        ...s,
        age: s.age + dt,
        x: s.x + s.vx * dt * 0.42,
        y: s.y + s.vy * dt * 0.42,
        vx: s.vx * (1 - dt * 2.8),
        vy: s.vy * (1 - dt * 2.8),
      }))
      .filter((s) => s.age < s.life);
    if (this.diamondShineSparks.length > 120) {
      this.diamondShineSparks.splice(0, this.diamondShineSparks.length - 120);
    }
  }

  private drawDiamondShineSparks(): void {
    for (const s of this.diamondShineSparks) {
      const u = s.age / s.life;
      const alpha = (1 - u) * 0.88;
      const r = 1.8 + 4.2 * (1 - u);
      this.fxLayer.circle(s.x, s.y, r + 2.5).fill({ color: 0x6af0ff, alpha: alpha * 0.22 });
      this.fxLayer.circle(s.x, s.y, r).fill({ color: 0xe8ffff, alpha });
      this.fxLayer.circle(s.x - 0.8, s.y - 0.8, r * 0.35).fill({ color: 0xffffff, alpha: alpha * 0.9 });
    }
  }

  private updateLevelProgress(): void {
    const nextLevel = Math.max(1, Math.min(LEVEL_MAX, 1 + Math.floor(this.score / LEVEL_SCORE_STEP)));
    if (nextLevel <= this.level) {
      return;
    }
    const previousMilestone = Math.floor(this.level / LEVEL_MILESTONE_STEP);
    this.level = nextLevel;
    this.levelUpBannerTime = 1;
    this.spawnLevelUpParticles();
    this.scoreboard?.setLevel(this.level);
    this.scoreboard?.triggerLevelUp();
    const nextMilestone = Math.floor(this.level / LEVEL_MILESTONE_STEP);
    if (nextMilestone > previousMilestone) {
      this.currentBackgroundColor = this.getBackgroundColorForLevel(this.level);
      this.drawStaticWorld();
    }
  }

  private updatePlatformDifficulty(dt: number): void {
    const widthRatio = Math.max(0.5, 1 - this.level * LEVEL_PLATFORM_WIDTH_DECAY_RATIO_PER_LEVEL);
    const edgePad = PLATFORM_EDGE_PADDING_PX;
    for (const p of this.platforms) {
      const targetBaseWidth = Math.max(
        LEVEL_PLATFORM_MIN_BASE_WIDTH,
        p.baseWidth * widthRatio,
      );
      p.width = targetBaseWidth * PLATFORM_SCALE;
      p.driftVx = 0;
      if (p.x < edgePad) {
        p.x = edgePad;
      } else if (p.x + p.width > this.worldWidth - edgePad) {
        p.x = this.worldWidth - edgePad - p.width;
      }
      this.updatePlatformBodyFromScale(p);
    }
  }

  private getGravityScaleForLevel(): number {
    const gravityTier = Math.floor(this.level / 10);
    return 1 + gravityTier * 0.02;
  }

  private spawnLevelUpParticles(): void {
    const cx = this.player.body.x + this.player.body.width * 0.5;
    const cy = this.player.body.y + this.player.body.height * 0.5;
    for (let i = 0; i < 22; i += 1) {
      const a = (i / 22) * Math.PI * 2;
      const speed = 110 + Math.random() * 170;
      this.levelUpParticles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 60,
        age: 0,
        life: 0.5 + Math.random() * 0.3,
      });
    }
  }

  private updateLevelUpParticles(dt: number): void {
    if (this.levelUpBannerTime > 0) {
      this.levelUpBannerTime = Math.max(0, this.levelUpBannerTime - dt);
    }
    this.levelUpParticles = this.levelUpParticles
      .map((p) => ({
        ...p,
        age: p.age + dt,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
        vy: p.vy + 420 * dt,
      }))
      .filter((p) => p.age < p.life);
    if (!this.levelUpFloatText) {
      return;
    }
    if (this.levelUpBannerTime <= 0) {
      this.levelUpFloatText.visible = false;
      return;
    }
    const u = 1 - this.levelUpBannerTime;
    this.levelUpFloatText.visible = true;
    this.levelUpFloatText.position.set(
      this.player.body.x + this.player.body.width * 0.5,
      this.player.body.y - 26 - u * 24,
    );
    this.levelUpFloatText.alpha = (1 - u) * 0.95;
    this.levelUpFloatText.scale.set(0.92 + 0.22 * Math.sin(Math.min(1, u) * Math.PI));
  }

  private drawLevelUpParticles(): void {
    for (const p of this.levelUpParticles) {
      const u = p.age / p.life;
      const alpha = (1 - u) * 0.9;
      const r = 2 + 3 * (1 - u);
      this.fxLayer.circle(p.x, p.y, r).fill({ color: 0xffe066, alpha });
      this.fxLayer.circle(p.x - 1.2, p.y - 1.2, r * 0.45).fill({ color: 0xffffff, alpha: alpha * 0.7 });
    }
  }

  private getBackgroundColorForLevel(level: number): number {
    const palette = [
      0x06060f, 0x101226, 0x1a1130, 0x1c142f, 0x10232f, 0x19301d, 0x2e2b14, 0x2f1f12, 0x2c1527, 0x10103a,
    ];
    const idx = Math.max(0, Math.floor((level - 1) / LEVEL_MILESTONE_STEP)) % palette.length;
    return palette[idx];
  }

  private drawStaticWorld(): void {
    this.background.tint = this.currentBackgroundColor;
    this.background.position.set(
      WORLD_BOUNDS_X - BACKGROUND_HORIZONTAL_PAD_PX,
      this.worldMinY - BACKGROUND_VERTICAL_PAD_PX,
    );
    this.background.width = this.worldWidth + BACKGROUND_HORIZONTAL_PAD_PX * 2;
    this.background.height = this.worldHeight + BACKGROUND_VERTICAL_PAD_PX * 2;
  }

  private drawDynamicWorld(): void {
    this.jelly.clear();
    this.platformLayer.clear();
    this.rippleLayer.clear();
    this.collectiblesGfx.clear();
    this.tongueVector.clear();
    this.fxLayer.clear();

    if (this.tongueArmature && this.tongueDbReady) {
      this.tongueArmature.visible = false;
    }

    for (const ripple of this.ripples) {
      const radius = 28 + ripple.age * 130;
      const alpha = 1 - ripple.age / 0.8;
      this.rippleLayer
        .ellipse(ripple.x, ripple.y, radius, radius * 0.28)
        .stroke({ color: 0x8b5cff, alpha: alpha * 0.12, width: 1 });
    }

    for (const platform of this.platforms) {
      this.drawCrystalPlatform(platform);
    }

    const grappleProgress = Player.computeGrappleAnimProgress(this.grapple, GRAPPLE.extendSec);
    const drawProceduralTongue =
      !!this.grapple &&
      (this.grapple.phase === 'pull' || grappleProgress < GRAPPLE.proceduralTongueUntil);
    if (drawProceduralTongue) {
      const mouth = this.getMouthWorld();
      const tip = this.getTongueTipWorld(mouth);
      const beastMode = this.getComboMultiplier() >= COMBO.beastModeMinMultiplier;
      if (this.tongueDbReady && this.tongueArmature) {
        this.syncTongueArmatureToGrapple(mouth, tip, beastMode);
      } else {
        this.drawGrappleTongue(mouth, tip, beastMode);
      }
    }

    this.drawCollectibles();
    this.drawDiamondShineSparks();
    this.drawAction360Sparks();
    this.drawLevelUpParticles();

    for (const p of this.beastParticles) {
      const u = p.age / COMBO.beastParticleLifeSec;
      const alpha = (1 - u) * 0.5;
      const r = 6 + 10 * (1 - u);
      this.fxLayer.circle(p.x, p.y, r).fill({ color: 0xff9933, alpha });
      this.fxLayer.circle(p.x - 2, p.y - 2, r * 0.45).fill({ color: 0xffeeaa, alpha: alpha * 0.9 });
    }
  }

  private getMouthWorld(): { x: number; y: number } {
    const b = this.player.body;
    const cx = b.x + b.width * 0.5;
    const cy = b.y + b.height * 0.5;
    const grappleVerticalX = this.grapple ? cx : cx + this.player.direction * GRAPPLE.mouthOffsetX;
    return {
      x: grappleVerticalX,
      y: cy + GRAPPLE.mouthOffsetY,
    };
  }

  private getTongueTipWorld(mouth: { x: number; y: number }): { x: number; y: number } {
    if (!this.grapple) {
      return mouth;
    }

    if (this.grapple.phase === 'extend') {
      const t = Math.min(1, this.grapple.extendT / GRAPPLE.extendSec);
      return {
        x: mouth.x + (this.grapple.targetX - mouth.x) * t,
        y: mouth.y + (this.grapple.targetY - mouth.y) * t,
      };
    }

    return { x: this.grapple.targetX, y: this.grapple.targetY };
  }

  private setupCollectibleHud(app: Application): void {
    this.collectibleHudGoldText = new Text({
      text: 'Gold     0',
      style: new TextStyle({
        fontFamily: 'system-ui, Segoe UI, sans-serif',
        fontSize: 13,
        fill: '#ffd24a',
        stroke: { color: '#1a1020', width: 3 },
      }),
    });
    this.collectibleHudDiamondText = new Text({
      text: 'Diamonds 0',
      style: new TextStyle({
        fontFamily: 'system-ui, Segoe UI, sans-serif',
        fontSize: 13,
        fill: '#9df6ff',
        stroke: { color: '#1a1020', width: 3 },
      }),
    });
    this.collectibleHudRoot.addChild(
      this.collectibleHudBg,
      this.collectibleHudGoldText,
      this.collectibleHudDiamondText,
    );
    this.uiLayer.addChild(this.collectibleHudRoot);
  }

  private setupTouchControlsOverlay(app: Application): void {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    // Full-screen touch + swipe; on-screen JUMP/TONGUE buttons removed for now.
    this.touchControlsLayer.eventMode = 'passive';
    this.touchControlsLayer.sortableChildren = true;
    this.touchControlsLayer.zIndex = 999;
    this.touchFeedbackLayer.eventMode = 'none';
    this.touchControlsLayer.addChild(this.touchFeedbackLayer);
    this.uiLayer.addChild(this.touchControlsLayer);
    app.stage.on('pointerdown', this.handleTouchPointerDown);
    app.stage.on('pointermove', this.handleTouchPointerMove);
    app.stage.on('pointerup', this.handleTouchPointerUpOrCancel);
    app.stage.on('pointerupoutside', this.handleTouchPointerUpOrCancel);
    app.stage.on('pointercancel', this.handleTouchPointerUpOrCancel);
  }

  private readonly handleTouchPointerDown = (event: FederatedPointerEvent): void => {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    if (this.touchPointers.has(pointerId)) {
      return;
    }
    const side = event.global.x < this.width * 0.5 ? 'left' : 'right';
    this.touchPointers.set(pointerId, {
      side,
      startX: event.global.x,
      startY: event.global.y,
      lastX: event.global.x,
      lastY: event.global.y,
      swipeBaselineY: event.global.y,
      swipeBaselineX: event.global.x,
      startMs: performance.now(),
      swipeHandled: false,
    });
    if (this.touchControlPointerId === null && this.isTouchNearChameleon(event.global.x, event.global.y)) {
      this.touchControlPointerId = pointerId;
    }
    this.spawnTouchRipple(event.global.x, event.global.y, 0.26);
  };

  private readonly handleTouchPointerMove = (event: FederatedPointerEvent): void => {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    const p = this.touchPointers.get(event.pointerId);
    if (!p) {
      return;
    }
    p.lastX = event.global.x;
    p.lastY = event.global.y;
    p.side = p.lastX < this.width * 0.5 ? 'left' : 'right';
    if (this.touchControlPointerId === null && this.isTouchNearChameleon(p.lastX, p.lastY)) {
      this.touchControlPointerId = event.pointerId;
    }
    this.tryHandleSwipeUp(event.pointerId, false);
  };

  private readonly handleTouchPointerUpOrCancel = (event: FederatedPointerEvent): void => {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    this.tryHandleSwipeUp(event.pointerId, true);
    this.touchPointers.delete(event.pointerId);
    if (this.touchControlPointerId === event.pointerId) {
      this.touchControlPointerId = null;
      this.input?.setTouchFollowAxis(0);
    }
  };

  private applyTouchHoldState(): void {
    // Drag-locked mode: movement is driven by relative drag axis.
    this.input?.setTouchHoldLeft(false);
    this.input?.setTouchHoldRight(false);
  }

  private updateTouchFollowAxis(): void {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    if (this.touchControlPointerId === null) {
      this.input.setTouchFollowAxis(0);
      return;
    }
    const touch = this.touchPointers.get(this.touchControlPointerId);
    if (!touch) {
      this.touchControlPointerId = null;
      this.input.setTouchFollowAxis(0);
      return;
    }
    const zoom = this.getCameraZoom();
    const padX = 0;
    const playerCx = this.player.body.x + this.player.body.width * 0.5;
    const playerScreenX = (playerCx - this.cameraX) * zoom + padX;
    const fingerDeltaX = touch.lastX - playerScreenX;
    let axis = fingerDeltaX / TOUCH_FOLLOW_DISTANCE_PX;
    if (Math.abs(fingerDeltaX) < 5) {
      axis = 0;
    }
    this.input.setTouchFollowAxis(Math.max(-1, Math.min(1, axis)));
  }

  private tryHandleSwipeUp(pointerId: number, finalize: boolean): void {
    const p = this.touchPointers.get(pointerId);
    if (!p) {
      return;
    }
    // Re-arm upward swipe while finger stays down: moving down refreshes baseline.
    p.swipeBaselineY = Math.max(p.swipeBaselineY, p.lastY);
    if (p.lastY > p.swipeBaselineY) {
      p.swipeBaselineX = p.lastX;
      p.swipeBaselineY = p.lastY;
    }
    const vecX = p.lastX - p.swipeBaselineX;
    const vecY = p.lastY - p.swipeBaselineY;
    const swipeDist = Math.hypot(vecX, vecY);
    const upwardRatio = swipeDist > 1e-5 ? (-vecY / swipeDist) : 0;
    void finalize;
    if (
      swipeDist >= TOUCH_SWIPE_JUMP_MIN_DISTANCE_PX &&
      upwardRatio >= TOUCH_SWIPE_UPWARD_RATIO_MIN &&
      -vecY >= TOUCH_SWIPE_UP_MIN_PX
    ) {
      const now = performance.now();
      const isControlTouch = pointerId === this.touchControlPointerId;
      const zoom = this.getCameraZoom();
      const playerCx = this.player.body.x + this.player.body.width * 0.5;
      const playerScreenX = (playerCx - this.cameraX) * zoom;
      const swipeOnLeft = p.lastX < playerScreenX;
      if (isControlTouch) {
        if (now - this.touchLastJumpMs >= TOUCH_ACTION_RETRIGGER_MS) {
          this.touchLastJumpMs = now;
          this.input?.queueJump();
        }
      } else if (swipeOnLeft) {
        if (now - this.touchLastGrappleMs >= TOUCH_ACTION_RETRIGGER_MS) {
          this.touchLastGrappleMs = now;
          this.input?.queueGrapple();
        }
      } else if (now - this.touchLastJumpMs >= TOUCH_ACTION_RETRIGGER_MS) {
        this.touchLastJumpMs = now;
        this.input?.queueJump();
      }
      p.swipeBaselineX = p.lastX;
      p.swipeBaselineY = p.lastY;
      this.spawnTouchRipple(p.lastX, p.lastY, 0.34);
    }
  }

  private isTouchNearChameleon(screenX: number, screenY: number): boolean {
    const zoom = this.getCameraZoom();
    const padX = 0;
    const padY = 0;
    const playerLeft = (this.player.body.x - this.cameraX) * zoom + padX;
    const playerTop = (this.player.body.y - this.cameraY) * zoom + padY;
    const playerW = Math.max(1, this.player.body.width * zoom);
    const playerH = Math.max(1, this.player.body.height * zoom);
    const margin = Math.max(TOUCH_LOCK_RADIUS_PX * 0.28, Math.min(playerW, playerH) * 0.35);
    const left = playerLeft - margin;
    const right = playerLeft + playerW + margin;
    const top = playerTop - margin;
    const bottom = playerTop + playerH + margin;
    return screenX >= left && screenX <= right && screenY >= top && screenY <= bottom;
  }

  private spawnTouchRipple(x: number, y: number, life: number): void {
    this.touchRipples.push({ x, y, age: 0, life });
    if (this.touchRipples.length > 40) {
      this.touchRipples.splice(0, this.touchRipples.length - 40);
    }
  }

  private updateTouchRipples(dt: number): void {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    this.touchRipples = this.touchRipples
      .map((r) => ({ ...r, age: r.age + dt }))
      .filter((r) => r.age < r.life);
    this.touchFeedbackLayer.clear();
    for (const r of this.touchRipples) {
      const u = r.age / r.life;
      const alpha = (1 - u) * 0.28;
      const radius = 10 + 48 * u;
      this.touchFeedbackLayer.circle(r.x, r.y, radius).stroke({
        color: 0xffffff,
        width: 2.2 - u,
        alpha,
      });
      this.touchFeedbackLayer.circle(r.x, r.y, 4 + 10 * (1 - u)).fill({
        color: 0xffffff,
        alpha: alpha * 0.35,
      });
    }
  }

  private layoutCollectibleHud(): void {
    const margin = this.width < 440 ? 16 : 12;
    const topOffset = this.width < 440 ? 86 : 74;
    this.collectibleHudRoot.pivot.set(COLLECTIBLE_HUD_W, 0);
    const x = Math.max(COLLECTIBLE_HUD_W + margin, this.width - margin);
    const y = Math.max(margin, margin + topOffset);
    this.collectibleHudRoot.position.set(x, y);
    this.collectibleHudBg.clear();
    this.collectibleHudBg
      .roundRect(0, 0, COLLECTIBLE_HUD_W, COLLECTIBLE_HUD_H, 10)
      .fill({ color: 0x120818, alpha: 0.74 })
      .stroke({ width: 1, color: 0x4a3a62, alpha: 0.55 });
    this.collectibleHudGoldText?.position.set(12, 10);
    this.collectibleHudDiamondText?.position.set(12, 36);
  }

  private refreshCollectibleHudText(): void {
    if (this.collectibleHudGoldText) {
      this.collectibleHudGoldText.text = `Gold     ${Math.round(this.hudGoldShown)}`;
    }
    if (this.collectibleHudDiamondText) {
      this.collectibleHudDiamondText.text = `Diamonds ${Math.round(this.hudDiamondShown)}`;
    }
  }

  private updateCollectibleHudSmooth(dt: number): void {
    const k = 1 - Math.exp(-13 * dt);
    this.hudGoldShown += (this.goldCount - this.hudGoldShown) * k;
    this.hudDiamondShown += (this.diamondCount - this.hudDiamondShown) * k;
    this.refreshCollectibleHudText();

    if (this.collectibleHudBump > 0) {
      this.collectibleHudBump = Math.max(0, this.collectibleHudBump - dt * 4.5);
      const s = 1 + 0.08 * this.collectibleHudBump;
      this.collectibleHudRoot.scale.set(s);
    } else {
      this.collectibleHudRoot.scale.set(1);
    }
  }

  private getOccupiedActivePlatformIndices(): Set<number> {
    const s = new Set<number>();
    for (const c of this.collectibles) {
      if (c.phase === 'active') {
        s.add(c.platformIdx);
      }
    }
    return s;
  }

  private pickPlatformSpawnSlot(
    r: number,
    occupied: Set<number>,
  ): { platformIdx: number; along: number } | null {
    const candidates: number[] = [];
    const margin = COLLECTIBLES.platformEdgeMarginPx;
    for (let i = 0; i < this.platforms.length; i += 1) {
      if (occupied.has(i)) {
        continue;
      }
      const p = this.platforms[i];
      const innerW = p.width - 2 * margin - 2 * r;
      if (innerW < 4) {
        continue;
      }
      candidates.push(i);
    }
    if (candidates.length === 0) {
      return null;
    }
    const platformIdx = candidates[Math.floor(Math.random() * candidates.length)];
    return { platformIdx, along: Math.random() };
  }

  private getCollectibleAnchor(c: Collectible): { x: number; y: number } | null {
    const p = this.platforms[c.platformIdx];
    if (!p) {
      return null;
    }
    const margin = COLLECTIBLES.platformEdgeMarginPx;
    const innerW = p.width - 2 * margin - 2 * c.r;
    if (innerW < 4) {
      return null;
    }
    const x = p.x + margin + c.r + c.along * innerW;
    const y = p.y - COLLECTIBLES.aboveSurfacePx;
    return { x, y };
  }

  private spawnCollectibleField(): void {
    this.collectibles = [];
    const n = Math.min(COLLECTIBLES.maxActive, this.platforms.length);
    let occupied = this.getOccupiedActivePlatformIndices();
    for (let i = 0; i < n; i += 1) {
      const kind = Math.random() < COLLECTIBLES.diamondSpawnChance ? 'diamond' : 'coin';
      const r = kind === 'coin' ? COLLECTIBLES.coinRadius : COLLECTIBLES.diamondRadius;
      const slot = this.pickPlatformSpawnSlot(r, occupied);
      if (!slot) {
        break;
      }
      occupied = new Set(occupied);
      occupied.add(slot.platformIdx);
      this.collectibles.push({
        kind,
        platformIdx: slot.platformIdx,
        along: slot.along,
        r,
        phase: 'active',
        collectT: 0,
        collectStartX: 0,
        collectStartY: 0,
      });
    }
  }

  private distPointToSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): number {
    const abx = bx - ax;
    const aby = by - ay;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq < 1e-6) {
      return Math.hypot(px - ax, py - ay);
    }
    const apx = px - ax;
    const apy = py - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
    const qx = ax + t * abx;
    const qy = ay + t * aby;
    return Math.hypot(px - qx, py - qy);
  }

  private getTongueHitHalfWidth(): number {
    return Math.max(GRAPPLE.tongueOutlineWidth, GRAPPLE.tongueWidth) * 0.5 + 6;
  }

  private circleHitsTongue(cx: number, cy: number, r: number): boolean {
    if (!this.grapple) {
      return false;
    }
    const grappleProgress = Player.computeGrappleAnimProgress(this.grapple, GRAPPLE.extendSec);
    const tongueOut =
      this.grapple.phase === 'pull' || grappleProgress < GRAPPLE.proceduralTongueUntil;
    if (!tongueOut) {
      return false;
    }
    const mouth = this.getMouthWorld();
    const tip = this.getTongueTipWorld(mouth);
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return false;
    }
    const nx = (-dy / len) * 16;
    const ny = (dx / len) * 16;
    const mx = (mouth.x + tip.x) * 0.5 + nx;
    const my = (mouth.y + tip.y) * 0.5 + ny;
    const half = this.getTongueHitHalfWidth() + r;
    const d = Math.min(
      this.distPointToSegment(cx, cy, mouth.x, mouth.y, mx, my),
      this.distPointToSegment(cx, cy, mx, my, tip.x, tip.y),
    );
    return d <= half;
  }

  private circleHitsPlayerBody(cx: number, cy: number, r: number): boolean {
    const b = this.player.body;
    const tx = Math.max(b.x, Math.min(cx, b.x + b.width));
    const ty = Math.max(b.y, Math.min(cy, b.y + b.height));
    const dx = cx - tx;
    const dy = cy - ty;
    return dx * dx + dy * dy < r * r;
  }

  private tryPickupCollectible(c: Collectible): void {
    if (c.phase !== 'active') {
      return;
    }
    const pos = this.getCollectibleAnchor(c);
    if (!pos) {
      return;
    }
    const hit =
      this.circleHitsPlayerBody(pos.x, pos.y, c.r) ||
      this.circleHitsTongue(pos.x, pos.y, c.r);
    if (!hit) {
      return;
    }
    const add = c.kind === 'coin' ? COLLECTIBLES.coinPoints : COLLECTIBLES.diamondPoints;
    this.score += add * this.getScoreGainMultiplier();
    this.scoreboard?.onPointsGained(add);
    if (c.kind === 'coin') {
      this.goldCount += 1;
      this.sfx.play('collect_coin', 0.9);
    } else {
      this.diamondCount += 1;
      this.sfx.play('collect_diamond', 0.92);
      this.spawnDiamondCollectShine(pos.x, pos.y);
    }
    this.collectibleHudBump = 1;
    c.phase = 'collecting';
    c.collectT = 0;
    c.collectStartX = pos.x;
    c.collectStartY = pos.y;
  }

  private respawnCollectible(c: Collectible): void {
    const kind = Math.random() < COLLECTIBLES.diamondSpawnChance ? 'diamond' : 'coin';
    c.kind = kind;
    c.r = kind === 'coin' ? COLLECTIBLES.coinRadius : COLLECTIBLES.diamondRadius;
    c.phase = 'active';
    c.collectT = 0;
    const occupied = this.getOccupiedActivePlatformIndices();
    const slot = this.pickPlatformSpawnSlot(c.r, occupied);
    if (slot) {
      c.platformIdx = slot.platformIdx;
      c.along = slot.along;
    } else {
      c.platformIdx = Math.floor(Math.random() * this.platforms.length);
      c.along = Math.random();
    }
  }

  private updateCollectibles(dt: number): void {
    const dur = Math.max(1e-6, COLLECTIBLES.collectDurationSec);
    for (const c of this.collectibles) {
      if (c.phase === 'collecting') {
        c.collectT = Math.min(1, c.collectT + dt / dur);
        if (c.collectT >= 1) {
          this.respawnCollectible(c);
        }
        continue;
      }
      this.tryPickupCollectible(c);
    }
  }

  private drawCollectibles(): void {
    const t = this.runTime;
    for (const c of this.collectibles) {
      let cx: number;
      let cy: number;
      let alphaMul = 1;

      if (c.phase === 'collecting') {
        const u = c.collectT;
        const ease = 1 - (1 - u) * (1 - u);
        cx = c.collectStartX;
        cy = c.collectStartY - COLLECTIBLES.collectRisePx * ease;
        alphaMul = 1 - u;
      } else {
        const anchor = this.getCollectibleAnchor(c);
        if (!anchor) {
          continue;
        }
        const bob =
          Math.sin(t * Math.PI * 2 * COLLECTIBLES.bobHz + c.platformIdx * 0.71 + c.along * 3.1) *
          COLLECTIBLES.bobAmplitudePx;
        cx = anchor.x;
        cy = anchor.y + bob;
      }

      const baseR = c.r;

      if (c.kind === 'coin') {
        const spin01 =
          (Math.cos(t * Math.PI * 2 * COLLECTIBLES.coinSpinHz + c.along * 4.2) + 1) * 0.5;
        const scaleX = COLLECTIBLES.coinMinScaleX + (1 - COLLECTIBLES.coinMinScaleX) * spin01;
        const rx = baseR * scaleX;
        const ry = baseR;
        const go = COLLECTIBLES.glowOuterPx;
        const gm = COLLECTIBLES.glowMidPx;
        this.collectiblesGfx
          .ellipse(cx, cy, rx + go, ry + go)
          .fill({ color: 0xffaa33, alpha: 0.1 * alphaMul });
        this.collectiblesGfx
          .ellipse(cx, cy, rx + gm, ry + gm)
          .fill({ color: 0xffcc55, alpha: 0.2 * alphaMul });
        this.collectiblesGfx
          .ellipse(cx, cy, rx, ry)
          .fill({ color: 0xffd24a, alpha: alphaMul })
          .stroke({ width: 2.2, color: 0xaa7010, alpha: alphaMul * 0.95 });
        this.collectiblesGfx
          .ellipse(cx - rx * 0.32, cy - ry * 0.22, rx * 0.38, ry * 0.24)
          .fill({ color: 0xfff2a0, alpha: alphaMul * 0.65 });
      } else {
        const pulse = Math.sin(t * Math.PI * 2 * COLLECTIBLES.diamondPulseHz + c.platformIdx * 0.45);
        const pulse01 = (pulse + 1) * 0.5;
        const scale = 1 + COLLECTIBLES.diamondPulseScale * pulse;
        let collectBurst = 1;
        if (c.phase === 'collecting') {
          const u = c.collectT;
          collectBurst = 1 + 0.62 * Math.sin(Math.min(1, u / 0.22) * Math.PI * 0.92);
        }
        const diamondAlpha =
          COLLECTIBLES.diamondAlphaMin +
          (COLLECTIBLES.diamondAlphaMax - COLLECTIBLES.diamondAlphaMin) * pulse01;
        const alpha = diamondAlpha * alphaMul;
        const s = baseR * 1.05 * scale * collectBurst;
        const go = COLLECTIBLES.glowOuterPx;
        const gm = COLLECTIBLES.glowMidPx;

        this.collectiblesGfx
          .moveTo(cx, cy - s - go * 0.65)
          .lineTo(cx + (s + go) * 0.92, cy)
          .lineTo(cx, cy + s + go * 0.65)
          .lineTo(cx - (s + go) * 0.92, cy)
          .lineTo(cx, cy - s - go * 0.65)
          .fill({ color: 0x44eeff, alpha: alpha * 0.12 });

        this.collectiblesGfx
          .moveTo(cx, cy - s - gm * 0.45)
          .lineTo(cx + (s + gm) * 0.92, cy)
          .lineTo(cx, cy + s + gm * 0.45)
          .lineTo(cx - (s + gm) * 0.92, cy)
          .lineTo(cx, cy - s - gm * 0.45)
          .fill({ color: 0x7af0ff, alpha: alpha * 0.28 });

        this.collectiblesGfx
          .moveTo(cx, cy - s)
          .lineTo(cx + s * 0.92, cy)
          .lineTo(cx, cy + s)
          .lineTo(cx - s * 0.92, cy)
          .lineTo(cx, cy - s)
          .fill({ color: 0x7af0ff, alpha })
          .stroke({ width: 2.2, color: 0x208899, alpha: alpha * 0.95 });

        const hx = pulse01;
        this.collectiblesGfx
          .moveTo(cx - s * 0.15, cy - s * 0.72)
          .lineTo(cx + s * 0.35 * hx, cy - s * 0.35)
          .lineTo(cx + s * 0.12, cy - s * 0.05)
          .lineTo(cx - s * 0.22, cy - s * 0.5)
          .lineTo(cx - s * 0.15, cy - s * 0.72)
          .fill({ color: 0xe8ffff, alpha: alpha * 0.55 * hx });
      }
    }
  }

  private drawGrappleTongue(
    mouth: { x: number; y: number },
    tip: { x: number; y: number },
    beastMode: boolean,
  ): void {
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return;
    }

    const progress = Player.computeGrappleAnimProgress(this.grapple, GRAPPLE.extendSec);
    const wave = Math.sin(this.runTime * 18) * 0.45 + Math.cos(this.runTime * 11) * 0.2;
    const points = this.buildPaintedTongueSpine(mouth, tip, wave);
    const left: Array<{ x: number; y: number }> = [];
    const right: Array<{ x: number; y: number }> = [];
    const maxIndex = Math.max(1, points.length - 1);

    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const next = i < maxIndex ? points[i + 1] : points[i - 1];
      const tx = next.x - p.x;
      const ty = next.y - p.y;
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;
      const u = i / maxIndex;
      const tipBlob = Math.pow(Math.min(1, u * 1.2), 2) * 16;
      const body = Math.sin(u * Math.PI) * 12;
      const rootTaper = Math.max(0.16, u);
      const w = (tipBlob + body + 4) * rootTaper * (0.85 + progress * 0.15);
      left.push({ x: p.x + nx * w, y: p.y + ny * w });
      right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }

    const baseFill = 0xe85a76;
    const shadowFill = 0x621426;
    const rimColor = 0xa02240;
    const highlight = 0xffd8e4;

    this.tongueVector
      .moveTo(left[0].x + 3, left[0].y + 4)
      .poly([...left.slice(1), ...right.slice().reverse()].map((p) => [p.x + 3, p.y + 4]).flat())
      .fill({ color: shadowFill, alpha: 0.28 });

    this.tongueVector
      .moveTo(left[0].x, left[0].y)
      .poly([...left.slice(1), ...right.slice().reverse()].map((p) => [p.x, p.y]).flat())
      .fill({ color: baseFill, alpha: 0.96 })
      .stroke({ width: 1.8, color: rimColor, alpha: 0.9 });

    this.tongueVector
      .moveTo(points[0].x, points[0].y)
      .poly(points.slice(1).map((p) => [p.x, p.y]).flat())
      .stroke({
        width: 2.2,
        color: shadowFill,
        alpha: 0.35,
        cap: 'round',
        join: 'round',
      });

    // glossy highlight strip slightly offset on one side.
    const hlPath: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const next = i < maxIndex ? points[i + 1] : points[i - 1];
      const tx = next.x - p.x;
      const ty = next.y - p.y;
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;
      const u = i / maxIndex;
      const body = Math.sin(u * Math.PI) * 7;
      const off = 4 + body * 0.24;
      hlPath.push(p.x + nx * off, p.y + ny * off);
    }
    this.tongueVector
      .moveTo(hlPath[0], hlPath[1])
      .poly(hlPath.slice(2))
      .stroke({ width: 2.6, color: highlight, alpha: 0.45, cap: 'round', join: 'round' });

    const tipRadius = 11 + progress * 5;
    this.tongueVector
      .circle(tip.x, tip.y, tipRadius)
      .fill({ color: baseFill, alpha: 0.95 })
      .stroke({ width: 1.6, color: rimColor, alpha: 0.85 });
    this.tongueVector.circle(tip.x - tipRadius * 0.28, tip.y - tipRadius * 0.24, tipRadius * 0.32).fill({
      color: highlight,
      alpha: 0.68,
    });
  }

  private buildPaintedTongueSpine(
    mouth: { x: number; y: number },
    tip: { x: number; y: number },
    wave: number,
  ): Array<{ x: number; y: number }> {
    const steps = 44;
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const c1x = mouth.x + ux * len * 0.35 + px * len * 0.12 * Math.cos(wave);
    const c1y = mouth.y + uy * len * 0.35 + py * len * 0.12 * Math.cos(wave);
    const c2x = mouth.x + ux * len * 0.7 - px * len * 0.1 * Math.sin(wave * 0.9);
    const c2y = mouth.y + uy * len * 0.7 - py * len * 0.1 * Math.sin(wave * 0.9);
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const m = 1 - t;
      points.push({
        x: m * m * m * mouth.x + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t * t * t * tip.x,
        y: m * m * m * mouth.y + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t * t * t * tip.y,
      });
    }
    return points;
  }

  private drawCrystalPlatform(platform: Platform): void {
    if (!this.platformTexture) {
      this.platformLayer
        .roundRect(platform.x, platform.y, platform.width, platform.height, 6)
        .fill({ color: 0x8c7ac2, alpha: 0.55 });
    }
  }

  private async loadPlatformSprite(): Promise<void> {
    this.platformTexture = await this.createCheckerTransparentTexture(crystalPlatformUrl);
    try {
      this.platformTextureSlime = await this.createEdgeDarkTransparentTexture(slimePlatformUrl);
    } catch {
      this.platformTextureSlime = undefined;
    }
    try {
      this.platformTextureVolcano = await this.createEdgeDarkTransparentTexture(volcanoPlatformUrl);
    } catch {
      this.platformTextureVolcano = undefined;
    }
    try {
      this.platformTextureStorm = await this.createEdgeDarkTransparentTexture(stormPlatformUrl);
    } catch {
      this.platformTextureStorm = undefined;
    }
  }

  private createPlatformSprites(): void {
    if (!this.platformTexture) {
      return;
    }

    for (const platform of this.platforms) {
      const sprite = new Sprite(this.platformTexture);
      sprite.anchor.set(0.5);
      sprite.roundPixels = RENDER.pixelArt;
      sprite.width = platform.width;
      sprite.scale.y = Math.abs(sprite.scale.x);
      sprite.position.set(platform.x + platform.width / 2, platform.y + platform.height / 2 + 6);
      sprite.alpha = 0.98;
      this.platformSpriteLayer.addChild(sprite);
      this.platformSprites.push(sprite);
    }
  }

  private clearPlatformSprites(): void {
    for (const sprite of this.platformSprites) {
      sprite.destroy();
    }

    this.platformSprites = [];
    this.platformSpriteLayer.removeChildren();
  }

  private async createCheckerTransparentTexture(url: string): Promise<Texture> {
    const sourceTexture = await Assets.load<Texture>(url);
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return sourceTexture;
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    this.removeConnectedCheckerBackground(imageData.data, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    return Texture.from(canvas);
  }

  /** Removes solid black / near-black regions connected to image edges (exported UI art). */
  private async createEdgeDarkTransparentTexture(url: string): Promise<Texture> {
    const fallback = await Assets.load<Texture>(url);
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return fallback;
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    this.removeConnectedDarkEdgeBackground(imageData.data, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    return Texture.from(canvas);
  }

  private removeConnectedDarkEdgeBackground(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];

    const enqueue = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }

      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) {
        return;
      }

      visited[pixelIndex] = 1;

      if (this.isDarkEdgeBackgroundPixel(pixels, pixelIndex)) {
        queue.push(pixelIndex);
      }
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }

    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (queue.length > 0) {
      const pixelIndex = queue.pop() ?? 0;
      pixels[pixelIndex * 4 + 3] = 0;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  private removeConnectedCheckerBackground(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];

    const enqueue = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }

      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) {
        return;
      }

      visited[pixelIndex] = 1;

      if (this.isCheckerBackgroundPixel(pixels, pixelIndex)) {
        queue.push(pixelIndex);
      }
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }

    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (queue.length > 0) {
      const pixelIndex = queue.pop() ?? 0;
      pixels[pixelIndex * 4 + 3] = 0;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  private isDarkEdgeBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
    const dataIndex = pixelIndex * 4;
    const red = pixels[dataIndex];
    const green = pixels[dataIndex + 1];
    const blue = pixels[dataIndex + 2];
    const alpha = pixels[dataIndex + 3];
    if (alpha < 12) {
      return true;
    }

    return Math.max(red, green, blue) <= DARK_BG_MAX_CHANNEL;
  }

  private isCheckerBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
    const dataIndex = pixelIndex * 4;
    const red = pixels[dataIndex];
    const green = pixels[dataIndex + 1];
    const blue = pixels[dataIndex + 2];
    const alpha = pixels[dataIndex + 3];
    const brightness = Math.max(red, green, blue);
    const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);

    return (
      alpha > 0 &&
      brightness > 70 &&
      brightness < 220 &&
      colorSpread <= CHECKER_BACKGROUND_COLOR_SPREAD
    );
  }

  private refreshWorldViewport(): void {
    this.worldWidth = WORLD_BOUNDS_W;
    this.worldHeight = WORLD_BOUNDS_H;
    this.worldMinY = WORLD_BOUNDS_Y;
    this.worldMaxY = WORLD_BOUNDS_Y + WORLD_BOUNDS_H;
  }

  private applyCameraTransform(): void {
    this.gameShake.scale.set(this.getCameraZoom());
    this.gameShake.position.set(this.shakeOffsetX, this.shakeOffsetY);
    this.uiLayer.scale.set(1);
    this.uiLayer.position.set(0, 0);
  }

  private worldWidthFromScreen(): number {
    return this.width / this.getCameraZoom();
  }

  private worldHeightFromScreen(): number {
    return this.height / this.getCameraZoom();
  }

  private getCameraZoom(): number {
    return this.width <= 430 ? MOBILE_CAMERA_ZOOM : CAMERA_ZOOM;
  }
}
