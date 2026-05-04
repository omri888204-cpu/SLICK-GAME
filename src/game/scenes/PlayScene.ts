import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type Ticker,
} from 'pixi.js';
import { PixiFactory, type PixiArmatureDisplay } from 'pixi-dragonbones-runtime';
import { COMBO, COLLECTIBLES, GRAPPLE, SCORE_UI, STAIRS } from '../../config/game.config';
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

const COLLECTIBLE_HUD_W = 184;
const COLLECTIBLE_HUD_H = 78;

export class PlayScene implements Scene {
  readonly name = 'play';

  private app?: Application;
  private input?: InputManager;
  private physics = new Physics();
  private world = new Container();
  private background = new Graphics();
  private jelly = new Graphics();
  private fxLayer = new Graphics();
  private platformSpriteLayer = new Container();
  private platformLayer = new Graphics();
  private rippleLayer = new Graphics();
  private collectiblesGfx = new Graphics();
  private gameShake = new Container();
  private tongueRoot = new Container();
  private tongueVector = new Graphics();
  private tongueArmature: PixiArmatureDisplay | null = null;
  private tongueDbReady = false;
  private player = new Player();
  private scoreboard?: HyperScoreboard;
  private collectibleHudRoot = new Container();
  private collectibleHudBg = new Graphics();
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
  private ripples: Ripple[] = [];
  private width = 0;
  private height = 0;
  private cameraY = 0;
  private highestY = 0;
  private grappleCooldown = 0;
  private grapple: ActiveGrapple | null = null;
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

  async init(app: Application): Promise<void> {
    this.app = app;
    this.width = app.screen.width;
    this.height = app.screen.height;

    await Promise.all([this.loadPlatformSprite(), this.player.load(), this.sfx.load()]);

    app.stage.addChild(this.gameShake);
    this.gameShake.addChild(this.background);
    this.gameShake.addChild(this.world);
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
    this.tongueRoot.addChild(this.tongueVector);

    this.scoreboard = new HyperScoreboard();
    this.scoreboard.position.set(10, 6);
    this.scoreboard.onResize(this.width);
    app.stage.addChild(this.scoreboard);

    this.setupCollectibleHud(app);
    this.layoutCollectibleHud();

    this.input = new InputManager(app);
    this.input.attach();

    await this.tryLoadTongueArmature();
    this.startBackgroundMusic();

    this.resetRun();
    this.drawStaticWorld();
    this.drawDynamicWorld();
  }

  update(ticker: Ticker): void {
    const dt = Math.min(ticker.deltaMS / 1000, 1 / 30);
    this.runTime += dt;
    this.expireComboIfNeeded();
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);

    if (this.grapple?.phase === 'extend') {
      this.grapple.extendT += dt;
      if (this.grapple.extendT >= GRAPPLE.extendSec) {
        this.grapple.phase = 'pull';
        this.sfx.play('tongue_hit', 0.95);
      }
    }

    if (this.grapple?.phase === 'pull') {
      const mouth = this.getMouthWorld();
      const body = this.player.body;
      const dx = this.grapple.targetX - mouth.x;
      const dy = this.grapple.targetY - mouth.y;
      const dist = Math.hypot(dx, dy);
      const len = dist > 1e-3 ? dist : 1;
      const ux = dx / len;
      const uy = dy / len;
      const towardSpeed = body.vx * ux + body.vy * uy;

      const closeDetach = dist < GRAPPLE.detachDistancePx;
      const peakDetach =
        towardSpeed <= GRAPPLE.peakReleaseTowardSpeed &&
        dist >= GRAPPLE.peakReleaseMinDist &&
        dist <= GRAPPLE.peakReleaseMaxDist;

      if (closeDetach || peakDetach) {
        const peakBonus = peakDetach && !closeDetach;
        const vyMul = peakBonus ? GRAPPLE.peakLaunchVyMul : 1;
        const vxMul = peakBonus ? GRAPPLE.peakLaunchVxMul : 1;

        if (towardSpeed > 0 && uy < 0) {
          body.vy -= towardSpeed * GRAPPLE.slingshotUpwardBoost * -uy;
        }

        body.vy += GRAPPLE.launchVy * vyMul;
        const sx = Math.sign(dx) === 0 ? this.player.direction : Math.sign(dx);
        body.vx += sx * GRAPPLE.launchVxBoost * vxMul;
        if (peakBonus) {
          body.vx += body.vx * 0.08;
          body.vy += body.vy * 0.06;
        }

        body.grounded = false;
        this.player.onGrappleLaunch();
        const hookId = this.grapple.hookStairId;
        const grappleGain = Math.max(0, hookId - this.lastScoredStairId);
        if (grappleGain > 0) {
          const launchSpeed = Math.hypot(body.vx, Math.abs(body.vy));
          this.feedComboFromGrapple(grappleGain, peakBonus, launchSpeed);
          const mult = this.getComboMultiplier();
          const delta = grappleGain * mult;
          this.score += delta;
          this.lastScoredStairId = hookId;
          this.maybeSpawnComboPopup(mult);
          this.scoreboard?.onPointsGained(delta);
          this.maybeTriggerScreenShake(delta, mult);
        }
        this.grapple = null;
        this.grappleCooldown = GRAPPLE.cooldownSec;
      }
    }

    const axis = this.input?.getHorizontalAxis() ?? 0;
    const pulling = this.grapple?.phase === 'pull';
    const axisScale = pulling ? GRAPPLE.horizontalInputScaleWhilePulling : 1;

    this.physics.applyHorizontalInput(this.player.body, axis * axisScale, dt);
    this.handleActions();

    const gravityScale = pulling ? GRAPPLE.gravityMultiplierWhilePulling : 1;
    if (pulling && this.grapple) {
      const mouth = this.getMouthWorld();
      this.physics.applyGrappleAcceleration(
        this.player.body,
        this.grapple.targetX,
        this.grapple.targetY,
        mouth.x,
        mouth.y,
        dt,
      );
    }

    const wasGrounded = this.player.body.grounded;
    const result = this.physics.update(
      this.player.body,
      this.platforms,
      this.width,
      dt,
      gravityScale,
    );
    if (result.landedPlatform) {
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
        this.score += delta;
        this.lastScoredStairId = p.stairId;
        this.maybeSpawnComboPopup(mult);
        this.scoreboard?.onPointsGained(delta);
        this.maybeTriggerScreenShake(delta, mult);
      }
      this.landOn(p);
    }

    this.updateCamera(dt);
    this.recycleStairsOffscreen();
    this.syncPlatformSpritesFromPlatforms();
    this.checkFallGameOver();
    this.updateRipples(dt);
    this.updateBeastParticles(dt);
    this.updateComboPopups(dt);
    this.updateDiamondShineSparks(dt);
    this.updateCollectibles(dt);
    this.updateCollectibleHudSmooth(dt);
    const mult = this.getComboMultiplier();
    this.player.update(
      dt,
      axis,
      this.highestY < -650,
      this.grapple,
      mult >= COMBO.beastModeMinMultiplier,
    );
    this.drawDynamicWorld();
    this.updateScreenShake(dt);
    const heightMeters = Math.max(0, Math.floor(-this.highestY / 12));
    this.scoreboard?.update(dt, this.score, mult, heightMeters, this.runTime);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.resetRun();
    this.drawStaticWorld();
    this.drawDynamicWorld();

    if (this.scoreboard) {
      this.scoreboard.onResize(width);
      this.scoreboard.position.set(10, 6);
    }
    this.layoutCollectibleHud();
  }

  destroy(): void {
    this.input?.destroy();
    this.clearPlatformSprites();
    this.clearFloatingComboUi();
    this.scoreboard?.destroy();
    this.collectibleHudRoot.destroy({ children: true });
    this.sfx.dispose();
    this.stopBackgroundMusic();
    this.tongueArmature?.dispose(true);
    this.tongueArmature = null;
    this.tongueDbReady = false;
    this.gameShake.destroy({ children: true });
  }

  private handleActions(): void {
    const wantGrapple = this.input?.consumeGrapple() ?? false;
    if (wantGrapple && this.grappleCooldown <= 0 && !this.grapple) {
      const mouth = this.getMouthWorld();
      const hit = Physics.castGrappleTarget(this.platforms, mouth.x, mouth.y);
      if (hit) {
        this.grapple = {
          phase: 'extend',
          targetX: hit.x,
          targetY: hit.y,
          extendT: 0,
          hookStairId: hit.platform.stairId,
        };
        this.sfx.play('tongue_shoot', 0.88);
      }
    }

    const jumpPressed = this.input?.consumeJump() ?? false;

    if (jumpPressed && this.player.body.grounded && !this.grapple) {
      this.physics.jump(this.player.body);
      this.player.onJump();
    }
  }

  private createPlatforms(): void {
    this.platforms = [];
    this.clearPlatformSprites();
    const baseY = this.height - 96;

    for (let index = 0; index < STAIRS.poolCount; index += 1) {
      const width = 150 + ((index * 37) % 80);
      const x = 48 + ((index * 113) % Math.max(160, this.width - width - 96));
      const y = baseY - index * STAIRS.stepPx;
      this.platforms.push({
        x,
        y,
        width,
        height: STAIRS.platformHeight,
        stairId: index,
      });
    }

    this.nextStairId = STAIRS.poolCount - 1;
    this.createPlatformSprites();
  }

  /**
   * Steps that scroll below visible area move to the top with a new stairId so climbing is endless.
   */
  private recycleStairsOffscreen(): void {
    const cutoff = this.cameraY + this.height + STAIRS.recycleBelowScreenPx;
    const staying = this.platforms.filter((p) => p.y <= cutoff);
    if (staying.length === 0 || staying.length === this.platforms.length) {
      return;
    }

    const toRecycle = this.platforms.filter((p) => p.y > cutoff).sort((a, b) => b.y - a.y);
    let spawnY = Math.min(...staying.map((p) => p.y)) - STAIRS.stepPx;

    for (const p of toRecycle) {
      this.nextStairId += 1;
      p.stairId = this.nextStairId;
      p.y = spawnY;
      p.width = 150 + ((this.nextStairId * 37) % 80);
      p.x = 48 + ((this.nextStairId * 113) % Math.max(160, this.width - p.width - 96));
      spawnY -= STAIRS.stepPx;
    }
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

      sprite.width = platform.width * artMul;
      sprite.scale.y = Math.abs(sprite.scale.x);
      sprite.position.set(platform.x + platform.width / 2, platform.y + platform.height / 2 + 6);
    }
  }

  private resetRun(): void {
    this.clearFloatingComboUi();
    this.score = 0;
    this.lastScoredStairId = -1;
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
    this.createPlatforms();
    this.spawnCollectibleField();
    this.resetPlayer();
    this.scoreboard?.reset();
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.collectibleHudBump = 0;
    this.collectibleHudRoot.scale.set(1);
    this.refreshCollectibleHudText();
  }

  private checkFallGameOver(): void {
    const feetY = this.player.body.y + this.player.body.height;
    const deathLine = this.cameraY + this.height + STAIRS.fallDeathBelowViewportPx;
    if (feetY > deathLine) {
      this.resetRun();
    }
  }

  private resetPlayer(): void {
    const start = this.platforms[0];
    this.player.body.x = Math.round(start.x + start.width / 2 - this.player.body.width / 2);
    this.player.body.y = Math.round(start.y - this.player.body.height);
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.body.grounded = true;
    this.grapple = null;
    this.grappleCooldown = 0;
    this.lastScoredStairId = start.stairId;
    this.player.update(0, 0, false, null, false);
  }

  private landOn(platform: Platform): void {
    this.ripples.push({
      x: this.player.body.x + this.player.body.width / 2,
      y: platform.y + 46,
      age: 0,
    });
  }

  private updateCamera(dt: number): void {
    this.highestY = Math.min(this.highestY, this.player.body.y);
    const targetY = Math.min(0, this.player.body.y - this.height * 0.45);
    this.cameraY += (targetY - this.cameraY) * Math.min(1, dt * 5);
    this.world.position.y = -this.cameraY;
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

    this.gameShake.position.set(this.shakeOffsetX, this.shakeOffsetY);
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
    const beast = this.getComboMultiplier() >= COMBO.beastModeMinMultiplier;
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
    beastMode: boolean,
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
    arm.tint = beastMode ? COMBO.beastTongueFill : 0xffffff;
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

  private drawStaticWorld(): void {
    this.background.clear();
    this.background.rect(0, 0, this.width, this.height).fill({ color: 0x000000 });
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
    return {
      x: cx + this.player.direction * GRAPPLE.mouthOffsetX,
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
        fontSize: 15,
        fill: '#ffd24a',
        stroke: { color: '#1a1020', width: 3 },
      }),
    });
    this.collectibleHudDiamondText = new Text({
      text: 'Diamonds 0',
      style: new TextStyle({
        fontFamily: 'system-ui, Segoe UI, sans-serif',
        fontSize: 15,
        fill: '#9df6ff',
        stroke: { color: '#1a1020', width: 3 },
      }),
    });
    this.collectibleHudRoot.addChild(
      this.collectibleHudBg,
      this.collectibleHudGoldText,
      this.collectibleHudDiamondText,
    );
    app.stage.addChild(this.collectibleHudRoot);
  }

  private layoutCollectibleHud(): void {
    const margin = 12;
    this.collectibleHudRoot.pivot.set(COLLECTIBLE_HUD_W, 0);
    this.collectibleHudRoot.position.set(this.width - margin, margin);
    this.collectibleHudBg.clear();
    this.collectibleHudBg
      .roundRect(0, 0, COLLECTIBLE_HUD_W, COLLECTIBLE_HUD_H, 10)
      .fill({ color: 0x120818, alpha: 0.74 })
      .stroke({ width: 1, color: 0x4a3a62, alpha: 0.55 });
    this.collectibleHudGoldText?.position.set(14, 12);
    this.collectibleHudDiamondText?.position.set(14, 44);
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
    this.score += add;
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
    const outlineColor = beastMode ? COMBO.beastTongueOutline : GRAPPLE.tongueOutline;
    const fillColor = beastMode ? COMBO.beastTongueFill : GRAPPLE.tongueColor;
    const outlineW = beastMode ? GRAPPLE.tongueOutlineWidth + 3 : GRAPPLE.tongueOutlineWidth;
    const coreW = beastMode ? GRAPPLE.tongueWidth + 2 : GRAPPLE.tongueWidth;
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return;
    }

    const nx = (-dy / len) * 16;
    const ny = (dx / len) * 16;
    const mx = (mouth.x + tip.x) * 0.5 + nx;
    const my = (mouth.y + tip.y) * 0.5 + ny;

    this.tongueVector
      .moveTo(mouth.x, mouth.y)
      .lineTo(mx, my)
      .lineTo(tip.x, tip.y)
      .stroke({
        width: outlineW,
        color: outlineColor,
        cap: 'round',
        join: 'round',
        alpha: 0.88,
      });
    this.tongueVector
      .moveTo(mouth.x, mouth.y)
      .lineTo(mx, my)
      .lineTo(tip.x, tip.y)
      .stroke({
        width: coreW,
        color: fillColor,
        cap: 'round',
        join: 'round',
        alpha: 0.96,
      });
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
}
